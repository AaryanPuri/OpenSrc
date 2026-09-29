import { describe, expect, it } from 'vitest';
import type { RepoRecord } from '../../../shared/repo';
import { REPO_EXAMPLE_QUERIES } from './examples';
import { parseQuery } from './parseQuery';
import { filterRepos, readRepoQuery, removeRepoChip, repoChips, repoIssueQuery, type RepoSort } from './repoSearch';

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
    avatarUrl: '',
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
    createdAt: '',
    contributingUrl: null,
    hasCodeOfConduct: false,
    goodFirstIssues: 3,
    helpWanted: 0,
    gfiSampled: 3,
    gfiUnassigned: 3,
    gfiUnanswered: 0,
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
  repo('a/rust-top', { score: 90, stars: 500, firstPrFriendly: true }),
  repo('b/rust-big', { score: 70, stars: 50_000, goodFirstIssues: 20 }),
  repo('c/rust-none', { score: 95, goodFirstIssues: 0, helpWanted: 4 }),
  repo('d/py-ml', { language: 'python', fields: ['ml'], score: 80, description: 'Machine learning toolkit' }),
  repo('e/go-ops-fast', { language: 'go', fields: ['devops'], responseHours: 6, score: 60 }),
  repo('f/go-ops-slow', { language: 'go', fields: ['devops'], responseHours: 200, score: 85 }),
  repo('g/go-ops-unknown', { language: 'go', fields: ['devops'], score: 99 }),
  repo('h/rust-stale', { score: 40, lastCommitAt: daysAgo(40) }),
];

const search = (q: string, sort: RepoSort = 'score', first = false) =>
  filterRepos(REPOS, readRepoQuery(parseQuery(q)), { sort, first, now: NOW }).map((r) => r.fullName);

describe('repo search', () => {
  it('beginner rust repos: rust repos with good first issues, best score first', () => {
    expect(search('beginner friendly rust repos')).toEqual(['a/rust-top', 'b/rust-big', 'h/rust-stale']);
  });

  it('sorts by stars, recency and good first issues', () => {
    expect(search('rust', 'stars')[0]).toBe('b/rust-big');
    expect(search('rust', 'gfi')[0]).toBe('b/rust-big');
    expect(search('rust', 'recent').at(-1)).toBe('h/rust-stale');
  });

  it('fastest replies first, unknown last', () => {
    expect(search('go', 'response')).toEqual(['e/go-ops-fast', 'f/go-ops-slow', 'g/go-ops-unknown']);
  });

  it('python machine learning projects: language plus field, filler words ignored', () => {
    expect(search('python machine learning projects')).toEqual(['d/py-ml']);
  });

  it('go devops tools with fast maintainers: only quick responders', () => {
    const q = readRepoQuery(parseQuery('go devops tools with fast maintainers'));
    expect(q.fastResponse).toBe(true);
    expect(q.filter.keywords).toEqual([]);
    expect(search('go devops tools with fast maintainers')).toEqual(['e/go-ops-fast']);
  });

  it('first-PR friendly only', () => {
    expect(search('rust', 'score', true)).toEqual(['a/rust-top']);
  });

  it('recent commits', () => {
    expect(search('rust this week')).not.toContain('h/rust-stale');
  });

  it('every example query reads fully (no leftover keywords that could dead-end the grid)', () => {
    for (const ex of REPO_EXAMPLE_QUERIES) expect([ex, readRepoQuery(parseQuery(ex)).filter.keywords]).toEqual([ex, []]);
  });

  it('an empty query lists everything by score', () => {
    expect(search('')).toHaveLength(REPOS.length);
    expect(search('')[0]).toBe('g/go-ops-unknown');
  });
});

describe('repo-mode patches', () => {
  it('merges "fast maintainers" into one patch and removes it whole', () => {
    const parsed = parseQuery('go devops tools with fast maintainers');
    const chips = repoChips(parsed);
    const fast = chips.find((c) => c.kind === 'response')!;
    expect(fast.label).toBe('Fast maintainers');
    expect(chips.some((c) => c.kind === 'keyword')).toBe(false);
    const next = removeRepoChip(parsed, fast);
    expect(readRepoQuery(parseQuery(next.raw)).fastResponse).toBe(false);
    expect(parseQuery(next.raw).languages).toEqual(['go']);
  });

  it('marks issue-only patches', () => {
    const chips = repoChips(parseQuery('rust docs bugs'));
    expect(chips.filter((c) => c.scope === 'issues').map((c) => c.id)).toEqual(['docs', 'bug']);
    expect(chips.find((c) => c.kind === 'language')?.scope).toBeUndefined();
  });

  it('says what difficulty means for repos', () => {
    expect(repoChips(parseQuery('beginner rust'))[0].label).toBe('Good first issues');
  });
});

describe('repo issue query', () => {
  it('searches good first issue labels in one repo', () => {
    const q = repoIssueQuery('rust-lang/rust', 'gfi');
    expect(q).toMatch(/^repo:rust-lang\/rust is:issue is:open no:assignee archived:false label:"good first issue",/);
    expect(q.length).toBeLessThan(256);
  });

  it('adds the issue-level parts of the directory search', () => {
    const q = repoIssueQuery('a/b', 'all', parseQuery('beginner rust docs no comments'));
    expect(q).toBe('repo:a/b is:issue is:open no:assignee archived:false label:documentation comments:0');
  });

  it('help wanted tab', () => {
    expect(repoIssueQuery('a/b', 'help')).toContain('label:"help wanted","help-wanted"');
  });
});
