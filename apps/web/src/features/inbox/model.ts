import { mappingKey, simTitle, type Sim } from "../sims/api.ts";
import type { ReceivedMessage, ReadingState } from "./api.ts";
export const simKey = (m: ReceivedMessage) =>
  JSON.stringify([m.deviceId, m.simKey ?? m.subscriptionId]);
export const conversationKey = (m: ReceivedMessage) =>
  JSON.stringify([m.deviceId, m.simKey ?? m.subscriptionId, m.sender]);
export function simLabel(m: ReceivedMessage, sims: Sim[] = []) {
  const mapping = m.simKey && sims.find(s => s.deviceId === m.deviceId && s.simKey === m.simKey);
  if (mapping) return simTitle(mapping);
  return `设备 ${m.deviceId.slice(0, 8)} · ${m.subscriptionId === null ? "SIM 未知" : `订阅 ${m.subscriptionId}`}${m.simKey ? ` · ${m.simKey.slice(-4)}` : " · 未关联卡片"}`;
}
export function simTabs(messages: ReceivedMessage[], sims: Sim[]) {
  const labels = [...new Map([
    ...sims.filter(s => s.state === "active").map(s => [mappingKey(s), simTitle(s)] as const),
    ...messages.map(m => [simKey(m), simLabel(m, sims)] as const),
  ]).entries()];
  return labels.map(([key, label]) => {
    if (labels.filter(([, other]) => other === label).length === 1) return [key, label];
    const [device, mapping] = JSON.parse(key) as [string, string | number | null];
    return [key, `${label} · ${device.slice(0, 8)}/${String(mapping).slice(-4)}`];
  });
}
export function mergeMessages(
  previous: ReceivedMessage[],
  incoming: ReceivedMessage[],
) {
  const map = new Map(previous.map((m) => [m.sequence, m]));
  incoming.forEach((m) => {
    const old = map.get(m.sequence);
    map.set(m.sequence, old && old.readVersion > m.readVersion ? { ...m, isRead: old.isRead, readVersion: old.readVersion } : m);
  });
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

export function mergeReading(previous: Map<number, ReadingState>, incoming: ReadingState[]) {
  const next = new Map(previous);
  for (const state of incoming) {
    if ((next.get(state.sequence)?.readVersion ?? -1) <= state.readVersion) next.set(state.sequence, state);
  }
  return next;
}
export function applyReading(messages: ReceivedMessage[], states: Map<number, ReadingState>) {
  return messages.map(m => {
    const state = states.get(m.sequence);
    return state && state.readVersion >= m.readVersion ? { ...m, ...state } : m;
  });
}
