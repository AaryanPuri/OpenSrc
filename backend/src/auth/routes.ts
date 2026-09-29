/**
 * Sign in with GitHub (an OAuth App with no scopes: only the public profile).
 *
 *   GET  /api/auth/github?returnTo=/path   signed state cookie, then off to GitHub
 *   GET  /api/auth/github/callback         code → token → GET /user → session cookie
 *   POST /api/auth/logout
 *   GET  /api/me                            { user } (null when signed out)
 *
 * The GitHub access token is used for the one /user call and then dropped: it is
 * never stored or logged.
 */
import type { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { disabled, features, isHttps, siteOrigin, type AppEnv, type Ctx, type Deps } from "../context.js";
import { nowIso, type Db } from "../db/index.js";
import { base64url, fromBase64url, hmacSign, hmacVerify, randomToken } from "../lib/crypto.js";
import {
  clearSessionCookie,
  createSession,
  currentUser,
  deleteSession,
  SESSION_COOKIE,
  setSessionCookie,
  userFromRow,
  type User,
} from "./session.js";

const STATE_COOKIE = "opensrc_oauth";
const STATE_PATH = "/api/auth";
const STATE_TTL_S = 600;
const GITHUB = "https://github.com";
const GITHUB_API = "https://api.github.com";
const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Only a path on this site; anything else (another origin, `//host`, the API) becomes "/". */
export function safeReturnTo(raw: string | undefined | null, site: string): string {
  if (!raw || raw.length > 512) return "/";
  try {
    const u = new URL(raw, `${site}/`);
    if (u.origin !== site || u.pathname.startsWith("/api/")) return "/";
    return `${u.pathname}${u.search}${u.hash}`;
  } catch {
    return "/";
  }
}

export const publicUser = (u: User) => ({
  id: u.id,
  login: u.login,
  name: u.name,
  avatarUrl: u.avatarUrl,
  createdAt: u.createdAt,
});

async function signState(secret: string, state: string, returnTo: string, exp: number): Promise<string> {
  const body = `${state}.${base64url(encoder.encode(returnTo))}.${exp}`;
  return `${body}.${await hmacSign(secret, body)}`;
}

async function readState(
  secret: string,
  value: string | undefined,
  now: number,
): Promise<{ state: string; returnTo: string } | null> {
  const parts = value?.split(".") ?? [];
  if (parts.length !== 4) return null;
  const [state, rt, exp, sig] = parts;
  if (!(await hmacVerify(secret, `${state}.${rt}.${exp}`, sig))) return null;
  if (!(Number(exp) * 1000 > now)) return null;
  const bytes = fromBase64url(rt);
  return bytes ? { state, returnTo: decoder.decode(bytes) } : null;
}

async function upsertUser(db: Db, gh: GithubUser, now: number): Promise<User> {
  const at = nowIso(now);
  const rs = await db.execute({
    sql: `INSERT INTO users (github_id, login, name, avatar_url, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(github_id) DO UPDATE SET
            login = excluded.login, name = excluded.name, avatar_url = excluded.avatar_url, updated_at = excluded.updated_at
          RETURNING *`,
    args: [gh.id, gh.login, gh.name ?? null, gh.avatar_url ?? null, at, at],
  });
  return userFromRow(rs.rows[0] as Record<string, unknown>);
}

interface GithubUser {
  id: number;
  login: string;
  name?: string | null;
  avatar_url?: string | null;
}

class OAuthError extends Error {}

async function exchangeAndFetchUser(deps: Deps, c: Ctx, code: string, redirectUri: string): Promise<GithubUser> {
  const env = deps.env(c);
  const tokenRes = await deps.fetchImpl(`${GITHUB}/login/oauth/access_token`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "opensrc" },
    body: JSON.stringify({
      client_id: env.GITHUB_OAUTH_CLIENT_ID,
      client_secret: env.GITHUB_OAUTH_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri,
    }),
  });
  const tokenBody = (await tokenRes.json().catch(() => ({}))) as { access_token?: string; error?: string };
  // Held only in this function's scope: used once below, never stored or logged.
  const accessToken = tokenBody.access_token;
  if (!tokenRes.ok || !accessToken)
    throw new OAuthError(`token exchange failed: ${tokenBody.error ?? tokenRes.status}`);

  const userRes = await deps.fetchImpl(`${GITHUB_API}/user`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": "opensrc",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!userRes.ok) throw new OAuthError(`GET /user failed: ${userRes.status}`);
  const gh = (await userRes.json()) as GithubUser;
  if (typeof gh.id !== "number" || typeof gh.login !== "string") throw new OAuthError("GET /user: unexpected body");
  return { id: gh.id, login: gh.login, name: gh.name ?? null, avatar_url: gh.avatar_url ?? null };
}

export function registerAuth(app: Hono<AppEnv>, deps: Deps): void {
  /** The database when login is switched on, else null (the caller answers 503). */
  const authDb = async (c: Ctx): Promise<Db | null> => {
    if (!features(deps.env(c), deps.hasDb(c), false).auth) return null;
    return deps.db(c);
  };

  app.get("/api/auth/github", async (c) => {
    const db = await authDb(c);
    if (!db) return disabled(c);
    const env = deps.env(c);
    const site = siteOrigin(env, c);
    const state = randomToken(16);
    const returnTo = safeReturnTo(c.req.query("returnTo"), site);
    const exp = Math.floor(deps.now() / 1000) + STATE_TTL_S;
    setCookie(c, STATE_COOKIE, await signState(env.SESSION_SECRET!, state, returnTo, exp), {
      httpOnly: true,
      secure: isHttps(site),
      sameSite: "Lax",
      path: STATE_PATH,
      maxAge: STATE_TTL_S,
    });
    const url = new URL(`${GITHUB}/login/oauth/authorize`);
    url.searchParams.set("client_id", env.GITHUB_OAUTH_CLIENT_ID!);
    url.searchParams.set("redirect_uri", `${site}/api/auth/github/callback`);
    url.searchParams.set("state", state);
    url.searchParams.set("allow_signup", "true");
    return c.redirect(url.toString(), 302);
  });

  app.get("/api/auth/github/callback", async (c) => {
    const db = await authDb(c);
    if (!db) return disabled(c);
    const env = deps.env(c);
    const site = siteOrigin(env, c);
    const saved = await readState(env.SESSION_SECRET!, getCookie(c, STATE_COOKIE), deps.now());
    deleteCookie(c, STATE_COOKIE, { path: STATE_PATH, secure: isHttps(site) });
    const state = c.req.query("state");
    if (!saved || !state || state !== saved.state) {
      return c.json({ error: "Sign-in expired or was started elsewhere. Please try again." }, 400);
    }
    // The user pressed "Cancel" on GitHub.
    if (c.req.query("error")) return c.redirect(`${site}${saved.returnTo}`, 302);
    const code = c.req.query("code");
    if (!code) return c.json({ error: "missing code" }, 400);

    let gh: GithubUser;
    try {
      gh = await exchangeAndFetchUser(deps, c, code, `${site}/api/auth/github/callback`);
    } catch (err) {
      console.warn("[auth] GitHub sign-in failed:", (err as Error).message);
      return c.redirect(`${site}/account?login=failed`, 302);
    }
    const now = deps.now();
    const user = await upsertUser(db, gh, now);
    await db.execute({
      sql: "DELETE FROM sessions WHERE user_id = ? AND expires_at <= ?",
      args: [user.id, nowIso(now)],
    });
    setSessionCookie(c, deps, await createSession(db, user.id, now));
    return c.redirect(`${site}${saved.returnTo}`, 302);
  });

  app.post("/api/auth/logout", async (c) => {
    const db = await authDb(c);
    if (!db) return disabled(c);
    const token = getCookie(c, SESSION_COOKIE);
    if (token) await deleteSession(db, token);
    clearSessionCookie(c, deps);
    return c.json({ ok: true });
  });

  app.get("/api/me", async (c) => {
    const db = await authDb(c);
    if (!db) return disabled(c);
    c.header("Cache-Control", "no-store");
    const user = await currentUser(c, db, deps);
    return c.json({ user: user ? publicUser(user) : null });
  });
}

/** For routes that need a signed-in user: the db and user, or the response to send. */
export async function requireUser(c: Ctx, deps: Deps): Promise<{ db: Db; user: User } | Response> {
  if (!features(deps.env(c), deps.hasDb(c), false).auth) return disabled(c);
  const db = await deps.db(c);
  if (!db) return disabled(c);
  const user = await currentUser(c, db, deps);
  if (!user) return c.json({ error: "sign in first" }, 401);
  return { db, user };
}
