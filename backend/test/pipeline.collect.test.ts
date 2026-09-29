import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RepoRecord } from "../../shared/repo.js";
import { runCollect, runValidate, parseArgs } from "../src/pipeline/cli.js";
import { collect, searchPages, selectCandidates } from "../src/pipeline/collect.js";
import { emptyCuration, parseCuration } from "../src/pipeline/curation.js";
import { GraphQLClient } from "../src/pipeline/graphql.js";
import { buildDetailQuery, medianResponseHours, SEARCH_PAGE_SIZE, SEARCH_QUERY } from "../src/pipeline/queries.js";
import { daysAgo, detailNode, fakeGithub, NOW, responseIssues, searchNode } from "./pipelineFixtures.js";

const quiet = () => {};
const noSleep = () => Promise.resolve();
const client = (f: typeof fetch) => new GraphQLClient({ token: "t", fetchImpl: f, sleep: noSleep });

describe("search pagination", () => {
  it("follows endCursor until the last page or maxPages", async () => {
    const nodes = Array.from({ length: 120 }, (_, i) => searchNode(`o/r${i}`));
    const gh = fakeGithub({ search: () => nodes });
    const all = await searchPages(client(gh.fetch), "q", 5);
    expect(all.nodes).toHaveLength(120);
    expect(all.total).toBe(120);
    expect(gh.calls.map((c) => c.variables.after)).toEqual([
      null,
      `cursor${SEARCH_PAGE_SIZE}`,
      `cursor${SEARCH_PAGE_SIZE * 2}`,
    ]);
    expect(gh.calls[0].query).toBe(SEARCH_QUERY);

    const capped = await searchPages(client(fakeGithub({ search: () => nodes }).fetch), "q", 1);
    expect(capped.nodes).toHaveLength(SEARCH_PAGE_SIZE);
  });

  it("splits a big language into star buckets", async () => {
    const big = Array.from({ length: 300 }, (_, i) => searchNode(`o/r${i}`));
    const gh = fakeGithub({ search: (q) => (q.includes("stars:>=30") ? big : big.slice(0, 10)) });
    await collect({
      client: client(gh.fetch),
      now: NOW,
      curation: emptyCuration(),
      previous: [],
      languages: ["rust"],
      limit: 0,
      log: quiet,
    });
    const queries = gh.calls.map((c) => String(c.variables.q));
    expect(queries[0]).toContain(
      "language:rust good-first-issues:>=2 stars:>=30 pushed:>2026-03-05 archived:false fork:false",
    );
    expect(queries.filter((q) => /stars:\d+\.\.\d+|stars:>=5000/.test(q))).toHaveLength(5);
  });
});

describe("selectCandidates", () => {
  it("guarantees a few per language, then ranks globally", () => {
    const pool = [
      ...Array.from({ length: 5 }, (_, i) => ({ fullName: `js/r${i}`, language: "javascript", prescore: 90 - i })),
      { fullName: "zig/a", language: "zig", prescore: 10 },
      { fullName: "zig/b", language: "zig", prescore: 5 },
    ];
    expect(selectCandidates(pool, 4, 1).map((c) => c.fullName)).toEqual(["js/r0", "zig/a", "js/r1", "js/r2"]);
    expect(selectCandidates(pool, 3, 0).map((c) => c.fullName)).toEqual(["js/r0", "js/r1", "js/r2"]);
  });
});

describe("queries", () => {
  it("aliases each repo and adds an issue search only when sampling responses", () => {
    const q = buildDetailQuery(
      [
        { owner: "a", name: "b", sampleResponse: true },
        { owner: "c", name: "d", sampleResponse: false },
      ],
      NOW,
    );
    expect(q).toContain('r0: repository(owner: "a", name: "b")');
    expect(q).toContain('r1: repository(owner: "c", name: "d")');
    expect(q).toContain(
      's0: search(type: ISSUE, query: "repo:a/b is:issue created:2026-06-03..2026-08-30 sort:created-desc"',
    );
    expect(q).not.toContain("s1:");
    expect(q).toContain("HEAD:.github/CONTRIBUTING.md");
  });

  it("medianResponseHours ignores maintainers, bots and too-new issues, and caps unanswered ones", () => {
    const now = NOW.getTime();
    expect(medianResponseHours(responseIssues(6), now)).toBe(6);
    const issues = [
      ...responseIssues(2).slice(0, 2),
      { ...responseIssues(1)[0], authorAssociation: "MEMBER" },
      { ...responseIssues(1)[0], author: { __typename: "Bot", login: "dependabot" } },
      { ...responseIssues(1)[0], createdAt: daysAgo(1) },
      { ...responseIssues(1)[0], createdAt: daysAgo(20), comments: { nodes: [] } },
      { ...responseIssues(1)[0], createdAt: daysAgo(5), comments: { nodes: [] } },
    ];
    // samples: 2, 2, 720 → median 2
    expect(medianResponseHours(issues, now)).toBe(2);
    expect(medianResponseHours(responseIssues(3).slice(0, 2), now)).toBeNull();
  });
});

describe("runCollect", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "opensrc-data-"));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  const search = () => [
    searchNode("acme/tool"),
    searchNode("acme/archived", { isArchived: true }),
    searchNode("acme/unlicensed", { licenseInfo: null }),
    searchNode("acme/spam"),
    searchNode("acme/gone"),
  ];
  const details = {
    "acme/tool": detailNode("acme/tool"),
    "acme/spam": detailNode("acme/spam"),
    "friends/tiny": detailNode("friends/tiny", { stargazerCount: 3 }),
  };

  it("collects, applies curation, writes a valid dataset", async () => {
    await writeFile(
      join(dir, "curation.yml"),
      "include:\n  - friends/tiny\nexclude:\n  - repo: acme/spam\n    reason: spam\nfields:\n  acme/tool: [devtools]\n",
    );
    const gh = fakeGithub({ search, details, responseHours: 5, cost: 2 });
    const summary = await runCollect(
      { dryRun: false, dataDir: dir, languages: undefined },
      { token: "t", fetchImpl: gh.fetch, now: NOW, log: quiet, sleep: noSleep },
    );
    const repos = JSON.parse(await readFile(join(dir, "repos.json"), "utf8")) as RepoRecord[];
    const meta = JSON.parse(await readFile(join(dir, "meta.json"), "utf8"));
    expect(repos.map((r) => r.fullName)).toEqual(["acme/tool", "friends/tiny"]);
    const tool = repos[0];
    expect(tool.fields).toEqual(["devtools"]);
    expect(tool.language).toBe("rust");
    expect(tool.responseHours).toBe(5);
    expect(tool.gfiUnassigned).toBe(5);
    expect(tool.gfiUnanswered).toBe(2);
    expect(tool.contributingUrl).toBe("https://github.com/acme/tool/blob/HEAD/CONTRIBUTING.md");
    expect(repos[1].curated).toBe(true); // 3 stars, but curated
    expect(meta.bootstrapAt).toBe(NOW.toISOString());
    expect(meta.pointsUsed).toBe(summary.pointsUsed);
    expect(summary.pointsUsed).toBeGreaterThan(0);
    expect(await runValidate(dir)).toEqual([]);
    // One repo per line.
    expect((await readFile(join(dir, "repos.json"), "utf8")).split("\n")).toHaveLength(5);
  });

  it("dry-run writes nothing", async () => {
    const gh = fakeGithub({ search, details });
    const s = await runCollect(
      { dryRun: true, dataDir: dir },
      { token: "t", fetchImpl: gh.fetch, now: NOW, log: quiet },
    );
    expect(s.written).toBe(false);
    await expect(readFile(join(dir, "repos.json"), "utf8")).rejects.toThrow();
  });

  it("a rate-limit abort partway writes nothing", async () => {
    await writeFile(join(dir, "repos.json"), "[]\n");
    await writeFile(join(dir, "meta.json"), "{}\n");
    // Plenty of budget for the first search page, then it drops below the floor partway through.
    const gh = fakeGithub({ search, details, remaining: [4000, 150] });
    await expect(
      runCollect({ dryRun: false, dataDir: dir }, { token: "t", fetchImpl: gh.fetch, now: NOW, log: quiet }),
    ).rejects.toMatchObject({ name: "RateLimitAbort" });
    expect(await readFile(join(dir, "repos.json"), "utf8")).toBe("[]\n");
    expect(await readFile(join(dir, "meta.json"), "utf8")).toBe("{}\n");
  });

  it("--only refreshes just those repos and keeps the rest", async () => {
    const gh = fakeGithub({ search, details });
    await runCollect({ dryRun: false, dataDir: dir }, { token: "t", fetchImpl: gh.fetch, now: NOW, log: quiet });
    const later = new Date(NOW.getTime() + 86_400_000);
    const gh2 = fakeGithub({ details: { "acme/spam": detailNode("acme/spam") } });
    await runCollect(
      { dryRun: false, dataDir: dir, only: ["acme/spam"] },
      { token: "t", fetchImpl: gh2.fetch, now: later, log: quiet },
    );
    const repos = JSON.parse(await readFile(join(dir, "repos.json"), "utf8")) as RepoRecord[];
    expect(repos.map((r) => r.fullName)).toEqual(["acme/spam", "acme/tool"]);
    expect(repos.find((r) => r.fullName === "acme/tool")!.firstSeenAt).toBe(NOW.toISOString());
    expect(repos.find((r) => r.fullName === "acme/spam")!.firstSeenAt).toBe(NOW.toISOString());
    expect(gh2.calls).toHaveLength(1); // no search, and a fresh response sample is reused
    expect(gh2.calls[0].query).not.toContain("s0:");
    expect(await runValidate(dir)).toEqual([]);
  });
});

describe("parseArgs", () => {
  it("reads flags", () => {
    const { command, args } = parseArgs(
      ["collect", "--dry-run", "--limit", "300", "--only=a/b,c/d", "--languages", "rust,go"],
      "/data",
    );
    expect(command).toBe("collect");
    expect(args).toEqual({
      dryRun: true,
      limit: 300,
      only: ["a/b", "c/d"],
      languages: ["rust", "go"],
      dataDir: "/data",
    });
    expect(() => parseArgs(["collect", "--languages", "klingon"], "/d")).toThrow(/unknown id/);
    expect(() => parseArgs(["collect", "--only", "nope"], "/d")).toThrow(/owner\/name/);
    expect(() => parseArgs(["collect", "--limit", "0"], "/d")).toThrow(/positive/);
  });
});

describe("curation", () => {
  it("parses include/exclude/fields in both forms", () => {
    const c = parseCuration(`
include:
  - a/b
  - { repo: c/d, fields: [cli, databases] }
exclude:
  - e/f
  - repo: g/h
    reason: spam
fields:
  A/B: [ml]
`);
    expect(c.include).toEqual([{ repo: "a/b" }, { repo: "c/d", fields: ["cli", "databases"] }]);
    expect(c.exclude).toEqual([{ repo: "e/f" }, { repo: "g/h", reason: "spam" }]);
    expect(c.fields).toEqual({ "c/d": ["cli", "databases"], "a/b": ["ml"] });
    expect(parseCuration("")).toEqual(emptyCuration());
  });

  it("rejects bad entries", () => {
    expect(() => parseCuration("include:\n  - not-a-repo\n")).toThrow(/owner\/name/);
    expect(() => parseCuration("fields:\n  a/b: [nope]\n")).toThrow(/unknown field/);
    expect(() => parseCuration("include: [a/b]\nexclude: [A/B]\n")).toThrow(/both/);
    expect(() => parseCuration("includes: []\n")).toThrow(/unknown key/);
    expect(() => parseCuration("include: [a/b\n")).toThrow(/invalid YAML/);
  });

  it("the committed curation.yml parses", async () => {
    const text = await readFile(new URL("../../data/curation.yml", import.meta.url), "utf8");
    expect(parseCuration(text).include.length).toBeGreaterThanOrEqual(15);
  });
});
