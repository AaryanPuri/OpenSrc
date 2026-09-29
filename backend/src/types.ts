import type { InterpretedQuery } from "../../shared/types.js";

// Query types come from shared/ (the same parser the frontend runs).
export type { Difficulty, DomainMatch, InterpretedQuery, IssueType, ParsedQuery, Since } from "../../shared/types.js";

export type SortMode = "best" | "newest" | "comments";

export interface IssueLabel {
  name: string;
  color: string;
}

export interface IssueRepo {
  fullName: string;
  owner: string;
  avatarUrl: string;
  url: string;
  stars?: number;
  language?: string;
}

export interface Issue {
  id: number;
  number: number;
  title: string;
  url: string;
  repo: IssueRepo;
  labels: IssueLabel[];
  comments: number;
  createdAt: string;
  updatedAt: string;
  bodyExcerpt: string;
  author: string;
  /**
   * Availability: whether an open PR is linked to this issue. Only present
   * when the server has a GITHUB_TOKEN (checked via one GraphQL call per page).
   */
  linkedPr?: boolean;
}

export interface RateLimitInfo {
  limit?: number;
  remaining?: number;
  reset?: number; // epoch seconds
}

export interface SearchResponse {
  /** null when the caller supplied a raw GitHub query via `gq=`. */
  parsed: InterpretedQuery | null;
  githubQuery: string;
  total: number;
  items: Issue[];
  source: "github" | "fixtures";
  rateLimit?: RateLimitInfo;
  warning?: string;
  /** Why fixtures were served instead of live results (absent for `demo=1`). */
  fallbackReason?: "rate-limit" | "unavailable";
}

/** Runtime configuration; populated from process.env (Node) or bindings (Workers). */
export interface Env {
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
  GITHUB_TOKEN?: string;
  /** Public origin (https://opensrc.studio): OAuth callback, email links, allowed Origin for writes. */
  SITE_URL?: string;
  /** Signs the OAuth state cookie. Required for login. */
  SESSION_SECRET?: string;
  /** libSQL URL: libsql://… (Turso) on Workers; also file:… on Node. Unset = no login, saves or newsletter. */
  DATABASE_URL?: string;
  DATABASE_AUTH_TOKEN?: string;
  /** GitHub OAuth App (no scopes). */
  GITHUB_OAUTH_CLIENT_ID?: string;
  GITHUB_OAUTH_CLIENT_SECRET?: string;
  /** Newsletter mail. */
  RESEND_API_KEY?: string;
  /** "OpenSrc <digest@opensrc.studio>" */
  NEWSLETTER_FROM?: string;
  /** Signs confirm and unsubscribe links. Required for the newsletter. */
  NEWSLETTER_SECRET?: string;
  /** Most digest emails to send per UTC day (default 90, under Resend's free 100/day). */
  DIGEST_DAILY_CAP?: string;
  /** "console": log emails instead of sending them (local development). */
  MAIL_PROVIDER?: string;
}
