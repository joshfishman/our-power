#!/usr/bin/env node
/**
 * WCAG contrast verifier for the design tokens in src/app/globals.css.
 *
 * Parses the `:root, .light` and `.dark` blocks, then checks every
 * text-on-surface pairing the app actually uses. Run with:
 *
 *   npm run design:contrast
 *
 * Exits non-zero if any required pairing drops below its threshold, so the
 * palette cannot silently regress. Thresholds follow WCAG 2.1 AA:
 *   - body text            >= 4.5:1
 *   - large / UI-only text >= 3.0:1  (the `subtle-foreground` tier)
 *   - non-text UI (borders, focus ring) >= 3.0:1
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const cssPath = resolve(here, '../src/app/globals.css');
const css = readFileSync(cssPath, 'utf8');

/** Pull `--token: R G B;` declarations out of one CSS block. */
function parseBlock(selector) {
  const start = css.indexOf(selector);
  if (start === -1) throw new Error(`Could not find "${selector}" in globals.css`);
  const open = css.indexOf('{', start);
  const end = css.indexOf('\n  }', open);
  const body = css.slice(open, end === -1 ? undefined : end);
  const tokens = {};
  for (const m of body.matchAll(/--([a-z0-9-]+):\s*(\d+)\s+(\d+)\s+(\d+)\s*;/g)) {
    tokens[m[1]] = [Number(m[2]), Number(m[3]), Number(m[4])];
  }
  return tokens;
}

const light = parseBlock(':root,');
const dark = parseBlock('.dark {');

const channel = (c) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
const ratio = (a, b) => {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
};
const toHex = ([r, g, b]) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;

/** Surfaces that body text is placed on somewhere in the app. */
const SURFACES = ['background', 'surface', 'surface-elevated', 'card', 'muted', 'secondary', 'popover'];

/** Tokens used as body text via `text-*` utilities. Must clear 4.5:1 on every surface. */
const BODY_TEXT = [
  'foreground',
  'muted-foreground',
  'destructive',
  'accent',
  'primary',
  'info',
  'success',
  'score-1',
  'score-2',
  'score-3',
  'score-4',
  'score-5',
  'score-6',
  'score-7',
];

/** Foreground/background token pairs designed to be used together. */
const PAIRS = [
  ['primary-foreground', 'primary'],
  ['accent-foreground', 'accent'],
  ['secondary-foreground', 'secondary'],
  ['success-foreground', 'success'],
  ['warning-foreground', 'warning'],
  ['destructive-foreground', 'destructive'],
  ['info-foreground', 'info'],
  ['card-foreground', 'card'],
  ['popover-foreground', 'popover'],
  ['foreground', 'warning'],
];

/**
 * Focus indicators. WCAG 2.1 SC 1.4.11 requires 3:1 for UI components that
 * convey state, which the focus ring does.
 */
const UI_PAIRS = [
  ['ring', 'background'],
  ['ring', 'surface'],
  ['ring', 'card'],
];

/**
 * Hairline separators. Reported for visibility but NOT gated: they are
 * decorative, never the sole indicator of a control's boundary, and shadcn's
 * stock slate deliberately keeps them low-contrast. SC 1.4.11 exempts them.
 */
const HAIRLINES = [
  ['border', 'background'],
  ['border', 'surface'],
  ['border', 'card'],
];

const BODY_MIN = 4.5;
const LARGE_MIN = 3;

let failures = 0;
const report = (ok, line) => {
  if (!ok) failures += 1;
  console.log(`${ok ? '  ok  ' : ' FAIL '}${line}`);
};

for (const [themeName, tokens] of [
  ['LIGHT', light],
  ['DARK', dark],
]) {
  console.log(`\n=================== ${themeName} ===================`);

  console.log(`\n-- body text on surfaces (>= ${BODY_MIN.toFixed(1)}:1) --`);
  for (const text of BODY_TEXT) {
    if (!tokens[text]) continue;
    const cells = SURFACES.filter((s) => tokens[s]).map((s) => {
      const r = ratio(tokens[text], tokens[s]);
      return { s, r };
    });
    const worst = cells.reduce((a, b) => (a.r < b.r ? a : b));
    report(
      worst.r >= BODY_MIN,
      `${text.padEnd(17)} ${toHex(tokens[text])}  worst ${worst.r.toFixed(2)}:1 on ${worst.s}   [${cells
        .map((c) => `${c.s}=${c.r.toFixed(2)}`)
        .join(' ')}]`,
    );
  }

  console.log(`\n-- subtle-foreground, large/UI tier (>= ${LARGE_MIN.toFixed(1)}:1) --`);
  if (tokens['subtle-foreground']) {
    for (const s of SURFACES.filter((x) => tokens[x])) {
      const r = ratio(tokens['subtle-foreground'], tokens[s]);
      report(r >= LARGE_MIN, `subtle-foreground on ${s.padEnd(17)} ${r.toFixed(2)}:1`);
    }
  }

  console.log(`\n-- paired foreground/background tokens (>= ${BODY_MIN.toFixed(1)}:1) --`);
  for (const [fg, bg] of PAIRS) {
    if (!tokens[fg] || !tokens[bg]) continue;
    const r = ratio(tokens[fg], tokens[bg]);
    report(r >= BODY_MIN, `${`${fg} on ${bg}`.padEnd(42)} ${r.toFixed(2)}:1`);
  }

  console.log(`\n-- focus indicator (>= ${LARGE_MIN.toFixed(1)}:1) --`);
  for (const [fg, bg] of UI_PAIRS) {
    if (!tokens[fg] || !tokens[bg]) continue;
    const r = ratio(tokens[fg], tokens[bg]);
    report(r >= LARGE_MIN, `${`${fg} vs ${bg}`.padEnd(42)} ${r.toFixed(2)}:1`);
  }

  console.log('\n-- hairline separators (informational, not gated) --');
  for (const [fg, bg] of HAIRLINES) {
    if (!tokens[fg] || !tokens[bg]) continue;
    console.log(`  --   ${`${fg} vs ${bg}`.padEnd(42)} ${ratio(tokens[fg], tokens[bg]).toFixed(2)}:1`);
  }
}

console.log(`\n${failures === 0 ? 'PASS' : `FAIL — ${failures} pairing(s) below threshold`}`);
process.exit(failures === 0 ? 0 : 1);
