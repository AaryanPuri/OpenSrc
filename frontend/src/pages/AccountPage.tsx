import { Bookmark, CircleAlert, Check, LogOut, Search, Star } from 'lucide-react';
import { useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { GitHubMark } from '../components/icons';
import { NewsletterForm, NewsletterPrefs } from '../components/NewsletterForm';
import { UserAvatar } from '../components/UserMenu';
import { useDocumentMeta } from '../hooks/useDocumentMeta';
import { useShell } from '../hooks/useShell';
import { fabricFor, fabricStyle } from '../lib/fabric';
import { loginHref } from '../lib/session';
import { useSiteUrl } from '../seo/context';
import { accountMeta } from '../seo/meta';

const joined = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en', { month: 'long', year: 'numeric' });
};

/** `/account` (client-rendered, noindex): profile, saved counts, newsletter, sign out. */
export function AccountPage() {
  const { session, savedCounts, openSaved, signOut } = useShell();
  const [params] = useSearchParams();
  const site = useSiteUrl();
  useDocumentMeta(useMemo(() => accountMeta(site), [site]));

  const loginFailed = params.get('login') === 'failed';
  const justSubscribed = params.get('subscribed') === '1';
  const { features, status, user } = session;

  const tiles = [
    { label: 'Repos', count: savedCounts.repos, icon: Star },
    { label: 'Issues', count: savedCounts.issues, icon: Bookmark },
    { label: 'Searches', count: savedCounts.searches, icon: Search },
  ];

  const savedBlock = (
    <section aria-labelledby="saved-counts" className="mt-8">
      <h2 id="saved-counts" className="eyebrow">
        {status === 'user' ? 'Saved to your account' : 'Saved in this browser'}
      </h2>
      <ul className="mt-2 grid grid-cols-3 gap-3">
        {tiles.map((t, i) => (
          <li key={t.label}>
            <button
              type="button"
              onClick={openSaved}
              className="paper group relative w-full overflow-hidden px-4 pb-3 pt-4 text-left transition-transform hover:-translate-y-0.5"
              data-testid={`saved-count-${t.label.toLowerCase()}`}
            >
              <span
                aria-hidden="true"
                className="absolute inset-x-0 top-0 h-[6px]"
                style={fabricStyle(fabricFor(['a', 'b', 'c'][i] + t.label), 0.5)}
              />
              <t.icon className="h-4 w-4 text-subtle" aria-hidden="true" />
              <span className="mt-2 block font-display text-3xl font-[560] tabular-nums">{t.count}</span>
              <span className="text-sm text-muted">{t.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );

  let body;
  if (features === null || status === 'unknown') {
    body = (
      <div className="mt-8 space-y-3" aria-busy="true" data-testid="account-loading">
        <div className="skeleton h-24 w-full" />
        <div className="skeleton h-20 w-full" />
      </div>
    );
  } else if (!features.auth) {
    body = (
      <>
        <p className="mt-3 max-w-xl text-muted">
          Accounts aren&rsquo;t switched on for this copy of OpenSrc. Everything you save stays in this browser.
        </p>
        {savedBlock}
      </>
    );
  } else if (status !== 'user' || !user) {
    body = (
      <>
        {loginFailed && (
          <p className="mt-4 flex items-center gap-2 text-sm text-danger" role="alert">
            <CircleAlert className="h-4 w-4" aria-hidden="true" /> GitHub sign-in didn&rsquo;t go through. Please try
            again.
          </p>
        )}
        <div className="stitch mt-6 rounded-[18px] bg-surface/60 p-6">
          <h2 className="font-display text-xl font-[560]">Keep your shortlist on every device</h2>
          <p className="mt-1.5 max-w-lg text-sm leading-relaxed text-muted">
            Sign in with GitHub to sync saved repos, issues and searches. We only read your public profile: no email, no
            repo access. Your saves in this browser come along the first time.
          </p>
          <a href={loginHref('/account')} className="btn-ink mt-4 h-11 px-5" data-testid="account-sign-in">
            <GitHubMark className="h-4 w-4" /> Sign in with GitHub
          </a>
        </div>
        {savedBlock}
      </>
    );
  } else {
    const since = joined(user.createdAt);
    body = (
      <>
        <div className="paper mt-6 flex items-center gap-4 p-5" data-testid="account-profile">
          <UserAvatar user={user} size={56} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-display text-xl font-[560]">{user.name || user.login}</p>
            <p className="truncate text-sm text-muted">
              <a href={`https://github.com/${user.login}`} className="hover:text-fg hover:underline" rel="noreferrer">
                @{user.login}
              </a>
              {since && ` · with OpenSrc since ${since}`}
            </p>
          </div>
          <button type="button" className="btn-seam hidden sm:inline-flex" onClick={signOut}>
            <LogOut className="h-4 w-4" aria-hidden="true" /> Sign out
          </button>
        </div>
        {savedBlock}
        <button type="button" className="btn-seam mt-6 w-full sm:hidden" onClick={signOut}>
          <LogOut className="h-4 w-4" aria-hidden="true" /> Sign out
        </button>
      </>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 pb-24 pt-8 sm:px-6 sm:pt-12">
      <p className="eyebrow">Account</p>
      <h1 className="font-display text-[2.2rem] font-[560] leading-tight tracking-[-0.02em]">Your account</h1>
      {justSubscribed && (
        <p className="mt-3 flex items-center gap-2 text-sm" role="status" data-testid="account-subscribed">
          <Check className="h-4 w-4 text-ok" aria-hidden="true" /> You&rsquo;re subscribed. The first weekly patch
          arrives on Monday.
        </p>
      )}
      {body}
      <div className="mt-10">{status === 'user' ? <NewsletterPrefs /> : <NewsletterForm />}</div>
    </div>
  );
}
