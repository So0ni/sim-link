import { isIP } from 'node:net';
import { hash } from '../../platform/crypto.mjs';

export function loginSource(ip) {
  if (isIP(ip) === 4) return ip;
  if (isIP(ip) !== 6) return 'unknown';
  const canonical = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
  const [left, right = ''] = canonical.split('::');
  const a = left ? left.split(':') : [], b = right ? right.split(':') : [];
  const words = [...a, ...Array(8 - a.length - b.length).fill('0'), ...b].map(w => parseInt(w, 16));
  if (words.slice(0, 5).every(w => w === 0) && words[5] === 65535)
    return [words[6] >> 8, words[6] & 255, words[7] >> 8, words[7] & 255].join('.');
  return words.slice(0, 4).map(w => w.toString(16)).join(':') + '::/64';
}
export function loginLimited(seconds) {
  throw Object.assign(new Error('try_later'), { statusCode: 429, retryAfter: Math.max(1, Math.ceil(seconds)) });
}
export function createLoginLimit(db, now, rate) {
  let running = 0;
  const begin = db.transaction(key => {
    const stamp = now();
    db.prepare('DELETE FROM login_failures WHERE expires_at<=?').run(stamp);
    const row = db.prepare('SELECT * FROM login_failures WHERE source=?').get(key);
    if (row?.blocked_until > stamp) loginLimited((row.blocked_until - stamp) / 1000);
    if (running >= 2) loginLimited(2);
    rate('login', 30);
  });
  const failed = db.transaction(key => {
    const stamp = now();
    const old = db.prepare('SELECT * FROM login_failures WHERE source=? AND expires_at>?').get(key, stamp);
    const failures = (old?.failures ?? 0) + 1;
    const delay = failures < 5 ? 0 : Math.min(900, 60 * 2 ** Math.min(failures - 5, 4));
    db.prepare(`INSERT INTO login_failures VALUES(?,?,?,?) ON CONFLICT(source) DO UPDATE SET
      failures=excluded.failures,blocked_until=excluded.blocked_until,expires_at=excluded.expires_at`)
      .run(key, failures, stamp + delay * 1000, stamp + (failures < 5 ? 15 * 60000 : 24 * 3600000));
    return delay;
  });
  return {
    async verify(ip, verify) {
      const key = hash(loginSource(ip));
      begin(key);
      running++;
      try {
        const result = await verify();
        db.prepare('DELETE FROM login_failures WHERE source=?').run(key);
        return result;
      } catch (error) {
        if (error.statusCode === 401) {
          const delay = failed(key);
          if (delay) loginLimited(delay);
        }
        throw error;
      } finally { running--; }
    },
  };
}
