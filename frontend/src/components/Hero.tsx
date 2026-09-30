import { motion, useMotionValue, useReducedMotion, useSpring, useTransform, type MotionValue } from 'framer-motion';
import { useEntrance } from '../hooks/useEntrance';
import { ChevronDown } from 'lucide-react';
import { forwardRef, useId, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { DOMAINS } from '../lib/dictionary';
import { ALL_FIELDS as TILES } from '../lib/examples';
import { domainFabric, fabricStyle } from '../lib/fabric';
import { fieldIcon } from '../lib/fieldIcons';
import { Composer } from './Composer';
import { FieldBadge } from './FieldBadge';
import { NeedleIcon } from './icons';

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSubmit: (v: string) => void;
  onEdit: (v: string) => void;
  loading: boolean;
  /** `repos`: the directory's landing (its own headline, copy and search examples). */
  mode?: 'issues' | 'repos';
  /** Repos in the directory, for the copy. */
  repoCount?: number;
  /** One quiet line under the search (the directory's "Looking for your first PR?"). */
  hint?: ReactNode;
}

/** Hand-sewn running stitch under a phrase; draws itself left to right. */
function StitchUnderline() {
  const enter = useEntrance();
  return (
    <svg
      viewBox="0 0 300 18"
      preserveAspectRatio="none"
      className="pointer-events-none absolute -bottom-2 left-0 h-[0.28em] w-full overflow-visible sm:-bottom-3"
      aria-hidden="true"
    >
      <defs>
        <clipPath id="stitch-reveal">
          <motion.rect
            x="0"
            y="-10"
            width="300"
            height="40"
            initial={enter({ scaleX: 0 })}
            animate={{ scaleX: 1 }}
            transition={{ duration: 1.1, delay: 0.35, ease: [0.6, 0.05, 0.3, 1] }}
            style={{ originX: 0 }}
          />
        </clipPath>
      </defs>
      <path
        d="M3 11 C 40 3, 70 16, 110 9 S 180 4, 215 11 S 270 15, 297 6"
        fill="none"
        className="stroke-accent"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeDasharray="11 7"
        clipPath="url(#stitch-reveal)"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/** The italic, underlined end of the headline. */
function HeadlineStitch({ children }: { children: ReactNode }) {
  return (
    <span className="relative inline-block whitespace-nowrap">
      <em className="font-[480] italic" style={{ fontVariationSettings: '"SOFT" 100, "WONK" 1' }}>
        {children}
      </em>
      <StitchUnderline />
    </span>
  );
}

const COLLAGE_LABEL: Record<string, string> = {
  databases: 'Databases',
  accessibility: 'A11y',
  ml: 'ML & AI',
  gamedev: 'Game dev',
  networking: 'Networking',
  frontend: 'Frontend',
  observability: 'Observability',
};

const COLLAGE: { id: string; col: string; row: string; depth: number; r: number; d: number }[] = [
  // Tilts stay ≤1.5° (the drift adds at most 1°), so nothing leans more than 2.5°.
  { id: 'databases', col: '1 / span 2', row: '1', depth: 10, r: -1, d: 9 },
  { id: 'accessibility', col: '3', row: '1 / span 2', depth: 16, r: 1.5, d: 11 },
  { id: 'ml', col: '1', row: '2 / span 2', depth: 7, r: 1, d: 10 },
  { id: '__you', col: '2', row: '2', depth: 22, r: -1.5, d: 7 },
  { id: 'gamedev', col: '2 / span 2', row: '3', depth: 12, r: -1, d: 12 },
  { id: 'networking', col: '1', row: '4', depth: 18, r: 1.5, d: 8 },
  { id: 'frontend', col: '2', row: '4', depth: 9, r: -1.5, d: 10 },
  { id: 'observability', col: '3', row: '4', depth: 14, r: 1, d: 9 },
];

function CollagePatch({
  p,
  mx,
  my,
  index,
}: {
  p: (typeof COLLAGE)[number];
  mx: MotionValue<number>;
  my: MotionValue<number>;
  index: number;
}) {
  const enter = useEntrance();
  const x = useTransform(mx, (v) => v * p.depth);
  const y = useTransform(my, (v) => v * p.depth);
  const you = p.id === '__you';
  const label = you ? null : COLLAGE_LABEL[p.id];
  return (
    <motion.div style={{ gridColumn: p.col, gridRow: p.row, x, y }} className="relative">
      <motion.div
        initial={enter({ scale: 0.6, rotate: p.r * 4 })}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 220, damping: 16, delay: 0.25 + index * 0.07 }}
        className="h-full w-full"
      >
        <div
          className="drift h-full w-full"
          style={{
            ['--r' as string]: `${p.r}deg`,
            ['--d' as string]: `${p.d}s`,
            ['--delay' as string]: `${-index * 1.3}s`,
          }}
        >
          {you ? (
            <div className="grid h-full w-full place-items-center rounded-[14px] border-2 border-dashed border-accent/70 bg-surface/60 text-accent">
              <div className="flex flex-col items-center gap-1.5">
                <NeedleIcon className="h-7 w-7" />
                <span className="font-display text-sm italic">your patch</span>
              </div>
            </div>
          ) : (
            <div
              className="relative grid h-full w-full place-items-center overflow-hidden rounded-[14px] shadow-sticker ring-1 ring-black/10"
              style={{ backgroundColor: domainFabric(p.id).color }}
            >
              <span className="absolute inset-0 opacity-45" style={fabricStyle(domainFabric(p.id), 1.3)} />
              <CollageIcon id={p.id} />
              <span
                className="absolute bottom-2.5 left-2.5 rounded-[5px] bg-[#fdf9f1] px-1.5 py-0.5 text-[12px] font-semibold tracking-[0.04em] text-[#241d16] shadow-sm"
                style={{ fontVariantCaps: 'all-small-caps' }}
              >
                {label}
              </span>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

function CollageIcon({ id }: { id: string }) {
  const Icon = fieldIcon(id);
  const ink = domainFabric(id).thread === 'light' ? 'text-white' : 'text-[#2a1d12]';
  return (
    <Icon
      className={`relative -mt-3 h-9 w-9 ${ink} drop-shadow-[0_1px_2px_rgb(0_0_0/0.2)] sm:h-10 sm:w-10`}
      strokeWidth={1.6}
    />
  );
}

function QuiltCollage({ mx, my }: { mx: MotionValue<number>; my: MotionValue<number> }) {
  return (
    <div
      aria-hidden="true"
      className="relative mx-auto grid aspect-[3/4] w-full max-w-[380px] grid-cols-3 grid-rows-4 gap-3"
    >
      {COLLAGE.map((p, i) => (
        <CollagePatch key={p.id} p={p} mx={mx} my={my} index={i} />
      ))}
    </div>
  );
}

/** A thin band of fabric for small screens, where the collage would crowd the search. */
function SelvageBand() {
  const enter = useEntrance();
  const ids = [
    'databases',
    'ml',
    'frontend',
    'devops',
    'security',
    'gamedev',
    'accessibility',
    'networking',
    'embedded',
  ];
  return (
    <div aria-hidden="true" className="mb-7 flex gap-1.5 lg:hidden">
      {ids.map((id, i) => (
        <motion.span
          key={id}
          initial={enter({ scaleY: 0.2 })}
          animate={{ scaleY: 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 18, delay: 0.1 + i * 0.04 }}
          className="h-3 flex-1 origin-bottom rounded-[3px] ring-1 ring-black/10"
          style={fabricStyle(domainFabric(id), 0.6)}
        />
      ))}
    </div>
  );
}

export const Hero = forwardRef<HTMLTextAreaElement, Props>(function Hero(
  { value, onChange, onSubmit, onEdit, loading, mode = 'issues', repoCount, hint },
  ref,
) {
  const repos = mode === 'repos';
  const reduce = useReducedMotion();
  const section = useRef<HTMLElement>(null);
  const rawX = useMotionValue(0);
  const rawY = useMotionValue(0);
  const mx = useSpring(rawX, { stiffness: 60, damping: 18 });
  const my = useSpring(rawY, { stiffness: 60, damping: 18 });

  const onPointerMove = (e: React.PointerEvent) => {
    if (reduce || e.pointerType !== 'mouse' || !section.current) return;
    const r = section.current.getBoundingClientRect();
    rawX.set(((e.clientX - r.left) / r.width - 0.5) * 2);
    rawY.set(((e.clientY - r.top) / r.height - 0.5) * 2);
  };

  return (
    <section ref={section} onPointerMove={onPointerMove} className="relative" aria-labelledby="hero-title">
      <div className="mx-auto grid max-w-6xl items-center gap-x-14 gap-y-10 px-4 pb-12 pt-8 sm:px-6 sm:pt-14 lg:grid-cols-[minmax(0,1fr)_340px] lg:pb-20 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0">
          <SelvageBand />
          <p className="eyebrow">An open-source repository finder</p>
          <h1
            id="hero-title"
            className="mt-5 font-display text-[2.9rem] font-[560] leading-[0.95] tracking-[-0.035em] text-fg sm:text-[4.4rem] lg:text-[5rem]"
            style={{ fontVariationSettings: '"SOFT" 50, "WONK" 1' }}
          >
            {repos ? (
              <>
                Find a repo
                <br />
                that wants <HeadlineStitch>your patch.</HeadlineStitch>
              </>
            ) : (
              <>
                Stitch yourself
                <br />
                into <HeadlineStitch>open source.</HeadlineStitch>
              </>
            )}
          </h1>
          <p className="mt-7 max-w-[34rem] text-pretty text-[16px] leading-relaxed text-muted sm:text-[17px]">
            {repos ? (
              <>
                {repoCount ? `${repoCount.toLocaleString('en')} open-source projects` : 'Open-source projects'} with
                open good first issues, scored on how <span className="text-fg">welcoming they are to a first PR</span>.
                Say what you like: a language, a field, fast maintainers.
              </>
            ) : (
              <>
                Say what you like: a language, a field, how much time you have. OpenSrc sews it into a precise GitHub
                search for open issues <span className="text-fg">nobody has claimed yet</span>.
              </>
            )}
          </p>

          <div className="mt-8">
            <Composer
              ref={ref}
              value={value}
              onChange={onChange}
              onSubmit={onSubmit}
              onEdit={onEdit}
              loading={loading}
              autoplay
              mode={mode}
            />
          </div>
          {hint && <div className="mt-3">{hint}</div>}
        </div>

        <div className="hidden lg:block">
          <QuiltCollage mx={mx} my={my} />
        </div>
      </div>
    </section>
  );
});

interface QuiltProps {
  /** Tiles run a search… */
  onPick?: (query: string) => void;
  /** …or link to a page (the directory's field pages). */
  hrefFor?: (fieldId: string) => string;
  title?: string;
  sub?: string;
  compact?: boolean;
}

const MotionLink = motion.create(Link);

const tileProps = (i: number) => ({
  whileHover: { y: -3, rotate: i % 2 ? 0.6 : -0.6 },
  whileTap: { scale: 0.97 },
  transition: { type: 'spring' as const, stiffness: 400, damping: 22 },
  className:
    'tile group relative flex h-full min-h-16 w-full items-center gap-3 rounded-[14px] border border-line bg-surface/50 p-2.5 text-left transition-[background-color,border-color,box-shadow] duration-200 hover:border-line-strong hover:bg-surface hover:shadow-lift sm:p-3.5',
  'data-testid': 'domain-tile',
});

/** "Pick a patch": the domain tiles, laid out like a quilt. */
export function DomainQuilt({
  onPick,
  hrefFor,
  title = 'Pick a patch',
  sub = 'Start from a field you care about. We understand 22 of them, in plain words.',
  compact,
}: QuiltProps) {
  const enter = useEntrance();
  const wide = useMediaQuery('(min-width: 640px)');
  const [showAll, setShowAll] = useState(false);
  const listId = useId();
  const initial = wide ? 12 : 6;
  const tiles = showAll ? TILES : TILES.slice(0, initial);

  return (
    <section className={`mx-auto max-w-6xl px-4 sm:px-6 ${compact ? '' : 'pb-24'}`} aria-labelledby="quilt-title">
      <div className={`seam-t flex flex-wrap items-end justify-between gap-x-6 gap-y-2 ${compact ? 'pt-6' : 'pt-10'}`}>
        <div>
          <h2
            id="quilt-title"
            className={`font-display font-[560] tracking-[-0.02em] ${compact ? 'text-2xl' : 'text-[2rem] sm:text-[2.4rem]'}`}
          >
            {title}
          </h2>
          <p className="mt-1 max-w-md text-sm text-muted">{sub}</p>
        </div>
      </div>
      <ul id={listId} className="mt-6 grid grid-cols-1 gap-2.5 sm:grid-cols-2 sm:gap-3 lg:grid-cols-4">
        {tiles.map((f, i) => {
          const def = DOMAINS.find((d) => d.id === f.id)!;
          return (
            <motion.li
              key={f.id}
              initial={enter({ y: 18, rotate: i % 2 ? 1 : -1 })}
              whileInView={{ y: 0, rotate: 0 }}
              viewport={{ once: true, margin: '-40px' }}
              transition={{ type: 'spring', stiffness: 260, damping: 22, delay: (i % 4) * 0.05 }}
            >
              {hrefFor ? (
                <MotionLink to={hrefFor(f.id)} {...tileProps(i)}>
                  <FieldBadge id={f.id} size="lg" hoverShift />
                  <span className="min-w-0">
                    <span className="block font-display text-[16px] font-[560] leading-tight tracking-[-0.01em] text-fg sm:text-[17px]">
                      {def.label}
                    </span>
                    <span className="mt-0.5 block truncate text-xs leading-snug text-subtle">{f.hint}</span>
                  </span>
                </MotionLink>
              ) : (
                <motion.button type="button" onClick={() => onPick?.(f.query)} {...tileProps(i)}>
                  <FieldBadge id={f.id} size="lg" hoverShift />
                  <span className="min-w-0">
                    <span className="block font-display text-[16px] font-[560] leading-tight tracking-[-0.01em] text-fg sm:text-[17px]">
                      {def.label}
                    </span>
                    <span className="mt-0.5 block truncate text-xs leading-snug text-subtle">{f.hint}</span>
                  </span>
                </motion.button>
              )}
            </motion.li>
          );
        })}
      </ul>
      {TILES.length > initial && (
        <div className="mt-4 flex justify-center sm:justify-start">
          <button
            type="button"
            className="btn-seam"
            aria-expanded={showAll}
            aria-controls={listId}
            onClick={() => setShowAll((v) => !v)}
            data-testid="show-all-fields"
          >
            {showAll ? 'Show fewer' : `Show all ${TILES.length}`}
            <ChevronDown className={`h-4 w-4 transition-transform ${showAll ? 'rotate-180' : ''}`} aria-hidden="true" />
          </button>
        </div>
      )}
    </section>
  );
}
