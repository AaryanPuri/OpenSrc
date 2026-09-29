import { AnimatePresence, motion } from 'framer-motion';
import { Bookmark, ExternalLink, Search, Star, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Link } from 'react-router';
import type { SavedIssue, SavedRepo, SavedSearch } from '../hooks/useSaved';
import { fabricFor, fabricStyle } from '../lib/fabric';
import { compactNumber, plural, timeAgo } from '../lib/format';
import type { Issue } from '../lib/types';
import { RepoAvatar } from './icons';

interface Props {
  open: boolean;
  onClose: () => void;
  saved: SavedIssue[];
  savedRepos: SavedRepo[];
  savedSearches: SavedSearch[];
  onRemove: (i: Issue) => void;
  onRemoveRepo: (fullName: string) => void;
  onRemoveSearch: (s: SavedSearch) => void;
  onClear: () => void;
  /** Signed in: saves sync to the account instead of staying in this browser. */
  synced?: boolean;
}

type Tab = 'repos' | 'issues' | 'searches';
const TABS: { id: Tab; label: string }[] = [
  { id: 'repos', label: 'Repos' },
  { id: 'issues', label: 'Issues' },
  { id: 'searches', label: 'Searches' },
];
const EMPTY: Record<Tab, string> = {
  repos: 'Bookmark a repo from the directory or its page.',
  issues: 'Bookmark an issue from a repo page or the issue search.',
  searches: 'Use “Save search” above your results to keep a search here.',
};

const list = { show: { transition: { staggerChildren: 0.05, delayChildren: 0.12 } } };
const item = {
  hidden: { x: 36, rotate: 2 },
  show: { x: 0, rotate: 0, transition: { type: 'spring' as const, stiffness: 420, damping: 30 } },
};

export function SavedDrawer({
  open,
  onClose,
  saved,
  savedRepos,
  savedSearches,
  onRemove,
  onRemoveRepo,
  onRemoveSearch,
  onClear,
  synced = false,
}: Props) {
  const total = saved.length + savedRepos.length + savedSearches.length;
  const counts: Record<Tab, number> = {
    repos: savedRepos.length,
    issues: saved.length,
    searches: savedSearches.length,
  };
  const [tab, setTab] = useState<Tab>('repos');
  // Opening the drawer shows the first tab with something in it.
  useEffect(() => {
    if (!open) return;
    setTab((t) => (counts[t] > 0 ? t : (TABS.find((x) => counts[x.id] > 0)?.id ?? 'repos')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const onTabKey = (e: ReactKeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const i = TABS.findIndex((t) => t.id === tab);
    const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length].id;
    setTab(next);
    document.getElementById(`saved-tab-${next}`)?.focus();
  };
  const panel = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreTo.current = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => closeBtn.current?.focus(), 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key !== 'Tab' || !panel.current) return;
      const els = panel.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled])');
      if (!els.length) return;
      const first = els[0];
      const last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      restoreTo.current?.focus?.();
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50">
          <motion.div
            className="absolute inset-0 bg-[#120f1f]/55"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            aria-hidden="true"
          />
          <motion.div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-labelledby="saved-title"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 340, damping: 34 }}
            className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l border-line bg-bg shadow-pop"
            data-testid="saved-drawer"
          >
            <div className="seam-b flex h-16 shrink-0 items-center gap-2.5 px-4">
              <Bookmark className="h-4 w-4 text-accent" aria-hidden="true" />
              <h2 id="saved-title" className="font-display text-xl font-[560]">
                Your shortlist
              </h2>
              <span className="text-sm tabular-nums text-muted">{total}</span>
              <div className="ml-auto flex items-center gap-1">
                {total > 0 && (
                  <button type="button" className="btn-ghost text-xs" onClick={onClear}>
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Clear
                  </button>
                )}
                <button
                  ref={closeBtn}
                  type="button"
                  className="icon-btn"
                  onClick={onClose}
                  aria-label="Close saved items"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div
              role="tablist"
              aria-label="Saved items"
              className="seam-b flex shrink-0 gap-1 px-3"
              onKeyDown={onTabKey}
            >
              {TABS.map((t) => (
                <button
                  key={t.id}
                  id={`saved-tab-${t.id}`}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.id}
                  aria-controls="saved-panel"
                  tabIndex={tab === t.id ? 0 : -1}
                  onClick={() => setTab(t.id)}
                  className={`nav-link inline-flex h-11 items-center gap-1.5 px-3 text-[14px] ${tab === t.id ? 'is-active text-fg' : 'text-muted hover:text-fg'}`}
                  data-testid={`saved-tab-${t.id}`}
                >
                  {t.label}
                  <span className="tabular-nums text-subtle">{counts[t.id]}</span>
                </button>
              ))}
            </div>

            <div
              id="saved-panel"
              role="tabpanel"
              aria-labelledby={`saved-tab-${tab}`}
              className="flex-1 overflow-y-auto p-4"
            >
              {counts[tab] === 0 ? (
                <div className="flex h-full flex-col items-center justify-center px-8 text-center">
                  <span className="grid h-14 w-14 place-items-center rounded-[14px] border border-line-strong text-subtle">
                    <Bookmark className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <p className="mt-4 font-display text-lg font-[560]">Nothing pinned yet</p>
                  <p className="mt-1 text-sm text-muted">
                    {EMPTY[tab]} {synced ? 'They sync to your account.' : 'They stay in this browser.'}
                  </p>
                </div>
              ) : tab === 'repos' ? (
                <motion.ul className="space-y-2.5" variants={list} initial="hidden" animate="show">
                  <AnimatePresence initial={false}>
                    {savedRepos.map((r) => (
                      <motion.li
                        key={r.fullName}
                        layout
                        variants={item}
                        exit={{ x: 60, rotate: 6, opacity: 0, transition: { duration: 0.2 } }}
                        className="paper relative overflow-hidden py-3 pl-6 pr-3"
                        data-testid="saved-repo"
                      >
                        <span
                          aria-hidden="true"
                          className="absolute inset-y-0 left-0 w-[6px]"
                          style={fabricStyle(fabricFor(r.fullName), 0.45)}
                        />
                        <Link
                          to={`/repo/${r.fullName}`}
                          onClick={onClose}
                          className="flex items-center gap-2 text-[15px] font-semibold leading-snug hover:text-accent"
                        >
                          <RepoAvatar owner={r.owner} size={20} />
                          <span className="min-w-0 truncate">
                            <span className="font-normal text-subtle">{r.owner}/</span>
                            {r.fullName.slice(r.owner.length + 1)}
                          </span>
                        </Link>
                        {r.description && (
                          <p className="mt-1 line-clamp-2 text-[13px] leading-snug text-muted">{r.description}</p>
                        )}
                        <div className="mt-1 flex items-center gap-3 text-xs text-subtle">
                          <span className="inline-flex items-center gap-1">
                            <Star className="h-3 w-3" aria-hidden="true" />
                            {compactNumber(r.stars)}
                          </span>
                          <span>{plural(r.goodFirstIssues, 'good first issue')}</span>
                          <button
                            type="button"
                            className="ml-auto min-h-11 rounded-md px-2 text-xs font-medium text-muted hover:bg-fg/[0.06] hover:text-fg sm:min-h-8"
                            onClick={() => onRemoveRepo(r.fullName)}
                            aria-label={`Remove ${r.fullName}`}
                          >
                            Remove
                          </button>
                        </div>
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </motion.ul>
              ) : tab === 'issues' ? (
                <motion.ul className="space-y-2.5" variants={list} initial="hidden" animate="show">
                  <AnimatePresence initial={false}>
                    {saved.map((i) => (
                      <motion.li
                        key={`${i.id}:${i.htmlUrl}`}
                        layout
                        variants={item}
                        exit={{ x: 60, rotate: 6, opacity: 0, transition: { duration: 0.2 } }}
                        className="paper relative overflow-hidden py-3 pl-6 pr-3"
                        data-testid="saved-item"
                      >
                        <span
                          aria-hidden="true"
                          className="absolute inset-y-0 left-0 w-[6px]"
                          style={fabricStyle(fabricFor(i.repo.fullName), 0.45)}
                        />
                        <div className="flex items-center gap-2 text-xs text-subtle">
                          <RepoAvatar owner={i.repo.owner} size={16} offline={i.sample} />
                          <span className="truncate">{i.repo.fullName}</span>
                          <span className="ml-auto shrink-0">saved {timeAgo(i.savedAt)}</span>
                        </div>
                        <a
                          href={i.htmlUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1.5 flex items-start gap-1.5 text-[15px] font-semibold leading-snug hover:text-accent"
                        >
                          <span className="flex-1">{i.title}</span>
                          <ExternalLink className="mt-1 h-3.5 w-3.5 shrink-0 text-subtle" aria-hidden="true" />
                        </a>
                        <div className="mt-1 flex items-center justify-between">
                          <span className="text-xs text-subtle">
                            {plural(i.comments, 'comment')}
                            {i.sample ? ' · sample' : ''}
                          </span>
                          <button
                            type="button"
                            className="min-h-11 rounded-md px-2 text-xs font-medium text-muted hover:bg-fg/[0.06] hover:text-fg sm:min-h-8"
                            onClick={() => onRemove(i)}
                            aria-label={`Remove “${i.title}”`}
                          >
                            Remove
                          </button>
                        </div>
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </motion.ul>
              ) : (
                <ul className="space-y-2.5">
                  {savedSearches.map((s) => (
                    <li
                      key={`${s.scope}:${s.q}`}
                      className="paper relative overflow-hidden py-3 pl-6 pr-3"
                      data-testid="saved-search"
                    >
                      <span
                        aria-hidden="true"
                        className="absolute inset-y-0 left-0 w-[6px]"
                        style={fabricStyle(fabricFor(s.q), 0.45)}
                      />
                      <Link
                        to={`${s.scope === 'issues' ? '/issues' : '/'}?q=${encodeURIComponent(s.q)}`}
                        onClick={onClose}
                        className="flex items-center gap-2 text-[15px] font-semibold leading-snug hover:text-accent"
                      >
                        <Search className="h-3.5 w-3.5 shrink-0 text-subtle" aria-hidden="true" />
                        <span className="min-w-0 truncate">{s.q}</span>
                      </Link>
                      <div className="mt-1 flex items-center gap-3 text-xs text-subtle">
                        <span>{s.scope === 'issues' ? 'Issue search' : 'Repo search'}</span>
                        <span>saved {timeAgo(s.savedAt)}</span>
                        <button
                          type="button"
                          className="ml-auto min-h-11 rounded-md px-2 text-xs font-medium text-muted hover:bg-fg/[0.06] hover:text-fg sm:min-h-8"
                          onClick={() => onRemoveSearch(s)}
                          aria-label={`Remove saved search “${s.q}”`}
                        >
                          Remove
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
