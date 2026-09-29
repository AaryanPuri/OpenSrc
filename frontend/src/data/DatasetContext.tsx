import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { DatasetMeta, RepoRecord } from '../../../shared/repo';
import { expandDataset, type CompactDataset } from '../lib/dataset';
import { LANGUAGES } from '../lib/dictionary';

export type DatasetStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface Dataset {
  status: DatasetStatus;
  repos: RepoRecord[];
  meta: DatasetMeta | null;
  /** Epoch ms of meta.generatedAt: "now" for recency, so the server and the browser agree. */
  now: number;
  error?: string;
  retry: () => void;
}

/** Data a server render (or a test) hands over, so the first render already has it. */
export interface InitialDataset {
  repos: RepoRecord[];
  meta: DatasetMeta;
}

interface Store {
  state: Omit<Dataset, 'retry' | 'now'>;
  load: () => void;
  retry: () => void;
}

const DatasetStore = createContext<Store | null>(null);

const INDEX_URL = '/data/repos.json';
const META_URL = '/data/meta.json';

const languageLabel = (id: string) => LANGUAGES.find((l) => l.id === id)?.label ?? null;

async function fetchJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

/**
 * Holds the repo directory. With `initial` the data is there from the first
 * render (server rendering, tests); otherwise the first page that asks for it
 * (via useDataset) starts the download, and every later page reuses it.
 */
export function DatasetProvider({ initial, children }: { initial?: InitialDataset; children: ReactNode }) {
  const [state, setState] = useState<Store['state']>(() =>
    initial ? { status: 'ready', repos: initial.repos, meta: initial.meta } : { status: 'idle', repos: [], meta: null },
  );
  const started = useRef(!!initial);
  const ctrl = useRef<AbortController | null>(null);

  const fetchAll = useCallback(() => {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setState((s) => ({ ...s, status: 'loading', error: undefined }));
    Promise.all([fetchJson<CompactDataset>(INDEX_URL, c.signal), fetchJson<DatasetMeta>(META_URL, c.signal)])
      .then(([index, meta]) => {
        if (c.signal.aborted) return;
        setState({ status: 'ready', repos: expandDataset(index, languageLabel), meta });
      })
      .catch((e: unknown) => {
        if (c.signal.aborted) return;
        setState((s) => ({
          ...s,
          status: 'error',
          error: e instanceof Error ? e.message : 'Could not load the repo directory.',
        }));
      });
  }, []);

  const load = useCallback(() => {
    if (started.current) return;
    started.current = true;
    fetchAll();
  }, [fetchAll]);

  useEffect(() => () => ctrl.current?.abort(), []);

  const store = useMemo<Store>(() => ({ state, load, retry: fetchAll }), [state, load, fetchAll]);
  return <DatasetStore.Provider value={store}>{children}</DatasetStore.Provider>;
}

const EMPTY: Store = {
  state: { status: 'idle', repos: [], meta: null },
  load: () => {},
  retry: () => {},
};

/** The repo directory; asking for it starts the download on the client. */
export function useDataset(): Dataset {
  const store = useContext(DatasetStore) ?? EMPTY;
  const { load } = store;
  useEffect(() => load(), [load]);
  const now = store.state.meta ? Date.parse(store.state.meta.generatedAt) : 0;
  return useMemo(() => ({ ...store.state, now, retry: store.retry }), [store.state, now, store.retry]);
}
