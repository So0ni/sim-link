import { openStore } from "./platform/store.mjs";
import { initializeAdmin } from "./modules/auth/credentials.mjs";
process.umask(0o077);
// stdin avoids passwords in command arguments, process listings and Compose config.
let input = "";
for await (const chunk of process.stdin) {
  input += chunk;
  if (Buffer.byteLength(input) > 4096)
    throw new Error("Password input too long");
}
const db = openStore(process.env.DATABASE_PATH ?? "./data/simlink.sqlite");
try {
  if (db.prepare("SELECT id FROM admin").get())
    throw new Error("Administrator already initialized");
  await initializeAdmin(db, input.replace(/\r?\n$/, ""));
  console.info("Administrator initialized");
} finally {
  db.close();
}
