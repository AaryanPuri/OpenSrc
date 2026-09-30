/**
 * A repo page's live issues (Good first / Contributions welcome / All tabs), exactly GitHub's
 * sets: every open issue with one of the tab's labels (any issue on "All open"), assigned or
 * not (assigned ones are tagged), never pull requests, newest first. The tab counts are
 * GitHub's own numbers, fetched live; when the source can't count exactly, no number shows.
 *
 * Only ever this repo's issues: when GitHub's quota is spent, the tab says so and links to the
 * same list on GitHub, never to sample issues. Loaded lazily after hydration (see RepoPage), so
 * the issue cards and this code stay out of the pre-rendered pages' main chunk.
 */
import { motion } from 'framer-motion';
import { ArrowDown, Coffee, ExternalLink, KeyRound, LoaderCircle, RotateCcw } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import type { RepoRecord } from '../../../shared/repo';
import { githubIssuesUrl, ISSUE_TABS, type IssueTab, type TabCounts } from '../../../shared/repoIssues';
import { useCountdown } from '../hooks/useCountdown';
import { useEntrance } from '../hooks/useEntrance';
import { useRepoIssues } from '../hooks/useRepoIssues';
import { useShell } from '../hooks/useShell';
import { parseQuery } from '../lib/parseQuery';
import { repoTabLabels } from '../lib/repoIssues';
import { defaultIssueTab, HELP_WANTED_NAME } from '../lib/repoSearch';
import { IssueCard } from './IssueCard';
import { IssueCardSkeleton } from './IssueCardSkeleton';
import { EmptyState } from './ResultStates';

const TAB_LABEL: Record<IssueTab, string> = { gfi: 'Good first issues', help: HELP_WANTED_NAME, all: 'All open' };

export interface RepoIssuesProps {
  repo: RepoRecord;
  /** GitHub's live counts, once known (the page's facts show them in place of the nightly ones). */
  onCounts?: (counts: TabCounts) => void;
}

export default function RepoIssues({ repo, onCounts }: RepoIssuesProps) {
  const { theme, token, isSaved, onToggleSave, openSettings } = useShell();
  const [params, setParams] = useSearchParams();
  const enter = useEntrance();
  const q = params.get('q')?.trim() ?? '';
  const parsed = useMemo(() => (q ? parseQuery(q) : null), [q]);
  // A search only picks the tab it opens on ("help wanted" → Contributions welcome); it never
  // filters the list, so what a tab shows is always exactly GitHub's set.
  const tab = (ISSUE_TABS as string[]).includes(params.get('tab') ?? '')
    ? (params.get('tab') as IssueTab)
    : defaultIssueTab(parsed);
  const issues = useRepoIssues(repo, tab, token);
  const labels = useMemo(() => repoTabLabels(repo), [repo]);
  const ghTab = githubIssuesUrl(repo.fullName, tab, tab === 'all' ? [] : labels[tab]);

  useEffect(() => {
    if (issues.counts) onCounts?.(issues.counts);
  }, [issues.counts, onCounts]);

  const setTab = (t: IssueTab) => {
    const next = new URLSearchParams(params);
    if (t === defaultIssueTab(parsed)) next.delete('tab');
    else next.set('tab', t);
    setParams(next, { replace: true, preventScrollReset: true });
  };

  const showList = issues.items.length > 0 && (issues.status === 'success' || issues.status === 'loading');

  return (
    <>
      <div
        role="tablist"
        aria-label="Which issues"
        className="mt-3 flex max-w-full gap-0.5 overflow-x-auto rounded-full bg-fg/[0.06] p-0.5 scrollbar-none sm:inline-flex"
      >
        {ISSUE_TABS.map((t) => {
          const active = t === tab;
          const n = issues.counts?.[t];
          return (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls="repo-issues"
              onClick={() => setTab(t)}
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
                {n !== undefined && (
                  <span className="ml-1.5 tabular-nums" data-testid="issue-tab-count">
                    {n.toLocaleString('en')}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      <div id="repo-issues" role="tabpanel" aria-label={TAB_LABEL[tab]} className="mt-4">
        {issues.status === 'loading' && issues.items.length === 0 && <RepoIssuesSkeleton />}
        {issues.status === 'rate-limited' && (
          <Breather
            resetAt={issues.resetAt}
            href={ghTab}
            onRetry={issues.retry}
            onToken={token ? null : openSettings}
          />
        )}
        {(issues.status === 'error' || issues.status === 'not-found') && (
          <EmptyState
            chips={[]}
            onRemove={() => {}}
            title={issues.status === 'not-found' ? 'GitHub can’t find this repo' : 'The thread snapped'}
            body={
              issues.status === 'not-found'
                ? 'It may have been renamed, made private or deleted since the last update.'
                : 'We couldn’t reach GitHub just now. Try again, or see the issues on GitHub itself:'
            }
            action={
              <div className="flex flex-wrap justify-center gap-2">
                {issues.status === 'error' && (
                  <button type="button" className="btn-seam h-11 px-5" onClick={issues.retry}>
                    <RotateCcw className="h-4 w-4" aria-hidden="true" /> Try again
                  </button>
                )}
                <GitHubLink href={ghTab} />
              </div>
            }
          />
        )}
        {issues.status === 'success' && issues.items.length === 0 && (
          <EmptyState
            chips={[]}
            onRemove={() => {}}
            title={tab === 'all' ? 'No open issues right now' : `No open ${TAB_LABEL[tab].toLowerCase()} right now`}
            body="Try another tab, or look on GitHub itself:"
            action={<GitHubLink href={ghTab} />}
          />
        )}
        {showList && (
          <ul
            className={`space-y-3.5 transition-opacity duration-200 ${issues.status === 'loading' ? 'opacity-60' : ''}`}
            data-testid="repo-issues"
          >
            {issues.items.map((issue, i) => (
              <motion.li
                key={`${issue.id}:${issue.htmlUrl}`}
                initial={enter({ y: 26, rotate: i % 2 ? 0.5 : -0.5 })}
                animate={{ y: 0, rotate: 0 }}
                transition={{ type: 'spring', stiffness: 380, damping: 32, delay: Math.min(i % 20, 8) * 0.045 }}
              >
                <IssueCard
                  issue={issue}
                  theme={theme}
                  saved={isSaved(issue)}
                  onToggleSave={onToggleSave}
                  parsed={parsed}
                  fallbackLanguage={repo.languageName}
                />
              </motion.li>
            ))}
          </ul>
        )}
        {issues.status === 'success' && issues.hasMore && (
          <div className="flex justify-center pt-6">
            <button
              type="button"
              className="btn-seam h-11 px-5"
              onClick={issues.loadMore}
              disabled={issues.loadingMore}
            >
              {issues.loadingMore ? (
                <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <ArrowDown className="h-4 w-4" aria-hidden="true" />
              )}
              {issues.loadingMore ? 'Sewing on more…' : 'Load more'}
            </button>
          </div>
        )}
      </div>
    </>
  );
}

function GitHubLink({ href, primary = false }: { href: string; primary?: boolean }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={primary ? 'btn-ink h-11 px-5' : 'btn-seam h-11 px-5'}
      data-testid="issues-on-github"
    >
      See the issues on GitHub <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
    </a>
  );
}

/** GitHub's quota is spent: a countdown, a retry, and the same list on GitHub. */
function Breather({
  resetAt,
  href,
  onRetry,
  onToken,
}: {
  resetAt?: number;
  href: string;
  onRetry: () => void;
  onToken: (() => void) | null;
}) {
  const countdown = useCountdown(resetAt);
  return (
    <div
      role="status"
      className="flex flex-col items-center rounded-[16px] border border-dashed border-line-strong px-6 py-12 text-center"
      data-testid="rate-limited"
    >
      <span
        aria-hidden="true"
        className="grid h-14 w-14 -rotate-6 place-items-center rounded-[14px] border border-accent/50 bg-accent/[0.07] text-accent"
      >
        <Coffee className="h-6 w-6" />
      </span>
      <h3 className="mt-5 font-display text-[22px] font-[560] tracking-[-0.01em]">GitHub needs a short breather.</h3>
      <p className="mt-2 max-w-md text-pretty text-sm text-muted" data-testid="rate-limited-countdown">
        {countdown === 'now'
          ? 'You can try again now.'
          : countdown
            ? `Try again in ${countdown}.`
            : 'Try again in a minute.'}{' '}
        Meanwhile, the same issues are one click away on GitHub.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <GitHubLink href={href} primary />
        <button type="button" className="btn-seam h-11 px-5" onClick={onRetry}>
          <RotateCcw className="h-4 w-4" aria-hidden="true" /> Retry
        </button>
        {onToken && (
          <button type="button" className="btn-seam h-11 px-5" onClick={onToken}>
            <KeyRound className="h-4 w-4" aria-hidden="true" /> Use your own token
          </button>
        )}
      </div>
    </div>
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
