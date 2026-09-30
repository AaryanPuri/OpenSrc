import { useReducedMotion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { LanguageRow } from '../components/BrowseLinks';
import { CollectionQuilt } from '../components/CollectionQuilt';
import { Composer } from '../components/Composer';
import { DomainQuilt, Hero } from '../components/Hero';
import { RepoFilters } from '../components/RepoFilters';
import { NewsletterForm } from '../components/NewsletterForm';
import { RepoGrid } from '../components/RepoGrid';
import { SaveSearchButton } from '../components/SaveSearchButton';
import { useDocumentMeta } from '../hooks/useDocumentMeta';
import { useRepoUrlState } from '../hooks/useRepoUrlState';
import { useShell } from '../hooks/useShell';
import { LIST_PAGE } from '../lib/listPages';
import { setDifficulty, toggleDomain, toggleLanguage, type Chip, type ParsedQuery } from '../lib/parseQuery';
import { REPO_SORT_LABELS, removeRepoChip, repoChips, repoSearchParams, useRepoResults } from '../lib/repoSearch';
import { useSiteUrl } from '../seo/context';
import { homeMeta, searchMeta } from '../seo/meta';

const normalizeQueryText = (text: string) => text.trim().replace(/\s+/g, ' ');

/**
 * The repo directory. `/`: hero, collections, filters, the grid and the
 * language and field links; with `?q=` a compact search bar over the results.
 */
export function HomePage() {
  const { searchRef, homeTick } = useShell();
  const [url, setUrl] = useRepoUrlState();
  const reduce = useReducedMotion();
  const text = url.q;
  const browsing = url.browsing;
  const [input, setInput] = useState(text);
  useEffect(() => setInput(text), [text, homeTick]);

  const { status, results, parsed, meta, now, retry, repos, partial } = useRepoResults(text, url.sort, url.first);
  const chips = useMemo(() => repoChips(parsed), [parsed]);
  const directorySize = meta?.count ?? repos.length;
  // A pre-rendered home page holds the first page of results; the count is the whole list's.
  const total = partial?.total ?? results.length;

  const site = useSiteUrl();
  const pageMeta = useMemo(
    () =>
      browsing ? searchMeta(site, url.q) : homeMeta(site, meta, status === 'ready' ? results.slice(0, LIST_PAGE) : []),
    [browsing, site, url.q, meta, status, results],
  );
  useDocumentMeta(pageMeta);

  // Switching from the landing to results (a search, or a filter picked on the landing) starts at the top.
  const wasBrowsing = useRef(browsing);
  useEffect(() => {
    if (browsing && !wasBrowsing.current) window.scrollTo({ top: 0 });
    wasBrowsing.current = browsing;
  }, [browsing]);

  const submit = useCallback(
    (value: string) => {
      const q = normalizeQueryText(value);
      setInput(q);
      setUrl({ q });
      if (q) searchRef.current?.blur();
      window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
    },
    [setUrl, searchRef, reduce],
  );
  /** Refinements (patches, filters) search at once and keep the scroll position. */
  const refine = (value: string) => {
    const q = normalizeQueryText(value);
    setInput(q);
    setUrl({ q });
  };
  const apply = (next: ParsedQuery) => refine(next.raw);
  const onRemoveChip = (c: Chip) => apply(removeRepoChip(parsed, c));

  const filters = (
    <RepoFilters
      parsed={parsed}
      first={url.first}
      sort={url.sort}
      meta={meta}
      onFirst={(first) => setUrl({ first }, 'replace')}
      onSort={(sort) => setUrl({ sort }, 'replace')}
      onDifficulty={(d) => apply(setDifficulty(parsed, d))}
      onToggleLanguage={(id) => apply(toggleLanguage(parsed, id))}
      onToggleDomain={(id) => apply(toggleDomain(parsed, id))}
    />
  );

  // Carried to repo pages, so "Back to your search" restores the query, the sort and the first-PR filter.
  const search = url.q ? `?${repoSearchParams(url.q, url.sort, url.first)}` : '';
  const body = (
    <div className="grid gap-6 lg:grid-cols-[216px_minmax(0,1fr)] lg:gap-10">
      {filters}
      <section aria-labelledby="repos-title" className="min-w-0">
        <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <h2 id="repos-title" className="font-display text-[22px] font-[560] tracking-[-0.01em]" aria-live="polite">
            {status === 'ready' ? (
              <>
                <span className="tabular-nums">{total.toLocaleString('en')}</span>{' '}
                {url.first ? 'first-PR friendly ' : ''}
                {total === 1 ? 'repo' : 'repos'}
              </>
            ) : status === 'error' ? (
              'Repos'
            ) : (
              <span className="inline-flex items-center gap-2 text-muted">
                Unrolling the directory
                <span className="sewing-line inline-block h-[2px] w-10 translate-y-[2px]" aria-hidden="true" />
              </span>
            )}
          </h2>
          <p className="flex flex-wrap items-center gap-x-1 text-[13px] text-subtle">
            {text && <SaveSearchButton scope="repos" q={text} />}
            {status === 'ready' && `by ${REPO_SORT_LABELS[url.sort].label.toLowerCase()}`}
            {text && (
              <>
                {status === 'ready' && ' · '}
                <Link
                  to={`/issues?q=${encodeURIComponent(text)}`}
                  className="inline-flex min-h-11 items-center gap-1 font-medium text-accent underline-offset-2 hover:underline sm:min-h-0"
                  data-testid="search-issues-instead"
                >
                  Search issues instead <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              </>
            )}
          </p>
        </div>
        <div className="mt-4">
          <RepoGrid
            repos={results}
            total={total}
            status={status}
            now={now}
            chips={chips}
            onRemoveChip={onRemoveChip}
            onRetry={retry}
            search={search}
            resetKey={`${text}|${url.sort}|${url.first}`}
            offline={url.demo}
            emptyAction={
              url.first ? (
                <button type="button" className="btn-seam" onClick={() => setUrl({ first: false }, 'replace')}>
                  Include repos that aren't first-PR friendly
                </button>
              ) : undefined
            }
          />
        </div>
      </section>
    </div>
  );

  if (!browsing) {
    return (
      <>
        <Hero
          ref={searchRef}
          value={input}
          onChange={setInput}
          onSubmit={submit}
          onEdit={setInput}
          loading={false}
          mode="repos"
          repoCount={meta?.count}
        />
        <CollectionQuilt
          repos={repos}
          meta={meta}
          counts={partial?.collections}
          sub="Hand-cut views of the directory, for where you are right now."
        />
        <div className="mx-auto mt-12 max-w-6xl px-4 sm:px-6">
          <div className="seam-t pt-8">
            <h2 className="sr-only">The directory</h2>
            {body}
          </div>
        </div>
        <div className="mt-16">
          <LanguageRow meta={meta} />
        </div>
        <div className="mt-12">
          <DomainQuilt
            hrefFor={(id) => `/field/${id}`}
            title="Browse by field"
            sub={`The same ${directorySize ? directorySize.toLocaleString('en') : ''} repos, by what they are about.`}
          />
        </div>
        <div className="mx-auto mt-16 max-w-6xl px-4 sm:px-6">
          <NewsletterForm />
        </div>
      </>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-5 sm:px-6 sm:pt-8">
      <h1 className="sr-only">{url.q ? `Repos for “${url.q}”` : 'Find open-source repos'}</h1>
      <Composer
        ref={searchRef}
        value={input}
        onChange={setInput}
        onSubmit={submit}
        onEdit={refine}
        loading={status === 'loading'}
        compact
        mode="repos"
      />
      <div className="mt-7">{body}</div>
    </div>
  );
}
