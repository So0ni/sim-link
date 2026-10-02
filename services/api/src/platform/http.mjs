import fastifyStatic from "@fastify/static";
export function configureHttp(app, staticRoot) {
  app.addHook("onRequest", async (_req, reply) => {
    reply
      .header("Cache-Control", "no-store")
      .header("X-Content-Type-Options", "nosniff");
  });
  app.setErrorHandler((error, _req, reply) => {
    const status = error.validation
      ? 400
      : (error.statusCode >= 400 && error.statusCode < 500) || error.statusCode === 503
        ? error.statusCode
        : 500;
    if (status === 429 && Number.isFinite(error.retryAfter)) reply.header("Retry-After", String(error.retryAfter));
    reply
      .code(status)
      .send({
        error:
          status === 500
            ? "internal_error"
            : status === 503
              ? "service_unavailable"
              : error.validation
                ? "invalid_request"
                : error.message,
      });
  });
  if (staticRoot) {
    app.register(fastifyStatic, {
      root: staticRoot,
      cacheControl: false,
      dotfiles: "deny",
    });
    app.setNotFoundHandler((req, reply) => {
      let path;
      try {
        path = decodeURIComponent(req.url.split("?")[0]);
      } catch {
        return reply.code(400).send({ error: "invalid_path" });
      }
      // Only browser page navigation falls back to the SPA. API and missing assets stay errors.
      const reserved =
        /^\/(api|assets|healthz)(\/|$)/.test(path) || path.includes(".");
      if (
        ["GET", "HEAD"].includes(req.method) &&
        !reserved &&
        req.headers.accept?.includes("text/html")
      ) {
        return reply.sendFile("index.html");
      }
      return reply.code(404).send({ error: "not_found" });
    });
  }
}
