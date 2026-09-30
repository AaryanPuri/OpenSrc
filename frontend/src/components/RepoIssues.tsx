/**
 * A repo page's live issues (Good first / Contributions welcome / All tabs), searched on
 * GitHub from the browser. Loaded lazily after hydration (see RepoPage), so the
 * issue cards and the search code stay out of the pre-rendered pages' main chunk.
 */
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowDown, ExternalLink, LoaderCircle, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import type { RepoRecord } from '../../../shared/repo';
import { useEntrance } from '../hooks/useEntrance';
import { useSearch } from '../hooks/useSearch';
import { useShell } from '../hooks/useShell';
import { parseQuery } from '../lib/parseQuery';
import {
  defaultIssueTab,
  HELP_WANTED_NAME,
  issueLevelChips,
  repoIssueQuery,
  ISSUE_TABS,
  type IssueTab,
} from '../lib/repoSearch';
import { IssueCard } from './IssueCard';
import { IssueCardSkeleton } from './IssueCardSkeleton';
import { Patch } from './Patches';
import { EmptyState, ErrorState, Notice } from './ResultStates';

const TAB_LABEL: Record<IssueTab, string> = { gfi: 'Good first issues', help: HELP_WANTED_NAME, all: 'All open' };

export default function RepoIssues({ repo }: { repo: RepoRecord }) {
  const { theme, token, isSaved, onToggleSave, openSettings } = useShell();
  const [params, setParams] = useSearchParams();
  const enter = useEntrance();
  const q = params.get('q')?.trim() ?? '';
  const demo = params.get('demo') === '1';
  const parsed = useMemo(() => (q ? parseQuery(q) : null), [q]);
  const tab = (ISSUE_TABS as string[]).includes(params.get('tab') ?? '')
    ? (params.get('tab') as IssueTab)
    : defaultIssueTab(parsed);
  const extraChips = useMemo(() => (parsed ? issueLevelChips(parsed) : []), [parsed]);
  const narrowing = extraChips.length ? parsed : null;
  const narrowedQuery = repoIssueQuery(repo, tab, narrowing);
  // When the search's issue-level filter ("docs") finds nothing here, usually because
  // the repo doesn't use that label, the tab falls back to its unnarrowed list.
  const [fallbackFor, setFallbackFor] = useState<string | null>(null);
  const fellBack = !!narrowing && fallbackFor === narrowedQuery;
  const ghQuery = fellBack ? repoIssueQuery(repo, tab) : narrowedQuery;
  const search = useSearch(ghQuery, 'best', token, demo);
  useEffect(() => {
    if (
      narrowing &&
      !fellBack &&
      search.query === narrowedQuery &&
      search.status === 'success' &&
      search.items.length === 0
    ) {
      setFallbackFor(narrowedQuery);
    }
  }, [narrowing, fellBack, narrowedQuery, search.query, search.status, search.items.length]);
  const [noticeDismissed, setNoticeDismissed] = useState(false);
  useEffect(() => setNoticeDismissed(false), [ghQuery]);
  const gh = `https://github.com/${repo.fullName}`;

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value === null) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true, preventScrollReset: true });
  };

  const counts: Record<IssueTab, number | null> = {
    gfi: repo.goodFirstIssues,
    help: repo.helpWanted,
    all: null,
  };

  return (
    <>
      <div
        role="tablist"
        aria-label="Which issues"
        className="mt-3 flex max-w-full gap-0.5 overflow-x-auto rounded-full bg-fg/[0.06] p-0.5 scrollbar-none sm:inline-flex"
      >
        {ISSUE_TABS.map((t) => {
          const active = t === tab;
          return (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls="repo-issues"
              onClick={() => setParam('tab', t === defaultIssueTab(parsed) ? null : t)}
              className={`relative h-11 shrink-0 whitespace-nowrap rounded-full px-3.5 text-[13px] font-medium transition-colors sm:h-9 ${active ? 'text-bg' : 'text-muted hover:text-fg'}`}
              data-testid="issue-tab"
            >
              {active && (
                <motion.span
                  layoutId="issue-tab-pill"
                  className="absolute inset-0 rounded-full bg-fg"
                  transition={{ type: 'spring', stiffness: 480, damping: 36 }}
                />
              )}
              <span className="relative">
                {TAB_LABEL[t]}
                {counts[t] !== null && <span className="ml-1.5 tabular-nums">{counts[t]}</span>}
              </span>
            </button>
          );
        })}
      </div>

      {extraChips.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted" data-testid="issue-narrowing">
          <span>{fellBack ? 'Your search asked for:' : 'Narrowed by your search:'}</span>
          <ul className="flex flex-wrap gap-2">
            <AnimatePresence initial={false}>
              {extraChips.map((c, i) => (
                <Patch key={`${c.kind}:${c.id}`} chip={{ ...c, scope: undefined }} index={i} />
              ))}
            </AnimatePresence>
          </ul>
          <button
            type="button"
            className="inline-flex min-h-11 items-center gap-1 rounded-md px-1.5 text-xs font-medium text-accent hover:underline sm:min-h-8"
            onClick={() => setParam('q', null)}
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" /> Show all
          </button>
        </div>
      )}

      {fellBack && (
        <p className="mt-2 text-sm text-muted" role="status" data-testid="issue-fallback">
          No {extraChips.map((c) => `'${c.label.toLowerCase()}'`).join(' or ')}-labelled issues here, showing all{' '}
          {TAB_LABEL[tab].toLowerCase()}.
        </p>
      )}

      {!noticeDismissed && search.notice && (
        <div className="mt-3">
          <Notice
            notice={search.notice}
            relaxed={search.relaxed}
            onOpenSettings={openSettings}
            onRetry={() => (demo ? setParam('demo', null) : search.retry())}
            onDismiss={() => setNoticeDismissed(true)}
          />
        </div>
      )}

      <div id="repo-issues" role="tabpanel" aria-label={TAB_LABEL[tab]} className="mt-4">
        {search.status === 'loading' && search.items.length === 0 && <RepoIssuesSkeleton />}
        {search.status === 'error' && <ErrorState message={search.error ?? ''} onRetry={search.retry} />}
        {search.status === 'success' && search.items.length === 0 && (
          <EmptyState
            chips={[]}
            onRemove={() => {}}
            title={
              tab === 'all'
                ? 'No unassigned issues right now'
                : `No unassigned ${TAB_LABEL[tab].toLowerCase()} right now`
            }
            body="They get claimed fast here. Try another tab, or look on GitHub itself:"
            action={
              <a href={`${gh}/issues`} target="_blank" rel="noreferrer" className="btn-seam">
                Open issues on GitHub <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            }
          />
        )}
        {search.items.length > 0 && search.status !== 'error' && (
          <ul
            className={`space-y-3.5 transition-opacity duration-200 ${search.status === 'loading' ? 'opacity-60' : ''}`}
            data-testid="repo-issues"
          >
            {search.items.map((issue, i) => (
              <motion.li
                key={`${issue.id}:${issue.htmlUrl}`}
                initial={enter({ y: 26, rotate: i % 2 ? 0.5 : -0.5 })}
                animate={{ y: 0, rotate: 0 }}
                transition={{ type: 'spring', stiffness: 380, damping: 32, delay: Math.min(i, 8) * 0.045 }}
              >
                <IssueCard
                  issue={issue}
                  theme={theme}
                  saved={isSaved(issue)}
                  onToggleSave={onToggleSave}
                  parsed={parsed}
                  fallbackLanguage={repo.languageName}
                  offline={demo || search.source === 'sample'}
                />
              </motion.li>
            ))}
          </ul>
        )}
        {search.status === 'success' && search.hasMore && (
          <div className="flex justify-center pt-6">
            <button
              type="button"
              className="btn-seam h-11 px-5"
              onClick={search.loadMore}
              disabled={search.loadingMore}
            >
              {search.loadingMore ? (
                <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <ArrowDown className="h-4 w-4" aria-hidden="true" />
              )}
              {search.loadingMore ? 'Sewing on more…' : 'Load more'}
            </button>
          </div>
        )}
      </div>
    </>
  );
}

function RepoIssuesSkeleton() {
  return (
    <div className="space-y-3.5" data-testid="repo-issues-loading">
      {Array.from({ length: 3 }, (_, i) => (
        <IssueCardSkeleton key={i} />
      ))}
    </div>
  );
}
