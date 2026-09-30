import { useEffect, useState } from 'react';

/** "m:ss" until `until` (epoch ms), "now" once it passes, null without one. Ticks every second. */
export function useCountdown(until?: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!until) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [until]);
  if (!until) return null;
  const s = Math.max(0, Math.round((until - now) / 1000));
  return s === 0 ? 'now' : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
