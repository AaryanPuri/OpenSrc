/**
 * Signed newsletter links: `<purpose>.<subscriber id>.<expiry>.<hmac>`.
 *
 * The HMAC (NEWSLETTER_SECRET) also covers the subscriber's email, which is not in
 * the token itself: a link stops working if the row is deleted and its id reused,
 * and links carry no personal data.
 */
import { hmacSign, hmacVerify } from "../lib/crypto.js";

export type TokenPurpose = "confirm" | "unsub";

/** Confirm links last a week; unsubscribe links never expire (expiry 0). */
export const CONFIRM_TTL_S = 7 * 86_400;

export interface TokenClaims {
  purpose: TokenPurpose;
  id: number;
  /** Epoch seconds, 0 = never. */
  exp: number;
}

const signed = (c: TokenClaims) => `${c.purpose}.${c.id}.${c.exp}`;

export async function signToken(secret: string, claims: TokenClaims, email: string): Promise<string> {
  const body = signed(claims);
  return `${body}.${await hmacSign(secret, `${body}.${email.toLowerCase()}`)}`;
}

/** Reads a token's claims without checking it (to find the subscriber row). */
export function peekToken(token: string | undefined | null): (TokenClaims & { sig: string }) | null {
  const m = /^(confirm|unsub)\.(\d{1,15})\.(\d{1,12})\.([A-Za-z0-9_-]{43})$/.exec(token ?? "");
  if (!m) return null;
  return { purpose: m[1] as TokenPurpose, id: Number(m[2]), exp: Number(m[3]), sig: m[4] };
}

/** Checks the signature for this email, the purpose and the expiry. */
export async function verifyToken(
  secret: string,
  token: string | undefined | null,
  purpose: TokenPurpose,
  email: string,
  nowMs: number,
): Promise<TokenClaims | null> {
  const t = peekToken(token);
  if (!t || t.purpose !== purpose) return null;
  if (t.exp !== 0 && t.exp * 1000 <= nowMs) return null;
  const ok = await hmacVerify(secret, `${signed(t)}.${email.toLowerCase()}`, t.sig);
  return ok ? { purpose: t.purpose, id: t.id, exp: t.exp } : null;
}

export const confirmToken = (secret: string, id: number, email: string, nowMs: number) =>
  signToken(secret, { purpose: "confirm", id, exp: Math.floor(nowMs / 1000) + CONFIRM_TTL_S }, email);

export const unsubscribeToken = (secret: string, id: number, email: string) =>
  signToken(secret, { purpose: "unsub", id, exp: 0 }, email);
