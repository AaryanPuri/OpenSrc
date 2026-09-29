import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import type { DatasetMeta } from '../../../shared/repo';
import { expandDataset, type CompactDataset } from '../lib/dataset';
import { languageLabel } from '../lib/listPages';
import { DatasetStoreContext, type DatasetStore, type InitialDataset } from './dataset';

/** Dev server (vite.config.ts) and plain builds; production pages name the hashed file in their inlined data. */
export const DEFAULT_INDEX_URL = '/data/repos.json';
const META_URL = '/data/meta.json';

async function fetchJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

function initialState(initial: InitialDataset | undefined): DatasetStore['state'] {
  const details = Object.fromEntries((initial?.details ?? []).map((r) => [r.fullName, r]));
  if (!initial) return { status: 'idle', repos: [], meta: null, partial: null, details };
  if (!initial.repos) return { status: 'idle', repos: [], meta: initial.meta, partial: null, details };
  return { status: 'ready', repos: initial.repos, meta: initial.meta, partial: initial.partial ?? null, details };
}

/**
 * Holds the repo directory. With a full `initial` the data is there from the
 * first render (server rendering, tests). A pre-rendered page brings only its
 * own slice (`initial.partial`): it renders from that, and the full index loads
 * in the background. Otherwise the first page that asks for it (useDataset)
 * starts the download, and every later page reuses it.
 */
export function DatasetProvider({ initial, children }: { initial?: InitialDataset; children: ReactNode }) {
  const [state, setState] = useState<DatasetStore['state']>(() => initialState(initial));
  // A slice isn't the directory: the full index still has to come.
  const started = useRef(!!initial?.repos && !initial.partial);
  const ctrl = useRef<AbortController | null>(null);
  const indexUrl = initial?.indexUrl ?? DEFAULT_INDEX_URL;
  const knownMeta = useRef(initial?.meta ?? null);

  const fetchAll = useCallback(() => {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    started.current = true;
    setState((s) => (s.partial ? { ...s, error: undefined } : { ...s, status: 'loading', error: undefined }));
    const meta = knownMeta.current ? Promise.resolve(knownMeta.current) : fetchJson<DatasetMeta>(META_URL, c.signal);
    Promise.all([fetchJson<CompactDataset>(indexUrl, c.signal), meta])
      .then(([index, meta]) => {
        if (c.signal.aborted) return;
        setState((s) => ({
          status: 'ready',
          repos: expandDataset(index, languageLabel),
          meta,
          partial: null,
          details: s.details,
        }));
      })
      .catch((e: unknown) => {
        if (c.signal.aborted) return;
        const error = e instanceof Error ? e.message : 'Could not load the repo directory.';
        // A pre-rendered page keeps its slice: only other pages show the error.
        setState((s) => (s.partial ? { ...s, error } : { ...s, status: 'error', error }));
      });
  }, [indexUrl]);

  const load = useCallback(() => {
    if (!started.current) fetchAll();
  }, [fetchAll]);

  // No abort on unmount: the provider sits at the root, and StrictMode's rehearsal
  // unmount would otherwise cancel the one download.
  const store = useMemo<DatasetStore>(() => ({ state, load, retry: fetchAll }), [state, load, fetchAll]);
  return <DatasetStoreContext.Provider value={store}>{children}</DatasetStoreContext.Provider>;
}
