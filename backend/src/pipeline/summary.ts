/**
 * Markdown summary of what a run changed, used as the nightly PR's body.
 */
import type { DatasetMeta, RepoRecord } from "../../../shared/repo.js";

const MAX_LISTED = 25;
const MAX_MOVERS = 15;

const link = (r: Pick<RepoRecord, "fullName">) => `[${r.fullName}](https://github.com/${r.fullName})`;

export function summarizeChanges(before: RepoRecord[], after: RepoRecord[], meta: DatasetMeta | null): string {
  const old = new Map(before.map((r) => [r.fullName.toLowerCase(), r]));
  const cur = new Map(after.map((r) => [r.fullName.toLowerCase(), r]));
  const added = after.filter((r) => !old.has(r.fullName.toLowerCase())).sort((a, b) => b.score - a.score);
  const removed = before.filter((r) => !cur.has(r.fullName.toLowerCase())).sort((a, b) => b.score - a.score);
  const movers = after
    .flatMap((r) => {
      const prev = old.get(r.fullName.toLowerCase());
      return prev && prev.score !== r.score ? [{ r, from: prev.score, delta: r.score - prev.score }] : [];
    })
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || b.r.score - a.r.score)
    .slice(0, MAX_MOVERS);

  const lines: string[] = [];
  const delta = after.length - before.length;
  lines.push(
    `**${after.length} repos** (${delta >= 0 ? "+" : ""}${delta}), ${after.filter((r) => r.firstPrFriendly).length} first-PR friendly.`,
  );
  if (meta) lines.push(`Generated ${meta.generatedAt} using ${meta.pointsUsed} GraphQL points.`);
  lines.push("");

  const list = (title: string, repos: RepoRecord[]) => {
    lines.push(`### ${title} (${repos.length})`, "");
    if (!repos.length) lines.push("None.");
    for (const r of repos.slice(0, MAX_LISTED)) {
      lines.push(`- ${link(r)}: score ${r.score}, ${r.goodFirstIssues} good first issues, ★ ${r.stars}`);
    }
    if (repos.length > MAX_LISTED) lines.push(`- …and ${repos.length - MAX_LISTED} more`);
    lines.push("");
  };
  list("Added", added);
  list("Removed", removed);

  lines.push(`### Biggest score changes`, "");
  if (!movers.length) lines.push("None.");
  else {
    lines.push("| Repo | Score | Change |", "| --- | --- | --- |");
    for (const m of movers)
      lines.push(`| ${link(m.r)} | ${m.from} → ${m.r.score} | ${m.delta > 0 ? "+" : ""}${m.delta} |`);
  }
  lines.push("", "Review the diff, then merge to publish. Close the PR to skip tonight's update.");
  return `${lines.join("\n")}\n`;
}
