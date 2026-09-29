import { useDatasetMeta } from '../data/dataset';
import { FooterBrowse } from './BrowseLinks';
import { Wordmark } from './Header';

export function Footer() {
  const meta = useDatasetMeta();
  return (
    <footer className="seam-t">
      <div className="mx-auto max-w-6xl px-4 pt-8 sm:px-6">
        <FooterBrowse meta={meta} />
      </div>
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-7 text-xs text-subtle sm:flex-row sm:items-center sm:px-6">
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <Wordmark className="!text-[16px] text-fg" />
          <span>Stitch yourself into open source. Built on the GitHub search API, not affiliated with GitHub.</span>
        </div>
        <div className="flex items-center gap-3 sm:ml-auto">
          <span className="inline-flex items-center gap-1.5">
            <kbd>/</kbd> search
          </span>
          <span className="inline-flex items-center gap-1.5">
            <kbd>↵</kbd> find
          </span>
          <span className="inline-flex items-center gap-1.5">
            <kbd>esc</kbd> close
          </span>
        </div>
      </div>
    </footer>
  );
}
