import { useCallback, useEffect, useRef, useState } from "react";
import { errorText, type ApiClient } from "../../shared/api/client.ts";
import { getMessages, type ReceivedMessage } from "./api.ts";
import { ForegroundPoller } from "../../shared/api/polling.ts";
import { listSims, type Sim } from "../sims/api.ts";
import { mergeMessages } from "./model.ts";
export function useInbox(api: ApiClient) {
  const [sims, setSims] = useState<Sim[]>([]);
  const [messages, setMessages] = useState<ReceivedMessage[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const cursor = useRef("0");
  const active = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    if (active.current) return true;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    try {
      // Bound each refresh; additional historical pages continue on the next refresh.
      for (let i = 0; i < 20; i++) {
        const page = await getMessages(api, cursor.current, controller.signal);
        if (controller.signal.aborted) return false;
        setMessages((old) => mergeMessages(old, page.messages));
        cursor.current = page.nextCursor;
        if (page.messages.length < 100) break;
      }
      const inventory = await listSims(api, controller.signal);
      if (controller.signal.aborted) return false;
      setSims(inventory.sims);
      setError("");
      setUpdatedAt(Date.now());
      return true;
    } catch (err) {
      if (!controller.signal.aborted) setError(errorText(err));
      return false;
    } finally {
      if (active.current === controller) {
        active.current = null;
        if (!controller.signal.aborted) setBusy(false);
      }
    }
  }, [api]);
  useEffect(() => {
    const poller = new ForegroundPoller(refresh, () => document.visibilityState === "visible" && navigator.onLine);
    poller.start();
    document.addEventListener("visibilitychange", poller.wake);
    window.addEventListener("online", poller.wake);
    window.addEventListener("offline", poller.wake);
    return () => {
      poller.stop();
      document.removeEventListener("visibilitychange", poller.wake);
      window.removeEventListener("online", poller.wake);
      window.removeEventListener("offline", poller.wake);
      active.current?.abort();
      active.current = null;
    };
  }, [refresh]);
  return { messages, sims, error, busy, updatedAt, refresh };
}
