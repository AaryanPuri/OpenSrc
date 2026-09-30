import { motion } from 'framer-motion';
import { useEntrance } from '../hooks/useEntrance';
import { ArrowDown } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { RepoRecord } from '../../../shared/repo';
import type { DatasetStatus } from '../data/dataset';
import { useShell } from '../hooks/useShell';
import { plural } from '../lib/format';
import { LIST_PAGE } from '../lib/listPages';
import type { Chip } from '../lib/parseQuery';
import { RepoCard, RepoCardSkeleton } from './RepoCard';
import { EmptyState, ErrorState } from './ResultStates';

export const GRID_PAGE = LIST_PAGE;

interface Props {
  repos: RepoRecord[];
  /**
   * How many repos the whole list has, when `repos` is only its first page (a
   * pre-rendered slice, until the full index arrives). Defaults to repos.length.
   */
  total?: number;
  status: DatasetStatus;
  /** Epoch ms of the dataset's generatedAt. */
  now: number;
  /** Patches offered for unpicking when nothing matches. */
  chips?: Chip[];
  onRemoveChip?: (c: Chip) => void;
  /** Shown in the empty state instead of chips (e.g. "Show all repos" when only a switch narrows it). */
  emptyAction?: React.ReactNode;
  onRetry?: () => void;
  /** Appended to each repo link (`?q=…`), so repo pages can seed their issue search. */
  search?: string;
  /** Changes when the result set does (a new search), so the list starts from the top again. */
  resetKey?: string;
  offline?: boolean;
  /** First-PR mode: cards lead with unclaimed good first issues. */
  firstPr?: boolean;
}

/** The grid heading's count: "12 projects", or "3 first-PR friendly repos" with the toggle on. */
export function GridCount({ total, first }: { total: number; first: boolean }) {
  return (
    <>
      <span className="tabular-nums" data-testid="repo-count">
        {total.toLocaleString('en')}
      </span>{' '}
      {first ? `first-PR friendly ${total === 1 ? 'repo' : 'repos'}` : total === 1 ? 'project' : 'projects'}
    </>
  );
}

const GRID = 'grid grid-cols-1 gap-3.5 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3';

/** Responsive grid of repo cards: 30 at a time, then "Sew more rows". */
export function RepoGrid({
  repos,
  total = repos.length,
  status,
  now,
  chips = [],
  onRemoveChip,
  emptyAction,
  onRetry,
  search,
  resetKey,
  offline,
  firstPr = false,
}: Props) {
  const enter = useEntrance();
  const { isRepoSaved, onToggleRepoSave } = useShell();
  const [shown, setShown] = useState(GRID_PAGE);
  useEffect(() => setShown(GRID_PAGE), [resetKey]);

  if (status === 'idle' || status === 'loading') {
    return (
      <div className={GRID} data-testid="repo-skeletons">
        {Array.from({ length: 6 }, (_, i) => (
          <RepoCardSkeleton key={i} />
        ))}
      </div>
    );
  }
  if (status === 'error') {
    return (
      <ErrorState
        message="The repo directory didn't load. Check your connection and try again."
        onRetry={onRetry ?? (() => {})}
      />
    );
  }
  if (repos.length === 0) {
    return (
      <EmptyState
        chips={chips}
        onRemove={onRemoveChip ?? (() => {})}
        title="No repo fits every patch"
        body="The directory is hand-sized, so narrow corners run out fast. Unpick a patch to see more:"
        action={emptyAction}
      />
    );
  }

  const visible = repos.slice(0, shown);
  return (
    <>
      <ul className={GRID} data-testid="repo-grid">
        {visible.map((repo, i) => (
          <motion.li
            key={repo.fullName}
            initial={enter({ y: 26, rotate: i % 2 ? 0.5 : -0.5 })}
            animate={{ y: 0, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32, delay: Math.min(i % GRID_PAGE, 8) * 0.045 }}
          >
            <RepoCard
              repo={repo}
              now={now}
              saved={isRepoSaved(repo.fullName)}
              onToggleSave={onToggleRepoSave}
              search={search}
              offline={offline}
              firstPr={firstPr}
            />
          </motion.li>
        ))}
      </ul>
      {total > visible.length && (
        <div className="flex flex-col items-center gap-2 pt-7">
          <button
            type="button"
            className="btn-seam h-11 px-5"
            onClick={() => setShown((n) => n + GRID_PAGE)}
            data-testid="sew-more"
          >
            <ArrowDown className="h-4 w-4" aria-hidden="true" />
            Sew more rows
          </button>
          <p className="text-xs text-subtle">
            Showing {visible.length} of {plural(total, 'repo')}
          </p>
        </div>
      )}
    </>
  );
}
