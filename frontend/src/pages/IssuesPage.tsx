import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ArrowDown, LoaderCircle } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Composer } from '../components/Composer';
import { DomainQuilt, Hero } from '../components/Hero';
import { IssueCard } from '../components/IssueCard';
import { IssueCardSkeleton } from '../components/IssueCardSkeleton';
import { RefinePanel } from '../components/RefinePanel';
import { EmptyState, ErrorState, Notice, SortControl } from '../components/ResultStates';
import { useAiParse } from '../hooks/useAiParse';
import { useDocumentMeta } from '../hooks/useDocumentMeta';
import { useSearch } from '../hooks/useSearch';
import { useShell } from '../hooks/useShell';
import { useUrlState } from '../hooks/useUrlState';
import { rememberAiParse } from '../lib/aiParse';
import { LANGUAGES } from '../lib/dictionary';
import { plural } from '../lib/format';
import {
  buildGitHubQuery,
  getChips,
  parseQuery,
  removeChip,
  setDifficulty,
  toggleDomain,
  toggleLanguage,
  toggleType,
  type Chip,
  type ParsedQuery,
} from '../lib/parseQuery';
import { fetchRepoMeta, type RepoMeta } from '../lib/search';
import { useSiteUrl } from '../seo/context';
import { issuesMeta } from '../seo/meta';

/** How `?q=` is stored: trimmed, single-spaced. */
const normalizeQueryText = (text: string) => text.trim().replace(/\s+/g, ' ');

/** The issue finder: landing hero when there's no `?q=`, results when there is. */
export function IssuesPage() {
  const { theme, token, searchRef, isSaved, onToggleSave, openSettings, homeTick } = useShell();
  const [url, setUrl] = useUrlState();
  const [input, setInput] = useState(url.q);
  const [noticeDismissed, setNoticeDismissed] = useState(false);
  const reduce = useReducedMotion();

  // Keep the input in sync with back/forward navigation (and clear it when the logo is clicked).
  useEffect(() => setInput(url.q), [url.q, homeTick]);

  // Local rules parse instantly; Claude's reading replaces it when the server has an API key
  // and answers in time. Demo mode stays fully local.
  const aiParsed = useAiParse(url.q, url.browsing && !url.demo);
  const parsed = useMemo(() => aiParsed ?? parseQuery(url.q), [aiParsed, url.q]);
  const ghQuery = url.browsing && url.q ? buildGitHubQuery(parsed) : null;
  const chips = useMemo(() => getChips(parsed), [parsed]);
  const search = useSearch(ghQuery, url.sort, token, url.demo);
  const browsing = url.browsing;

  useEffect(() => setNoticeDismissed(false), [ghQuery, url.sort]);

  const site = useSiteUrl();
  useDocumentMeta(useMemo(() => issuesMeta(site, url.q), [site, url.q]));

  // Stars/language cost one API call per repo, so only fetch them with a token.
  const [repoMeta, setRepoMeta] = useState<Record<string, RepoMeta>>({});
  // Repos already requested with the current token, so each is fetched at most once.
  const requestedMeta = useRef<{ token: string | null; repos: Set<string> }>({ token: null, repos: new Set() });
  useEffect(() => {
    if (!token || search.source !== 'github') return;
    if (requestedMeta.current.token !== token) requestedMeta.current = { token, repos: new Set() };
    const requested = requestedMeta.current.repos;
    const missing = Array.from(new Set(search.items.map((i) => i.repo.fullName)))
      .filter((r) => !requested.has(r))
      .slice(0, 25);
    for (const r of missing) {
      requested.add(r);
      fetchRepoMeta(r, token).then((m) => m && setRepoMeta((prev) => (prev[r] ? prev : { ...prev, [r]: m })));
    }
  }, [token, search.items, search.source]);

  /** A new text search: scrolls to the top. */
  const submit = useCallback(
    (text: string) => {
      const q = normalizeQueryText(text);
      setInput(q);
      setUrl({ q, browsing: true });
      if (q) searchRef.current?.blur();
      window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
    },
    [setUrl, reduce, searchRef],
  );

  /** Refinements (patches, sidebar, time picker) keep your scroll position. */
  const refine = useCallback(
    (text: string) => {
      const q = normalizeQueryText(text);
      setInput(q);
      setUrl({ q, browsing: true });
    },
    [setUrl],
  );

  /** Patch/sidebar edits rewrite `?q=` via toQueryText; an edit of Claude's reading stays Claude's. */
  const apply = (next: ParsedQuery) => {
    if (aiParsed) rememberAiParse(normalizeQueryText(next.raw), next);
    refine(next.raw);
  };
  const onRemoveChip = (c: Chip) => apply(removeChip(parsed, c));

  const singleLanguage =
    parsed.languages.length === 1 ? LANGUAGES.find((l) => l.id === parsed.languages[0])?.label : null;
  const items = search.items.map((i) => {
    const m = repoMeta[i.repo.fullName];
    return m ? { ...i, repo: { ...i.repo, stars: m.stars, language: m.language ?? i.repo.language } } : i;
  });
  const offline = url.demo || search.source === 'sample';

  if (!browsing) {
    return (
      <>
        <Hero ref={searchRef} value={input} onChange={setInput} onSubmit={submit} onEdit={setInput} loading={false} />
        <DomainQuilt onPick={submit} />
      </>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-5 sm:px-6 sm:pt-8">
      <h1 className="sr-only">{url.q ? `Open issues for “${url.q}”` : 'Find open-source issues'}</h1>
      <Composer
        ref={searchRef}
        value={input}
        onChange={setInput}
        onSubmit={submit}
        onEdit={refine}
        loading={search.status === 'loading'}
        compact
        ai={aiParsed ? { q: url.q, parsed: aiParsed } : null}
      />

      {!url.q ? (
        <div className="mt-10">
          <DomainQuilt
            compact
            onPick={submit}
            title="Pick a patch to start"
            sub="You unpicked every patch. Choose a field below, or describe what you want above."
          />
        </div>
      ) : (
        <div className="mt-7 grid gap-6 lg:grid-cols-[208px_minmax(0,1fr)] lg:gap-10">
          <RefinePanel
            parsed={parsed}
            onDifficulty={(d) => apply(setDifficulty(parsed, d))}
            onToggleLanguage={(id) => apply(toggleLanguage(parsed, id))}
            onToggleType={(t) => apply(toggleType(parsed, t))}
            onToggleDomain={(id) => apply(toggleDomain(parsed, id))}
          />

          <section aria-labelledby="results-title" className="min-w-0">
            <div className="flex min-h-11 flex-wrap items-center justify-between gap-3">
              <h2
                id="results-title"
                className="font-display text-[22px] font-[560] tracking-[-0.01em]"
                aria-live="polite"
              >
                {search.status === 'success' ? (
                  <>
                    <span className="tabular-nums">{search.total.toLocaleString('en')}</span> open{' '}
                    {search.total === 1 ? 'issue' : 'issues'}
                  </>
                ) : search.status === 'loading' ? (
                  <span className="inline-flex items-center gap-2 text-muted">
                    Sewing your search
                    <span className="sewing-line inline-block h-[2px] w-10 translate-y-[2px]" aria-hidden="true" />
                  </span>
                ) : (
                  'Results'
                )}
              </h2>
              <SortControl value={url.sort} onChange={(sort) => setUrl({ sort }, 'replace')} />
            </div>

            {!noticeDismissed && search.notice && (
              <div className="mt-3">
                <Notice
                  notice={search.notice}
                  relaxed={search.relaxed}
                  onOpenSettings={openSettings}
                  onRetry={() => (url.demo ? setUrl({ demo: false }, 'replace') : search.retry())}
                  onDismiss={() => setNoticeDismissed(true)}
                />
              </div>
            )}

            <div className="mt-4">
              {search.status === 'loading' && search.items.length === 0 && (
                <div className="space-y-3.5" data-testid="skeletons">
                  {Array.from({ length: 4 }, (_, i) => (
                    <IssueCardSkeleton key={i} />
                  ))}
                </div>
              )}

              {search.status === 'error' && <ErrorState message={search.error ?? ''} onRetry={search.retry} />}

              {search.status === 'success' && items.length === 0 && (
                <EmptyState chips={chips} onRemove={onRemoveChip} />
              )}

              {items.length > 0 && search.status !== 'error' && (
                <ul
                  className={`space-y-3.5 transition-opacity duration-200 ${search.status === 'loading' ? 'opacity-60' : ''}`}
                  data-testid="results-list"
                >
                  <AnimatePresence initial={true} mode="popLayout">
                    {items.map((issue, i) => (
                      <motion.li
                        key={`${issue.id}:${issue.htmlUrl}`}
                        layout="position"
                        initial={{ y: 26, rotate: i % 2 ? 0.5 : -0.5 }}
                        animate={{ y: 0, rotate: 0 }}
                        exit={{ opacity: 0, transition: { duration: 0.12 } }}
                        transition={{
                          type: 'spring',
                          stiffness: 380,
                          damping: 32,
                          delay: Math.min(i, 8) * 0.045,
                        }}
                      >
                        <IssueCard
                          issue={issue}
                          theme={theme}
                          saved={isSaved(issue)}
                          onToggleSave={onToggleSave}
                          parsed={parsed}
                          fallbackLanguage={singleLanguage}
                          offline={offline}
                        />
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </ul>
              )}

              {search.status === 'success' && search.hasMore && (
                <div className="flex flex-col items-center gap-2 pt-6">
                  <button
                    type="button"
                    className="btn-seam h-11 px-5"
                    onClick={search.loadMore}
                    disabled={search.loadingMore}
                    data-testid="load-more"
                  >
                    {search.loadingMore ? (
                      <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <ArrowDown className="h-4 w-4" aria-hidden="true" />
                    )}
                    {search.loadingMore ? 'Sewing on more…' : 'Load more'}
                  </button>
                  <p className="text-xs text-subtle">
                    Showing {items.length} of {plural(Math.min(search.total, 1000), 'issue')}
                  </p>
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
