import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import type { DatasetMeta } from '../../../shared/repo';
import { LanguageChip, LanguageDot } from '../components/BrowseLinks';
import { FieldBadge } from '../components/FieldBadge';
import { NewsletterForm } from '../components/NewsletterForm';
import { RepoGrid } from '../components/RepoGrid';
import { useDataset } from '../data/dataset';
import { useDocumentMeta } from '../hooks/useDocumentMeta';
import {
  directoryQuery,
  fieldDef,
  fieldPageIds,
  hasFieldPage,
  hasLanguagePage,
  languageDef,
  languagePageIds,
  LIST_PAGE,
  listIntro,
  listRepos,
  listStats,
  type ListKind,
  type ListStats,
} from '../lib/listPages';
import { fieldLabel } from '../lib/repoDisplay';
import { useSiteUrl } from '../seo/context';
import { listMeta } from '../seo/meta';
import { NotFoundPage } from './NotFoundPage';

/** `/language/:id`: the directory's repos in one language. */
export function LanguagePage() {
  const { id = '' } = useParams();
  const lang = languageDef(id);
  return <ListPage key={id} kind="language" id={id} label={lang?.label ?? null} badge={<LanguagePatch id={id} />} />;
}

/** `/field/:id`: the directory's repos about one field. */
export function FieldPage() {
  const { id = '' } = useParams();
  const field = fieldDef(id);
  return (
    <ListPage key={id} kind="field" id={id} label={field?.label ?? null} badge={<FieldBadge id={id} size="lg" />} />
  );
}

function LanguagePatch({ id }: { id: string }) {
  return (
    <span
      aria-hidden="true"
      className="grid h-12 w-12 shrink-0 place-items-center rounded-[12px] border border-line bg-surface/70 shadow-sticker"
    >
      <LanguageDot id={id} className="h-5 w-5" />
    </span>
  );
}

interface Props {
  kind: ListKind;
  id: string;
  /** null: not a language / field we know. */
  label: string | null;
  badge: ReactNode;
}

/**
 * A language or field page: a written intro from the list's numbers, the
 * repos best first, and links to related languages and fields.
 */
function ListPage({ kind, id, label, badge }: Props) {
  const { status, repos, meta, now, retry, partial } = useDataset();
  const site = useSiteUrl();
  const list = useMemo(() => (label ? listRepos(repos, kind, id) : []), [repos, kind, id, label]);
  const ready = status === 'ready';
  const stats = useMemo(() => partial?.stats ?? (ready ? listStats(list) : null), [partial, ready, list]);
  const total = partial?.total ?? list.length;
  const exists = meta ? (kind === 'language' ? hasLanguagePage(meta, id) : hasFieldPage(meta, id)) : !!label;
  const pageMeta = useMemo(
    () => (label && exists && stats ? listMeta(site, kind, id, label, stats, list.slice(0, LIST_PAGE)) : null),
    [label, exists, stats, site, kind, id, list],
  );
  useDocumentMeta(pageMeta);

  if (!label || !exists) return <NotFoundPage />;

  const q = directoryQuery(kind, id);
  const related = meta && stats ? relatedLinks(kind, id, stats, meta) : null;

  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-5 sm:px-6 sm:pt-8">
      <Link
        to="/"
        className="-ml-1 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-1 text-sm text-muted hover:text-fg"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        The directory
      </Link>
      <header className="mt-3 flex items-center gap-4">
        {badge}
        <div className="min-w-0">
          <p className="eyebrow">{kind === 'language' ? 'Language' : 'Field'}</p>
          <h1 className="text-balance font-display text-[2rem] font-[560] leading-tight tracking-[-0.02em] sm:text-[2.6rem]">
            {kind === 'language' ? `${label} repos to contribute to` : `${label} open-source projects`}
          </h1>
        </div>
      </header>
      {stats ? (
        <p className="mt-4 max-w-3xl text-pretty leading-relaxed text-muted" data-testid="list-intro">
          {listIntro(kind, id, label, stats)}
        </p>
      ) : (
        <div className="mt-4 max-w-3xl space-y-2" aria-hidden="true">
          <div className="skeleton h-4 w-full" />
          <div className="skeleton h-4 w-2/3" />
        </div>
      )}

      <div className="mt-8 flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <h2 className="font-display text-[22px] font-[560] tracking-[-0.01em]" aria-live="polite">
          {ready ? (
            <>
              <span className="tabular-nums">{total.toLocaleString('en')}</span> {total === 1 ? 'repo' : 'repos'}
            </>
          ) : (
            'Repos'
          )}
          <span className="sr-only"> by best score</span>
        </h2>
        <Link
          to={`/?q=${encodeURIComponent(q)}`}
          className="inline-flex min-h-11 items-center gap-1 text-[13px] font-medium text-accent underline-offset-2 hover:underline sm:min-h-0"
          data-testid="refine-in-directory"
        >
          Filter these in the directory <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>
      <div className="mt-4">
        <RepoGrid
          repos={list}
          total={total}
          status={status}
          now={now}
          onRetry={retry}
          resetKey={`${kind}:${id}`}
          emptyAction={
            <Link to="/" className="btn-seam">
              Browse the whole directory
            </Link>
          }
        />
      </div>

      {related && (
        <section className="seam-t mt-14 grid gap-8 pt-8 md:grid-cols-2" aria-label="Related pages">
          {related.map((group) =>
            group.ids.length ? (
              <div key={group.title}>
                <h2 className="font-display text-[20px] font-[560] tracking-[-0.01em]">{group.title}</h2>
                <ul className="mt-3 flex flex-wrap gap-2">
                  {group.ids.map((rid) => (
                    <li key={rid}>
                      {group.kind === 'language' ? (
                        <LanguageChip id={rid} count={meta?.languages[rid]} />
                      ) : (
                        <Link
                          to={`/field/${rid}`}
                          className="chip touch h-9 pl-1.5 pr-3 text-[13px]"
                          data-testid="field-link"
                        >
                          <FieldBadge id={rid} />
                          {fieldLabel(rid)}
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null,
          )}
        </section>
      )}

      <NewsletterForm key={`${kind}:${id}`} className="mt-14" languages={kind === 'language' ? [id] : []} />
    </div>
  );
}

interface RelatedGroup {
  title: string;
  kind: ListKind;
  ids: string[];
}

/**
 * Internal links: for a language, the fields its repos are about and the other
 * big languages; for a field, the languages its repos use and the fields that
 * come up alongside it.
 */
function relatedLinks(kind: ListKind, id: string, stats: ListStats, meta: DatasetMeta): RelatedGroup[] {
  const label = kind === 'language' ? (languageDef(id)?.label ?? id) : fieldLabel(id);
  const fill = (first: string[], rest: string[], n: number) =>
    Array.from(new Set([...first, ...rest]))
      .filter((x) => x !== id)
      .slice(0, n);
  if (kind === 'language') {
    return [
      {
        title: `What ${label} repos are about`,
        kind: 'field',
        ids: fill(
          stats.fields.map(([f]) => f).filter((f) => hasFieldPage(meta, f)),
          [],
          6,
        ),
      },
      { title: 'Other languages', kind: 'language', ids: fill([], languagePageIds(meta), 10) },
    ];
  }
  return [
    {
      title: `Languages for ${label.toLowerCase()}`,
      kind: 'language',
      ids: fill(
        stats.languages.map(([l]) => l).filter((l) => hasLanguagePage(meta, l)),
        [],
        6,
      ),
    },
    {
      title: 'Related fields',
      kind: 'field',
      ids: fill(
        stats.fields.map(([f]) => f).filter((f) => hasFieldPage(meta, f)),
        fieldPageIds(meta),
        8,
      ),
    },
  ];
}
