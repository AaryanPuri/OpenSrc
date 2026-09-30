import { AnimatePresence, motion } from 'framer-motion';
import { useEntrance } from '../hooks/useEntrance';
import {
  CalendarClock,
  Gauge,
  Hash,
  MessageCircleOff,
  MessagesSquare,
  Sparkles,
  Tag,
  Terminal,
  X,
  Zap,
} from 'lucide-react';
import { forwardRef, useEffect, useRef } from 'react';
import { FieldBadge } from './FieldBadge';
import { KIND_LABEL, type Chip } from '../lib/parseQuery';

/** Small deterministic tilt so a row of patches looks hand-sewn, not typeset. */
function tilt(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return ((Math.abs(h) % 7) - 3) * 0.45;
}

export function ChipGlyph({ chip }: { chip: Pick<Chip, 'kind' | 'id' | 'color'> }) {
  const cls = 'h-3.5 w-3.5 shrink-0';
  switch (chip.kind) {
    case 'domain':
      return <FieldBadge id={chip.id} />;
    case 'language':
      return (
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-inset ring-black/15"
          style={{ backgroundColor: chip.color }}
          aria-hidden="true"
        />
      );
    case 'difficulty':
      return <Gauge className={`${cls} text-accent`} aria-hidden="true" />;
    case 'type':
      return <Tag className={`${cls} text-indigo`} aria-hidden="true" />;
    case 'activity':
      return chip.id === '0' ? (
        <MessageCircleOff className={`${cls} text-indigo`} aria-hidden="true" />
      ) : (
        <MessagesSquare className={`${cls} text-indigo`} aria-hidden="true" />
      );
    case 'recency':
      return <CalendarClock className={`${cls} text-indigo`} aria-hidden="true" />;
    case 'response':
      return <Zap className={`${cls} text-indigo`} aria-hidden="true" />;
    case 'qualifier':
      return <Terminal className={`${cls} text-muted`} aria-hidden="true" />;
    default:
      return <Hash className={`${cls} text-subtle`} aria-hidden="true" />;
  }
}

interface PatchProps {
  chip: Chip;
  onRemove?: (chip: Chip) => void;
  removeRef?: (el: HTMLButtonElement | null) => void;
  index: number;
}

export const Patch = forwardRef<HTMLLIElement, PatchProps>(function Patch({ chip, onRemove, removeRef, index }, ref) {
  const enter = useEntrance();
  const r = tilt(`${chip.kind}:${chip.id}`);
  return (
    <motion.li
      ref={ref}
      layout
      initial={enter({ scale: 0.3, rotate: -18, y: 10 })}
      animate={{
        scale: 1,
        rotate: r,
        y: 0,
        transition: { type: 'spring', stiffness: 520, damping: 17, delay: Math.min(index, 6) * 0.04 },
      }}
      exit={{
        rotate: r + 16,
        x: 14,
        y: -12,
        opacity: 0,
        scale: 0.85,
        transition: { duration: 0.22, ease: [0.4, 0, 1, 1] },
      }}
      // Hover mirrors the tilt, so rotation never exceeds ~1.5°.
      whileHover={{ rotate: -r, y: -2 }}
      className={`patch h-10 max-w-full pl-3 ${onRemove ? 'pr-1' : 'pr-3'} sm:h-9 ${chip.scope === 'issues' ? 'patch-issues' : ''}`}
      title={chip.scope === 'issues' ? 'Applies to issues: narrows the live issues on each repo page' : chip.detail}
      data-testid="filter-chip"
      data-kind={chip.kind}
    >
      <ChipGlyph chip={chip} />
      <span className="sr-only">{KIND_LABEL[chip.kind]}:</span>
      <span className="truncate">{chip.label}</span>
      {chip.scope === 'issues' && (
        <span
          className="shrink-0 rounded-[4px] bg-fg/[0.07] px-1 text-[11px] font-semibold tracking-[0.04em] text-muted"
          style={{ fontVariantCaps: 'all-small-caps' }}
        >
          <span className="sr-only">(applies to </span>issues<span className="sr-only">)</span>
        </span>
      )}
      {onRemove && (
        <button
          ref={removeRef}
          type="button"
          onClick={() => onRemove(chip)}
          className="touch ml-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md text-subtle transition-colors hover:bg-fg/[0.07] hover:text-fg"
          aria-label={`Unpick ${KIND_LABEL[chip.kind].toLowerCase()} patch: ${chip.label}`}
          data-testid="chip-remove"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
    </motion.li>
  );
});

interface StripProps {
  chips: Chip[];
  onRemove?: (chip: Chip) => void;
  /** Shown when there are no patches yet. */
  emptyHint: React.ReactNode;
  labelId: string;
  label?: string;
  /** The patches come from Claude's reading of the query (shown as a small sparkle). */
  ai?: boolean;
  /** Optional trailing control (e.g. "Search this" for the demo's suggestion). */
  action?: React.ReactNode;
  /**
   * Keep the empty hint invisible (it stays in the DOM for aria-describedby).
   * The typing demo sets it, so patches flying in and out never overlap the hint.
   */
  hintHidden?: boolean;
}

/**
 * The live "how we understood you" row. After a patch is unpicked, focus
 * moves to the patch that took its place (or the previous one), falling back
 * to the row's label, never to <body>.
 */
export function PatchStrip({
  chips,
  onRemove,
  emptyHint,
  labelId,
  label = 'We read that as',
  ai = false,
  action,
  hintHidden = false,
}: StripProps) {
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const labelRef = useRef<HTMLHeadingElement>(null);
  const pendingFocus = useRef<number | null>(null);
  const prevLen = useRef(chips.length);

  useEffect(() => {
    if (pendingFocus.current !== null && chips.length !== prevLen.current) {
      const idx = Math.min(pendingFocus.current, chips.length - 1);
      const target = idx >= 0 ? buttons.current.get(`${chips[idx].kind}:${chips[idx].id}`) : null;
      (target ?? labelRef.current)?.focus();
      pendingFocus.current = null;
    }
    prevLen.current = chips.length;
  }, [chips]);

  const remove = onRemove
    ? (chip: Chip) => {
        pendingFocus.current = chips.findIndex((c) => c.kind === chip.kind && c.id === chip.id);
        onRemove(chip);
      }
    : undefined;

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-4" data-testid="interpreted-panel">
      <h2
        ref={labelRef}
        id={labelId}
        tabIndex={-1}
        className="shrink-0 pt-1.5 font-display text-[15px] italic text-muted outline-none sm:w-[8.5rem]"
        data-ai={ai ? 'true' : undefined}
      >
        {label}
        <AnimatePresence initial={false}>
          {ai && (
            <motion.span
              key="ai"
              className="ml-1 inline-flex translate-y-[1px] align-baseline text-accent"
              title="Read by Claude"
              data-testid="ai-read"
              // Transform-only pop; with MotionConfig reducedMotion="user" this becomes a plain fade.
              initial={{ opacity: 0, scale: 0.4, rotate: -45 }}
              animate={{ opacity: 1, scale: 1, rotate: 0, transition: { type: 'spring', stiffness: 420, damping: 18 } }}
              exit={{ opacity: 0, transition: { duration: 0.15 } }}
            >
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="sr-only"> (read by AI)</span>
            </motion.span>
          )}
        </AnimatePresence>
      </h2>
      <ul
        aria-labelledby={labelId}
        aria-live="polite"
        className="flex min-h-10 min-w-0 flex-1 flex-wrap items-center gap-2"
      >
        <AnimatePresence initial={false} mode="popLayout">
          {chips.length === 0 && (
            <motion.li
              key="hint"
              layout
              initial={{ y: 4 }}
              // Fades in only once departing patches are gone, so the two never overlap.
              animate={
                hintHidden
                  ? { y: 0, opacity: 0, transition: { duration: 0 } }
                  : { y: 0, opacity: 1, transition: { opacity: { delay: 0.22, duration: 0.2 } } }
              }
              exit={{ opacity: 0, transition: { duration: hintHidden ? 0 : 0.12 } }}
              aria-hidden={hintHidden || undefined}
              className="py-1.5 text-sm text-subtle"
              data-testid="patch-hint"
            >
              {emptyHint}
            </motion.li>
          )}
          {chips.map((chip, i) => (
            <Patch
              key={`${chip.kind}:${chip.id}`}
              chip={chip}
              index={i}
              onRemove={remove}
              removeRef={(el) => {
                const k = `${chip.kind}:${chip.id}`;
                if (el) buttons.current.set(k, el);
                else buttons.current.delete(k);
              }}
            />
          ))}
        </AnimatePresence>
      </ul>
      {action}
    </div>
  );
}
