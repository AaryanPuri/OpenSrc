import { existsSync, readFileSync } from "node:fs";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { mountStatic, staticRoot } from "./static.js";

/** Minimal .env loader (Node-only entry; the app itself never touches process.env). */
function loadDotEnv(path = ".env"): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || line.trimStart().startsWith("#")) continue;
    const [, key, raw] = m;
    const value = raw.replace(/^(['"])(.*)\1$/, "$2");
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv();

const port = Number(process.env.PORT) || 8787;
const app = createApp({
  env: {
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || undefined,
    ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL || undefined,
    GITHUB_TOKEN: process.env.GITHUB_TOKEN || undefined,
  },
});

const root = staticRoot();
const servedFrom = root ? mountStatic(app, root) : undefined;

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`OSS finder API listening on http://localhost:${info.port}`);
  console.log(
    `  LLM parsing: ${process.env.ANTHROPIC_API_KEY ? "on" : "off (rules)"}; GitHub token: ${process.env.GITHUB_TOKEN ? "yes" : "no"}`,
  );
  if (servedFrom) console.log(`  Serving frontend from ${servedFrom}`);
});
