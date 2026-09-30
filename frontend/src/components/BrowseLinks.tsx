import { Link } from 'react-router';
import type { DatasetMeta } from '../../../shared/repo';
import { DOMAINS } from '../lib/dictionary';
import { fieldPageIds, languageDef, languagePageIds, LANGUAGE_PAGE_MIN } from '../lib/listPages';
import { fieldLabel, languageColor } from '../lib/repoDisplay';

export function LanguageDot({ id, className = 'h-2.5 w-2.5' }: { id: string | null; className?: string }) {
  return (
    <span
      className={`shrink-0 rounded-full ring-1 ring-inset ring-black/10 ${className}`}
      style={{ backgroundColor: languageColor(id) }}
      aria-hidden="true"
    />
  );
}

/** One language page link, as a chip: dot, name and (optionally) how many repos. */
export function LanguageChip({ id, count }: { id: string; count?: number }) {
  return (
    <Link to={`/language/${id}`} className="chip touch h-9 gap-2 px-3 text-[13px]" data-testid="language-link">
      <LanguageDot id={id} />
      {languageDef(id)?.label ?? id}
      {/* "Go" alone reads as a generic link to crawlers and screen readers. */}
      <span className="sr-only"> repos</span>
      {count !== undefined && <span className="tabular-nums text-subtle">{count.toLocaleString('en')}</span>}
    </Link>
  );
}

/** "Browse by language": every language page, so visitors and crawlers can reach them from the home page. */
export function LanguageRow({ meta }: { meta: DatasetMeta | null }) {
  if (!meta) return null;
  const ids = languagePageIds(meta);
  if (!ids.length) return null;
  return (
    <section className="mx-auto max-w-6xl px-4 sm:px-6" aria-labelledby="languages-title">
      <div className="seam-t pt-8">
        <h2 id="languages-title" className="font-display text-[1.7rem] font-[560] tracking-[-0.02em] sm:text-[2rem]">
          Browse by language
        </h2>
        <p className="mt-1 max-w-md text-sm text-muted">
          Every language with at least {LANGUAGE_PAGE_MIN} welcoming repos in the directory.
        </p>
      </div>
      <ul className="mt-5 flex flex-wrap gap-2" data-testid="language-row">
        {ids.map((id) => (
          <li key={id}>
            <LanguageChip id={id} count={meta.languages[id]} />
          </li>
        ))}
      </ul>
    </section>
  );
}

const FOOTER_LANGUAGES = 14;

/** Footer link lists: the biggest languages and every field. */
export function FooterBrowse({ meta }: { meta: DatasetMeta | null }) {
  const languages = meta ? languagePageIds(meta).slice(0, FOOTER_LANGUAGES) : [];
  const fields = meta ? fieldPageIds(meta) : DOMAINS.map((d) => d.id);
  const link = 'inline-flex min-h-8 items-center hover:text-fg hover:underline';
  return (
    <nav aria-label="Browse the directory" className="grid gap-6 text-[13px] sm:grid-cols-[1fr_2fr]">
      <div>
        <h2 className="eyebrow mb-2">Directory</h2>
        <ul className="grid grid-cols-2 gap-x-4 sm:grid-cols-1">
          <li>
            <Link to="/" className={link}>
              All repos
            </Link>
          </li>
          <li>
            <Link to="/collections" className={link}>
              Collections
            </Link>
          </li>
          <li>
            <Link to="/issues" className={link}>
              Search issues
            </Link>
          </li>
          <li>
            <Link to="/submit" className={link}>
              Submit a repo
            </Link>
          </li>
          <li>
            <a href="/feed.xml" className={link}>
              RSS feed
            </a>
          </li>
        </ul>
      </div>
      <div className="grid gap-6 sm:grid-cols-2">
        {languages.length > 0 && (
          <div>
            <h2 className="eyebrow mb-2">Languages</h2>
            <ul className="grid grid-cols-2 gap-x-4">
              {languages.map((id) => (
                <li key={id}>
                  <Link to={`/language/${id}`} className={`${link} gap-1.5`}>
                    <LanguageDot id={id} className="h-2 w-2" />
                    {languageDef(id)?.label ?? id}
                    <span className="sr-only"> repos</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
        <div>
          <h2 className="eyebrow mb-2">Fields</h2>
          <ul className="grid grid-cols-2 gap-x-4">
            {fields.map((id) => (
              <li key={id} className="min-w-0">
                <Link to={`/field/${id}`} className={`${link} truncate`}>
                  {fieldLabel(id)}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </nav>
  );
}
