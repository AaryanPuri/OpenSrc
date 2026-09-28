import { ISSUE_TYPES } from "../../../shared/dictionary.js";
import { emptyQuery, parseQuery as parseRules, resolveLanguage } from "../../../shared/parse.js";
import type { IssueType, ParsedQuery } from "../../../shared/types.js";
import type { SortMode } from "../types.js";

/**
 * The GitHub query builder is shared with the frontend (shared/parse.ts), so a
 * text query produces the exact same GitHub search on both sides. Design notes
 * live there.
 */
export { buildGitHubQuery } from "../../../shared/parse.js";

export function sortParams(sort: SortMode): { sort?: string; order?: string } {
  if (sort === "newest") return { sort: "created", order: "desc" };
  if (sort === "comments") return { sort: "comments", order: "desc" };
  return {}; // best match
}

/** Longest raw GitHub query accepted via `gq=` (GitHub itself caps free text at 256 chars). */
export const MAX_GQ_LEN = 512;

/** Trim and clamp a raw query, cutting at a whitespace boundary so no qualifier is split. */
export function clampGithubQuery(gq: string): string {
  const s = gq.replace(/\s+/g, " ").trim();
  if (s.length <= MAX_GQ_LEN) return s;
  const cut = s.slice(0, MAX_GQ_LEN);
  const sp = cut.lastIndexOf(" ");
  return (sp > 0 ? cut.slice(0, sp) : cut).trim();
}

const TYPE_BY_LABEL = new Map(
  (Object.keys(ISSUE_TYPES) as IssueType[])
    .filter((t) => ISSUE_TYPES[t].githubLabel)
    .map((t) => [ISSUE_TYPES[t].githubLabel, t] as const),
);

/**
 * Best-effort inverse of buildGitHubQuery for raw `gq=` queries. Only used to
 * rank bundled fixtures when GitHub is unavailable; never returned to clients.
 */
export function parsedFromGithubQuery(gq: string): ParsedQuery {
  const languages: string[] = [];
  const types: IssueType[] = [];
  let difficulty: ParsedQuery["difficulty"] = null;
  let excludesGfi = false;
  let maxComments: number | null = null;
  const free: string[] = [];

  for (const m of gq.matchAll(/(-?)([a-z_]+:)?("[^"]*"(?:,"[^"]*")*|\S+)/gi)) {
    const [, neg, qual, rawVal] = m;
    const q = qual?.toLowerCase();
    if (!q) {
      const word = rawVal.replace(/"/g, "").toLowerCase();
      if (!neg && !/^(and|or|not)$/.test(word)) free.push(word);
      continue;
    }
    if (q === "language:" && !neg) {
      const id = resolveLanguage(rawVal.replace(/"/g, ""));
      if (id && !languages.includes(id)) languages.push(id);
    } else if (q === "label:") {
      for (const label of rawVal.split(",").map((s) => s.replace(/"/g, "").trim().toLowerCase())) {
        if (neg) {
          if (label === "good first issue") excludesGfi = true;
          continue;
        }
        if (label === "good first issue") difficulty = "beginner";
        else if (label === "help wanted") {
          if (difficulty !== "beginner") difficulty = "help-wanted";
        } else {
          const t = TYPE_BY_LABEL.get(label);
          if (t && !types.includes(t)) types.push(t);
        }
      }
    } else if (q === "comments:" && !neg) {
      const c = rawVal.match(/^(<)?(\d+)$/);
      if (c) maxComments = c[1] ? Number(c[2]) : Number(c[2]) === 0 ? 0 : null;
    }
    // Other qualifiers (is:, no:, archived:, in:, created:, …) carry no ranking signal.
  }
  if (difficulty === "help-wanted" && excludesGfi) difficulty = "intermediate";

  const rest = parseRules(free.join(" "));
  return {
    ...emptyQuery(gq),
    languages: [...new Set([...languages, ...rest.languages])],
    domains: rest.domains,
    difficulty: difficulty ?? rest.difficulty,
    types: [...new Set([...types, ...rest.types])],
    keywords: rest.keywords,
    maxComments,
  };
}
