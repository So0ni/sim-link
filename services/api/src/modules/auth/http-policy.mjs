import { csrf } from "../../platform/crypto.mjs";
import { fail } from "../../platform/errors.mjs";
export function createSessionPolicy(auth, origin) {
  const secure = origin.startsWith("https:");
  const cookieName = secure ? "__Host-simlink" : "simlink-local";
  const checkOrigin = (req) => {
    if (req.headers.origin !== origin) fail(403, "origin_rejected");
  };
  const read = (req) => {
    const raw = req.headers.cookie
      ?.split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith(`${cookieName}=`))
      ?.slice(cookieName.length + 1);
    return auth.read(raw);
  };
  return {
    checkOrigin,
    read,
    write(req) {
      checkOrigin(req);
      const session = read(req);
      if (req.headers["x-csrf-token"] !== csrf(session.raw))
        fail(403, "csrf_rejected");
      return session;
    },
    cookie(reply, raw, age = 90 * 86400) {
      reply.header(
        "Set-Cookie",
        `${cookieName}=${raw}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure ? "; Secure" : ""}`,
      );
    },
  };
}
