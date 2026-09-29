import { scoreLevel as level } from '../lib/repoDisplay';

/**
 * The repo score (0–100) as five running stitches, filled one per 20 points,
 * with the number beside it. The tooltip and screen-reader text say what it is.
 */
export function ScoreStitches({ score, size = 'sm' }: { score: number; size?: 'sm' | 'lg' }) {
  const filled = Math.max(1, Math.round(score / 20));
  const l = level(score);
  const lg = size === 'lg';
  return (
    <span
      className="inline-flex shrink-0 items-center gap-2"
      title={`Contributor score ${score}/100: ${l.label.toLowerCase()}`}
      data-testid="score-stitches"
    >
      <span className={`flex items-center ${lg ? 'gap-1' : 'gap-[3px]'}`} aria-hidden="true">
        {[0, 1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className={`rounded-full ${lg ? 'h-1 w-3' : 'h-[3px] w-[7px]'} ${i < filled ? l.bar : 'bg-line'}`}
          />
        ))}
      </span>
      <span className={`font-semibold tabular-nums ${l.text} ${lg ? 'text-lg' : 'text-xs'}`}>
        {score}
        <span className="sr-only"> out of 100 contributor score, {l.label.toLowerCase()}</span>
      </span>
    </span>
  );
}
