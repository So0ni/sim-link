import type { Pairing } from "./api.ts";

// A structured payload, never a URL: credentials stay out of browser history and access logs.
export function pairingPayload(pairing: Pairing): string {
  return JSON.stringify({
    type: "simlink.pairing",
    version: 1,
    server: pairing.server,
    pairingToken: pairing.pairingToken,
    expiresAt: pairing.expiresAt,
    apiVersion: pairing.apiVersion,
  });
}
