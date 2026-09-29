import { object, string } from "../../platform/errors.mjs";
export function registerSimRoutes(app, { sims, devices, sessions }) {
  app.post("/api/v1/device/sims", { schema: { body: object({
    status: { type: "string", enum: ["available", "permission_required", "unavailable"] },
    sims: { type: "array", maxItems: 16, items: object({
      key: { ...string(36, 36), pattern: "^[a-f0-9-]{36}$" },
      subscriptionId: { type: "integer", minimum: 0, maximum: 2147483647 },
      slotIndex: { type: "integer", minimum: 0, maximum: 255 },
      carrier: string(80, 0),
    }) },
  }) } }, async req => {
    const device = devices.authenticate(req.headers.authorization?.match(/^Bearer ([\w-]{43})$/)?.[1]);
    return sims.report(device.id, req.body);
  });
  app.get("/api/v1/sims", async req => { sessions.read(req); return { sims: sims.list() }; });
  app.patch("/api/v1/sims/:id", { schema: { body: object({ name: string(40, 0), phoneNumber: string(32, 0) }) } }, async req => {
    sessions.write(req); return sims.rename(req.params.id, req.body.name, req.body.phoneNumber);
  });
}
