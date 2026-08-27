const typography = require('@tailwindcss/typography');
const defaultTheme = require('tailwindcss/defaultTheme');

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx}',
    './src/components/**/*.{js,ts,jsx,tsx}',
    './src/contexts/**/*.{js,ts,jsx,tsx}',
    './src/app/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      /* Three families, three jobs. Loaded in src/app/layout.tsx via
       * next/font/google, which supplies the --font-* variables.
       *   sans  — all UI and body copy (default on <body>)
       *   serif — editorial headings only
       *   mono  — numeric / tabular data only; pair with `tabular-nums` */
      maxWidth: {
        // The site's one content column. Every page shell uses it — scorecard,
        // platform, articles, methodology, footer — so the measure never
        // changes as you move around. Previously each page picked its own
        // Tailwind step (2xl through 6xl), which is why the site read as seven
        // different layouts.
        site: '776px',
      },
      fontFamily: {
        sans: ['var(--font-sans)', ...defaultTheme.fontFamily.sans],
        // `font-serif` is the EDITORIAL HEADING face, and it is not a serif:
        // it resolves to Poppins Bold — the same wordmark face as the logo.
        // Kept under the `serif` key so the ~109 existing call sites (all of
        // which already pair it with font-bold/semibold) keep working.
        serif: ['var(--font-sans)', ...defaultTheme.fontFamily.sans],
        mono: ['var(--font-mono)', ...defaultTheme.fontFamily.mono],
      },
      colors: {
        background: 'rgb(var(--background) / <alpha-value>)',
        foreground: 'rgba(var(--foreground) / <alpha-value>)',
        surface: 'rgba(var(--surface) / <alpha-value>)',
        'surface-elevated': 'rgba(var(--surface-elevated) / <alpha-value>)',
        overlay: 'rgba(var(--overlay) / <alpha-value>)',
        card: 'rgba(var(--card) / <alpha-value>)',
        'card-foreground': 'rgba(var(--card-foreground) / <alpha-value>)',
        popover: 'rgba(var(--popover) / <alpha-value>)',
        'popover-foreground': 'rgba(var(--popover-foreground) / <alpha-value>)',
        primary: 'rgba(var(--primary) / <alpha-value>)',
        'primary-foreground': 'rgba(var(--primary-foreground) / <alpha-value>)',
        'primary-accent': 'rgba(var(--primary-accent) / <alpha-value>)',
        secondary: 'rgba(var(--secondary) / <alpha-value>)',
        'secondary-foreground':
          'rgba(var(--secondary-foreground) / <alpha-value>)',
        'secondary-accent': 'rgba(var(--secondary-accent) / <alpha-value>)',
        muted: 'rgba(var(--muted) / <alpha-value>)',
        'muted-foreground': 'rgba(var(--muted-foreground) / <alpha-value>)',
        'subtle-foreground': 'rgba(var(--subtle-foreground) / <alpha-value>)',
        accent: 'rgba(var(--accent) / <alpha-value>)',
        'accent-foreground': 'rgba(var(--accent-foreground) / <alpha-value>)',
        success: 'rgba(var(--success) / <alpha-value>)',
        'success-foreground': 'rgba(var(--success-foreground) / <alpha-value>)',
        warning: 'rgba(var(--warning) / <alpha-value>)',
        'warning-foreground': 'rgba(var(--warning-foreground) / <alpha-value>)',
        destructive: 'rgba(var(--destructive) / <alpha-value>)',
        'destructive-foreground':
          'rgba(var(--destructive-foreground) / <alpha-value>)',
        info: 'rgba(var(--info) / <alpha-value>)',
        'info-foreground': 'rgba(var(--info-foreground) / <alpha-value>)',
        border: 'rgba(var(--border) / <alpha-value>)',
        input: 'rgba(var(--input) / <alpha-value>)',
        ring: 'rgba(var(--ring) / <alpha-value>)',
        'score-1': 'rgba(var(--score-1) / <alpha-value>)',
        'score-2': 'rgba(var(--score-2) / <alpha-value>)',
        'score-3': 'rgba(var(--score-3) / <alpha-value>)',
        'score-4': 'rgba(var(--score-4) / <alpha-value>)',
        'score-5': 'rgba(var(--score-5) / <alpha-value>)',
        'score-6': 'rgba(var(--score-6) / <alpha-value>)',
        'score-7': 'rgba(var(--score-7) / <alpha-value>)',
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-conic':
          'conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))',
      },
    },
  },
  darkMode: 'class',
  plugins: [typography],
};
