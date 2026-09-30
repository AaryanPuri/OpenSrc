/**
 * A repo page's live issues:
 *
 *   GET /api/repo-issues?repo=owner/name&tab=gfi|help|all&gfi=<labels>&help=<labels>&after=<cursor>
 *
 * - `gfi` and `help` are comma lists of the label spellings the repo uses for each tab
 *   (OR-ed, at most 5 each, each at most 50 characters); absent means the common spellings.
 * - Answers `{ items, hasMore, next, counts: { all, gfi, help } | null, labels, source: "github",
 *   via, rateLimit? }`. Items are every open issue of the tab, assigned or not (`assigned`
 *   says which), never pull requests, newest first, in the same Issue shape as /api/search.
 * - With GITHUB_TOKEN: one GraphQL request (exact counts for all three tabs). Without: the
 *   REST issues list, one request per spelling, and `counts: null`.
 * - Errors are JSON and never sample data: 400 `{ error: "invalid", field }`, 404
 *   `{ error: "repo_not_found" }`, 429 `{ error: "rate_limited", resetAt }` (epoch ms, or null),
 *   503 `{ error: "unavailable" }`.
 * - Answers are cached for REPO_ISSUES_TTL_MS in the shared cache (all Worker isolates).
 */
import type { Hono } from "hono";
import {
  isIssueTab,
  isValidCursor,
  loadRepoIssues,
  parseLabelParam,
  parseRepoName,
  RepoIssuesError,
  tabLabels,
  type RepoIssuesResponse,
} from "../../../shared/repoIssues.js";
import type { AppEnv, Deps } from "../context.js";
import { cacheKey, type JsonCache } from "../sharedCache.js";

/** Short, so the numbers stay close to what GitHub shows right now. */
export const REPO_ISSUES_TTL_MS = 90_000;

export function registerRepoIssues(app: Hono<AppEnv>, deps: Deps, cache: () => JsonCache): void {
  app.get("/api/repo-issues", async (c) => {
    const repo = parseRepoName(c.req.query("repo"));
    if (!repo) return c.json({ error: "invalid", field: "repo" }, 400);
    const tabParam = c.req.query("tab") ?? "gfi";
    if (!isIssueTab(tabParam)) return c.json({ error: "invalid", field: "tab" }, 400);
    const gfi = parseLabelParam(c.req.query("gfi"));
    if (gfi === null) return c.json({ error: "invalid", field: "gfi" }, 400);
    const help = parseLabelParam(c.req.query("help"));
    if (help === null) return c.json({ error: "invalid", field: "help" }, 400);
    const after = c.req.query("after")?.trim() || null;
    if (after && !isValidCursor(after)) return c.json({ error: "invalid", field: "after" }, 400);

    const labels = { gfi: gfi?.length ? gfi : tabLabels([], "gfi"), help: help?.length ? help : tabLabels([], "help") };
    const token = deps.env(c).GITHUB_TOKEN;
    const key = cacheKey(new URL(c.req.url).origin, "repo-issues", {
      repo: `${repo.owner}/${repo.name}`.toLowerCase(),
      tab: tabParam,
      gfi: labels.gfi.join(",").toLowerCase(),
      help: labels.help.join(",").toLowerCase(),
      after,
      via: token ? "graphql" : "rest",
    });

    const hit = await cache().get<RepoIssuesResponse>(key);
    if (hit) return c.json(hit, 200, { "x-cache": "hit" });

    try {
      const body = await loadRepoIssues({
        ...repo,
        tab: tabParam,
        labels,
        after,
        token,
        fetchImpl: deps.fetchImpl,
        userAgent: "opensrc",
      });
      await cache().put(key, body, REPO_ISSUES_TTL_MS);
      return c.json(body, 200, { "x-cache": "miss" });
    } catch (err) {
      const e = err instanceof RepoIssuesError ? err : null;
      if (e?.kind === "rate_limited") return c.json({ error: "rate_limited", resetAt: e.resetAt ?? null }, 429);
      if (e?.kind === "not_found") return c.json({ error: "repo_not_found" }, 404);
      console.warn("[repo-issues] GitHub unavailable:", (err as Error)?.message);
      return c.json({ error: "unavailable" }, 503);
    }
  });
}
