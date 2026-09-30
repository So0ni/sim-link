import { useLayoutEffect, useRef, type RefObject } from "react";

/** Open at the latest message; only follow updates while the reader stays near the end. */
export function useConversationScroll(
  root: RefObject<HTMLDivElement | null>,
  selected: string | undefined,
  count: number,
  lastSequence: number | string | undefined,
) {
  const following = useRef(true);
  useLayoutEffect(() => {
    following.current = true;
    const element = root.current;
    if (!element || !selected) return;
    element.scrollTop = element.scrollHeight;
    const onScroll = () => {
      following.current = element.scrollHeight - element.clientHeight - element.scrollTop <= 48;
    };
    element.addEventListener("scroll", onScroll, { passive: true });
    // Keep the latest message visible when the viewport or wrapped text changes size.
    const observer = new ResizeObserver(() => {
      if (following.current) element.scrollTop = element.scrollHeight;
    });
    observer.observe(element);
    const content = element.querySelector(".messages");
    if (content) observer.observe(content);
    return () => { element.removeEventListener("scroll", onScroll); observer.disconnect(); };
  }, [root, selected]);

  // Layout effect precedes visibility-based read marking, avoiding marking the old top first.
  useLayoutEffect(() => {
    if (following.current && root.current) root.current.scrollTop = root.current.scrollHeight;
  }, [root, selected, count, lastSequence]);
}
