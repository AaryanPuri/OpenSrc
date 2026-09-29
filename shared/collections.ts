/**
 * Hand-picked views over the repo dataset, each a rule plus a sort.
 */
import type { DatasetMeta, RepoRecord } from './repo.js';
import { sortRepos, type RepoSort } from './repoFilter.js';

export const FRESH_DAYS = 7;
export const BIG_NAME_STARS = 10_000;
export const BIG_NAME_MIN_GFI = 3;
export const FAST_RESPONSE_HOURS = 24;

export interface CollectionContext {
  /** Epoch ms; use meta.generatedAt so pre-rendered pages and the browser agree. */
  now: number;
  /** Epoch ms of the first build; repos first seen then aren't "new". */
  bootstrapAt: number | null;
}

export interface Collection {
  id: string;
  title: string;
  description: string;
  sort: RepoSort;
  includes: (repo: RepoRecord, ctx: CollectionContext) => boolean;
}

export const COLLECTIONS: Collection[] = [
  {
    id: 'first-pr',
    title: 'Best for a first PR',
    description:
      'First-PR friendly repos: plenty of good first issues, a CONTRIBUTING guide and maintainers who reply.',
    sort: 'score',
    includes: (r) => r.firstPrFriendly,
  },
  {
    id: 'fresh',
    title: 'Fresh this week',
    description: `Repos that joined the directory in the last ${FRESH_DAYS} days.`,
    sort: 'score',
    includes: (r, ctx) => {
      const seen = Date.parse(r.firstSeenAt);
      if (!Number.isFinite(seen)) return false;
      if (ctx.bootstrapAt !== null && seen <= ctx.bootstrapAt) return false;
      return ctx.now - seen <= FRESH_DAYS * 86_400_000;
    },
  },
  {
    id: 'unanswered',
    title: 'Unanswered issues',
    description: 'Good first issues nobody has replied to yet. Be the first one there.',
    sort: 'score',
    includes: (r) => r.gfiUnanswered > 0,
  },
  {
    id: 'big-names',
    title: 'Big-name repos',
    description: `Projects with ${BIG_NAME_STARS / 1000}k+ stars and at least ${BIG_NAME_MIN_GFI} good first issues.`,
    sort: 'stars',
    includes: (r) => r.stars >= BIG_NAME_STARS && r.goodFirstIssues >= BIG_NAME_MIN_GFI,
  },
  {
    id: 'fast-responders',
    title: 'Fast responders',
    description: `Maintainers who usually reply within ${FAST_RESPONSE_HOURS} hours.`,
    sort: 'response',
    includes: (r) => r.responseHours !== null && r.responseHours <= FAST_RESPONSE_HOURS,
  },
];

export function collectionById(id: string): Collection | undefined {
  return COLLECTIONS.find((c) => c.id === id);
}

export function collectionContext(meta: Pick<DatasetMeta, 'generatedAt' | 'bootstrapAt'>): CollectionContext {
  const bootstrapAt = Date.parse(meta.bootstrapAt);
  return { now: Date.parse(meta.generatedAt), bootstrapAt: Number.isFinite(bootstrapAt) ? bootstrapAt : null };
}

/** The collection's repos, sorted by its rule. */
export function selectCollection(c: Collection, repos: RepoRecord[], ctx: CollectionContext): RepoRecord[] {
  return sortRepos(
    repos.filter((r) => c.includes(r, ctx)),
    c.sort,
  );
}
