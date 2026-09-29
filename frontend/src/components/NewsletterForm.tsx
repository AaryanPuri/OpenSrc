import { Check, LoaderCircle, Mail, Rss } from 'lucide-react';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { useSession } from '../hooks/useSession';
import { LANGUAGES } from '../lib/dictionary';
import { LanguageDot } from './BrowseLinks';

/** Offered on the form, after any preselected language. */
const POPULAR = ['python', 'javascript', 'typescript', 'go', 'rust', 'java', 'cpp', 'csharp'];
const MAX_LANGUAGES = 5;
const label = (id: string) => LANGUAGES.find((l) => l.id === id)?.label ?? id;

interface Props {
  /** Languages ticked to start with (a language page passes its own). */
  languages?: string[];
  className?: string;
}

type Phase =
  { kind: 'idle' } | { kind: 'sending' } | { kind: 'sent'; email: string } | { kind: 'error'; message: string };

async function postJson(url: string, body: unknown, method = 'POST'): Promise<Response> {
  return fetch(url, {
    method,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
}

function LanguagePicker({
  value,
  onChange,
  options,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  options: string[];
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Languages">
      {options.map((id) => {
        const on = value.includes(id);
        return (
          <button
            key={id}
            type="button"
            className="chip"
            aria-pressed={on}
            disabled={!on && value.length >= MAX_LANGUAGES}
            onClick={() => onChange(on ? value.filter((l) => l !== id) : [...value, id])}
          >
            <LanguageDot id={id} className="h-2 w-2" />
            {label(id)}
          </button>
        );
      })}
    </div>
  );
}

/**
 * "Get a weekly patch": the newsletter sign-up, as a stitched card.
 *
 * The server render and hydration show the RSS version (no flags known yet); after
 * `/api/health` it becomes the email form, or says the digest is coming soon.
 */
export function NewsletterForm({ languages: initial = [], className = '' }: Props) {
  const { features } = useSession();
  const ids = useId();
  const [email, setEmail] = useState('');
  const [languages, setLanguages] = useState<string[]>(initial);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const options = [...new Set([...initial, ...POPULAR])].filter((id) => LANGUAGES.some((l) => l.id === id));
  const enabled = features?.newsletter === true;
  const disabled = features !== null && !enabled;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setPhase({ kind: 'sending' });
    try {
      const res = await postJson('/api/newsletter/subscribe', { email, languages });
      if (res.ok) {
        setPhase({ kind: 'sent', email: email.trim() });
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setPhase({ kind: 'error', message: body.error ?? 'Something went wrong. Please try again.' });
    } catch {
      setPhase({ kind: 'error', message: "We couldn't reach the server. Please try again." });
    }
  };

  const who = initial.length === 1 ? `${label(initial[0])} repos` : 'first-PR repos';
  return (
    <section
      aria-labelledby={`${ids}-title`}
      className={`stitch relative overflow-hidden rounded-[18px] bg-surface/60 p-5 sm:p-7 ${className}`}
      data-testid="newsletter"
    >
      <div className="flex items-start gap-4">
        <span
          aria-hidden="true"
          className="hidden h-12 w-12 shrink-0 -rotate-6 place-items-center rounded-[12px] bg-accent text-accent-fg shadow-sticker sm:grid"
        >
          <Mail className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="eyebrow">Every Monday</p>
          <h2 id={`${ids}-title`} className="font-display text-[1.6rem] font-[560] leading-tight tracking-[-0.02em]">
            Get a weekly patch
          </h2>
          <p className="mt-1.5 max-w-xl text-pretty text-sm leading-relaxed text-muted">
            New {who} that joined the directory this week, with open good first issues and maintainers who reply. One
            email, no tracking, unsubscribe in one click.
          </p>

          {phase.kind === 'sent' ? (
            <p className="mt-5 flex items-start gap-2 text-sm" role="status" data-testid="newsletter-sent">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-ok" aria-hidden="true" />
              <span>
                Almost done: we sent a confirmation link to <strong>{phase.email}</strong>. Click it to start getting
                the digest.
              </span>
            </p>
          ) : enabled ? (
            <form onSubmit={submit} className="mt-5 space-y-3" data-testid="newsletter-form">
              <LanguagePicker value={languages} onChange={setLanguages} options={options} />
              <p className="text-xs text-subtle">
                {languages.length
                  ? `Up to ${MAX_LANGUAGES} languages.`
                  : 'No language picked: the best of every language.'}
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <label htmlFor={`${ids}-email`} className="sr-only">
                  Email address
                </label>
                <input
                  id={`${ids}-email`}
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="h-11 min-w-0 flex-1 rounded-[10px] border border-line-strong/60 bg-bg px-3 text-sm text-fg placeholder:text-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
                />
                <button type="submit" className="btn-thread h-11 px-5" disabled={phase.kind === 'sending'}>
                  {phase.kind === 'sending' && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />}
                  Subscribe
                </button>
              </div>
              {phase.kind === 'error' && (
                <p className="text-sm text-danger" role="alert">
                  {phase.message}
                </p>
              )}
              <p className="text-xs text-subtle">
                Rather use a feed reader?{' '}
                <a href="/feed.xml" className="font-medium text-accent underline-offset-2 hover:underline">
                  RSS
                </a>
              </p>
            </form>
          ) : (
            <div className="mt-5 flex flex-wrap items-center gap-3" data-testid="newsletter-rss">
              {disabled && (
                <span className="patch-issues patch px-2.5 py-1 text-xs" data-testid="newsletter-soon">
                  Email digest coming soon
                </span>
              )}
              <a href="/feed.xml" className="btn-seam h-10 px-4">
                <Rss className="h-4 w-4 text-accent" aria-hidden="true" />
                Follow new repos by RSS
              </a>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

interface Subscription {
  email: string;
  languages: string[];
  status: 'pending' | 'active' | 'unsubscribed';
}

/**
 * The account page's newsletter preferences: the linked subscription's languages and
 * status, or the sign-up form when the account has none.
 */
export function NewsletterPrefs() {
  const { features, status } = useSession();
  const [sub, setSub] = useState<Subscription | null | undefined>(undefined);
  const [languages, setLanguages] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const enabled = features?.newsletter === true && status === 'user';

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    fetch('/api/newsletter/me', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? (r.json() as Promise<{ subscription: Subscription | null }>) : { subscription: null }))
      .then((j) => {
        if (!live) return;
        setSub(j.subscription);
        setLanguages(j.subscription?.languages ?? []);
      })
      .catch(() => live && setSub(null));
    return () => {
      live = false;
    };
  }, [enabled]);

  if (!enabled || sub === undefined || !sub || sub.status === 'unsubscribed') return <NewsletterForm />;

  const change = async (method: 'PUT' | 'DELETE') => {
    setSaving(true);
    try {
      const res = await postJson('/api/newsletter/me', method === 'PUT' ? { languages } : {}, method);
      if (res.ok) {
        const j = (await res.json()) as { subscription: Subscription | null };
        setSub(j.subscription);
        setSaved(method === 'PUT');
      }
    } finally {
      setSaving(false);
    }
  };

  const options = [...new Set([...sub.languages, ...POPULAR])];
  return (
    <section
      className="stitch rounded-[18px] bg-surface/60 p-5 sm:p-7"
      aria-labelledby="prefs-title"
      data-testid="newsletter-prefs"
    >
      <p className="eyebrow">Every Monday</p>
      <h2 id="prefs-title" className="font-display text-[1.6rem] font-[560] leading-tight tracking-[-0.02em]">
        Your weekly patch
      </h2>
      <p className="mt-1.5 text-sm text-muted">
        {sub.status === 'active' ? 'Sent to' : 'Waiting for you to confirm'}{' '}
        <strong className="text-fg">{sub.email}</strong>.
      </p>
      <div className="mt-4">
        <LanguagePicker
          value={languages}
          onChange={(v) => {
            setLanguages(v);
            setSaved(false);
          }}
          options={options}
        />
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="button" className="btn-ink h-10 px-4" disabled={saving} onClick={() => change('PUT')}>
          {saved ? <Check className="h-4 w-4" aria-hidden="true" /> : null}
          {saved ? 'Saved' : 'Save languages'}
        </button>
        <button type="button" className="btn-ghost" disabled={saving} onClick={() => change('DELETE')}>
          Unsubscribe
        </button>
      </div>
    </section>
  );
}
