// Serialize OS writes: a slow previous update must not overwrite a later clear.
let writes: Promise<void> = Promise.resolve();
export function updateAppBadge(count: number): Promise<void> {
  if (!Number.isSafeInteger(count) || count < 0) return Promise.resolve();
  writes = writes.then(async () => {
    if (typeof navigator === 'undefined') return;
    if (count === 0 && 'clearAppBadge' in navigator) await navigator.clearAppBadge();
    else if ('setAppBadge' in navigator) await navigator.setAppBadge(count);
  }).catch(() => {}); // Unsupported/denied badging never blocks SMS access.
  return writes;
}
