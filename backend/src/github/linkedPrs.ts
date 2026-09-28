import { TTLCache } from "../cache.js";
import type { Issue } from "../types.js";

const GRAPHQL = "https://api.github.com/graphql";
const TTL = 10 * 60 * 1000;

/** node_id → has an open PR linked (true) / none (false). */
const cache = new TTLCache<boolean>(TTL, 5000);

export function clearLinkedPrCache(): void {
  cache.clear();
}

/**
 * One GraphQL request per results page (GraphQL has its own points budget,
 * separate from the 30/min search limit). An issue counts as "has a linked
 * PR" when an open PR will close it, it was manually connected to a PR, or an
 * open PR cross-references it.
 */
export const LINKED_PR_QUERY = `query($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on Issue {
      id
      closedByPullRequestsReferences(first: 1, includeClosedPrs: false) { totalCount }
      timelineItems(itemTypes: [CROSS_REFERENCED_EVENT, CONNECTED_EVENT], last: 25) {
        nodes {
          __typename
          ... on CrossReferencedEvent { source { __typename ... on PullRequest { state } } }
        }
      }
    }
  }
}`;

interface GqlIssueNode {
  id: string;
  closedByPullRequestsReferences?: { totalCount: number } | null;
  timelineItems?: {
    nodes: ({ __typename: string; source?: { __typename: string; state?: string } | null } | null)[];
  } | null;
}

export function hasLinkedPr(node: GqlIssueNode): boolean {
  if ((node.closedByPullRequestsReferences?.totalCount ?? 0) > 0) return true;
  return (node.timelineItems?.nodes ?? []).some(
    (n) =>
      n?.__typename === "ConnectedEvent" ||
      (n?.__typename === "CrossReferencedEvent" && n.source?.__typename === "PullRequest" && n.source.state === "OPEN"),
  );
}

/**
 * Sets `linkedPr` on items whose GitHub node id is known. Needs a token
 * (GraphQL rejects anonymous calls); any failure leaves the field undefined,
 * so the UI shows no signal rather than a guess.
 */
export async function annotateLinkedPrs(
  items: Issue[],
  nodeIds: (string | undefined)[],
  token: string,
  f: typeof fetch = fetch,
): Promise<void> {
  const missing = [...new Set(nodeIds.filter((id): id is string => !!id && cache.get(id) === undefined))];
  if (missing.length) {
    try {
      const res = await f(GRAPHQL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "User-Agent": "opensrc",
        },
        body: JSON.stringify({ query: LINKED_PR_QUERY, variables: { ids: missing } }),
        signal: AbortSignal.timeout(6000),
      });
      if (res.ok) {
        const data = (await res.json()) as { data?: { nodes?: (GqlIssueNode | null)[] } };
        for (const node of data.data?.nodes ?? []) {
          if (node?.id) cache.set(node.id, hasLinkedPr(node));
        }
      }
    } catch {
      /* network/timeout: no signal this time */
    }
  }
  items.forEach((item, i) => {
    const id = nodeIds[i];
    const known = id ? cache.get(id) : undefined;
    if (known !== undefined) item.linkedPr = known;
  });
}
