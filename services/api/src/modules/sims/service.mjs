import { randomUUID } from "node:crypto";
import { fail } from "../../platform/errors.mjs";

export function createSimService(db, now) {
  const report = db.transaction((deviceId, body) => {
    if (new Set(body.sims.map(s => s.key)).size !== body.sims.length ||
        new Set(body.sims.map(s => s.subscriptionId)).size !== body.sims.length)
      fail(400, "duplicate_sim_mapping");
    const stamp = now();
    if (body.status !== "available" && body.sims.length) fail(400, "invalid_inventory");
    // Unknown inventory must not be interpreted as confirmed removal.
    db.prepare("UPDATE sims SET state=? WHERE device_id=?").run(body.status === "available" ? "inactive" : "unknown", deviceId);
    for (const sim of body.sims) {
      const old = db.prepare("SELECT * FROM sims WHERE device_id=? AND local_key=?").get(deviceId, sim.key);
      if (old && (old.subscription_id !== sim.subscriptionId || old.slot_index !== sim.slotIndex)) fail(409, "mapping_key_reused");
      db.prepare(`INSERT INTO sims(id,device_id,local_key,subscription_id,slot_index,carrier,name,state,reported_at)
        VALUES(?,?,?,?,?,?,'','active',?) ON CONFLICT(device_id,local_key)
        DO UPDATE SET carrier=excluded.carrier,state='active',reported_at=excluded.reported_at`)
        .run(randomUUID(), deviceId, sim.key, sim.subscriptionId, sim.slotIndex, sim.carrier, stamp);
    }
    db.prepare("UPDATE devices SET inventory_status=?,inventory_at=? WHERE id=?").run(body.status, stamp, deviceId);
    return { ok: true };
  });
  return {
    report,
    list() {
      return db.prepare(`SELECT s.id,s.device_id AS deviceId,s.local_key AS simKey,s.subscription_id AS subscriptionId,
        s.slot_index AS slotIndex,s.carrier,s.name,s.phone_number AS phoneNumber,CASE WHEN d.id IS NULL THEN 'detached' ELSE s.state END AS state,
        s.reported_at AS reportedAt FROM sims s LEFT JOIN devices d ON d.id=s.device_id ORDER BY s.rowid`).all();
    },
    rename(id, name, phoneNumber) {
      const trimmed = name.trim();
      const phone = phoneNumber.replace(/[ ()-]/g, "");
      if (phone && !/^\+?[0-9]{6,20}$/.test(phone)) fail(400, "invalid_phone_number");
      if (!db.prepare("UPDATE sims SET name=?,phone_number=? WHERE id=?").run(trimmed, phone, id).changes) fail(404, "sim_not_found");
      return { ok: true };
    },
  };
}
