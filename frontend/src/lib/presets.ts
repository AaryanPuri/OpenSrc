import type { IssueType } from './dictionary';
import { toQueryText, type ParsedQuery } from './parseQuery';

export type TimePresetId = 'hour' | 'weekend' | 'ongoing';

export interface TimePreset {
  id: TimePresetId;
  label: string;
  /** What it means, in plain words. */
  hint: string;
  difficulty: ParsedQuery['difficulty'];
  types: IssueType[];
}

/** "How much time do you have?" maps to difficulty and kind of work. */
export const TIME_PRESETS: TimePreset[] = [
  { id: 'hour', label: 'An hour', hint: 'First contribution, docs-sized', difficulty: 'beginner', types: ['docs'] },
  {
    id: 'weekend',
    label: 'A weekend',
    hint: 'Some experience, any kind of work',
    difficulty: 'help-wanted',
    types: [],
  },
  {
    id: 'ongoing',
    label: 'Ongoing',
    hint: 'Ready for a challenge, features',
    difficulty: 'intermediate',
    types: ['feature'],
  },
];

export function matchPreset(p: ParsedQuery): TimePresetId | null {
  const hit = TIME_PRESETS.find((t) => t.difficulty === p.difficulty && t.types.every((x) => p.types.includes(x)));
  return hit?.id ?? null;
}

/** Apply a preset (or clear it when it is already active), keeping everything else. */
export function applyPreset(p: ParsedQuery, id: TimePresetId): ParsedQuery {
  const preset = TIME_PRESETS.find((t) => t.id === id)!;
  const presetTypes = new Set(TIME_PRESETS.flatMap((t) => t.types));
  const active = matchPreset(p) === id;
  const baseTypes = p.types.filter((t) => !presetTypes.has(t));
  const next: ParsedQuery = active
    ? { ...p, difficulty: null, types: baseTypes }
    : { ...p, difficulty: preset.difficulty, types: [...baseTypes, ...preset.types] };
  next.raw = toQueryText(next);
  return next;
}
