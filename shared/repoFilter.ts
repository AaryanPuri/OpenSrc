/**
 * Turns a ParsedQuery (the same `?q=` the issue search uses) into filters over
 * the repo dataset. Whatever only makes sense per issue (issue types, comment
 * ceilings above zero, label/state qualifiers) is handed back as `issueLevel`,
 * so a repo page can seed its live issue search with it.
 */
import { normalise, SINCE_DAYS } from './parse.js';
import type { RepoRecord } from './repo.js';
import { claimableGfi } from './score.js';
import type { Difficulty, IssueType, ParsedQuery } from './types.js';

export interface StarRange {
  min?: number;
  max?: number;
}

export interface RepoFilter {
  /** Language ids (OR). */
  languages: string[];
  /** Field ids (OR). */
  fields: string[];
  /**
   * Only first-PR friendly repos: beginner wording ("beginner", "first PR", "easy")
   * switches the directory's First-PR toggle on. Other difficulty words
   * ("help wanted", "intermediate") don't narrow repos; they stay issue-level.
   */
  firstPr: boolean;
  /** Every keyword must appear in the name, description or topics. */
  keywords: string[];
  /** Last commit within this many days ("recent", "this week"). */
  committedWithinDays: number | null;
  /** Has good-first-issues with no replies ("unanswered", "no comments"). */
  unanswered: boolean;
  /** `repo:owner/name` (OR, case-insensitive). */
  repos: string[];
  /** `org:` / `user:` (OR, case-insensitive). */
  owners: string[];
  stars: StarRange | null;
}

export interface IssueLevel {
  difficulty: Difficulty | null;
  types: IssueType[];
  /** Comment ceiling above zero (zero maps to the repo-level `unanswered`). */
  maxComments: number | null;
  /** GitHub qualifiers that only apply to issues (`label:`, `is:`…). */
  qualifiers: string[];
}

export type RepoSort = 'score' | 'claimable' | 'stars' | 'recent' | 'gfi' | 'response';
export const REPO_SORTS: RepoSort[] = ['score', 'claimable', 'stars', 'recent', 'gfi', 'response'];

/** The order when none was picked: unclaimed issues first for a first PR, else the score. */
export const defaultRepoSort = (firstPr: boolean): RepoSort => (firstPr ? 'claimable' : 'score');

/** Open good first issues nobody is assigned to (score.ts's estimate from the sampled newest ones). */
export const claimableGfis = (r: Pick<RepoRecord, 'goodFirstIssues' | 'gfiSampled' | 'gfiUnassigned'>): number =>
  claimableGfi(r);

export function emptyRepoFilter(): RepoFilter {
  return {
    languages: [],
    fields: [],
    firstPr: false,
    keywords: [],
    committedWithinDays: null,
    unanswered: false,
    repos: [],
    owners: [],
    stars: null,
  };
}

const STARS_RE = /^stars:(>=|<=|>|<)?(\d+)(?:\.\.(\d+|\*))?$/i;

/** `stars:>100`, `stars:>=1000`, `stars:<50`, `stars:10..200`, `stars:500` (at least) → a range. */
export function parseStars(q: string): StarRange | null {
  const m = STARS_RE.exec(q.trim());
  if (!m) return null;
  const [, op, a, b] = m;
  const n = Number(a);
  if (b !== undefined) return b === '*' ? { min: n } : { min: n, max: Number(b) };
  switch (op) {
    case '>':
      return { min: n + 1 };
    case '>=':
      return { min: n };
    case '<':
      return { max: n - 1 };
    case '<=':
      return { max: n };
    default:
      return { min: n };
  }
}

export function parsedToRepoFilter(p: ParsedQuery): { filter: RepoFilter; issueLevel: IssueLevel } {
  const filter = emptyRepoFilter();
  const issueLevel: IssueLevel = { difficulty: p.difficulty, types: [...p.types], maxComments: null, qualifiers: [] };

  filter.languages = [...p.languages];
  filter.fields = p.domains.map((d) => d.id);
  if (p.difficulty === 'beginner') filter.firstPr = true;
  if (p.since) filter.committedWithinDays = SINCE_DAYS[p.since];
  if (p.maxComments === 0) filter.unanswered = true;
  else if (p.maxComments !== null) issueLevel.maxComments = p.maxComments;

  for (const q of p.qualifiers) {
    const [key, ...rest] = q.split(':');
    const value = rest.join(':').replace(/^"|"$/g, '');
    if (key === 'repo' && value.includes('/')) filter.repos.push(value.toLowerCase());
    else if ((key === 'org' || key === 'user') && value) filter.owners.push(value.toLowerCase());
    else issueLevel.qualifiers.push(q);
  }
  // The parser doesn't know `stars:`, so it arrives as a keyword.
  for (const k of p.keywords) {
    const stars = parseStars(k);
    if (stars) filter.stars = stars;
    else filter.keywords.push(k);
  }
  return { filter, issueLevel };
}

function haystack(r: RepoRecord): string {
  return ` ${[r.fullName.replace('/', ' '), r.description ?? '', ...r.topics].map((s) => normalise(s).join(' ')).join(' ')} `;
}

export function matchesRepoFilter(r: RepoRecord, f: RepoFilter, now: number): boolean {
  if (f.languages.length && !(r.language && f.languages.includes(r.language))) return false;
  if (f.fields.length && !r.fields.some((id) => f.fields.includes(id))) return false;
  if (f.firstPr && !r.firstPrFriendly) return false;
  if (f.unanswered && r.gfiUnanswered < 1) return false;
  if (f.repos.length && !f.repos.includes(r.fullName.toLowerCase())) return false;
  if (f.owners.length && !f.owners.includes(r.owner.toLowerCase())) return false;
  if (f.stars) {
    if (f.stars.min !== undefined && r.stars < f.stars.min) return false;
    if (f.stars.max !== undefined && r.stars > f.stars.max) return false;
  }
  if (f.committedWithinDays !== null) {
    const t = Date.parse(r.lastCommitAt);
    if (!(now - t <= f.committedWithinDays * 86_400_000)) return false;
  }
  if (f.keywords.length) {
    const hay = haystack(r);
    for (const k of f.keywords) {
      const needle = normalise(k).join(' ');
      if (needle && !hay.includes(needle)) return false;
    }
  }
  return true;
}

/** Repos matching every filter, in their original order. `now` only matters for recency. */
export function applyRepoFilter(repos: RepoRecord[], f: RepoFilter, now = Date.now()): RepoRecord[] {
  return repos.filter((r) => matchesRepoFilter(r, f, now));
}

const byName = (a: RepoRecord, b: RepoRecord) =>
  a.fullName.toLowerCase() < b.fullName.toLowerCase()
    ? -1
    : a.fullName.toLowerCase() > b.fullName.toLowerCase()
      ? 1
      : 0;

/** Fastest first; unknown response times go last; 0 when both are unknown. */
const byResponse = (a: RepoRecord, b: RepoRecord) => {
  if (a.responseHours === null || b.responseHours === null) {
    return a.responseHours === b.responseHours ? 0 : a.responseHours === null ? 1 : -1;
  }
  return a.responseHours - b.responseHours;
};

const COMPARATORS: Record<RepoSort, (a: RepoRecord, b: RepoRecord) => number> = {
  score: (a, b) => b.score - a.score || b.stars - a.stars,
  // Most unclaimed good first issues, then the quickest maintainers, then the score.
  claimable: (a, b) => claimableGfis(b) - claimableGfis(a) || byResponse(a, b) || b.score - a.score,
  stars: (a, b) => b.stars - a.stars || b.score - a.score,
  recent: (a, b) => Date.parse(b.lastCommitAt) - Date.parse(a.lastCommitAt) || b.score - a.score,
  gfi: (a, b) => b.goodFirstIssues - a.goodFirstIssues || b.score - a.score,
  response: (a, b) => byResponse(a, b) || b.score - a.score,
};

/** A sorted copy; ties fall back to score, then name, so the order is deterministic. */
export function sortRepos(repos: RepoRecord[], sort: RepoSort = 'score'): RepoRecord[] {
  const cmp = COMPARATORS[sort] ?? COMPARATORS.score;
  return [...repos].sort((a, b) => {
    const c = cmp(a, b);
    return c || byName(a, b);
  });
}
