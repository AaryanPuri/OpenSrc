import { AnimatePresence, motion } from 'framer-motion';
import { Bookmark } from 'lucide-react';
import { forwardRef, useEffect, useState } from 'react';
import type { Theme } from '../hooks/useTheme';
import { LogoMark, ThemeGlyph } from './icons';
import { SettingsPopover } from './SettingsPopover';

interface Props {
  theme: Theme;
  onToggleTheme: () => void;
  savedCount: number;
  onOpenSaved: () => void;
  onHome: () => void;
  token: string | null;
  onTokenChange: (t: string | null) => void;
  demo: boolean;
  onDemoChange: (d: boolean) => void;
  settingsOpen: boolean;
  onSettingsOpenChange: (o: boolean) => void;
}

export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span
      className={`font-display text-[21px] font-semibold leading-none tracking-[-0.02em] ${className}`}
      style={{ fontVariationSettings: '"SOFT" 100, "WONK" 1' }}
    >
      Open<span className="italic text-accent">Src</span>
    </span>
  );
}

/** The Saved button is a forwardRef so bookmarked patches can fly to it. */
export const Header = forwardRef<HTMLButtonElement, Props>(function Header(props, savedRef) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={`sticky top-0 z-40 transition-[background-color,border-color] duration-300 ${
        scrolled ? 'seam-b bg-bg/85 backdrop-blur-md' : 'border-b border-transparent'
      }`}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-1 px-4 sm:px-6">
        <a
          href="/"
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey) return;
            e.preventDefault();
            props.onHome();
          }}
          className="group -ml-1 flex min-h-11 items-center gap-2.5 rounded-lg px-1"
          aria-label="OpenSrc home"
        >
          <motion.span
            whileHover={{ rotate: -8, scale: 1.05 }}
            whileTap={{ scale: 0.92 }}
            transition={{ type: 'spring', stiffness: 400, damping: 15 }}
            className="block"
          >
            <LogoMark className="h-8 w-8" />
          </motion.span>
          <Wordmark />
        </a>

        <div className="ml-auto flex items-center gap-0.5 sm:gap-1">
          <button
            ref={savedRef}
            type="button"
            className="btn-ghost relative min-w-11"
            onClick={props.onOpenSaved}
            data-testid="saved-button"
            aria-label={`Saved issues (${props.savedCount})`}
          >
            <Bookmark className="h-[18px] w-[18px]" />
            <span className="hidden sm:inline">Saved</span>
            <AnimatePresence initial={false}>
              {props.savedCount > 0 && (
                <motion.span
                  key={props.savedCount}
                  initial={{ scale: 1.6, rotate: -12 }}
                  animate={{ scale: 1, rotate: 0 }}
                  exit={{ scale: 0 }}
                  transition={{ type: 'spring', stiffness: 520, damping: 14 }}
                  className="absolute right-1 top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-accent px-1 text-[11px] font-semibold tabular-nums text-accent-fg sm:static sm:h-5 sm:min-w-5"
                >
                  {props.savedCount}
                </motion.span>
              )}
            </AnimatePresence>
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={props.onToggleTheme}
            aria-label={`Switch to ${props.theme === 'dark' ? 'light' : 'dark'} mode`}
            data-testid="theme-toggle"
          >
            <ThemeGlyph dark={props.theme === 'dark'} />
          </button>
          <SettingsPopover
            token={props.token}
            onTokenChange={props.onTokenChange}
            demo={props.demo}
            onDemoChange={props.onDemoChange}
            open={props.settingsOpen}
            onOpenChange={props.onSettingsOpenChange}
          />
        </div>
      </div>
    </header>
  );
});
