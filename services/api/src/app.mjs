import { createPushService } from './modules/push/service.mjs';
import { registerPushRoutes } from './modules/push/routes.mjs';
import Fastify from "fastify";
import { resolve, join } from "node:path";
import { accessSync } from "node:fs";
import { openStore } from "./platform/store.mjs";
import { configureHttp } from "./platform/http.mjs";
import { createRateLimit } from "./platform/rate-limit.mjs";
import { createAuthService } from "./modules/auth/service.mjs";
import { createSessionPolicy } from "./modules/auth/http-policy.mjs";
import { registerAuthRoutes } from "./modules/auth/routes.mjs";
import { createDeviceService } from "./modules/devices/service.mjs";
import { registerDeviceRoutes } from "./modules/devices/routes.mjs";
import { createInboxService } from "./modules/inbox/service.mjs";
import { registerInboxRoutes } from "./modules/inbox/routes.mjs";

import { createSimService } from "./modules/sims/service.mjs";
import { registerSimRoutes } from "./modules/sims/routes.mjs";

import { createCommandService } from './modules/commands/service.mjs';
import { registerCommandRoutes } from './modules/commands/routes.mjs';

// Composition root: lifecycle and wiring only. Business modules do not import this file.
export function createApp({
  database = ":memory:",
  origin = "https://localhost",
  insecureLocal = false,
  insecureHttp = false,
  webRoot,
  now = Date.now,
  pushSender,
} = {}) {
  const url = new URL(origin);
  if (url.origin !== origin || url.username || url.password)
    throw new Error("PUBLIC_ORIGIN must be an origin without a trailing slash");
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      (insecureHttp ||
        (insecureLocal &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
    )
  ) {
    throw new Error(
      "HTTPS is required unless HTTP development is explicitly enabled",
    );
  }
  const staticRoot = webRoot ? resolve(webRoot) : null;
  if (staticRoot) accessSync(join(staticRoot, "index.html"));
  const db = openStore(database);
  const app = Fastify({
    logger: false,
    bodyLimit: 128 * 1024,
    trustProxy: false,
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false } },
  });
  app.decorate("store", db);

  configureHttp(app, staticRoot);
  const auth = createAuthService(db, now);
  const push = createPushService(db, now, origin, pushSender);
  const dependencies = {
    push,
    auth,
    sessions: createSessionPolicy(auth, origin),
    rate: createRateLimit(db, now),
    devices: createDeviceService(db, now, origin),
    inbox: createInboxService(db, now, push.enqueueMessage),
    sims: createSimService(db, now),
    commands: createCommandService(db, now),
  };
  let expiryTimer, pushTimer;
  app.addHook("onReady", async () => {
    dependencies.commands.expire();
    expiryTimer = setInterval(() => dependencies.commands.expire(), 30000);
    expiryTimer.unref();
    pushTimer = setInterval(() => { void push.drain().catch(() => app.log.error('Push queue processing failed')); }, 5000);
    pushTimer.unref();
  });
  app.addHook("onClose", async () => { clearInterval(expiryTimer); clearInterval(pushTimer); await push.stop(); db.close(); });
  registerPushRoutes(app, dependencies);
  registerAuthRoutes(app, dependencies);
  registerDeviceRoutes(app, dependencies);
  registerInboxRoutes(app, dependencies);
  registerSimRoutes(app, dependencies);
  registerCommandRoutes(app, dependencies);
  app.get("/healthz", async () => {
    db.prepare("SELECT 1").get();
    return { status: "ok" };
  });
  app.get("/.well-known/sim-gateway", async () => ({
    name: "SIMLink",
    apiVersion: 1,
    serverVersion: "0.1.0",
    serverId: dependencies.devices.serverId,
    capabilities: ["sms.receive", "device.heartbeat", "device.unpair", "sim.inventory", "device.identity", "sms.send.v1"],
  }));
  return app;
}
