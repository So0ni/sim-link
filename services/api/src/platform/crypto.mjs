import { randomBytes, createHash, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
const scrypt = promisify(scryptCallback);
export const token = () => randomBytes(32).toString("base64url");
export const hash = (value) => createHash("sha256").update(value).digest("hex");
export const csrf = (value) => hash(`simlink-csrf:${value}`);
export async function passwordHash(password, salt) {
  return scrypt(password, salt, 64, {
    N: 32768,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024,
  });
}
