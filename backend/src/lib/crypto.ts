/**
 * Web Crypto helpers (crypto.subtle / getRandomValues only), so the same code runs
 * on Cloudflare Workers and Node 20+. No node:crypto.
 */

const encoder = new TextEncoder();

export function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64url(s: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) return null;
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/** `n` random bytes, base64url-encoded. */
export function randomToken(n = 32): string {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text)));
  return [...digest].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const keys = new Map<string, Promise<CryptoKey>>();

function hmacKey(secret: string): Promise<CryptoKey> {
  let key = keys.get(secret);
  if (!key) {
    key = crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
      "sign",
      "verify",
    ]);
    keys.set(secret, key);
  }
  return key;
}

/** HMAC-SHA-256 of `data`, base64url-encoded. */
export async function hmacSign(secret: string, data: string): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(data));
  return base64url(new Uint8Array(sig));
}

/** Checks an HMAC made by `hmacSign`; crypto.subtle.verify compares in constant time. */
export async function hmacVerify(secret: string, data: string, signature: string): Promise<boolean> {
  const sig = fromBase64url(signature);
  if (!sig || sig.length !== 32) return false;
  return crypto.subtle.verify("HMAC", await hmacKey(secret), sig, encoder.encode(data));
}
