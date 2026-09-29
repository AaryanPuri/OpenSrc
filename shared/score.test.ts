import { describe, expect, it } from 'vitest';
import type { RepoRecord } from './repo';
import { scoreGates, scoreRepo, type ScoreInput } from './score';

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
    expect(r.parts).toEqual({
      supply: 18.1,
      activity: 16.4,
      response: 11.9,
      onboarding: 11.3,
      claimable: 12,
      reach: 4.3,
    });
    expect(r.score).toBe(74);
    expect(r.eligible).toBe(true);
    expect(r.firstPrFriendly).toBe(true);
  });

  it('a perfect repo scores 100', () => {
    const r = scoreRepo(
      input({
        goodFirstIssues: 30,
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
    expect(r.parts).toEqual({ supply: 25, activity: 20, response: 15, onboarding: 15, claimable: 15, reach: 10 });
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
    // supply ln3/ln31 = .32 → 8; activity e^-2 = .135 → 2.7; unknown response is neutral → 7.5
    expect(r.parts).toEqual({ supply: 8, activity: 2.7, response: 7.5, onboarding: 0, claimable: 7.5, reach: 0 });
    expect(r.score).toBe(26);
    expect(r.eligible).toBe(true);
    expect(r.firstPrFriendly).toBe(false);
  });

  it('slow responders are not first-PR friendly even with a high score', () => {
    const r = scoreRepo(input({ responseHours: 100 }), NOW);
    expect(r.score).toBeGreaterThanOrEqual(60);
    expect(r.firstPrFriendly).toBe(false);
    expect(scoreRepo(input({ responseHours: null }), NOW).firstPrFriendly).toBe(true);
  });

  it('first-PR friendly needs 3 good first issues and a CONTRIBUTING file', () => {
    expect(scoreRepo(input({ contributingUrl: null }), NOW).firstPrFriendly).toBe(false);
    const few = input({ goodFirstIssues: 2, helpWanted: 40, hasCodeOfConduct: true, stars: 50_000 });
    expect(scoreRepo(few, NOW).score).toBeGreaterThanOrEqual(60);
    expect(scoreRepo(few, NOW).firstPrFriendly).toBe(false);
  });

  it('response time decays on a log scale to zero at 30 days', () => {
    expect(scoreRepo(input({ responseHours: 24 }), NOW).parts.response).toBe(15);
    expect(scoreRepo(input({ responseHours: 72 }), NOW).parts.response).toBe(10.2);
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
