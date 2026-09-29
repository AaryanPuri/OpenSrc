/**
 * The optional database (libSQL: a Turso database over HTTP on Workers, a local file or
 * `:memory:` on Node). Login, saved items and the newsletter need it; without
 * DATABASE_URL those features are switched off.
 *
 * This module only imports the `/web` client (plain fetch), so the Worker bundle stays
 * small. The Node entry (node.ts) and the CLIs build a full client with db/node.ts
 * (which also opens `file:` URLs) and inject it through `createApp({ db })`.
 */
import type { Client, InValue } from "@libsql/client/web";
import { MIGRATIONS } from "./migrations/index.js";

export type Db = Client;
export type { InValue };

let cached: { key: string; client: Promise<Db> } | null = null;

/** Workers: one HTTP client per isolate, built on first use from the bindings. */
export function webDbFromEnv(url: string, authToken: string | undefined): Promise<Db> {
  const key = `${url}\n${authToken ?? ""}`;
  if (cached?.key === key) return cached.client;
  if (url.startsWith("file:") || url === ":memory:") {
    throw new Error(
      "DATABASE_URL: a file database needs the Node server (the Worker only reaches libsql:// or https://)",
    );
  }
  const client = import("@libsql/client/web").then(({ createClient }) => createClient({ url, authToken }));
  cached = { key, client };
  return client;
}

/** Applies every migration not yet recorded in `_migrations`. Safe to run concurrently and repeatedly. */
export async function migrate(db: Db, log: (msg: string) => void = () => {}): Promise<string[]> {
  await db.execute(`CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);
  const done = new Set((await db.execute("SELECT id FROM _migrations")).rows.map((r) => String(r.id)));
  const applied: string[] = [];
  for (const m of MIGRATIONS) {
    if (done.has(m.id)) continue;
    await db.batch(
      [
        ...m.statements,
        {
          sql: "INSERT OR IGNORE INTO _migrations (id, applied_at) VALUES (?, ?)",
          args: [m.id, new Date().toISOString()],
        },
      ],
      "write",
    );
    applied.push(m.id);
    log(`applied migration ${m.id}`);
  }
  return applied;
}

const migrated = new WeakMap<Db, Promise<unknown>>();

/**
 * Runs the migrations once per client (so once per Worker isolate), before the first
 * query. A failure is forgotten, so the next request tries again.
 */
export function ensureMigrated(db: Db): Promise<unknown> {
  let p = migrated.get(db);
  if (!p) {
    p = migrate(db).catch((err) => {
      migrated.delete(db);
      throw err;
    });
    migrated.set(db, p);
  }
  return p;
}

/** Current time as stored in the database (ISO 8601, UTC). */
export const nowIso = (now = Date.now()) => new Date(now).toISOString();
