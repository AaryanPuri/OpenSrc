/** Where the e2e server listens and keeps its throwaway database (shared by the config and the tests). */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PORT = Number(process.env.E2E_PORT) || 4799;
export const BASE_URL = `http://127.0.0.1:${PORT}`;
export const E2E_DB = path.join(ROOT, 'e2e', '.data', 'e2e.db');
