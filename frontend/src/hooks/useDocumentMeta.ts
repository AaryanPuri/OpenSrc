import { useContext, useEffect } from 'react';
import { SeoContext } from '../seo/context';
import { applyMeta, type PageMeta } from '../seo/meta';

/**
 * The page's <head> (title, description, canonical, social cards, JSON-LD).
 * On the server it is collected for the pre-rendered HTML; in the browser it is
 * applied after each render that changes it. Call it once per page, from the
 * component that knows the page's content (null: leave the head as it is).
 */
export function useDocumentMeta(meta: PageMeta | null): void {
  const { head } = useContext(SeoContext);
  // Server only: rendering is the one chance to see what the page chose.
  if (head && meta) head.meta = meta;
  const key = meta ? JSON.stringify(meta) : '';
  useEffect(() => {
    if (meta) applyMeta(document, meta);
    // `key` stands for `meta`'s content, so an equal object built on each render doesn't re-apply.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
