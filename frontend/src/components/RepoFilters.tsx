import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, SlidersHorizontal } from 'lucide-react';
import { useId, useState } from 'react';
import type { DatasetMeta } from '../../../shared/repo';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { DOMAINS, LANGUAGES, type Difficulty } from '../lib/dictionary';
import type { ParsedQuery } from '../lib/parseQuery';
import { REPO_SORT_LABELS, REPO_SORTS, type RepoSort } from '../lib/repoSearch';
import { FieldBadge } from './FieldBadge';
import { NeedleIcon } from './icons';

interface Props {
  parsed: ParsedQuery;
  first: boolean;
  sort: RepoSort;
  meta: DatasetMeta | null;
  onFirst: (on: boolean) => void;
  onDifficulty: (d: Difficulty | null) => void;
  onToggleLanguage: (id: string) => void;
  onToggleDomain: (id: string) => void;
  onSort: (s: RepoSort) => void;
}

const TOP = 8;

/** Difficulty, as the directory reads it: which repos have issues at that level. */
const LEVELS: { id: Difficulty | null; short: string; label: string }[] = [
  { id: null, short: 'Any', label: 'Any repo' },
  { id: 'beginner', short: 'First', label: 'Has good first issues' },
  { id: 'help-wanted', short: 'Some exp.', label: 'Has help-wanted issues' },
  { id: 'intermediate', short: 'Challenge', label: 'Has help-wanted issues, for a challenge' },
];

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id}>
      <h3 id={id} className="eyebrow mb-2">
        {title}
      </h3>
      {children}
    </div>
  );
}

/** Ids ordered by how many repos the directory has for them. */
const byCount = (ids: string[], counts: Record<string, number> | undefined) =>
  [...ids].sort((a, b) => (counts?.[b] ?? 0) - (counts?.[a] ?? 0));

function Body({ parsed, first, sort, meta, onFirst, onDifficulty, onToggleLanguage, onToggleDomain, onSort }: Props) {
  const [allLangs, setAllLangs] = useState(false);
  const [allDomains, setAllDomains] = useState(false);
  const pill = useId();
  const switchId = useId();

  const langOrder = byCount(
    LANGUAGES.map((l) => l.id).filter((id) => !meta || meta.languages[id]),
    meta?.languages,
  );
  const domainOrder = byCount(
    DOMAINS.map((d) => d.id),
    meta?.fields,
  );
  const langs = allLangs ? langOrder : Array.from(new Set([...langOrder.slice(0, TOP), ...parsed.languages]));
  const domains = allDomains
    ? domainOrder
    : Array.from(new Set([...domainOrder.slice(0, TOP - 2), ...parsed.domains.map((d) => d.id)]));

  return (
    <div className="space-y-5">
      {/* First-PR friendly switch */}
      <label
        htmlFor={switchId}
        className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-[12px] px-3 py-2 transition-colors ${
          first ? 'stitch bg-accent/[0.07]' : 'border border-line hover:border-line-strong'
        }`}
      >
        <NeedleIcon className={`h-4 w-4 shrink-0 ${first ? 'text-accent' : 'text-muted'}`} />
        <span className="min-w-0 flex-1">
          <span className="block text-[13.5px] font-semibold leading-tight text-fg">First-PR friendly</span>
          <span className="block text-[12px] leading-snug text-subtle">
            {meta ? `${meta.firstPrFriendly.toLocaleString('en')} repos` : 'Welcoming repos only'}
          </span>
        </span>
        <button
          id={switchId}
          type="button"
          role="switch"
          aria-checked={first}
          onClick={() => onFirst(!first)}
          className={`touch relative h-6 w-10 shrink-0 rounded-full transition-colors ${first ? 'bg-accent' : 'bg-fg/20'}`}
          data-testid="first-pr-switch"
        >
          <motion.span
            className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-surface shadow-sticker"
            animate={{ x: first ? 16 : 0 }}
            transition={{ type: 'spring', stiffness: 520, damping: 34 }}
          />
          <span className="sr-only">Only first-PR friendly repos</span>
        </button>
      </label>

      <Group title="Difficulty">
        <div className="grid grid-cols-4 rounded-[10px] bg-fg/[0.06] p-0.5 lg:grid-cols-2">
          {LEVELS.map((d) => {
            const active = parsed.difficulty === d.id;
            return (
              <button
                key={d.id ?? 'any'}
                type="button"
                aria-pressed={active}
                title={d.label}
                aria-label={d.label}
                onClick={() => onDifficulty(d.id)}
                className={`relative h-11 rounded-[8px] px-1 text-[12.5px] font-medium transition-colors lg:h-8 ${active ? 'text-bg' : 'text-muted hover:text-fg'}`}
              >
                {active && (
                  <motion.span
                    layoutId={`${pill}-d`}
                    className="absolute inset-0 rounded-[8px] bg-fg"
                    transition={{ type: 'spring', stiffness: 480, damping: 36 }}
                  />
                )}
                <span className="relative">{d.short}</span>
              </button>
            );
          })}
        </div>
      </Group>

      <Group title="Language">
        <div className="flex flex-wrap gap-1.5">
          {langs.map((id) => {
            const l = LANGUAGES.find((x) => x.id === id)!;
            return (
              <button
                key={id}
                type="button"
                className="chip touch h-9 px-3 text-xs lg:h-7 lg:px-2.5"
                aria-pressed={parsed.languages.includes(id)}
                onClick={() => onToggleLanguage(id)}
                data-testid="repo-filter-language"
              >
                <span
                  className="h-2 w-2 rounded-full ring-1 ring-black/10"
                  style={{ backgroundColor: l.color }}
                  aria-hidden="true"
                />
                {l.label}
              </button>
            );
          })}
          {langOrder.length > TOP && (
            <button
              type="button"
              className="touch h-9 px-1.5 text-xs font-medium text-accent underline-offset-2 hover:underline lg:h-7"
              onClick={() => setAllLangs((v) => !v)}
            >
              {allLangs ? 'Fewer' : `+${langOrder.length - langs.length} more`}
            </button>
          )}
        </div>
      </Group>

      <Group title="Field">
        <div className="flex flex-wrap gap-1.5">
          {domains.map((id) => {
            const d = DOMAINS.find((x) => x.id === id)!;
            return (
              <button
                key={id}
                type="button"
                className="chip touch h-9 pl-1.5 pr-3 text-xs lg:h-7 lg:pr-2.5"
                aria-pressed={parsed.domains.some((x) => x.id === id)}
                onClick={() => onToggleDomain(id)}
                data-testid="repo-filter-field"
              >
                <FieldBadge id={id} />
                {d.label}
              </button>
            );
          })}
          <button
            type="button"
            className="touch h-9 px-1.5 text-xs font-medium text-accent underline-offset-2 hover:underline lg:h-7"
            onClick={() => setAllDomains((v) => !v)}
          >
            {allDomains ? 'Fewer' : `+${domainOrder.length - domains.length} more`}
          </button>
        </div>
      </Group>

      <Group title="Sort by">
        <div className="flex flex-col gap-0.5" role="radiogroup" aria-label="Sort repos">
          {REPO_SORTS.map((s) => {
            const active = s === sort;
            return (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={active}
                title={REPO_SORT_LABELS[s].hint}
                onClick={() => onSort(s)}
                className={`flex h-11 items-center gap-2.5 rounded-[8px] px-2 text-left text-[13px] transition-colors lg:h-8 ${
                  active ? 'font-semibold text-fg' : 'text-muted hover:bg-fg/[0.05] hover:text-fg'
                }`}
                data-testid="repo-sort"
              >
                <span
                  aria-hidden="true"
                  className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full border ${active ? 'border-accent' : 'border-line-strong'}`}
                >
                  {active && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
                </span>
                {REPO_SORT_LABELS[s].label}
              </button>
            );
          })}
        </div>
      </Group>
    </div>
  );
}

/** The directory's filters: a sticky sidebar on desktop, a disclosure on smaller screens (RefinePanel's pattern). */
export function RepoFilters(props: Props) {
  const desktop = useMediaQuery('(min-width: 1024px)');
  const [open, setOpen] = useState(false);
  const id = useId();
  const active =
    (props.first ? 1 : 0) +
    (props.parsed.difficulty ? 1 : 0) +
    props.parsed.languages.length +
    props.parsed.domains.length +
    (props.sort !== 'score' ? 1 : 0);

  if (desktop) {
    return (
      <aside aria-label="Filter repos" className="self-start lg:sticky lg:top-24">
        <Body {...props} />
      </aside>
    );
  }

  return (
    <div>
      <button
        type="button"
        className="btn-seam w-full justify-between"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        data-testid="repo-filters-toggle"
      >
        <span className="inline-flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-muted" aria-hidden="true" />
          Filter and sort
          {active > 0 && (
            <span className="rounded-full bg-accent px-1.5 text-[11px] font-semibold tabular-nums text-accent-fg">
              {active}
            </span>
          )}
        </span>
        <ChevronDown
          className={`h-4 w-4 text-muted transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={id}
            role="region"
            aria-label="Filter repos"
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            transition={{ duration: 0.25, ease: [0.2, 0.7, 0.2, 1] }}
            className="overflow-hidden"
          >
            <div className="pt-4">
              <Body {...props} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
