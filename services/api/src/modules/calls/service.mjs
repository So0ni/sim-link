import { fail } from '../../platform/errors.mjs';
const columns = `sequence,device_id AS deviceId,event_id AS eventId,number,outcome,started_at AS startedAt,
 duration_seconds AS durationSeconds,sim_key AS simKey,synced_at AS syncedAt,viewed_at AS viewedAt`;
export function createCallsService(db,now,enqueue=()=>{}) {
  const requireSim=(deviceId,key)=>{
    if(key!==null && !db.prepare('SELECT 1 FROM sims WHERE device_id=? AND local_key=?').get(deviceId,key)) fail(503,'sim_not_reported');
  };
  return {
    receive: db.transaction((device,body)=>{
      const values=[body.number,body.outcome,body.startedAt,body.durationSeconds,body.simKey];
      const old=db.prepare('SELECT * FROM calls WHERE device_id=? AND event_id=?').get(device.id,body.eventId);
      if(old){
        if(JSON.stringify([old.number,old.outcome,old.started_at,old.duration_seconds])!==JSON.stringify(values.slice(0,4))) fail(409,'event_conflict');
        if(old.sim_key!==null && body.simKey!==null && old.sim_key!==body.simKey) fail(409,'event_conflict');
        // Monotonic enrichment; stale old clients cannot erase a known mapping or re-notify.
        if(old.sim_key===null && body.simKey!==null) {
          requireSim(device.id,body.simKey);
          db.prepare('UPDATE calls SET sim_key=? WHERE sequence=?').run(body.simKey,old.sequence);
        }
        return {eventId:body.eventId,sequence:old.sequence,syncedAt:old.synced_at,duplicate:true};
      }
      requireSim(device.id,body.simKey);
      const stamp=now();
      if(body.startedAt>stamp+300000)fail(400,'started_at_in_future');
      const result=db.prepare('INSERT INTO calls(device_id,event_id,number,outcome,started_at,duration_seconds,sim_key,synced_at) VALUES(?,?,?,?,?,?,?,?)').run(device.id,body.eventId,...values,stamp);
      const sequence=Number(result.lastInsertRowid);
      enqueue(sequence,device.id,body);
      return {eventId:body.eventId,sequence,syncedAt:stamp,duplicate:false};
    }),
    list(before) {
      if(before!==undefined && (typeof before!=='string'||!/^\d{1,15}$/.test(before)))fail(400,'invalid_cursor');
      const calls=db.prepare(`SELECT ${columns} FROM calls WHERE sequence<? ORDER BY sequence DESC LIMIT 100`).all(before===undefined?Number.MAX_SAFE_INTEGER:Number(before));
      return {calls,nextCursor:calls.length===100?String(calls.at(-1).sequence):null};
    },
    get(id){const call=db.prepare(`SELECT ${columns} FROM calls WHERE sequence=?`).get(id);if(!call)fail(404,'call_not_found');return call;},
    view(id){const result=db.prepare('UPDATE calls SET viewed_at=COALESCE(viewed_at,?) WHERE sequence=?').run(now(),id);if(!result.changes)fail(404,'call_not_found');return {ok:true};},
    report(device,body){
      if(body.checkedAt!==null && body.checkedAt>now()+300000)fail(400,'checked_at_in_future');
      db.prepare(`INSERT INTO call_status VALUES(?,?,?,?,?,?) ON CONFLICT(device_id) DO UPDATE SET enabled=excluded.enabled,
        permission=excluded.permission,checked_at=excluded.checked_at,pending=excluded.pending,reported_at=excluded.reported_at`)
        .run(device.id,Number(body.enabled),Number(body.permission),body.checkedAt,body.pending,now());
      return {ok:true};
    },
    status(){return {devices:db.prepare(`SELECT d.id AS deviceId,d.name,c.enabled,c.permission,c.checked_at AS checkedAt,c.pending,c.reported_at AS reportedAt
      FROM devices d LEFT JOIN call_status c ON c.device_id=d.id`).all()};},
  };
}
