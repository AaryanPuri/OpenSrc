/**
 * UI helpers on top of the shared parser: chips ("patches") and refine toggles.
 * The parser and query builder themselves are tested once, in shared/parse.test.ts.
 */
import { describe, expect, it } from 'vitest';
import {
  buildGitHubQuery,
  getChips,
  parseQuery,
  removeChip,
  setDifficulty,
  toggleDomain,
  toggleLanguage,
  toggleType,
  type ParsedQuery,
} from './parseQuery';

const filters = (p: ParsedQuery) => ({
  languages: p.languages,
  domains: p.domains.map((d) => d.id),
  difficulty: p.difficulty,
  types: p.types,
  keywords: p.keywords,
  qualifiers: p.qualifiers,
  maxComments: p.maxComments,
  since: p.since,
});

describe('round-tripping & chip edits', () => {
  it('removes a chip and regenerates the text', () => {
    const p = parseQuery('beginner friendly rust issues in databases');
    const chips = getChips(p);
    expect(chips.map((c) => c.kind)).toEqual(['difficulty', 'language', 'domain']);
    const next = removeChip(p, { kind: 'language', id: 'rust' });
    expect(next.languages).toEqual([]);
    expect(next.raw).toBe('beginner databases');
    expect(buildGitHubQuery(next)).not.toContain('language:');
  });

  it('toggle helpers', () => {
    let p = parseQuery('rust');
    p = toggleLanguage(p, 'go');
    expect(p.languages).toEqual(['rust', 'go']);
    p = toggleType(p, 'bug');
    p = setDifficulty(p, 'help-wanted');
    p = toggleDomain(p, 'cli');
    expect(filters(parseQuery(p.raw))).toEqual(filters(p));
    p = toggleLanguage(p, 'rust');
    expect(p.languages).toEqual(['go']);
  });
});

describe('activity: comment ceilings & recency', () => {
  it('shows activity and recency as their own removable chips', () => {
    expect(
      getChips(parseQuery('issues with less than 5 comments in go')).find((c) => c.kind === 'activity')?.label,
    ).toBe('Fewer than 5 comments');
    const p = parseQuery('easy rust bugs with no comments this week');
    const kinds = getChips(p).map((c) => c.kind);
    expect(kinds).toEqual(['difficulty', 'language', 'type', 'activity', 'recency']);
    const without = removeChip(removeChip(p, { kind: 'activity', id: '0' }), { kind: 'recency', id: 'week' });
    expect(without.maxComments).toBeNull();
    expect(without.since).toBeNull();
    expect(buildGitHubQuery(without)).not.toMatch(/comments:|created:/);
  });

  it('plain-language difficulty labels', () => {
    expect(getChips(parseQuery('beginner'))[0].label).toBe('First contribution');
    expect(getChips(parseQuery('help wanted'))[0].label).toBe('Some experience');
    expect(getChips(parseQuery('intermediate'))[0].label).toBe('Ready for a challenge');
  });
});
