import { motion } from 'framer-motion';
import { useState, type SVGProps } from 'react';
import { fabricFor, fabricStyle } from '../lib/fabric';

/** GitHub mark (lucide dropped brand icons). */
export function GitHubMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

/**
 * OpenSrc mark: a sewn-on patch with a running-stitch seam and a pair of
 * code brackets, the "open" in open source.
 */
export function LogoMark({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect x="1.5" y="1.5" width="29" height="29" rx="8" className="fill-accent" />
      <rect
        x="5"
        y="5"
        width="22"
        height="22"
        rx="5"
        fill="none"
        className="stroke-accent-fg"
        strokeWidth="1.6"
        strokeDasharray="2.6 2.2"
        opacity=".75"
      />
      <path
        d="M13 11.5 8.8 16l4.2 4.5M19 11.5l4.2 4.5-4.2 4.5"
        fill="none"
        className="stroke-accent-fg"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** A sewing needle with a tail of thread. */
export function NeedleIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M20.5 3.5 7 17" />
      <path d="M18.3 4.2c.7-.7 1.8-.7 2.4 0 .6.6.6 1.6 0 2.3" />
      <path d="M7 17c-1.6 1.6-3.4 2.3-4 1.8-.6-.6.4-2.4 2-4" strokeDasharray="1.6 2" />
    </svg>
  );
}

/** Sun ⇄ moon morph: the moon's bite slides in, rays fold away. */
export function ThemeGlyph({ dark }: { dark: boolean }) {
  const spring = { type: 'spring' as const, stiffness: 300, damping: 24 };
  return (
    <motion.svg
      viewBox="0 0 24 24"
      className="h-[18px] w-[18px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      aria-hidden="true"
      animate={{ rotate: dark ? 40 : 90 }}
      transition={spring}
    >
      <mask id="moon-bite">
        <rect x="0" y="0" width="24" height="24" fill="white" />
        <motion.circle
          r="9"
          fill="black"
          initial={false}
          animate={dark ? { cx: 17, cy: 5 } : { cx: 30, cy: -6 }}
          transition={spring}
        />
      </mask>
      <motion.circle
        cx="12"
        cy="12"
        fill="currentColor"
        stroke="none"
        mask="url(#moon-bite)"
        initial={false}
        animate={{ r: dark ? 8.5 : 4.6 }}
        transition={spring}
      />
      <motion.g
        initial={false}
        animate={{ opacity: dark ? 0 : 1, scale: dark ? 0.4 : 1 }}
        style={{ originX: '12px', originY: '12px' }}
        transition={spring}
      >
        {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
          <line key={a} x1="12" y1="2.2" x2="12" y2="4.6" transform={`rotate(${a} 12 12)`} />
        ))}
      </motion.g>
    </motion.svg>
  );
}

/** Corner radius that grows with the avatar, like a patch cut to size. */
const radius = (size: number) => Math.max(5, Math.round(size * 0.22));

/** A monogram on a scrap of fabric: used for sample data and as the avatar fallback. */
export function PatchAvatar({ name, size = 20 }: { name: string; size?: number }) {
  return (
    <span
      className="relative grid shrink-0 place-items-center overflow-hidden rounded-[5px] ring-1 ring-black/10"
      style={{ width: size, height: size, borderRadius: radius(size), ...fabricStyle(fabricFor(name), 0.6) }}
      aria-hidden="true"
    >
      <span
        className="grid place-items-center rounded-[3px] bg-[#fdf9f1] font-display font-semibold uppercase leading-none text-[#241d16]"
        style={{ width: size * 0.62, height: size * 0.62, fontSize: size * 0.42 }}
      >
        {name.replace(/[^a-z0-9]/gi, '').slice(0, 1) || '?'}
      </span>
    </span>
  );
}

/** Repo owner avatar from GitHub, falling back to a patch monogram; samples never hit the network. */
export function RepoAvatar({ owner, size = 20, offline = false }: { owner: string; size?: number; offline?: boolean }) {
  const [failed, setFailed] = useState(false);
  if (offline || failed) return <PatchAvatar name={owner} size={size} />;
  return (
    <img
      src={`https://github.com/${owner}.png?size=${size * 2}`}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className="shrink-0 rounded-[5px] bg-surface-3 ring-1 ring-line"
      style={{ width: size, height: size, borderRadius: radius(size) }}
    />
  );
}
