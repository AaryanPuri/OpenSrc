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

export function excerpt(body: string | null | undefined, max = 280): string {
  if (!body) return "";
  const text = body
    .replace(/<!--[\s\S]*?-->/g, " ") // HTML comments (issue templates)
    .replace(/```[\s\S]*?```/g, " ") // fenced code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links -> text
    .replace(/<[^>]+>/g, " ") // html tags
    .replace(/(^|\s)[#>*_~|-]+(?=\s|$)/g, " ") // standalone markdown markers
    .replace(/[*_`~]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? text.slice(0, max - 1).trimEnd() + "…" : text;
}

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
