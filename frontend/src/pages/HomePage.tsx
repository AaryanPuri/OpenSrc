import { useReducedMotion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { CollectionQuilt } from '../components/CollectionQuilt';
import { Composer } from '../components/Composer';
import { FieldBadge } from '../components/FieldBadge';
import { DomainQuilt, Hero } from '../components/Hero';
import { RepoFilters } from '../components/RepoFilters';
import { RepoGrid } from '../components/RepoGrid';
import { useRepoUrlState } from '../hooks/useRepoUrlState';
import { useShell } from '../hooks/useShell';
import { DOMAINS } from '../lib/dictionary';
import {
  emptyQuery,
  makeDomainMatch,
  setDifficulty,
  toggleDomain,
  toggleLanguage,
  toQueryText,
  type Chip,
  type ParsedQuery,
} from '../lib/parseQuery';
import { REPO_SORT_LABELS, removeRepoChip, repoChips, useRepoResults } from '../lib/repoSearch';

const normalizeQueryText = (text: string) => text.trim().replace(/\s+/g, ' ');

/** The query text a field page starts from ("databases"). */
function fieldQueryText(id: string): string {
  const def = DOMAINS.find((d) => d.id === id);
  if (!def) return '';
  return toQueryText({ ...emptyQuery(), domains: [makeDomainMatch(def, def.synonyms[0])] });
}

/**
 * The repo directory. `/`: hero, collections, filters and the grid; with `?q=`
 * a compact search bar over the results. `/field/:id` is the same page with
 * that field picked (until it gets a page of its own).
 */
export function HomePage({ fieldId }: { fieldId?: string }) {
  const { searchRef, homeTick } = useShell();
  const [url, setUrl] = useRepoUrlState();
  const reduce = useReducedMotion();
  const field = fieldId ? DOMAINS.find((d) => d.id === fieldId) : undefined;
  // A field page without its own `?q=` searches for the field.
  const text = url.browsing || !field ? url.q : fieldQueryText(field.id);
  const browsing = url.browsing || !!field;
  const [input, setInput] = useState(text);
  useEffect(() => setInput(text), [text, homeTick]);

  const { status, results, parsed, meta, now, retry, repos } = useRepoResults(text, url.sort, url.first);
  const chips = useMemo(() => repoChips(parsed), [parsed]);
  const total = meta?.count ?? repos.length;

  useEffect(() => {
    document.title = field
      ? `${field.label} repos to contribute to · OpenSrc`
      : url.q
        ? `${url.q} · OpenSrc repos`
        : 'OpenSrc: find open-source repos to contribute to';
  }, [url.q, field]);

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

  const search = url.q ? `?q=${encodeURIComponent(url.q)}` : '';
  const body = (
    <div className="grid gap-6 lg:grid-cols-[216px_minmax(0,1fr)] lg:gap-10">
      {filters}
      <section aria-labelledby="repos-title" className="min-w-0">
        <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <h2 id="repos-title" className="font-display text-[22px] font-[560] tracking-[-0.01em]" aria-live="polite">
            {status === 'ready' ? (
              <>
                <span className="tabular-nums">{results.length.toLocaleString('en')}</span>{' '}
                {url.first ? 'first-PR friendly ' : ''}
                {results.length === 1 ? 'repo' : 'repos'}
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
          <p className="text-[13px] text-subtle">
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
          sub="Hand-cut views of the directory, for where you are right now."
        />
        <div className="mx-auto mt-12 max-w-6xl px-4 sm:px-6">
          <div className="seam-t pt-8">
            <h2 className="sr-only">The directory</h2>
            {body}
          </div>
        </div>
        <div className="mt-16">
          <DomainQuilt
            hrefFor={(id) => `/field/${id}`}
            title="Browse by field"
            sub={`The same ${total ? total.toLocaleString('en') : ''} repos, by what they are about.`}
          />
        </div>
      </>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-5 sm:px-6 sm:pt-8">
      {field ? (
        <header className="mb-6 flex items-center gap-4">
          <FieldBadge id={field.id} size="lg" />
          <div className="min-w-0">
            <p className="eyebrow">Field</p>
            <h1 className="font-display text-[2rem] font-[560] leading-tight tracking-[-0.02em] sm:text-[2.4rem]">
              {field.label} repos
            </h1>
          </div>
        </header>
      ) : (
        <h1 className="sr-only">{url.q ? `Repos for “${url.q}”` : 'Find open-source repos'}</h1>
      )}
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
