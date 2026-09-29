import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyOverrides, createApp } from "../src/app.js";
import { clearGithubCaches } from "../src/github/client.js";
import { excerpt } from "../src/github/normalize.js";
import { MAX_GQ_LEN, parsedFromGithubQuery } from "../src/github/query.js";
import { coerceLlmOutput } from "../src/parse/llm.js";
import { domainMatchById, emptyQuery, parseQuery as parseRules } from "../../shared/parse.js";
import type { SearchResponse } from "../src/types.js";

const ghItem = {
  id: 1,
  number: 42,
  title: "Fix the thing",
  html_url: "https://github.com/acme/db/issues/42",
  repository_url: "https://api.github.com/repos/acme/db",
  labels: [{ name: "good first issue", color: "7057ff" }],
  comments: 2,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
  body: "<!-- template -->\n## Summary\nThe **database** crashes. See [docs](https://x.y).",
  user: { login: "alice" },
};

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

beforeEach(() => clearGithubCaches());

describe("GET /api/health", () => {
  it("reports config flags", async () => {
    const app = createApp({ env: { GITHUB_TOKEN: "t" } });
    const res = await app.request("/api/health");
    expect(await res.json()).toEqual({
      ok: true,
      llm: false,
      githubToken: true,
      db: false,
      auth: false,
      newsletter: false,
    });
  });
});

describe("GET /api/parse", () => {
  it("uses rules when no API key", async () => {
    const res = await createApp().request("/api/parse?q=easy%20golang%20kubernetes%20bugs");
    const body = await res.json();
    expect(body).toMatchObject({ languages: ["go"], difficulty: "beginner", types: ["bug"], interpretedBy: "rules" });
    expect(body.domains[0].id).toBe("devops");
  });

  it("emits maxComments and since (shared parser)", async () => {
    const res = await createApp().request("/api/parse?q=issues+with+less+than+5+comments+in+go+this+week");
    const body = await res.json();
    expect(body).toMatchObject({
      languages: ["go"],
      maxComments: 5,
      since: "week",
      keywords: [],
      interpretedBy: "rules",
    });
    const none = await (await createApp().request("/api/parse?q=unanswered%20python%20bugs")).json();
    expect(none.maxComments).toBe(0);
    expect(none.since).toBeNull();
  });

  it("returns exactly what the frontend's parser returns for the same text", async () => {
    const q = "beginner friendly rust issues in databases, fewer than 3 comments, recent";
    const body = await (await createApp().request(`/api/parse?q=${encodeURIComponent(q)}`)).json();
    expect(body).toEqual({ ...parseRules(q), interpretedBy: "rules" });
  });
});

describe("GET /api/search activity filters", () => {
  it("adds comments:/created: qualifiers from q, and maxComments/since params override them", async () => {
    const app = createApp();
    const a = (await (
      await app.request("/api/search?q=go+with+no+comments+this+month&demo=1")
    ).json()) as SearchResponse;
    expect(a.parsed).toMatchObject({ maxComments: 0, since: "month" });
    expect(a.githubQuery).toMatch(/ comments:0 created:>\d{4}-\d{2}-\d{2}$/);

    const b = (await (
      await app.request("/api/search?q=go+with+no+comments+this+month&demo=1&maxComments=4&since=")
    ).json()) as SearchResponse;
    expect(b.parsed).toMatchObject({ maxComments: 4, since: null });
    expect(b.githubQuery).toContain("comments:<4");
    expect(b.githubQuery).not.toContain("created:");
  });
});

describe("GET /api/search", () => {
  it("serves fixtures with demo=1, filtered by language", async () => {
    const fetchImpl = vi.fn();
    const app = createApp({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const res = await app.request("/api/search?q=rust%20databases&demo=1");
    const body = (await res.json()) as SearchResponse;
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(body.source).toBe("fixtures");
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items.every((i) => i.repo.language === "Rust")).toBe(true);
    expect(body.items[0].bodyExcerpt.toLowerCase()).toMatch(/database|sql/);
    expect(body.githubQuery).toContain("language:rust");
  });

  it("calls GitHub and normalizes results", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ total_count: 1, items: [ghItem] }, 200, {
        "x-ratelimit-limit": "10",
        "x-ratelimit-remaining": "9",
        "x-ratelimit-reset": "123",
      }),
    );
    const app = createApp({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const res = await app.request("/api/search?q=beginner%20rust%20databases&sort=newest&page=2");
    const body = (await res.json()) as SearchResponse;
    expect(body.source).toBe("github");
    expect(body.total).toBe(1);
    expect(body.rateLimit).toEqual({ limit: 10, remaining: 9, reset: 123 });
    expect(body.items[0]).toMatchObject({
      number: 42,
      author: "alice",
      repo: { fullName: "acme/db", owner: "acme", url: "https://github.com/acme/db" },
      labels: [{ name: "good first issue", color: "7057ff" }],
    });
    expect(body.items[0].bodyExcerpt).toBe("Summary The database crashes. See docs.");
    const url = new URL((fetchImpl.mock.calls[0] as unknown as [string])[0]);
    expect(url.searchParams.get("q")).toBe(body.githubQuery);
    expect(url.searchParams.get("sort")).toBe("created");
    expect(url.searchParams.get("page")).toBe("2");
  });

  it("caches identical searches", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ total_count: 0, items: [] }));
    const app = createApp({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await app.request("/api/search?q=python%20cli");
    await app.request("/api/search?q=python%20cli");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("enriches stars when a token is present", async () => {
    const fetchImpl = vi.fn(async (input: string) =>
      input.includes("/search/issues")
        ? jsonResponse({ total_count: 1, items: [ghItem] })
        : jsonResponse({ stargazers_count: 1234, language: "Rust" }),
    );
    const app = createApp({ env: { GITHUB_TOKEN: "tok" }, fetchImpl: fetchImpl as unknown as typeof fetch });
    const body = (await (await app.request("/api/search?q=rust")).json()) as SearchResponse;
    expect(body.items[0].repo.stars).toBe(1234);
    expect(body.items[0].repo.language).toBe("Rust");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("falls back to fixtures on rate limit", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ message: "API rate limit exceeded" }, 403, { "x-ratelimit-remaining": "0" }),
    );
    const app = createApp({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const body = (await (await app.request("/api/search?q=go%20kubernetes")).json()) as SearchResponse;
    expect(body.source).toBe("fixtures");
    expect(body.warning).toMatch(/rate limit/);
    expect(body.rateLimit?.remaining).toBe(0);
    expect(body.items.every((i) => i.repo.language === "Go")).toBe(true);
  });

  it("falls back to fixtures on network error", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const app = createApp({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const body = (await (await app.request("/api/search?q=anything")).json()) as SearchResponse;
    expect(body.source).toBe("fixtures");
    expect(body.items.length).toBeGreaterThan(0);
  });

  it("explicit filter params override parsed ones", async () => {
    const app = createApp();
    const body = (await (
      await app.request(
        "/api/search?q=beginner%20rust%20database%20bugs&demo=1&lang=golang,python&difficulty=&type=docs",
      )
    ).json()) as SearchResponse;
    expect(body.parsed?.languages).toEqual(["go", "python"]);
    expect(body.parsed?.difficulty).toBeNull();
    expect(body.parsed?.types).toEqual(["docs"]);
    expect(body.githubQuery).not.toContain("good first issue");
    expect(body.githubQuery).toContain("label:documentation");
  });

  it("sets CORS headers for localhost origins only", async () => {
    const app = createApp();
    const ok = await app.request("/api/health", { headers: { Origin: "http://localhost:5173" } });
    expect(ok.headers.get("access-control-allow-origin")).toBe("http://localhost:5173");
    const bad = await app.request("/api/health", { headers: { Origin: "https://evil.example" } });
    expect(bad.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("GET /api/search?gq= (raw GitHub query)", () => {
  const gq = 'is:issue is:open no:assignee label:"good first issue" language:rust database';

  it("runs the exact query without parsing and returns parsed: null", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ total_count: 1, items: [ghItem] }));
    const app = createApp({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const res = await app.request(`/api/search?gq=${encodeURIComponent(gq)}&q=ignored%20python&lang=go&page=3`);
    const body = (await res.json()) as SearchResponse;
    expect(res.status).toBe(200);
    expect(body.parsed).toBeNull();
    expect(body.githubQuery).toBe(gq);
    expect(body.source).toBe("github");
    const url = new URL((fetchImpl.mock.calls[0] as unknown as [string])[0]);
    expect(url.searchParams.get("q")).toBe(gq);
    expect(url.searchParams.get("page")).toBe("3");
  });

  it("honours order= for explicit sorts (fewest comments first)", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ total_count: 0, items: [] }));
    const app = createApp({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await app.request(`/api/search?gq=${encodeURIComponent(gq)}&sort=comments&order=asc`);
    const url = new URL((fetchImpl.mock.calls[0] as unknown as [string])[0]);
    expect(url.searchParams.get("sort")).toBe("comments");
    expect(url.searchParams.get("order")).toBe("asc");
  });

  it("uses the server token and enriches stars", async () => {
    const fetchImpl = vi.fn(async (input: string, _init?: RequestInit) =>
      input.includes("/search/issues")
        ? jsonResponse({ total_count: 1, items: [ghItem] })
        : jsonResponse({ stargazers_count: 7, language: "Rust" }),
    );
    const app = createApp({ env: { GITHUB_TOKEN: "srv" }, fetchImpl: fetchImpl as unknown as typeof fetch });
    const body = (await (await app.request(`/api/search?gq=${encodeURIComponent(gq)}`)).json()) as SearchResponse;
    const init = fetchImpl.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer srv");
    expect(body.items[0].repo.stars).toBe(7);
  });

  it("clamps very long queries at a word boundary", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ total_count: 0, items: [] }));
    const app = createApp({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const long = "is:issue " + "keyword ".repeat(200);
    const body = (await (await app.request(`/api/search?gq=${encodeURIComponent(long)}`)).json()) as SearchResponse;
    expect(body.githubQuery.length).toBeLessThanOrEqual(MAX_GQ_LEN);
    expect(body.githubQuery.endsWith("keyword")).toBe(true);
  });

  it("surfaces GitHub 422 as a 422 instead of fixtures", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ message: "Validation Failed" }, 422));
    const app = createApp({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const res = await app.request(`/api/search?gq=${encodeURIComponent("is:issue label:")}`);
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ kind: "invalid" });
  });

  it("falls back to fixtures ranked from the raw query on rate limit", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ message: "rate limited" }, 429, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "999" }),
    );
    const app = createApp({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const body = (await (await app.request(`/api/search?gq=${encodeURIComponent(gq)}`)).json()) as SearchResponse;
    expect(body.source).toBe("fixtures");
    expect(body.parsed).toBeNull();
    expect(body.fallbackReason).toBe("rate-limit");
    expect(body.rateLimit).toMatchObject({ remaining: 0, reset: 999 });
    expect(body.items.every((i) => i.repo.language === "Rust")).toBe(true);
  });

  it("reports fallbackReason=unavailable on network errors", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const app = createApp({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const body = (await (await app.request(`/api/search?gq=${encodeURIComponent(gq)}`)).json()) as SearchResponse;
    expect(body.fallbackReason).toBe("unavailable");
  });

  it("treats an empty gq= as absent (falls back to q parsing)", async () => {
    const app = createApp();
    const body = (await (await app.request("/api/search?gq=&q=rust&demo=1")).json()) as SearchResponse;
    expect(body.parsed?.languages).toEqual(["rust"]);
  });
});

describe("parsedFromGithubQuery", () => {
  it("recovers languages, difficulty, types and domains", () => {
    const p = parsedFromGithubQuery(
      'is:issue is:open no:assignee archived:false label:"help wanted" -label:"good first issue" language:cpp language:go label:bug database in:title,body',
    );
    expect(p.languages).toEqual(["cpp", "go"]);
    expect(p.difficulty).toBe("intermediate");
    expect(p.types).toEqual(["bug"]);
    expect(p.domains.map((d) => d.id)).toEqual(["databases"]);
  });

  it("reads comments: ceilings", () => {
    expect(parsedFromGithubQuery("is:issue comments:<5").maxComments).toBe(5);
    expect(parsedFromGithubQuery("is:issue comments:0").maxComments).toBe(0);
    expect(parsedFromGithubQuery("is:issue").maxComments).toBeNull();
  });
});

describe("applyOverrides", () => {
  it("leaves parsed values when params are absent", () => {
    const p = parseRules("easy rust databases");
    expect(applyOverrides(p, {})).toEqual(p);
  });
  it("can clear and replace domains and keywords", () => {
    const p = parseRules("rust databases tokio");
    const o = applyOverrides(p, { domain: "security,nope", keywords: "" });
    expect(o.domains.map((d) => d.id)).toEqual(["security"]);
    expect(o.keywords).toEqual([]);
  });
});

describe("coerceLlmOutput", () => {
  it("normalizes and validates model output", () => {
    const p = coerceLlmOutput({
      languages: ["Golang", "C++", 5],
      domains: ["databases", "made-up"],
      difficulty: "none",
      types: ["bug", "chore"],
      keywords: ["React", "react", "x", "y", "z"],
      maxComments: 3,
      since: "week",
    });
    expect(p).toEqual({
      ...emptyQuery(),
      languages: ["go", "cpp"],
      domains: [domainMatchById("databases")],
      difficulty: null,
      types: ["bug"],
      keywords: ["react", "x", "y"],
      maxComments: 3,
      since: "week",
    });
  });
});

describe("excerpt", () => {
  it("truncates long bodies", () => {
    const e = excerpt("word ".repeat(200), 50);
    expect(e.length).toBeLessThanOrEqual(50);
    expect(e.endsWith("…")).toBe(true);
  });
});
