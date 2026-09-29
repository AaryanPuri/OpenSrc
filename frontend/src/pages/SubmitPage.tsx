import { ArrowLeft } from 'lucide-react';
import { useMemo } from 'react';
import { Link } from 'react-router';
import { NeedleIcon } from '../components/icons';
import { useDocumentMeta } from '../hooks/useDocumentMeta';
import { useSiteUrl } from '../seo/context';
import { submitMeta } from '../seo/meta';

/** Placeholder until the submit / flag flow lands. */
export function SubmitPage() {
  const site = useSiteUrl();
  useDocumentMeta(useMemo(() => submitMeta(site), [site]));
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center px-4 pb-24 pt-20 text-center sm:px-6 sm:pt-28">
      <span
        aria-hidden="true"
        className="grid h-20 w-20 -rotate-6 place-items-center rounded-[18px] border-2 border-dashed border-accent/60 bg-accent/[0.05] text-accent"
      >
        <NeedleIcon className="h-8 w-8" />
      </span>
      <p className="eyebrow mt-7">Coming soon</p>
      <h1 className="mt-2 text-balance font-display text-3xl font-[560] tracking-[-0.01em] sm:text-4xl">
        Submit a repo
      </h1>
      <p className="mt-3 max-w-sm text-pretty text-muted">
        Soon you'll be able to check a repo against the directory's rules and suggest it in a couple of clicks. Listing
        is free, always. Until then, repos are collected every night from GitHub.
      </p>
      <Link to="/" className="btn-seam mt-7 h-11 px-5">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back to the directory
      </Link>
    </div>
  );
}
