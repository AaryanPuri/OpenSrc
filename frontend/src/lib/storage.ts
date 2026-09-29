/**
 * localStorage keys. Earlier builds (as "Patchwork") used an `ocf:` prefix;
 * `migrateStorage` carries those values over so saved issues, theme and token
 * survive the rename to OpenSrc.
 */
export const KEYS = {
  theme: 'opensrc:theme',
  saved: 'opensrc:saved',
  savedRepos: 'opensrc:saved-repos',
  token: 'opensrc:token',
} as const;

const LEGACY: Record<string, string> = {
  'ocf:theme': KEYS.theme,
  'ocf:saved': KEYS.saved,
  'ocf:token': KEYS.token,
};

export function migrateStorage(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = localStorage): void {
  try {
    for (const [oldKey, newKey] of Object.entries(LEGACY)) {
      const value = storage.getItem(oldKey);
      if (value === null) continue;
      // A legacy value still present was written by an older build (or by
      // tooling after us), so it is the freshest value we know about.
      storage.setItem(newKey, value);
      storage.removeItem(oldKey);
    }
  } catch {
    /* storage unavailable */
  }
}
