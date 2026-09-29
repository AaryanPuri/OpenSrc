import { AnimatePresence, motion } from 'framer-motion';
import { Bookmark, Menu, X } from 'lucide-react';
import { forwardRef, useEffect, useId, useState } from 'react';
import { NavLink, useLocation } from 'react-router';
import { useHydrated } from '../hooks/useHydrated';
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

const NAV = [
  { to: '/', label: 'Directory', end: true },
  { to: '/collections', label: 'Collections', end: false },
  { to: '/issues', label: 'Search issues', end: false },
  { to: '/submit', label: 'Submit', end: false },
];

/** "/" is also active on the directory's field pages, which are the directory with a field picked. */
const isDirectory = (path: string) => path === '/' || path.startsWith('/field/') || path.startsWith('/repo/');

function NavItems({ vertical, onNavigate }: { vertical?: boolean; onNavigate?: () => void }) {
  const { pathname } = useLocation();
  return (
    <ul className={vertical ? 'flex flex-col py-2' : 'flex items-center gap-0.5'}>
      {NAV.map((n) => (
        <li key={n.to}>
          <NavLink
            to={n.to}
            end={n.end}
            onClick={onNavigate}
            className={({ isActive }) => {
              const active = n.to === '/' ? isDirectory(pathname) : isActive;
              return `nav-link ${vertical ? 'flex h-12 items-center px-4 text-[15px]' : 'inline-flex h-9 items-center px-3 text-[14px]'} ${active ? 'is-active text-fg' : 'text-muted hover:text-fg'}`;
            }}
          >
            {n.label}
          </NavLink>
        </li>
      ))}
    </ul>
  );
}

/** The Saved button is a forwardRef so bookmarked patches can fly to it. */
export const Header = forwardRef<HTMLButtonElement, Props>(function Header(props, savedRef) {
  const hydrated = useHydrated();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuId = useId();
  const { pathname } = useLocation();
  useEffect(() => setMenuOpen(false), [pathname]);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={`sticky top-0 z-40 transition-[background-color,border-color] duration-300 ${
        scrolled || menuOpen ? 'seam-b bg-bg/85 backdrop-blur-md' : 'border-b border-transparent'
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

        <nav aria-label="Main" className="ml-6 hidden lg:block">
          <NavItems />
        </nav>

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
            aria-label={hydrated ? `Switch to ${props.theme === 'dark' ? 'light' : 'dark'} mode` : 'Switch theme'}
            data-testid="theme-toggle"
          >
            {/* The server can't know the theme, so the glyph stays hidden until hydrated. */}
            <span className={`grid place-items-center transition-opacity ${hydrated ? '' : 'opacity-0'}`}>
              <ThemeGlyph dark={props.theme === 'dark'} />
            </span>
          </button>
          <SettingsPopover
            token={props.token}
            onTokenChange={props.onTokenChange}
            demo={props.demo}
            onDemoChange={props.onDemoChange}
            open={props.settingsOpen}
            onOpenChange={props.onSettingsOpenChange}
          />
          <button
            type="button"
            className="icon-btn lg:hidden"
            aria-expanded={menuOpen}
            aria-controls={menuId}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            onClick={() => setMenuOpen((o) => !o)}
            data-testid="menu-button"
          >
            {menuOpen ? <X className="h-[18px] w-[18px]" /> : <Menu className="h-[18px] w-[18px]" />}
          </button>
        </div>
      </div>
      <AnimatePresence initial={false}>
        {menuOpen && (
          <motion.nav
            id={menuId}
            aria-label="Main"
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            transition={{ duration: 0.22, ease: [0.2, 0.7, 0.2, 1] }}
            className="overflow-hidden lg:hidden"
          >
            <div className="seam-t mx-auto max-w-6xl px-2">
              <NavItems vertical onNavigate={() => setMenuOpen(false)} />
            </div>
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  );
});
