import { isIP } from 'node:net';

// Only explicit IPs/CIDRs; never trust arbitrary forwarded headers or hop counts.
export function trustedProxies(value = '') {
  if (!value.trim()) return false;
  const entries = value.split(',').map(s => s.trim());
  for (const entry of entries) {
    const [ip, prefix, extra] = entry.split('/');
    const family = isIP(ip);
    if (!family || extra !== undefined || (prefix !== undefined &&
        (!/^\d+$/.test(prefix) || Number(prefix) < 1 || Number(prefix) > (family === 4 ? 32 : 128))))
      throw new Error('TRUSTED_PROXIES must contain explicit IP addresses or nonzero CIDRs');
  }
  return entries;
}
