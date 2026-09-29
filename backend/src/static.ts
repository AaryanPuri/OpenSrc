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
 *  - precompressed `.br` / `.gz` copies (frontend/scripts/compress.ts) are sent
 *    when Accept-Encoding allows, with Content-Encoding and `Vary: Accept-Encoding`
 */
export function mountStatic(app: Hono<{ Bindings: Env }>, root: string): string {
  const abs = path.resolve(root);
  const indexFile = path.join(abs, "index.html");
  if (!existsSync(indexFile)) {
    throw new Error(`Static root ${abs} has no index.html. Build the frontend first (npm run build at the repo root).`);
  }
  const read = (name: string): FallbackPage | null => {
    const file = path.join(abs, name);
    if (!existsSync(file)) return null;
    const variant = (ext: string) => (existsSync(file + ext) ? readFileSync(file + ext) : null);
    return { html: readFileSync(file, "utf8"), br: variant(".br"), gzip: variant(".gz") };
  };
  // Pre-rendered builds write the empty shell to app.html (index.html is then the home page).
  const shell = read("app.html") ?? read("index.html")!;
  const notFound = read("404.html");

  // `precompressed`: a file's .br / .gz sibling (scripts/compress.ts) is sent when the client accepts it.
  const files = serveStatic({ root: abs, precompressed: true });

  app.get("*", async (c, next) => {
    if (isApiPath(c.req.path)) return next();
    const res = await files(c, next);
    // serveStatic returns the file Response (or calls next() when missing). Headers
    // set in its onFound hook land after the Response is built, so set them here.
    if (res instanceof Response && res.ok) {
      const type = res.headers.get("Content-Type") ?? "";
      const html = type.startsWith("text/html");
      res.headers.set("Cache-Control", isHashedPath(c.req.path) ? IMMUTABLE_CACHE : html ? HTML_CACHE : "no-cache");
      // The same URL answers differently per Accept-Encoding, compressed or not: caches must know.
      if (isCompressibleType(type) && !res.headers.get("Vary")?.includes("Accept-Encoding")) {
        res.headers.append("Vary", "Accept-Encoding");
      }
    }
    return res;
  });
  app.get("*", async (c, next) => {
    const p = c.req.path;
    if (isApiPath(p)) return next();
    if (isDirectoryPath(p) && notFound !== null) return sendPage(c.req.header("Accept-Encoding"), notFound, 404);
    // Repo pages can end in what looks like an extension (/repo/mrdoob/three.js).
    if (path.extname(p) && !isAppPath(p)) return next();
    return sendPage(c.req.header("Accept-Encoding"), shell, 200);
  });
  return abs;
}

interface FallbackPage {
  html: string;
  br: Buffer | null;
  gzip: Buffer | null;
}

const isCompressibleType = (type: string) =>
  /^(text\/|application\/(javascript|json|xml|manifest\+json)|image\/svg\+xml)/i.test(type);

/**
 * The best encoding we have that the client accepts: `br`, then `gzip`, else
 * null (identity). Honours q-values, `q=0` included, and `*`.
 */
export function negotiateEncoding(
  acceptEncoding: string | undefined,
  available: readonly ("br" | "gzip")[] = ["br", "gzip"],
): "br" | "gzip" | null {
  if (!acceptEncoding) return null;
  const q = new Map<string, number>();
  for (const part of acceptEncoding.split(",")) {
    const [name, ...params] = part.trim().toLowerCase().split(";");
    if (!name) continue;
    const qp = params.map((s) => s.trim()).find((s) => s.startsWith("q="));
    const value = qp ? Number(qp.slice(2)) : 1;
    q.set(name, Number.isFinite(value) ? value : 0);
  }
  const weight = (enc: string) => q.get(enc) ?? q.get("*") ?? 0;
  let best: "br" | "gzip" | null = null;
  for (const enc of available) {
    if (weight(enc) > 0 && (best === null || weight(enc) > weight(best))) best = enc;
  }
  return best;
}

function sendPage(acceptEncoding: string | undefined, page: FallbackPage, status: number): Response {
  const headers: Record<string, string> = {
    "Content-Type": "text/html; charset=UTF-8",
    "Cache-Control": HTML_CACHE,
    Vary: "Accept-Encoding",
  };
  const available = (["br", "gzip"] as const).filter((e) => page[e] !== null);
  const enc = negotiateEncoding(acceptEncoding, available);
  if (enc) {
    const body = page[enc]!;
    return new Response(new Uint8Array(body), {
      status,
      headers: { ...headers, "Content-Encoding": enc, "Content-Length": String(body.length) },
    });
  }
  return new Response(page.html, { status, headers });
}
