// Server-only query helpers. The shared parser and GitHub query builder are
// tested once, in shared/parse.test.ts (run from the repo root).
import { describe, expect, it } from "vitest";
import { buildGitHubQuery, parsedFromGithubQuery, sortParams } from "../src/github/query.js";
import { emptyQuery } from "../../shared/parse.js";

describe("buildGithubQuery", () => {
  it("round-trips comma label lists through parsedFromGithubQuery", () => {
    const p = parsedFromGithubQuery(buildGitHubQuery({ ...emptyQuery(), types: ["bug", "docs", "feature", "tests"] }));
    expect(p.types).toEqual(["bug", "docs", "feature", "tests"]);
  });

  it("is the shared builder (identical output to the frontend)", async () => {
    const shared = await import("../../shared/parse.js");
    expect(buildGitHubQuery).toBe(shared.buildGitHubQuery);
  });
});

describe("sortParams", () => {
  it("maps sort modes", () => {
    expect(sortParams("best")).toEqual({});
    expect(sortParams("newest")).toEqual({ sort: "created", order: "desc" });
    expect(sortParams("comments")).toEqual({ sort: "comments", order: "desc" });
  });
});
