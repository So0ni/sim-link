import type { ApiClient } from "../../shared/api/client.ts";
export type Sim = {
  id: string; deviceId: string; simKey: string; subscriptionId: number;
  slotIndex: number; carrier: string; name: string; phoneNumber: string;
  state: "active" | "inactive" | "unknown" | "detached"; reportedAt: number;
};
export const listSims = (api: ApiClient, signal?: AbortSignal) => api.request<{ sims: Sim[] }>("/sims", { signal });
export const updateSim = (api: ApiClient, id: string, name: string, phoneNumber: string) =>
  api.request(`/sims/${encodeURIComponent(id)}`, { method: "PATCH", body: { name, phoneNumber } });
export const simTitle = (sim: Sim) => [sim.name, sim.phoneNumber].filter(Boolean).join(" · ") ||
  `${sim.carrier || "SIM"} · 卡槽 ${sim.slotIndex + 1}`;
export const mappingKey = (sim: Sim) => JSON.stringify([sim.deviceId, sim.simKey]);
