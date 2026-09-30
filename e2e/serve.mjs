/**
 * The e2e web server (see playwright.config.ts): starts from an empty database,
 * then runs the production Node server exactly as `npm start` would.
 */
import { rmSync } from 'node:fs';
import path from 'node:path';

const url = process.env.DATABASE_URL ?? '';
if (url.startsWith('file:')) rmSync(path.dirname(url.slice('file:'.length)), { recursive: true, force: true });

await import('../backend/dist/backend/src/node.js');
