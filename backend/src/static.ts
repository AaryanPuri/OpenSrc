/**
 * Node-only: serve the built frontend (Vite `dist/`) next to the API, with SPA
 * fallback. Imported by `node.ts` only, so the Worker entry (`app.ts`) never
 * pulls in `node:fs`.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Hono } from "hono";
import type { Env } from "./types.js";

const isApiPath = (p: string) => p === "/api" || p.startsWith("/api/");

/**
 * Where to serve the built frontend from, if anywhere:
 *  - SERVE_STATIC=<dir> (relative to the working directory) always enables it;
 *  - SERVE_STATIC=off|0|false disables it, even in production;
 *  - otherwise NODE_ENV=production enables it with `frontend/dist/`.
 */
export function staticRoot(env: Record<string, string | undefined> = process.env): string | undefined {
  const s = env.SERVE_STATIC?.trim();
  if (s && !["off", "0", "false"].includes(s)) return s;
  if (s) return undefined;
  if (env.NODE_ENV === "production") return path.join(repoRoot(), "frontend", "dist");
  return undefined;
}

/**
 * The repo root: the nearest ancestor of this file that contains `backend/package.json`.
 * Works from src/ (tsx) and from the compiled dist/backend/src/, which sit at different depths.
 */
export function repoRoot(from = path.dirname(fileURLToPath(import.meta.url))): string {
  let dir = from;
  for (;;) {
    if (existsSync(path.join(dir, "backend", "package.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`Could not find the repo root above ${from}`);
    dir = parent;
  }
}

/**
 * Mount static file serving on `app` (after the API routes, so those win).
 *  - existing files are served; hashed `/assets/*` get a 1-year immutable cache
 *  - other non-`/api` GETs without a file extension get `index.html` (client-side routes)
 *  - missing files with an extension and unknown `/api/*` paths stay 404
 */
export function mountStatic(app: Hono<{ Bindings: Env }>, root: string): string {
  const abs = path.resolve(root);
  const indexFile = path.join(abs, "index.html");
  if (!existsSync(indexFile)) {
    throw new Error(`Static root ${abs} has no index.html. Build the frontend first (npm run build at the repo root).`);
  }
  const indexHtml = readFileSync(indexFile, "utf8");

  const files = serveStatic({ root: abs });

  app.get("*", async (c, next) => {
    if (isApiPath(c.req.path)) return next();
    const res = await files(c, next);
    // serveStatic returns the file Response (or calls next() when missing). Headers
    // set in its onFound hook land after the Response is built, so set them here.
    if (res instanceof Response && res.ok) {
      res.headers.set(
        "Cache-Control",
        c.req.path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache",
      );
    }
    return res;
  });
  app.get("*", async (c, next) => {
    if (isApiPath(c.req.path) || path.extname(c.req.path)) return next();
    c.header("Cache-Control", "no-cache");
    return c.html(indexHtml);
  });
  return abs;
}
