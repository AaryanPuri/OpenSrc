import { useEffect, useLayoutEffect } from 'react';

/** useLayoutEffect in the browser, useEffect on the server (where neither runs, but only one warns). */
export const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;
