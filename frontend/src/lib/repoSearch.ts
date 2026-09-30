/**
 * The directory's search: the same `?q=` text as the issue finder, read into
 * repo filters (shared/repoFilter.ts) and applied to the in-browser dataset.
 * Also the repo-mode view of the query's patches, and the GitHub issue query
 * for a repo page's live issues.
 */
import { useMemo } from 'react';
import { FAST_RESPONSE_HOURS } from '../../../shared/collections';
import { GOOD_FIRST_LABELS, HELP_WANTED_LABELS, isGoodFirstLabel, isHelpWantedLabel } from '../../../shared/labels';
import type { RepoRecord } from '../../../shared/repo';
import {
  applyRepoFilter,
  defaultRepoSort,
  parsedToRepoFilter,
  REPO_SORTS,
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
export { claimableGfis, defaultRepoSort, REPO_SORTS } from '../../../shared/repoFilter';

export const REPO_SORT_LABELS: Record<RepoSort, { label: string; hint: string }> = {
  score: { label: 'Best score', hint: 'Most welcoming to new contributors first' },
  claimable: { label: 'Most unclaimed issues', hint: 'Most unassigned good first issues first' },
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

/**
 * The directory's mode and order for `?q=&sort=&first=`: first-PR mode is on with
 * `first=1` or beginner wording in the query ("beginner rust repos"), and with no
 * `sort` picked it orders by unclaimed issues (else by score).
 */
export function repoView(q: RepoQuery, sortParam: RepoSort | null, firstParam: boolean) {
  const first = firstParam || q.filter.firstPr;
  return { first, sort: sortParam ?? defaultRepoSort(first) };
}

/**
 * Directory results for `?q=&sort=&first=`, recomputed only when one of them (or the
 * data) changes. `sortParam` is null when none was picked; `first` and `sort` in the
 * result are what the page is actually showing.
 */
export function useRepoResults(q: string, sortParam: RepoSort | null, firstParam: boolean) {
  const dataset = useDataset();
  const parsed = useMemo(() => parseQuery(q), [q]);
  const query = useMemo(() => readRepoQuery(parsed), [parsed]);
  const { first, sort } = repoView(query, sortParam, firstParam);
  const repos = useMemo(
    () => filterRepos(dataset.repos, query, { sort, first, now: dataset.now }),
    [dataset.repos, dataset.now, query, sort, first],
  );
  return { ...dataset, parsed, query, first, sort, results: repos };
}

/**
 * The query with its beginner wording taken out: the First-PR toggle going off (or
 * its patch being unpicked) takes the words that switched it on with it, so the
 * URL never says "beginner" with the toggle off.
 */
export function withoutFirstPrWords(parsed: ParsedQuery): ParsedQuery {
  return parsed.difficulty === 'beginner' ? removeChip(parsed, { kind: 'difficulty', id: 'beginner' }) : parsed;
}

/* ------------------------------------------------------------------ */
/* Patches, as the directory reads them                                */
/* ------------------------------------------------------------------ */

/** The display name for help-wanted issues (the GitHub labels themselves are unchanged). */
export const HELP_WANTED_NAME = 'Contributions welcome';

const REPO_DIFFICULTY: Record<string, Pick<Chip, 'label' | 'detail' | 'scope'>> = {
  beginner: { label: 'First-PR friendly', detail: 'only repos ready for your first PR' },
  // "help wanted", "intermediate" and "challenge" don't narrow repos: they open repo pages on that tab.
  'help-wanted': {
    label: HELP_WANTED_NAME,
    detail: 'applies to issues: opens repos on their Contributions welcome tab',
    scope: 'issues',
  },
  intermediate: {
    label: HELP_WANTED_NAME,
    detail: 'applies to issues: opens repos on their Contributions welcome tab',
    scope: 'issues',
  },
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

/** `q=…&sort=…&first=1` for a directory search (a sort that is the default for its mode is left out). */
export function repoSearchParams(q: string, sort: string | null, first: boolean): string {
  const params = new URLSearchParams({ q });
  const known = sort && (REPO_SORTS as string[]).includes(sort) ? (sort as RepoSort) : null;
  if (known && known !== repoView(readRepoQuery(parseQuery(q)), null, first).sort) params.set('sort', known);
  if (first) params.set('first', '1');
  return params.toString();
}

/** The directory search a repo page was opened from: its `q`, `sort` and `first`, nothing else. */
export function backToSearchPath(params: URLSearchParams): string {
  const q = params.get('q')?.trim() ?? '';
  if (!q) return '/';
  return `/?${repoSearchParams(q, params.get('sort'), params.get('first') === '1')}`;
}

/* ------------------------------------------------------------------ */
/* A repo page's live issues                                           */
/* ------------------------------------------------------------------ */

export type IssueTab = 'gfi' | 'help' | 'all';
export const ISSUE_TABS: IssueTab[] = ['gfi', 'help', 'all'];

/**
 * Label spellings searched per tab when a repo's own spellings aren't known (the
 * index doesn't carry them): the most common ones.
 */
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

/** GitHub rejects longer search queries. */
export const MAX_ISSUE_QUERY = 256;

const labelQualifier = (labels: string[]) => `label:${labels.map((l) => `"${l.replace(/"/g, '')}"`).join(',')}`;

/** The spellings to search on a tab: the ones the repo's issues use, else the common ones. */
export function tabLabels(repo: Pick<RepoRecord, 'issueLabels'>, tab: Exclude<IssueTab, 'all'>): string[] {
  const own = (repo.issueLabels ?? []).filter(tab === 'gfi' ? isGoodFirstLabel : isHelpWantedLabel);
  return own.length ? own : TAB_LABELS[tab];
}

/**
 * `repo:o/n is:issue is:open no:assignee label:"good first issue",…` plus the
 * issue-level parts of the directory search (kind of work, comment ceiling,
 * label qualifiers), so "rust docs" on the home page shows docs issues here.
 * Label spellings are dropped from the end until it fits in 256 characters.
 */
export function repoIssueQuery(
  repo: Pick<RepoRecord, 'fullName' | 'issueLabels'>,
  tab: IssueTab,
  parsed: ParsedQuery | null = null,
): string {
  const head = [`repo:${repo.fullName}`, ...BASE_QUALIFIERS].join(' ');
  let rest = '';
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
    rest = (built.startsWith(prefix) ? built.slice(prefix.length) : built).trim();
  }
  const join = (labels: string[]) =>
    [head, labels.length ? labelQualifier(labels) : '', rest].filter(Boolean).join(' ');
  if (tab === 'all') return join([]);
  const labels = tabLabels(repo, tab);
  let n = labels.length;
  while (n > 1 && join(labels.slice(0, n)).length > MAX_ISSUE_QUERY) n--;
  return join(labels.slice(0, n));
}

/** The issue-level patches of a directory search, for "narrowed by your search" on a repo page. */
export function issueLevelChips(parsed: ParsedQuery): Chip[] {
  return repoChips(parsed).filter(
    (c) => c.kind !== 'difficulty' && (c.scope === 'issues' || (c.kind === 'activity' && c.id === '0')),
  );
}

/** The tab a repo page opens on: Contributions welcome for "help wanted" / "intermediate" searches. */
export function defaultIssueTab(parsed: ParsedQuery | null): IssueTab {
  return parsed?.difficulty === 'help-wanted' || parsed?.difficulty === 'intermediate' ? 'help' : 'gfi';
}
