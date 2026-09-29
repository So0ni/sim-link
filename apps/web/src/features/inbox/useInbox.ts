import { useCallback, useEffect, useRef, useState } from "react";
import { errorText, type ApiClient } from "../../shared/api/client.ts";
import { getMessages, getReading, setReading, type ReadingState, type ReceivedMessage } from "./api.ts";
import { ForegroundPoller } from "../../shared/api/polling.ts";
import { listSims, type Sim } from "../sims/api.ts";
import { applyReading, mergeReading, mergeMessages } from "./model.ts";
export function useInbox(api: ApiClient) {
  const cached=api.views.get<{sims:Sim[];messages:ReceivedMessage[];updatedAt:number}>("inbox");
  const [sims, setSims] = useState<Sim[]>(cached?.sims??[]);
  const [messages, setMessages] = useState<ReceivedMessage[]>(cached?.messages??[]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<number | null>(cached?.updatedAt??null);
  const [readingError, setReadingError] = useState("");
  const [readingBusy, setReadingBusy] = useState(false);
  const states = useRef(new Map<number, ReadingState>());
  const readingCursor = useRef("0");
  const writing = useRef<AbortController | null>(null);
  const acceptStates = useCallback((incoming: ReadingState[]) => {
    states.current = mergeReading(states.current, incoming);
    setMessages(old => applyReading(old, states.current));
  }, []);
  const markReading = useCallback(async (items: ReceivedMessage[], isRead: boolean) => {
    if (writing.current || !items.length) return false;
    const controller = new AbortController();
    writing.current = controller;
    setReadingBusy(true);
    setReadingError("");
    try {
      for (let i = 0; i < items.length; i += 100) {
        const result = await setReading(api, items.slice(i, i + 100), isRead, controller.signal);
        if (controller.signal.aborted) return false;
        acceptStates(result.states);
        if (result.conflicts.length) {
          setReadingError("阅读状态已在其他页面改变，已保留最新结果。请确认后重试。");
          return false;
        }
      }
      return true;
    } catch (err) {
      if (!controller.signal.aborted) setReadingError(`${errorText(err)} 阅读状态未确认，请重试。`);
      return false;
    } finally {
      if (writing.current === controller) {
        writing.current = null;
        if (!controller.signal.aborted) setReadingBusy(false);
      }
    }
  }, [api, acceptStates]);
  const cursor = useRef("0");
  const active = useRef<AbortController | null>(null);
  const pending = useRef<Promise<boolean> | null>(null);
  const refresh = useCallback(():Promise<boolean> => {
    if (pending.current) return pending.current;
    const run = async () => {
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    try {
      // Bound each refresh; additional historical pages continue on the next refresh.
      for (let i = 0; i < 20; i++) {
        const page = await getMessages(api, cursor.current, controller.signal);
        if (controller.signal.aborted) return false;
        setMessages((old) => applyReading(mergeMessages(old, page.messages), states.current));
        cursor.current = page.nextCursor;
        if (page.messages.length < 100) break;
      }
      for (let i = 0; i < 20; i++) {
        const page = await getReading(api, readingCursor.current, controller.signal);
        if (controller.signal.aborted) return false;
        acceptStates(page.states);
        readingCursor.current = page.nextCursor;
        if (page.states.length < 100) break;
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
    };
    const task=run(); pending.current=task;
    void task.finally(()=>{if(pending.current===task)pending.current=null;});
    return task;
  }, [api, acceptStates]);
  useEffect(() => {
    if(updatedAt)api.views.set("inbox",{sims,messages,updatedAt});
  },[api,sims,messages,updatedAt]);
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
      writing.current?.abort();
      writing.current = null;
      active.current?.abort();
      active.current = null;
      pending.current = null;
    };
  }, [refresh]);
  return { markReading, readingBusy, readingError, messages, sims, error, busy, updatedAt, refresh };
}
