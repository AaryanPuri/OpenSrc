import { motion } from 'framer-motion';
import {
  ArrowLeft,
  BookOpen,
  Bookmark,
  CircleCheck,
  CircleDashed,
  ExternalLink,
  Flag,
  Globe,
  ListTodo,
  Sprout,
} from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { flagIssueUrl } from '../../../shared/issueForms';
import type { RepoRecord } from '../../../shared/repo';
import { FieldBadge } from '../components/FieldBadge';
import { GitHubMark, RepoAvatar } from '../components/icons';
import { IssueCardSkeleton } from '../components/IssueCardSkeleton';
import { FirstPrRibbon } from '../components/RepoCard';
import { ErrorState } from '../components/ResultStates';
import { ScoreStitches } from '../components/ScoreStitches';
import { useDataset } from '../data/dataset';
import { useDocumentMeta } from '../hooks/useDocumentMeta';
import { useHydrated } from '../hooks/useHydrated';
import { useShell } from '../hooks/useShell';
import { repoDetailPath } from '../lib/dataset';
import { backToSearchPath } from '../lib/repoSearch';
import { fabricStyle } from '../lib/fabric';
import { hasLanguagePage } from '../lib/listPages';
import { committedAgo, fieldLabel, languageColor, repoFabric, scoreLevel } from '../lib/repoDisplay';
import { plural, replyTime } from '../lib/format';
import { failedGateLabels, firstPrChecks, scoreLines } from '../lib/repoWhy';
import { useSiteUrl } from '../seo/context';
import { repoMeta } from '../seo/meta';
import { NotFoundPage } from './NotFoundPage';

// Live issues come from GitHub in the browser anyway: their code loads after hydration, in its own chunk.
const RepoIssues = lazy(() => import('../components/RepoIssues'));

function IssuesPlaceholder() {
  return (
    <div className="mt-3 space-y-3.5" aria-busy="true" data-testid="repo-issues-loading">
      <div className="skeleton h-9 w-72 max-w-full rounded-full" />
      {Array.from({ length: 3 }, (_, i) => (
        <IssueCardSkeleton key={i} />
      ))}
    </div>
  );
}

/**
 * The full record (homepage, topics, whole description): handed over with a
 * pre-rendered page, else fetched from /data/repo/…; the index is enough until then.
 */
function useRepoDetail(fullName: string | null, known: RepoRecord | undefined) {
  const [fetched, setFetched] = useState<RepoRecord | null>(null);
  useEffect(() => {
    if (!fullName || known) return;
    const c = new AbortController();
    fetch(repoDetailPath(fullName), { signal: c.signal })
      .then((r) => (r.ok ? (r.json() as Promise<RepoRecord>) : null))
      .then((d) => {
        if (d && d.fullName === fullName) setFetched(d);
      })
      .catch(() => {});
    return () => c.abort();
  }, [fullName, known]);
  if (known) return known;
  return fetched && fetched.fullName === fullName ? fetched : null;
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
  const detail = useRepoDetail(indexed?.fullName ?? null, indexed ? dataset.details[indexed.fullName] : undefined);
  // The index's numbers stay authoritative (same snapshot); the detail adds what the index leaves out.
  const repo = useMemo(
    () =>
      indexed && detail
        ? { ...indexed, description: detail.description, homepage: detail.homepage, topics: detail.topics }
        : indexed,
    [indexed, detail],
  );

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
  const languagePage = !!repo.language && !!dataset.meta && hasLanguagePage(dataset.meta, repo.language);
  return <RepoView repo={repo} now={dataset.now} languagePage={languagePage} />;
}

function RepoView({ repo, now, languagePage }: { repo: RepoRecord; now: number; languagePage: boolean }) {
  const site = useSiteUrl();
  useDocumentMeta(useMemo(() => repoMeta(site, repo), [site, repo]));
  const { isRepoSaved, onToggleRepoSave } = useShell();
  const [params] = useSearchParams();
  const hydrated = useHydrated();
  const q = params.get('q')?.trim() ?? '';
  const demo = params.get('demo') === '1';
  const saveBtn = useRef<HTMLButtonElement>(null);
  const saved = isRepoSaved(repo.fullName);
  const fabric = repoFabric(repo);
  const gh = `https://github.com/${repo.fullName}`;
  const gfiUrl = `${gh}/issues?q=${encodeURIComponent('is:issue is:open label:"good first issue"')}`;

  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-5 sm:px-6 sm:pt-8">
      <Link
        to={backToSearchPath(params)}
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
            {hydrated ? (
              <Suspense fallback={<IssuesPlaceholder />}>
                <RepoIssues key={repo.fullName} repo={repo} />
              </Suspense>
            ) : (
              <IssuesPlaceholder />
            )}
          </section>
        </div>

        <aside className="min-w-0 space-y-8" aria-label="About this repo">
          <Facts repo={repo} now={now} languagePage={languagePage} />
          <WhyScore repo={repo} now={now} />
          <a
            href={flagIssueUrl(repo.fullName)}
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

function Facts({ repo, now, languagePage }: { repo: RepoRecord; now: number; languagePage: boolean }) {
  const dot = (
    <span
      className="h-2.5 w-2.5 rounded-full ring-1 ring-inset ring-black/10"
      style={{ backgroundColor: languageColor(repo.language) }}
      aria-hidden="true"
    />
  );
  const rows: [string, React.ReactNode][] = [
    ['Stars', repo.stars.toLocaleString('en')],
    ['Forks', repo.forks.toLocaleString('en')],
    ['License', repo.license === 'other' ? 'Custom' : (repo.license ?? 'None')],
    ['Last commit', repo.lastCommitAt ? committedAgo(repo.lastCommitAt, now).replace(/^committed /, '') : 'Unknown'],
    ['Replies in', repo.responseHours === null ? 'Not measured' : replyTime(repo.responseHours)],
    ['Good first issues', repo.goodFirstIssues.toLocaleString('en')],
    ['Contributions welcome', repo.helpWanted.toLocaleString('en')],
    [
      'Language',
      repo.languageName && languagePage ? (
        <Link
          to={`/language/${repo.language}`}
          className="inline-flex items-center gap-1.5 underline decoration-line-strong underline-offset-2 hover:text-accent hover:decoration-accent"
          title={`More ${repo.languageName} repos`}
        >
          {dot}
          {repo.languageName}
          <span className="sr-only"> repos</span>
        </Link>
      ) : repo.languageName ? (
        <span className="inline-flex items-center gap-1.5">
          {dot}
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
      documentTitle="Repo not found · OpenSrc"
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
