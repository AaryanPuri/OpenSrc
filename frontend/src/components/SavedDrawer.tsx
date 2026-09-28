import { AnimatePresence, motion } from 'framer-motion';
import { Bookmark, ExternalLink, Trash2, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { SavedIssue } from '../hooks/useSaved';
import { fabricFor, fabricStyle } from '../lib/fabric';
import { plural, timeAgo } from '../lib/format';
import type { Issue } from '../lib/types';
import { RepoAvatar } from './icons';

interface Props {
  open: boolean;
  onClose: () => void;
  saved: SavedIssue[];
  onRemove: (i: Issue) => void;
  onClear: () => void;
}

const list = { show: { transition: { staggerChildren: 0.05, delayChildren: 0.12 } } };
const item = {
  hidden: { x: 36, rotate: 2 },
  show: { x: 0, rotate: 0, transition: { type: 'spring' as const, stiffness: 420, damping: 30 } },
};

export function SavedDrawer({ open, onClose, saved, onRemove, onClear }: Props) {
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
              <span className="text-sm tabular-nums text-muted">{saved.length}</span>
              <div className="ml-auto flex items-center gap-1">
                {saved.length > 0 && (
                  <button type="button" className="btn-ghost text-xs" onClick={onClear}>
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Clear
                  </button>
                )}
                <button
                  ref={closeBtn}
                  type="button"
                  className="icon-btn"
                  onClick={onClose}
                  aria-label="Close saved issues"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {saved.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center px-8 text-center">
                  <span className="grid h-14 w-14 place-items-center rounded-[14px] border border-line-strong text-subtle">
                    <Bookmark className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <p className="mt-4 font-display text-lg font-[560]">Nothing pinned yet</p>
                  <p className="mt-1 text-sm text-muted">
                    Bookmark issues from your results to build a shortlist. They stay in this browser.
                  </p>
                </div>
              ) : (
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
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
