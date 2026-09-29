import { fail } from "./errors.mjs";
export function createRateLimit(db, now) {
  const rate = db.transaction((key, max) => {
    const stamp = now();
    db.prepare("DELETE FROM limits WHERE expires_at<=?").run(stamp);
    const row = db.prepare("SELECT count FROM limits WHERE key=?").get(key);
    if (row?.count >= max) fail(429, "try_later");
    db.prepare(
      "INSERT INTO limits VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count=count+1",
    ).run(key, stamp + 60000);
  });
  return rate;
}
