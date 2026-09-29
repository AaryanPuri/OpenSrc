/**
 * Synthetic GitHub GraphQL fixtures for the pipeline tests: a fake fetch that
 * answers repo searches (with cursors) and aliased detail batches.
 */
import type { DetailNode, ResponseIssue, SearchNode } from "../src/pipeline/queries.js";

export const NOW = new Date("2026-09-01T00:00:00Z");
export const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

export function searchNode(fullName: string, over: Partial<SearchNode> = {}): SearchNode {
  return {
    nameWithOwner: fullName,
    description: `${fullName} does things`,
    stargazerCount: 500,
    pushedAt: daysAgo(2),
    isArchived: false,
    isFork: false,
    isMirror: false,
    licenseInfo: { spdxId: "MIT" },
    primaryLanguage: { name: "Rust" },
    gfi: { totalCount: 6 },
    hw: { totalCount: 1 },
    ...over,
  };
}

export function detailNode(fullName: string, over: Partial<DetailNode> = {}): DetailNode {
  const [owner, name] = fullName.split("/");
  return {
    nameWithOwner: fullName,
    name,
    owner: { login: owner, avatarUrl: `https://avatars.example/${owner}` },
    description: `${name}: a fast command line tool`,
    homepageUrl: null,
    stargazerCount: 500,
    forkCount: 20,
    isArchived: false,
    isFork: false,
    isMirror: false,
    createdAt: daysAgo(1000),
    pushedAt: daysAgo(1),
    primaryLanguage: { name: "Rust" },
    licenseInfo: { spdxId: "MIT" },
    repositoryTopics: { nodes: [{ topic: { name: "cli" } }] },
    defaultBranchRef: { target: { committedDate: daysAgo(2) } },
    contributing0: { id: "blob" },
    contributing1: null,
    contributing2: null,
    contributingGuidelines: null,
    codeOfConduct: { key: "contributor_covenant" },
    gfi: { totalCount: 6 },
    hw: { totalCount: 1 },
    gfiSample: {
      nodes: Array.from({ length: 6 }, (_, i) => ({
        assignees: { totalCount: i < 1 ? 1 : 0 },
        comments: { totalCount: i < 2 ? 0 : 3 },
      })),
    },
    ...over,
  };
}

/** Five community issues, each answered by a maintainer `hours` later. */
export function responseIssues(hours: number): ResponseIssue[] {
  return Array.from({ length: 5 }, (_, i) => {
    const opened = Date.parse(daysAgo(10 + i));
    return {
      createdAt: new Date(opened).toISOString(),
      authorAssociation: "NONE",
      author: { __typename: "User", login: `user${i}` },
      comments: {
        nodes: [
          {
            createdAt: new Date(opened + hours * 3_600_000).toISOString(),
            authorAssociation: "MEMBER",
            author: { __typename: "User", login: "maintainer" },
          },
        ],
      },
    };
  });
}

export interface FakeGithub {
  fetch: typeof fetch;
  calls: { query: string; variables: Record<string, unknown> }[];
}

export interface FakeOptions {
  /** Search results per query string (any query not listed returns nothing). Pages of `pageSize`. */
  search?: (q: string) => SearchNode[];
  /** Detail nodes by lower-cased full name; missing → null + NOT_FOUND. */
  details?: Record<string, DetailNode>;
  responseHours?: number;
  /** rateLimit.remaining reported on each call, in order (last value repeats). */
  remaining?: number[];
  cost?: number;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export function fakeGithub(opts: FakeOptions): FakeGithub {
  const calls: FakeGithub["calls"] = [];
  const f = async (_url: string | URL | Request, init?: RequestInit) => {
    const { query, variables = {} } = JSON.parse(String(init?.body)) as {
      query: string;
      variables?: Record<string, unknown>;
    };
    calls.push({ query, variables });
    const remaining = opts.remaining?.[Math.min(calls.length - 1, opts.remaining.length - 1)] ?? 4000;
    const rateLimit = { cost: opts.cost ?? 1, remaining, limit: 5000, resetAt: "2026-09-01T01:00:00Z" };

    if (query.includes("search(type: REPOSITORY")) {
      const all = opts.search?.(String(variables.q)) ?? [];
      const first = Number(variables.first);
      const start = variables.after ? Number(String(variables.after).replace("cursor", "")) : 0;
      const nodes = all.slice(start, start + first);
      const end = start + nodes.length;
      return json({
        data: {
          rateLimit,
          search: {
            repositoryCount: all.length,
            pageInfo: { hasNextPage: end < all.length, endCursor: end < all.length ? `cursor${end}` : null },
            nodes,
          },
        },
      });
    }

    const data: Record<string, unknown> = { rateLimit };
    const errors: unknown[] = [];
    for (const m of query.matchAll(/(r\d+): repository\(owner: "([^"]+)", name: "([^"]+)"\)/g)) {
      const node = opts.details?.[`${m[2]}/${m[3]}`.toLowerCase()];
      data[m[1]] = node ?? null;
      if (!node) errors.push({ type: "NOT_FOUND", path: [m[1]], message: "Could not resolve to a Repository" });
    }
    for (const m of query.matchAll(/(s\d+): search\(type: ISSUE/g)) {
      data[m[1]] = { nodes: responseIssues(opts.responseHours ?? 5) };
    }
    return json(errors.length ? { data, errors } : { data });
  };
  return { fetch: f as typeof fetch, calls };
}
