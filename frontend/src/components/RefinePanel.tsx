import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, SlidersHorizontal } from 'lucide-react';
import { useId, useState } from 'react';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { DIFFICULTIES, DOMAINS, ISSUE_TYPES, LANGUAGES, type Difficulty, type IssueType } from '../lib/dictionary';
import type { ParsedQuery } from '../lib/parseQuery';
import { FieldBadge } from './FieldBadge';

interface Props {
  parsed: ParsedQuery;
  onDifficulty: (d: Difficulty | null) => void;
  onToggleLanguage: (id: string) => void;
  onToggleType: (t: IssueType) => void;
  onToggleDomain: (id: string) => void;
}

const TOP_LANGS = ['rust', 'python', 'go', 'typescript', 'javascript', 'java'];
const TOP_DOMAINS = ['databases', 'ml', 'frontend', 'devops', 'security'];

const SHORT: Record<string, string> = {
  any: 'Any',
  beginner: 'First',
  'help-wanted': 'Some exp.',
  intermediate: 'Challenge',
};

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

function Body({ parsed, onDifficulty, onToggleLanguage, onToggleType, onToggleDomain }: Props) {
  const [allLangs, setAllLangs] = useState(false);
  const [allDomains, setAllDomains] = useState(false);
  const langs = allLangs ? LANGUAGES.map((l) => l.id) : Array.from(new Set([...TOP_LANGS, ...parsed.languages]));
  const domains = allDomains
    ? DOMAINS.map((d) => d.id)
    : Array.from(new Set([...TOP_DOMAINS, ...parsed.domains.map((d) => d.id)]));
  const pill = useId();

  return (
    <div className="space-y-5">
      <Group title="Difficulty">
        <div className="grid grid-cols-4 rounded-[10px] bg-fg/[0.06] p-0.5 lg:grid-cols-2">
          {([null, 'beginner', 'help-wanted', 'intermediate'] as (Difficulty | null)[]).map((d) => {
            const active = parsed.difficulty === d;
            return (
              <button
                key={d ?? 'any'}
                type="button"
                aria-pressed={active}
                title={d ? DIFFICULTIES[d].label : 'Any difficulty'}
                aria-label={d ? DIFFICULTIES[d].label : 'Any difficulty'}
                onClick={() => onDifficulty(d)}
                className={`relative h-11 rounded-[8px] px-1 text-[12.5px] font-medium transition-colors lg:h-8 ${active ? 'text-bg' : 'text-muted hover:text-fg'}`}
              >
                {active && (
                  <motion.span
                    layoutId={`${pill}-d`}
                    className="absolute inset-0 rounded-[8px] bg-fg"
                    transition={{ type: 'spring', stiffness: 480, damping: 36 }}
                  />
                )}
                <span className="relative">{SHORT[d ?? 'any']}</span>
              </button>
            );
          })}
        </div>
      </Group>

      <Group title="Kind of work">
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(ISSUE_TYPES) as IssueType[]).map((t) => (
            <button
              key={t}
              type="button"
              className="chip touch h-9 px-3 text-xs lg:h-7 lg:px-2.5"
              aria-pressed={parsed.types.includes(t)}
              onClick={() => onToggleType(t)}
            >
              {ISSUE_TYPES[t].label}
            </button>
          ))}
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
                data-testid="refine-language"
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
          <button
            type="button"
            className="touch h-9 px-1.5 text-xs font-medium text-accent underline-offset-2 hover:underline lg:h-7"
            onClick={() => setAllLangs((v) => !v)}
          >
            {allLangs ? 'Fewer' : `+${LANGUAGES.length - langs.length} more`}
          </button>
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
              >
                <FieldBadge id={id} />
                {d.label.replace(' & ', ' & ')}
              </button>
            );
          })}
          <button
            type="button"
            className="touch h-9 px-1.5 text-xs font-medium text-accent underline-offset-2 hover:underline lg:h-7"
            onClick={() => setAllDomains((v) => !v)}
          >
            {allDomains ? 'Fewer' : `+${DOMAINS.length - domains.length} more`}
          </button>
        </div>
      </Group>
    </div>
  );
}

/** Sticky, compact sidebar on desktop; a disclosure on smaller screens. Rendered once. */
export function RefinePanel(props: Props) {
  const desktop = useMediaQuery('(min-width: 1024px)');
  const [open, setOpen] = useState(false);
  const id = useId();
  const active =
    (props.parsed.difficulty ? 1 : 0) +
    props.parsed.languages.length +
    props.parsed.types.length +
    props.parsed.domains.length;

  if (desktop) {
    return (
      <aside aria-label="Refine results" className="self-start lg:sticky lg:top-24">
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
      >
        <span className="inline-flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-muted" aria-hidden="true" />
          Refine
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
            aria-label="Refine results"
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
