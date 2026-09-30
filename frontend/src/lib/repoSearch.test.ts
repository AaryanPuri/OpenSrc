import { describe, expect, it } from 'vitest';
import type { RepoRecord } from '../../../shared/repo';
import { REPO_EXAMPLE_QUERIES } from './examples';
import { parseQuery } from './parseQuery';
import { GOOD_FIRST_LABELS } from '../../../shared/labels';
import {
  backToSearchPath,
  defaultIssueTab,
  filterRepos,
  issueLevelChips,
  readRepoQuery,
  removeRepoChip,
  repoChips,
  repoIssueQuery,
  repoView,
  withoutFirstPrWords,
  type RepoSort,
} from './repoSearch';

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
  it('beginner rust repos: beginner wording turns first-PR mode on', () => {
    expect(search('beginner friendly rust repos')).toEqual(['a/rust-top']);
    const q = readRepoQuery(parseQuery('beginner friendly rust repos'));
    expect(repoView(q, null, false)).toEqual({ first: true, sort: 'claimable' });
    expect(repoView(q, 'stars', false)).toEqual({ first: true, sort: 'stars' });
    expect(repoView(readRepoQuery(parseQuery('rust')), null, false)).toEqual({ first: false, sort: 'score' });
    expect(repoView(readRepoQuery(parseQuery('rust')), null, true)).toEqual({ first: true, sort: 'claimable' });
  });

  it('help wanted and intermediate do not narrow repos', () => {
    expect(search('help wanted rust')).toEqual(search('rust'));
    expect(search('intermediate rust')).toEqual(search('rust'));
    expect(readRepoQuery(parseQuery('intermediate')).filter.firstPr).toBe(false);
  });

  it('unpicking first-PR mode takes the beginner wording with it', () => {
    const next = withoutFirstPrWords(parseQuery('beginner friendly rust repos'));
    expect(next.difficulty).toBeNull();
    expect(parseQuery(next.raw).languages).toEqual(['rust']);
    expect(readRepoQuery(parseQuery(next.raw)).filter.firstPr).toBe(false);
    const plain = parseQuery('rust');
    expect(withoutFirstPrWords(plain)).toBe(plain);
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
    for (const ex of REPO_EXAMPLE_QUERIES)
      expect([ex, readRepoQuery(parseQuery(ex)).filter.keywords]).toEqual([ex, []]);
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

  it('says what difficulty means for repos: one First-PR patch, one Contributions welcome patch', () => {
    expect(repoChips(parseQuery('beginner rust'))[0].label).toBe('First-PR friendly');
    for (const q of ['help wanted', 'intermediate', 'challenging']) {
      const [chip] = repoChips(parseQuery(q));
      expect([q, chip.label, chip.scope]).toEqual([q, 'Contributions welcome', 'issues']);
    }
    // Repo pages don't show it as a narrowing patch; they open on that tab instead.
    expect(issueLevelChips(parseQuery('help wanted rust'))).toEqual([]);
    expect(defaultIssueTab(parseQuery('intermediate rust'))).toBe('help');
    expect(defaultIssueTab(parseQuery('beginner rust'))).toBe('gfi');
    expect(defaultIssueTab(null)).toBe('gfi');
  });
});

describe('repo issue query', () => {
  const unknown = (fullName: string) => ({ fullName, issueLabels: [] });

  it("searches the common good first issue labels when the repo's own are unknown", () => {
    const q = repoIssueQuery(unknown('rust-lang/rust'), 'gfi');
    expect(q).toMatch(/^repo:rust-lang\/rust is:issue is:open no:assignee archived:false label:"good first issue",/);
    expect(q.length).toBeLessThanOrEqual(256);
  });

  it('searches only the spellings the repo uses', () => {
    const repo = { fullName: 'bevyengine/bevy', issueLabels: ['D-Trivial', 'help wanted'] };
    expect(repoIssueQuery(repo, 'gfi')).toBe(
      'repo:bevyengine/bevy is:issue is:open no:assignee archived:false label:"D-Trivial"',
    );
    expect(repoIssueQuery(repo, 'help')).toContain('label:"help wanted"');
    expect(repoIssueQuery({ fullName: 'a/b', issueLabels: ['E-easy'] }, 'help')).toContain('"help-wanted"');
  });

  it('stays under 256 characters by dropping spellings', () => {
    const repo = { fullName: `some-organisation/${'x'.repeat(60)}`, issueLabels: GOOD_FIRST_LABELS };
    const q = repoIssueQuery(repo, 'gfi', parseQuery('rust docs tests bugs fewer than 3 comments'));
    expect(q.length).toBeLessThanOrEqual(256);
    expect(q).toContain('label:"good first issue"');
    expect(q).toMatch(/comments:<3$/);
  });

  it('adds the issue-level parts of the directory search', () => {
    const q = repoIssueQuery(unknown('a/b'), 'all', parseQuery('beginner rust docs no comments'));
    expect(q).toBe('repo:a/b is:issue is:open no:assignee archived:false label:documentation comments:0');
  });

  it('help wanted tab', () => {
    expect(repoIssueQuery(unknown('a/b'), 'help')).toContain('label:"help wanted","help-wanted"');
  });
});

describe('back to your search', () => {
  it('keeps q, sort and first, and nothing else', () => {
    expect(backToSearchPath(new URLSearchParams('q=rust docs&sort=stars&first=1&tab=help&demo=1'))).toBe(
      '/?q=rust+docs&sort=stars&first=1',
    );
    expect(backToSearchPath(new URLSearchParams('q=rust&sort=score'))).toBe('/?q=rust');
    expect(backToSearchPath(new URLSearchParams('sort=stars'))).toBe('/');
    // In first-PR mode the default is "most unclaimed", so a picked "best score" is kept.
    expect(backToSearchPath(new URLSearchParams('q=rust&sort=score&first=1'))).toBe('/?q=rust&sort=score&first=1');
    expect(backToSearchPath(new URLSearchParams('q=rust&sort=claimable&first=1'))).toBe('/?q=rust&first=1');
    expect(backToSearchPath(new URLSearchParams('q=beginner rust&sort=claimable'))).toBe('/?q=beginner+rust');
  });
});
