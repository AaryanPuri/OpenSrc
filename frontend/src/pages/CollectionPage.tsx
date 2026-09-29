import { ArrowLeft } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { Link, useParams } from 'react-router';
import { collectionById, collectionContext, selectCollection } from '../../../shared/collections';
import { CollectionBlockArt, CollectionQuilt } from '../components/CollectionQuilt';
import { RepoGrid } from '../components/RepoGrid';
import { useDataset } from '../data/dataset';
import { NotFoundPage } from './NotFoundPage';

/** One collection's repos. (A richer page, with its own filters, comes later.) */
export function CollectionPage() {
  const { id = '' } = useParams();
  const c = collectionById(id);
  const { status, repos, meta, now, retry } = useDataset();
  const list = useMemo(() => (c && meta ? selectCollection(c, repos, collectionContext(meta)) : []), [c, repos, meta]);

  useEffect(() => {
    if (c) document.title = `${c.title}: repos to contribute to · OpenSrc`;
  }, [c]);

  if (!c) return <NotFoundPage />;

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
      <p className="mt-4 max-w-2xl text-pretty text-muted">{c.description}</p>
      <h2 className="mt-8 font-display text-[22px] font-[560] tracking-[-0.01em]" aria-live="polite">
        {status === 'ready' ? (
          <>
            <span className="tabular-nums">{list.length.toLocaleString('en')}</span>{' '}
            {list.length === 1 ? 'repo' : 'repos'}
          </>
        ) : (
          'Repos'
        )}
      </h2>
      <div className="mt-4">
        <RepoGrid
          repos={list}
          status={status}
          now={now}
          onRetry={retry}
          resetKey={c.id}
          emptyAction={
            <Link to="/" className="btn-seam">
              Browse the whole directory
            </Link>
          }
        />
      </div>
    </div>
  );
}

/** Every collection as a quilt block. */
export function CollectionsPage() {
  const { repos, meta } = useDataset();
  useEffect(() => {
    document.title = 'Collections · OpenSrc';
  }, []);
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
        <CollectionQuilt repos={repos} meta={meta} title="All collections" detailed />
      </div>
    </div>
  );
}
