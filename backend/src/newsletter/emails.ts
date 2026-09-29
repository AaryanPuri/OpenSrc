/**
 * The newsletter's emails, as table-based HTML with inline styles (what mail clients
 * render) plus a plain-text part. The look follows the site's quilt: warm paper,
 * dashed stitching, a rust accent and a coloured patch per repo.
 */
import { LANGUAGES } from "../../../shared/dictionary.js";
import type { RepoRecord } from "../../../shared/repo.js";

const C = {
  bg: "#f5eee1",
  paper: "#fcf8f0",
  line: "#cdbea4",
  fg: "#241d16",
  muted: "#4e4234",
  subtle: "#62564a",
  accent: "#b03820",
  ok: "#1e683c",
};
const SERIF = "Georgia, 'Times New Roman', serif";
const SANS = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

export interface Email {
  subject: string;
  html: string;
  text: string;
}

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
}

export const languageLabel = (id: string) => LANGUAGES.find((l) => l.id === id)?.label ?? id;
const languageColor = (id: string | null) => LANGUAGES.find((l) => l.id === id)?.color ?? C.line;

export function languageList(ids: string[]): string {
  const labels = ids.map(languageLabel);
  if (labels.length <= 1) return labels[0] ?? "any language";
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

const compact = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, "")}k` : String(n);

function layout({ preheader, body, footer }: { preheader: string; body: string; footer: string }): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><title>OpenSrc</title></head>
<body style="margin:0;padding:0;background:${C.bg};color:${C.fg};font-family:${SANS};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg};">
<tr><td align="center" style="padding:28px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;">
<tr><td style="padding:0 6px 18px;">
<span style="font-family:${SERIF};font-size:24px;font-weight:600;letter-spacing:-0.02em;color:${C.fg};">Open<em style="color:${C.accent};">Src</em></span>
</td></tr>
<tr><td style="background:${C.paper};border:2px dashed ${C.line};border-radius:16px;padding:26px 24px;">
${body}
</td></tr>
<tr><td style="padding:18px 8px 0;font-size:12px;line-height:1.6;color:${C.subtle};">
${footer}
</td></tr>
</table></td></tr></table></body></html>`;
}

function button(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 6px;"><tr>
<td style="background:${C.fg};border-radius:10px;"><a href="${esc(href)}" style="display:inline-block;padding:12px 20px;font-weight:600;font-size:15px;color:${C.paper};text-decoration:none;">${esc(label)}</a></td>
</tr></table>`;
}

export function confirmEmail({
  site,
  confirmUrl,
  languages,
}: {
  site: string;
  confirmUrl: string;
  languages: string[];
}): Email {
  const what = languages.length ? `new first-PR repos in ${languageList(languages)}` : "new first-PR repos";
  const subject = "Confirm your weekly patch from OpenSrc";
  const html = layout({
    preheader: `One click and you'll get ${what}, every Monday.`,
    body: `<h1 style="margin:0;font-family:${SERIF};font-size:26px;font-weight:600;line-height:1.2;">Stitch yourself in</h1>
<p style="margin:14px 0 0;font-size:16px;line-height:1.55;color:${C.muted};">Confirm your address and every Monday we'll send you ${esc(what)}: projects with open good first issues, a CONTRIBUTING guide and maintainers who reply.</p>
${button(confirmUrl, "Confirm my subscription")}
<p style="margin:14px 0 0;font-size:13px;line-height:1.5;color:${C.subtle};">The link works for 7 days. If you didn't ask for this, ignore this email and nothing will be sent.</p>`,
    footer: `Sent by <a href="${esc(site)}" style="color:${C.subtle};">OpenSrc</a> because someone entered this address on the site. Questions? Reply to this email.`,
  });
  const text = `Stitch yourself in

Confirm your address and every Monday we'll send you ${what}: projects with open good first issues, a CONTRIBUTING guide and maintainers who reply.

Confirm: ${confirmUrl}

The link works for 7 days. If you didn't ask for this, ignore this email and nothing will be sent.

OpenSrc · ${site}`;
  return { subject, html, text };
}

export interface DigestSection {
  /** Language id, or null for "any language". */
  language: string | null;
  /** Repos first listed this week that are first-PR friendly. */
  fresh: RepoRecord[];
  /** Best-scoring repos added to fill the section. */
  topUp: RepoRecord[];
}

function repoRow(r: RepoRecord, site: string): string {
  const url = `${site}/repo/${r.fullName}`;
  const facts = [
    `<strong style="color:${C.fg};">${r.goodFirstIssues}</strong> good first issue${r.goodFirstIssues === 1 ? "" : "s"}`,
    r.languageName ? esc(r.languageName) : null,
    `&#9733; ${compact(r.stars)}`,
    `score ${r.score}`,
  ].filter(Boolean);
  return `<tr><td style="padding:0 0 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid ${C.line};border-radius:12px;">
<tr><td width="6" style="background:${languageColor(r.language)};border-radius:12px 0 0 12px;">&nbsp;</td>
<td style="padding:12px 14px;">
<a href="${esc(url)}" style="font-size:16px;font-weight:600;color:${C.fg};text-decoration:none;"><span style="font-weight:400;color:${C.subtle};">${esc(r.owner)}/</span>${esc(r.name)}</a>${
    r.firstPrFriendly
      ? ` <span style="display:inline-block;margin-left:4px;padding:1px 7px;border:1px dashed ${C.ok};border-radius:999px;font-size:11px;color:${C.ok};white-space:nowrap;">First-PR friendly</span>`
      : ""
  }
${r.description ? `<div style="margin-top:4px;font-size:14px;line-height:1.45;color:${C.muted};">${esc(r.description.length > 180 ? `${r.description.slice(0, 177)}…` : r.description)}</div>` : ""}
<div style="margin-top:6px;font-size:12px;color:${C.subtle};">${facts.join(" &middot; ")}</div>
</td></tr></table></td></tr>`;
}

function sectionTitle(s: DigestSection): string {
  const lang = s.language ? languageLabel(s.language) : null;
  if (s.fresh.length) return lang ? `New first-PR repos in ${lang} this week` : "New first-PR repos this week";
  return lang ? `${lang} repos ready for your first PR` : "Repos ready for your first PR";
}

export function digestSubject(sections: DigestSection[]): string {
  const fresh = sections.reduce((n, s) => n + s.fresh.length, 0);
  const langs = sections.map((s) => s.language).filter((l): l is string => !!l);
  const where = langs.length ? ` in ${languageList(langs)}` : "";
  return fresh
    ? `${fresh} new first-PR repo${fresh === 1 ? "" : "s"}${where} this week`
    : `This week's patch: repos${where} ready for your first PR`;
}

export function digestEmail({
  site,
  sections,
  unsubscribeUrl,
  week,
}: {
  site: string;
  sections: DigestSection[];
  unsubscribeUrl: string;
  week: string;
}): Email {
  const subject = digestSubject(sections);
  const bodySections = sections
    .map((s) => {
      const lang = s.language ? languageLabel(s.language) : null;
      const more = s.language ? `${site}/language/${s.language}` : `${site}/collections/first-pr`;
      return `<h2 style="margin:0 0 4px;font-family:${SERIF};font-size:21px;font-weight:600;line-height:1.25;">${esc(sectionTitle(s))}</h2>
${
  s.fresh.length && s.topUp.length
    ? `<p style="margin:0 0 12px;font-size:13px;color:${C.subtle};">${s.fresh.length} new, plus the best-scoring ${esc(lang ?? "")} repos right now.</p>`
    : !s.fresh.length
      ? `<p style="margin:0 0 12px;font-size:13px;color:${C.subtle};">Nothing new joined this week, so here are the best-scoring ones.</p>`
      : `<div style="height:8px;"></div>`
}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${[...s.fresh, ...s.topUp].map((r) => repoRow(r, site)).join("")}</table>
<p style="margin:0 0 24px;font-size:13px;"><a href="${esc(more)}" style="color:${C.accent};">See every ${esc(lang ?? "first-PR friendly")} repo &rarr;</a></p>`;
    })
    .join("");
  const html = layout({
    preheader: subject,
    body: `<p style="margin:0 0 18px;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:${C.subtle};">Your weekly patch &middot; ${esc(week)}</p>${bodySections}`,
    footer: `You're getting this because you subscribed on <a href="${esc(site)}" style="color:${C.subtle};">OpenSrc</a>. Reply to write back.<br><a href="${esc(unsubscribeUrl)}" style="color:${C.subtle};">Unsubscribe in one click</a>`,
  });
  const text = [
    `Your weekly patch from OpenSrc (${week})`,
    "",
    ...sections.flatMap((s) => [
      sectionTitle(s),
      "-".repeat(sectionTitle(s).length),
      ...[...s.fresh, ...s.topUp].map(
        (r) =>
          `* ${r.fullName} (${r.goodFirstIssues} good first issues, score ${r.score})${r.description ? `\n  ${r.description}` : ""}\n  ${site}/repo/${r.fullName}`,
      ),
      "",
    ]),
    `Unsubscribe: ${unsubscribeUrl}`,
  ].join("\n");
  return { subject, html, text };
}
