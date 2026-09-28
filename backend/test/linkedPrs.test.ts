import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { clearGithubCaches } from "../src/github/client.js";
import { hasLinkedPr } from "../src/github/linkedPrs.js";
import type { SearchResponse } from "../src/types.js";

const item = (n: number) => ({
  id: n,
  node_id: `I_${n}`,
  number: n,
  title: `Issue ${n}`,
  html_url: `https://github.com/acme/db/issues/${n}`,
  repository_url: "https://api.github.com/repos/acme/db",
  labels: [],
  comments: 0,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
  body: "",
  user: { login: "alice" },
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

beforeEach(() => clearGithubCaches());

describe("hasLinkedPr", () => {
  it("counts closing PRs, connected events and open cross-referencing PRs only", () => {
    expect(hasLinkedPr({ id: "a", closedByPullRequestsReferences: { totalCount: 1 } })).toBe(true);
    expect(hasLinkedPr({ id: "b", timelineItems: { nodes: [{ __typename: "ConnectedEvent" }] } })).toBe(true);
    const xref = (state: string) => ({
      id: "c",
      timelineItems: { nodes: [{ __typename: "CrossReferencedEvent", source: { __typename: "PullRequest", state } }] },
    });
    expect(hasLinkedPr(xref("OPEN"))).toBe(true);
    expect(hasLinkedPr(xref("CLOSED"))).toBe(false);
    expect(
      hasLinkedPr({
        id: "d",
        timelineItems: { nodes: [{ __typename: "CrossReferencedEvent", source: { __typename: "Issue" } }] },
      }),
    ).toBe(false);
    expect(
      hasLinkedPr({ id: "e", closedByPullRequestsReferences: { totalCount: 0 }, timelineItems: { nodes: [] } }),
    ).toBe(false);
  });
});

describe("linked PR availability on /api/search", () => {
  const gqlNodes = {
    data: {
      nodes: [
        { id: "I_1", closedByPullRequestsReferences: { totalCount: 1 }, timelineItems: { nodes: [] } },
        { id: "I_2", closedByPullRequestsReferences: { totalCount: 0 }, timelineItems: { nodes: [] } },
      ],
    },
  };

  it("with a token: one batched GraphQL call per page, cached", async () => {
    const fetchImpl = vi.fn(async (input: string, init?: RequestInit) => {
      if (input.includes("/search/issues")) return json({ total_count: 2, items: [item(1), item(2)] });
      if (input.endsWith("/graphql")) {
        const body = JSON.parse(String(init?.body));
        expect(body.variables.ids).toEqual(["I_1", "I_2"]);
        return json(gqlNodes);
      }
      return json({ stargazers_count: 5, language: "Rust" });
    });
    const app = createApp({ env: { GITHUB_TOKEN: "tok" }, fetchImpl: fetchImpl as unknown as typeof fetch });
    const body = (await (await app.request("/api/search?q=rust")).json()) as SearchResponse;
    expect(body.items.map((i) => i.linkedPr)).toEqual([true, false]);
    const gqlCalls = () => fetchImpl.mock.calls.filter((c) => String(c[0]).endsWith("/graphql")).length;
    expect(gqlCalls()).toBe(1);

    // Same issues on another page/sort: served from the linked-PR cache.
    await app.request("/api/search?q=rust&sort=newest");
    expect(gqlCalls()).toBe(1);
  });

  it("without a token: no GraphQL call and no field (never faked)", async () => {
    const fetchImpl = vi.fn(async () => json({ total_count: 1, items: [item(1)] }));
    const app = createApp({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const body = (await (await app.request("/api/search?q=go")).json()) as SearchResponse;
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(body.items[0]).not.toHaveProperty("linkedPr");
  });

  it("a failing GraphQL call leaves the field unset", async () => {
    const fetchImpl = vi.fn(async (input: string) =>
      input.includes("/search/issues")
        ? json({ total_count: 1, items: [item(3)] })
        : input.endsWith("/graphql")
          ? json({ message: "Bad credentials" }, 401)
          : json({ stargazers_count: 1 }),
    );
    const app = createApp({ env: { GITHUB_TOKEN: "tok" }, fetchImpl: fetchImpl as unknown as typeof fetch });
    const body = (await (await app.request("/api/search?q=python")).json()) as SearchResponse;
    expect(body.items[0].linkedPr).toBeUndefined();
  });
});
