import { excerpt } from "../../../shared/repoIssues.js";
import type { Issue } from "../types.js";

/** Subset of the GitHub search/issues item we use. */
export interface GhSearchItem {
  id: number;
  node_id?: string;
  number: number;
  title: string;
  html_url: string;
  repository_url: string;
  labels: ({ name?: string; color?: string } | string)[];
  comments: number;
  created_at: string;
  updated_at: string;
  body?: string | null;
  user?: { login?: string } | null;
}

// Shared with the repo page's issue list (shared/repoIssues.ts).
export { excerpt };

export function normalizeItem(item: GhSearchItem): Issue {
  const fullName = item.repository_url.replace(/^https:\/\/api\.github\.com\/repos\//, "");
  const owner = fullName.split("/")[0] ?? "";
  return {
    id: item.id,
    number: item.number,
    title: item.title,
    url: item.html_url,
    repo: {
      fullName,
      owner,
      avatarUrl: `https://github.com/${owner}.png?size=64`,
      url: `https://github.com/${fullName}`,
    },
    labels: item.labels
      .map((l) =>
        typeof l === "string" ? { name: l, color: "ededed" } : { name: l.name ?? "", color: l.color ?? "ededed" },
      )
      .filter((l) => l.name),
    comments: item.comments,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
    bodyExcerpt: excerpt(item.body),
    author: item.user?.login ?? "",
  };
}
