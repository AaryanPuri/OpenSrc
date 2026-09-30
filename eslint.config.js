// ESLint flat config for the whole repo: the Vite/React frontend (frontend/) and the
// Hono API server (backend/). Deliberately pragmatic: recommended JS + TS rules,
// the two classic React hooks rules, and Prettier owns formatting.
import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores([
    '**/dist/',
    '**/dist-ssr/',
    '**/node_modules/',
    '**/coverage/',
    '.claude/',
    'e2e/.site/',
    'e2e/.data/',
    'playwright-report/',
    'test-results/',
  ]),

  js.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      // `catch {}` / intentionally empty blocks are fine when commented.
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Allow `cond ? a() : b()` / `cond && a()` as statements; still flags truly unused expressions.
      '@typescript-eslint/no-unused-expressions': ['error', { allowShortCircuit: true, allowTernary: true }],
    },
  },

  // Frontend
  {
    files: ['frontend/src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      // Only the classic hooks rules; react-hooks v7's React Compiler rules are too noisy here.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },

  // Build-time server entry and scripts: never hot-reloaded.
  {
    files: ['frontend/src/entry-server.tsx'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
  {
    files: ['frontend/scripts/**/*.{ts,mjs}', 'frontend/test/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },

  // Shared parser: plain TypeScript used by the browser, Node and Workers, so no DOM or Node APIs.
  {
    files: ['shared/**/*.ts'],
    ignores: ['shared/**/*.test.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        ...['window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'location', 'fetch'].map((name) => ({
          name,
          message: 'shared/ must not use DOM or network APIs.',
        })),
        ...['process', 'Buffer', 'require', '__dirname', '__filename', 'global'].map((name) => ({
          name,
          message: 'shared/ must not use Node APIs.',
        })),
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['node:*', 'fs', 'path', 'url', 'os'], message: 'shared/ must not import Node modules.' },
          ],
        },
      ],
    },
  },

  // Server + tooling (and the e2e tests, which run in Node and drive the browser)
  {
    files: ['backend/**/*.ts', '**/*.config.{js,ts}', 'eslint.config.js', 'e2e/**/*.{ts,mjs}'],
    languageOptions: { globals: globals.node },
  },

  // Tests
  {
    files: ['**/*.test.ts', 'backend/test/**/*.ts'],
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },

  // Must stay last: turns off rules that would fight Prettier.
  prettier,
);
