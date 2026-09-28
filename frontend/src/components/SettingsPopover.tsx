import { AnimatePresence, motion } from 'framer-motion';
import { Check, KeyRound, Settings } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

interface Props {
  token: string | null;
  onTokenChange: (t: string | null) => void;
  demo: boolean;
  onDemoChange: (d: boolean) => void;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}

/**
 * A disclosure panel (not a modal): it closes on Escape, outside click or
 * when focus leaves it, and returns focus to its trigger. No autofocus, so the
 * mobile keyboard doesn't pop up over the controls.
 */
export function SettingsPopover({ token, onTokenChange, demo, onDemoChange, open, onOpenChange }: Props) {
  const [draft, setDraft] = useState(token ?? '');
  const [savedFlash, setSavedFlash] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => setDraft(token ?? ''), [token, open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) onOpenChange(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      onOpenChange(false);
      trigger.current?.focus();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onOpenChange]);

  const onBlur = (e: React.FocusEvent) => {
    const next = e.relatedTarget as Node | null;
    if (next && wrap.current && !wrap.current.contains(next)) onOpenChange(false);
  };

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    onTokenChange(draft.trim() || null);
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1400);
  };

  return (
    <div ref={wrap} className="relative" onBlur={onBlur}>
      <button
        ref={trigger}
        type="button"
        className="icon-btn relative"
        aria-label="Settings"
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        onClick={() => onOpenChange(!open)}
        data-testid="settings-button"
      >
        <Settings className={`h-[18px] w-[18px] transition-transform duration-500 ${open ? 'rotate-90' : ''}`} />
        {token && <span className="absolute right-2.5 top-2.5 h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            id={`${id}-panel`}
            aria-label="Settings"
            role="region"
            initial={{ opacity: 0, y: -6, rotate: -1, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, rotate: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.2, 0.7, 0.2, 1] }}
            className="paper fixed inset-x-4 top-[68px] z-50 origin-top-right p-5 shadow-pop sm:absolute sm:inset-x-auto sm:right-0 sm:top-12 sm:w-[350px]"
          >
            <form onSubmit={save} className="relative z-[1]">
              <div className="flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-accent" aria-hidden="true" />
                <label htmlFor={`${id}-token`} className="text-sm font-semibold">
                  GitHub token
                </label>
                <span className="ml-auto text-xs text-subtle">optional</span>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-muted">
                Raises search from 10 to 30 requests a minute and shows repo stars. A classic token with{' '}
                <em>no scopes</em> is enough. It stays in this browser.
              </p>
              <div className="mt-3 flex gap-2">
                <input
                  id={`${id}-token`}
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="ghp_…"
                  className="h-11 min-w-0 flex-1 rounded-[10px] border border-line-strong/60 bg-bg px-3 text-sm text-fg placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 sm:h-10"
                  data-testid="token-input"
                />
                <button type="submit" className="btn-ink h-11 min-w-[68px] px-4 sm:h-10">
                  {savedFlash ? <Check className="h-4 w-4" aria-label="Saved" /> : 'Save'}
                </button>
              </div>
              {token && (
                <button
                  type="button"
                  className="mt-1 min-h-11 text-xs text-muted underline-offset-2 hover:text-fg hover:underline"
                  onClick={() => onTokenChange(null)}
                >
                  Remove token
                </button>
              )}
            </form>

            <div className="seam-t relative z-[1] my-4" />

            <label className="relative z-[1] flex min-h-11 cursor-pointer items-center gap-3">
              <span className="flex-1">
                <span className="block text-sm font-semibold">Sample data mode</span>
                <span className="mt-0.5 block text-xs text-muted">
                  Use the bundled sample issues instead of live GitHub results.
                </span>
              </span>
              <input
                type="checkbox"
                role="switch"
                className="peer sr-only"
                checked={demo}
                onChange={(e) => onDemoChange(e.target.checked)}
                data-testid="demo-switch"
              />
              <span
                aria-hidden="true"
                className="relative h-6 w-10 shrink-0 rounded-full bg-surface-3 ring-1 ring-inset ring-line-strong transition-colors after:absolute after:left-1 after:top-1 after:h-4 after:w-4 after:rounded-full after:bg-surface after:shadow after:transition-transform peer-checked:bg-accent peer-checked:after:translate-x-4 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent"
              />
            </label>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
