import type { RefObject } from 'react';
import { useOutletContext } from 'react-router';
import type { Issue } from '../lib/types';
import type { RepoLike } from './useSaved';
import type { Theme } from './useTheme';

/** What AppShell shares with the page rendered in its <Outlet/>. */
export interface ShellContext {
  theme: Theme;
  token: string | null;
  /** The page's main search box; "/" focuses it from anywhere. */
  searchRef: RefObject<HTMLTextAreaElement>;
  isSaved: (issue: Pick<Issue, 'htmlUrl' | 'id'>) => boolean;
  /** Toggles a bookmark; `from` is where the flying patch starts. */
  onToggleSave: (issue: Issue, from: DOMRect | null) => void;
  isRepoSaved: (fullName: string) => boolean;
  /** Toggles a saved repo; `from` is where the flying patch starts. */
  onToggleRepoSave: (repo: RepoLike, from: DOMRect | null) => void;
  /** Scrolls up and opens the settings popover (token entry). */
  openSettings: () => void;
  /** Bumps every time the logo is clicked, so pages can reset their local state. */
  homeTick: number;
}

export const useShell = () => useOutletContext<ShellContext>();
