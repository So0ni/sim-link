import { useCallback, useEffect, useRef, useState } from "react";
import { errorText, type ApiClient } from "../../shared/api/client.ts";
import { getMessages, type ReceivedMessage } from "./api.ts";
import { mergeMessages } from "./model.ts";
export function useInbox(api: ApiClient) {
  const [messages, setMessages] = useState<ReceivedMessage[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const cursor = useRef("0");
  const active = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    try {
      // Bound each refresh; additional historical pages continue on the next refresh.
      for (let i = 0; i < 20; i++) {
        const page = await getMessages(api, cursor.current, controller.signal);
        if (controller.signal.aborted) return;
        setMessages((old) => mergeMessages(old, page.messages));
        cursor.current = page.nextCursor;
        if (page.messages.length < 100) break;
      }
      setError("");
      setUpdatedAt(Date.now());
    } catch (err) {
      if (!controller.signal.aborted) setError(errorText(err));
    } finally {
      if (active.current === controller) {
        active.current = null;
        if (!controller.signal.aborted) setBusy(false);
      }
    }
  }, [api]);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh();
    }, 15000);
    return () => {
      clearInterval(timer);
      active.current?.abort();
      active.current = null;
    };
  }, [refresh]);
  return { messages, error, busy, updatedAt, refresh };
}
