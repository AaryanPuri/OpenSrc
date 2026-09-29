/**
 * What the optional features (login, saved items, newsletter) need from the app,
 * resolved per request so Worker bindings (`c.env`) and Node's injected clients
 * look the same to the routes.
 */
import type { Context } from "hono";
import type { Db } from "./db/index.js";
import type { MailProvider } from "./mail/index.js";
import type { Env } from "./types.js";

export type AppEnv = { Bindings: Env };
export type Ctx = Context<AppEnv>;

export interface Deps {
  env(c: Ctx): Env;
  /** A database is configured (without connecting). */
  hasDb(c: Ctx): boolean;
  /** The migrated database, or null when DATABASE_URL isn't set. */
  db(c: Ctx): Promise<Db | null>;
  mail(c: Ctx): MailProvider | null;
  fetchImpl: typeof fetch;
  now(): number;
  /** The caller's IP, for rate limits ("unknown" when it can't be told). */
  clientIp(c: Ctx): string;
}

export interface Features {
  /** A database is configured. */
  db: boolean;
  /** GitHub login (and synced saves): database, OAuth app and SESSION_SECRET. */
  auth: boolean;
  /** Newsletter sign-up: database, NEWSLETTER_SECRET and a mail provider. */
  newsletter: boolean;
}

export function features(env: Env, hasDb: boolean, hasMail: boolean): Features {
  const db = hasDb;
  return {
    db,
    auth: db && !!env.GITHUB_OAUTH_CLIENT_ID && !!env.GITHUB_OAUTH_CLIENT_SECRET && !!env.SESSION_SECRET,
    newsletter: db && !!env.NEWSLETTER_SECRET && hasMail,
  };
}

/** The public origin, without a trailing slash: SITE_URL, else the request's own origin. */
export function siteOrigin(env: Env, c: Ctx): string {
  const raw = env.SITE_URL?.trim();
  if (raw) {
    try {
      return new URL(raw).origin;
    } catch {
      /* fall through */
    }
  }
  return new URL(c.req.url).origin;
}

export const isHttps = (origin: string) => origin.startsWith("https:");

export const disabled = (c: Ctx) => c.json({ error: "feature disabled" }, 503);

/** Best-effort client IP: Cloudflare's header, then the first X-Forwarded-For hop. */
export function ipFromHeaders(c: Ctx): string | null {
  const cf = c.req.header("cf-connecting-ip");
  if (cf) return cf.trim();
  const xff = c.req.header("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim() || null;
  return null;
}
