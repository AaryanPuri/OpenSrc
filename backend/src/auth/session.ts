/**
 * Sessions: a random 32-byte token in an HttpOnly cookie; the database keeps only
 * its SHA-256, so a leaked database can't be replayed as logins.
 */
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { siteOrigin, isHttps, type Ctx, type Deps } from "../context.js";
import { nowIso, type Db } from "../db/index.js";
import { randomToken, sha256Hex } from "../lib/crypto.js";

export const SESSION_COOKIE = "opensrc_session";
export const SESSION_DAYS = 30;
const DAY = 86_400_000;

export interface User {
  id: number;
  githubId: number;
  login: string;
  name: string | null;
  avatarUrl: string | null;
  createdAt: string;
}

export function userFromRow(r: Record<string, unknown>): User {
  return {
    id: Number(r.id),
    githubId: Number(r.github_id),
    login: String(r.login),
    name: r.name == null ? null : String(r.name),
    avatarUrl: r.avatar_url == null ? null : String(r.avatar_url),
    createdAt: String(r.created_at),
  };
}

/** Creates a session and returns the raw token (for the cookie only). */
export async function createSession(db: Db, userId: number, now: number): Promise<string> {
  const token = randomToken(32);
  await db.execute({
    sql: "INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
    args: [await sha256Hex(token), userId, nowIso(now), nowIso(now + SESSION_DAYS * DAY)],
  });
  return token;
}

export async function userForToken(db: Db, token: string, now: number): Promise<User | null> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const rs = await db.execute({
    sql: `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
          WHERE s.token_hash = ? AND s.expires_at > ?`,
    args: [await sha256Hex(token), nowIso(now)],
  });
  return rs.rows[0] ? userFromRow(rs.rows[0] as Record<string, unknown>) : null;
}

export async function deleteSession(db: Db, token: string): Promise<void> {
  await db.execute({ sql: "DELETE FROM sessions WHERE token_hash = ?", args: [await sha256Hex(token)] });
}

export function setSessionCookie(c: Ctx, deps: Deps, token: string): void {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isHttps(siteOrigin(deps.env(c), c)),
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_DAYS * 86_400,
  });
}

export function clearSessionCookie(c: Ctx, deps: Deps): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure: isHttps(siteOrigin(deps.env(c), c)) });
}

/** The signed-in user for this request, or null. */
export async function currentUser(c: Ctx, db: Db, deps: Deps): Promise<User | null> {
  const token = getCookie(c, SESSION_COOKIE);
  return token ? userForToken(db, token, deps.now()) : null;
}
