import { randomUUID } from "node:crypto";
import { token, hash } from "../../platform/crypto.mjs";
import { verifyPassword } from "./credentials.mjs";
import { fail } from "../../platform/errors.mjs";
const DAY = 86400000;

// SQL and lifetime rules stay owned by auth; HTTP adapters never receive the database.
export function createAuthService(db, now) {
  return {
    async login(password, userAgent = "") {
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
      const id = randomUUID();
      db.transaction(() => {
        db.prepare("INSERT INTO sessions VALUES (?, ?, ?, ?)").run(
          hash(raw),
          id,
          stamp + 90 * DAY,
          stamp,
        );
        db.prepare("INSERT INTO session_details VALUES (?, ?, ?, ?)").run(id, sessionName(userAgent), stamp, stamp);
      })();
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
    resume(session, userAgent = "") {
      return db.transaction(() => {
        if (!db.prepare("SELECT 1 FROM sessions WHERE hash=? AND expires_at>?").get(session.hash, now())) fail(401, "session_expired");
        db.prepare(`INSERT INTO session_details VALUES (?, ?, NULL, ?)
          ON CONFLICT(session_id) DO UPDATE SET last_active_at=excluded.last_active_at, name=excluded.name`)
          .run(session.id, sessionName(userAgent), now());
        const stamp = now();
        if (stamp - session.renewed_at < DAY) return false;
        const result = db
          .prepare(
            "UPDATE sessions SET expires_at=?, renewed_at=? WHERE hash=? AND expires_at>?",
          )
          .run(stamp + 90 * DAY, stamp, session.hash, stamp);
        if (!result.changes) fail(401, "session_expired");
        return true;
      })();
    },
    logout(session) {
      db.prepare("DELETE FROM sessions WHERE hash=?").run(session.hash);
    },
    list(currentId) {
      return db
        .prepare(
          `SELECT s.id, s.expires_at AS expiresAt, d.created_at AS createdAt,
           d.last_active_at AS lastActiveAt, COALESCE(d.name, '未知浏览器') AS name,
           s.id=? AS current FROM sessions s LEFT JOIN session_details d ON d.session_id=s.id
           WHERE s.expires_at>? ORDER BY current DESC, d.last_active_at DESC, s.id`,
        )
        .all(currentId, now()).map(row => ({ ...row, current: !!row.current }));
    },
    revoke(id) {
      db.prepare("DELETE FROM sessions WHERE id=?").run(id);
    },
  };
}

// Coarse labels only: never store raw User-Agent or pretend it identifies hardware.
export function sessionName(value) {
  const ua = String(value).slice(0, 1024);
  const platform = /iPhone/i.test(ua) ? 'iPhone' : /iPad/i.test(ua) ? 'iPad' :
    /Android/i.test(ua) ? 'Android' : /Windows/i.test(ua) ? 'Windows' :
    /Macintosh|Mac OS X/i.test(ua) ? 'Mac / iPad' : /Linux/i.test(ua) ? 'Linux' : '未知系统';
  const browser = /Edg(?:e|A|iOS)?\//i.test(ua) ? 'Edge' : /Firefox|FxiOS/i.test(ua) ? 'Firefox' :
    /Chrome|CriOS/i.test(ua) ? 'Chrome' : /Safari/i.test(ua) ? 'Safari' : '浏览器';
  return `${platform} · ${browser}`;
}
