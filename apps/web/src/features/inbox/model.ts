import type { ReceivedMessage } from "./api.ts";
export const simKey = (m: ReceivedMessage) =>
  JSON.stringify([m.deviceId, m.subscriptionId]);
export const conversationKey = (m: ReceivedMessage) =>
  JSON.stringify([m.deviceId, m.subscriptionId, m.sender]);
export const simLabel = (m: ReceivedMessage) =>
  `设备 ${m.deviceId.slice(0, 8)} · ${m.subscriptionId === null ? "SIM 未知" : `订阅 ${m.subscriptionId}`}`;
export function mergeMessages(
  previous: ReceivedMessage[],
  incoming: ReceivedMessage[],
) {
  const map = new Map(previous.map((m) => [m.sequence, m]));
  incoming.forEach((m) => map.set(m.sequence, m));
  return [...map.values()].sort((a, b) => a.sequence - b.sequence);
}
export function conversations(messages: ReceivedMessage[]) {
  const grouped = new Map<string, ReceivedMessage[]>();
  messages.forEach((m) => {
    const key = conversationKey(m);
    grouped.set(key, [...(grouped.get(key) ?? []), m]);
  });
  return [...grouped]
    .map(([id, items]) => ({
      id,
      messages: items.sort(
        (a, b) => a.receivedAt - b.receivedAt || a.sequence - b.sequence,
      ),
    }))
    .sort(
      (a, b) =>
        b.messages.at(-1)!.receivedAt - a.messages.at(-1)!.receivedAt ||
        b.messages.at(-1)!.sequence - a.messages.at(-1)!.sequence,
    );
}
