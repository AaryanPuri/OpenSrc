/**
 * CSRF protection for cookie-authenticated writes: a POST, PUT, PATCH or DELETE must
 * carry an Origin header naming this site. Browsers send Origin on every such request,
 * same-origin included, so a page elsewhere can't make one with our cookie.
 *
 * Allowed: SITE_URL's origin, the request's own origin and, only while SITE_URL is
 * unset or itself local, localhost origins (the Vite dev server).
 */
import type { MiddlewareHandler } from "hono";
import type { AppEnv, Deps } from "../context.js";

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

export function isLocalOrigin(origin: string): boolean {
  try {
    const { hostname } = new URL(origin);
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  } catch {
    return false;
  }
}

export function csrf(
  deps: Pick<Deps, "env">,
  opts: { exempt?: (path: string) => boolean } = {},
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (SAFE.has(c.req.method) || opts.exempt?.(c.req.path)) return next();
    const origin = c.req.header("origin");
    const env = deps.env(c);
    let site: string | null;
    try {
      site = env.SITE_URL ? new URL(env.SITE_URL).origin : null;
    } catch {
      site = null;
    }
    const allowed =
      !!origin &&
      origin !== "null" &&
      (origin === site ||
        origin === new URL(c.req.url).origin ||
        ((site === null || isLocalOrigin(site)) && isLocalOrigin(origin)));
    if (!allowed) return c.json({ error: "forbidden origin" }, 403);
    return next();
  };
}
