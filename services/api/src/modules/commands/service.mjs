import { randomUUID } from 'node:crypto';
import { fail } from '../../platform/errors.mjs';

const QUEUE_TTL_MS = 60 * 60 * 1000;

export function createCommandService(db, now) {
  const get = id => db.prepare('SELECT * FROM commands WHERE id=?').get(id);
  const expire = () => db.prepare("UPDATE commands SET state='cancelled',reason='expired' WHERE state='pending' AND expires_at<=?").run(now());
  const view = row => ({ id: row.id, requestId: row.request_id, deviceId: row.device_id, simId: row.sim_id,
    simKey: row.sim_key, subscriptionId: row.subscription_id, slotIndex: row.slot_index,
    recipient: row.recipient, body: row.body, createdAt: row.created_at, expiresAt: row.expires_at,
    claimRequestId: row.claim_request_id, claimedAt: row.claimed_at, reportedAt: row.reported_at, serverTime: now(),
    state: row.state === 'claimed' && now() - row.claimed_at >= 120000 ? 'unknown' : row.state,
    reason: row.reason, parts: row.parts ? JSON.parse(row.parts) : [], interrupted: Boolean(row.interrupted) });
  const capability = (deviceId, enabled) => {
    db.prepare('UPDATE devices SET send_capability=?,send_capability_at=? WHERE id=?').run(enabled ? 1 : 0, now(), deviceId);
    return { ok: true };
  };
  return {
    capability,
    expire,
    create: db.transaction(body => {
      expire();
      const recipient = body.recipient.replace(/[\s()-]/g, '');
      if (!/^\+[1-9][0-9]{6,14}$/.test(recipient) || !body.body.trim()) fail(400, 'invalid_sms');
      const old = db.prepare('SELECT * FROM commands WHERE request_id=?').get(body.requestId);
      if (old) {
        if (old.sim_id !== body.simId || old.recipient !== recipient || old.body !== body.body) fail(409, 'idempotency_conflict');
        return view(old);
      }
      const sim = db.prepare('SELECT s.*,d.send_capability,d.send_capability_at FROM sims s JOIN devices d ON s.device_id=d.id WHERE s.id=?').get(body.simId);
      if (!sim || sim.state !== 'active') fail(409, 'sim_unavailable');
      if (sim.send_capability !== 1) fail(409, 'send_not_enabled');
      const id = randomUUID(); const stamp = now();
      db.prepare(`INSERT INTO commands(id,request_id,device_id,sim_id,sim_key,subscription_id,slot_index,recipient,body,created_at,expires_at,state,wait_offline)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,'pending',?)`).run(id,body.requestId,sim.device_id,sim.id,sim.local_key,sim.subscription_id,sim.slot_index,recipient,body.body,stamp,stamp+QUEUE_TTL_MS,1);
      return view(get(id));
    }),
    list() { expire(); return { commands: db.prepare('SELECT * FROM commands ORDER BY created_at DESC,rowid DESC LIMIT 200').all().map(view) }; },
    find(requestId) { expire(); const row = db.prepare('SELECT * FROM commands WHERE request_id=?').get(requestId); if (!row) fail(404,'command_not_found'); return view(row); },
    cancel: db.transaction(id => {
      expire(); const row = get(id); if (!row) fail(404,'command_not_found');
      if (row.state === 'cancelled') return view(row);
      if (row.state !== 'pending') fail(409,'already_claimed_or_finished');
      db.prepare("UPDATE commands SET state='cancelled' WHERE id=? AND state='pending'").run(id);
      return view(get(id));
    }),
    claim: db.transaction((deviceId, requestId) => {
      expire();
      const prior = db.prepare('SELECT * FROM commands WHERE device_id=? AND claim_request_id=?').get(deviceId,requestId);
      if (prior) return { command: view(prior), serverTime: now() };
      const device = db.prepare('SELECT send_capability FROM devices WHERE id=?').get(deviceId);
      if (device.send_capability !== 1) return { command: null, serverTime: now() };
      // Reject stale mappings without moving a command to another SIM.
      db.prepare(`UPDATE commands SET state='rejected',reason='sim_changed',reported_at=? WHERE device_id=? AND state='pending'
        AND NOT EXISTS(SELECT 1 FROM sims s WHERE s.id=commands.sim_id AND s.state='active' AND s.local_key=commands.sim_key)`).run(now(),deviceId);
      const row = db.prepare("SELECT * FROM commands WHERE device_id=? AND state='pending' ORDER BY created_at,rowid LIMIT 1").get(deviceId);
      if (!row) return { command: null, serverTime: now() };
      db.prepare("UPDATE commands SET state='claimed',claimed_at=?,claim_request_id=? WHERE id=? AND state='pending'").run(now(),requestId,row.id);
      return { command: view(get(row.id)), serverTime: now() };
    }),
    report: db.transaction((deviceId,id,body) => {
      const row=get(id); if (!row || row.device_id !== deviceId) fail(404,'command_not_found');
      if (row.claim_request_id !== body.claimRequestId) fail(409,'claim_mismatch');
      if (body.rejection) {
        if (row.state === 'rejected' && row.reason === body.rejection) return view(row);
        if (row.state !== 'claimed') fail(409,'result_conflict');
        db.prepare("UPDATE commands SET state='rejected',reason=?,reported_at=? WHERE id=?").run(body.rejection,now(),id);
      } else {
        if (['pending','expired','cancelled','rejected'].includes(row.state)) fail(409,'result_conflict');
        if (!body.parts.length) fail(400,'parts_required');
        const old = row.parts ? JSON.parse(row.parts) : body.parts.map(()=>null);
        if (old.length !== body.parts.length) fail(409,'parts_changed');
        const parts=old.map((v,i)=> {
          if (v !== null && body.parts[i] !== null && v !== body.parts[i]) fail(409,'result_conflict');
          return v ?? body.parts[i];
        });
        const interrupted = Boolean(row.interrupted || body.interrupted);
        const state = parts.every(v=>v===-1) ? 'sent' : parts.every(v=>v!==null && v!==-1) ? 'failed' :
          parts.some(v=>v===-1) && parts.some(v=>v!==null && v!==-1) ? 'partial' : 'unknown';
        db.prepare('UPDATE commands SET parts=?,state=?,interrupted=?,reported_at=? WHERE id=?').run(JSON.stringify(parts),state,interrupted?1:0,now(),id);
      }
      return view(get(id));
    }),
  };
}
