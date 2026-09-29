import { timingSafeEqual } from "node:crypto";
import { token, passwordHash } from "../../platform/crypto.mjs";
export async function initializeAdmin(db, password) {
  if (
    typeof password !== "string" ||
    password.length < 12 ||
    password.length > 1024
  )
    throw new Error("Password must contain 12–1024 characters");
  const salt = token();
  const digest = await passwordHash(password, salt);
  db.prepare("INSERT INTO admin VALUES (1, ?, ?)").run(
    salt,
    digest.toString("hex"),
  );
}
export async function verifyPassword(admin, password) {
  const actual = await passwordHash(password, admin?.salt ?? "uninitialized");
  return (
    admin != null &&
    timingSafeEqual(actual, Buffer.from(admin.password_hash, "hex"))
  );
}
