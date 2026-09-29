/**
 * The data a pre-rendered page carries inline, in
 * `<script id="__OPENSRC_DATA__" type="application/json">`: the dataset's meta,
 * where the full (hashed) index lives, and only the repos the page shows, in the
 * index's compact form. The browser's first render reads exactly what the
 * server rendered from (toInitialDataset on both sides), so hydration matches;
 * the full index then loads in the background.
 *
 * The builders (prepareSite, siteRoutes, pageDataFor) run at build time only,
 * from scripts/prerender.ts through the server bundle.
 */
import { COLLECTIONS, collectionById, collectionContext, selectCollection } from '../../../shared/collections';
import type { DatasetMeta, RepoRecord } from '../../../shared/repo';
import { compactDataset, expandDataset, type CompactDataset } from '../lib/dataset';
import {
  fieldPageIds,
  languageLabel,
  languagePageIds,
  LIST_PAGE,
  listRepos,
  listStats,
  type ListKind,
} from '../lib/listPages';
import { parseQuery } from '../lib/parseQuery';
import { filterRepos, readRepoQuery } from '../lib/repoSearch';
import type { InitialDataset, PartialView } from './dataset';

export const PAGE_DATA_ID = '__OPENSRC_DATA__';

export interface PageData {
  v: 1;
  /** SITE_URL the page was built for (canonical links). */
  site: string;
  /** URL of the full compact index. */
  index: string;
  meta: DatasetMeta;
  /** Pathname the page was rendered for; absent on the app shell (client-rendered routes). */
  path?: string;
  /** The repos the page shows, compact. */
  slice?: CompactDataset;
  view?: Omit<PartialView, 'path'>;
  /** Repo pages: the full record (homepage, topics, whole description). */
  detail?: RepoRecord;
}

export function toInitialDataset(pd: PageData): InitialDataset {
  const partial = pd.slice && pd.path !== undefined ? { path: pd.path, ...pd.view } : undefined;
  return {
    meta: pd.meta,
    indexUrl: pd.index,
    repos: partial && pd.slice ? expandDataset(pd.slice, languageLabel) : undefined,
    partial,
    details: pd.detail ? [pd.detail] : undefined,
  };
}

/** The page's inlined data, or null (dev server, plain builds). */
export function readPageData(doc: Document): PageData | null {
  const el = doc.getElementById(PAGE_DATA_ID);
  if (!el?.textContent) return null;
  try {
    const pd = JSON.parse(el.textContent) as PageData;
    return pd && pd.v === 1 && pd.meta ? pd : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Build time                                                          */
/* ------------------------------------------------------------------ */

/** Some rows of a compact index, as a compact index. */
export function sliceCompact(c: CompactDataset, rows: number[]): CompactDataset {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(c)) {
    out[key] = Array.isArray(value) ? rows.map((i) => value[i]) : value;
  }
  return out as unknown as CompactDataset;
}

export interface Site {
  meta: DatasetMeta;
  /** The index as served. */
  compact: CompactDataset;
  /** The index as the browser expands it: what every page renders from. */
  repos: RepoRecord[];
  /** Full records by fullName (repo pages). */
  records: Map<string, RepoRecord>;
  row: Map<string, number>;
}

export function prepareSite(records: RepoRecord[], meta: DatasetMeta): Site {
  const compact = compactDataset(records, meta.generatedAt);
  const repos = expandDataset(compact, languageLabel);
  return {
    meta,
    compact,
    repos,
    records: new Map(records.map((r) => [r.fullName, r])),
    row: new Map(repos.map((r, i) => [r.fullName, i])),
  };
}

export type SiteRoute =
  | { kind: 'home'; path: '/' }
  | { kind: 'repo'; path: string; fullName: string }
  | { kind: ListKind; path: string; id: string }
  | { kind: 'collections'; path: '/collections' }
  | { kind: 'collection'; path: string; id: string }
  | { kind: 'submit'; path: '/submit' }
  | { kind: 'not-found'; path: '/404' };

/**
 * Every pre-rendered page. `repoLimit` keeps only the best-scored repo pages
 * (PRERENDER_LIMIT, for quick local and CI builds).
 */
export function siteRoutes(site: Site, repoLimit = Infinity): SiteRoute[] {
  const repos = [...site.repos].sort((a, b) => b.score - a.score || (a.fullName < b.fullName ? -1 : 1));
  return [
    { kind: 'home', path: '/' },
    ...languagePageIds(site.meta).map((id): SiteRoute => ({ kind: 'language', path: `/language/${id}`, id })),
    ...fieldPageIds(site.meta).map((id): SiteRoute => ({ kind: 'field', path: `/field/${id}`, id })),
    { kind: 'collections', path: '/collections' },
    ...COLLECTIONS.map((c): SiteRoute => ({ kind: 'collection', path: `/collections/${c.id}`, id: c.id })),
    { kind: 'submit', path: '/submit' },
    ...repos
      .slice(0, repoLimit)
      .map((r): SiteRoute => ({ kind: 'repo', path: `/repo/${r.fullName}`, fullName: r.fullName })),
    { kind: 'not-found', path: '/404' },
  ];
}

const collectionCounts = (site: Site) => {
  const ctx = collectionContext(site.meta);
  return Object.fromEntries(COLLECTIONS.map((c) => [c.id, site.repos.filter((r) => c.includes(r, ctx)).length]));
};

/** What one route's page carries inline. */
export function pageDataFor(site: Site, route: SiteRoute, opts: { siteUrl: string; indexUrl: string }): PageData {
  const base = { v: 1 as const, site: opts.siteUrl, index: opts.indexUrl, meta: site.meta, path: route.path };
  const slice = (list: RepoRecord[]) =>
    sliceCompact(
      site.compact,
      list.map((r) => site.row.get(r.fullName)!),
    );
  const now = Date.parse(site.meta.generatedAt);

  switch (route.kind) {
    case 'home': {
      const q = readRepoQuery(parseQuery(''));
      const list = filterRepos(site.repos, q, { sort: 'score', first: false, now });
      return {
        ...base,
        slice: slice(list.slice(0, LIST_PAGE)),
        view: { total: list.length, collections: collectionCounts(site) },
      };
    }
    case 'language':
    case 'field': {
      const list = listRepos(site.repos, route.kind, route.id);
      return { ...base, slice: slice(list.slice(0, LIST_PAGE)), view: { total: list.length, stats: listStats(list) } };
    }
    case 'collections':
      return { ...base, slice: slice([]), view: { collections: collectionCounts(site) } };
    case 'collection': {
      const c = collectionById(route.id)!;
      const list = selectCollection(c, site.repos, collectionContext(site.meta));
      return { ...base, slice: slice(list.slice(0, LIST_PAGE)), view: { total: list.length } };
    }
    case 'repo': {
      const repo = site.repos[site.row.get(route.fullName)!];
      return { ...base, slice: slice([repo]), view: { anySearch: true }, detail: site.records.get(route.fullName) };
    }
    case 'submit':
    case 'not-found':
      return { ...base, slice: slice([]) };
  }
}

/** The app shell (client-rendered routes like /issues): meta and the index's address, no page. */
export function shellData(site: Site, opts: { siteUrl: string; indexUrl: string }): PageData {
  return { v: 1, site: opts.siteUrl, index: opts.indexUrl, meta: site.meta };
}
