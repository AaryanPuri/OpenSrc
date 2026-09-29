import { motion } from 'framer-motion';
import { useEntrance } from '../hooks/useEntrance';
import { ArrowLeft } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { useDocumentMeta } from '../hooks/useDocumentMeta';
import { useSiteUrl } from '../seo/context';
import { notFoundMeta } from '../seo/meta';

interface Props {
  title?: string;
  body?: ReactNode;
  /** Replaces the "Back to OpenSrc" link. */
  actions?: ReactNode;
  /** The page's title (it is never indexed). */
  documentTitle?: string;
}

/** Any path we don't know: an empty, dashed patch where the page should be. */
export function NotFoundPage({
  title = 'This patch is missing',
  body = 'Nothing is stitched in at this address. It may have moved, or the link has a loose thread.',
  actions,
  documentTitle,
}: Props) {
  const enter = useEntrance();
  const site = useSiteUrl();
  const { pathname } = useLocation();
  useDocumentMeta(useMemo(() => notFoundMeta(site, pathname, documentTitle), [site, pathname, documentTitle]));

  return (
    <div className="mx-auto flex max-w-xl flex-col items-center px-4 pb-24 pt-20 text-center sm:px-6 sm:pt-28">
      <motion.span
        aria-hidden="true"
        initial={enter({ rotate: -20, scale: 0.6 })}
        animate={{ rotate: -6, scale: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 14 }}
        className="grid h-20 w-20 place-items-center rounded-[18px] border-2 border-dashed border-accent/60 bg-accent/[0.05] font-display text-2xl font-[560] text-accent"
      >
        404
      </motion.span>
      <h1 className="mt-7 text-balance font-display text-3xl font-[560] tracking-[-0.01em] sm:text-4xl">{title}</h1>
      <p className="mt-3 max-w-sm text-pretty text-muted">{body}</p>
      <div className="mt-7 flex flex-wrap justify-center gap-2.5">
        {actions ?? (
          <Link to="/" className="btn-seam h-11 px-5">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Back to OpenSrc
          </Link>
        )}
      </div>
    </div>
  );
}
