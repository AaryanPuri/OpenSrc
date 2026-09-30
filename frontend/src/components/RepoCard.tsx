import { AnimatePresence, motion } from 'framer-motion';
import { Bookmark, CircleCheck, MessageSquareReply, Star } from 'lucide-react';
import { memo, useRef } from 'react';
import { Link } from 'react-router';
import type { RepoRecord } from '../../../shared/repo';
import { claimableGfis } from '../../../shared/repoFilter';
import { FIRST_PR_MIN_SCORE } from '../../../shared/score';
import { fabricStyle } from '../lib/fabric';
import { compactNumber, replyTime, snapshotNote, welcomeIssues } from '../lib/format';
import { committedAgo, fieldLabel, languageColor, repoFabric, repoPath } from '../lib/repoDisplay';
import { FieldBadge } from './FieldBadge';
import { NeedleIcon, RepoAvatar } from './icons';
import { ScoreStitches } from './ScoreStitches';

interface Props {
  repo: RepoRecord;
  /** The dataset's generatedAt: ages are measured from it, so server and browser agree. */
  now: number;
  saved: boolean;
  onToggleSave: (repo: RepoRecord, from: DOMRect | null) => void;
  /** Carried to the repo page, whose live issues honour the issue-level part of the search. */
  search?: string;
  /** Sample / offline mode: no remote avatars. */
  offline?: boolean;
  /** First-PR mode: the stat line leads with unclaimed good first issues and reply time. */
  firstPr?: boolean;
}

/** "First-PR friendly": a basted-on ribbon (the dashed stitch reserved for signature spots). */
export function FirstPrRibbon({ className = '' }: { className?: string }) {
  return (
    <span
      className={`stitch inline-flex h-6 shrink-0 items-center gap-1 rounded-full bg-accent/[0.08] px-2 text-[12px] font-semibold text-accent ${className}`}
      title={`Unclaimed good first issues, a CONTRIBUTING guide, maintainers who reply, and a score of ${FIRST_PR_MIN_SCORE}+`}
      data-testid="first-pr-ribbon"
    >
      <NeedleIcon className="h-3.5 w-3.5" />
      First-PR friendly
    </span>
  );
}

export const RepoCard = memo(function RepoCard({
  repo,
  now,
  saved,
  onToggleSave,
  search = '',
  offline,
  firstPr = false,
}: Props) {
  const saveBtn = useRef<HTMLButtonElement>(null);
  const titleId = `repo-${repo.fullName.replace(/[^a-z0-9]/gi, '-')}`;
  const fabric = repoFabric(repo);
  const lang = repo.languageName;

  return (
    <article
      aria-labelledby={titleId}
      className="paper group/card relative flex h-full flex-col overflow-hidden transition-[box-shadow,transform] duration-200 ease-out focus-within:shadow-lift hover:-translate-y-0.5 hover:shadow-lift"
      data-testid="repo-card"
    >
      {/* Selvage in the primary field's fabric, and a faint weave of it behind the header. */}
      <span aria-hidden="true" className="absolute inset-x-0 top-0 h-[6px]" style={fabricStyle(fabric, 0.5)} />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-6 -top-6 h-36 w-52 opacity-[0.13] transition-opacity duration-300 group-hover/card:opacity-20"
        style={{
          ...fabricStyle(fabric, 1.1),
          maskImage: 'radial-gradient(closest-side, #000 30%, transparent)',
          WebkitMaskImage: 'radial-gradient(closest-side, #000 30%, transparent)',
        }}
      />

      <div className="relative flex flex-1 flex-col px-4 pb-4 pt-5 sm:px-5">
        {/* 1. Avatar, owner/name, save */}
        <div className="flex items-start gap-3">
          <RepoAvatar owner={repo.owner} size={40} offline={offline} />
          <h3 id={titleId} className="min-w-0 flex-1 pt-0.5 leading-tight">
            <Link
              to={repoPath(repo.fullName, search)}
              className="outline-none after:absolute after:inset-0 after:rounded-[14px] focus-visible:after:outline focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-accent"
            >
              <span className="block truncate text-[13px] text-subtle">{repo.owner}/</span>
              <span className="block truncate font-display text-[19px] font-[560] tracking-[-0.01em] text-fg">
                {repo.name}
              </span>
            </Link>
          </h3>
          <SaveRepoButton
            saved={saved}
            name={repo.fullName}
            btnRef={saveBtn}
            onClick={() => onToggleSave(repo, saveBtn.current?.getBoundingClientRect() ?? null)}
          />
        </div>

        {/* 2. Description */}
        <p className="mt-2.5 line-clamp-2 min-h-[2.6em] text-pretty text-[14px] leading-[1.3] text-muted">
          {repo.description ?? <span className="italic text-subtle">No description</span>}
        </p>

        {/* 3. The stat line. First-PR mode: unclaimed good first issues, big, and reply time.
            Otherwise: good first issues, big; contributions welcome, small. */}
        {firstPr ? (
          <div className="mt-3.5 flex flex-wrap items-center gap-x-2.5 gap-y-2">
            <span className="patch h-9 gap-2 px-2.5" data-testid="gfi-tag" title={`Counted ${snapshotNote(now)}`}>
              <span className="font-display text-[20px] font-[600] leading-none tabular-nums text-accent">
                {claimableGfis(repo)}
              </span>
              <span className="text-[13px] leading-tight">
                unclaimed good first {claimableGfis(repo) === 1 ? 'issue' : 'issues'}
              </span>
            </span>
            {repo.responseHours !== null && (
              <span
                className="inline-flex items-center gap-1 text-[12.5px] text-subtle"
                title="Median time until a maintainer first replies"
              >
                <MessageSquareReply className="h-3.5 w-3.5" aria-hidden="true" />
                replies in {replyTime(repo.responseHours)}
              </span>
            )}
          </div>
        ) : (
          <div className="mt-3.5 flex flex-wrap items-center gap-x-2.5 gap-y-2">
            <span className="patch h-9 gap-2 px-2.5" data-testid="gfi-tag" title={`Counted ${snapshotNote(now)}`}>
              <span className="font-display text-[20px] font-[600] leading-none tabular-nums text-accent">
                {repo.goodFirstIssues}
              </span>
              <span className="text-[13px] leading-tight">
                good first {repo.goodFirstIssues === 1 ? 'issue' : 'issues'}
              </span>
            </span>
            {repo.helpWanted > 0 && (
              <span className="text-[12.5px] text-subtle" title={`Counted ${snapshotNote(now)}`}>
                +
                {repo.helpWanted === 1
                  ? welcomeIssues(1)
                  : `${repo.helpWanted.toLocaleString('en')} contributions welcome`}
              </span>
            )}
          </div>
        )}

        {/* 4. Meta */}
        <ul
          className="mt-3.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12.5px] text-subtle"
          aria-label="Repo facts"
        >
          {lang && (
            <li className="inline-flex items-center gap-1.5">
              <span
                className="h-2.5 w-2.5 rounded-full ring-1 ring-inset ring-black/10"
                style={{ backgroundColor: languageColor(repo.language) }}
                aria-hidden="true"
              />
              {lang}
            </li>
          )}
          {repo.fields.slice(0, 2).map((id) => (
            <li key={id} className="inline-flex items-center gap-1.5" title={fieldLabel(id)}>
              <FieldBadge id={id} />
              <span className="sr-only">Field: </span>
              <span className="max-w-[8rem] truncate">{fieldLabel(id).replace(/ & .*/, '')}</span>
            </li>
          ))}
          <li className="inline-flex items-center gap-1" title={`${repo.stars.toLocaleString('en')} stars`}>
            <Star className="h-3 w-3" aria-hidden="true" />
            <span className="sr-only">Stars:</span>
            {compactNumber(repo.stars)}
          </li>
          {repo.lastCommitAt && (
            <li>
              <time dateTime={repo.lastCommitAt}>{committedAgo(repo.lastCommitAt, now)}</time>
            </li>
          )}
          {repo.license && repo.license !== 'other' && <li>{repo.license}</li>}
          {repo.contributingUrl && (
            <li className="inline-flex items-center gap-1 text-[rgb(var(--ok))]" title="Has a CONTRIBUTING guide">
              <CircleCheck className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="text-subtle">CONTRIBUTING</span>
            </li>
          )}
          {!firstPr && repo.responseHours !== null && (
            <li className="inline-flex items-center gap-1" title="Median time until a maintainer first replies">
              <MessageSquareReply className="h-3.5 w-3.5" aria-hidden="true" />
              replies in {replyTime(repo.responseHours)}
            </li>
          )}
        </ul>

        {/* 5. Score and the first-PR ribbon */}
        <div className="mt-auto flex min-h-6 flex-wrap items-center gap-x-2 gap-y-2 pt-4">
          <span className="text-[12px] font-medium text-subtle">Score</span>
          <ScoreStitches score={repo.score} />
          {/* In first-PR mode every card qualifies, so the ribbon would only be noise. */}
          {repo.firstPrFriendly && !firstPr && <FirstPrRibbon className="ml-auto" />}
        </div>
      </div>
    </article>
  );
});

function SaveRepoButton({
  saved,
  name,
  onClick,
  btnRef,
}: {
  saved: boolean;
  name: string;
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
      aria-label={saved ? `Remove ${name} from saved` : `Save ${name}`}
      className={`relative z-10 -mr-2 -mt-1.5 grid h-11 w-11 shrink-0 place-items-center rounded-[10px] transition-colors ${
        saved ? 'text-accent hover:bg-accent/10' : 'text-subtle hover:bg-fg/[0.06] hover:text-fg'
      }`}
      data-testid="save-repo"
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

export function RepoCardSkeleton() {
  return (
    <div className="paper relative overflow-hidden px-4 pb-4 pt-5 sm:px-5" aria-hidden="true">
      <span className="absolute inset-x-0 top-0 h-[6px] bg-surface-3" />
      <div className="flex items-center gap-3">
        <div className="skeleton h-10 w-10" />
        <div className="flex-1 space-y-1.5">
          <div className="skeleton h-3 w-20" />
          <div className="skeleton h-4 w-32" />
        </div>
      </div>
      <div className="mt-3 space-y-1.5">
        <div className="skeleton h-3.5 w-full" />
        <div className="skeleton h-3.5 w-3/4" />
      </div>
      <div className="skeleton mt-4 h-9 w-40 rounded-[9px]" />
      <div className="mt-4 flex gap-2.5">
        <div className="skeleton h-3 w-14" />
        <div className="skeleton h-3 w-16" />
        <div className="skeleton h-3 w-10" />
        <div className="skeleton h-3 w-20" />
      </div>
      <div className="skeleton mt-5 h-3 w-36" />
    </div>
  );
}
