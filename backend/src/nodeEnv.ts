/**
 * Node-only helpers for the server entry and the CLIs: load backend/.env and read the
 * app's configuration from process.env. The app itself never touches process.env.
 */
import { existsSync, readFileSync } from "node:fs";
import type { Env } from "./types.js";

/** Minimal .env loader: KEY=value lines; values already in the environment win. */
export function loadDotEnv(path = ".env"): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || line.trimStart().startsWith("#")) continue;
    const [, key, raw] = m;
    const value = raw.replace(/^(['"])(.*)\1$/, "$2");
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

const KEYS: (keyof Env)[] = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_MODEL",
  "GITHUB_TOKEN",
  "SITE_URL",
  "SESSION_SECRET",
  "DATABASE_URL",
  "DATABASE_AUTH_TOKEN",
  "GITHUB_OAUTH_CLIENT_ID",
  "GITHUB_OAUTH_CLIENT_SECRET",
  "RESEND_API_KEY",
  "NEWSLETTER_FROM",
  "NEWSLETTER_SECRET",
  "DIGEST_DAILY_CAP",
  "MAIL_PROVIDER",
];

/** The app's env from process.env, with empty values dropped. */
export function envFromProcess(): Env {
  const env: Env = {};
  for (const k of KEYS) {
    const v = process.env[k];
    if (v) env[k] = v;
  }
  return env;
}
