import { randomUUID } from "node:crypto";
import { token, hash } from "../../platform/crypto.mjs";
import { fail } from "../../platform/errors.mjs";
export function createDeviceService(db, now, origin) {
  const pair = db.transaction((body) => {
    const stamp = now();
    const consumed = db
      .prepare("DELETE FROM pairings WHERE hash=? AND expires_at>?")
      .run(hash(body.pairingToken), stamp);
    if (!consumed.changes) fail(400, "pairing_invalid_or_expired");
    const deviceToken = token();
    const deviceId = randomUUID();
    db.prepare("INSERT INTO devices(id,name,token_hash,created_at,revoked_at) VALUES (?, ?, ?, ?, NULL)").run(
      deviceId,
      body.name,
      hash(deviceToken),
      stamp,
    );
    return { deviceId, deviceToken, apiVersion: 1 };
  });
  return {
    pair,
    invite() {
      const raw = token();
      const expiresAt = now() + 300000;
      db.prepare("DELETE FROM pairings WHERE expires_at<=?").run(now());
      db.prepare("INSERT INTO pairings VALUES (?, ?)").run(
        hash(raw),
        expiresAt,
      );
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
      db.prepare("DELETE FROM devices WHERE id=?").run(id);
    },
  };
}
