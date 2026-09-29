import { randomUUID } from "node:crypto";
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
  if (version > 4) {
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
  if (version < 2) db.transaction(() => {
    // Messages retain their immutable source ID after device credentials are removed.
    const sequence = db.prepare("SELECT seq FROM sqlite_sequence WHERE name='messages'").get()?.seq ?? 0;
    db.exec(`
      ALTER TABLE devices ADD COLUMN last_seen_at INTEGER;
      CREATE TABLE messages_v2 (sequence INTEGER PRIMARY KEY AUTOINCREMENT, device_id TEXT NOT NULL, event_id TEXT NOT NULL,
        sender TEXT NOT NULL, body TEXT NOT NULL, subscription_id INTEGER, received_at INTEGER NOT NULL, synced_at INTEGER NOT NULL,
        UNIQUE(device_id, event_id));
      INSERT INTO messages_v2 SELECT * FROM messages;
      DROP TABLE messages;
      ALTER TABLE messages_v2 RENAME TO messages;
      DELETE FROM devices WHERE revoked_at IS NOT NULL;
      PRAGMA user_version = 2;
    `);
    db.prepare("UPDATE sqlite_sequence SET seq=MAX(seq, ?) WHERE name='messages'").run(sequence);
  })();
  if (version < 3) db.transaction(() => {
    db.exec(`
      CREATE TABLE sims (id TEXT PRIMARY KEY,device_id TEXT NOT NULL,local_key TEXT NOT NULL,
        subscription_id INTEGER NOT NULL,slot_index INTEGER NOT NULL,carrier TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT '',phone_number TEXT NOT NULL DEFAULT '',state TEXT NOT NULL,reported_at INTEGER NOT NULL,
        UNIQUE(device_id,local_key));
      ALTER TABLE devices ADD COLUMN inventory_status TEXT;
      ALTER TABLE devices ADD COLUMN inventory_at INTEGER;
      ALTER TABLE messages ADD COLUMN sim_key TEXT;
      PRAGMA user_version=3;
    `);
  })();
  if (version < 4) db.transaction(() => {
    db.exec(`
      CREATE TABLE server_identity (singleton INTEGER PRIMARY KEY CHECK(singleton=1),id TEXT NOT NULL);
      CREATE TABLE installations (id TEXT PRIMARY KEY,device_id TEXT UNIQUE NOT NULL,name TEXT NOT NULL);
      ALTER TABLE pairings ADD COLUMN target_device_id TEXT;
      PRAGMA user_version=4;
    `);
    db.prepare("INSERT INTO server_identity VALUES(1,?)").run(randomUUID());
  })();
  return db;
}
