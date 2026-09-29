/**
 * `npm run db:migrate` (from backend/): applies pending migrations to DATABASE_URL
 * (with DATABASE_AUTH_TOKEN for Turso). Reads backend/.env like the server does.
 *
 * The API also migrates lazily on its first database query, so this is optional, but
 * running it before a deploy surfaces a bad URL or token early.
 */
import { envFromProcess, loadDotEnv } from "../nodeEnv.js";
import { migrate } from "./index.js";
import { nodeDb } from "./node.js";

loadDotEnv();
const env = envFromProcess();
if (!env.DATABASE_URL) {
  console.error("db:migrate: set DATABASE_URL (e.g. file:.data/opensrc.db or libsql://<db>.turso.io).");
  process.exit(1);
}
const db = nodeDb(env.DATABASE_URL, env.DATABASE_AUTH_TOKEN);
try {
  const applied = await migrate(db, (m) => console.log(`db:migrate: ${m}`));
  console.log(applied.length ? `db:migrate: done (${applied.length} applied)` : "db:migrate: already up to date");
} finally {
  db.close();
}
