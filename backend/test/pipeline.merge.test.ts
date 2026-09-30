import { describe, expect, it } from "vitest";
import type { DatasetMeta, RepoRecord } from "../../shared/repo.js";
import { toRecord } from "../src/pipeline/collect.js";
import { emptyCuration, parseCuration } from "../src/pipeline/curation.js";
import { mergeDatasets, needsResponseSample, withScore } from "../src/pipeline/merge.js";
import { summarizeChanges } from "../src/pipeline/summary.js";
import { validateDataset } from "../src/pipeline/validate.js";
import { serializeMeta, serializeRepos } from "../src/pipeline/write.js";
import { daysAgo, detailNode, NOW, responseIssues } from "./pipelineFixtures.js";

const record = (fullName: string, over: Partial<RepoRecord> = {}, at = NOW): RepoRecord => ({
  ...toRecord(detailNode(fullName), at, responseIssues(4)),
  ...over,
});

const merge = (over: Partial<Parameters<typeof mergeDatasets>[0]> = {}) =>
  mergeDatasets({
    previous: [],
    previousMeta: null,
    collected: [],
    scope: "full",
    now: NOW,
    pointsUsed: 12,
    curation: emptyCuration(),
    ...over,
  });

describe("mergeDatasets", () => {
  it("sets the bootstrap marker on the first run and keeps it afterwards", () => {
    const first = merge({ collected: [record("a/one")] });
    expect(first.meta.bootstrapAt).toBe(NOW.toISOString());
    expect(first.repos[0].firstSeenAt).toBe(NOW.toISOString());

    const later = new Date(NOW.getTime() + 3 * 86_400_000);
    const second = merge({
      previous: first.repos,
      previousMeta: first.meta,
      collected: [record("a/one", {}, later), record("a/two", {}, later)],
      now: later,
    });
    expect(second.meta.bootstrapAt).toBe(NOW.toISOString());
    expect(second.meta.generatedAt).toBe(later.toISOString());
    const byName = Object.fromEntries(second.repos.map((r) => [r.fullName, r]));
    expect(byName["a/one"].firstSeenAt).toBe(NOW.toISOString());
    expect(byName["a/two"].firstSeenAt).toBe(later.toISOString());
  });

  it("clamps commit dates from a committer clock that is ahead to the collection time", () => {
    const future = new Date(NOW.getTime() + 5 * 86_400_000).toISOString();
    const { repos, meta } = merge({ collected: [record("a/one", { lastCommitAt: future })] });
    expect(repos[0].lastCommitAt).toBe(NOW.toISOString());
    expect(validateDataset(serializeRepos(repos), serializeMeta(meta), emptyCuration())).toEqual([]);
  });

  it("reuses response samples younger than 7 days", () => {
    const prev = record("a/one", { responseHours: 9, responseSampledAt: daysAgo(3) });
    const stale = record("a/two", { responseHours: 9, responseSampledAt: daysAgo(8) });
    expect(needsResponseSample(prev, NOW.getTime())).toBe(false);
    expect(needsResponseSample(stale, NOW.getTime())).toBe(true);
    expect(needsResponseSample(undefined, NOW.getTime())).toBe(true);

    const unsampled = { responseHours: null, responseSampledAt: null };
    const { repos } = merge({
      previous: [prev, stale],
      collected: [record("a/one", unsampled), record("a/two", unsampled)],
    });
    expect(repos.find((r) => r.fullName === "a/one")).toMatchObject({
      responseHours: 9,
      responseSampledAt: daysAgo(3),
    });
    expect(repos.find((r) => r.fullName === "a/two")).toMatchObject({ responseHours: null, responseSampledAt: null });
  });

  it("full runs drop what wasn't collected; partial runs keep what they didn't cover", () => {
    const previous = [record("a/rust", { language: "rust" }), record("b/go", { language: "go" })];
    expect(merge({ previous, collected: [record("c/new")] }).repos.map((r) => r.fullName)).toEqual(["c/new"]);
    const partial = merge({
      previous,
      collected: [],
      scope: "partial",
      covers: (r) => r.language === "rust",
    });
    expect(partial.repos.map((r) => r.fullName)).toEqual(["b/go"]);
    expect(partial.meta.scope).toBe("partial");
  });

  it("applies curation: exclude, curated flag, field overrides", () => {
    const curation = parseCuration("include: [a/tiny]\nexclude: [a/spam]\nfields:\n  a/one: [ml]\n");
    const { repos } = merge({
      curation,
      collected: [record("a/one"), record("a/spam"), record("a/tiny", { stars: 2 })],
    });
    expect(repos.map((r) => [r.fullName, r.curated, r.fields])).toEqual([
      ["a/tiny", true, ["cli"]],
      ["a/one", false, ["ml"]],
    ]);
  });

  it("re-scores at now, drops gate failures and caps non-curated repos by score", () => {
    const { repos, dropped, meta } = merge({
      collected: [
        record("a/best", { goodFirstIssues: 30 }),
        record("a/ok"),
        record("a/stale", { lastCommitAt: daysAgo(400) }),
        record("a/dead", { archived: true }),
      ],
      limit: 1,
    });
    expect(repos.map((r) => r.fullName)).toEqual(["a/best"]);
    expect(repos[0].score).toBe(withScore(repos[0], NOW.getTime()).record.score);
    expect(repos[0].score).toBeGreaterThan(0);
    expect(dropped).toEqual([
      { fullName: "a/stale", gates: ["stale"] },
      { fullName: "a/dead", gates: ["archived"] },
    ]);
    expect(meta).toMatchObject({ count: 1, pointsUsed: 12, languages: { rust: 1 } });
  });
});

describe("validateDataset", () => {
  const good = merge({ collected: [record("b/two"), record("a/one", { language: null })] });
  const text = serializeRepos(good.repos);
  const metaText = serializeMeta(good.meta);

  it("accepts the writer's output", () => {
    expect(text.split("\n")[1]).toMatch(/^\{"fullName":"a\/one",/);
    expect(validateDataset(text, metaText, emptyCuration())).toEqual([]);
  });

  it("flags tampered scores, broken records and unsorted files", () => {
    const tampered = good.repos.map((r) => ({ ...r, score: r.score + 1 }));
    expect(validateDataset(serializeRepos(tampered), metaText, emptyCuration()).join("\n")).toMatch(/recomputes/);

    const broken = [{ ...good.repos[0], stars: "many", fields: ["nope"] }] as unknown as RepoRecord[];
    expect(validateDataset(JSON.stringify(broken), metaText, emptyCuration()).join("\n")).toMatch(
      /stars has the wrong type/,
    );

    const unsorted = `[\n${[...good.repos]
      .reverse()
      .map((r) => JSON.stringify(r))
      .join(",\n")}\n]\n`;
    expect(validateDataset(unsorted, metaText, emptyCuration()).join("\n")).toMatch(/canonical/);

    const dup = serializeRepos([good.repos[0], good.repos[0]]);
    expect(validateDataset(dup, metaText, emptyCuration()).join("\n")).toMatch(/listed twice/);
  });

  it("checks curation and meta", () => {
    expect(validateDataset(text, metaText, parseCuration("exclude: [a/one]")).join("\n")).toMatch(/excluded/);
    expect(validateDataset(text, metaText, parseCuration("include: [a/one]")).join("\n")).toMatch(/curated flag/);
    const meta: DatasetMeta = { ...good.meta, count: 5 };
    expect(validateDataset(text, serializeMeta(meta), emptyCuration()).join("\n")).toMatch(/meta.json/);
    expect(validateDataset(null, metaText, emptyCuration())).toEqual(["data/repos.json is missing"]);
    expect(validateDataset("{", metaText, emptyCuration())[0]).toMatch(/not valid JSON/);
  });
});

describe("summarizeChanges", () => {
  it("lists added, removed and score movers", () => {
    const before = [record("a/kept", { score: 50 }), record("a/gone")];
    const after = [record("a/kept", { score: 70 }), record("a/new")];
    const md = summarizeChanges(before, after, null);
    expect(md).toContain("**2 repos** (+0)");
    expect(md).toMatch(/### Added \(1\)\n\n- \[a\/new\]/);
    expect(md).toMatch(/### Removed \(1\)\n\n- \[a\/gone\]/);
    expect(md).toContain("| [a/kept](https://github.com/a/kept) | 50 → 70 | +20 |");
  });
});
