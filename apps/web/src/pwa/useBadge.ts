import { useEffect } from 'react';
import type { ApiClient } from '../shared/api/client.ts';
import { ForegroundPoller } from '../shared/api/polling.ts';
import { updateAppBadge } from './badge.ts';
export function useBadge(api: ApiClient, sessionId: string | undefined) {
  useEffect(() => {
    if (!sessionId || !('setAppBadge' in navigator)) return;
    const controller = new AbortController();
    const poller = new ForegroundPoller(async () => {
      try {
        const result = await api.request<{sessionId:string;unreadCount:number}>('/messages/summary', {signal:controller.signal});
        if (!controller.signal.aborted && result.sessionId === sessionId) await updateAppBadge(result.unreadCount);
        return true;
      } catch { return false; }
    }, () => document.visibilityState === 'visible' && navigator.onLine);
    poller.start();
    document.addEventListener('visibilitychange',poller.wake);
    window.addEventListener('online',poller.wake);
    window.addEventListener('simlink-reading-changed',poller.wake);
    return () => {
      controller.abort();poller.stop();
      document.removeEventListener('visibilitychange',poller.wake);
      window.removeEventListener('online',poller.wake);
      window.removeEventListener('simlink-reading-changed',poller.wake);
    };
  },[api,sessionId]);
}
