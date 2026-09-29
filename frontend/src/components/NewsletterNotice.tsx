import { AnimatePresence, motion } from 'framer-motion';
import { Check, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';

const MESSAGES = {
  confirmed: { ok: true, text: "You're subscribed. Your first weekly patch arrives on Monday." },
  unsubscribed: { ok: true, text: "You're unsubscribed. No more emails from us." },
  invalid: { ok: false, text: 'That link has expired or was already used. Sign up again to get a fresh one.' },
} as const;
type Kind = keyof typeof MESSAGES;

/**
 * The thank-you (or problem) banner after a newsletter link brings someone back with
 * `?newsletter=confirmed|unsubscribed|invalid`. It removes the parameter at once, so a
 * reload or a shared link doesn't show it again.
 */
export function NewsletterNotice() {
  const { search, pathname, hash } = useLocation();
  const navigate = useNavigate();
  const [kind, setKind] = useState<Kind | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(search);
    const value = params.get('newsletter');
    if (!value) return;
    if (value in MESSAGES) setKind(value as Kind);
    params.delete('newsletter');
    const rest = params.toString();
    navigate({ pathname, search: rest ? `?${rest}` : '', hash }, { replace: true });
  }, [search, pathname, hash, navigate]);

  const msg = kind ? MESSAGES[kind] : null;
  return (
    <AnimatePresence>
      {msg && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          className="mx-auto mt-3 w-full max-w-6xl px-4 sm:px-6"
        >
          <div
            role="status"
            className="stitch flex items-center gap-3 rounded-[12px] bg-surface/80 px-4 py-2.5 text-sm"
            data-testid="newsletter-notice"
          >
            {msg.ok && <Check className="h-4 w-4 shrink-0 text-ok" aria-hidden="true" />}
            <span className="flex-1">{msg.text}</span>
            <button type="button" className="icon-btn -my-1" aria-label="Dismiss" onClick={() => setKind(null)}>
              <X className="h-4 w-4" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
