import { serve } from "@hono/node-server";
import { getConnInfo } from "@hono/node-server/conninfo";
import { createApp } from "./app.js";
import { features } from "./context.js";
import { nodeDb } from "./db/node.js";
import { mailFromEnv } from "./mail/index.js";
import { envFromProcess, loadDotEnv } from "./nodeEnv.js";
import { mountStatic, staticRoot } from "./static.js";

loadDotEnv();

const port = Number(process.env.PORT) || 8787;
const env = envFromProcess();
// Node opens any libSQL URL, local files included (the Worker builds its own HTTP client).
const db = env.DATABASE_URL ? nodeDb(env.DATABASE_URL, env.DATABASE_AUTH_TOKEN) : undefined;
const app = createApp({
  env,
  db,
  clientIp: (c) => {
    try {
      return getConnInfo(c).remote.address ?? null;
    } catch {
      return null;
    }
  },
});

const root = staticRoot();
const servedFrom = root ? mountStatic(app, root) : undefined;

serve({ fetch: app.fetch, port }, (info) => {
  const on = features(env, !!db, !!mailFromEnv(env));
  console.log(`OSS finder API listening on http://localhost:${info.port}`);
  console.log(
    `  LLM parsing: ${env.ANTHROPIC_API_KEY ? "on" : "off (rules)"}; GitHub token: ${env.GITHUB_TOKEN ? "yes" : "no"}`,
  );
  console.log(
    `  Database: ${db ? "on" : "off"}; login: ${on.auth ? "on" : "off"}; newsletter: ${on.newsletter ? "on" : "off"}`,
  );
  if (servedFrom) console.log(`  Serving frontend from ${servedFrom}`);
});
