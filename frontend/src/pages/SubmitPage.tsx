import {
  ArrowRight,
  CircleCheck,
  CircleDashed,
  CircleX,
  ExternalLink,
  Flag,
  LoaderCircle,
  RotateCcw,
  Scissors,
  Settings,
} from 'lucide-react';
import { useEffect, useId, useMemo, useState, type ComponentType, type FormEvent, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  FLAG_REASONS,
  FLAG_TEMPLATE,
  flagIssueUrl,
  NEW_ISSUE_URL,
  GITHUB_REPO,
  submitIssueUrl,
  type FlagReason,
} from '../../../shared/issueForms';
import type { RepoRecord } from '../../../shared/repo';
import { daysSince, GATE_LABELS, MAX_IDLE_DAYS, MIN_OPEN_ISSUES, MIN_STARS, type Gate } from '../../../shared/score';
import { GitHubMark, NeedleIcon, RepoAvatar } from '../components/icons';
import { FirstPrRibbon, RepoCard } from '../components/RepoCard';
import { ScoreStitches } from '../components/ScoreStitches';
import { useDataset, type Dataset } from '../data/dataset';
import { useDocumentMeta } from '../hooks/useDocumentMeta';
import { useShell } from '../hooks/useShell';
import { domainFabric, fabricStyle, type Fabric } from '../lib/fabric';
import { compactNumber, plural } from '../lib/format';
import { checkRepo, parseRepoInput, RepoCheckError, type RepoCheck } from '../lib/repoCheck';
import { repoPath, scoreLevel } from '../lib/repoDisplay';
import { firstPrChecks, scoreLines } from '../lib/repoWhy';
import { useSiteUrl } from '../seo/context';
import { submitMeta } from '../seo/meta';

const REPO_URL = `https://github.com/${GITHUB_REPO}`;
const CONTRIBUTING_URL = `${REPO_URL}/blob/main/CONTRIBUTING.md`;
const CURATION_URL = `${REPO_URL}/blob/main/data/curation.yml`;
const SCORING_URL = `${REPO_URL}#how-repos-are-scored`;
const EXAMPLES = ['sharkdp/bat', 'https://github.com/astral-sh/uv'];
const LINK = 'font-medium text-accent underline-offset-2 hover:underline';

const GATES: Gate[] = ['archived', 'fork', 'mirror', 'license', 'stale', 'issues', 'stars'];
/** What passing each gate looks like (GATE_LABELS says what failing it means). */
const GATE_PASS: Record<Gate, string> = {
  archived: 'Not archived',
  fork: 'Not a fork',
  mirror: 'Not a mirror',
  license: 'Has a license',
  stale: `A commit in the last ${MAX_IDLE_DAYS} days`,
  issues: `At least ${MIN_OPEN_ISSUES} good-first-issue or help-wanted issues`,
  stars: `At least ${MIN_STARS} stars`,
};

/**
 * `/submit`: check a repo against the directory's rules in the browser, then
 * file it (or flag one) through a prefilled GitHub issue form. `?repo=` holds
 * the repo being checked, so a check can be shared.
 */
export function SubmitPage() {
  const site = useSiteUrl();
  useDocumentMeta(useMemo(() => submitMeta(site), [site]));
  const [params, setParams] = useSearchParams();
  const target = parseRepoInput(params.get('repo') ?? '');
  const check = (fullName: string) => {
    const next = new URLSearchParams(params);
    next.set('repo', fullName);
    setParams(next, { preventScrollReset: true });
  };

  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-5 sm:px-6 sm:pt-8">
      <header className="max-w-2xl">
        <p className="eyebrow">Submit a repo</p>
        <h1 className="mt-2 text-balance font-display text-[2.4rem] font-[560] leading-tight tracking-[-0.02em] sm:text-[3rem]">
          Add a patch to the quilt
        </h1>
        <p className="mt-3 text-pretty text-muted">
          Know a project that treats new contributors well? Check it against the rules the nightly collector uses, then
          file it in one click. Spotted a listing that no longer fits? Unpick it. Listing is free, always.
        </p>
      </header>

      <div className="mt-8 grid items-start gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:gap-8">
        <QuiltPatch
          id="stitch-title"
          fabric={domainFabric('frontend')}
          icon={NeedleIcon}
          eyebrow="Suggest"
          title="Stitch in a repo"
          testId="stitch-patch"
        >
          <p className="text-sm text-muted">
            Paste <span className="font-medium text-fg">owner/name</span> or a GitHub link. We read it from GitHub,
            score it and tell you whether it would be listed.
          </p>
          <RepoForm key={target ?? ''} initial={target ?? ''} onCheck={check} />
          {target ? (
            <CheckResult fullName={target} />
          ) : (
            <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-subtle">
              Try
              {EXAMPLES.map((e) => (
                <Link
                  key={e}
                  to={`/submit?repo=${encodeURIComponent(parseRepoInput(e)!)}`}
                  preventScrollReset
                  className={`rounded ${LINK}`}
                >
                  {e}
                </Link>
              ))}
            </p>
          )}
        </QuiltPatch>

        <QuiltPatch
          id="unpick-title"
          fabric={domainFabric('systems')}
          icon={Scissors}
          eyebrow="Flag"
          title="Unpick a repo"
          testId="unpick-patch"
        >
          <FlagForm />
        </QuiltPatch>
      </div>

      <HowListingWorks />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Patches and forms                                                   */
/* ------------------------------------------------------------------ */

function QuiltPatch({
  id,
  fabric,
  icon: Icon,
  eyebrow,
  title,
  testId,
  children,
}: {
  id: string;
  fabric: Fabric;
  icon: ComponentType<{ className?: string; strokeWidth?: number | string }>;
  eyebrow: string;
  title: string;
  testId: string;
  children: ReactNode;
}) {
  const ink = fabric.thread === 'light' ? 'text-white' : 'text-[#2a1d12]';
  return (
    <section aria-labelledby={id} className="paper overflow-hidden" data-testid={testId}>
      <div
        aria-hidden="true"
        className="relative flex h-14 items-center overflow-hidden px-5 sm:h-16 sm:px-6"
        style={{ backgroundColor: fabric.color }}
      >
        <span className="absolute -inset-4 opacity-50" style={fabricStyle(fabric, 1.2)} />
        <Icon className={`relative h-7 w-7 ${ink} drop-shadow-[0_1px_2px_rgb(0_0_0/0.22)]`} strokeWidth={1.6} />
      </div>
      <div className="px-4 pb-5 pt-4 sm:px-6 sm:pb-6">
        <p className="eyebrow">{eyebrow}</p>
        <h2 id={id} className="font-display text-[1.6rem] font-[560] leading-tight tracking-[-0.015em]">
          {title}
        </h2>
        <div className="mt-2">{children}</div>
      </div>
    </section>
  );
}

const INPUT =
  'h-11 w-full min-w-0 rounded-[10px] border border-line-strong bg-bg/60 px-3 text-[15px] text-fg placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25';
const INVALID = 'Enter owner/name or a GitHub link, like sharkdp/bat.';

function RepoForm({ initial, onCheck }: { initial: string; onCheck: (fullName: string) => void }) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const errorId = useId();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const fullName = parseRepoInput(value);
    if (!fullName) return setError(INVALID);
    setError(null);
    setValue(fullName);
    onCheck(fullName);
  };
  // Without JavaScript the form still lands on /submit?repo=…
  return (
    <form method="get" action="/submit" onSubmit={submit} className="mt-4" data-testid="check-form" noValidate>
      <label htmlFor={inputId} className="sr-only">
        Repository to check
      </label>
      <div className="flex gap-2">
        <input
          id={inputId}
          name="repo"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(null);
          }}
          placeholder="owner/name or https://github.com/…"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          aria-invalid={!!error}
          aria-describedby={error ? errorId : undefined}
          className={INPUT}
        />
        <button type="submit" className="btn-ink h-11 shrink-0 px-4">
          Check it
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      {error && (
        <p id={errorId} className="mt-2 text-[13px] text-warn" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

function FlagForm() {
  const { repos, status, partial } = useDataset();
  const [value, setValue] = useState('');
  const [reason, setReason] = useState<FlagReason>(FLAG_REASONS[0]);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const reasonId = useId();
  const errorId = useId();
  const fullName = parseRepoInput(value);
  // undefined: not known yet; null: not in the directory.
  const listed = useMemo(
    () => (fullName && status === 'ready' && !partial ? findListed(repos, fullName) : undefined),
    [fullName, repos, status, partial],
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!fullName) return setError(INVALID);
    setError(null);
    window.open(flagIssueUrl(listed?.fullName ?? fullName, reason), '_blank', 'noopener,noreferrer');
  };

  // Without JavaScript this is a plain GET to GitHub's issue form, which prefills fields by id.
  return (
    <form method="get" action={NEW_ISSUE_URL} target="_blank" onSubmit={submit} data-testid="flag-form" noValidate>
      <p className="text-sm text-muted">
        Archived, unwelcoming, in the wrong field or not beginner-friendly after all? Tell us, and a maintainer takes a
        look.
      </p>
      <input type="hidden" name="template" value={FLAG_TEMPLATE} />
      <div className="mt-4 space-y-3">
        <div>
          <label htmlFor={inputId} className="text-[13px] font-medium text-fg">
            Repository
          </label>
          <input
            id={inputId}
            name="repo"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              if (error) setError(null);
            }}
            placeholder="owner/name"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            aria-invalid={!!error}
            aria-describedby={error ? errorId : undefined}
            className={`${INPUT} mt-1`}
          />
          {error ? (
            <p id={errorId} className="mt-1.5 text-[13px] text-warn" role="alert">
              {error}
            </p>
          ) : listed === null ? (
            <p className="mt-1.5 text-[12.5px] text-subtle" data-testid="flag-hint">
              {fullName} isn't listed right now, so there's nothing to unpick. You can still report it.
            </p>
          ) : listed ? (
            <p className="mt-1.5 text-[12.5px] text-subtle" data-testid="flag-hint">
              Listed, with a score of {listed.score}.{' '}
              <Link to={repoPath(listed.fullName)} className={LINK}>
                Open its page
              </Link>
            </p>
          ) : null}
        </div>
        <div>
          <label htmlFor={reasonId} className="text-[13px] font-medium text-fg">
            What's wrong?
          </label>
          <select
            id={reasonId}
            name="reason"
            value={reason}
            onChange={(e) => setReason(e.target.value as FlagReason)}
            className={`${INPUT} mt-1`}
          >
            {FLAG_REASONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
      </div>
      <button type="submit" className="btn-seam mt-4 h-11 w-full px-4 sm:w-auto">
        <Flag className="h-4 w-4" aria-hidden="true" />
        File the flag on GitHub
        <ExternalLink className="h-3.5 w-3.5 text-subtle" aria-hidden="true" />
      </button>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* The check                                                           */
/* ------------------------------------------------------------------ */

type Outcome = { kind: 'checked'; check: RepoCheck; now: number } | { kind: 'error'; error: RepoCheckError };

function findListed(repos: RepoRecord[], fullName: string): RepoRecord | null {
  const key = fullName.toLowerCase();
  return repos.find((r) => r.fullName.toLowerCase() === key) ?? null;
}

/**
 * Listed already? Else read the repo from GitHub. Results are keyed by the
 * request (repo, attempt, token), so a stale one never shows.
 */
function useRepoCheck(fullName: string, dataset: Dataset, token: string | null) {
  const [attempt, setAttempt] = useState(0);
  const [done, setDone] = useState<{ key: string; outcome: Outcome } | null>(null);
  // The directory is known once the full index is in (or failed to load: then just ask GitHub).
  const known = (dataset.status === 'ready' && !dataset.partial) || dataset.status === 'error';
  const listedByName = known ? findListed(dataset.repos, fullName) : null;
  const key = `${fullName}#${attempt}#${token ?? ''}`;
  const skip = !known || !!listedByName;

  useEffect(() => {
    if (skip) return;
    const c = new AbortController();
    checkRepo(fullName, { token, signal: c.signal })
      .then((check) => setDone({ key, outcome: { kind: 'checked', check, now: Date.now() } }))
      .catch((e: unknown) => {
        if (c.signal.aborted) return;
        const error =
          e instanceof RepoCheckError
            ? e
            : new RepoCheckError('Something went wrong while reading the repo. Please try again.', 'server');
        setDone({ key, outcome: { kind: 'error', error } });
      });
    return () => c.abort();
    // `key` stands for fullName, attempt and token.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, skip]);

  const outcome = !listedByName && done?.key === key ? done.outcome : null;
  // GitHub answers with the canonical name, which may be a listed repo under its new name.
  const listed =
    listedByName ??
    (outcome?.kind === 'checked' && known ? findListed(dataset.repos, outcome.check.record.fullName) : null);
  return { known, listed, outcome: listed ? null : outcome, retry: () => setAttempt((n) => n + 1) };
}

function CheckResult({ fullName }: { fullName: string }) {
  const dataset = useDataset();
  const { token, openSettings, isRepoSaved, onToggleRepoSave } = useShell();
  const { known, listed, outcome, retry } = useRepoCheck(fullName, dataset, token);

  return (
    <div className="mt-5" aria-live="polite" data-testid="check-result">
      {listed ? (
        <Listed repo={listed} now={dataset.now} saved={isRepoSaved(listed.fullName)} onToggleSave={onToggleRepoSave} />
      ) : outcome?.kind === 'checked' ? (
        <Checked check={outcome.check} now={outcome.now} />
      ) : outcome?.kind === 'error' ? (
        <CheckError fullName={fullName} error={outcome.error} onRetry={retry} onSettings={openSettings} />
      ) : (
        <div className="rounded-[12px] border border-dashed border-line-strong p-4" aria-busy="true">
          <p className="flex items-center gap-2 text-sm text-muted">
            <LoaderCircle className="h-4 w-4 animate-spin text-accent" aria-hidden="true" />
            {known ? `Reading ${fullName} from GitHub…` : 'Looking through the directory…'}
          </p>
          <div className="mt-3 space-y-2" aria-hidden="true">
            <div className="skeleton h-4 w-2/3" />
            <div className="skeleton h-4 w-1/2" />
            <div className="skeleton h-4 w-3/5" />
          </div>
        </div>
      )}
    </div>
  );
}

function Listed({
  repo,
  now,
  saved,
  onToggleSave,
}: {
  repo: RepoRecord;
  now: number;
  saved: boolean;
  onToggleSave: (repo: RepoRecord, from: DOMRect | null) => void;
}) {
  return (
    <div data-testid="check-listed">
      <p className="flex items-start gap-2 text-sm">
        <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-[rgb(var(--ok))]" aria-hidden="true" />
        <span>
          <span className="font-semibold text-fg">Already stitched in.</span>{' '}
          <span className="text-muted">
            {repo.fullName} is in the directory with a score of {repo.score}, “
            {scoreLevel(repo.score).label.toLowerCase()}”.
          </span>
        </span>
      </p>
      <div className="mt-3 sm:max-w-md">
        <RepoCard repo={repo} now={now} saved={saved} onToggleSave={onToggleSave} />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link to={repoPath(repo.fullName)} className="btn-ink h-11 px-4">
          Open its page <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
        <a
          href={flagIssueUrl(repo.fullName)}
          target="_blank"
          rel="noreferrer"
          className="btn-seam h-11 px-4"
          data-testid="listed-flag"
        >
          <Flag className="h-4 w-4" aria-hidden="true" /> Flag it
        </a>
      </div>
    </div>
  );
}

function gateDetail(g: Gate, r: RepoRecord, now: number): string {
  switch (g) {
    case 'license':
      return r.license === 'other' ? 'Custom' : (r.license ?? 'None');
    case 'stale': {
      const d = Math.floor(daysSince(r.lastCommitAt, now));
      return d < 1 ? 'Today' : `${plural(d, 'day')} ago`;
    }
    case 'issues':
      return `${r.goodFirstIssues} + ${r.helpWanted}`;
    case 'stars':
      return compactNumber(r.stars);
    default:
      return '';
  }
}

function Checked({ check, now }: { check: RepoCheck; now: number }) {
  const { record: r, result } = check;
  const failed = new Set(result.failedGates);
  const lines = scoreLines(r, now);
  const checks = firstPrChecks(r);
  const onlyStars = result.failedGates.length === 1 && failed.has('stars');
  const n = result.failedGates.length;

  return (
    <div data-testid="check-report">
      <div className="flex items-start gap-3">
        <RepoAvatar owner={r.owner} size={44} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] text-subtle">{r.owner}/</p>
          <p className="truncate font-display text-[1.4rem] font-[560] leading-tight tracking-[-0.01em]">
            <a href={`https://github.com/${r.fullName}`} target="_blank" rel="noreferrer" className="hover:text-accent">
              {r.name}
            </a>
          </p>
          {r.description && <p className="mt-1 line-clamp-2 text-sm text-muted">{r.description}</p>}
        </div>
        <div className="shrink-0 text-right">
          <ScoreStitches score={result.score} size="lg" />
          <p className="mt-0.5 text-[11.5px] text-subtle">estimated</p>
        </div>
      </div>

      <p
        className={`mt-4 rounded-[10px] px-3 py-2 text-sm font-medium text-fg ${result.eligible ? 'bg-[rgb(var(--ok)/0.14)]' : 'bg-warn/[0.12]'}`}
        data-testid="check-verdict"
      >
        {result.eligible
          ? `It would be listed${result.firstPrFriendly ? ', and marked First-PR friendly.' : '.'}`
          : `It wouldn't be listed right now: ${plural(n, 'rule')} ${n === 1 ? 'fails' : 'fail'}.`}
      </p>

      <div className="mt-4 grid gap-5 sm:grid-cols-2">
        <section aria-labelledby="gates-title">
          <h3 id="gates-title" className="eyebrow">
            Listing rules
          </h3>
          <ul className="mt-2 space-y-1.5 text-[13px]" data-testid="check-gates">
            {GATES.map((g) => {
              const ok = !failed.has(g);
              const detail = gateDetail(g, r, now);
              return (
                <li key={g} className="flex items-start gap-2" data-gate={g} data-ok={ok}>
                  {ok ? (
                    <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-[rgb(var(--ok))]" aria-hidden="true" />
                  ) : (
                    <CircleX className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
                  )}
                  <span className="sr-only">{ok ? 'Passes: ' : 'Fails: '}</span>
                  <span className={`flex-1 ${ok ? 'text-muted' : 'font-medium text-fg'}`}>
                    {ok ? GATE_PASS[g] : GATE_LABELS[g]}
                  </span>
                  {detail && <span className="shrink-0 tabular-nums text-subtle">{detail}</span>}
                </li>
              );
            })}
          </ul>
        </section>

        <section aria-labelledby="fpr-title">
          <h3 id="fpr-title" className="eyebrow">
            First-PR friendly
          </h3>
          {result.firstPrFriendly && <FirstPrRibbon className="mt-2" />}
          <ul className="mt-2 space-y-1.5 text-[13px]">
            {checks.map((c) => (
              <li key={c.text} className="flex items-start gap-2">
                {c.ok ? (
                  <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-[rgb(var(--ok))]" aria-hidden="true" />
                ) : (
                  <CircleDashed className="mt-0.5 h-4 w-4 shrink-0 text-subtle" aria-hidden="true" />
                )}
                <span className="sr-only">{c.ok ? 'Met: ' : 'Not met: '}</span>
                <span className={c.ok ? 'text-muted' : 'text-subtle'}>{c.text}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <details className="mt-4 rounded-[10px] border border-line px-3 py-2">
        <summary className="cursor-pointer text-[13px] font-medium text-fg">How the {result.score} adds up</summary>
        <ul className="mt-2 space-y-2 pb-1">
          {lines.map((l) => (
            <li key={l.part} className="text-[12.5px]">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-medium text-fg">{l.title}</span>
                <span className="tabular-nums text-subtle">
                  {Math.round(l.points)}/{l.weight}
                </span>
              </div>
              <p className="text-muted">{l.reason}</p>
            </li>
          ))}
        </ul>
      </details>

      <p className="mt-3 text-[12.5px] leading-relaxed text-subtle">
        An estimate: maintainer reply time isn't measured here, so it counts as neutral until the nightly collector
        samples it.
        {check.unknown.length > 0 && ` GitHub didn't tell us ${check.unknown.join(' or ')}, so the numbers may be off.`}
      </p>

      {!result.eligible && (
        <p className="mt-3 text-[13px] leading-relaxed text-muted" data-testid="check-failing">
          {onlyStars
            ? `Only the ${MIN_STARS}-star floor fails, and repos added by hand skip it, so it's worth suggesting.`
            : `You can still file it, say if that's about to change, but a maintainer will likely wait until ${n === 1 ? 'it passes' : 'these pass'}: ${result.failedGates.map((g) => GATE_LABELS[g].toLowerCase()).join('; ')}.`}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <a
          href={submitIssueUrl(r.fullName)}
          target="_blank"
          rel="noreferrer"
          className={`${result.eligible || onlyStars ? 'btn-thread' : 'btn-seam'} h-11 px-5`}
          data-testid="file-submission"
        >
          <GitHubMark className="h-4 w-4" />
          File the submission
          <ExternalLink className="h-3.5 w-3.5 opacity-70" aria-hidden="true" />
        </a>
        <span className="text-xs text-subtle">Opens a prefilled issue on GitHub.</span>
      </div>
    </div>
  );
}

function CheckError({
  fullName,
  error,
  onRetry,
  onSettings,
}: {
  fullName: string;
  error: RepoCheckError;
  onRetry: () => void;
  onSettings: () => void;
}) {
  const title =
    error.kind === 'not-found'
      ? `Couldn't find ${fullName}`
      : error.kind === 'rate-limit'
        ? 'GitHub needs a breather'
        : "Couldn't check the repo";
  return (
    <div className="rounded-[12px] border border-warn/40 bg-warn/[0.06] p-4" role="alert" data-testid="check-error">
      <p className="text-sm font-semibold text-fg">{title}</p>
      <p className="mt-1 text-sm text-muted">{error.message}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {error.kind !== 'not-found' && (
          <button type="button" className="btn-seam h-10 px-3.5" onClick={onRetry}>
            <RotateCcw className="h-4 w-4" aria-hidden="true" /> Try again
          </button>
        )}
        {(error.kind === 'rate-limit' || error.kind === 'auth') && (
          <button type="button" className="btn-ghost" onClick={onSettings}>
            <Settings className="h-4 w-4" aria-hidden="true" /> Settings
          </button>
        )}
        {error.kind === 'rate-limit' && (
          <a href={submitIssueUrl(fullName)} target="_blank" rel="noreferrer" className="btn-ghost">
            File it without the check <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Explainer (the pre-rendered page's content)                          */
/* ------------------------------------------------------------------ */

function HowListingWorks() {
  const steps: { title: string; body: ReactNode }[] = [
    {
      title: 'Every night, automatically',
      body: (
        <>
          A GitHub Action searches GitHub for active repos with good first issues in every supported language, scores
          them and opens a pull request with the updated dataset. A maintainer reviews and merges it.
        </>
      ),
    },
    {
      title: 'By suggestion',
      body: (
        <>
          The check above files a <span className="font-medium text-fg">Submit a repo</span> issue. Once it's accepted,
          the repo goes into{' '}
          <a href={CURATION_URL} target="_blank" rel="noreferrer" className={LINK}>
            data/curation.yml
          </a>
          , is fetched every night from then on and skips the {MIN_STARS}-star floor.
        </>
      ),
    },
    {
      title: 'By pull request',
      body: (
        <>
          Anyone can edit <code className="font-mono text-[0.9em]">data/curation.yml</code> to include, exclude or
          re-categorise a repo. The{' '}
          <a href={CONTRIBUTING_URL} target="_blank" rel="noreferrer" className={LINK}>
            contributing guide
          </a>{' '}
          explains how.
        </>
      ),
    },
  ];
  return (
    <section className="seam-t mt-14 pt-8" aria-labelledby="how-title">
      <h2 id="how-title" className="font-display text-[1.7rem] font-[560] tracking-[-0.02em] sm:text-[2rem]">
        How repos get listed
      </h2>
      <p className="mt-1 max-w-2xl text-pretty text-sm text-muted">
        No paid listings: a repo is in the directory because it scores well. Changes show up after the next nightly run.
      </p>
      <ol className="mt-5 grid gap-3 md:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s.title} className="rounded-[14px] border border-line bg-surface/50 p-4">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-fg text-[13px] font-semibold text-bg">
              {i + 1}
            </span>
            <h3 className="mt-3 font-display text-[18px] font-[560] tracking-[-0.01em]">{s.title}</h3>
            <p className="mt-1 text-[13.5px] leading-relaxed text-muted">{s.body}</p>
          </li>
        ))}
      </ol>

      <div className="mt-8 grid gap-6 md:grid-cols-2">
        <div>
          <h3 className="font-display text-[20px] font-[560] tracking-[-0.01em]">What keeps a repo out</h3>
          <ul className="mt-2 space-y-1.5 text-[13.5px] text-muted" data-testid="listing-rules">
            {GATES.map((g) => (
              <li key={g} className="flex items-start gap-2">
                <CircleX className="mt-0.5 h-4 w-4 shrink-0 text-subtle" aria-hidden="true" />
                <span>
                  {GATE_LABELS[g]}
                  {g === 'stars' && ' (unless added by hand)'}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="font-display text-[20px] font-[560] tracking-[-0.01em]">How the score works</h3>
          <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
            Every listed repo gets a contributor-friendliness score from 0 to 100 for its open good first issues, recent
            commits, how fast maintainers reply, a CONTRIBUTING guide and code of conduct, how many beginner issues are
            still unclaimed, and a little for stars. It is{' '}
            <span className="font-medium text-fg">First-PR friendly</span> at 60 or more, with at least 3 good first
            issues, a CONTRIBUTING guide and replies within 3 days.
          </p>
          <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[13.5px]">
            <a href={SCORING_URL} target="_blank" rel="noreferrer" className={`inline-flex items-center gap-1 ${LINK}`}>
              The full formula <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
            <a
              href={CONTRIBUTING_URL}
              target="_blank"
              rel="noreferrer"
              className={`inline-flex items-center gap-1 ${LINK}`}
            >
              Contributing guide <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
            <a href="mailto:hello@opensrc.studio" className={LINK}>
              hello@opensrc.studio
            </a>
          </p>
        </div>
      </div>
    </section>
  );
}
