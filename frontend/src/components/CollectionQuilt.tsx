import { motion } from 'framer-motion';
import { useEntrance } from '../hooks/useEntrance';
import { Link } from 'react-router';
import { COLLECTIONS, type Collection } from '../../../shared/collections';
import { fabricStyle } from '../lib/fabric';
import { COLLECTION_LOOK } from '../lib/repoDisplay';

export function CollectionBlockArt({ c, className = '' }: { c: Collection; className?: string }) {
  const look = COLLECTION_LOOK[c.id];
  const Icon = look.icon;
  const ink = look.fabric.thread === 'light' ? 'text-white' : 'text-[#2a1d12]';
  return (
    <span
      aria-hidden="true"
      className={`relative grid place-items-center overflow-hidden ring-1 ring-black/10 ${className}`}
      style={{ backgroundColor: look.fabric.color }}
    >
      <span
        className="absolute -inset-4 opacity-50 transition-transform duration-500 ease-out group-hover:translate-x-2 group-hover:translate-y-1.5 group-hover:rotate-3"
        style={fabricStyle(look.fabric, 1.2)}
      />
      <Icon className={`relative h-8 w-8 ${ink} drop-shadow-[0_1px_2px_rgb(0_0_0/0.22)]`} strokeWidth={1.6} />
    </span>
  );
}

interface Props {
  title?: string;
  sub?: string;
  /** Id of the section title. */
  headingId?: string;
  /** The collections page: no section title (the page has one), the full description on the blocks. */
  detailed?: boolean;
}

/**
 * The five collections as big quilt blocks, each linking to its page: a title and a short
 * blurb, no repo counts (a collection's own page says how many it holds, in its grid heading).
 */
export function CollectionQuilt({
  title = 'Collections',
  sub = 'Hand-cut views of the directory.',
  headingId = 'collections-title',
  detailed = false,
}: Props) {
  const enter = useEntrance();
  return (
    <section className="mx-auto max-w-6xl px-4 sm:px-6" aria-labelledby={headingId}>
      <div
        className={`flex flex-wrap items-end justify-between gap-x-6 gap-y-1 ${detailed ? 'sr-only' : 'seam-t pt-8'}`}
      >
        <div>
          <h2 id={headingId} className="font-display text-[1.7rem] font-[560] tracking-[-0.02em] sm:text-[2rem]">
            {title}
          </h2>
          <p className="mt-1 max-w-md text-sm text-muted">{sub}</p>
        </div>
      </div>
      <ul
        className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 lg:grid-cols-5"
        data-testid="collection-quilt"
      >
        {COLLECTIONS.map((c, i) => (
          <motion.li
            key={c.id}
            className={i === 0 ? 'col-span-2 sm:col-span-1' : ''}
            initial={enter({ y: 18, rotate: i % 2 ? 1 : -1 })}
            whileInView={{ y: 0, rotate: 0 }}
            viewport={{ once: true, margin: '-40px' }}
            transition={{ type: 'spring', stiffness: 260, damping: 22, delay: i * 0.05 }}
          >
            <motion.div
              className="h-full"
              whileHover={{ y: -3, rotate: i % 2 ? 0.6 : -0.6 }}
              whileTap={{ scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 400, damping: 22 }}
            >
              <Link
                to={`/collections/${c.id}`}
                className="group flex h-full flex-col overflow-hidden rounded-[16px] border border-line bg-surface/60 transition-[background-color,border-color,box-shadow] duration-200 hover:border-line-strong hover:bg-surface hover:shadow-lift"
                data-testid="collection-block"
              >
                <CollectionBlockArt c={c} className="h-20 w-full sm:h-24" />
                <span className="flex flex-1 flex-col gap-1 p-3">
                  <span className="font-display text-[16px] font-[560] leading-tight tracking-[-0.01em] text-fg">
                    {c.title}
                  </span>
                  <span className="text-[12.5px] leading-snug text-muted" data-testid="collection-blurb">
                    {detailed ? c.description : c.blurb}
                  </span>
                </span>
              </Link>
            </motion.div>
          </motion.li>
        ))}
      </ul>
    </section>
  );
}
