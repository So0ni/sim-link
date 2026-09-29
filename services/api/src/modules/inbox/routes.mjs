import { object, string } from "../../platform/errors.mjs";
export function registerInboxRoutes(app, { inbox, devices, sessions }) {
  app.post(
    "/api/v1/device/messages",
    {
      schema: {
        body: { ...object({
          eventId: string(128), sender: string(256), body: string(32768, 0),
          subscriptionId: { anyOf: [{ type: "integer", minimum: 0, maximum: 2147483647 }, { type: "null" }] },
          receivedAt: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
          simKey: { ...string(36, 36), pattern: "^[a-f0-9-]{36}$" },
        }), required: ["eventId", "sender", "body", "subscriptionId", "receivedAt"] },
      },
    },
    async (req) => {
      const raw = req.headers.authorization?.match(/^Bearer ([\w-]{43})$/)?.[1];
      const device = devices.authenticate(raw);
      const ack = inbox.receive(device, req.body);
      devices.heartbeat(device.id);
      return ack;
    },
  );
  app.get("/api/v1/messages", async (req) => {
    sessions.read(req);
    return inbox.list(req.query.after);
  });
}
