import type { CSSProperties } from 'react';
import type { Issue } from './types';

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 86_400_000],
  ['month', 30 * 86_400_000],
  ['week', 7 * 86_400_000],
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
];

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

export function timeAgo(iso: string, now = Date.now()): string {
  const diff = Date.parse(iso) - now;
  for (const [unit, ms] of UNITS) {
    if (Math.abs(diff) >= ms) return rtf.format(Math.round(diff / ms), unit);
  }
  return 'just now';
}

export function compactNumber(n: number): string {
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

/* ------------------------------------------------------------------ */
/* Label colours: GitHub's hex, adapted for readable contrast            */
/* ------------------------------------------------------------------ */

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '').padEnd(6, '0').slice(0, 6);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) || 0) as [number, number, number];
}

function luminance([r, g, b]: [number, number, number]): number {
  const c = [r, g, b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

function mix(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return a.map((v, i) => Math.round(v + (b[i] - v) * t)) as [number, number, number];
}

function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/**
 * GitHub-style label pill: a tinted background with the label colour as
 * text, lightened/darkened until it passes 4.5:1 against the tint.
 */
export function labelStyle(hex: string, theme: 'dark' | 'light'): CSSProperties {
  const base = hexToRgb(hex);
  const surface: [number, number, number] = theme === 'dark' ? [38, 35, 66] : [252, 248, 240];
  const bg = mix(surface, base, theme === 'dark' ? 0.16 : 0.12);
  const target: [number, number, number] = theme === 'dark' ? [255, 255, 255] : [0, 0, 0];
  let fg = base;
  for (let t = 0; t <= 1 && contrast(fg, bg) < 4.6; t += 0.05) fg = mix(base, target, t);
  const border = mix(surface, base, theme === 'dark' ? 0.35 : 0.3);
  return {
    backgroundColor: `rgb(${bg.join(' ')})`,
    color: `rgb(${fg.join(' ')})`,
    borderColor: `rgb(${border.join(' ')})`,
  };
}

/* ------------------------------------------------------------------ */
/* Approachability                                                      */
/* ------------------------------------------------------------------ */

export interface Approachability {
  score: number; // 0–100
  level: 'high' | 'medium' | 'low';
  label: string;
  reasons: string[];
}

const BEGINNER_RE = /good.?first|junior|beginner|easy|starter|first.?timer|straightforward/i;
const HELP_RE = /help.?wanted|up.?for.?grabs|contributions?.?welcome/i;
const DOCS_RE = /doc|typo|example/i;

/** Heuristic: how easy is it to pick this up today? */
export function approachability(issue: Issue, now = Date.now()): Approachability {
  let score = 40;
  const reasons: string[] = [];
  const names = issue.labels.map((l) => l.name);

  if (names.some((n) => BEGINNER_RE.test(n))) {
    score += 28;
    reasons.push('Marked beginner-friendly');
  } else if (names.some((n) => HELP_RE.test(n))) {
    score += 14;
    reasons.push('Maintainers asked for help');
  }
  if (names.some((n) => DOCS_RE.test(n))) {
    score += 6;
    reasons.push('Docs-sized change');
  }

  if (issue.comments === 0) {
    score += 10;
    reasons.push('No discussion yet');
  } else if (issue.comments <= 4) {
    score += 6;
    reasons.push('Light discussion');
  } else if (issue.comments > 12) {
    score -= 14;
    reasons.push('Long discussion thread');
  }

  const ageDays = (now - Date.parse(issue.createdAt)) / 86_400_000;
  if (ageDays <= 14) {
    score += 10;
    reasons.push('Opened recently');
  } else if (ageDays > 365) {
    score -= 12;
    reasons.push('Over a year old');
  }

  const updatedDays = (now - Date.parse(issue.updatedAt)) / 86_400_000;
  if (updatedDays > 180) score -= 8;

  score = Math.max(0, Math.min(100, Math.round(score)));
  const level = score >= 70 ? 'high' : score >= 50 ? 'medium' : 'low';
  const label = level === 'high' ? 'Very approachable' : level === 'medium' ? 'Approachable' : 'Needs context';
  return { score, level, label, reasons };
}

export function freshness(issue: Issue, now = Date.now()): 'fresh' | 'recent' | 'stale' {
  const days = (now - Date.parse(issue.updatedAt)) / 86_400_000;
  return days <= 14 ? 'fresh' : days <= 90 ? 'recent' : 'stale';
}

/** "1 comment", "3 comments", "0 comments". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString('en')} ${n === 1 ? one : many}`;
}

/** Trust signal: when was this last touched, and is it going stale (> 6 months)? */
export function activity(issue: Pick<Issue, 'updatedAt'>, now = Date.now()): { label: string; stale: boolean } {
  const days = (now - Date.parse(issue.updatedAt)) / 86_400_000;
  return { label: `updated ${timeAgo(issue.updatedAt, now)}`, stale: days > 182 };
}

const SHORT: [string, number][] = [
  ['y', 365 * 86_400_000],
  ['mo', 30 * 86_400_000],
  ['w', 7 * 86_400_000],
  ['d', 86_400_000],
  ['h', 3_600_000],
  ['m', 60_000],
];

/** Compact age for tight rows: "4d", "3w", "2mo". */
export function shortAgo(iso: string, now = Date.now()): string {
  const diff = Math.max(0, now - Date.parse(iso));
  for (const [unit, ms] of SHORT) if (diff >= ms) return `${Math.round(diff / ms)}${unit}`;
  return 'now';
}

export interface DateSignals {
  /** "4 days ago" */
  opened: string;
  openedShort: string;
  /** "2 hours ago", only when activity is meaningfully later than opening. */
  active: string | null;
  activeShort: string | null;
  /** No activity for more than six months. */
  stale: boolean;
}

/**
 * One date, not two: "opened X ago", plus "active Y ago" only when the issue
 * saw activity at least two days after it was opened (and the phrases differ).
 */
export function dateSignals(issue: Pick<Issue, 'createdAt' | 'updatedAt'>, now = Date.now()): DateSignals {
  const created = Date.parse(issue.createdAt);
  const updated = Date.parse(issue.updatedAt);
  const opened = timeAgo(issue.createdAt, now);
  const activeText = timeAgo(issue.updatedAt, now);
  const meaningful = updated - created >= 2 * 86_400_000 && activeText !== opened;
  return {
    opened,
    openedShort: shortAgo(issue.createdAt, now),
    active: meaningful ? activeText : null,
    activeShort: meaningful ? shortAgo(issue.updatedAt, now) : null,
    stale: now - updated > 182 * 86_400_000,
  };
}
