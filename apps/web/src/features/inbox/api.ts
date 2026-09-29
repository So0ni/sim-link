import type { ApiClient } from "../../shared/api/client.ts";
export type ReceivedMessage = {
  sequence: number;
  isRead: boolean;
  readVersion: number;
  deviceId: string;
  eventId: string;
  sender: string;
  body: string;
  subscriptionId: number | null;
  simKey?: string | null;
  receivedAt: number;
  syncedAt: number;
};
export type MessagePage = { messages: ReceivedMessage[]; nextCursor: string };
export const getMessages = (
  api: ApiClient,
  cursor: string,
  signal: AbortSignal,
) =>
  api.request<MessagePage>(`/messages?after=${encodeURIComponent(cursor)}`, {
    signal,
  });

export type ReadingState = Pick<ReceivedMessage, "sequence" | "isRead" | "readVersion">;
export type ReadingPage = { states: ReadingState[]; nextCursor: string };
export const getReading = (api: ApiClient, cursor: string, signal: AbortSignal) =>
  api.request<ReadingPage>(`/messages/reading?after=${encodeURIComponent(cursor)}`, { signal });
export const setReading = (api: ApiClient, messages: ReadingState[], isRead: boolean, signal: AbortSignal) =>
  api.request<{ states: ReadingState[]; conflicts: number[] }>("/messages/reading", {
    method: "PATCH", body: { isRead, messages: messages.map(({ sequence, readVersion }) => ({ sequence, readVersion })) }, signal,
  });
