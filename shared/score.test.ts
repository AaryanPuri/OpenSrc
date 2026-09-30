import { describe, expect, it } from 'vitest';
import type { RepoRecord } from './repo';
import { claimableGfi, scoreGates, scoreRepo, type ScoreInput } from './score';

const NOW = Date.parse('2026-09-01T00:00:00Z');
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

function input(over: Partial<RepoRecord> = {}): ScoreInput {
  return {
    archived: false,
    fork: false,
    mirror: false,
    license: 'MIT',
    lastCommitAt: daysAgo(9),
    goodFirstIssues: 10,
    helpWanted: 4,
    gfiSampled: 10,
    gfiUnassigned: 8,
    responseHours: 48,
    contributingUrl: 'https://github.com/acme/tool/blob/HEAD/CONTRIBUTING.md',
    hasCodeOfConduct: false,
    description: 'A friendly command line tool',
    stars: 1000,
    curated: false,
    ...over,
  };
}

describe('scoreRepo: golden cases', () => {
  it('a typical healthy repo', () => {
    const r = scoreRepo(input(), NOW);
    // 8 claimable good first issues + 1 for help wanted: ln 10 / ln 51 = .59 → 17.6
    expect(r.parts).toEqual({
      supply: 17.6,
      activity: 12.3,
      response: 15.9,
      onboarding: 7.5,
      claimable: 12,
      reach: 4.3,
    });
    expect(r.score).toBe(70);
    expect(r.eligible).toBe(true);
    expect(r.firstPrFriendly).toBe(true);
  });

  it('a perfect repo scores 100', () => {
    const r = scoreRepo(
      input({
        goodFirstIssues: 50,
        helpWanted: 0,
        lastCommitAt: daysAgo(0),
        responseHours: 12,
        hasCodeOfConduct: true,
        gfiSampled: 20,
        gfiUnassigned: 20,
        stars: 100_000,
      }),
      NOW,
    );
    expect(r.parts).toEqual({ supply: 30, activity: 15, response: 20, onboarding: 10, claimable: 15, reach: 10 });
    expect(r.score).toBe(100);
  });

  it('a bare-minimum repo', () => {
    const r = scoreRepo(
      input({
        goodFirstIssues: 2,
        helpWanted: 0,
        lastCommitAt: daysAgo(90),
        responseHours: null,
        contributingUrl: null,
        description: null,
        gfiSampled: 2,
        gfiUnassigned: 1,
        stars: 30,
      }),
      NOW,
    );
    // 1 claimable: supply ln2/ln51 = .18 → 5.3; activity e^-2 = .135 → 2; unknown response .4 → 8
    expect(r.parts).toEqual({ supply: 5.3, activity: 2, response: 8, onboarding: 0, claimable: 7.5, reach: 0 });
    expect(r.score).toBe(23);
    expect(r.eligible).toBe(true);
    expect(r.firstPrFriendly).toBe(false);
  });

  const strong = (over: Partial<RepoRecord> = {}) =>
    input({ goodFirstIssues: 30, gfiSampled: 20, gfiUnassigned: 20, hasCodeOfConduct: true, stars: 20_000, ...over });

  it('slow responders are not first-PR friendly even with a high score', () => {
    const r = scoreRepo(strong({ responseHours: 100 }), NOW);
    expect(r.score).toBeGreaterThanOrEqual(70);
    expect(r.firstPrFriendly).toBe(false);
    expect(scoreRepo(strong({ responseHours: null }), NOW).firstPrFriendly).toBe(true);
  });

  it('first-PR friendly needs a score of 70, 3 claimable good first issues and a CONTRIBUTING file', () => {
    expect(scoreRepo(strong(), NOW).firstPrFriendly).toBe(true);
    expect(scoreRepo(strong({ contributingUrl: null }), NOW).firstPrFriendly).toBe(false);
    const few = strong({ goodFirstIssues: 2, gfiSampled: 2, gfiUnassigned: 2, helpWanted: 40 });
    expect(scoreRepo(few, NOW).score).toBeGreaterThanOrEqual(60);
    expect(scoreRepo(few, NOW).firstPrFriendly).toBe(false);
    // Plenty of good first issues, but nearly all of them already assigned.
    const claimed = strong({ goodFirstIssues: 20, gfiSampled: 20, gfiUnassigned: 2 });
    expect(claimableGfi(claimed)).toBe(2);
    expect(scoreRepo(claimed, NOW).firstPrFriendly).toBe(false);
    // Just under the bar.
    const r = scoreRepo(input({ lastCommitAt: daysAgo(12) }), NOW);
    expect(r.score).toBe(69);
    expect(r.firstPrFriendly).toBe(false);
  });

  it('supply counts claimable good first issues, not the whole backlog', () => {
    expect(claimableGfi({ goodFirstIssues: 40, gfiSampled: 20, gfiUnassigned: 5 })).toBe(10);
    expect(claimableGfi({ goodFirstIssues: 5, gfiSampled: 0, gfiUnassigned: 0 })).toBe(0);
    const open = scoreRepo(input({ goodFirstIssues: 40, gfiSampled: 20, gfiUnassigned: 20 }), NOW).parts.supply;
    const taken = scoreRepo(input({ goodFirstIssues: 40, gfiSampled: 20, gfiUnassigned: 5 }), NOW).parts.supply;
    expect(open).toBeGreaterThan(taken);
  });

  it('response time decays on a log scale to zero at 30 days', () => {
    expect(scoreRepo(input({ responseHours: 24 }), NOW).parts.response).toBe(20);
    expect(scoreRepo(input({ responseHours: 72 }), NOW).parts.response).toBe(13.5);
    expect(scoreRepo(input({ responseHours: null }), NOW).parts.response).toBe(8);
    expect(scoreRepo(input({ responseHours: 720 }), NOW).parts.response).toBe(0);
    expect(scoreRepo(input({ responseHours: 5000 }), NOW).parts.response).toBe(0);
  });

  it('is pure in now', () => {
    const a = scoreRepo(input(), NOW);
    const b = scoreRepo(input(), NOW + 30 * 86_400_000);
    expect(scoreRepo(input(), NOW)).toEqual(a);
    expect(b.parts.activity).toBeLessThan(a.parts.activity);
  });
});

describe('scoreGates', () => {
  it('lists every failed gate', () => {
    const r = input({
      archived: true,
      license: null,
      lastCommitAt: daysAgo(200),
      stars: 10,
      goodFirstIssues: 1,
      helpWanted: 0,
    });
    expect(scoreGates(r, NOW)).toEqual(['archived', 'license', 'stale', 'issues', 'stars']);
    expect(scoreRepo(r, NOW).eligible).toBe(false);
    expect(scoreRepo(r, NOW).firstPrFriendly).toBe(false);
  });

  it('forks and mirrors fail; curated repos skip the stars gate only', () => {
    expect(scoreGates(input({ fork: true, mirror: true }), NOW)).toEqual(['fork', 'mirror']);
    expect(scoreGates(input({ stars: 5, curated: true }), NOW)).toEqual([]);
    expect(scoreGates(input({ stars: 5, curated: true, license: null }), NOW)).toEqual(['license']);
  });

  it('counts help-wanted issues toward the issue gate', () => {
    expect(scoreGates(input({ goodFirstIssues: 0, helpWanted: 2 }), NOW)).toEqual([]);
    expect(scoreGates(input({ goodFirstIssues: 1, helpWanted: 1 }), NOW)).toEqual([]);
  });
});
