import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { clearGithubCaches } from "../src/github/client.js";
import { cacheApiJsonCache, memoryJsonCache, type CacheLike } from "../src/sharedCache.js";
import type { RepoIssuesResponse } from "../../shared/repoIssues.js";

beforeEach(() => clearGithubCaches());

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

const rest = (id: number, created: string, extra: Record<string, unknown> = {}) => ({
  id,
  number: id,
  title: `Issue ${id}`,
  html_url: `https://github.com/acme/widget/issues/${id}`,
  body: "Some **text**",
  labels: [{ name: "good first issue", color: "7057ff" }],
  comments: 1,
  created_at: created,
  updated_at: created,
  user: { login: "octo" },
  assignees: [],
  ...extra,
});

const gqlNode = (n: number, extra: Record<string, unknown> = {}) => ({
  databaseId: 1000 + n,
  number: n,
  title: `GQL ${n}`,
  url: `https://github.com/acme/widget/issues/${n}`,
  body: "Body",
  createdAt: "2026-09-20T00:00:00Z",
  updatedAt: "2026-09-21T00:00:00Z",
  author: { login: "octo" },
  comments: { totalCount: 2 },
  assignees: { totalCount: 0 },
  labels: { nodes: [{ name: "good first issue", color: "7057ff" }] },
  closedByPullRequestsReferences: { totalCount: 0 },
  timelineItems: { nodes: [] },
  ...extra,
});

const gqlBody = (nodes: unknown[], hasNextPage = false) => ({
  data: {
    repository: {
      all: { totalCount: 3648 },
      gfi: { totalCount: 64 },
      help: { totalCount: 92 },
      page: { pageInfo: { hasNextPage, endCursor: hasNextPage ? "Y3Vyc29yOnYyOpK0" : null }, nodes },
    },
    rateLimit: { limit: 5000, remaining: 4990, resetAt: "2026-09-30T10:00:00Z" },
  },
});

const get = async (app: ReturnType<typeof createApp>, qs: string) => {
  const res = await app.request(`/api/repo-issues?${qs}`);
  return { res, body: (await res.json()) as RepoIssuesResponse & { error?: string; resetAt?: number | null } };
};

describe("GET /api/repo-issues with a token (GraphQL)", () => {
  it("returns exact counts for every tab and one page of the tab, assigned issues included", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      json(
        gqlBody(
          [
            gqlNode(7, { assignees: { totalCount: 1 } }),
            gqlNode(6, { closedByPullRequestsReferences: { totalCount: 1 } }),
          ],
          true,
        ),
      ),
    );
    const app = createApp({ env: { GITHUB_TOKEN: "t" }, fetchImpl: fetchImpl as unknown as typeof fetch });
    const { res, body } = await get(
      app,
      "repo=acme/widget&tab=gfi&gfi=good%20first%20issue,Good-First-Issue&help=help%20wanted",
    );
    expect(res.status).toBe(200);
    expect(body.counts).toEqual({ all: 3648, gfi: 64, help: 92 });
    expect(body.via).toBe("graphql");
    expect(body.hasMore).toBe(true);
    expect(body.next).toBe("Y3Vyc29yOnYyOpK0");
    expect(body.items.map((i) => [i.number, i.assigned, i.linkedPr])).toEqual([
      [7, true, false],
      [6, false, true],
    ]);
    expect(body.items[0]).toMatchObject({
      id: 1007,
      url: "https://github.com/acme/widget/issues/7",
      repo: { fullName: "acme/widget", owner: "acme", url: "https://github.com/acme/widget" },
      labels: [{ name: "good first issue", color: "7057ff" }],
      comments: 2,
      author: "octo",
      bodyExcerpt: "Body",
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe("https://api.github.com/graphql");
    const sent = JSON.parse(String(init?.body));
    expect(sent.variables).toMatchObject({
      owner: "acme",
      name: "widget",
      gfi: ["good first issue", "Good-First-Issue"],
      help: ["help wanted"],
      labels: ["good first issue", "Good-First-Issue"],
      first: 20,
      after: null,
    });
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer t");
  });

  it("asks for no label on All open, and passes the cursor on", async () => {
    const fetchImpl = vi.fn(async (_u: string | URL | Request, _i?: RequestInit) => json(gqlBody([gqlNode(1)])));
    const app = createApp({ env: { GITHUB_TOKEN: "t" }, fetchImpl: fetchImpl as unknown as typeof fetch });
    const { body } = await get(app, "repo=acme/widget&tab=all&after=Y3Vyc29yOnYyOpK0");
    expect(body.hasMore).toBe(false);
    expect(body.next).toBeNull();
    const sent = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));
    expect(sent.variables.labels).toBeNull();
    expect(sent.variables.after).toBe("Y3Vyc29yOnYyOpK0");
    // No labels given: the common spellings.
    expect(sent.variables.gfi).toContain("good first issue");
    expect(sent.variables.help).toContain("help wanted");
  });

  it("answers 429 with resetAt when GraphQL is rate limited, and 404 for a missing repo", async () => {
    const limited = createApp({
      env: { GITHUB_TOKEN: "t" },
      fetchImpl: (async () =>
        json({
          data: { repository: null, rateLimit: { limit: 5000, remaining: 0, resetAt: "2026-09-30T10:00:00Z" } },
          errors: [{ type: "RATE_LIMITED", message: "API rate limit exceeded" }],
        })) as unknown as typeof fetch,
    });
    const a = await get(limited, "repo=acme/widget&tab=gfi");
    expect(a.res.status).toBe(429);
    expect(a.body).toEqual({ error: "rate_limited", resetAt: Date.parse("2026-09-30T10:00:00Z") });

    const missing = createApp({
      env: { GITHUB_TOKEN: "t" },
      fetchImpl: (async () =>
        json({
          data: { repository: null },
          errors: [{ type: "NOT_FOUND", message: "Could not resolve" }],
        })) as unknown as typeof fetch,
    });
    const b = await get(missing, "repo=acme/nothing&tab=gfi");
    expect(b.res.status).toBe(404);
    expect(b.body).toEqual({ error: "repo_not_found" });
  });
});

describe("GET /api/repo-issues without a token (REST)", () => {
  it("ORs label spellings with one request each, merges, de-duplicates, drops PRs and sorts newest first", async () => {
    const byLabel: Record<string, unknown[]> = {
      "good first issue": [
        rest(3, "2026-09-03T00:00:00Z"),
        rest(1, "2026-09-01T00:00:00Z", { assignees: [{ login: "someone" }] }),
        rest(9, "2026-09-09T00:00:00Z", { pull_request: { url: "x" } }),
      ],
      "E-easy": [rest(3, "2026-09-03T00:00:00Z"), rest(5, "2026-09-05T00:00:00Z")],
    };
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (u: string | URL | Request) => {
      const url = new URL(String(u));
      urls.push(url.toString());
      return json(byLabel[url.searchParams.get("labels") ?? ""] ?? [], 200, {
        "x-ratelimit-limit": "60",
        "x-ratelimit-remaining": "57",
      });
    });
    const app = createApp({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const { res, body } = await get(app, "repo=acme/widget&tab=gfi&gfi=good%20first%20issue,E-easy");
    expect(res.status).toBe(200);
    expect(body.via).toBe("rest");
    expect(body.counts).toBeNull();
    expect(body.items.map((i) => i.number)).toEqual([5, 3, 1]);
    expect(body.items.find((i) => i.number === 1)?.assigned).toBe(true);
    expect(body.items.find((i) => i.number === 3)?.assigned).toBe(false);
    expect(body.hasMore).toBe(false);
    expect(body.next).toBeNull();
    expect(body.rateLimit).toMatchObject({ limit: 60, remaining: 57 });

    expect(urls).toHaveLength(2);
    for (const u of urls) {
      const p = new URL(u);
      expect(p.pathname).toBe("/repos/acme/widget/issues");
      expect(Object.fromEntries(p.searchParams)).toMatchObject({
        state: "open",
        per_page: "20",
        page: "1",
        sort: "created",
        direction: "desc",
      });
      // Assigned issues are listed too.
      expect(p.searchParams.has("assignee")).toBe(false);
    }
  });

  it("caps REST label requests at 3 and pages with a page-number cursor", async () => {
    const urls: URL[] = [];
    const full = Array.from({ length: 20 }, (_, i) =>
      rest(100 + i, `2026-08-${String(10 + (i % 18)).padStart(2, "0")}T00:00:00Z`),
    );
    const fetchImpl = vi.fn(async (u: string | URL | Request) => {
      const url = new URL(String(u));
      urls.push(url);
      return json(url.searchParams.get("labels") === "a" ? full : []);
    });
    const app = createApp({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const { body } = await get(app, "repo=acme/widget&tab=help&help=a,b,c,d&after=2");
    expect(urls.map((u) => u.searchParams.get("labels"))).toEqual(["a", "b", "c"]);
    expect(urls.every((u) => u.searchParams.get("page") === "2")).toBe(true);
    expect(body.hasMore).toBe(true);
    expect(body.next).toBe("3");
    expect(body.items).toHaveLength(20);
  });

  it("answers a spent REST quota with 429 JSON and no sample issues", async () => {
    const app = createApp({
      fetchImpl: (async () =>
        json({ message: "API rate limit exceeded" }, 403, {
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": "1790000000",
        })) as unknown as typeof fetch,
    });
    const { res, body } = await get(app, "repo=JuliaLang/julia&tab=all");
    expect(res.status).toBe(429);
    expect(body).toEqual({ error: "rate_limited", resetAt: 1790000000 * 1000 });
  });

  it("answers GitHub failures with 503 JSON, never fixtures", async () => {
    const down = createApp({ fetchImpl: (async () => json({ message: "boom" }, 502)) as unknown as typeof fetch });
    const a = await get(down, "repo=JuliaLang/julia&tab=gfi");
    expect(a.res.status).toBe(503);
    expect(a.body).toEqual({ error: "unavailable" });

    const offline = createApp({
      fetchImpl: (async () => {
        throw new TypeError("fetch failed");
      }) as unknown as typeof fetch,
    });
    const b = await get(offline, "repo=JuliaLang/julia&tab=gfi");
    expect(b.res.status).toBe(503);
    expect(b.body).toEqual({ error: "unavailable" });
  });
});

describe("GET /api/repo-issues validation", () => {
  const fetchImpl = vi.fn(async () => json([]));
  const app = createApp({ fetchImpl: fetchImpl as unknown as typeof fetch });

  it.each([
    ["repo=", "repo"],
    ["repo=acme", "repo"],
    ["repo=acme/widget/extra", "repo"],
    ["repo=../etc", "repo"],
    ["repo=acme/..", "repo"],
    ["repo=https://evil.example/x", "repo"],
    ["repo=acme%2Fwid%3Fget", "repo"],
    ["repo=-acme/widget", "repo"],
    [`repo=${"a".repeat(40)}/widget`, "repo"],
    ["repo=acme/widget&tab=closed", "tab"],
    ["repo=acme/widget&gfi=%22quoted%22", "gfi"],
    [`repo=acme/widget&help=${"x".repeat(51)}`, "help"],
    ["repo=acme/widget&after=%3Cscript%3E", "after"],
  ])("rejects %s", async (qs, field) => {
    const res = await app.request(`/api/repo-issues?${qs}`);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid", field });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("GET /api/repo-issues caching", () => {
  it("serves a repeat from the cache without calling GitHub", async () => {
    const fetchImpl = vi.fn(async () => json(gqlBody([gqlNode(1)])));
    const app = createApp({ env: { GITHUB_TOKEN: "t" }, fetchImpl: fetchImpl as unknown as typeof fetch });
    const first = await app.request("/api/repo-issues?repo=acme/widget&tab=gfi");
    expect(first.headers.get("x-cache")).toBe("miss");
    // The same request, spelled differently (GitHub names ignore case).
    const again = await app.request("/api/repo-issues?repo=ACME/Widget&tab=gfi");
    expect(again.headers.get("x-cache")).toBe("hit");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(((await again.json()) as RepoIssuesResponse).counts?.gfi).toBe(64);
    // Another tab is another entry.
    await app.request("/api/repo-issues?repo=acme/widget&tab=all");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("shares entries between app instances through the Cache API (Worker isolates)", async () => {
    const store = new Map<string, string>();
    const cacheApi: CacheLike = {
      match: async (k) => (store.has(k) ? new Response(store.get(k)) : undefined),
      put: async (k, res) => void store.set(k, await res.text()),
    };
    const fetchImpl = vi.fn(async () => json(gqlBody([gqlNode(1)])));
    const make = () =>
      createApp({
        env: { GITHUB_TOKEN: "t" },
        fetchImpl: fetchImpl as unknown as typeof fetch,
        cache: cacheApiJsonCache(cacheApi),
      });
    await make().request("/api/repo-issues?repo=acme/widget&tab=help");
    const res = await make().request("/api/repo-issues?repo=acme/widget&tab=help");
    expect(res.headers.get("x-cache")).toBe("hit");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect([...store.keys()][0]).toMatch(/^http:\/\/localhost\/__cache\/repo-issues\?/);
  });

  it("never caches an error", async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => (n++ === 0 ? json({}, 502) : json(gqlBody([gqlNode(1)]))));
    const app = createApp({
      env: { GITHUB_TOKEN: "t" },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      cache: memoryJsonCache(),
    });
    expect((await app.request("/api/repo-issues?repo=acme/widget")).status).toBe(503);
    expect((await app.request("/api/repo-issues?repo=acme/widget")).status).toBe(200);
  });
});

describe("GET /api/search?gq= shared cache", () => {
  it("serves live results to another isolate from the shared cache, and never caches samples", async () => {
    const store = new Map<string, string>();
    const cacheApi: CacheLike = {
      match: async (k) => (store.has(k) ? new Response(store.get(k)) : undefined),
      put: async (k, res) => void store.set(k, await res.text()),
    };
    const item = {
      id: 1,
      number: 1,
      title: "t",
      html_url: "https://github.com/a/b/issues/1",
      repository_url: "https://api.github.com/repos/a/b",
      labels: [],
      comments: 0,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
    const ok = vi.fn(async () => json({ total_count: 1, items: [item] }));
    const make = (f: typeof fetch) => createApp({ fetchImpl: f, cache: cacheApiJsonCache(cacheApi) });

    const limited = vi.fn(async () => json({ message: "rate limited" }, 403, { "x-ratelimit-remaining": "0" }));
    const sample = await (
      await make(limited as unknown as typeof fetch).request("/api/search?gq=repo:a/b+is:issue")
    ).json();
    expect(sample.source).toBe("fixtures");
    expect(store.size).toBe(0);

    await make(ok as unknown as typeof fetch).request("/api/search?gq=repo:a/b+is:issue");
    clearGithubCaches();
    const res = await make(limited as unknown as typeof fetch).request("/api/search?gq=repo:a/b+is:issue");
    expect(res.headers.get("x-cache")).toBe("hit");
    expect((await res.json()).source).toBe("github");
  });
});
