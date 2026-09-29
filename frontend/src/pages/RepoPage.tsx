import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowDown,
  ArrowLeft,
  BookOpen,
  Bookmark,
  CircleCheck,
  CircleDashed,
  ExternalLink,
  Flag,
  Globe,
  ListTodo,
  LoaderCircle,
  Sprout,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import type { RepoRecord } from '../../../shared/repo';
import { FieldBadge } from '../components/FieldBadge';
import { GitHubMark, RepoAvatar } from '../components/icons';
import { IssueCard, IssueCardSkeleton } from '../components/IssueCard';
import { Patch } from '../components/Patches';
import { FirstPrRibbon } from '../components/RepoCard';
import { EmptyState, ErrorState, Notice } from '../components/ResultStates';
import { ScoreStitches } from '../components/ScoreStitches';
import { useDataset } from '../data/dataset';
import { useSearch } from '../hooks/useSearch';
import { useShell } from '../hooks/useShell';
import { repoDetailPath } from '../lib/dataset';
import { fabricStyle } from '../lib/fabric';
import { committedAgo, fieldLabel, languageColor, repoFabric, scoreLevel } from '../lib/repoDisplay';
import { plural, replyTime } from '../lib/format';
import { parseQuery } from '../lib/parseQuery';
import { issueLevelChips, repoIssueQuery, ISSUE_TABS, type IssueTab } from '../lib/repoSearch';
import { failedGateLabels, firstPrChecks, scoreLines } from '../lib/repoWhy';
import { NotFoundPage } from './NotFoundPage';

const FLAG_URL = 'https://github.com/AaryanPuri/OpenSrc/issues/new?template=flag-repo.yml';

const TAB_LABEL: Record<IssueTab, string> = { gfi: 'Good first issues', help: 'Help wanted', all: 'All open' };

/** The full record (homepage, topics, whole description) from /data/repo/…; the index is enough until then. */
function useRepoDetail(fullName: string | null) {
  const [detail, setDetail] = useState<RepoRecord | null>(null);
  useEffect(() => {
    setDetail(null);
    if (!fullName) return;
    const c = new AbortController();
    fetch(repoDetailPath(fullName), { signal: c.signal })
      .then((r) => (r.ok ? (r.json() as Promise<RepoRecord>) : null))
      .then((d) => {
        if (d && d.fullName === fullName) setDetail(d);
      })
      .catch(() => {});
    return () => c.abort();
  }, [fullName]);
  return detail;
}

/** One repo: facts, why it scores what it does, where to start, and its open issues, live. */
export function RepoPage() {
  const { owner = '', name = '' } = useParams();
  const wanted = `${owner}/${name}`.toLowerCase();
  const dataset = useDataset();
  const indexed = useMemo(
    () => dataset.repos.find((r) => r.fullName.toLowerCase() === wanted) ?? null,
    [dataset.repos, wanted],
  );
  const detail = useRepoDetail(indexed?.fullName ?? null);
  // The index's numbers stay authoritative (same snapshot); the detail adds what the index leaves out.
  const repo = useMemo(
    () =>
      indexed && detail
        ? { ...indexed, description: detail.description, homepage: detail.homepage, topics: detail.topics }
        : indexed,
    [indexed, detail],
  );

  useEffect(() => {
    if (dataset.status !== 'ready') return;
    document.title = repo ? `${repo.fullName}: how to contribute · OpenSrc` : 'Repo not found · OpenSrc';
  }, [repo, dataset.status]);

  if (dataset.status === 'error') {
    return (
      <div className="mx-auto max-w-6xl px-4 pb-24 pt-10 sm:px-6">
        <ErrorState
          message="The repo directory didn't load. Check your connection and try again."
          onRetry={dataset.retry}
        />
      </div>
    );
  }
  if (dataset.status !== 'ready') return <RepoPageSkeleton />;
  if (!repo) return <UnknownRepo fullName={`${owner}/${name}`} />;
  return <RepoView repo={repo} now={dataset.now} />;
}

function RepoView({ repo, now }: { repo: RepoRecord; now: number }) {
  const { theme, token, isSaved, onToggleSave, isRepoSaved, onToggleRepoSave, openSettings } = useShell();
  const [params, setParams] = useSearchParams();
  const tab = (ISSUE_TABS as string[]).includes(params.get('tab') ?? '') ? (params.get('tab') as IssueTab) : 'gfi';
  const q = params.get('q')?.trim() ?? '';
  const demo = params.get('demo') === '1';
  const parsed = useMemo(() => (q ? parseQuery(q) : null), [q]);
  const extraChips = useMemo(() => (parsed ? issueLevelChips(parsed) : []), [parsed]);
  const narrowing = extraChips.length ? parsed : null;
  const ghQuery = repoIssueQuery(repo.fullName, tab, narrowing);
  const search = useSearch(ghQuery, 'best', token, demo);
  const [noticeDismissed, setNoticeDismissed] = useState(false);
  useEffect(() => setNoticeDismissed(false), [ghQuery]);
  const saveBtn = useRef<HTMLButtonElement>(null);
  const saved = isRepoSaved(repo.fullName);
  const fabric = repoFabric(repo);
  const gh = `https://github.com/${repo.fullName}`;
  const gfiUrl = `${gh}/issues?q=${encodeURIComponent('is:issue is:open label:"good first issue"')}`;

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
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-5 sm:px-6 sm:pt-8">
      <Link
        to={q ? `/?q=${encodeURIComponent(q)}` : '/'}
        className="-ml-1 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-1 text-sm text-muted hover:text-fg"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {q ? 'Back to your search' : 'The directory'}
      </Link>

      {/* Header patch */}
      <header className="paper relative mt-3 overflow-hidden" data-testid="repo-header">
        <span aria-hidden="true" className="absolute inset-x-0 top-0 h-2" style={fabricStyle(fabric, 0.6)} />
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -right-10 -top-10 h-64 w-80 opacity-[0.12]"
          style={{
            ...fabricStyle(fabric, 1.4),
            maskImage: 'radial-gradient(closest-side, #000 30%, transparent)',
            WebkitMaskImage: 'radial-gradient(closest-side, #000 30%, transparent)',
          }}
        />
        <div className="relative px-4 pb-5 pt-7 sm:px-7 sm:pb-6 sm:pt-8">
          <div className="flex items-start gap-4">
            <RepoAvatar owner={repo.owner} size={56} offline={demo} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm text-subtle">{repo.owner}/</p>
              <h1 className="break-words font-display text-[2rem] font-[560] leading-[1.05] tracking-[-0.02em] sm:text-[2.6rem]">
                {repo.name}
              </h1>
            </div>
            <motion.button
              ref={saveBtn}
              type="button"
              whileTap={{ scale: 0.9 }}
              aria-pressed={saved}
              onClick={() => onToggleRepoSave(repo, saveBtn.current?.getBoundingClientRect() ?? null)}
              className={`btn-seam shrink-0 ${saved ? 'border-accent/60 text-accent' : ''}`}
              data-testid="save-repo"
            >
              <Bookmark className="h-4 w-4" fill={saved ? 'currentColor' : 'none'} aria-hidden="true" />
              <span className="hidden sm:inline">{saved ? 'Saved' : 'Save'}</span>
              <span className="sr-only sm:hidden">
                {saved ? `Remove ${repo.fullName} from saved` : `Save ${repo.fullName}`}
              </span>
            </motion.button>
          </div>
          {repo.description && (
            <p className="mt-4 max-w-3xl text-pretty text-[16px] leading-relaxed text-muted sm:text-[17px]">
              {repo.description}
            </p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {repo.firstPrFriendly && <FirstPrRibbon />}
            <a href={gh} target="_blank" rel="noreferrer" className="btn-ghost -ml-1">
              <GitHubMark className="h-4 w-4" />
              GitHub
              <ExternalLink className="h-3 w-3 text-subtle" aria-hidden="true" />
            </a>
            {repo.homepage && (
              <a href={repo.homepage} target="_blank" rel="noreferrer" className="btn-ghost max-w-full">
                <Globe className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="truncate">{repo.homepage.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}</span>
                <ExternalLink className="h-3 w-3 shrink-0 text-subtle" aria-hidden="true" />
              </a>
            )}
          </div>
        </div>
      </header>

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-10">
        <div className="min-w-0 space-y-10">
          {/* Start here */}
          <section aria-labelledby="start-title">
            <h2 id="start-title" className="font-display text-[22px] font-[560] tracking-[-0.01em]">
              Start here
            </h2>
            <ol className="mt-3 grid gap-2.5 sm:grid-cols-3">
              <StartStep
                n={1}
                href={repo.contributingUrl ?? `${gh}#readme`}
                icon={BookOpen}
                title={repo.contributingUrl ? 'Read CONTRIBUTING' : 'Read the README'}
                hint={repo.contributingUrl ? 'How they like changes made' : 'No CONTRIBUTING guide yet'}
              />
              <StartStep
                n={2}
                href={gfiUrl}
                icon={Sprout}
                title="Good first issues"
                hint={`${plural(repo.goodFirstIssues, 'open issue')} on GitHub`}
              />
              <StartStep n={3} href={`${gh}/issues`} icon={ListTodo} title="All issues" hint="Everything that's open" />
            </ol>
          </section>

          {/* Live issues */}
          <section aria-labelledby="issues-title">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <h2 id="issues-title" className="font-display text-[22px] font-[560] tracking-[-0.01em]">
                Open issues, live
              </h2>
              <p className="text-xs text-subtle">Unassigned, straight from GitHub</p>
            </div>
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
                    onClick={() => setParam('tab', t === 'gfi' ? null : t)}
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
                <span>Narrowed by your search:</span>
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
              {search.status === 'loading' && search.items.length === 0 && (
                <div className="space-y-3.5">
                  {Array.from({ length: 3 }, (_, i) => (
                    <IssueCardSkeleton key={i} />
                  ))}
                </div>
              )}
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
                      initial={{ y: 26, rotate: i % 2 ? 0.5 : -0.5 }}
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
          </section>
        </div>

        <aside className="min-w-0 space-y-8" aria-label="About this repo">
          <Facts repo={repo} now={now} />
          <WhyScore repo={repo} now={now} />
          <a
            href={`${FLAG_URL}&repo=${encodeURIComponent(repo.fullName)}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center gap-2 rounded-lg text-sm text-muted hover:text-fg"
            data-testid="flag-repo"
          >
            <Flag className="h-4 w-4" aria-hidden="true" />
            Flag this repo (wrong data, not welcoming, gone)
          </a>
        </aside>
      </div>
    </div>
  );
}

function StartStep({
  n,
  href,
  icon: Icon,
  title,
  hint,
}: {
  n: number;
  href: string;
  icon: typeof BookOpen;
  title: string;
  hint: string;
}) {
  return (
    <li>
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="group flex h-full min-h-16 items-center gap-3 rounded-[14px] border border-line bg-surface/50 p-3 transition-[background-color,border-color,box-shadow] duration-200 hover:border-line-strong hover:bg-surface hover:shadow-lift"
      >
        <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-[10px] border border-dashed border-accent/60 bg-accent/[0.06] text-accent">
          <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
          <span className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-fg text-[11px] font-semibold text-bg">
            {n}
          </span>
        </span>
        <span className="min-w-0">
          <span className="flex items-center gap-1 text-[14.5px] font-semibold leading-tight text-fg">
            {title}
            <ExternalLink className="h-3 w-3 shrink-0 text-subtle" aria-hidden="true" />
          </span>
          <span className="mt-0.5 block text-xs text-subtle">{hint}</span>
        </span>
      </a>
    </li>
  );
}

function Facts({ repo, now }: { repo: RepoRecord; now: number }) {
  const rows: [string, React.ReactNode][] = [
    ['Stars', repo.stars.toLocaleString('en')],
    ['Forks', repo.forks.toLocaleString('en')],
    ['License', repo.license === 'other' ? 'Custom' : (repo.license ?? 'None')],
    ['Last commit', repo.lastCommitAt ? committedAgo(repo.lastCommitAt, now).replace(/^committed /, '') : 'Unknown'],
    ['Replies in', repo.responseHours === null ? 'Not measured' : replyTime(repo.responseHours)],
    ['Good first issues', repo.goodFirstIssues.toLocaleString('en')],
    ['Help wanted', repo.helpWanted.toLocaleString('en')],
    [
      'Language',
      repo.languageName ? (
        <span className="inline-flex items-center gap-1.5">
          <span
            className="h-2.5 w-2.5 rounded-full ring-1 ring-inset ring-black/10"
            style={{ backgroundColor: languageColor(repo.language) }}
            aria-hidden="true"
          />
          {repo.languageName}
        </span>
      ) : (
        'Unknown'
      ),
    ],
  ];
  return (
    <section aria-labelledby="facts-title">
      <h2 id="facts-title" className="eyebrow">
        Facts
      </h2>
      <dl className="mt-2 divide-y divide-line/70 border-y border-line/70 text-sm" data-testid="repo-facts">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-4 py-2">
            <dt className="text-muted">{k}</dt>
            <dd className="text-right font-medium tabular-nums text-fg">{v}</dd>
          </div>
        ))}
        {repo.fields.length > 0 && (
          <div className="py-2.5">
            <dt className="text-muted">Fields</dt>
            <dd className="mt-1.5 flex flex-wrap gap-1.5">
              {repo.fields.map((id) => (
                <Link key={id} to={`/field/${id}`} className="chip touch h-9 pl-1.5 pr-3 text-xs lg:h-7 lg:pr-2.5">
                  <FieldBadge id={id} />
                  {fieldLabel(id)}
                </Link>
              ))}
            </dd>
          </div>
        )}
      </dl>
      {repo.topics.length > 0 && (
        <p className="mt-2 text-xs leading-relaxed text-subtle">
          <span className="sr-only">Topics: </span>
          {repo.topics
            .slice(0, 8)
            .map((t) => `#${t}`)
            .join(' ')}
        </p>
      )}
    </section>
  );
}

function WhyScore({ repo, now }: { repo: RepoRecord; now: number }) {
  const lines = useMemo(() => scoreLines(repo, now), [repo, now]);
  const gates = useMemo(() => failedGateLabels(repo, now), [repo, now]);
  const checks = firstPrChecks(repo);
  return (
    <section aria-labelledby="why-title">
      <div className="flex items-center justify-between gap-3">
        <h2 id="why-title" className="eyebrow">
          Why this score
        </h2>
        <ScoreStitches score={repo.score} size="lg" />
      </div>
      <p className="mt-1 text-sm text-muted">{scoreLevel(repo.score).label} to new contributors, out of 100.</p>
      <ul className="mt-3 space-y-3" data-testid="score-parts">
        {lines.map((l) => (
          <li key={l.part}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="font-medium text-fg">{l.title}</span>
              <span className="shrink-0 text-xs tabular-nums text-subtle">
                {Math.round(l.points)}/{l.weight}
              </span>
            </div>
            <span className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-line/60" aria-hidden="true">
              <span className="rounded-full bg-accent" style={{ width: `${(l.points / l.weight) * 100}%` }} />
            </span>
            <p className="mt-1 text-[12.5px] leading-snug text-muted">{l.reason}</p>
          </li>
        ))}
      </ul>
      <div className="mt-4 rounded-[12px] border border-line p-3">
        <p className="text-[13px] font-semibold text-fg">
          {repo.firstPrFriendly ? 'First-PR friendly, because it has:' : 'First-PR friendly needs:'}
        </p>
        <ul className="mt-1.5 space-y-1 text-[12.5px]">
          {checks.map((c) => (
            <li key={c.text} className={`flex items-center gap-1.5 ${c.ok ? 'text-muted' : 'text-subtle'}`}>
              {c.ok ? (
                <CircleCheck className="h-3.5 w-3.5 shrink-0 text-[rgb(var(--ok))]" aria-hidden="true" />
              ) : (
                <CircleDashed className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              )}
              <span className="sr-only">{c.ok ? 'Met: ' : 'Not met: '}</span>
              {c.text}
            </li>
          ))}
        </ul>
      </div>
      {gates.length > 0 && (
        <p className="mt-3 text-[12.5px] text-warn">Not listable right now: {gates.join(', ').toLowerCase()}.</p>
      )}
    </section>
  );
}

function UnknownRepo({ fullName }: { fullName: string }) {
  return (
    <NotFoundPage
      documentTitle={null}
      title="This repo isn't in the directory"
      body={
        <>
          <span className="font-medium text-fg">{fullName}</span> isn't one of the repos we list. It may not have open
          good first issues right now, or we haven't found it yet.
        </>
      }
      actions={
        <>
          <a href={`https://github.com/${fullName}`} target="_blank" rel="noreferrer" className="btn-seam h-11 px-5">
            <GitHubMark className="h-4 w-4" /> Open on GitHub
          </a>
          <Link to="/submit" className="btn-ink h-11 px-5">
            Suggest it
          </Link>
        </>
      }
    />
  );
}

function RepoPageSkeleton() {
  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-5 sm:px-6 sm:pt-8" aria-busy="true" data-testid="repo-skeleton">
      <div className="skeleton h-5 w-28" />
      <div className="paper mt-3 px-4 pb-6 pt-8 sm:px-7">
        <div className="flex items-center gap-4">
          <div className="skeleton h-14 w-14" />
          <div className="flex-1 space-y-2">
            <div className="skeleton h-3.5 w-24" />
            <div className="skeleton h-8 w-56" />
          </div>
        </div>
        <div className="skeleton mt-5 h-4 w-3/4" />
      </div>
      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-3.5">
          {Array.from({ length: 3 }, (_, i) => (
            <IssueCardSkeleton key={i} />
          ))}
        </div>
        <div className="skeleton h-72" />
      </div>
    </div>
  );
}
