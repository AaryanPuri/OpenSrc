import { createContext, useContext, useEffect, useMemo } from 'react';
import { useLocation } from 'react-router';
import type { DatasetMeta, RepoRecord } from '../../../shared/repo';
import type { ListStats } from '../lib/listPages';

export type DatasetStatus = 'idle' | 'loading' | 'ready' | 'error';

/**
 * A pre-rendered page ships only the repos it shows (see pageData.ts). This says
 * which page that slice was cut for, and carries the numbers the page prints
 * that come from its whole list, so the first render needs nothing else.
 */
export interface PartialView {
  /** Pathname the slice was cut for. */
  path: string;
  /** The slice holds whatever the query string says (repo pages: `?tab=`, `?q=` don't change which repo). */
  anySearch?: boolean;
  /** How many repos the page's whole list has; the slice holds the first ones. */
  total?: number;
  /** Summary of the page's whole list (language and field pages). */
  stats?: ListStats;
}

export interface Dataset {
  status: DatasetStatus;
  repos: RepoRecord[];
  meta: DatasetMeta | null;
  /** Epoch ms of meta.generatedAt: "now" for recency, so the server and the browser agree. */
  now: number;
  /** Set while this page only has its pre-rendered slice (the full index is still on its way). */
  partial: PartialView | null;
  /** Full records (homepage, topics, whole description) handed over with the page. */
  details: Record<string, RepoRecord>;
  error?: string;
  retry: () => void;
}

/**
 * Data handed over before the first render: by a server render, a test, or the
 * page's inlined data (main.tsx). Without `repos` only the meta is known and the
 * index still has to be downloaded.
 */
export interface InitialDataset {
  repos?: RepoRecord[];
  meta: DatasetMeta;
  /** `repos` is one page's slice, not the whole directory. */
  partial?: PartialView;
  details?: RepoRecord[];
  /** Where the full compact index is served (hashed in production builds). */
  indexUrl?: string;
}

export interface DatasetStore {
  state: {
    status: DatasetStatus;
    repos: RepoRecord[];
    meta: DatasetMeta | null;
    partial: PartialView | null;
    details: Record<string, RepoRecord>;
    error?: string;
  };
  /** Starts the download once; later calls do nothing. */
  load: () => void;
  retry: () => void;
}

export const DatasetStoreContext = createContext<DatasetStore | null>(null);

const EMPTY: DatasetStore = {
  state: { status: 'idle', repos: [], meta: null, partial: null, details: {} },
  load: () => {},
  retry: () => {},
};

/** "/repo/a/b/" and "/repo/a/b" are the same page. */
export const normalizePath = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p) || '/';

/** Whether a pre-rendered slice answers this location (else the page waits for the full index). */
export function partialCovers(partial: PartialView, pathname: string, search: string): boolean {
  if (normalizePath(pathname) !== normalizePath(partial.path)) return false;
  return !!partial.anySearch || search === '' || search === '?';
}

/** The directory's meta, without starting the index download (footer links). */
export function useDatasetMeta(): DatasetMeta | null {
  return (useContext(DatasetStoreContext) ?? EMPTY).state.meta;
}

/** The repo directory (see DatasetProvider); asking for it starts the download on the client. */
export function useDataset(): Dataset {
  const store = useContext(DatasetStoreContext) ?? EMPTY;
  const { load, state, retry } = store;
  const { pathname, search } = useLocation();
  useEffect(() => load(), [load]);
  const now = state.meta ? Date.parse(state.meta.generatedAt) : 0;
  const covered = !state.partial || partialCovers(state.partial, pathname, search);
  return useMemo((): Dataset => {
    if (covered) return { ...state, now, retry };
    // Another page than the slice was cut for: wait for the full index, like a cold start.
    return { ...state, status: state.error ? 'error' : 'loading', repos: [], partial: null, now, retry };
  }, [state, now, retry, covered]);
}
