import { randomUUID, ECDH } from 'node:crypto';
import webpush from 'web-push';
import { sendNotification } from './transport.mjs';
import { fail } from '../../platform/errors.mjs';
const HOUR = 3600000;
const segments = new Intl.Segmenter('und', {granularity:'grapheme'});
export function messagePreview(body, limit) {
  if (!limit) return '';
  const chars = Array.from(segments.segment(body.replace(/\s+/gu,' ').trim()), item => item.segment);
  return chars.slice(0,limit).join('') + (chars.length > limit ? '…' : '');
}
// Only established browser push services are allowed. Never fetch arbitrary authenticated-user URLs.
export function validateSubscription(subscription) {
  let url;
  try { url = new URL(subscription.endpoint); } catch { fail(400, 'invalid_push_endpoint'); }
  const host = url.hostname;
  const allowed = host === 'fcm.googleapis.com' || host === 'updates.push.services.mozilla.com'
    || host.endsWith('.notify.windows.com') || host === 'web.push.apple.com' || host.endsWith('.push.apple.com');
  if (!allowed || url.protocol !== 'https:' || url.port || url.username || url.password || url.hash)
    fail(400, 'unsupported_push_endpoint');
  try {
    const key = Buffer.from(subscription.keys.p256dh, 'base64url');
    if (key.length !== 65 || Buffer.from(subscription.keys.auth, 'base64url').length !== 16) throw Error();
    ECDH.convertKey(key, 'prime256v1');
  } catch { fail(400, 'invalid_push_keys'); }
}
export function createPushService(db, now, origin, send = sendNotification) {
  let identity = db.prepare('SELECT * FROM push_identity').get();
  if (!identity) {
    const keys = webpush.generateVAPIDKeys();
    db.prepare('INSERT INTO push_identity VALUES(1,?,?)').run(keys.publicKey, keys.privateKey);
    identity = db.prepare('SELECT * FROM push_identity').get();
  }
  let running;
  const owned = (session, id) => {
    const row = db.prepare('SELECT * FROM push_subscriptions WHERE id=? AND session_id=?').get(id, session.id);
    if (!row) fail(404, 'push_subscription_not_found');
    return row;
  };
  const enqueue = (subscription, key, url, expires, sender = 'SIMLink 测试') => db.prepare(`INSERT OR IGNORE INTO push_jobs
    (id,subscription_id,event_key,url,sender,created_at,expires_at,next_at) VALUES(?,?,?,?,?,?,?,?)`)
    .run(randomUUID(), subscription.id, key, url, sender, now(), expires, now());
  const deliveryColumns = 'id,state,attempts,created_at AS createdAt,last_at AS attemptedAt,accepted_at AS acceptedAt,worker_received_at AS workerReceivedAt,notification_shown_at AS notificationShownAt,result';
  const service = {
    receipt(session, id, report) {
      const job = db.prepare('SELECT j.id FROM push_jobs j JOIN push_subscriptions p ON j.subscription_id=p.id WHERE j.id=? AND p.session_id=?').get(id,session.id);
      if (!job) fail(404,'push_job_not_found');
      db.prepare('UPDATE push_jobs SET worker_received_at=COALESCE(worker_received_at,?),notification_shown_at=COALESCE(notification_shown_at,?) WHERE id=?')
        .run(report.receivedAt,report.shownAt,id);
      return {ok:true};
    },
    lookup(session, endpoint) {
      return { id: db.prepare('SELECT id FROM push_subscriptions WHERE session_id=? AND endpoint=?').get(session.id,endpoint)?.id ?? null };
    },
    status(session) {
      return { publicKey: identity.public_key, subscriptions: db.prepare('SELECT id,preview_length FROM push_subscriptions WHERE session_id=?').all(session.id).map(({id,preview_length}) => ({
        id, previewLength:preview_length, lastDelivery: db.prepare(`SELECT ${deliveryColumns} FROM push_jobs WHERE subscription_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1`).get(id) ?? null,
        deliveries: db.prepare(`SELECT ${deliveryColumns} FROM push_jobs WHERE subscription_id=? ORDER BY created_at DESC,rowid DESC LIMIT 10`).all(id),
      })) };
    },
    subscribe: db.transaction((session, subscription) => {
      validateSubscription(subscription);
      const existing = db.prepare('SELECT * FROM push_subscriptions WHERE endpoint=?').get(subscription.endpoint);
      if (existing && existing.session_id === session.id && existing.p256dh === subscription.keys.p256dh && existing.auth === subscription.keys.auth) return { id: existing.id };
      // A new login must explicitly bind this installation again; old queued work is discarded.
      if (existing) db.prepare('DELETE FROM push_subscriptions WHERE id=?').run(existing.id);
      if (db.prepare('SELECT count(*) AS n FROM push_subscriptions').get().n >= 100) fail(409, 'push_subscription_limit');
      const id = randomUUID();
      db.prepare('INSERT INTO push_subscriptions(id,session_id,endpoint,p256dh,auth,created_at) VALUES(?,?,?,?,?,?)').run(id,session.id,subscription.endpoint,subscription.keys.p256dh,subscription.keys.auth,now());
      return { id };
    }),
    preferences(session,id,{previewLength}) {
      owned(session,id);
      if (!Number.isInteger(previewLength) || previewLength < 0 || previewLength > 200) fail(400,'invalid_preview_length');
      db.prepare('UPDATE push_subscriptions SET preview_length=? WHERE id=?').run(previewLength,id);
      return {previewLength};
    },
    remove(session, id) { owned(session,id); db.prepare('DELETE FROM push_subscriptions WHERE id=?').run(id); return {ok:true}; },
    test(session,id) { const sub = owned(session,id); enqueue(sub,`test:${randomUUID()}`,'/#/settings',now()+HOUR); return {queued:true}; },
    enqueueMessage(sequence, deviceId, message) {
      if (message.receivedAt < now()-HOUR) return;
      const url = '/#/inbox/'+encodeURIComponent(JSON.stringify([deviceId,message.simKey ?? message.subscriptionId,message.sender]));
      const subs = db.prepare('SELECT p.id FROM push_subscriptions p JOIN sessions s ON p.session_id=s.id WHERE s.expires_at>?').all(now());
      for (const sub of subs) enqueue(sub,`message:${sequence}`,url,Math.min(now()+HOUR,message.receivedAt+HOUR),message.sender);
    },
    enqueueCall(sequence, deviceId, call) {
      if (call.outcome !== 'missed' || call.startedAt < now()-HOUR) return;
      const subs = db.prepare('SELECT p.id FROM push_subscriptions p JOIN sessions s ON p.session_id=s.id WHERE s.expires_at>?').all(now());
      for (const sub of subs) enqueue(sub,`call:${sequence}`,`/#/calls/${sequence}`,Math.min(now()+HOUR,call.startedAt+HOUR),'');
    },
    drain() {
      if (running) return running;
      running = (async () => {
        db.prepare('DELETE FROM push_subscriptions WHERE session_id IN (SELECT id FROM sessions WHERE expires_at<=?)').run(now());
        db.prepare("UPDATE push_jobs SET state='expired',result='expired' WHERE state='pending' AND expires_at<=?").run(now());
        db.prepare("DELETE FROM push_jobs WHERE state!='pending' AND created_at<?").run(now()-7*86400000);
        const jobs = db.prepare("SELECT id FROM push_jobs WHERE state='pending' AND next_at<=? ORDER BY created_at LIMIT 20").all(now());
        let cursor = 0;
        const deliver = async ({id}) => {
          const job = db.prepare(`SELECT j.*,p.endpoint,p.p256dh,p.auth,p.session_id,p.preview_length FROM push_jobs j JOIN push_subscriptions p ON j.subscription_id=p.id
            JOIN sessions s ON s.id=p.session_id WHERE j.id=? AND s.expires_at>? AND j.expires_at>?`).get(id,now(),now());
          if (!job) return;
          const attempts = job.attempts+1;
          db.prepare('UPDATE push_jobs SET attempts=?,last_at=?,next_at=? WHERE id=?').run(attempts,now(),now()+60000,id);
          try {
            const message = job.preview_length > 0 && /^message:\d+$/.test(job.event_key)
              ? db.prepare('SELECT body FROM messages WHERE sequence=?').get(Number(job.event_key.slice(8))) : null;
            const call = /^call:\d+$/.test(job.event_key)
              ? db.prepare('SELECT number FROM calls WHERE sequence=?').get(Number(job.event_key.slice(5))) : null;
            const preview = call ? (call.number?.trim() || '号码未提供') : message ? messagePreview(message.body,job.preview_length) : '';
            await send({endpoint:job.endpoint,keys:{p256dh:job.p256dh,auth:job.auth}},JSON.stringify({
              ...(preview ? {preview} : {}),jobId:job.id,title:'SIMLink',body:job.event_key.startsWith('call:')?'收到一通未接来电，点击查看。':job.event_key.startsWith('test:')?'SIMLink 测试：通知已开启。':`${job.sender} 发来一条短信`,url:job.url,tag:job.event_key,sessionId:job.session_id,
            }),{TTL:Math.max(1,Math.floor((job.expires_at-now())/1000)),timeout:10000,urgency:'high',
              vapidDetails:{subject:origin,publicKey:identity.public_key,privateKey:identity.private_key}});
            db.prepare("UPDATE push_jobs SET state='accepted',result='accepted',accepted_at=? WHERE id=?").run(now(),id);
          } catch (error) {
            const status = error.statusCode;
            if (status === 404 || status === 410) { db.prepare('DELETE FROM push_subscriptions WHERE id=?').run(job.subscription_id); return; }
            const retry = (!status || status === 429 || status >= 500) && attempts < 6;
            db.prepare('UPDATE push_jobs SET state=?,result=?,next_at=? WHERE id=?').run(retry?'pending':'failed',
              status ? `http_${Number(status)}` : 'network_error',now()+Math.min(15*60000,30000*2**(attempts-1)),id);
          }
        };
        // A slow subscription must not hold every other notification behind it.
        const outcomes = await Promise.allSettled(Array.from({length:Math.min(4,jobs.length)}, async () => {
          while (cursor < jobs.length) await deliver(jobs[cursor++]);
        }));
        const failed = outcomes.find(result => result.status === 'rejected');
        if (failed) throw failed.reason;
      })().finally(()=>{running=null;});
      return running;
    },
    async stop() { await running; },
  };
  return service;
}
