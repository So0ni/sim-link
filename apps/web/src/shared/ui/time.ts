/** Calendar fields deliberately use the viewer's local timezone. */
export function conversationTime(at: number, now: number, detail = false): string {
  const date = new Date(at);
  if (!Number.isFinite(date.getTime())) return '时间未知';
  const current = new Date(now);
  const age = now - at;
  const clock = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  const day = `${date.getMonth() + 1}月${date.getDate()}日`;
  const dated = date.getFullYear() === current.getFullYear() ? day : `${date.getFullYear()}年${day}`;
  // Future device timestamps must not be described as "ago".
  if (age < 0) return `${dated} ${clock}`;
  if (age < 6 * 3600000) {
    const relative = age < 60000 ? '刚刚' : age < 3600000 ? `${Math.floor(age / 60000)} 分钟前` : `${Math.floor(age / 3600000)} 小时前`;
    return detail ? `${relative} · ${clock}` : relative;
  }
  if (age < 24 * 3600000) {
    const sameDay = date.getFullYear() === current.getFullYear() && date.getMonth() === current.getMonth() && date.getDate() === current.getDate();
    const yesterday = new Date(current); yesterday.setDate(current.getDate() - 1);
    const previousDay = date.getFullYear() === yesterday.getFullYear() && date.getMonth() === yesterday.getMonth() && date.getDate() === yesterday.getDate();
    return `${sameDay ? '' : previousDay ? '昨天 ' : `${dated} `}${clock}`;
  }
  return detail ? `${dated} ${clock}` : dated;
}
