/** Shared setup for the login, saved-items and newsletter tests: in-memory libSQL, a fake GitHub, cookies. */
import { createApp, type AppOptions } from "../src/app.js";
import type { Db } from "../src/db/index.js";
import { nodeDb } from "../src/db/node.js";
import { ConsoleProvider } from "../src/mail/index.js";
import { TokenBucket } from "../src/middleware/rateLimit.js";
import type { Env } from "../src/types.js";

export const SITE = "https://opensrc.test";
export const FAKE_GH_TOKEN = "gho_FAKE_ACCESS_TOKEN_never_store_me";

export const FULL_ENV: Env = {
  SITE_URL: SITE,
  SESSION_SECRET: "session-secret-for-tests",
  GITHUB_OAUTH_CLIENT_ID: "client-id",
  GITHUB_OAUTH_CLIENT_SECRET: "client-secret",
  NEWSLETTER_SECRET: "newsletter-secret-for-tests",
  NEWSLETTER_FROM: "OpenSrc <digest@opensrc.test>",
};

export interface GithubUserFixture {
  id: number;
  login: string;
  name?: string;
  avatar_url?: string;
}

/** A stand-in for github.com's token endpoint and api.github.com/user. */
export function fakeGithub(user: GithubUserFixture = { id: 4242, login: "octo", name: "Octo Cat" }) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === "https://github.com/login/oauth/access_token") {
      const body = JSON.parse(String(init?.body)) as { code?: string };
      if (body.code === "bad") return Response.json({ error: "bad_verification_code" });
      return Response.json({ access_token: FAKE_GH_TOKEN, token_type: "bearer", scope: "" });
    }
    if (url === "https://api.github.com/user") {
      const auth = new Headers(init?.headers).get("authorization");
      if (auth !== `Bearer ${FAKE_GH_TOKEN}`) return new Response("unauthorized", { status: 401 });
      return Response.json({ ...user, avatar_url: user.avatar_url ?? "https://avatars.example/u.png" });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

export interface TestApp {
  app: ReturnType<typeof createApp>;
  db: Db;
  mail: ConsoleProvider;
  clock: { now: number };
  github: ReturnType<typeof fakeGithub>;
}

export function makeApp(over: Partial<AppOptions> & { env?: Env; githubUser?: GithubUserFixture } = {}): TestApp {
  const db = nodeDb(":memory:");
  const mail = new ConsoleProvider(() => {});
  const clock = { now: Date.parse("2026-09-28T12:00:00Z") };
  const github = fakeGithub(over.githubUser);
  const app = createApp({
    db,
    mail,
    fetchImpl: github.fetchImpl,
    now: () => clock.now,
    newsletterLimiter: new TokenBucket(100, 1000),
    ...over,
    env: { ...FULL_ENV, ...over.env },
  });
  return { app, db, mail, clock, github };
}

/** name → value of every cookie a response sets (an empty value = deleted). */
export function setCookies(res: Response): Map<string, { value: string; raw: string }> {
  const out = new Map<string, { value: string; raw: string }>();
  for (const raw of res.headers.getSetCookie()) {
    const [pair] = raw.split(";");
    const i = pair.indexOf("=");
    out.set(pair.slice(0, i), { value: pair.slice(i + 1), raw });
  }
  return out;
}

/** Runs the whole GitHub sign-in and returns the session cookie header. */
export async function signIn(t: TestApp, returnTo = "/account"): Promise<{ cookie: string; location: string }> {
  const start = await t.app.request(`/api/auth/github?returnTo=${encodeURIComponent(returnTo)}`);
  const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
  const stateCookie = setCookies(start).get("opensrc_oauth")!.value;
  const cb = await t.app.request(`/api/auth/github/callback?code=good&state=${state}`, {
    headers: { cookie: `opensrc_oauth=${stateCookie}` },
  });
  const session = setCookies(cb).get("opensrc_session");
  if (!session) throw new Error(`sign-in failed: ${cb.status} ${await cb.text()}`);
  return { cookie: `opensrc_session=${session.value}`, location: cb.headers.get("location")! };
}

/** Headers for a same-site write. */
export const write = (cookie?: string, extra: Record<string, string> = {}) => ({
  origin: SITE,
  "content-type": "application/json",
  ...(cookie ? { cookie } : {}),
  ...extra,
});

/** Every row of every table, as one string (to prove a secret isn't stored anywhere). */
export async function dumpDb(db: Db): Promise<string> {
  const tables = (await db.execute("SELECT name FROM sqlite_master WHERE type = 'table'")).rows.map((r) =>
    String(r.name),
  );
  const parts: string[] = [];
  for (const t of tables) parts.push(JSON.stringify((await db.execute(`SELECT * FROM "${t}"`)).rows));
  return parts.join("\n");
}
