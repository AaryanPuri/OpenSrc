/**
 * Saved items for signed-in users: repos, issues and searches, each stored as the
 * frontend's own JSON (the payload) under a key.
 *
 *   GET    /api/saved                 { items: [{ kind, key, payload, savedAt }] }, newest first
 *   PUT    /api/saved/:kind/:key      body: the payload (JSON object, ≤ 8 KB)
 *   DELETE /api/saved/:kind/:key
 *   POST   /api/saved/import          { items: [{ kind, key, payload }] } (≤ 500), existing keys are kept
 */
import type { Hono } from "hono";
import { requireUser } from "../auth/routes.js";
import type { AppEnv, Deps } from "../context.js";
import { nowIso, type Db } from "../db/index.js";

export const SAVED_KINDS = ["issue", "repo", "search"] as const;
export type SavedKind = (typeof SAVED_KINDS)[number];
export const MAX_PAYLOAD_BYTES = 8 * 1024;
export const MAX_KEY_LENGTH = 512;
export const MAX_IMPORT_ITEMS = 500;
export const MAX_SAVED_PER_USER = 3000;

const byteLength = (s: string) => new TextEncoder().encode(s).length;
const isKind = (k: unknown): k is SavedKind => SAVED_KINDS.includes(k as SavedKind);
const validKey = (k: unknown): k is string => typeof k === "string" && k.length > 0 && k.length <= MAX_KEY_LENGTH;

/** The payload's own savedAt when it is a valid date, else now. */
function savedAtOf(payload: Record<string, unknown>, now: number): string {
  const t = typeof payload.savedAt === "string" ? Date.parse(payload.savedAt) : NaN;
  return Number.isFinite(t) && t <= now + 60_000 ? new Date(t).toISOString() : nowIso(now);
}

/** A JSON object of at most 8 KB, or null. */
function parsePayload(text: string): Record<string, unknown> | null {
  if (byteLength(text) > MAX_PAYLOAD_BYTES) return null;
  try {
    const v = JSON.parse(text) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function countSaved(db: Db, userId: number): Promise<number> {
  const rs = await db.execute({ sql: "SELECT COUNT(*) AS n FROM saved WHERE user_id = ?", args: [userId] });
  return Number(rs.rows[0]?.n ?? 0);
}

export function registerSaved(app: Hono<AppEnv>, deps: Deps): void {
  app.get("/api/saved", async (c) => {
    const r = await requireUser(c, deps);
    if (r instanceof Response) return r;
    c.header("Cache-Control", "no-store");
    const rs = await r.db.execute({
      sql: "SELECT kind, key, payload, saved_at FROM saved WHERE user_id = ? ORDER BY saved_at DESC, key",
      args: [r.user.id],
    });
    const items = rs.rows.map((row) => ({
      kind: String(row.kind),
      key: String(row.key),
      payload: JSON.parse(String(row.payload)) as unknown,
      savedAt: String(row.saved_at),
    }));
    return c.json({ items });
  });

  app.put("/api/saved/:kind/:key{.+}", async (c) => {
    const r = await requireUser(c, deps);
    if (r instanceof Response) return r;
    const kind = c.req.param("kind");
    const key = c.req.param("key");
    if (!isKind(kind) || !validKey(key)) return c.json({ error: "unknown kind or bad key" }, 400);
    const text = await c.req.text();
    if (byteLength(text) > MAX_PAYLOAD_BYTES) return c.json({ error: "payload over 8 KB" }, 413);
    const payload = parsePayload(text);
    if (!payload) return c.json({ error: "payload must be a JSON object" }, 400);

    const exists = await r.db.execute({
      sql: "SELECT 1 FROM saved WHERE user_id = ? AND kind = ? AND key = ?",
      args: [r.user.id, kind, key],
    });
    if (!exists.rows.length && (await countSaved(r.db, r.user.id)) >= MAX_SAVED_PER_USER) {
      return c.json({ error: `at most ${MAX_SAVED_PER_USER} saved items` }, 409);
    }
    const now = deps.now();
    await r.db.execute({
      sql: `INSERT INTO saved (user_id, kind, key, payload, saved_at) VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(user_id, kind, key) DO UPDATE SET payload = excluded.payload`,
      args: [r.user.id, kind, key, JSON.stringify(payload), savedAtOf(payload, now)],
    });
    return c.json({ ok: true });
  });

  app.delete("/api/saved/:kind/:key{.+}", async (c) => {
    const r = await requireUser(c, deps);
    if (r instanceof Response) return r;
    const kind = c.req.param("kind");
    const key = c.req.param("key");
    if (!isKind(kind) || !validKey(key)) return c.json({ error: "unknown kind or bad key" }, 400);
    await r.db.execute({
      sql: "DELETE FROM saved WHERE user_id = ? AND kind = ? AND key = ?",
      args: [r.user.id, kind, key],
    });
    return c.json({ ok: true });
  });

  app.post("/api/saved/import", async (c) => {
    const r = await requireUser(c, deps);
    if (r instanceof Response) return r;
    const text = await c.req.text();
    if (byteLength(text) > MAX_IMPORT_ITEMS * (MAX_PAYLOAD_BYTES + 1024)) {
      return c.json({ error: "import too large" }, 413);
    }
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return c.json({ error: "invalid JSON" }, 400);
    }
    const items = (body as { items?: unknown })?.items;
    if (!Array.isArray(items)) return c.json({ error: "expected { items: [...] }" }, 400);
    if (items.length > MAX_IMPORT_ITEMS) return c.json({ error: `at most ${MAX_IMPORT_ITEMS} items per import` }, 413);

    const now = deps.now();
    let room = MAX_SAVED_PER_USER - (await countSaved(r.db, r.user.id));
    let skipped = 0;
    const stmts: { sql: string; args: (string | number)[] }[] = [];
    const seen = new Set<string>();
    for (const item of items as { kind?: unknown; key?: unknown; payload?: unknown }[]) {
      const payloadText = JSON.stringify(item?.payload ?? null);
      const payload = parsePayload(payloadText);
      const id = `${String(item?.kind)}\n${String(item?.key)}`;
      if (!isKind(item?.kind) || !validKey(item?.key) || !payload || seen.has(id) || room <= 0) {
        skipped++;
        continue;
      }
      seen.add(id);
      room--;
      stmts.push({
        sql: "INSERT OR IGNORE INTO saved (user_id, kind, key, payload, saved_at) VALUES (?, ?, ?, ?, ?)",
        args: [r.user.id, item.kind, item.key, payloadText, savedAtOf(payload, now)],
      });
    }
    let imported = 0;
    if (stmts.length) {
      const results = await r.db.batch(stmts, "write");
      imported = results.reduce((n, rs) => n + rs.rowsAffected, 0);
    }
    return c.json({ imported, skipped, total: await countSaved(r.db, r.user.id) });
  });
}
