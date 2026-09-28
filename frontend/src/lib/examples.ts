import { DOMAINS } from './dictionary';

/** Example searches shown in the composer (typing demo + placeholder). */
export const EXAMPLE_QUERIES = [
  'beginner friendly rust issues in databases',
  'python machine learning docs help',
  'frontend accessibility bugs in react',
  'easy go issues for kubernetes tooling',
  'typescript cli tools, no comments yet',
  'c++ game engine bugs, help wanted',
];

/** Fields featured in the landing-page quilt, each with a starter query. */
export const FEATURED: { id: string; query: string; hint: string }[] = [
  { id: 'databases', query: 'good first issues in databases', hint: 'Postgres, SQL, storage' },
  { id: 'ml', query: 'beginner machine learning issues', hint: 'PyTorch, LLMs, NLP' },
  { id: 'frontend', query: 'easy web frontend issues', hint: 'UI, CSS, components' },
  { id: 'devops', query: 'good first issues for kubernetes', hint: 'K8s, Docker, Helm' },
  { id: 'security', query: 'beginner security issues', hint: 'Crypto, auth, scanners' },
  { id: 'gamedev', query: 'easy game dev issues', hint: 'Engines, Bevy, Godot' },
  { id: 'compilers', query: 'beginner compilers issues', hint: 'Parsers, LSP, linters' },
  { id: 'cli', query: 'good first issues in cli tools', hint: 'Terminal, TUI' },
  { id: 'accessibility', query: 'accessibility bugs', hint: 'a11y, ARIA, WCAG' },
  { id: 'data-science', query: 'beginner data science issues', hint: 'Pandas, notebooks' },
  { id: 'mobile', query: 'help wanted mobile issues', hint: 'Android, iOS, Flutter' },
  { id: 'embedded', query: 'beginner embedded issues', hint: 'Firmware, RTOS, IoT' },
];

/** All 22 fields for the quilt: the featured ones first (hand-written hints), then the rest. */
export const ALL_FIELDS: { id: string; query: string; hint: string }[] = [
  ...FEATURED,
  ...DOMAINS.filter((d) => !FEATURED.some((f) => f.id === d.id)).map((d) => ({
    id: d.id,
    query: `beginner ${d.synonyms[0]}`,
    hint: d.topics.map((t) => t.replace(/-/g, ' ')).join(', '),
  })),
];
