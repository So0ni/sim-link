import { randomUUID } from "node:crypto";
import { token, hash } from "../../platform/crypto.mjs";
import { fail } from "../../platform/errors.mjs";
export function createDeviceService(db, now, origin) {
  const serverId = db.prepare("SELECT id FROM server_identity WHERE singleton=1").get().id;
  const remember = (installationId, deviceId, name) => {
    const old = db.prepare("SELECT * FROM installations WHERE id=? OR device_id=?").all(installationId, deviceId);
    if (old.some(row => row.id !== installationId || row.device_id !== deviceId)) fail(409, "installation_conflict");
    db.prepare("INSERT INTO installations VALUES(?,?,?) ON CONFLICT(id) DO NOTHING").run(installationId, deviceId, name);
  };
  const pair = db.transaction((body) => {
    const invitation = db.prepare("SELECT * FROM pairings WHERE hash=? AND expires_at>?").get(hash(body.pairingToken), now());
    if (!invitation) fail(400, "pairing_invalid_or_expired");
    const known = body.installationId && db.prepare("SELECT * FROM installations WHERE id=?").get(body.installationId);
    if (known && invitation.target_device_id !== known.device_id) fail(409, "rebind_confirmation_required");
    const deviceId = invitation.target_device_id ?? randomUUID();
    const previous = db.prepare("SELECT name FROM devices WHERE id=?").get(deviceId) ?? db.prepare("SELECT name FROM installations WHERE device_id=?").get(deviceId);
    if (invitation.target_device_id && (!previous || !body.installationId)) fail(409, "rebind_target_invalid");
    const name = previous?.name ?? body.name;
    if (body.installationId) remember(body.installationId, deviceId, name);
    db.prepare("DELETE FROM pairings WHERE hash=?").run(hash(body.pairingToken));
    const deviceToken = token();
    db.prepare(`INSERT INTO devices(id,name,token_hash,created_at,revoked_at) VALUES(?,?,?,?,NULL)
      ON CONFLICT(id) DO UPDATE SET token_hash=excluded.token_hash,revoked_at=NULL,last_seen_at=NULL,inventory_status=NULL,inventory_at=NULL`)
      .run(deviceId, name, hash(deviceToken), now());
    // A successful rebind invalidates all outstanding recovery invitations for this device.
    db.prepare("DELETE FROM pairings WHERE target_device_id=?").run(deviceId);
    return { deviceId, deviceToken, serverId, apiVersion: 1 };
  });
  return {
    pair,
    serverId,
    identity: db.transaction((device, body) => {
      if (body.deviceId !== device.id || (body.serverId && body.serverId !== serverId)) fail(409, "server_or_device_mismatch");
      remember(body.installationId, device.id, device.name);
      return { deviceId: device.id, serverId, installationId: body.installationId };
    }),
    recoverable() {
      return db.prepare("SELECT device_id AS id,name FROM installations WHERE device_id NOT IN (SELECT id FROM devices)").all();
    },
    invite(targetDeviceId = null) {
      if (targetDeviceId && !db.prepare("SELECT id FROM devices WHERE id=? UNION SELECT device_id FROM installations WHERE device_id=?").get(targetDeviceId, targetDeviceId)) fail(404, "device_not_found");
      const raw = token();
      const expiresAt = now() + 300000;
      db.prepare("DELETE FROM pairings WHERE expires_at<=?").run(now());
      db.prepare("INSERT INTO pairings(hash,expires_at,target_device_id) VALUES (?, ?, ?)").run(hash(raw), expiresAt, targetDeviceId);
      return { pairingToken: raw, expiresAt, server: origin, apiVersion: 1 };
    },
    authenticate(raw) {
      const found =
        raw &&
        db
          .prepare(
            "SELECT * FROM devices WHERE token_hash=? AND revoked_at IS NULL",
          )
          .get(hash(raw));
      if (!found) fail(401, "device_required");
      return found;
    },
    list() {
      return db
        .prepare(
          "SELECT id, name, created_at AS createdAt, revoked_at AS revokedAt, last_seen_at AS lastSeenAt, inventory_status AS inventoryStatus, inventory_at AS inventoryAt FROM devices WHERE revoked_at IS NULL ORDER BY created_at",
        )
        .all().map(device => ({ ...device, presence: device.lastSeenAt === null ? "unknown" : now() - device.lastSeenAt <= 35 * 60 * 1000 ? "online" : "offline", serverTime: now() }));
    },
    heartbeat(id) {
      const stamp = now();
      db.prepare("UPDATE devices SET last_seen_at=? WHERE id=?").run(stamp, id);
      return { receivedAt: stamp };
    },
    revoke(id) {
      db.transaction(() => {
        db.prepare("DELETE FROM pairings WHERE target_device_id=?").run(id);
        db.prepare("DELETE FROM devices WHERE id=?").run(id);
      })();
    },
  };
}
