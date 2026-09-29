/**
 * The directory's search: the same `?q=` text as the issue finder, read into
 * repo filters (shared/repoFilter.ts) and applied to the in-browser dataset.
 * Also the repo-mode view of the query's patches, and the GitHub issue query
 * for a repo page's live issues.
 */
import { useMemo } from 'react';
import { FAST_RESPONSE_HOURS } from '../../../shared/collections';
import { GOOD_FIRST_LABELS, HELP_WANTED_LABELS } from '../../../shared/labels';
import type { RepoRecord } from '../../../shared/repo';
import {
  applyRepoFilter,
  parsedToRepoFilter,
  sortRepos,
  type IssueLevel,
  type RepoFilter,
  type RepoSort,
} from '../../../shared/repoFilter';
import { useDataset } from '../data/dataset';
import {
  BASE_QUALIFIERS,
  buildGitHubQuery,
  emptyQuery,
  getChips,
  parseQuery,
  removeChip,
  toQueryText,
  type Chip,
  type ParsedQuery,
} from './parseQuery';

export type { RepoSort } from '../../../shared/repoFilter';
export { REPO_SORTS } from '../../../shared/repoFilter';

export const REPO_SORT_LABELS: Record<RepoSort, { label: string; hint: string }> = {
  score: { label: 'Best score', hint: 'Most welcoming to new contributors first' },
  stars: { label: 'Most stars', hint: 'Biggest projects first' },
  recent: { label: 'Latest commit', hint: 'Most recently active first' },
  gfi: { label: 'Most good first issues', hint: 'Most open good first issues first' },
  response: { label: 'Fastest replies', hint: 'Quickest maintainers first' },
};

/* ------------------------------------------------------------------ */
/* Reading a query for repos                                           */
/* ------------------------------------------------------------------ */

/** Words that ask for quick maintainers ("fast maintainers", "responsive"). */
const SPEED_WORDS = new Set(['fast', 'quick', 'quickly', 'speedy', 'responsive', 'snappy']);
/** Words that only make sense next to a speed word, or say nothing about a repo. */
const RESPONSE_WORDS = new Set([
  'maintainer',
  'maintainers',
  'responder',
  'responders',
  'responding',
  'response',
  'responses',
  'reply',
  'replies',
  'replying',
  'review',
  'reviews',
  'reviewers',
]);

/** Words that describe any listed repo ("committed this week" → the recency is read, "committed" is not a keyword). */
const FILLER_WORDS = new Set(['committed', 'commit', 'commits', 'updated', 'maintained', 'active', 'actively']);

/** Pseudo-patch id for "fast maintainers". */
export const FAST_CHIP_ID = 'fast';

export interface RepoQuery {
  /** The query, minus the response-speed words (they become `fastResponse`). */
  parsed: ParsedQuery;
  filter: RepoFilter;
  /** What only applies to issues: seeds a repo page's live issue search. */
  issueLevel: IssueLevel;
  /** Only repos whose maintainers usually reply within FAST_RESPONSE_HOURS. */
  fastResponse: boolean;
  /** The keywords that were read as "fast maintainers" (removed together). */
  responseWords: string[];
}

export function readRepoQuery(parsed: ParsedQuery): RepoQuery {
  const words = parsed.keywords.map((k) => k.toLowerCase());
  const fastResponse = words.some((w) => SPEED_WORDS.has(w));
  const isResponseWord = (k: string) => {
    const w = k.toLowerCase();
    return RESPONSE_WORDS.has(w) || (fastResponse && SPEED_WORDS.has(w));
  };
  const responseWords = parsed.keywords.filter(isResponseWord);
  const rest: ParsedQuery = {
    ...parsed,
    keywords: parsed.keywords.filter((k) => !isResponseWord(k) && !FILLER_WORDS.has(k.toLowerCase())),
  };
  const { filter, issueLevel } = parsedToRepoFilter(rest);
  return { parsed: rest, filter, issueLevel, fastResponse, responseWords };
}

export interface RepoFilterOptions {
  sort: RepoSort;
  /** Only first-PR friendly repos (`first=1`). */
  first: boolean;
  /** Epoch ms for recency: the dataset's generatedAt. */
  now: number;
}

export function filterRepos(repos: RepoRecord[], q: RepoQuery, opts: RepoFilterOptions): RepoRecord[] {
  let out = applyRepoFilter(repos, q.filter, opts.now);
  if (q.fastResponse) out = out.filter((r) => r.responseHours !== null && r.responseHours <= FAST_RESPONSE_HOURS);
  if (opts.first) out = out.filter((r) => r.firstPrFriendly);
  return sortRepos(out, opts.sort);
}

/** Directory results for `?q=&sort=&first=`, recomputed only when one of them (or the data) changes. */
export function useRepoResults(q: string, sort: RepoSort, first: boolean) {
  const dataset = useDataset();
  const parsed = useMemo(() => parseQuery(q), [q]);
  const query = useMemo(() => readRepoQuery(parsed), [parsed]);
  const repos = useMemo(
    () => filterRepos(dataset.repos, query, { sort, first, now: dataset.now }),
    [dataset.repos, dataset.now, query, sort, first],
  );
  return { ...dataset, parsed, query, results: repos };
}

/* ------------------------------------------------------------------ */
/* Patches, as the directory reads them                                */
/* ------------------------------------------------------------------ */

const REPO_DIFFICULTY: Record<string, { label: string; detail: string }> = {
  beginner: { label: 'Good first issues', detail: 'repos with open good first issues' },
  'help-wanted': { label: 'Help wanted', detail: 'repos with open help-wanted issues' },
  intermediate: { label: 'Help wanted', detail: 'repos with open help-wanted issues' },
};

const REPO_SINCE: Record<string, string> = {
  week: 'Committed this week',
  month: 'Committed this month',
  year: 'Committed this year',
};

const REPO_LEVEL_QUALIFIER = /^(repo|org|user):/i;

/**
 * The query's patches in repo mode: difficulty and recency say what they do to
 * repos, "fast maintainers" is one patch, and patches that only narrow issues
 * (kind of work, comment ceilings, label qualifiers) are marked as such.
 */
export function repoChips(parsed: ParsedQuery): Chip[] {
  const q = readRepoQuery(parsed);
  const chips: Chip[] = getChips(q.parsed).map((c): Chip => {
    switch (c.kind) {
      case 'difficulty':
        return { ...c, ...REPO_DIFFICULTY[c.id] };
      case 'recency':
        return { ...c, label: REPO_SINCE[c.id] ?? c.label, detail: 'repos with a commit in that window' };
      case 'type':
        return { ...c, scope: 'issues', detail: `applies to issues: ${c.detail}` };
      case 'activity':
        return c.id === '0'
          ? { ...c, label: 'Unanswered issues', detail: 'repos with good first issues nobody has replied to' }
          : { ...c, scope: 'issues', detail: `applies to issues: ${c.detail}` };
      case 'qualifier':
        return REPO_LEVEL_QUALIFIER.test(c.id) ? c : { ...c, scope: 'issues', detail: 'applies to issues' };
      default:
        return c;
    }
  });
  if (q.fastResponse) {
    chips.push({
      kind: 'response',
      id: FAST_CHIP_ID,
      label: 'Fast maintainers',
      detail: `maintainers usually reply within ${FAST_RESPONSE_HOURS} hours`,
    });
  }
  return chips;
}

/** Unpicks a repo-mode patch ("fast maintainers" takes all its words with it). */
export function removeRepoChip(parsed: ParsedQuery, chip: Pick<Chip, 'kind' | 'id'>): ParsedQuery {
  if (chip.kind === 'response') {
    const drop = new Set(readRepoQuery(parsed).responseWords);
    const next = { ...parsed, keywords: parsed.keywords.filter((k) => !drop.has(k)) };
    return { ...next, raw: toQueryText(next) };
  }
  return removeChip(parsed, chip);
}

/* ------------------------------------------------------------------ */
/* A repo page's live issues                                           */
/* ------------------------------------------------------------------ */

export type IssueTab = 'gfi' | 'help' | 'all';
export const ISSUE_TABS: IssueTab[] = ['gfi', 'help', 'all'];

/** Label spellings searched per tab: the most common ones, so the query stays well under GitHub's 256 characters. */
const TAB_LABELS: Record<Exclude<IssueTab, 'all'>, string[]> = {
  gfi: GOOD_FIRST_LABELS.filter((l) =>
    [
      'good first issue',
      'good-first-issue',
      'good first issues',
      'first-timers-only',
      'beginner',
      'beginner friendly',
      'easy',
      'E-easy',
    ].includes(l),
  ),
  help: HELP_WANTED_LABELS.filter((l) =>
    ['help wanted', 'help-wanted', 'status: help wanted', 'up-for-grabs', 'contributions welcome'].includes(l),
  ),
};

const labelQualifier = (labels: string[]) => `label:${labels.map((l) => `"${l}"`).join(',')}`;

/**
 * `repo:o/n is:issue is:open no:assignee label:"good first issue",…` plus the
 * issue-level parts of the directory search (kind of work, comment ceiling,
 * label qualifiers), so "rust docs" on the home page shows docs issues here.
 */
export function repoIssueQuery(fullName: string, tab: IssueTab, parsed: ParsedQuery | null = null): string {
  const parts = [`repo:${fullName}`, ...BASE_QUALIFIERS];
  if (tab !== 'all') parts.push(labelQualifier(TAB_LABELS[tab]));
  if (parsed) {
    const { issueLevel } = readRepoQuery(parsed);
    const extra: ParsedQuery = {
      ...emptyQuery(),
      types: issueLevel.types,
      maxComments: parsed.maxComments,
      qualifiers: issueLevel.qualifiers,
    };
    // With no difficulty, language or field, the built query is the base qualifiers plus the extras.
    const built = buildGitHubQuery(extra);
    const prefix = BASE_QUALIFIERS.join(' ');
    const rest = (built.startsWith(prefix) ? built.slice(prefix.length) : built).trim();
    if (rest) parts.push(rest);
  }
  return parts.join(' ');
}

/** The issue-level patches of a directory search, for "narrowed by your search" on a repo page. */
export function issueLevelChips(parsed: ParsedQuery): Chip[] {
  return repoChips(parsed).filter((c) => c.scope === 'issues' || (c.kind === 'activity' && c.id === '0'));
}
