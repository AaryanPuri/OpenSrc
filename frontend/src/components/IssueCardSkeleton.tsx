/** Placeholder for an IssueCard while issues load. Its own module, so pages can show it without IssueCard's code. */
export function IssueCardSkeleton() {
  return (
    <div className="paper relative overflow-hidden py-4 pl-6 pr-4 sm:py-5 sm:pl-8 sm:pr-5" aria-hidden="true">
      <span className="absolute inset-y-0 left-0 w-[7px] bg-surface-3" />
      <div className="skeleton h-[18px] w-4/5" />
      <div className="mt-3 flex items-center gap-3">
        <div className="skeleton h-3.5 flex-1" />
        <div className="skeleton h-3.5 w-28" />
      </div>
      <div className="mt-4 flex items-center gap-2.5">
        <div className="skeleton h-5 w-5" />
        <div className="skeleton h-3.5 w-36" />
        <div className="skeleton h-3 w-10" />
        <div className="skeleton h-3 w-16" />
        <div className="skeleton h-3 w-20" />
      </div>
      <div className="mt-3 flex gap-1.5">
        <div className="skeleton h-[22px] w-24 rounded-full" />
        <div className="skeleton h-[22px] w-16 rounded-full" />
      </div>
    </div>
  );
}
