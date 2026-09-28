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
}
