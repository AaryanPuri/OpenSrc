/**
 * The repo directory as the browser downloads it.
 *
 * - `/data/repos.json`: a compact, column-per-field index of data/repos.json
 *   (columns gzip far better than one object per repo). Times are whole hours
 *   before `generatedAt`, CONTRIBUTING links are shortened, booleans are packed
 *   into one number and descriptions are cut to card length. Topics, homepage,
 *   avatarUrl, createdAt and scoreParts are left out: the parts are re-derived
 *   with scoreRepo, the rest come back as neutral values.
 * - `/data/repo/<owner>/<name>.json`: the full record of one repo, which the
 *   repo page loads for the homepage, topics and the whole description.
 *
 * Plain TypeScript: the Vite plugin (Node) and the app both use it.
 */
import type { DatasetMeta, RepoRecord } from '../../../shared/repo';
import { scoreRepo } from '../../../shared/score';

export const COMPACT_VERSION = 1;
/** Card descriptions are clamped to two lines, so the index keeps this many characters at most. */
export const INDEX_DESCRIPTION_MAX = 110;

type Str = string | 0;

export interface CompactDataset {
  v: typeof COMPACT_VERSION;
  /** meta.generatedAt: every time in the index is counted back from it. */
  g: string;
  /** fullName */
  n: string[];
  /** description, cut to INDEX_DESCRIPTION_MAX */
  d: Str[];
  /** language id */
  l: Str[];
  /** languageName, only kept when the language id is unknown (else the dictionary label is used) */
  ln: Str[];
  s: number[];
  f: number[];
  /** license */
  li: Str[];
  /** hours from the last commit to generatedAt */
  lc: number[];
  /**
   * CONTRIBUTING: 0 none, 1 the repo's own /blob/HEAD/CONTRIBUTING.md, "/…" a path inside the repo,
   * else the link without "https://github.com/" (or a full link off GitHub)
   */
  k: (Str | 1)[];
  /** flags, see FLAG */
  x: number[];
  gfi: number[];
  hw: number[];
  gs: number[];
  gu: number[];
  ga: number[];
  /** responseHours, see roundHours */
  rh: (number | null)[];
  /** fields, comma-separated */
  fl: string[];
  /** hours from firstSeenAt to generatedAt */
  fs: number[];
  sc: number[];
}

const HOUR = 3_600_000;
const GITHUB = 'https://github.com/';

const FLAG = { coc: 1, curated: 2, firstPr: 4, archived: 8, fork: 16, mirror: 32 } as const;

const hoursBefore = (iso: string, base: number) => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.max(0, Math.round((base - t) / HOUR)) : -1;
};
const fromHours = (h: number, base: number) => (h < 0 ? '' : new Date(base - h * HOUR).toISOString());

const standardContributing = (fullName: string) => `${GITHUB}${fullName}/blob/HEAD/CONTRIBUTING.md`;

/** Response times as the index keeps them: one decimal under 10 hours, whole hours above. */
export const roundHours = (h: number) => (h < 10 ? Math.round(h * 10) / 10 : Math.round(h));

/** Cut at a word boundary with an ellipsis. */
export function clampText(s: string, max: number): string {
  if (s.length <= max) return s;
  const space = s.lastIndexOf(' ', max - 1);
  const cut = space > max * 0.6 ? space : max - 1;
  return `${s.slice(0, cut).replace(/[\s,.;:–—-]+$/, '')}…`;
}

export function compactDataset(repos: RepoRecord[], generatedAt: string): CompactDataset {
  const base = Date.parse(generatedAt);
  const col = <T>(fn: (r: RepoRecord) => T) => repos.map(fn);
  return {
    v: COMPACT_VERSION,
    g: generatedAt,
    n: col((r) => r.fullName),
    d: col((r) => {
      const d = r.description?.trim();
      return d ? clampText(d, INDEX_DESCRIPTION_MAX) : 0;
    }),
    l: col((r) => r.language ?? 0),
    ln: col((r) => (r.language ? 0 : (r.languageName ?? 0))),
    s: col((r) => r.stars),
    f: col((r) => r.forks),
    li: col((r) => r.license ?? 0),
    lc: col((r) => hoursBefore(r.lastCommitAt, base)),
    k: col((r) =>
      !r.contributingUrl
        ? 0
        : r.contributingUrl === standardContributing(r.fullName)
          ? 1
          : r.contributingUrl.startsWith(`${GITHUB}${r.fullName}/`)
            ? r.contributingUrl.slice(GITHUB.length + r.fullName.length)
            : r.contributingUrl.startsWith(GITHUB)
              ? r.contributingUrl.slice(GITHUB.length)
              : r.contributingUrl,
    ),
    x: col(
      (r) =>
        (r.hasCodeOfConduct ? FLAG.coc : 0) |
        (r.curated ? FLAG.curated : 0) |
        (r.firstPrFriendly ? FLAG.firstPr : 0) |
        (r.archived ? FLAG.archived : 0) |
        (r.fork ? FLAG.fork : 0) |
        (r.mirror ? FLAG.mirror : 0),
    ),
    gfi: col((r) => r.goodFirstIssues),
    hw: col((r) => r.helpWanted),
    gs: col((r) => r.gfiSampled),
    gu: col((r) => r.gfiUnassigned),
    ga: col((r) => r.gfiUnanswered),
    rh: col((r) => (r.responseHours === null ? null : roundHours(r.responseHours))),
    fl: col((r) => r.fields.join(',')),
    fs: col((r) => hoursBefore(r.firstSeenAt, base)),
    sc: col((r) => r.score),
  };
}

/** Display name for a language id, supplied by the caller (keeps this module free of the dictionary). */
export type LanguageLabel = (id: string) => string | null;

export function expandDataset(c: CompactDataset, languageLabel: LanguageLabel = () => null): RepoRecord[] {
  if (!c || c.v !== COMPACT_VERSION || !Array.isArray(c.n)) throw new Error('Unsupported repo index format');
  const base = Date.parse(c.g);
  return c.n.map((fullName, i) => {
    const slash = fullName.indexOf('/');
    const owner = fullName.slice(0, slash);
    const language = c.l[i] || null;
    const k = c.k[i];
    const flags = c.x[i];
    const repo: RepoRecord = {
      fullName,
      owner,
      name: fullName.slice(slash + 1),
      description: c.d[i] || null,
      homepage: null,
      avatarUrl: `${GITHUB}${owner}.png?size=96`,
      language,
      languageName: language ? languageLabel(language) : c.ln[i] || null,
      topics: [],
      stars: c.s[i],
      forks: c.f[i],
      license: c.li[i] || null,
      archived: !!(flags & FLAG.archived),
      fork: !!(flags & FLAG.fork),
      mirror: !!(flags & FLAG.mirror),
      lastCommitAt: fromHours(c.lc[i], base),
      createdAt: '',
      contributingUrl:
        k === 0
          ? null
          : k === 1
            ? standardContributing(fullName)
            : k.startsWith('/')
              ? `${GITHUB}${fullName}${k}`
              : /^https?:\/\//.test(k)
                ? k
                : `${GITHUB}${k}`,
      hasCodeOfConduct: !!(flags & FLAG.coc),
      goodFirstIssues: c.gfi[i],
      helpWanted: c.hw[i],
      gfiSampled: c.gs[i],
      gfiUnassigned: c.gu[i],
      gfiUnanswered: c.ga[i],
      // Not in the index: the repo page gets them with the full record.
      issueLabels: [],
      responseHours: c.rh[i],
      responseSampledAt: null,
      fields: c.fl[i] ? c.fl[i].split(',') : [],
      curated: !!(flags & FLAG.curated),
      firstSeenAt: fromHours(c.fs[i], base),
      score: c.sc[i],
      scoreParts: { supply: 0, activity: 0, response: 0, onboarding: 0, claimable: 0, reach: 0 },
      firstPrFriendly: !!(flags & FLAG.firstPr),
    };
    // The index doesn't carry the per-part points; they are cheap to re-derive.
    repo.scoreParts = scoreRepo(repo, base).parts;
    return repo;
  });
}

/** Where one repo's full record is served. */
export function repoDetailPath(fullName: string): string {
  return `/data/repo/${fullName.split('/').map(encodeURIComponent).join('/')}.json`;
}

/** Minimal meta for a hand-made list of repos (tests, fixtures). */
export function metaFor(repos: RepoRecord[], generatedAt: string): DatasetMeta {
  const count = (key: (r: RepoRecord) => string[]) =>
    repos.reduce<Record<string, number>>((acc, r) => {
      for (const k of key(r)) acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {});
  return {
    version: 1,
    generatedAt,
    bootstrapAt: generatedAt,
    count: repos.length,
    firstPrFriendly: repos.filter((r) => r.firstPrFriendly).length,
    languages: count((r) => [r.language ?? 'other']),
    fields: count((r) => r.fields),
    pointsUsed: 0,
    scope: 'full',
  };
}
