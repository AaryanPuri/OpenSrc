import { domainFabric, fabricStyle } from '../lib/fabric';
import { fieldIcon } from '../lib/fieldIcons';

const SIZES = {
  sm: { box: 'h-4 w-4 rounded-[4px]', icon: 'h-[11px] w-[11px]', stroke: 2.4, weave: 0.5 },
  lg: {
    box: 'h-11 w-11 rounded-[10px] sm:h-14 sm:w-14 sm:rounded-[12px]',
    icon: 'h-5 w-5 sm:h-6 sm:w-6',
    stroke: 1.9,
    weave: 0.9,
  },
} as const;

/**
 * A field's badge: its patch colour, a faint weave for texture, and a clear
 * icon on top, so the field reads at a glance. `hoverShift` lets a parent
 * with `group` nudge the weave on hover.
 */
export function FieldBadge({
  id,
  size = 'sm',
  hoverShift = false,
}: {
  id: string;
  size?: keyof typeof SIZES;
  hoverShift?: boolean;
}) {
  const fabric = domainFabric(id);
  const Icon = fieldIcon(id);
  const s = SIZES[size];
  const ink = fabric.thread === 'light' ? 'text-white' : 'text-[#2a1d12]';
  return (
    <span
      className={`relative grid shrink-0 place-items-center overflow-hidden ring-1 ring-black/10 ${s.box}`}
      style={{ backgroundColor: fabric.color }}
      aria-hidden="true"
    >
      <span
        className={`absolute -inset-4 opacity-45 ${hoverShift ? 'transition-transform duration-500 ease-out group-hover:translate-x-2 group-hover:translate-y-1.5 group-hover:rotate-3' : ''}`}
        style={fabricStyle(fabric, s.weave)}
      />
      <Icon className={`relative ${s.icon} ${ink} drop-shadow-[0_1px_1px_rgb(0_0_0/0.18)]`} strokeWidth={s.stroke} />
    </span>
  );
}
