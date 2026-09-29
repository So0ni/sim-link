import { useEffect, useRef } from "react";
import { ReadingVisit } from "./readingVisit.ts";
import type { ReceivedMessage } from "./api.ts";

// One attempt per visible message per detail visit. Remote/manual unread changes
// remain unread until the user leaves and reopens the conversation (or retries).
export function useVisibleReading(
  selected: string | undefined,
  messages: ReceivedMessage[],
  busy: boolean,
  mark: (messages: ReceivedMessage[], isRead: boolean) => Promise<boolean>,
) {
  const root = useRef<HTMLDivElement>(null);
  const visit = useRef(new ReadingVisit());
  useEffect(() => {
    visit.current = new ReadingVisit();
  }, [selected]);
  useEffect(() => {
    const element = root.current;
    if (!element || !selected) return;
    const inspect = () => {
      if (document.visibilityState !== "visible" || busy) return;
      const bounds = element.getBoundingClientRect();
      const visible = messages.filter(m => {
        const node = element.querySelector(`[data-sequence="${m.sequence}"]`);
        if (!node) return false;
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.bottom > Math.max(bounds.top, 0) && rect.top < Math.min(bounds.bottom, window.innerHeight);
      });
      const unread = visit.current.collect(visible, document.visibilityState === "visible", busy);
      if (unread.length) void mark(unread, true);
    };
    const observer = new IntersectionObserver(inspect, { root: element });
    element.querySelectorAll("[data-sequence]").forEach(node => observer.observe(node));
    document.addEventListener("visibilitychange", inspect);
    const frame = requestAnimationFrame(inspect);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("visibilitychange", inspect);
    };
  }, [selected, messages, busy, mark]);
  return { root, suppress: () => { visit.current.suppress(); } };
}
