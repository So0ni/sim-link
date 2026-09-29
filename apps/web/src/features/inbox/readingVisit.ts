import type { ReceivedMessage } from "./api.ts";

// Tracks a detail visit, not a server read state. A remote unread update must
// never trigger an automatic read loop in another browser already viewing it.
export class ReadingVisit {
  private seen = new Set<number>();
  private suppressed = false;
  suppress() { this.suppressed = true; }
  collect(visibleMessages: ReceivedMessage[], foreground: boolean, busy: boolean) {
    if (!foreground || busy || this.suppressed) return [];
    const fresh = visibleMessages.filter(m => !this.seen.has(m.sequence));
    fresh.forEach(m => this.seen.add(m.sequence));
    return fresh.filter(m => !m.isRead);
  }
}
