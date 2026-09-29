import { object, string } from "../../platform/errors.mjs";
export function registerInboxRoutes(app, { inbox, devices, sessions }) {
  app.post(
    "/api/v1/device/messages",
    {
      schema: {
        body: object({
          eventId: string(128),
          sender: string(256),
          body: string(32768, 0),
          subscriptionId: {
            anyOf: [
              { type: "integer", minimum: 0, maximum: 2147483647 },
              { type: "null" },
            ],
          },
          receivedAt: {
            type: "integer",
            minimum: 0,
            maximum: Number.MAX_SAFE_INTEGER,
          },
        }),
      },
    },
    async (req) => {
      const raw = req.headers.authorization?.match(/^Bearer ([\w-]{43})$/)?.[1];
      return inbox.receive(devices.authenticate(raw), req.body);
    },
  );
  app.get("/api/v1/messages", async (req) => {
    sessions.read(req);
    return inbox.list(req.query.after);
  });
}
