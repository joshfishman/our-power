'use client';

import type { CSSProperties } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import Button from '@/components/ui/Button';

/** Editable semantic tokens (space-separated "R G B" triples, matching globals.css). */
const TOKENS = [
  'background',
  'surface',
  'surface-elevated',
  'card',
  'card-foreground',
  'popover',
  'popover-foreground',
  'overlay',
  'foreground',
  'muted',
  'muted-foreground',
  'subtle-foreground',
  'primary',
  'primary-foreground',
  'primary-accent',
  'secondary',
  'secondary-foreground',
  'secondary-accent',
  'accent',
  'accent-foreground',
  'success',
  'success-foreground',
  'warning',
  'warning-foreground',
  'destructive',
  'destructive-foreground',
  'info',
  'info-foreground',
  'border',
  'input',
  'ring',
  'score-1',
  'score-2',
  'score-3',
  'score-4',
  'score-5',
  'score-6',
  'score-7',
] as const;

type Token = (typeof TOKENS)[number];
type Theme = 'light' | 'dark';
type ThemeValues = Record<string, string>;

/** Text-on-surface pairings we hold to WCAG AA (4.5:1 body). */
const PAIRS: { label: string; fg: Token; bg: Token }[] = [
  { label: 'foreground / background', fg: 'foreground', bg: 'background' },
  { label: 'muted-foreground / background', fg: 'muted-foreground', bg: 'background' },
  { label: 'subtle-foreground / background', fg: 'subtle-foreground', bg: 'background' },
  { label: 'muted-foreground / muted', fg: 'muted-foreground', bg: 'muted' },
  { label: 'card-foreground / card', fg: 'card-foreground', bg: 'card' },
  { label: 'primary-foreground / primary', fg: 'primary-foreground', bg: 'primary' },
  { label: 'accent-foreground / accent', fg: 'accent-foreground', bg: 'accent' },
  { label: 'success-foreground / success', fg: 'success-foreground', bg: 'success' },
  { label: 'warning-foreground / warning', fg: 'warning-foreground', bg: 'warning' },
  { label: 'destructive-foreground / destructive', fg: 'destructive-foreground', bg: 'destructive' },
];

// ── color math ──────────────────────────────────────────────────────────────
function parseTriple(triple: string): [number, number, number] {
  const parts = triple.trim().split(/\s+/).map(Number);
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
}
const clampByte = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
const toHexByte = (n: number) => clampByte(n).toString(16).padStart(2, '0');

function tripleToHex(triple: string): string {
  const [r, g, b] = parseTriple(triple);
  return `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`;
}
function hexToTriple(hex: string): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `${r} ${g} ${b}`;
}
function relLuminance([r, g, b]: [number, number, number]): number {
  const lin = [r, g, b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}
function contrastRatio(a: string, b: string): number {
  const la = relLuminance(parseTriple(a));
  const lb = relLuminance(parseTriple(b));
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Read the live computed value of every token from a reference element. */
function readTheme(el: HTMLElement): ThemeValues {
  const cs = getComputedStyle(el);
  const out: ThemeValues = {};
  for (const t of TOKENS) out[t] = cs.getPropertyValue(`--${t}`).trim() || '0 0 0';
  return out;
}

const OVERRIDE_STYLE_ID = 'op-theme-overrides';
/** Inject/update a <style> carrying the user's theme so it overrides globals.css app-wide. */
function injectOverrideStyle(css: string) {
  let el = document.getElementById(OVERRIDE_STYLE_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = OVERRIDE_STYLE_ID;
    document.head.appendChild(el);
  }
  el.textContent = css;
}
function removeOverrideStyle() {
  document.getElementById(OVERRIDE_STYLE_ID)?.remove();
}

export default function ThemePlayground() {
  const lightRef = useRef<HTMLDivElement>(null);
  const darkRef = useRef<HTMLDivElement>(null);
  const [themes, setThemes] = useState<Record<Theme, ThemeValues> | null>(null);
  const [active, setActive] = useState<Theme>('light');
  const [copied, setCopied] = useState(false);
  const [applyToPage, setApplyToPage] = useState(false);
  const [saved, setSaved] = useState(false);

  // Seed both themes from the hidden reference elements after mount.
  useEffect(() => {
    if (lightRef.current && darkRef.current) {
      setThemes({ light: readTheme(lightRef.current), dark: readTheme(darkRef.current) });
    }
    setSaved(!!localStorage.getItem('op-theme-css'));
  }, []);

  const current = themes?.[active];

  // Optionally mirror the edited theme onto the whole document (inline vars on
  // <html> override :root/.dark) so the live app recolors. Cleaned up on toggle
  // off and on unmount so navigating away never leaves the page stuck.
  useEffect(() => {
    const root = document.documentElement;
    const clear = () => TOKENS.forEach((t) => root.style.removeProperty(`--${t}`));
    if (applyToPage && current) {
      TOKENS.forEach((t) => root.style.setProperty(`--${t}`, current[t]));
    } else {
      clear();
    }
    return clear;
  }, [applyToPage, current]);

  const setToken = (token: string, hex: string) => {
    setThemes((prev) => (prev ? { ...prev, [active]: { ...prev[active], [token]: hexToTriple(hex) } } : prev));
  };
  const resetActive = () => {
    const ref = active === 'light' ? lightRef.current : darkRef.current;
    if (ref) setThemes((prev) => (prev ? { ...prev, [active]: readTheme(ref) } : prev));
  };

  // Inline CSS-variable overrides for the live preview subtree.
  const previewStyle = useMemo(() => {
    if (!current) return {};
    const style: Record<string, string> = {};
    for (const t of TOKENS) style[`--${t}`] = current[t];
    return style as CSSProperties;
  }, [current]);

  const exportCss = useMemo(() => {
    if (!themes) return '';
    const block = (sel: string, vals: ThemeValues) =>
      `${sel} {\n${TOKENS.map((t) => `  --${t}: ${vals[t]};`).join('\n')}\n}`;
    return `${block(':root,\n.light', themes.light)}\n\n${block('.dark', themes.dark)}`;
  }, [themes]);

  const copyCss = async () => {
    try {
      await navigator.clipboard.writeText(exportCss);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — the textarea is selectable as a fallback */
    }
  };

  // Persist this scheme to localStorage; the root layout re-injects it on every
  // page load so it themes the whole app across reloads (this browser only).
  const saveAsAppTheme = () => {
    localStorage.setItem('op-theme-css', exportCss);
    injectOverrideStyle(exportCss);
    setSaved(true);
  };
  const clearSavedTheme = () => {
    localStorage.removeItem('op-theme-css');
    removeOverrideStyle();
    setSaved(false);
  };

  return (
    <section className="rounded-2xl border border-border bg-surface p-6">
      {/* Hidden references so we can read the real default light + dark token values. */}
      <div ref={lightRef} className="light" style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }} />
      <div ref={darkRef} className="dark" style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }} />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold text-foreground">Theme Playground</h3>
          <p className="text-sm text-muted-foreground">
            Drag a swatch → the preview recolors live. Pairings that drop below WCAG AA flash red. Export pastes
            straight into <span className="font-mono">globals.css</span>.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-border">
            {(['light', 'dark'] as Theme[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setActive(t)}
                className={`px-3 py-1.5 text-sm font-semibold capitalize ${
                  active === t ? 'bg-primary text-primary-foreground' : 'bg-surface text-muted-foreground'
                }`}>
                {t}
              </button>
            ))}
          </div>
          <Button mode="secondary" size="small" onPress={resetActive}>
            Reset {active}
          </Button>
          <label className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            <input
              type="checkbox"
              checked={applyToPage}
              onChange={(e) => setApplyToPage(e.target.checked)}
              className="h-4 w-4 cursor-pointer accent-primary"
            />
            Apply to page
          </label>
        </div>
      </div>

      {!current ? (
        <p className="text-muted-foreground">Reading current theme…</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
          {/* ── Controls ── */}
          <div className="grid max-h-[28rem] grid-cols-2 gap-x-4 gap-y-2 overflow-y-auto pr-2 sm:grid-cols-3">
            {TOKENS.map((token) => (
              <label key={token} className="flex items-center gap-2 text-xs">
                <input
                  type="color"
                  aria-label={token}
                  value={tripleToHex(current[token])}
                  onChange={(e) => setToken(token, e.target.value)}
                  className="h-7 w-7 shrink-0 cursor-pointer rounded border border-border bg-transparent p-0"
                />
                <span className="truncate font-mono text-muted-foreground">{token}</span>
              </label>
            ))}
          </div>

          {/* ── Live preview + contrast + export ── */}
          <div className="flex flex-col gap-4">
            <div className={active} style={previewStyle}>
              <div className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4">
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <span className="text-base font-semibold text-foreground">Heading text</span>
                  <span className="text-sm text-muted-foreground">muted body</span>
                  <span className="text-xs text-subtle-foreground">subtle caption</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="small" mode="primary">
                    Primary
                  </Button>
                  <Button size="small" mode="secondary">
                    Secondary
                  </Button>
                  <span className="inline-flex items-center rounded-full bg-accent px-3 py-1 text-xs font-semibold text-accent-foreground">
                    Accent
                  </span>
                  <span className="inline-flex items-center rounded-full bg-destructive px-3 py-1 text-xs font-semibold text-destructive-foreground">
                    Destructive
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(['score-1', 'score-2', 'score-3', 'score-4', 'score-5', 'score-6', 'score-7'] as const).map((s) => (
                    <span
                      key={s}
                      className="rounded-full px-2.5 py-0.5 text-xs font-bold text-background"
                      style={{ backgroundColor: `rgb(${current[s]})` }}>
                      {s.replace('score-', '')}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* Contrast guard */}
            <div className="rounded-xl border border-border p-3">
              <div className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                Contrast (WCAG AA = 4.5:1)
              </div>
              <ul className="flex flex-col gap-1">
                {PAIRS.map((p) => {
                  const ratio = contrastRatio(current[p.fg], current[p.bg]);
                  const pass = ratio >= 4.5;
                  return (
                    <li key={p.label} className="flex items-center justify-between gap-2 text-xs">
                      <span className="truncate font-mono text-muted-foreground">{p.label}</span>
                      <span
                        className={`shrink-0 rounded px-1.5 py-0.5 font-bold ${
                          pass ? 'bg-success text-success-foreground' : 'bg-destructive text-destructive-foreground'
                        }`}>
                        {ratio.toFixed(2)}:1 {pass ? 'AA' : 'FAIL'}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>

            {/* Export + persist */}
            <div className="rounded-xl border border-border p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  Make it the theme
                </span>
                <div className="flex items-center gap-2">
                  <Button size="small" mode="primary" onPress={saveAsAppTheme}>
                    {saved ? 'Update saved theme' : 'Save as app theme'}
                  </Button>
                  {saved && (
                    <Button size="small" mode="ghost" onPress={clearSavedTheme}>
                      Clear
                    </Button>
                  )}
                  <Button size="small" mode="secondary" onPress={copyCss}>
                    {copied ? 'Copied!' : 'Copy CSS'}
                  </Button>
                </div>
              </div>
              <p className="mb-2 text-[11px] text-subtle-foreground">
                <span className="font-semibold text-muted-foreground">Save as app theme</span> persists this scheme and
                re-applies it across the whole app on every reload (this browser only).{' '}
                <span className="font-semibold text-muted-foreground">Copy CSS</span> bakes it in permanently — paste
                the two blocks over <span className="font-mono">globals.css</span>.
              </p>
              <textarea
                readOnly
                value={exportCss}
                onFocus={(e) => e.currentTarget.select()}
                className="h-40 w-full resize-none rounded-lg border border-border bg-surface-elevated p-2 font-mono text-[11px] text-foreground"
              />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
