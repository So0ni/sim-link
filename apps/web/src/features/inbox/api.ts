import type { ApiClient } from "../../shared/api/client.ts";
export type ReceivedMessage = {
  sequence: number;
  deviceId: string;
  eventId: string;
  sender: string;
  body: string;
  subscriptionId: number | null;
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
