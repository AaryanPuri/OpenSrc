import { AnimatePresence, motion } from 'framer-motion';
import { Bookmark, CircleCheck, Clock, GitPullRequestArrow, MessageSquare, Star, UserRound } from 'lucide-react';
import { memo, useRef } from 'react';
import type { Theme } from '../hooks/useTheme';
import { LANGUAGES } from '../lib/dictionary';
import { domainFabric, fabricFor, fabricStyle, type Fabric } from '../lib/fabric';
import { whyItFitsText } from '../lib/fit';
import { approachability, compactNumber, dateSignals, labelStyle, plural } from '../lib/format';
import type { ParsedQuery } from '../lib/parseQuery';
import type { Issue } from '../lib/types';
import { NeedleIcon, RepoAvatar } from './icons';

interface Props {
  issue: Issue;
  theme: Theme;
  saved: boolean;
  onToggleSave: (issue: Issue, from: DOMRect | null) => void;
  parsed: ParsedQuery | null;
  /** Language to display when the payload doesn't carry one (e.g. the single language filter). */
  fallbackLanguage?: string | null;
  /** Offline / sample mode: never request remote avatars. */
  offline?: boolean;
}

function languageColor(name?: string | null) {
  if (!name) return undefined;
  const n = name.toLowerCase();
  return LANGUAGES.find((l) => l.label.toLowerCase() === n || l.qualifier === n)?.color ?? '#8b8b94';
}

/** Card selvage: the matched field's fabric if we know it, otherwise a stable fabric per repo. */
function cardFabric(issue: Issue, parsed: ParsedQuery | null): Fabric {
  const text = `${issue.title} ${issue.body} ${(issue.repo.topics ?? []).join(' ')}`.toLowerCase();
  const hit = parsed?.domains.find((d) => text.includes(d.term.replace(/"/g, '').toLowerCase().replace(/s$/, '')));
  if (hit) return domainFabric(hit.id);
  if (parsed?.domains.length === 1) return domainFabric(parsed.domains[0].id);
  return fabricFor(issue.repo.fullName);
}

const LEVEL = {
  high: { bar: 'bg-accent', text: 'text-accent' },
  medium: { bar: 'bg-indigo', text: 'text-indigo' },
  low: { bar: 'bg-subtle', text: 'text-muted' },
} as const;

function ApproachMeter({ issue }: { issue: Issue }) {
  const a = approachability(issue);
  const filled = Math.max(1, Math.round(a.score / 20));
  const s = LEVEL[a.level];
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5"
      title={`${a.label} (${a.score}/100)${a.reasons.length ? `: ${a.reasons.join(', ')}` : ''}`}
      data-testid="approachability"
    >
      {/* Five stitches, filled by approachability */}
      <span className="flex items-center gap-[3px]" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i} className={`h-[3px] w-[7px] rounded-full ${i < filled ? s.bar : 'bg-line'}`} />
        ))}
      </span>
      <span className={`whitespace-nowrap text-xs font-semibold ${s.text}`}>{a.label}</span>
      <span className="sr-only">, approachability score {a.score} out of 100</span>
    </span>
  );
}

/** Availability, shown only when the server actually checked (never guessed). */
function LinkedPr({ linked }: { linked: boolean | undefined }) {
  if (linked === undefined) return null;
  return linked ? (
    <li
      className="inline-flex h-[22px] items-center gap-1 rounded-full bg-warn/15 px-2 text-[12px] font-semibold text-warn"
      title="An open pull request already references this issue"
      data-testid="availability"
    >
      <GitPullRequestArrow className="h-3.5 w-3.5" aria-hidden="true" />
      PR in progress
    </li>
  ) : (
    <li
      className="inline-flex h-[22px] items-center gap-1 rounded-full bg-[rgb(var(--ok)/0.12)] px-2 text-[12px] font-semibold text-[rgb(var(--ok))]"
      title="No open pull request is linked to this issue yet"
      data-testid="availability"
    >
      <CircleCheck className="h-3.5 w-3.5" aria-hidden="true" />
      No linked PR
    </li>
  );
}

export const IssueCard = memo(function IssueCard({
  issue,
  theme,
  saved,
  onToggleSave,
  parsed,
  fallbackLanguage,
  offline,
}: Props) {
  const language = issue.repo.language ?? fallbackLanguage ?? null;
  const dates = dateSignals(issue);
  const titleId = `issue-${issue.id}`;
  const fabric = cardFabric(issue, parsed);
  const saveBtn = useRef<HTMLButtonElement>(null);
  const extraLabels = Math.max(0, issue.labels.length - 3);
  const why = whyItFitsText(issue, parsed);

  return (
    <article
      aria-labelledby={titleId}
      className="paper group/card relative overflow-hidden transition-shadow duration-200 focus-within:shadow-lift hover:shadow-lift"
      data-testid="result-card"
    >
      {/* Fabric selvage + a hairline seam: every result is a patch in the quilt */}
      <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[7px]" style={fabricStyle(fabric, 0.5)} />
      <span aria-hidden="true" className="absolute inset-y-0 left-[7px] border-l border-line" />

      <div className="py-4 pl-6 pr-4 sm:py-5 sm:pl-8 sm:pr-5">
        {/* 1. Title + issue number */}
        <div className="flex items-start gap-3">
          <h3
            id={titleId}
            className="min-w-0 flex-1 text-[16px] font-semibold leading-snug tracking-[-0.01em] text-fg sm:text-[17px]"
          >
            <a
              href={issue.htmlUrl}
              target="_blank"
              rel="noreferrer"
              className="outline-none after:absolute after:inset-0 after:rounded-[14px] focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-accent"
            >
              {issue.title}
            </a>
            {issue.number && (
              <span className="ml-1.5 whitespace-nowrap font-normal tabular-nums text-subtle">#{issue.number}</span>
            )}
          </h3>
          <SaveButton
            saved={saved}
            title={issue.title}
            btnRef={saveBtn}
            onClick={() => onToggleSave(issue, saveBtn.current?.getBoundingClientRect() ?? null)}
          />
        </div>

        {/* 2. Why it fits + approachability, on one line (the reason truncates) */}
        <div className="mt-1.5 flex items-center gap-3">
          <p className="flex min-w-0 flex-1 items-center gap-1.5 text-[13.5px] text-muted" title={why}>
            <NeedleIcon className="h-3.5 w-3.5 shrink-0 text-accent" />
            <span className="truncate">
              <span className="sr-only">Why this fits you: </span>
              {why}
            </span>
          </p>
          <ApproachMeter issue={issue} />
        </div>

        {/* 3. Repo + meta, merged into one line */}
        <div className="mt-3 flex min-w-0 items-center gap-x-2 whitespace-nowrap text-[12.5px] text-subtle sm:gap-x-2.5">
          <RepoAvatar owner={issue.repo.owner} offline={offline || issue.sample} />
          <a
            href={issue.repo.htmlUrl}
            target="_blank"
            rel="noreferrer"
            className="relative z-10 -my-3.5 min-w-0 truncate py-3.5 text-muted transition-colors hover:text-fg"
          >
            <span className="text-subtle">{issue.repo.owner}/</span>
            <span className="font-semibold text-fg/90">{issue.repo.name}</span>
          </a>
          {typeof issue.repo.stars === 'number' && (
            <span className="inline-flex shrink-0 items-center gap-1">
              <Star className="h-3 w-3" aria-hidden="true" />
              <span className="sr-only">Stars:</span>
              {compactNumber(issue.repo.stars)}
            </span>
          )}
          {language && (
            <span className="inline-flex shrink-0 items-center gap-1.5">
              <span
                className="h-2.5 w-2.5 rounded-full ring-1 ring-inset ring-black/10"
                style={{ backgroundColor: languageColor(language) }}
                aria-hidden="true"
              />
              <span className="hidden sm:inline">{language}</span>
              <span className="sr-only sm:hidden">{language}</span>
            </span>
          )}
          <span className="inline-flex shrink-0 items-center gap-1" title={plural(issue.comments, 'comment')}>
            <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
            {issue.comments}
            <span className="sr-only"> {issue.comments === 1 ? 'comment' : 'comments'}</span>
          </span>
          <span
            className={`inline-flex shrink-0 items-center gap-1 ${dates.stale ? 'font-semibold text-warn' : ''}`}
            title={[
              `Opened ${dates.opened}`,
              dates.active && `active ${dates.active}`,
              dates.stale && 'no activity for over six months',
            ]
              .filter(Boolean)
              .join(', ')}
            data-testid="trust-badge"
          >
            {dates.stale && <Clock className="h-3 w-3" aria-hidden="true" />}
            <time dateTime={issue.createdAt}>
              <span className="sm:hidden">opened {dates.openedShort}</span>
              <span className="hidden sm:inline">opened {dates.opened}</span>
            </time>
            {dates.active && (
              // Secondary: on phones it lives in the tooltip / screen-reader text only.
              <time dateTime={issue.updatedAt}>
                <span className="hidden sm:inline"> · active {dates.active}</span>
                <span className="sr-only sm:hidden">, active {dates.active}</span>
              </time>
            )}
            {dates.stale && <span className="sr-only">(no activity for over six months)</span>}
          </span>
        </div>

        {/* 4. Availability + at most three labels */}
        {(issue.labels.length > 0 || issue.linkedPr !== undefined || issue.assigned) && (
          <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Status and labels">
            {issue.assigned && (
              <li
                className="inline-flex h-[22px] items-center gap-1 rounded-full bg-fg/[0.08] px-2 text-[12px] font-semibold text-muted"
                title="Someone is assigned to this issue: ask before starting on it"
                data-testid="assigned"
              >
                <UserRound className="h-3.5 w-3.5" aria-hidden="true" />
                Assigned
              </li>
            )}
            <LinkedPr linked={issue.linkedPr} />
            {issue.labels.slice(0, 3).map((l) => (
              <li
                key={l.name}
                className="inline-flex h-[22px] max-w-[14rem] items-center rounded-full border px-2 text-[12px] font-medium"
                style={labelStyle(l.color, theme)}
              >
                <span className="truncate">{l.name}</span>
              </li>
            ))}
            {extraLabels > 0 && (
              <li className="inline-flex h-[22px] items-center text-[12px] text-subtle">+{extraLabels} more</li>
            )}
          </ul>
        )}
      </div>
    </article>
  );
});

function SaveButton({
  saved,
  title,
  onClick,
  btnRef,
}: {
  saved: boolean;
  title: string;
  onClick: () => void;
  btnRef: React.RefObject<HTMLButtonElement>;
}) {
  return (
    <motion.button
      ref={btnRef}
      type="button"
      onClick={onClick}
      whileTap={{ scale: 0.85 }}
      aria-pressed={saved}
      aria-label={saved ? `Remove “${title}” from saved` : `Save “${title}”`}
      className={`relative z-10 -mr-2 -mt-2 grid h-11 w-11 shrink-0 place-items-center rounded-[10px] transition-colors ${
        saved ? 'text-accent hover:bg-accent/10' : 'text-subtle hover:bg-fg/[0.06] hover:text-fg'
      }`}
      data-testid="save-button"
    >
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={String(saved)}
          initial={{ scale: saved ? 0.2 : 0.8, rotate: saved ? -30 : 0 }}
          animate={{ scale: 1, rotate: 0 }}
          exit={{ scale: 0.5, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 600, damping: 14 }}
          className="grid place-items-center"
        >
          <Bookmark className="h-[18px] w-[18px]" fill={saved ? 'currentColor' : 'none'} aria-hidden="true" />
        </motion.span>
      </AnimatePresence>
    </motion.button>
  );
}
