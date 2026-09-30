import { describe, expect, it } from 'vitest';
import { parseQuery } from './parse';
import type { RepoRecord } from './repo';
import { applyRepoFilter, parsedToRepoFilter, parseStars, sortRepos } from './repoFilter';

const NOW = Date.parse('2026-09-01T00:00:00Z');
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

function repo(fullName: string, over: Partial<RepoRecord> = {}): RepoRecord {
  const [owner, name] = fullName.split('/');
  return {
    fullName,
    owner,
    name,
    description: null,
    homepage: null,
    avatarUrl: `https://avatars.githubusercontent.com/${owner}`,
    language: 'rust',
    languageName: 'Rust',
    topics: [],
    stars: 100,
    forks: 10,
    license: 'MIT',
    archived: false,
    fork: false,
    mirror: false,
    lastCommitAt: daysAgo(1),
    createdAt: daysAgo(1000),
    contributingUrl: null,
    hasCodeOfConduct: false,
    goodFirstIssues: 0,
    helpWanted: 0,
    gfiSampled: 0,
    gfiUnassigned: 0,
    gfiUnanswered: 0,
    issueLabels: [],
    responseHours: null,
    responseSampledAt: null,
    fields: [],
    curated: false,
    firstSeenAt: daysAgo(30),
    score: 50,
    scoreParts: { supply: 0, activity: 0, response: 0, onboarding: 0, claimable: 0, reach: 0 },
    firstPrFriendly: false,
    ...over,
  };
}

const REPOS = [
  repo('acme/rustdb', {
    fields: ['databases'],
    goodFirstIssues: 5,
    description: 'An embedded key value store',
    score: 80,
  }),
  repo('acme/gocli', { language: 'go', fields: ['cli'], helpWanted: 3, stars: 5000, lastCommitAt: daysAgo(40) }),
  repo('Other/web-ui', {
    language: 'typescript',
    fields: ['frontend'],
    goodFirstIssues: 2,
    gfiUnanswered: 1,
    topics: ['design-system'],
    stars: 20_000,
    responseHours: 5,
  }),
  repo('other/pyml', {
    language: 'python',
    fields: ['ml'],
    goodFirstIssues: 9,
    responseHours: 30,
    score: 80,
    stars: 900,
  }),
];

const run = (q: string) => applyRepoFilter(REPOS, parsedToRepoFilter(parseQuery(q)).filter, NOW).map((r) => r.fullName);

describe('parsedToRepoFilter', () => {
  it('maps language, field and beginner', () => {
    const { filter, issueLevel } = parsedToRepoFilter(parseQuery('beginner rust databases bugs'));
    expect(filter.languages).toEqual(['rust']);
    expect(filter.fields).toEqual(['databases']);
    expect(filter.minGoodFirstIssues).toBe(1);
    expect(issueLevel.types).toEqual(['bug']);
    expect(issueLevel.difficulty).toBe('beginner');
    expect(run('beginner rust databases')).toEqual(['acme/rustdb']);
  });

  it('help wanted, recency, unanswered', () => {
    expect(run('help wanted')).toEqual(['acme/gocli']);
    expect(run('recent')).toEqual(['acme/rustdb', 'Other/web-ui', 'other/pyml']);
    expect(run('unanswered')).toEqual(['Other/web-ui']);
    const { filter, issueLevel } = parsedToRepoFilter(parseQuery('fewer than 5 comments'));
    expect(filter.unanswered).toBe(false);
    expect(issueLevel.maxComments).toBe(5);
  });

  it('keywords match name, description and topics', () => {
    expect(run('"key value"')).toEqual(['acme/rustdb']);
    expect(run('store')).toEqual(['acme/rustdb']);
    expect(run('pyml')).toEqual(['other/pyml']);
    expect(run('"design system" typescript')).toEqual(['Other/web-ui']);
  });

  it('repo:, org: and stars: qualifiers', () => {
    expect(run('repo:acme/gocli')).toEqual(['acme/gocli']);
    expect(run('org:other')).toEqual(['Other/web-ui', 'other/pyml']);
    expect(run('stars:>1000')).toEqual(['acme/gocli', 'Other/web-ui']);
    expect(run('stars:100..1000')).toEqual(['acme/rustdb', 'other/pyml']);
    const { issueLevel } = parsedToRepoFilter(parseQuery('label:bug repo:acme/gocli'));
    expect(issueLevel.qualifiers).toEqual(['label:bug']);
  });

  it('parseStars', () => {
    expect(parseStars('stars:>100')).toEqual({ min: 101 });
    expect(parseStars('stars:>=100')).toEqual({ min: 100 });
    expect(parseStars('stars:<50')).toEqual({ max: 49 });
    expect(parseStars('stars:<=50')).toEqual({ max: 50 });
    expect(parseStars('stars:10..20')).toEqual({ min: 10, max: 20 });
    expect(parseStars('stars:10..*')).toEqual({ min: 10 });
    expect(parseStars('stars')).toBeNull();
  });

  it('an empty query matches everything', () => {
    expect(run('')).toHaveLength(REPOS.length);
  });
});

describe('sortRepos', () => {
  const names = (s: Parameters<typeof sortRepos>[1]) => sortRepos(REPOS, s).map((r) => r.fullName);

  it('sorts without mutating, with deterministic ties', () => {
    const before = REPOS.map((r) => r.fullName);
    expect(names('score')).toEqual(['other/pyml', 'acme/rustdb', 'Other/web-ui', 'acme/gocli']);
    expect(REPOS.map((r) => r.fullName)).toEqual(before);
    expect(names('stars')).toEqual(['Other/web-ui', 'acme/gocli', 'other/pyml', 'acme/rustdb']);
    expect(names('gfi')).toEqual(['other/pyml', 'acme/rustdb', 'Other/web-ui', 'acme/gocli']);
    expect(names('recent')[3]).toBe('acme/gocli');
  });

  it('response puts unknown last', () => {
    expect(names('response')).toEqual(['Other/web-ui', 'other/pyml', 'acme/rustdb', 'acme/gocli']);
  });
});
