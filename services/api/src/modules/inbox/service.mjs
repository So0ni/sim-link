import { fail } from "../../platform/errors.mjs";
function cursorValue(value) {
  const cursor = value ?? "0";
  if (typeof cursor !== "string" || !/^\d{1,15}$/.test(cursor)) fail(400, "invalid_cursor");
  return Number(cursor);
}
const readingColumns = "sequence, is_read AS isRead, read_version AS readVersion";
const reading = row => ({ ...row, isRead: Boolean(row.isRead) });
export function createInboxService(db, now, enqueueNotification = () => {}) {
  const updateReading = db.transaction(({ messages, isRead }) => {
    if (new Set(messages.map(m => m.sequence)).size !== messages.length) fail(400, "duplicate_sequence");
    const rows = messages.map(m => db.prepare(`SELECT ${readingColumns} FROM messages WHERE sequence=?`).get(m.sequence));
    if (rows.some(row => !row)) fail(404, "message_not_found");
    const conflicts = [];
    const states = rows.map((row, i) => {
      if (row.readVersion !== messages[i].readVersion) {
        conflicts.push(row.sequence);
      } else {
        // Even a same-value write advances the version: explicit user intent wins over stale requests.
        const { version } = db.prepare("UPDATE reading_clock SET version=version+1 WHERE singleton=1 RETURNING version").get();
        db.prepare("UPDATE messages SET is_read=?,read_version=? WHERE sequence=?").run(Number(isRead), version, row.sequence);
        row.isRead = isRead;
        row.readVersion = version;
      }
      return reading(row);
    });
    return { states, conflicts };
  });
  const receive = db.transaction((dev, body) => {
    const old = db
      .prepare("SELECT * FROM messages WHERE device_id=? AND event_id=?")
      .get(dev.id, body.eventId);
    if (old) {
      if (
        old.sim_key !== (body.simKey ?? null) ||
        old.sender !== body.sender ||
        old.body !== body.body ||
        old.subscription_id !== body.subscriptionId ||
        old.received_at !== body.receivedAt
      )
        fail(409, "event_conflict");
      return {
        eventId: body.eventId,
        sequence: old.sequence,
        syncedAt: old.synced_at,
        duplicate: true,
      };
    }
    if (body.simKey && body.subscriptionId === null) fail(400, "sim_requires_subscription");
    const stamp = now();
    if (body.receivedAt > stamp + 300000) fail(400, "received_at_in_future");
    const result = db
      .prepare(
        "INSERT INTO messages(device_id,event_id,sender,body,subscription_id,received_at,synced_at,sim_key) VALUES (?,?,?,?,?,?,?,?)",
      )
      .run(
        dev.id,
        body.eventId,
        body.sender,
        body.body,
        body.subscriptionId,
        body.receivedAt,
        stamp,
        body.simKey ?? null,
      );
    enqueueNotification(Number(result.lastInsertRowid), dev.id, body);
    return {
      eventId: body.eventId,
      sequence: Number(result.lastInsertRowid),
      syncedAt: stamp,
      duplicate: false,
    };
  });
  return {
    receive,
    updateReading,
    readingChanges(cursor) {
      const after = cursorValue(cursor);
      const states = db.prepare(`SELECT ${readingColumns} FROM messages WHERE read_version>? ORDER BY read_version LIMIT 100`).all(after).map(reading);
      return { states, nextCursor: String(states.at(-1)?.readVersion ?? after) };
    },
    list(cursor) {
      const after = cursor ?? "0";
      if (typeof after !== "string" || !/^\d{1,15}$/.test(after))
        fail(400, "invalid_cursor");
      const messages = db
        .prepare(
          `SELECT sequence, device_id AS deviceId, event_id AS eventId, sender, body,
      subscription_id AS subscriptionId, sim_key AS simKey, received_at AS receivedAt, synced_at AS syncedAt, is_read AS isRead, read_version AS readVersion
      FROM messages WHERE sequence>? ORDER BY sequence LIMIT 100`,
        )
        .all(Number(after)).map(reading);
      return {
        messages,
        nextCursor: String(messages.at(-1)?.sequence ?? after),
      };
    },
  };
}
