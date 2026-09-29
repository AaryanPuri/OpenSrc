import { motion } from 'framer-motion';
import { FlaskConical, KeyRound, RotateCcw, Scissors, TriangleAlert, WifiOff, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Chip } from '../lib/parseQuery';
import type { SearchNotice, SortKey } from '../lib/types';
import { ChipGlyph } from './Patches';

/* ---------------- Sort control ---------------- */

const SORTS: { key: SortKey; label: string; short: string }[] = [
  { key: 'best', label: 'Best match', short: 'Best' },
  { key: 'newest', label: 'Newest', short: 'Newest' },
  { key: 'comments', label: 'Fewest comments', short: 'Quietest' },
];

/** Toggle buttons (aria-pressed) in a labelled group: simple, keyboard-native. */
export function SortControl({ value, onChange }: { value: SortKey; onChange: (s: SortKey) => void }) {
  return (
    <div
      role="group"
      aria-label="Sort results"
      className="inline-flex rounded-full bg-fg/[0.06] p-0.5"
      data-testid="sort-control"
    >
      {SORTS.map((s) => {
        const active = s.key === value;
        return (
          <button
            key={s.key}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(s.key)}
            className={`relative h-11 rounded-full px-3.5 text-[13px] font-medium transition-colors sm:h-8 sm:px-3 sm:text-xs ${active ? 'text-bg' : 'text-muted hover:text-fg'}`}
          >
            {active && (
              <motion.span
                layoutId="sort-pill"
                className="absolute inset-0 rounded-full bg-fg"
                transition={{ type: 'spring', stiffness: 480, damping: 36 }}
              />
            )}
            <span className="relative sm:hidden">{s.short}</span>
            <span className="relative hidden sm:inline">{s.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ---------------- Slim notice (sample / rate limit / offline) ---------------- */

function useCountdown(until?: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!until) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [until]);
  if (!until) return null;
  const s = Math.max(0, Math.round((until - now) / 1000));
  return s === 0 ? 'now' : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** One slim, dismissible line: the single place that says "these are sample results". */
export function Notice({
  notice,
  relaxed,
  onOpenSettings,
  onRetry,
  onDismiss,
}: {
  notice?: SearchNotice;
  relaxed?: boolean;
  onOpenSettings: () => void;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const countdown = useCountdown(notice?.resetAt);
  if (!notice) return null;
  const Icon = notice.kind === 'rate-limit' ? TriangleAlert : notice.kind === 'network' ? WifiOff : FlaskConical;
  const lead =
    notice.kind === 'rate-limit'
      ? 'GitHub rate limit reached.'
      : notice.kind === 'network'
        ? 'GitHub is unreachable.'
        : 'Demo mode.';

  return (
    <motion.div
      initial={{ y: -4 }}
      animate={{ y: 0 }}
      role="status"
      className="flex items-center gap-2.5 rounded-[12px] border border-warn/40 bg-warn/[0.08] py-1.5 pl-3 pr-1 text-[13px]"
      data-testid="sample-banner"
    >
      <Icon className="h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
      <p className="min-w-0 flex-1 leading-snug text-muted">
        <span className="font-semibold text-fg">Sample results.</span> {lead}
        {notice.kind === 'rate-limit' && countdown && <span className="text-subtle"> Resets in {countdown}.</span>}
        {relaxed && <span className="text-subtle"> Filters loosened to show the closest samples.</span>}
        <span className="sr-only"> {notice.message}</span>
      </p>
      {notice.kind === 'rate-limit' && (
        <button
          type="button"
          className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-fg hover:bg-fg/[0.06] sm:min-h-8"
          onClick={onOpenSettings}
        >
          <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="hidden sm:inline">Add token</span>
          <span className="sm:hidden">Token</span>
        </button>
      )}
      <button
        type="button"
        className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-fg hover:bg-fg/[0.06] sm:min-h-8"
        onClick={onRetry}
      >
        <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
        {notice.kind === 'demo' ? 'Go live' : 'Retry'}
      </button>
      <button
        type="button"
        className="icon-btn h-11 w-11 shrink-0 sm:h-8 sm:w-8"
        aria-label="Dismiss notice"
        onClick={onDismiss}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </motion.div>
  );
}

/* ---------------- Empty / error ---------------- */

export function EmptyState({
  chips,
  onRemove,
  title = 'Nothing fits every patch yet',
  body = 'Unclaimed issues in a narrow corner are rare. Unpick one patch and there will be more to choose from:',
  action,
}: {
  chips: Chip[];
  onRemove: (c: Chip) => void;
  title?: string;
  body?: string;
  action?: React.ReactNode;
}) {
  const removable = chips.filter((c) => c.kind !== 'qualifier').slice(0, 4);
  return (
    <div
      className="flex flex-col items-center rounded-[16px] border border-line px-6 py-12 text-center"
      data-testid="empty-state"
    >
      <motion.span
        initial={{ rotate: -20, scale: 0.6 }}
        animate={{ rotate: -6, scale: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 14 }}
        className="grid h-14 w-14 place-items-center rounded-[14px] border border-accent/50 bg-accent/[0.07] text-accent"
      >
        <Scissors className="h-6 w-6" aria-hidden="true" />
      </motion.span>
      <h2 className="mt-5 font-display text-2xl font-[560] tracking-[-0.01em]">{title}</h2>
      <p className="mt-2 max-w-sm text-pretty text-sm text-muted">{body}</p>
      {removable.length > 0 && (
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {removable.map((c) => (
            <motion.button
              key={`${c.kind}:${c.id}`}
              type="button"
              whileHover={{ rotate: -2, y: -2 }}
              whileTap={{ scale: 0.95 }}
              className="patch h-11 px-3"
              onClick={() => onRemove(c)}
            >
              <Scissors className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
              <ChipGlyph chip={c} />
              <span>
                without <span className="font-semibold">{c.label}</span>
              </span>
            </motion.button>
          ))}
        </div>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center rounded-[16px] border border-danger/40 px-6 py-12 text-center"
      data-testid="error-state"
    >
      <span className="grid h-12 w-12 place-items-center rounded-[14px] bg-danger/10 text-danger">
        <TriangleAlert className="h-5 w-5" aria-hidden="true" />
      </span>
      <h2 className="mt-4 font-display text-2xl font-[560]">The thread snapped</h2>
      <p className="mt-1.5 max-w-md text-pretty text-sm text-muted">{message}</p>
      <button type="button" className="btn-seam mt-5" onClick={onRetry}>
        <RotateCcw className="h-4 w-4" aria-hidden="true" /> Try again
      </button>
    </div>
  );
}
