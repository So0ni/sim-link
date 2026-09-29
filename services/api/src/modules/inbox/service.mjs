import { fail } from "../../platform/errors.mjs";
export function createInboxService(db, now) {
  const receive = db.transaction((dev, body) => {
    const old = db
      .prepare("SELECT * FROM messages WHERE device_id=? AND event_id=?")
      .get(dev.id, body.eventId);
    if (old) {
      if (
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
    const stamp = now();
    if (body.receivedAt > stamp + 300000) fail(400, "received_at_in_future");
    const result = db
      .prepare(
        "INSERT INTO messages(device_id,event_id,sender,body,subscription_id,received_at,synced_at) VALUES (?,?,?,?,?,?,?)",
      )
      .run(
        dev.id,
        body.eventId,
        body.sender,
        body.body,
        body.subscriptionId,
        body.receivedAt,
        stamp,
      );
    return {
      eventId: body.eventId,
      sequence: Number(result.lastInsertRowid),
      syncedAt: stamp,
      duplicate: false,
    };
  });
  return {
    receive,
    list(cursor) {
      const after = cursor ?? "0";
      if (typeof after !== "string" || !/^\d{1,15}$/.test(after))
        fail(400, "invalid_cursor");
      const messages = db
        .prepare(
          `SELECT sequence, device_id AS deviceId, event_id AS eventId, sender, body,
      subscription_id AS subscriptionId, received_at AS receivedAt, synced_at AS syncedAt
      FROM messages WHERE sequence>? ORDER BY sequence LIMIT 100`,
        )
        .all(Number(after));
      return {
        messages,
        nextCursor: String(messages.at(-1)?.sequence ?? after),
      };
    },
  };
}
