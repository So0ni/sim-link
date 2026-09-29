import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export function openStore(path) {
  if (path !== ":memory:")
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  const version = db.pragma("user_version", { simple: true });
  if (version > 1) {
    db.close();
    throw new Error("Database is newer than this server");
  }
  if (version === 0)
    db.transaction(() => {
      db.exec(`
      CREATE TABLE admin (id INTEGER PRIMARY KEY CHECK(id=1), salt TEXT NOT NULL, password_hash TEXT NOT NULL);
      CREATE TABLE sessions (hash TEXT PRIMARY KEY, id TEXT UNIQUE NOT NULL, expires_at INTEGER NOT NULL, renewed_at INTEGER NOT NULL);
      CREATE TABLE pairings (hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
      CREATE TABLE devices (id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT UNIQUE NOT NULL, created_at INTEGER NOT NULL, revoked_at INTEGER);
      CREATE TABLE messages (sequence INTEGER PRIMARY KEY AUTOINCREMENT, device_id TEXT NOT NULL REFERENCES devices(id), event_id TEXT NOT NULL,
        sender TEXT NOT NULL, body TEXT NOT NULL, subscription_id INTEGER, received_at INTEGER NOT NULL, synced_at INTEGER NOT NULL,
        UNIQUE(device_id, event_id));
      CREATE TABLE limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
      PRAGMA user_version = 1;
    `);
    })();
  return db;
}
