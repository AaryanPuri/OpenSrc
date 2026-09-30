/**
 * Field (domain) classification for repos: up to three DOMAINS ids from a repo's
 * topics, description, name and primary language, using the query parser's
 * vocabulary plus a few classification-only hints (framework and ecosystem words
 * people tag repos with, like `react`, `django` or `minecraft`).
 *
 * Topics are deliberate labels, so they weigh most. Prose is noisy ("for the web",
 * "computer science"), so it weighs less, vague words ("web", "ui", "os") count half, a
 * small denylist removes phrases that name the wrong field, and a field needs at
 * least one full point to be kept.
 */
import { DOMAINS } from './dictionary.js';
import { matchDomains, normalise } from './parse.js';
import type { RepoRecord } from './repo.js';

export const MAX_FIELDS = 3;

/** Weights: a topic listed on the domain beats a topic that is a synonym or hint, which beats prose. */
const EXACT_TOPIC = 3;
const SYNONYM_TOPIC = 2;
const PROSE = 1;
/** Short or many-sensed words ("ai", "web", "os", "cloud") count this much in prose. */
const WEAK_PROSE = 0.5;
/** A field needs this many points to be kept. */
const MIN_POINTS = 1;

/** Prose words that match a field but say little on their own ("a web UI", "any OS"). */
const WEAK_WORDS = new Set([
  'web',
  'ui',
  'os',
  'ide',
  'qa',
  'dx',
  '3d',
  'infra',
  'cloud',
  'game',
  'games',
  'network',
  'networks',
  'protocol',
  'protocols',
  'systems',
  'metrics',
  'hardware',
  'container',
  'containers',
  'infrastructure',
  'notebook',
  'notebooks',
  'terminal',
  'editor',
  'statistics',
  'accessible',
  'parser',
  'formatter',
  'crypto',
]);

/** Phrases removed from prose before matching, because they name the wrong field. */
const DENY_PHRASES = [
  'computer science', // education, not scientific computing
  'for the web',
  'on the web',
  'web browser',
  'open source',
  'in the cloud',
  'user interface', // too generic in prose ("a user interface for …")
];

/**
 * Classification-only hints: ecosystem words that point at a field without being
 * search vocabulary. Matched on whole topics and on prose words.
 */
const HINTS: Record<string, string> = {
  // Web frontend
  react: 'frontend',
  reactjs: 'frontend',
  vue: 'frontend',
  vuejs: 'frontend',
  vue3: 'frontend',
  angular: 'frontend',
  svelte: 'frontend',
  sveltekit: 'frontend',
  nextjs: 'frontend',
  'next js': 'frontend',
  nuxt: 'frontend',
  tailwindcss: 'frontend',
  tailwind: 'frontend',
  html: 'frontend',
  website: 'frontend',
  'web components': 'frontend',
  'component library': 'frontend',
  'react components': 'frontend',
  dashboard: 'frontend',
  // Backend & APIs
  django: 'backend',
  flask: 'backend',
  fastapi: 'backend',
  express: 'backend',
  nodejs: 'backend',
  rails: 'backend',
  'ruby on rails': 'backend',
  laravel: 'backend',
  symfony: 'backend',
  'php framework': 'backend',
  'spring boot': 'backend',
  nestjs: 'backend',
  phoenix: 'backend',
  'phoenix framework': 'backend',
  cms: 'backend',
  'headless cms': 'backend',
  wordpress: 'backend',
  rpc: 'backend',
  'web framework': 'backend',
  homeserver: 'backend',
  'self hosted': 'backend',
  // Data
  spark: 'data-science',
  'apache spark': 'data-science',
  arrow: 'data-science',
  parquet: 'data-science',
  iceberg: 'data-science',
  'data lineage': 'data-science',
  'data pipeline': 'data-science',
  'data engineering': 'data-science',
  'search engine': 'databases',
  'full text search': 'databases',
  'vector database': 'databases',
  // ML
  openai: 'ml',
  'large language models': 'ml',
  rag: 'ml',
  'ai agents': 'ml',
  agents: 'ml',
  // Dev tools
  git: 'devtools',
  vcs: 'devtools',
  'version control': 'devtools',
  'build system': 'devtools',
  'package manager': 'devtools',
  monorepo: 'devtools',
  'intellij plugin': 'devtools',
  'eclipse plugin': 'devtools',
  'vscode extension': 'devtools',
  'static analysis': 'devtools',
  'code quality': 'devtools',
  // OS & systems
  wayland: 'systems',
  'window manager': 'systems',
  compositor: 'systems',
  emulator: 'systems',
  emulation: 'systems',
  windows: 'systems',
  coreutils: 'cli',
  findutils: 'cli',
  // Games
  minecraft: 'gamedev',
  'minecraft mod': 'gamedev',
  'minecraft plugin': 'gamedev',
  bukkit: 'gamedev',
  spigot: 'gamedev',
  // Graphics
  'image processing': 'graphics',
  canvas: 'graphics',
  drawing: 'graphics',
  diagrams: 'graphics',
  // Networking
  bittorrent: 'networking',
  torrent: 'networking',
  vpn: 'networking',
  // Blockchain
  'on chain': 'blockchain',
  dex: 'blockchain',
  'syntax highlighting': 'devtools',
  'syntax highlighter': 'devtools',
  // Compilers & languages
  compiles: 'compilers',
  'theorem prover': 'compilers',
  'proof assistant': 'compilers',
  'model checker': 'compilers',
  'model checking': 'compilers',
  'type checking': 'compilers',
  // More
  chatgpt: 'ml',
  gpt: 'ml',
  'big data': 'data-science',
  bigdata: 'data-science',
  'identity and access management': 'security',
  'access management': 'security',
  'board game': 'gamedev',
  boardgame: 'gamedev',
  ros: 'embedded',
  'ros 2': 'embedded',
  ros2: 'embedded',
  verilog: 'embedded',
  simd: 'systems',
  kvm: 'systems',
  webrtc: 'networking',
  messaging: 'networking',
  animation: 'graphics',
  animations: 'graphics',
  'visual effects': 'graphics',
  // Science
  eeg: 'science',
  bioinformatics: 'science',
  neuroimaging: 'science',
  astronomy: 'science',
  nuclear: 'science',
  'power system': 'science',
};
const HINT_MAX_WORDS = Math.max(...Object.keys(HINTS).map((k) => k.split(' ').length));

/** Primary languages that name a field outright. */
const LANGUAGE_FIELD: Record<string, [field: string, points: number]> = {
  solidity: ['blockchain', 2],
  vue: ['frontend', 2],
  html: ['frontend', 1],
};

/** Languages whose repos with UI words in them are frontend work. */
const WEB_LANGUAGES = new Set(['javascript', 'typescript', 'html', 'vue']);
const UI_WORDS = new Set([
  'ui',
  'ux',
  'web',
  'website',
  'browser',
  'component',
  'components',
  'dashboard',
  'frontend',
  'css',
  'react',
  'vue',
  'svelte',
  'angular',
  'design',
  'theme',
]);
const WEB_UI_POINTS = 1.5;

const DOMAIN_IDS = new Set(DOMAINS.map((d) => d.id));

function removeDenied(text: string): string {
  let out = ` ${normalise(text).join(' ')} `;
  for (const p of DENY_PHRASES) out = out.split(` ${p} `).join(' | ');
  return out;
}

/**
 * Fields found in normalised prose tokens: dictionary synonyms (longest phrase
 * first, like the parser) and hints, each span counted once.
 */
function proseFields(tokens: string[]): { id: string; weak: boolean }[] {
  const found: { id: string; weak: boolean }[] = [];
  let i = 0;
  while (i < tokens.length) {
    let step = 1;
    for (let n = Math.min(HINT_MAX_WORDS, tokens.length - i); n >= 1; n--) {
      const span = tokens.slice(i, i + n);
      const phrase = span.join(' ');
      if (span.includes('|')) continue;
      const hint = HINTS[phrase];
      const domain = hint ? undefined : matchDomains(span).find((m) => m.matched === phrase);
      const id = hint ?? domain?.id;
      if (!id) continue;
      found.push({ id, weak: n === 1 && WEAK_WORDS.has(phrase) });
      step = n;
      break;
    }
    i += step;
  }
  return found;
}

export function classifyRepo(
  repo: Pick<RepoRecord, 'name' | 'description' | 'topics'> & { language?: string | null },
): string[] {
  const scores = new Map<string, number>();
  const add = (id: string, pts: number) => {
    if (DOMAIN_IDS.has(id)) scores.set(id, (scores.get(id) ?? 0) + pts);
  };

  for (const raw of repo.topics) {
    const topic = raw.toLowerCase();
    const exact = DOMAINS.filter((d) => d.topics.includes(topic));
    exact.forEach((d) => add(d.id, EXACT_TOPIC));
    const words = normalise(topic);
    const hint = HINTS[words.join(' ')];
    if (hint && !exact.some((d) => d.id === hint)) add(hint, SYNONYM_TOPIC);
    else if (!hint) {
      for (const m of matchDomains(words)) {
        if (!exact.some((d) => d.id === m.id)) add(m.id, SYNONYM_TOPIC);
      }
    }
  }

  const prose = [removeDenied(repo.description ?? ''), removeDenied(repo.name)].join(' | ');
  const tokens = prose.split(/\s+/).filter(Boolean);
  // Prose counts each field once, at its strongest mention, however often it is repeated.
  const prosePoints = new Map<string, number>();
  for (const f of proseFields(tokens)) {
    prosePoints.set(f.id, Math.max(prosePoints.get(f.id) ?? 0, f.weak ? WEAK_PROSE : PROSE));
  }
  prosePoints.forEach((pts, id) => add(id, pts));

  const lang = repo.language ?? null;
  if (lang && LANGUAGE_FIELD[lang]) add(...LANGUAGE_FIELD[lang]);
  if (lang && WEB_LANGUAGES.has(lang)) {
    const words = new Set([...tokens, ...repo.topics.flatMap((t) => normalise(t))]);
    if ([...words].some((w) => UI_WORDS.has(w))) add('frontend', WEB_UI_POINTS);
  }

  const order = (id: string) => DOMAINS.findIndex((d) => d.id === id);
  return [...scores.entries()]
    .filter(([, pts]) => pts >= MIN_POINTS)
    .sort((a, b) => b[1] - a[1] || order(a[0]) - order(b[0]))
    .slice(0, MAX_FIELDS)
    .map(([id]) => id);
}
