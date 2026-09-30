/**
 * The repo directory's data model: one RepoRecord per line of data/repos.json,
 * plus data/meta.json. Written by the collector (backend/src/pipeline/) and read
 * by the frontend. Plain TypeScript: no DOM or Node APIs.
 */

/** Points earned per score part (each part is capped at its weight, see score.ts). */
export interface ScoreParts {
  supply: number;
  activity: number;
  response: number;
  onboarding: number;
  claimable: number;
  reach: number;
}

export interface RepoRecord {
  /** `owner/name`, exactly as GitHub spells it. The record's id. */
  fullName: string;
  owner: string;
  name: string;
  description: string | null;
  homepage: string | null;
  /** Owner avatar. */
  avatarUrl: string;
  /** Language id from the shared dictionary, or null when GitHub's primary language isn't one we know. */
  language: string | null;
  /** GitHub's primary language name as reported ("TypeScript"), or null. */
  languageName: string | null;
  topics: string[];
  stars: number;
  forks: number;
  /** SPDX id ("MIT"), "other" for an unrecognised license file, or null for none. */
  license: string | null;
  archived: boolean;
  fork: boolean;
  mirror: boolean;
  /** ISO time of the newest commit on the default branch. */
  lastCommitAt: string;
  createdAt: string;
  /** Link to the CONTRIBUTING guide (the repo's own, else the org's default), or null. */
  contributingUrl: string | null;
  hasCodeOfConduct: boolean;
  /** Open good-first-issues (any common label spelling). */
  goodFirstIssues: number;
  /** Open help-wanted issues (any common label spelling). */
  helpWanted: number;
  /** How many of the newest open good-first-issues were looked at (≤ 20). */
  gfiSampled: number;
  /** Of those, how many have no assignee. */
  gfiUnassigned: number;
  /** Of those, how many have no comments at all. */
  gfiUnanswered: number;
  /**
   * The good-first and help-wanted label spellings this repo's open issues use
   * (from shared/labels.ts, spelled as on GitHub, most used first). The repo page's
   * live issue search asks for these. Empty when none were seen.
   */
  issueLabels: string[];
  /** Median hours until a maintainer first replied on recent issues, or null when unknown. */
  responseHours: number | null;
  /** When responseHours was sampled (re-sampled weekly), or null. */
  responseSampledAt: string | null;
  /** Field (domain) ids, at most 3, most relevant first. */
  fields: string[];
  /** Listed by hand in data/curation.yml. */
  curated: boolean;
  /** When the collector first listed the repo. */
  firstSeenAt: string;
  /** 0–100, computed at `meta.generatedAt`. */
  score: number;
  scoreParts: ScoreParts;
  firstPrFriendly: boolean;
}

export interface DatasetMeta {
  version: 1;
  /** When the dataset was written. Scores are computed at this time. */
  generatedAt: string;
  /**
   * When the dataset was first built. Repos first seen at that time weren't
   * "new", they were simply there on day one, so "Fresh this week" skips them.
   */
  bootstrapAt: string;
  count: number;
  firstPrFriendly: number;
  /** Repo count per language id ("other" for unknown languages). */
  languages: Record<string, number>;
  /** Repo count per field id. */
  fields: Record<string, number>;
  /** GraphQL points spent by the run that wrote this file. */
  pointsUsed: number;
  /** "full" for a nightly-style run, "partial" for --only / --languages runs. */
  scope: 'full' | 'partial';
}

/** Hard cap on listed repos (curated repos come on top). */
export const MAX_REPOS = 1500;
