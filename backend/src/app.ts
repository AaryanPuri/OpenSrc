import { Hono } from "hono";
import { cors } from "hono/cors";
import { GithubError, searchIssues } from "./github/client.js";
import { searchFixtures } from "./github/fixtures.js";
import { MAX_COMMENTS, domainMatchById, resolveLanguage } from "../../shared/parse.js";
import { buildGitHubQuery, clampGithubQuery, parsedFromGithubQuery } from "./github/query.js";
import { parseQuery } from "./parse/index.js";
import { registerAuth } from "./auth/routes.js";
import { features, ipFromHeaders, type AppEnv, type Ctx, type Deps } from "./context.js";
import { ensureMigrated, webDbFromEnv, type Db } from "./db/index.js";
import { mailFromEnv, type MailProvider } from "./mail/index.js";
import { csrf, isLocalOrigin } from "./middleware/csrf.js";
import type { TokenBucket } from "./middleware/rateLimit.js";
import { registerNewsletter } from "./routes/newsletter.js";
import { registerRepoIssues } from "./routes/repoIssues.js";
import { registerSaved } from "./routes/saved.js";
import { cacheKey, defaultJsonCache, type JsonCache } from "./sharedCache.js";
import type {
  Difficulty,
  Env,
  InterpretedQuery,
  IssueType,
  ParsedQuery,
  SearchResponse,
  Since,
  SortMode,
} from "./types.js";

export interface AppOptions {
  /** Static env (Node). On Workers, bindings from `c.env` are merged over this. */
  env?: Env;
  /** Injectable fetch for GitHub calls (tests). */
  fetchImpl?: typeof fetch;
  /**
   * The database (Node and tests inject one, built with db/node.ts). Without it, a
   * DATABASE_URL binding gets an HTTP client (the Worker).
   */
  db?: Db;
  /** Outgoing mail (tests inject a ConsoleProvider). Default: from the env (Resend, or MAIL_PROVIDER=console). */
  mail?: MailProvider;
  /** Clock (tests). */
  now?: () => number;
  /** The caller's IP for rate limits (Node reads the socket; Workers use CF-Connecting-IP). */
  clientIp?: (c: Ctx) => string | null;
  /** Newsletter sign-up rate limiter (tests). */
  newsletterLimiter?: TokenBucket;
  /**
   * Response cache shared by every Worker isolate (tests inject one). Default: the Cache API
   * where the runtime has it (Workers), else an in-memory cache for this app.
   */
  cache?: JsonCache;
}

/** Live search results in the shared cache (the GitHub client also keeps its own per-isolate copy). */
const SEARCH_SHARED_TTL_MS = 5 * 60 * 1000;

const DIFFICULTIES: Difficulty[] = ["beginner", "help-wanted", "intermediate"];
const TYPES: IssueType[] = ["bug", "docs", "feature", "tests"];
const SINCES: Since[] = ["week", "month", "year"];
const SORTS: SortMode[] = ["best", "newest", "comments"];
const MAX_QUERY_LEN = 300;

const list = (v: string) =>
  v
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

/**
 * Apply explicit filter params over the parsed query. A param that is present
 * (even empty) REPLACES the parsed value, so the UI can remove a chip by sending
 * e.g. `lang=` or `difficulty=any`. Absent params keep the parsed value.
 */
export function applyOverrides<P extends ParsedQuery>(parsed: P, q: Record<string, string | undefined>): P {
  const out: P = { ...parsed, domains: [...parsed.domains] };
  if (q.lang !== undefined) {
    // Unknown languages are dropped: they would become a `language:` qualifier that matches nothing.
    out.languages = [...new Set(list(q.lang).map(resolveLanguage))].filter((l): l is string => !!l);
  }
  if (q.difficulty !== undefined) {
    const d = q.difficulty.trim().toLowerCase();
    out.difficulty = DIFFICULTIES.includes(d as Difficulty) ? (d as Difficulty) : null;
  }
  if (q.type !== undefined) {
    out.types = [...new Set(list(q.type))].filter((t): t is IssueType => TYPES.includes(t as IssueType));
  }
  if (q.domain !== undefined) {
    out.domains = [...new Set(list(q.domain))].map(domainMatchById).filter((d): d is NonNullable<typeof d> => !!d);
  }
  if (q.keywords !== undefined) out.keywords = [...new Set(list(q.keywords))];
  if (q.maxComments !== undefined) {
    const n = Number.parseInt(q.maxComments, 10);
    out.maxComments = Number.isFinite(n) && n >= 0 ? Math.min(n, MAX_COMMENTS) : null;
  }
  if (q.since !== undefined) {
    const s = q.since.trim().toLowerCase();
    out.since = SINCES.includes(s as Since) ? (s as Since) : null;
  }
  return out;
}

export function createApp(opts: AppOptions = {}) {
  const app = new Hono<AppEnv>();

  const getEnv = (bindings: Env | undefined): Env => ({ ...(opts.env ?? {}), ...(bindings ?? {}) });
  // Resolved on first use: `caches` is a request-time global on Workers.
  let jsonCache: JsonCache | undefined;
  const cache = () => (jsonCache ??= opts.cache ?? defaultJsonCache());

  const deps: Deps = {
    env: (c) => getEnv(c.env),
    hasDb: (c) => !!opts.db || !!getEnv(c.env).DATABASE_URL,
    db: async (c) => {
      const env = getEnv(c.env);
      const db = opts.db ?? (env.DATABASE_URL ? await webDbFromEnv(env.DATABASE_URL, env.DATABASE_AUTH_TOKEN) : null);
      if (db) await ensureMigrated(db);
      return db;
    },
    mail: (c) => opts.mail ?? mailFromEnv(getEnv(c.env), opts.fetchImpl),
    fetchImpl: opts.fetchImpl ?? ((input, init) => fetch(input, init)),
    now: opts.now ?? (() => Date.now()),
    clientIp: (c) => ipFromHeaders(c) ?? opts.clientIp?.(c) ?? "unknown",
  };

  app.use(
    "/api/*",
    cors({
      origin: (origin) => (origin && isLocalOrigin(origin) ? origin : null),
      allowMethods: ["GET", "OPTIONS"],
    }),
  );
  // Cookie-authenticated writes must come from this site. The mail client's one-click unsubscribe has no Origin.
  app.use("/api/*", csrf(deps, { exempt: (path) => path === "/api/newsletter/unsubscribe" }));

  app.get("/api/health", (c) => {
    const env = getEnv(c.env);
    return c.json({
      ok: true,
      llm: !!env.ANTHROPIC_API_KEY,
      githubToken: !!env.GITHUB_TOKEN,
      ...features(env, deps.hasDb(c), !!deps.mail(c)),
    });
  });

  registerAuth(app, deps);
  registerSaved(app, deps);
  registerNewsletter(app, deps, { limiter: opts.newsletterLimiter });
  registerRepoIssues(app, deps, cache);

  app.get("/api/parse", async (c) => {
    const q = (c.req.query("q") ?? "").slice(0, MAX_QUERY_LEN);
    const parsed = await parseQuery(q, getEnv(c.env));
    return c.json(parsed);
  });

  app.get("/api/search", async (c) => {
    const env = getEnv(c.env);
    const q = (c.req.query("q") ?? "").slice(0, MAX_QUERY_LEN);
    const page = Math.min(Math.max(parseInt(c.req.query("page") ?? "1", 10) || 1, 1), 50);
    const sortParam = (c.req.query("sort") ?? "best") as SortMode;
    const sort = SORTS.includes(sortParam) ? sortParam : "best";
    const demo = ["1", "true"].includes(c.req.query("demo") ?? "");
    const orderParam = c.req.query("order");
    const order = orderParam === "asc" || orderParam === "desc" ? orderParam : undefined;

    // `gq=`: the caller already built the GitHub query (e.g. the frontend's own
    // parser). Skip parsing and run it verbatim; `parsed` is null in the response.
    const rawGq = c.req.query("gq");
    const isRaw = rawGq !== undefined && rawGq.trim() !== "";

    let parsed: InterpretedQuery | null;
    let githubQuery: string;
    if (isRaw) {
      parsed = null;
      githubQuery = clampGithubQuery(rawGq);
    } else {
      parsed = applyOverrides(await parseQuery(q, env), {
        lang: c.req.query("lang"),
        difficulty: c.req.query("difficulty"),
        type: c.req.query("type"),
        domain: c.req.query("domain"),
        keywords: c.req.query("keywords"),
        maxComments: c.req.query("maxComments"),
        since: c.req.query("since"),
      });
      githubQuery = buildGitHubQuery(parsed);
    }

    const fixtures = (extra: Pick<SearchResponse, "warning" | "rateLimit" | "fallbackReason"> = {}): SearchResponse => {
      const r = searchFixtures(parsed ?? parsedFromGithubQuery(githubQuery), page, sort);
      return { parsed, githubQuery, total: r.total, items: r.items, source: "fixtures", ...extra };
    };

    if (demo) return c.json(fixtures());

    // Raw queries (the frontend's path) are shared across Worker isolates: the search quota is
    // 30 a minute for the whole site. Only live answers are stored, never samples.
    const sharedKey = isRaw
      ? cacheKey(new URL(c.req.url).origin, "search", { gq: githubQuery, page, sort, order })
      : null;
    if (sharedKey) {
      const hit = await cache().get<SearchResponse>(sharedKey);
      if (hit) return c.json(hit, 200, { "x-cache": "hit" });
    }

    try {
      const r = await searchIssues(githubQuery, {
        page,
        sort,
        order,
        token: env.GITHUB_TOKEN,
        fetchImpl: opts.fetchImpl,
      });
      const body: SearchResponse = {
        parsed,
        githubQuery,
        total: r.total,
        items: r.items,
        source: "github",
        rateLimit: r.rateLimit,
      };
      if (sharedKey) await cache().put(sharedKey, body, SEARCH_SHARED_TTL_MS);
      return c.json(body);
    } catch (err) {
      const gh = err instanceof GithubError ? err : undefined;
      // A raw query GitHub can't parse is the caller's error: surface it instead of masking it with samples.
      if (isRaw && gh?.status === 422) {
        return c.json({ error: "GitHub could not parse that query.", kind: "invalid", githubQuery }, 422);
      }
      const rateLimited = gh?.status === 403 || gh?.status === 429;
      console.warn("[search] GitHub unavailable, serving fixtures:", (err as Error).message);
      return c.json(
        fixtures({
          // Shown verbatim as the frontend's notice.
          warning: rateLimited
            ? "GitHub's search rate limit was reached on the server. Showing sample results meanwhile."
            : "We couldn't reach GitHub, so here are sample results instead. Try again in a moment.",
          rateLimit: gh?.rateLimit,
          fallbackReason: rateLimited ? "rate-limit" : "unavailable",
        }),
      );
    }
  });

  app.notFound((c) => c.json({ error: "not found" }, 404));
  app.onError((err, c) => {
    console.error("[app] unhandled error:", err);
    return c.json({ error: "internal error" }, 500);
  });

  return app;
}

/** Default export for Cloudflare Workers (`env` bindings arrive via `c.env`). */
export default createApp();
