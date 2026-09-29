import { createApp } from "./app.mjs";
process.umask(0o077);
const app = createApp({
  database: process.env.DATABASE_PATH ?? "./data/simlink.sqlite",
  webRoot: process.env.WEB_ROOT,
  origin: process.env.PUBLIC_ORIGIN ?? "https://localhost",
  insecureLocal: process.env.ALLOW_INSECURE_LOCAL === "1",
  insecureHttp: process.env.ALLOW_INSECURE_HTTP === "1",
});
const close = async () => {
  await app.close();
  process.exit(0);
};
process.on("SIGTERM", close);
process.on("SIGINT", close);
await app.listen({
  host: process.env.HOST ?? "127.0.0.1",
  port: Number(process.env.PORT ?? 8787),
});
console.info("SIMLink API listening");
