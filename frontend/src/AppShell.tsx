import { AnimatePresence, MotionConfig, motion, useReducedMotion } from 'framer-motion';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Outlet, useNavigate } from 'react-router';
import { Footer } from './components/Footer';
import { Header } from './components/Header';
import { NewsletterNotice } from './components/NewsletterNotice';
import { SavedDrawer } from './components/SavedDrawer';
import { useLocalStorage } from './hooks/useLocalStorage';
import { useSaved, type RepoLike } from './hooks/useSaved';
import { useSession } from './hooks/useSession';
import type { ShellContext } from './hooks/useShell';
import { useTheme } from './hooks/useTheme';
import { useUrlState } from './hooks/useUrlState';
import { fabricFor, fabricStyle } from './lib/fabric';
import { logout, startSession } from './lib/session';
import { KEYS } from './lib/storage';
import type { Issue } from './lib/types';

interface Flight {
  id: number;
  from: DOMRect;
  to: DOMRect;
  fabric: string;
}

/** Chrome shared by every page: header, footer, saved drawer, theme, "/" shortcut. */
export function AppShell() {
  const { theme, toggle: toggleTheme } = useTheme();
  const [url, setUrl] = useUrlState();
  const [token, setToken] = useLocalStorage<string | null>(KEYS.token, null);
  const session = useSession();
  // After hydration: which optional features the server has, and who is signed in.
  useEffect(() => void startSession(), []);
  const {
    saved,
    isSaved,
    toggle: toggleSaved,
    remove: removeSaved,
    savedRepos,
    isRepoSaved,
    toggleRepo,
    removeRepo,
    savedSearches,
    isSearchSaved,
    toggleSearch,
    removeSearch,
    clear: clearSaved,
  } = useSaved(session);
  const navigate = useNavigate();
  const [savedOpen, setSavedOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [homeTick, setHomeTick] = useState(0);
  const searchRef = useRef<HTMLTextAreaElement>(null);
  const savedBtnRef = useRef<HTMLButtonElement>(null);
  const reduce = useReducedMotion();

  // "/" focuses search from anywhere (except while typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement;
      if (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName)) return;
      e.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /** The logo: back to a clean directory (only demo mode carries over). */
  const goHome = () => {
    setHomeTick((n) => n + 1);
    navigate({ pathname: '/', search: url.demo ? '?demo=1' : '' });
    window.scrollTo({ top: 0 });
  };

  const fly = useCallback(
    (from: DOMRect | null, fabric: string) => {
      const to = savedBtnRef.current?.getBoundingClientRect();
      if (from && to && !reduce) setFlights((f) => [...f, { id: Date.now() + Math.random(), from, to, fabric }]);
    },
    [reduce],
  );

  const onToggleSave = useCallback(
    (issue: Issue, from: DOMRect | null) => {
      const adding = !isSaved(issue);
      toggleSaved(issue);
      if (adding) fly(from, issue.repo.fullName);
    },
    [isSaved, toggleSaved, fly],
  );

  const onToggleRepoSave = useCallback(
    (repo: RepoLike, from: DOMRect | null) => {
      const adding = !isRepoSaved(repo.fullName);
      toggleRepo(repo);
      if (adding) fly(from, repo.fullName);
    },
    [isRepoSaved, toggleRepo, fly],
  );

  const openSettings = useCallback(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setSettingsOpen(true);
  }, []);

  const openSaved = useCallback(() => setSavedOpen(true), []);
  const signOut = useCallback(() => void logout(), []);
  const savedCounts = useMemo(
    () => ({ repos: savedRepos.length, issues: saved.length, searches: savedSearches.length }),
    [savedRepos.length, saved.length, savedSearches.length],
  );

  const context = useMemo<ShellContext>(
    () => ({
      theme,
      token,
      searchRef,
      isSaved,
      onToggleSave,
      isRepoSaved,
      onToggleRepoSave,
      isSearchSaved,
      onToggleSearch: toggleSearch,
      openSettings,
      openSaved,
      savedCounts,
      session,
      signOut,
      homeTick,
    }),
    [
      theme,
      token,
      isSaved,
      onToggleSave,
      isRepoSaved,
      onToggleRepoSave,
      isSearchSaved,
      toggleSearch,
      openSettings,
      openSaved,
      savedCounts,
      session,
      signOut,
      homeTick,
    ],
  );

  return (
    <MotionConfig reducedMotion="user">
      <div className="relative flex min-h-dvh flex-col overflow-x-clip">
        <a
          href="#main"
          className="sr-only z-50 rounded-md bg-surface px-3 py-2 focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
        >
          Skip to content
        </a>
        <Header
          ref={savedBtnRef}
          theme={theme}
          onToggleTheme={toggleTheme}
          savedCount={saved.length + savedRepos.length + savedSearches.length}
          session={session}
          onSignOut={signOut}
          onOpenSaved={() => setSavedOpen(true)}
          onHome={goHome}
          token={token}
          onTokenChange={setToken}
          demo={url.demo}
          onDemoChange={(demo) => setUrl({ demo }, 'replace')}
          settingsOpen={settingsOpen}
          onSettingsOpenChange={setSettingsOpen}
        />

        <NewsletterNotice />
        <main id="main" className="flex-1">
          <Outlet context={context} />
        </main>

        <Footer />
        <SavedDrawer
          open={savedOpen}
          onClose={() => setSavedOpen(false)}
          saved={saved}
          savedRepos={savedRepos}
          savedSearches={savedSearches}
          onRemove={removeSaved}
          onRemoveRepo={removeRepo}
          onRemoveSearch={removeSearch}
          synced={session.status === 'user'}
          onClear={clearSaved}
        />

        {/* Bookmarked patches fly to the Saved button */}
        <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-[60]">
          <AnimatePresence>
            {flights.map((f) => (
              <motion.span
                key={f.id}
                className="absolute h-7 w-7 rounded-[6px] shadow-sticker ring-1 ring-black/10"
                style={{ left: 0, top: 0, ...fabricStyle(fabricFor(f.fabric), 0.5) }}
                initial={{
                  x: f.from.left + f.from.width / 2 - 14,
                  y: f.from.top + f.from.height / 2 - 14,
                  scale: 0.6,
                  rotate: -20,
                }}
                animate={{
                  x: [
                    f.from.left + f.from.width / 2 - 14,
                    (f.from.left + f.to.left) / 2,
                    f.to.left + f.to.width / 2 - 14,
                  ],
                  y: [
                    f.from.top + f.from.height / 2 - 14,
                    Math.min(f.from.top, f.to.top) - 60,
                    f.to.top + f.to.height / 2 - 14,
                  ],
                  scale: [0.6, 1.1, 0.35],
                  rotate: [-20, 25, 90],
                }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.62, ease: [0.3, 0.1, 0.3, 1] }}
                onAnimationComplete={() => setFlights((all) => all.filter((x) => x.id !== f.id))}
              />
            ))}
          </AnimatePresence>
        </div>
      </div>
    </MotionConfig>
  );
}
