export interface IssueLabel {
  name: string;
  /** Hex colour without `#`, as GitHub returns it. */
  color: string;
}

export interface IssueRepo {
  fullName: string;
  owner: string;
  name: string;
  htmlUrl: string;
  language?: string | null;
  stars?: number | null;
  topics?: string[];
}

export interface Issue {
  id: number;
  number: number | null;
  title: string;
  body: string;
  htmlUrl: string;
  repo: IssueRepo;
  labels: IssueLabel[];
  comments: number;
  createdAt: string;
  updatedAt: string;
  author?: { login: string; avatarUrl: string } | null;
  /** True when this came from the bundled sample dataset. */
  sample?: boolean;
  /**
   * Whether an open PR is already linked. Only known when our server has a
   * GitHub token; undefined means "unknown", and the UI then shows nothing.
   */
  linkedPr?: boolean;
}

export type SortKey = 'best' | 'newest' | 'comments';

export type NoticeKind = 'rate-limit' | 'network' | 'demo' | 'auth';

export interface SearchNotice {
  kind: NoticeKind;
  message: string;
  /** Epoch ms when the GitHub rate limit resets, if known. */
  resetAt?: number;
}

export interface SearchResult {
  items: Issue[];
  total: number;
  hasMore: boolean;
  source: 'github' | 'sample';
  notice?: SearchNotice;
  /** Sample results only: filters had to be loosened to find matches. */
  relaxed?: boolean;
}
