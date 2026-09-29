import { AnimatePresence, motion } from 'framer-motion';
import { LogOut, UserRound } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { loginHref, type SessionState } from '../lib/session';
import { GitHubMark, PatchAvatar } from './icons';

interface Props {
  session: SessionState;
  onSignOut: () => void;
}

/**
 * The header's account control. Shown only after hydration, and only when the server
 * has login switched on: "Sign in with GitHub" when signed out, an avatar menu when in.
 */
export function UserMenu({ session, onSignOut }: Props) {
  const { pathname, search } = useLocation();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!session.features?.auth || session.status === 'unknown') return null;

  if (session.status === 'anon' || !session.user) {
    return (
      <a
        href={loginHref(`${pathname}${search}`)}
        className="btn-ghost min-w-11 whitespace-nowrap"
        data-testid="sign-in"
        aria-label="Sign in with GitHub"
      >
        <GitHubMark className="h-[17px] w-[17px]" aria-hidden="true" />
        <span className="hidden sm:inline">Sign in</span>
      </a>
    );
  }

  const user = session.user;
  return (
    <div
      ref={wrap}
      className="relative"
      onBlur={(e) => {
        const next = e.relatedTarget as Node | null;
        if (next && wrap.current && !wrap.current.contains(next)) setOpen(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="icon-btn"
        aria-label={`Account menu for ${user.login}`}
        aria-expanded={open}
        aria-controls={`${id}-menu`}
        onClick={() => setOpen((o) => !o)}
        data-testid="user-menu"
      >
        <UserAvatar user={user} size={26} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            id={`${id}-menu`}
            role="menu"
            aria-label="Account"
            initial={{ opacity: 0, y: -6, rotate: -1, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, rotate: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.2, 0.7, 0.2, 1] }}
            className="paper absolute right-0 top-12 z-50 w-60 origin-top-right p-2 shadow-pop"
          >
            <div className="relative z-[1] px-2.5 pb-2 pt-1.5">
              <p className="truncate text-sm font-semibold">{user.name || user.login}</p>
              <p className="truncate text-xs text-muted">@{user.login}</p>
            </div>
            <div className="seam-t relative z-[1] my-1" />
            <Link
              to="/account"
              role="menuitem"
              className="relative z-[1] flex min-h-11 items-center gap-2.5 rounded-md px-2.5 text-sm hover:bg-fg/[0.06] sm:min-h-9"
            >
              <UserRound className="h-4 w-4 text-subtle" aria-hidden="true" /> Account
            </Link>
            <button
              type="button"
              role="menuitem"
              className="relative z-[1] flex min-h-11 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-sm hover:bg-fg/[0.06] sm:min-h-9"
              onClick={() => {
                setOpen(false);
                onSignOut();
              }}
              data-testid="sign-out"
            >
              <LogOut className="h-4 w-4 text-subtle" aria-hidden="true" /> Sign out
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** GitHub avatar, falling back to a patch monogram. */
export function UserAvatar({ user, size }: { user: { login: string; avatarUrl: string | null }; size: number }) {
  const [failed, setFailed] = useState(false);
  if (!user.avatarUrl || failed) return <PatchAvatar name={user.login} size={size} />;
  return (
    <img
      src={user.avatarUrl}
      alt=""
      width={size}
      height={size}
      onError={() => setFailed(true)}
      className="rounded-full ring-1 ring-line-strong"
      style={{ width: size, height: size }}
    />
  );
}
