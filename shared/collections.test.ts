import { describe, expect, it } from 'vitest';
import { collectionById, collectionContext, COLLECTIONS, selectCollection } from './collections';
import type { RepoRecord } from './repo';

const GENERATED = '2026-09-01T00:00:00.000Z';
const NOW = Date.parse(GENERATED);
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

function repo(fullName: string, over: Partial<RepoRecord> = {}): RepoRecord {
  const [owner, name] = fullName.split('/');
  return {
    fullName,
    owner,
    name,
    description: null,
    homepage: null,
    avatarUrl: '',
    language: 'go',
    languageName: 'Go',
    topics: [],
    stars: 100,
    forks: 0,
    license: 'MIT',
    archived: false,
    fork: false,
    mirror: false,
    lastCommitAt: daysAgo(1),
    createdAt: daysAgo(900),
    contributingUrl: null,
    hasCodeOfConduct: false,
    goodFirstIssues: 0,
    helpWanted: 2,
    gfiSampled: 0,
    gfiUnassigned: 0,
    gfiUnanswered: 0,
    issueLabels: [],
    responseHours: null,
    responseSampledAt: null,
    fields: [],
    curated: false,
    firstSeenAt: daysAgo(60),
    score: 40,
    scoreParts: { supply: 0, activity: 0, response: 0, onboarding: 0, claimable: 0, reach: 0 },
    firstPrFriendly: false,
    ...over,
  };
}

const REPOS = [
  repo('a/friendly', { firstPrFriendly: true, score: 70 }),
  repo('a/friendlier', { firstPrFriendly: true, score: 90 }),
  repo('b/new', { firstSeenAt: daysAgo(2) }),
  repo('b/day-one', { firstSeenAt: daysAgo(3) }),
  repo('c/quiet', { gfiUnanswered: 4, goodFirstIssues: 5 }),
  repo('d/huge', { stars: 50_000, goodFirstIssues: 3 }),
  repo('d/huge-no-gfi', { stars: 90_000, goodFirstIssues: 2 }),
  repo('e/fast', { responseHours: 3 }),
  repo('e/faster', { responseHours: 1 }),
  repo('e/slow', { responseHours: 30 }),
];

const ctx = collectionContext({ generatedAt: GENERATED, bootstrapAt: daysAgo(3) });
const ids = (id: string) => selectCollection(collectionById(id)!, REPOS, ctx).map((r) => r.fullName);

describe('collections', () => {
  it('has the five collections with unique ids', () => {
    expect(COLLECTIONS.map((c) => c.id)).toEqual(['first-pr', 'fresh', 'unanswered', 'big-names', 'fast-responders']);
  });

  it('applies each rule and sort', () => {
    expect(ids('first-pr')).toEqual(['a/friendlier', 'a/friendly']);
    expect(ids('unanswered')).toEqual(['c/quiet']);
    expect(ids('big-names')).toEqual(['d/huge']);
    expect(ids('fast-responders')).toEqual(['e/faster', 'e/fast']);
  });

  it('fresh skips repos listed at bootstrap', () => {
    expect(ids('fresh')).toEqual(['b/new']);
    const noBootstrap = collectionContext({ generatedAt: GENERATED, bootstrapAt: '' });
    expect(noBootstrap.bootstrapAt).toBeNull();
    expect(selectCollection(collectionById('fresh')!, REPOS, noBootstrap).map((r) => r.fullName)).toEqual([
      'b/day-one',
      'b/new',
    ]);
  });
});
