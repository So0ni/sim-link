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
        body: { ...object({
          pairingToken: string(43, 43),
          name: string(80),
          apiVersion: { const: 1, type: "integer" },
          installationId: { ...string(36, 36), pattern: "^[a-f0-9-]{36}$" },
        }), required: ["pairingToken", "name", "apiVersion"] },
      },
    },
    async (req) => {
      rate("pairing-attempt", 20);
      return devices.pair(req.body);
    },
  );
  const authenticatedDevice = req => devices.authenticate(req.headers.authorization?.match(/^Bearer ([\w-]{43})$/)?.[1]);
  app.post("/api/v1/device/identity", { schema: { body: { ...object({
    installationId: { ...string(36, 36), pattern: "^[a-f0-9-]{36}$" },
    deviceId: string(128), serverId: string(36, 36),
  }), required: ["installationId", "deviceId"] } } }, async req => devices.identity(authenticatedDevice(req), req.body));
  app.get("/api/v1/devices/recoverable", async req => { sessions.read(req); return { devices: devices.recoverable() }; });
  app.post("/api/v1/devices/:id/pairing", async req => {
    sessions.write(req); rate("pairing-create", 10); return devices.invite(req.params.id);
  });
  app.post("/api/v1/device/heartbeat", { schema: { body: object({}) } }, async req => {
    return devices.heartbeat(authenticatedDevice(req).id);
  });
  app.post("/api/v1/device/unpair", { schema: { body: object({}) } }, async req => {
    devices.revoke(authenticatedDevice(req).id);
    return { ok: true };
  });
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
