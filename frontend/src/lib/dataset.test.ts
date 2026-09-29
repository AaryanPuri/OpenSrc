import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import type { DatasetMeta, RepoRecord } from '../../../shared/repo';
import { scoreRepo } from '../../../shared/score';
import {
  clampText,
  compactDataset,
  expandDataset,
  INDEX_DESCRIPTION_MAX,
  roundHours,
  repoDetailPath,
  type CompactDataset,
} from './dataset';
import { LANGUAGES } from './dictionary';

const root = new URL('../../../data/', import.meta.url);
const repos = JSON.parse(readFileSync(new URL('repos.json', root), 'utf8')) as RepoRecord[];
const meta = JSON.parse(readFileSync(new URL('meta.json', root), 'utf8')) as DatasetMeta;
const label = (id: string) => LANGUAGES.find((l) => l.id === id)?.label ?? null;

const HOUR = 3_600_000;
const near = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) <= HOUR / 2;

describe('compact repo index', () => {
  const compact = compactDataset(repos, meta.generatedAt);
  const text = JSON.stringify(compact);
  const back = expandDataset(JSON.parse(text) as CompactDataset, label);

  it('round-trips every repo', () => {
    expect(back).toHaveLength(repos.length);
    repos.forEach((r, i) => {
      const x = back[i];
      // Exact fields.
      expect({ ...x, lastCommitAt: 0, firstSeenAt: 0, languageName: 0, scoreParts: 0 }).toEqual({
        ...r,
        description: r.description?.trim() ? clampText(r.description.trim(), INDEX_DESCRIPTION_MAX) : null,
        homepage: null,
        avatarUrl: `https://github.com/${r.owner}.png?size=96`,
        topics: [],
        createdAt: '',
        responseSampledAt: null,
        responseHours: r.responseHours === null ? null : roundHours(r.responseHours),
        lastCommitAt: 0,
        firstSeenAt: 0,
        languageName: 0,
        scoreParts: 0,
      });
      // Times are kept to the hour.
      expect(near(x.lastCommitAt, r.lastCommitAt)).toBe(true);
      expect(near(x.firstSeenAt, r.firstSeenAt)).toBe(true);
      // The language name comes back from the dictionary, or as stored when the id is unknown.
      expect(x.languageName).toBe(r.language ? label(r.language) : r.languageName);
    });
  });

  it('re-derives score parts that agree with the stored score', () => {
    const now = Date.parse(meta.generatedAt);
    back.forEach((x, i) => {
      const sum = Object.values(x.scoreParts).reduce((a, b) => a + b, 0);
      expect(Math.abs(sum - repos[i].score)).toBeLessThanOrEqual(1);
      expect(x.scoreParts).toEqual(scoreRepo(x, now).parts);
    });
  });

  it('keeps every kind of CONTRIBUTING link intact', () => {
    for (const url of [
      'https://example.org/contributing',
      'https://github.com/some-org/.github/blob/main/CONTRIBUTING.md',
      `https://github.com/${repos[0].fullName}/blob/main/docs/CONTRIBUTING.rst`,
    ]) {
      const [x] = expandDataset(compactDataset([{ ...repos[0], contributingUrl: url }], meta.generatedAt), label);
      expect(x.contributingUrl).toBe(url);
    }
  });

  it('cuts long descriptions at a word', () => {
    const cut = clampText('word '.repeat(60).trim(), 40);
    expect(cut.length).toBeLessThanOrEqual(40);
    expect(cut.endsWith('word…')).toBe(true);
    expect(clampText('short', 40)).toBe('short');
  });

  it('builds detail paths', () => {
    expect(repoDetailPath('a-b/c.d')).toBe('/data/repo/a-b/c.d.json');
  });

  it('stays small', () => {
    const gz = gzipSync(text, { level: 9 }).length;
    // ~1.5k repos should stay well under 100 KB gzipped.
    console.info(`compact index: ${text.length} bytes, ${gz} gzipped`);
    expect(gz / repos.length).toBeLessThan(60);
  });

  it('rejects an unknown format', () => {
    expect(() => expandDataset({ v: 2 } as unknown as CompactDataset)).toThrow();
  });
});
