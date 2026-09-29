export function createRateLimit(db, now) {
  const rate = db.transaction((key, max) => {
    const stamp = now();
    db.prepare("DELETE FROM limits WHERE expires_at<=?").run(stamp);
    const row = db.prepare("SELECT count, expires_at FROM limits WHERE key=?").get(key);
    if (row?.count >= max) throw Object.assign(new Error("try_later"), { statusCode: 429, retryAfter: Math.max(1, Math.ceil((row.expires_at - stamp) / 1000)) });
    db.prepare(
      "INSERT INTO limits VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count=count+1",
    ).run(key, stamp + 60000);
  });
  return rate;
}
