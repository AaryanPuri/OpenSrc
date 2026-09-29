import { Bookmark, BookmarkCheck } from 'lucide-react';
import { useShell } from '../hooks/useShell';
import type { SavedSearch } from '../hooks/useSaved';

/** "Save this search": keeps the current `?q=` in the Saved drawer's Searches tab. */
export function SaveSearchButton({ scope, q }: { scope: SavedSearch['scope']; q: string }) {
  const { isSearchSaved, onToggleSearch } = useShell();
  if (!q.trim()) return null;
  const saved = isSearchSaved(scope, q);
  const Icon = saved ? BookmarkCheck : Bookmark;
  return (
    <button
      type="button"
      className={`btn-ghost whitespace-nowrap ${saved ? 'text-accent hover:text-accent' : ''}`}
      aria-pressed={saved}
      onClick={() => onToggleSearch(scope, q)}
      data-testid="save-search"
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      {saved ? 'Search saved' : 'Save this search'}
    </button>
  );
}
