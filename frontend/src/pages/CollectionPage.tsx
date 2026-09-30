import { ArrowLeft, ArrowRight, Sparkles } from 'lucide-react';
import { useMemo } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import {
  COLLECTIONS,
  FRESH_DAYS,
  collectionById,
  collectionContext,
  selectCollection,
  type Collection,
} from '../../../shared/collections';
import { sortRepos } from '../../../shared/repoFilter';
import { CollectionBlockArt, CollectionQuilt } from '../components/CollectionQuilt';
import { FirstPrSwitch } from '../components/RepoFilters';
import { GridCount, RepoGrid } from '../components/RepoGrid';
import { useDataset } from '../data/dataset';
import { useDocumentMeta } from '../hooks/useDocumentMeta';
import { LIST_PAGE } from '../lib/listPages';
import { REPO_SORT_LABELS, REPO_SORTS, type RepoSort } from '../lib/repoSearch';
import { useSiteUrl } from '../seo/context';
import { collectionMeta, collectionsMeta } from '../seo/meta';
import { NotFoundPage } from './NotFoundPage';

/** One collection: an intro, how many repos it holds, a sort, and the grid. `?sort=` overrides its own order. */
export function CollectionPage() {
  const { id = '' } = useParams();
  const c = collectionById(id);
  const { status, repos, meta, now, retry, partial } = useDataset();
  const site = useSiteUrl();
  const [params, setParams] = useSearchParams();
  const asked = params.get('sort') as RepoSort | null;
  // "Best for a first PR" is first-PR friendly already, so it has no toggle but reads in first-PR mode.
  const firstPrOnly = c?.id === 'first-pr';
  const firstParam = !firstPrOnly && params.get('first') === '1';
  const first = firstPrOnly || firstParam;
  // With the toggle on, the default order is most unclaimed issues; otherwise the collection's own.
  const defaultSort: RepoSort = firstParam ? 'claimable' : (c?.sort ?? 'score');
  const sort: RepoSort = asked && REPO_SORTS.includes(asked) ? asked : defaultSort;
  const own = useMemo(() => (c && meta ? selectCollection(c, repos, collectionContext(meta)) : []), [c, repos, meta]);
  const list = useMemo(() => {
    const shown = firstParam ? own.filter((r) => r.firstPrFriendly) : own;
    return c && (firstParam || sort !== c.sort) ? sortRepos(shown, sort) : shown;
  }, [c, own, sort, firstParam]);
  const total = partial?.total ?? list.length;
  const pageMeta = useMemo(
    () => (c && status === 'ready' ? collectionMeta(site, c, own.slice(0, LIST_PAGE), total) : null),
    [c, status, site, own, total],
  );
  useDocumentMeta(pageMeta);

  if (!c) return <NotFoundPage />;

  const ready = status === 'ready';
  const setSort = (s: RepoSort) => {
    const next = new URLSearchParams(params);
    if (s === defaultSort) next.delete('sort');
    else next.set('sort', s);
    setParams(next, { replace: true, preventScrollReset: true });
  };
  const setFirst = (on: boolean) => {
    const next = new URLSearchParams(params);
    if (on) next.set('first', '1');
    else next.delete('first');
    setParams(next, { replace: true, preventScrollReset: true });
  };

  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-5 sm:px-6 sm:pt-8">
      <Link
        to="/collections"
        className="-ml-1 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-1 text-sm text-muted hover:text-fg"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        All collections
      </Link>
      <header className="mt-3 flex items-center gap-4 sm:gap-5">
        <CollectionBlockArt c={c} className="h-16 w-16 shrink-0 rounded-[14px] sm:h-20 sm:w-20 sm:rounded-[16px]" />
        <div className="min-w-0">
          <p className="eyebrow">Collection</p>
          <h1 className="font-display text-[2rem] font-[560] leading-tight tracking-[-0.02em] sm:text-[2.6rem]">
            {c.title}
          </h1>
        </div>
      </header>
      <p className="mt-4 max-w-2xl text-pretty text-muted" data-testid="collection-intro">
        {c.description}
      </p>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <h2 className="font-display text-[22px] font-[560] tracking-[-0.01em]" aria-live="polite">
          {ready ? <GridCount total={total} first={first} /> : 'Repos'}
          <span className="sr-only"> by {REPO_SORT_LABELS[sort].label.toLowerCase()}</span>
        </h2>
        {!firstPrOnly && <FirstPrSwitch on={firstParam} onChange={setFirst} className="w-full sm:w-auto" />}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {(!ready || total > 1) && (
          <div
            role="radiogroup"
            aria-label="Sort repos"
            className="flex max-w-full gap-0.5 overflow-x-auto rounded-full bg-fg/[0.06] p-0.5 scrollbar-none"
            data-testid="collection-sort"
          >
            {REPO_SORTS.map((s) => {
              const active = s === sort;
              return (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  title={REPO_SORT_LABELS[s].hint}
                  onClick={() => setSort(s)}
                  className={`h-11 shrink-0 whitespace-nowrap rounded-full px-3 text-[13px] font-medium transition-colors sm:h-8 ${active ? 'bg-fg text-bg' : 'text-muted hover:text-fg'}`}
                >
                  {REPO_SORT_LABELS[s].label}
                </button>
              );
            })}
          </div>
        )}
      </div>
      <div className="mt-4">
        {ready && total === 0 && !firstParam ? (
          <EmptyCollection c={c} />
        ) : (
          <RepoGrid
            repos={list}
            total={total}
            status={status}
            now={now}
            onRetry={retry}
            resetKey={`${c.id}:${sort}:${firstParam}`}
            firstPr={first}
            emptyAction={
              firstParam ? (
                <button type="button" className="btn-seam" onClick={() => setFirst(false)}>
                  Include repos that aren't first-PR friendly
                </button>
              ) : (
                <Link to="/" className="btn-seam">
                  Browse the whole directory
                </Link>
              )
            }
          />
        )}
      </div>
    </div>
  );
}

/** A collection with nothing in it yet (Fresh this week, right after the first build). */
function EmptyCollection({ c }: { c: Collection }) {
  const fresh = c.id === 'fresh';
  return (
    <div
      className="flex flex-col items-center rounded-[16px] border border-dashed border-line-strong px-6 py-12 text-center"
      data-testid="collection-empty"
    >
      <span
        aria-hidden="true"
        className="grid h-14 w-14 -rotate-6 place-items-center rounded-[14px] border border-accent/50 bg-accent/[0.07] text-accent"
      >
        <Sparkles className="h-6 w-6" />
      </span>
      <h3 className="mt-5 font-display text-[22px] font-[560] tracking-[-0.01em]">
        {fresh ? 'Nothing new on the bolt yet' : 'Nothing in this collection right now'}
      </h3>
      <p className="mt-2 max-w-md text-pretty text-sm text-muted">
        {fresh
          ? `This collection shows repos that joined the directory in the last ${FRESH_DAYS} days. The directory was just built, so everything in it counts as a founding patch. It fills up as the nightly collector finds new repos, starting with the next runs.`
          : 'The collector refreshes the directory every night, so check back soon.'}
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <Link to="/collections/first-pr" className="btn-ink h-11 px-5">
          Best for a first PR <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
        <Link to="/" className="btn-seam h-11 px-5">
          Browse the whole directory
        </Link>
      </div>
    </div>
  );
}

/** Every collection as a quilt block. */
export function CollectionsPage() {
  const site = useSiteUrl();
  useDocumentMeta(useMemo(() => collectionsMeta(site, COLLECTIONS), [site]));
  return (
    <div className="pb-24 pt-5 sm:pt-8">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <p className="eyebrow">Collections</p>
        <h1 className="mt-2 font-display text-[2.4rem] font-[560] leading-tight tracking-[-0.02em] sm:text-[3rem]">
          Cut from the same cloth
        </h1>
        <p className="mt-3 max-w-xl text-pretty text-muted">
          Views of the directory for where you are right now: your first PR, the newest listings, issues nobody has
          answered, famous projects and maintainers who reply fast.
        </p>
      </div>
      <div className="mt-8">
        <CollectionQuilt title="All collections" detailed />
      </div>
    </div>
  );
}
