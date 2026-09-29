/** @type {import('tailwindcss').Config} */
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: token('bg'),
        surface: token('surface'),
        'surface-2': token('surface-2'),
        'surface-3': token('surface-3'),
        line: token('line'),
        'line-strong': token('line-strong'),
        fg: token('fg'),
        muted: token('muted'),
        subtle: token('subtle'),
        accent: token('accent'),
        'accent-fg': token('accent-fg'),
        indigo: token('indigo'),
        warn: token('warn'),
        info: token('info'),
        danger: token('danger'),
        ok: token('ok'),
      },
      fontFamily: {
        display: ['"Fraunces Variable"', 'Fraunces', 'ui-serif', 'Georgia', 'serif'],
        sans: ['"Instrument Sans Variable"', '"Instrument Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono Variable"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      boxShadow: {
        paper:
          '0 1px 0 rgb(var(--shadow) / 0.06), 0 2px 4px -1px rgb(var(--shadow) / 0.08), 0 10px 24px -12px rgb(var(--shadow) / 0.22)',
        lift: '0 1px 0 rgb(var(--shadow) / 0.06), 0 6px 10px -4px rgb(var(--shadow) / 0.12), 0 22px 40px -18px rgb(var(--shadow) / 0.34)',
        pop: '0 24px 64px -16px rgb(var(--shadow) / 0.45), 0 4px 16px -4px rgb(var(--shadow) / 0.2)',
        sticker: '0 1px 0 rgb(var(--shadow) / 0.08), 0 2px 5px -2px rgb(var(--shadow) / 0.22)',
      },
    },
  },
  plugins: [],
};
