import { string, object } from "../../platform/errors.mjs";
export function registerDeviceRoutes(app, { devices, sessions, rate }) {
  app.post("/api/v1/pairings", async (req) => {
    sessions.write(req);
    rate("pairing-create", 10);
    return devices.invite();
  });
  app.post(
    "/api/v1/device/pair",
    {
      schema: {
        body: object({
          pairingToken: string(43, 43),
          name: string(80),
          apiVersion: { const: 1, type: "integer" },
        }),
      },
    },
    async (req) => {
      rate("pairing-attempt", 20);
      return devices.pair(req.body);
    },
  );
  app.get("/api/v1/devices", async (req) => {
    sessions.read(req);
    return { devices: devices.list() };
  });
  app.delete("/api/v1/devices/:id", async (req) => {
    sessions.write(req);
    devices.revoke(req.params.id);
    return { ok: true };
  });
}
