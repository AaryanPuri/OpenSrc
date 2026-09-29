/** Small display helpers for repos and collections, shared by cards and pages. */
import { Landmark, MessageCircleQuestion, Sparkles, Sprout, Zap, type LucideIcon } from 'lucide-react';
import { useMemo } from 'react';
import { COLLECTIONS, collectionContext } from '../../../shared/collections';
import type { DatasetMeta, RepoRecord } from '../../../shared/repo';
import { DOMAINS, LANGUAGES } from './dictionary';
import { domainFabric, fabricFor, type Fabric } from './fabric';
import { shortAgo } from './format';

export const languageColor = (id: string | null) => (id && LANGUAGES.find((l) => l.id === id)?.color) || '#8b8b94';

export const fieldLabel = (id: string) => DOMAINS.find((d) => d.id === id)?.label ?? id;

/** "committed 3d ago" */
export function committedAgo(iso: string, now: number) {
  const ago = shortAgo(iso, now);
  return ago === 'now' ? 'committed just now' : `committed ${ago} ago`;
}

export const repoPath = (fullName: string, search = '') => `/repo/${fullName}${search}`;

/** The repo's primary field fabric, or a stable one per repo. */
export const repoFabric = (repo: Pick<RepoRecord, 'fields' | 'fullName'>) =>
  repo.fields[0] ? domainFabric(repo.fields[0]) : fabricFor(repo.fullName);

/** Score bands, shared by the stitch meter and the repo page. */
export function scoreLevel(score: number) {
  if (score >= 75) return { bar: 'bg-accent', text: 'text-accent', label: 'Very welcoming' };
  if (score >= 55) return { bar: 'bg-indigo', text: 'text-indigo', label: 'Welcoming' };
  return { bar: 'bg-subtle', text: 'text-muted', label: 'Some assembly required' };
}

/** Each collection is a quilt block: a fabric borrowed from a field, and an icon. */
export const COLLECTION_LOOK: Record<string, { fabric: Fabric; icon: LucideIcon }> = {
  'first-pr': { fabric: domainFabric('frontend'), icon: Sprout },
  fresh: { fabric: domainFabric('testing'), icon: Sparkles },
  unanswered: { fabric: domainFabric('science'), icon: MessageCircleQuestion },
  'big-names': { fabric: domainFabric('blockchain'), icon: Landmark },
  'fast-responders': { fabric: domainFabric('networking'), icon: Zap },
};

/** Repos per collection, or null until the directory has loaded. */
export function useCollectionCounts(repos: RepoRecord[], meta: DatasetMeta | null): Record<string, number> | null {
  return useMemo(() => {
    if (!meta) return null;
    const ctx = collectionContext(meta);
    return Object.fromEntries(COLLECTIONS.map((c) => [c.id, repos.filter((r) => c.includes(r, ctx)).length]));
  }, [repos, meta]);
}
