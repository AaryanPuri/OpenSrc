import { DOMAINS, ISSUE_TYPES } from "../../../shared/dictionary.js";
import { resolveLanguage } from "../../../shared/parse.js";
import fixturesData from "../data/fixtures.json" with { type: "json" };
import type { Issue, ParsedQuery, SortMode } from "../types.js";
import { PER_PAGE } from "./client.js";

const FIXTURES = fixturesData as Issue[];

function langMatches(repoLang: string | undefined, wanted: string): boolean {
  return !!repoLang && resolveLanguage(repoLang) === wanted;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Offline fallback: filter bundled fixtures by language (only if that leaves results),
 * then rank by how well each issue matches difficulty/type/domain/keywords.
 */
export function searchFixtures(parsed: ParsedQuery, page: number, sort: SortMode): { total: number; items: Issue[] } {
  let pool = FIXTURES;
  if (parsed.languages.length) {
    const byLang = pool.filter((i) => parsed.languages.some((l) => langMatches(i.repo.language, l)));
    if (byLang.length) pool = byLang;
  }

  const terms = new Set(
    [
      ...parsed.domains.flatMap((d) => {
        const def = DOMAINS.find((x) => x.id === d.id);
        return [d.term.replace(/"/g, ""), ...(def?.synonyms ?? []), ...d.topics.map((t) => t.replace(/-/g, " "))];
      }),
      ...parsed.keywords,
    ].map((t) => t.toLowerCase()),
  );
  const termRes = [...terms].map((t) => new RegExp(`\\b${escapeRe(t)}`));

  const score = (i: Issue): number => {
    let s = 0;
    const labels = i.labels.map((l) => l.name.toLowerCase());
    if (parsed.difficulty === "beginner" && labels.includes("good first issue")) s += 3;
    if (parsed.difficulty === "help-wanted" && labels.includes("help wanted")) s += 3;
    if (parsed.difficulty === "intermediate" && !labels.includes("good first issue")) s += 2;
    for (const t of parsed.types) {
      const want = ISSUE_TYPES[t].githubLabel || "test";
      if (labels.some((l) => l.includes(want))) s += 2;
    }
    if (parsed.maxComments !== null && i.comments <= parsed.maxComments) s += 1;
    const hay = `${i.title} ${i.bodyExcerpt} ${labels.join(" ")}`.toLowerCase();
    for (const re of termRes) if (re.test(hay)) s += 1;
    return s;
  };

  type Scored = { i: Issue; s: number };
  const scored: Scored[] = pool.map((i) => ({ i, s: score(i) }));
  const cmp: Record<SortMode, (a: Scored, b: Scored) => number> = {
    best: (a, b) => b.s - a.s || (b.i.repo.stars ?? 0) - (a.i.repo.stars ?? 0),
    newest: (a, b) => b.i.createdAt.localeCompare(a.i.createdAt),
    comments: (a, b) => b.i.comments - a.i.comments,
  };
  scored.sort(cmp[sort]);
  const start = (page - 1) * PER_PAGE;
  // Deep-copy so callers can't mutate the bundled data.
  const items = scored.slice(start, start + PER_PAGE).map(({ i }) => structuredClone(i));
  return { total: scored.length, items };
}
