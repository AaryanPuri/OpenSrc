import { motion } from 'framer-motion';
import { ArrowRight, X } from 'lucide-react';
import { forwardRef, useEffect, useId, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useAutoDemo } from '../hooks/useAutoDemo';
import { useIsomorphicLayoutEffect } from '../hooks/useIsomorphicLayoutEffect';
import { rememberAiParse } from '../lib/aiParse';
import { EXAMPLE_QUERIES } from '../lib/examples';
import { getChips, parseQuery, removeChip, type Chip, type ParsedQuery } from '../lib/parseQuery';
import { TIME_PRESETS, applyPreset, matchPreset, type TimePresetId } from '../lib/presets';
import { NeedleIcon } from './icons';
import { PatchStrip } from './Patches';

/** The idle demo types these once, then leaves the last one as a suggestion. */
const DEMO_QUERIES = EXAMPLE_QUERIES.slice(0, 3);

interface Props {
  value: string;
  onChange: (v: string) => void;
  /** Submit a search. */
  onSubmit: (v: string) => void;
  /** Patch edits: on the landing page they only edit the text, on results they search. */
  onEdit: (text: string) => void;
  loading?: boolean;
  compact?: boolean;
  /** Run the idle typing demo (landing only). */
  autoplay?: boolean;
  /** Claude's reading of the submitted query `q`, used while the text still matches it. */
  ai?: { q: string; parsed: ParsedQuery } | null;
}

function useDebouncedText(value: string, ms: number) {
  const [out, setOut] = useState(value);
  const immediate = useRef(false);
  useEffect(() => {
    if (immediate.current) {
      immediate.current = false;
      setOut(value);
      return;
    }
    const t = setTimeout(() => setOut(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return [out, () => (immediate.current = true)] as const;
}

/**
 * The search bar and its interpreted patches, as one unit. Patches are
 * live-parsed from what you type (debounced), so the parser's understanding
 * is visible before you even search.
 */
export const Composer = forwardRef<HTMLTextAreaElement, Props>(function Composer(
  { value, onChange, onSubmit, onEdit, loading, compact, autoplay = false, ai = null },
  ref,
) {
  const [focused, setFocused] = useState(false);
  const ids = useId();
  const [liveText, flushNext] = useDebouncedText(value, 160);
  const demo = useAutoDemo(DEMO_QUERIES, autoplay && !value && !focused);
  const input = useRef<HTMLTextAreaElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  useImperativeHandle(ref, () => input.current as HTMLTextAreaElement);

  // Auto-size: long queries wrap onto a second (or third) line instead of being cut off.
  useIsomorphicLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value, compact]);

  // While the demo is mid-word, parse only the finished words so half-typed
  // fragments ("d", "datab") never flash up as keyword patches.
  const demoText =
    demo.typing && !DEMO_QUERIES.includes(demo.text)
      ? demo.text.slice(0, Math.max(0, demo.text.lastIndexOf(' ')))
      : demo.text;
  const shownText = demo.active ? demoText : liveText;
  // Claude's reading applies only while the box still holds the text it read.
  const aiShown = !demo.active && !!ai && shownText.trim() === ai.q;
  const localParsed = useMemo(() => parseQuery(shownText), [shownText]);
  const parsed = aiShown ? ai.parsed : localParsed;
  const chips = useMemo(() => getChips(parsed), [parsed]);
  const preset = matchPreset(parsed);

  const edit = (text: string) => {
    flushNext();
    demo.stop();
    onEdit(text);
  };
  /** Edits start from what the patches show (Claude's reading when it matches) and stay Claude's. */
  const editFrom = (change: (p: ParsedQuery) => ParsedQuery) => {
    const fromAi = !!ai && value.trim() === ai.q;
    const next = change(fromAi ? ai.parsed : parseQuery(value));
    if (fromAi) rememberAiParse(next.raw.trim().replace(/\s+/g, ' '), next);
    edit(next.raw);
  };
  const onRemove = (chip: Chip) => editFrom((p) => removeChip(p, chip));
  const onPreset = (id: TimePresetId) => editFrom((p) => applyPreset(p, id));

  const inputSize = compact ? 'text-[17px] leading-[1.35]' : 'text-[18px] leading-[1.35] sm:text-[21px]';
  const suggestion = demo.finished ? demo.text : null;

  return (
    <div
      className={`relative rounded-[18px] border-[1.5px] bg-surface/70 backdrop-blur-[2px] transition-[border-color,box-shadow] duration-200 ${
        focused ? 'border-accent shadow-[0_0_0_4px_rgb(var(--accent)/0.14)]' : 'border-dashed border-line-strong/80'
      }`}
    >
      {/* Input row */}
      <form
        ref={formRef}
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          flushNext();
          demo.stop();
          onSubmit(value);
        }}
        className={`relative flex items-center gap-2 py-2 pl-4 pr-2 sm:pl-5 ${compact ? 'min-h-[60px]' : 'min-h-[68px] sm:min-h-[76px]'}`}
      >
        {/* Hovering or focusing the input ends the demo at once; it never writes to the input. */}
        <div
          className="relative grid min-w-0 flex-1 items-center"
          onPointerEnter={demo.active ? demo.stop : undefined}
          onClick={() => input.current?.focus()}
        >
          <textarea
            ref={input}
            rows={1}
            value={value}
            // A search is one line of intent: pasted newlines become spaces.
            onChange={(e) => onChange(e.target.value.replace(/\r?\n/g, ' '))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                formRef.current?.requestSubmit();
              }
            }}
            onFocus={() => {
              setFocused(true);
              demo.stop();
            }}
            onBlur={() => setFocused(false)}
            aria-label="Describe the issues you want to work on"
            aria-describedby={`${ids}-hint`}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="search"
            data-testid="search-input"
            className={`col-start-1 row-start-1 block max-h-[5.4em] w-full resize-none overflow-y-auto bg-transparent py-1 text-fg outline-none ${inputSize}`}
            style={{ outline: 'none' }}
          />
          {!value && (
            <div
              className={`pointer-events-none col-start-1 row-start-1 flex items-baseline gap-2 py-1 ${inputSize}`}
              aria-hidden="true"
            >
              <span
                className="shrink-0 text-[14px] font-semibold tracking-[0.06em] text-accent"
                style={{ fontVariantCaps: 'all-small-caps' }}
              >
                Try
              </span>
              {demo.active ? (
                <span className={`line-clamp-2 ${demo.typing ? 'text-muted' : 'font-display italic text-muted'}`}>
                  {demo.text}
                  {demo.typing && (
                    <span className="caret ml-px inline-block h-[1.05em] w-[2px] translate-y-[3px] bg-accent" />
                  )}
                </span>
              ) : (
                <span className="line-clamp-2 font-display italic text-subtle">{EXAMPLE_QUERIES[0]}</span>
              )}
            </div>
          )}
        </div>

        {value && (
          <button type="button" className="icon-btn shrink-0" aria-label="Clear search" onClick={() => onChange('')}>
            <X className="h-4 w-4" />
          </button>
        )}
        {!focused && !value && !compact && !demo.active && (
          <span className="hidden shrink-0 items-center gap-1.5 text-xs text-subtle md:flex" aria-hidden="true">
            press <kbd>/</kbd>
          </span>
        )}
        <motion.button
          type="submit"
          whileTap={{ scale: 0.94 }}
          className={`btn-ink group shrink-0 ${compact ? 'h-11 w-11 sm:w-auto sm:px-4' : 'h-12 w-12 sm:h-[52px] sm:w-auto sm:px-5'}`}
          aria-label="Search"
          data-testid="search-submit"
        >
          <NeedleIcon className="h-[18px] w-[18px] transition-transform duration-300 group-hover:-rotate-12 group-active:translate-x-1" />
          <span className="hidden sm:inline">Find issues</span>
        </motion.button>

        {/* Running stitch along the bottom edge while a search is in flight. */}
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute inset-x-5 -bottom-px h-[2px] origin-left transition-transform duration-300 ${loading ? 'sewing-line scale-x-100' : 'scale-x-0'}`}
        />
      </form>

      {/* Patches: the parser's understanding, attached to the bar */}
      <div className="seam-t px-4 py-3 sm:px-5">
        <PatchStrip
          chips={chips}
          onRemove={demo.active ? undefined : onRemove}
          labelId={`${ids}-patches`}
          label={suggestion ? 'Try this one' : demo.active ? 'Watch it sew' : 'We read that as'}
          ai={aiShown}
          action={
            suggestion ? (
              <button
                type="button"
                className="btn-ink h-11 shrink-0 self-start px-4 text-[13px] sm:h-9"
                onClick={() => {
                  demo.stop();
                  onSubmit(suggestion);
                }}
                data-testid="demo-suggestion"
              >
                Search this <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            ) : null
          }
          emptyHint={
            <span id={`${ids}-hint`}>
              Patches appear as you type: a language, a field, how hard, what kind of work.
            </span>
          }
        />
      </div>

      {/* Time picker */}
      <div className="seam-t flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 sm:px-5">
        <TimePicker value={demo.active ? null : preset} onPick={onPreset} />
      </div>
    </div>
  );
});

function TimePicker({ value, onPick }: { value: TimePresetId | null; onPick: (id: TimePresetId) => void }) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5" role="group" aria-labelledby={`${id}-l`}>
      <span id={`${id}-l`} className="text-xs font-medium text-muted">
        How much time do you have?
      </span>
      <div className="flex rounded-full bg-fg/[0.06] p-0.5">
        {TIME_PRESETS.map((p) => {
          const active = value === p.id;
          return (
            <button
              key={p.id}
              type="button"
              aria-pressed={active}
              title={p.hint}
              onClick={() => onPick(p.id)}
              className={`relative h-11 rounded-full px-3.5 text-[13px] font-medium transition-colors sm:h-8 ${active ? 'text-bg' : 'text-muted hover:text-fg'}`}
              data-testid="time-preset"
            >
              {active && (
                <motion.span
                  layoutId={`${id}-pill`}
                  className="absolute inset-0 rounded-full bg-fg"
                  transition={{ type: 'spring', stiffness: 480, damping: 34 }}
                />
              )}
              <span className="relative">{p.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
