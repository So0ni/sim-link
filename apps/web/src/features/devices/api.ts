import type { ApiClient } from "../../shared/api/client.ts";
export type Device = {
  id: string;
  name: string;
  createdAt: number;
  revokedAt: number | null;
  lastSeenAt?: number | null;
  presence?: "online" | "offline" | "unknown";
  serverTime?: number;
};
export type Pairing = {
  pairingToken: string;
  expiresAt: number;
  server: string;
  apiVersion: number;
};
export const listDevices = (api: ApiClient, signal?: AbortSignal) =>
  api.request<{ devices: Device[] }>("/devices", { signal });
export const createPairing = (api: ApiClient) =>
  api.request<Pairing>("/pairings", { method: "POST" });
export const revokeDevice = (api: ApiClient, id: string) =>
  api.request(`/devices/${encodeURIComponent(id)}`, { method: "DELETE" });
