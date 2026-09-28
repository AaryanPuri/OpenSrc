import raw from '../data/fixtures.json';
import { LANGUAGES } from './dictionary';
import type { Issue, SearchResult, SortKey } from './types';

interface RawFixture {
  id: number;
  number: number | null;
  title: string;
  body: string;
  html_url: string;
  repository: { full_name: string; owner: string; language: string; stars: number; topics: string[] };
  labels: { name: string; color: string }[];
  comments: number;
  created_at: string;
  updated_at: string;
}

/**
 * Fixture dates are shifted so the newest sample always looks ~1 day old,
 * keeping relative ages ("3 days ago") believable whenever the app runs.
 */
function loadFixtures(now = Date.now()): Issue[] {
  const rows = raw as RawFixture[];
  const newest = Math.max(...rows.map((r) => Date.parse(r.created_at)));
  const shift = now - 86_400_000 - newest;
  const iso = (s: string) => new Date(Date.parse(s) + shift).toISOString();
  return rows.map((r) => {
    const [, name] = r.repository.full_name.split('/');
    return {
      id: r.id,
      number: r.number,
      title: r.title,
      body: r.body,
      htmlUrl: r.html_url,
      repo: {
        fullName: r.repository.full_name,
        owner: r.repository.owner,
        name,
        htmlUrl: `https://github.com/${r.repository.full_name}`,
        language: r.repository.language,
        stars: r.repository.stars,
        topics: r.repository.topics,
      },
      labels: r.labels,
      comments: r.comments,
      createdAt: iso(r.created_at),
      updatedAt: iso(r.updated_at),
      author: null,
      sample: true,
    };
  });
}

let cache: Issue[] | null = null;
export function getFixtures(): Issue[] {
  return (cache ??= loadFixtures());
}

const BEGINNER_LABELS = ['good first issue', 'junior job', 'easy', 'beginner', 'starter', 'first timers only'];

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[-_:/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

interface ParsedGh {
  labels: string[][]; // each inner array is an OR group
  notLabels: string[];
  languages: string[];
  terms: string[];
  repos: string[];
  /** Exclusive comment ceiling (`comments:<N`), or exact 0 (`comments:0`). */
  maxComments: number | null;
  exactComments: number | null;
  createdAfter: number | null;
}

/** Parse the subset of GitHub search syntax our builder emits. */
function parseGhQuery(q: string): ParsedGh {
  const out: ParsedGh = {
    labels: [],
    notLabels: [],
    languages: [],
    terms: [],
    repos: [],
    maxComments: null,
    exactComments: null,
    createdAfter: null,
  };
  const re = /(-?)([a-z]+):((?:"[^"]*"|[^\s",]+)(?:,(?:"[^"]*"|[^\s",]+))*)|"([^"]+)"|(\S+)/gi;
  let m: RegExpExecArray | null;
  const unq = (s: string) => s.replace(/^"|"$/g, '');
  while ((m = re.exec(q))) {
    const [, neg, key, val, quoted, word] = m;
    if (key) {
      const values = val.match(/"[^"]*"|[^,]+/g)?.map(unq) ?? [];
      const k = key.toLowerCase();
      if (k === 'label') neg ? out.notLabels.push(...values.map(norm)) : out.labels.push(values.map(norm));
      else if (k === 'language') out.languages.push(...values.map((v) => v.toLowerCase()));
      else if (k === 'repo') out.repos.push(...values.map((v) => v.toLowerCase()));
      else if (k === 'comments') {
        const m2 = /^(<|<=)?(\d+)$/.exec(val);
        if (m2)
          m2[1] ? (out.maxComments = Number(m2[2]) + (m2[1] === '<=' ? 1 : 0)) : (out.exactComments = Number(m2[2]));
      } else if (k === 'created') {
        const m2 = /^>=?(\d{4}-\d{2}-\d{2})$/.exec(val);
        if (m2) out.createdAfter = Date.parse(m2[1]);
      }
      continue;
    }
    const t = (quoted ?? word ?? '').toLowerCase();
    if (t) out.terms.push(t);
  }
  return out;
}

function labelMatches(issue: Issue, wanted: string): boolean {
  const names = issue.labels.map((l) => norm(l.name));
  const aliases = wanted === 'good first issue' ? BEGINNER_LABELS : [wanted];
  return names.some((n) => aliases.some((a) => n === a || n.includes(a) || (a.length > 3 && n.endsWith(` ${a}`))));
}

function languageMatches(issue: Issue, qualifier: string): boolean {
  const lang = issue.repo.language?.toLowerCase();
  if (!lang) return false;
  const def = LANGUAGES.find((l) => l.qualifier === qualifier);
  return lang === qualifier || lang === def?.label.toLowerCase();
}

function termMatches(issue: Issue, term: string): boolean {
  const hay = [
    issue.title,
    issue.body,
    issue.repo.fullName,
    ...(issue.repo.topics ?? []),
    ...issue.labels.map((l) => l.name),
  ]
    .join(' ')
    .toLowerCase();
  const t = term.replace(/s$/, '');
  return hay.includes(t) || hay.includes(t.replace(/\s+/g, '-'));
}

function score(issue: Issue, terms: string[]): number {
  return terms.reduce((acc, t) => acc + (termMatches(issue, t) ? 1 : 0), 0);
}

export function sortIssues(items: Issue[], sort: SortKey): Issue[] {
  const copy = [...items];
  if (sort === 'newest') copy.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  if (sort === 'comments')
    copy.sort((a, b) => a.comments - b.comments || Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return copy;
}

/**
 * Search the bundled sample dataset with (roughly) GitHub semantics.
 * If nothing matches strictly, filters are relaxed step by step so the
 * UI always has something to show — flagged via `relaxed`.
 */
export function searchFixtures(
  q: string,
  opts: { page?: number; perPage?: number; sort?: SortKey } = {},
): SearchResult {
  const { page = 1, perPage = 20, sort = 'best' } = opts;
  const g = parseGhQuery(q);
  const all = getFixtures();

  const byStructure = (withLabels: boolean) =>
    all.filter(
      (i) =>
        (!g.languages.length || g.languages.some((l) => languageMatches(i, l))) &&
        (!g.repos.length || g.repos.includes(i.repo.fullName.toLowerCase())) &&
        (g.maxComments === null || i.comments < g.maxComments) &&
        (g.exactComments === null || i.comments === g.exactComments) &&
        (g.createdAfter === null || Date.parse(i.createdAt) > g.createdAfter) &&
        (!withLabels || g.labels.every((group) => group.some((l) => labelMatches(i, l)))) &&
        (!withLabels || !g.notLabels.some((l) => labelMatches(i, l))),
    );

  let relaxed = false;
  let pool = byStructure(true).filter((i) => g.terms.every((t) => termMatches(i, t)));
  if (!pool.length && g.terms.length) {
    relaxed = true;
    pool = byStructure(true).filter((i) => score(i, g.terms) > 0);
  }
  if (!pool.length) {
    relaxed = true;
    pool = byStructure(false).filter((i) => !g.terms.length || score(i, g.terms) > 0);
  }
  if (!pool.length) {
    relaxed = true;
    pool = byStructure(false);
  }
  if (!pool.length) {
    relaxed = true;
    pool = all;
  }

  const ranked =
    sort === 'best'
      ? [...pool].sort(
          (a, b) => score(b, g.terms) - score(a, g.terms) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
        )
      : sortIssues(pool, sort);

  const start = (page - 1) * perPage;
  const items = ranked.slice(start, start + perPage);
  return { items, total: ranked.length, hasMore: start + perPage < ranked.length, source: 'sample', relaxed };
}
