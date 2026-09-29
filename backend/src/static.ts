/**
 * Node-only: serve the built frontend (Vite `dist/` plus the pre-rendered pages)
 * next to the API, with an app-shell fallback. Imported by `node.ts` only, so the
 * Worker entry (`app.ts`) never pulls in `node:fs`.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Hono } from "hono";
import type { Env } from "./types.js";

const isApiPath = (p: string) => p === "/api" || p.startsWith("/api/");
/** Client-side routes whose last segment is a name that may contain dots. */
const isAppPath = (p: string) => /^\/repo\/[^/]+\/[^/]+\/?$/.test(p);
/**
 * Directory pages. Every one that exists is pre-rendered, so a path here with
 * no file behind it is a real 404 (not a client-side route).
 */
const isDirectoryPath = (p: string) => /^\/(repo|language|field|collections)(\/|$)/.test(p);
/** Content-hashed files: safe to cache forever. */
const isHashedPath = (p: string) => p.startsWith("/assets/") || /^\/data\/repos\.[0-9a-f]{8,}\.json$/.test(p);

/** Pages (pre-rendered or the app shell) may change with each nightly build. */
export const HTML_CACHE = "public, max-age=300";
export const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";

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
 *  - existing files are served, and a directory's `index.html`: the pre-rendered
 *    pages (`/repo/a/b` → `repo/a/b/index.html`, also when the name has a dot)
 *  - HTML is cached for 5 minutes; hashed `/assets/*` and `/data/repos.<hash>.json`
 *    for a year (immutable); other files are revalidated (no-cache)
 *  - unknown directory pages (`/repo/…`, `/language/…`, `/field/…`, `/collections/…`)
 *    get `404.html` with status 404
 *  - other non-`/api` GETs without a file extension get the app shell (`app.html`,
 *    else `index.html`) for client-side routes like `/issues` and `/account`
 *  - missing files with an extension and unknown `/api/*` paths stay 404
 */
export function mountStatic(app: Hono<{ Bindings: Env }>, root: string): string {
  const abs = path.resolve(root);
  const indexFile = path.join(abs, "index.html");
  if (!existsSync(indexFile)) {
    throw new Error(`Static root ${abs} has no index.html. Build the frontend first (npm run build at the repo root).`);
  }
  const read = (name: string) => {
    const file = path.join(abs, name);
    return existsSync(file) ? readFileSync(file, "utf8") : null;
  };
  // Pre-rendered builds write the empty shell to app.html (index.html is then the home page).
  const shellHtml = read("app.html") ?? readFileSync(indexFile, "utf8");
  const notFoundHtml = read("404.html");

  const files = serveStatic({ root: abs });

  app.get("*", async (c, next) => {
    if (isApiPath(c.req.path)) return next();
    const res = await files(c, next);
    // serveStatic returns the file Response (or calls next() when missing). Headers
    // set in its onFound hook land after the Response is built, so set them here.
    if (res instanceof Response && res.ok) {
      const html = res.headers.get("Content-Type")?.startsWith("text/html");
      res.headers.set("Cache-Control", isHashedPath(c.req.path) ? IMMUTABLE_CACHE : html ? HTML_CACHE : "no-cache");
    }
    return res;
  });
  app.get("*", async (c, next) => {
    const p = c.req.path;
    if (isApiPath(p)) return next();
    if (isDirectoryPath(p) && notFoundHtml !== null) {
      c.header("Cache-Control", HTML_CACHE);
      return c.html(notFoundHtml, 404);
    }
    // Repo pages can end in what looks like an extension (/repo/mrdoob/three.js).
    if (path.extname(p) && !isAppPath(p)) return next();
    c.header("Cache-Control", HTML_CACHE);
    return c.html(shellHtml);
  });
  return abs;
}
