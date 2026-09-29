import { randomUUID } from "node:crypto";
import { token, hash } from "../../platform/crypto.mjs";
import { verifyPassword } from "./credentials.mjs";
import { fail } from "../../platform/errors.mjs";
const DAY = 86400000;

// SQL and lifetime rules stay owned by auth; HTTP adapters never receive the database.
export function createAuthService(db, now) {
  return {
    async login(password) {
      if (
        !(await verifyPassword(
          db.prepare("SELECT * FROM admin WHERE id=1").get(),
          password,
        ))
      )
        fail(401, "invalid_credentials");
      const raw = token();
      const stamp = now();
      db.prepare("DELETE FROM sessions WHERE expires_at<=?").run(stamp);
      db.prepare("INSERT INTO sessions VALUES (?, ?, ?, ?)").run(
        hash(raw),
        randomUUID(),
        stamp + 90 * DAY,
        stamp,
      );
      return raw;
    },
    read(raw) {
      if (!raw || !/^[\w-]{43}$/.test(raw)) fail(401, "session_required");
      const session = db
        .prepare("SELECT * FROM sessions WHERE hash=? AND expires_at>?")
        .get(hash(raw), now());
      if (!session) fail(401, "session_expired");
      return { ...session, raw };
    },
    resume(session) {
      const stamp = now();
      if (stamp - session.renewed_at < DAY) return false;
      const result = db
        .prepare(
          "UPDATE sessions SET expires_at=?, renewed_at=? WHERE hash=? AND expires_at>?",
        )
        .run(stamp + 90 * DAY, stamp, session.hash, stamp);
      if (!result.changes) fail(401, "session_expired");
      return true;
    },
    logout(session) {
      db.prepare("DELETE FROM sessions WHERE hash=?").run(session.hash);
    },
    list() {
      return db
        .prepare(
          "SELECT id, expires_at AS expiresAt, renewed_at AS lastActiveAt FROM sessions WHERE expires_at>?",
        )
        .all(now());
    },
    revoke(id) {
      db.prepare("DELETE FROM sessions WHERE id=?").run(id);
    },
  };
}
