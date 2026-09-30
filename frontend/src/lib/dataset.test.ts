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
import { collectionById, collectionContext } from '../../../shared/collections';
import { pageDataFor, prepareSite, toInitialDataset, type PageData } from '../data/pageData';

const root = new URL('../../../data/', import.meta.url);
const repos = JSON.parse(readFileSync(new URL('repos.json', root), 'utf8')) as RepoRecord[];
const meta = JSON.parse(readFileSync(new URL('meta.json', root), 'utf8')) as DatasetMeta;
const label = (id: string) => LANGUAGES.find((l) => l.id === id)?.label ?? null;

const HOUR = 3_600_000;
const near = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) <= HOUR / 2;

describe('Fresh this week after the index round-trip', () => {
  // The live case: bootstrap at 08:07:40, built at 18:32:00. Rounding 10h24m to the nearest
  // hour put every bootstrap repo at 08:32, after bootstrapAt, so all of them looked fresh.
  const bootstrapAt = '2026-09-29T08:07:40.575Z';
  const generatedAt = '2026-09-29T18:32:00.483Z';
  const at = (fullName: string, firstSeenAt: string): RepoRecord => ({ ...repos[0], fullName, firstSeenAt });
  const list = [
    at('a/bootstrap', bootstrapAt),
    at('b/bootstrap', '2026-09-29T08:07:39.000Z'),
    at('c/later-run', '2026-09-29T18:32:00.483Z'),
    at('d/next-hour', '2026-09-29T09:10:00.000Z'),
  ];
  const m: DatasetMeta = { ...meta, generatedAt, bootstrapAt, count: list.length };

  it('keeps bootstrap repos out, and the rest in', () => {
    const back = expandDataset(compactDataset(list, generatedAt), label);
    const fresh = collectionById('fresh')!;
    const ctx = collectionContext(m);
    expect(ctx.bootstrapAt).toBe(Date.parse(bootstrapAt));
    expect(back.filter((r) => fresh.includes(r, ctx)).map((r) => r.fullName)).toEqual(['c/later-run', 'd/next-hour']);
  });

  it('carries bootstrapAt through the page data a pre-rendered page inlines', () => {
    const site = prepareSite(list, m);
    const pd = JSON.parse(
      JSON.stringify(
        pageDataFor(
          site,
          { kind: 'collection', path: '/collections/fresh', id: 'fresh' },
          { siteUrl: '', indexUrl: '' },
        ),
      ),
    ) as PageData;
    expect(pd.meta.bootstrapAt).toBe(bootstrapAt);
    expect(pd.view?.total).toBe(2);
    const initial = toInitialDataset(pd);
    expect(initial.meta.bootstrapAt).toBe(bootstrapAt);
    expect(initial.repos?.map((r) => r.fullName).sort()).toEqual(['c/later-run', 'd/next-hour']);
  });
});

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
        // Only in the full record (/data/repo/…), for the repo page.
        issueLabels: [],
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
      // First-seen times are rounded down to the hour before (never later than the real time).
      const early = Date.parse(r.firstSeenAt) - Date.parse(x.firstSeenAt);
      expect(early).toBeGreaterThanOrEqual(0);
      expect(early).toBeLessThan(HOUR);
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
