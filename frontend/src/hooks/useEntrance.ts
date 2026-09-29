import { useHydrated } from './useHydrated';

/**
 * Entrance animations for framer-motion's `initial`, only once the client has
 * taken over. On the server and during hydration it returns `false`, so the
 * pre-rendered HTML (and a visitor without JavaScript) shows everything in its
 * final place, and hydrated content doesn't jump. Elements that mount later
 * (client navigation, "Sew more rows") still get their entrance.
 *
 *   const enter = useEntrance();
 *   <motion.li initial={enter({ y: 26 })} animate={{ y: 0 }} />
 */
export function useEntrance() {
  const hydrated = useHydrated();
  return <T>(from: T): T | false => (hydrated ? from : false);
}
