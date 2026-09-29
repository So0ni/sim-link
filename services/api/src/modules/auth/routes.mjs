import { csrf } from "../../platform/crypto.mjs";
import { object, string } from "../../platform/errors.mjs";
export function registerAuthRoutes(app, { auth, sessions, loginLimit }) {
  app.post(
    "/api/v1/auth/login",
    { schema: { body: object({ password: string(1024, 12) }) } },
    async (req, reply) => {
      sessions.checkOrigin(req);
      const raw = await loginLimit.verify(req.ip, () => auth.login(req.body.password, req.headers["user-agent"]));
      sessions.cookie(reply, raw);
      return { csrfToken: csrf(raw) };
    },
  );
  app.get("/api/v1/auth/session", async (req) => {
    const session = sessions.read(req);
    return {
      id: session.id,
      expiresAt: session.expires_at,
      csrfToken: csrf(session.raw),
    };
  });
  app.post("/api/v1/auth/resume", async (req, reply) => {
    const session = sessions.write(req);
    if (auth.resume(session, req.headers["user-agent"])) sessions.cookie(reply, session.raw);
    return { ok: true };
  });
  app.post("/api/v1/auth/logout", async (req, reply) => {
    auth.logout(sessions.write(req));
    sessions.cookie(reply, "", 0);
    return { ok: true };
  });
  app.get("/api/v1/auth/sessions", async (req) => {
    const current = sessions.read(req);
    return { sessions: auth.list(current.id) };
  });
  app.delete("/api/v1/auth/sessions/:id", async (req) => {
    sessions.write(req);
    auth.revoke(req.params.id);
    return { ok: true };
  });
}
