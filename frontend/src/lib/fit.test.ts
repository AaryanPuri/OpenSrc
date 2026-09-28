import { describe, expect, it } from 'vitest';
import { ALL_FIELDS } from './examples';
import { getFixtures } from './fixtures';
import { whyItFits, whyItFitsText } from './fit';
import { activity, dateSignals, plural, shortAgo } from './format';
import { parseQuery } from './parseQuery';
import { applyPreset, matchPreset } from './presets';
import { migrateStorage } from './storage';
import type { Issue } from './types';

const NOW = Date.parse('2026-09-26T12:00:00Z');
const base = (over: Partial<Issue> = {}): Issue => ({
  id: 1,
  number: 7,
  title: 'Improve error for missing index',
  body: 'The database layer should explain which field is missing.',
  htmlUrl: 'https://github.com/a/b/issues/7',
  repo: { fullName: 'a/b', owner: 'a', name: 'b', htmlUrl: 'https://github.com/a/b', language: 'Rust' },
  labels: [{ name: 'good first issue', color: '7057ff' }],
  comments: 2,
  createdAt: '2026-09-22T12:00:00Z',
  updatedAt: '2026-09-25T12:00:00Z',
  ...over,
});

describe('whyItFits', () => {
  it('confirms what the user asked for, then size and social signals', () => {
    const r = whyItFits(base(), parseQuery('beginner rust databases'), NOW);
    expect(r).toEqual(['good first issue in Rust', 'touches databases', 'quiet thread (2 comments)']);
    expect(whyItFitsText(base(), parseQuery('beginner rust databases'), NOW)).toMatch(/^Good first issue in Rust · /);
  });

  it('uses the single language filter when the payload has no language', () => {
    const i = base({ repo: { ...base().repo, language: undefined } });
    expect(whyItFits(i, parseQuery('rust'), NOW)[0]).toBe('good first issue in Rust');
  });

  it('describes docs-sized and untouched issues', () => {
    const i = base({
      labels: [{ name: 'documentation', color: '0075ca' }],
      comments: 0,
      createdAt: '2026-01-01T00:00:00Z',
    });
    expect(whyItFits(i, parseQuery('docs'), NOW)).toEqual(['a docs-sized change', 'no one has replied yet']);
  });

  it('always returns between one and three reasons', () => {
    const quiet = base({
      labels: [],
      comments: 40,
      createdAt: '2020-01-01T00:00:00Z',
      updatedAt: '2020-01-01T00:00:00Z',
      repo: { ...base().repo, language: null },
    });
    expect(whyItFits(quiet, null, NOW)).toEqual(['open and unassigned']);
    for (const i of getFixtures()) {
      const r = whyItFits(i, parseQuery('beginner'), NOW);
      expect(r.length).toBeGreaterThan(0);
      expect(r.length).toBeLessThanOrEqual(3);
    }
  });
});

describe('format: plural & activity', () => {
  it('pluralises counts', () => {
    expect(plural(1, 'comment')).toBe('1 comment');
    expect(plural(0, 'comment')).toBe('0 comments');
    expect(plural(1200, 'issue')).toBe('1,200 issues');
    expect(plural(2, 'repository', 'repositories')).toBe('2 repositories');
  });

  it('flags issues untouched for over six months', () => {
    expect(activity({ updatedAt: '2026-09-20T12:00:00Z' }, NOW)).toEqual({ label: 'updated 6 days ago', stale: false });
    expect(activity({ updatedAt: '2026-01-01T00:00:00Z' }, NOW).stale).toBe(true);
  });

  it('dateSignals: one date unless activity is meaningfully later', () => {
    // Opened and touched on nearly the same day: a single "opened" date.
    const same = dateSignals({ createdAt: '2026-09-22T12:00:00Z', updatedAt: '2026-09-23T10:00:00Z' }, NOW);
    expect(same).toMatchObject({
      opened: '4 days ago',
      openedShort: '4d',
      active: null,
      activeShort: null,
      stale: false,
    });
    // Opened a month ago, active yesterday: both.
    const later = dateSignals({ createdAt: '2026-08-20T12:00:00Z', updatedAt: '2026-09-25T12:00:00Z' }, NOW);
    expect(later).toMatchObject({ opened: 'last month', active: 'yesterday', activeShort: '1d' });
    // Nothing for over six months: stale.
    const stale = dateSignals({ createdAt: '2025-01-01T00:00:00Z', updatedAt: '2026-02-01T00:00:00Z' }, NOW);
    expect(stale.stale).toBe(true);
    expect(shortAgo('2026-09-05T12:00:00Z', NOW)).toBe('3w');
  });
});

describe('time presets', () => {
  it('maps an hour / a weekend / ongoing to difficulty + kind of work, and toggles off', () => {
    const hour = applyPreset(parseQuery('rust'), 'hour');
    expect(hour.difficulty).toBe('beginner');
    expect(hour.types).toEqual(['docs']);
    expect(matchPreset(parseQuery(hour.raw))).toBe('hour');
    const weekend = applyPreset(parseQuery(hour.raw), 'weekend');
    expect(weekend.difficulty).toBe('help-wanted');
    expect(weekend.types).toEqual([]);
    expect(weekend.languages).toEqual(['rust']);
    const ongoing = applyPreset(weekend, 'ongoing');
    expect(ongoing.types).toEqual(['feature']);
    const off = applyPreset(ongoing, 'ongoing');
    expect(off.difficulty).toBeNull();
    expect(off.types).toEqual([]);
    expect(off.raw).toBe('rust');
  });
});

describe('field quilt', () => {
  it('lists all 22 fields once, and each tile query parses to its own field', () => {
    expect(ALL_FIELDS).toHaveLength(22);
    expect(new Set(ALL_FIELDS.map((f) => f.id)).size).toBe(22);
    for (const f of ALL_FIELDS) {
      expect(
        parseQuery(f.query).domains.map((d) => d.id),
        f.query,
      ).toContain(f.id);
    }
  });
});

describe('storage migration', () => {
  it('moves legacy ocf: keys to opensrc:', () => {
    const m = new Map<string, string>([
      ['ocf:theme', '"light"'],
      ['ocf:saved', '[]'],
    ]);
    const s = {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, v),
      removeItem: (k: string) => void m.delete(k),
    };
    migrateStorage(s);
    expect(m.get('opensrc:theme')).toBe('"light"');
    expect(m.get('opensrc:saved')).toBe('[]');
    expect(m.has('ocf:theme')).toBe(false);
  });
});
