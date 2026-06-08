import type { ReactNode } from 'react';
import Button from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { TextInput } from '@/components/ui/TextInput';
import ThemePlayground from './ThemePlayground';

export const metadata = {
  title: 'Style Guide — Our Power',
  description: 'Design tokens, score ramp, and core primitives in both themes.',
};

/** A surface token (no paired foreground) — shown as a filled box. */
const SURFACES: { name: string; cls: string; note: string }[] = [
  { name: 'background', cls: 'bg-background', note: 'page' },
  { name: 'surface', cls: 'bg-surface', note: 'cards' },
  { name: 'surface-elevated', cls: 'bg-surface-elevated', note: 'raised panels' },
  { name: 'muted', cls: 'bg-muted', note: 'muted fill' },
  { name: 'secondary', cls: 'bg-secondary', note: 'neutral button' },
  { name: 'input', cls: 'bg-input', note: 'field bg' },
  { name: 'border', cls: 'bg-border', note: 'hairlines' },
];

/** Text tokens rendered on the page background. */
const TEXT_TOKENS: { name: string; cls: string; note: string }[] = [
  { name: 'foreground', cls: 'text-foreground', note: '14.6:1 on bg — AA ✅' },
  { name: 'muted-foreground', cls: 'text-muted-foreground', note: '7.6:1 on bg — AA ✅' },
  { name: 'subtle-foreground', cls: 'text-subtle-foreground', note: '4.76:1 — large/UI only ✅' },
];

/** Solid color tokens paired with their on-color foreground. */
const PAIRS: { name: string; bg: string; fg: string; note: string }[] = [
  { name: 'primary', bg: 'bg-primary', fg: 'text-primary-foreground', note: '5.36:1 — AA ✅' },
  { name: 'secondary', bg: 'bg-secondary', fg: 'text-secondary-foreground', note: '13:1 — AA ✅' },
  { name: 'accent', bg: 'bg-accent', fg: 'text-accent-foreground', note: '7.06:1 — AA ✅' },
  { name: 'success', bg: 'bg-success', fg: 'text-success-foreground', note: '5.02:1 — AA ✅' },
  { name: 'warning', bg: 'bg-warning', fg: 'text-warning-foreground', note: '6.38:1 — AA ✅' },
  { name: 'destructive', bg: 'bg-destructive', fg: 'text-destructive-foreground', note: '6.47:1 — AA ✅' },
  { name: 'info', bg: 'bg-info', fg: 'text-info-foreground', note: '= primary' },
];

/* Diverging score ramp, worst → best. Ratios are light-theme (text on white).
 * Full literal class strings (NOT `bg-score-${n}`) so Tailwind's scanner emits them. */
const SCORES: { label: string; ratio: string; bg: string; text: string }[] = [
  { label: 'Worst', ratio: '6.47:1', bg: 'bg-score-1', text: 'text-score-1' },
  { label: 'Bad', ratio: '5.18:1', bg: 'bg-score-2', text: 'text-score-2' },
  { label: 'Below avg', ratio: '4.92:1', bg: 'bg-score-3', text: 'text-score-3' },
  { label: 'Neutral', ratio: '7.58:1', bg: 'bg-score-4', text: 'text-score-4' },
  { label: 'Above avg', ratio: '4.99:1', bg: 'bg-score-5', text: 'text-score-5' },
  { label: 'Good', ratio: '5.02:1', bg: 'bg-score-6', text: 'text-score-6' },
  { label: 'Best', ratio: '7.13:1', bg: 'bg-score-7', text: 'text-score-7' },
];

const BTN_MODES = ['primary', 'secondary', 'subtle', 'ghost'] as const;
const BTN_SIZES = ['large', 'medium', 'small'] as const;

function SectionTitle({ children, sub }: { children: ReactNode; sub?: string }) {
  return (
    <div className="mb-3">
      <h3 className="text-sm font-bold uppercase tracking-wide text-foreground">{children}</h3>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

/** The full token + primitive showcase. Rendered once per theme. */
function Showcase() {
  return (
    <div className="flex flex-col gap-8">
      {/* Surfaces */}
      <section>
        <SectionTitle sub="Filled with the bg token; label sits on it as foreground.">Surfaces</SectionTitle>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {SURFACES.map((s) => (
            <div key={s.name} className={`${s.cls} rounded-lg border border-border p-3`}>
              <div className="font-mono text-xs text-foreground">{s.name}</div>
              <div className="text-[11px] text-muted-foreground">{s.note}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Text tokens */}
      <section>
        <SectionTitle sub="Body text on the page background.">Text</SectionTitle>
        <div className="flex flex-col gap-1.5">
          {TEXT_TOKENS.map((t) => (
            <div key={t.name} className="flex flex-wrap items-baseline gap-x-3">
              <span className={`${t.cls} text-base font-medium`}>The quick brown fox — {t.name}</span>
              <span className="font-mono text-[11px] text-muted-foreground">{t.note}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Color pairs */}
      <section>
        <SectionTitle sub="Solid color + its on-color foreground (contrast verified).">Color pairs</SectionTitle>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {PAIRS.map((p) => (
            <div key={p.name} className={`${p.bg} ${p.fg} rounded-lg p-3`}>
              <div className="font-mono text-xs font-semibold">{p.name}</div>
              <div className="text-[11px] opacity-90">Aa — {p.note}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Score ramp */}
      <section>
        <SectionTitle sub="Diverging red↔green ramp; every step clears AA on white.">Score ramp</SectionTitle>
        <div className="mb-3 flex flex-wrap gap-2">
          {SCORES.map((s) => (
            <span key={s.bg} className={`${s.bg} rounded-full px-3 py-1 text-xs font-semibold text-background`}>
              {s.label}
            </span>
          ))}
        </div>
        <div className="flex flex-col gap-1">
          {SCORES.map((s) => (
            <div key={s.text} className="flex flex-wrap items-baseline gap-x-3">
              <span className={`${s.text} text-lg font-bold tabular-nums`}>
                72% — {s.text} ({s.label})
              </span>
              <span className="font-mono text-[11px] text-muted-foreground">{s.ratio}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Primitives */}
      <section>
        <SectionTitle>Buttons</SectionTitle>
        <div className="flex flex-col gap-3">
          {BTN_SIZES.map((size) => (
            <div key={size} className="flex flex-wrap items-center gap-2">
              {BTN_MODES.map((mode) => (
                <Button key={mode} size={size} mode={mode}>
                  {mode}
                </Button>
              ))}
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-2">
            <Button shape="pill">pill</Button>
            <Button mode="primary" loading>
              loading
            </Button>
            <Button mode="secondary" isDisabled>
              disabled
            </Button>
          </div>
        </div>
      </section>

      <section>
        <SectionTitle>Inputs</SectionTitle>
        <div className="flex max-w-sm flex-col gap-3">
          <TextInput label="Email address" aria-label="Email address" />
          <TextInput label="With error" aria-label="With error" errorMessage="Something needs fixing." />
        </div>
      </section>

      <section>
        <SectionTitle>Badge &amp; sample card</SectionTitle>
        <div className="flex flex-wrap items-center gap-4">
          <span className="flex items-center gap-2 text-sm text-foreground">
            Notifications <Badge>3</Badge>
          </span>
          <div className="max-w-xs rounded-xl border border-border bg-surface p-4">
            <div className="text-sm font-semibold text-foreground">Sample card</div>
            <p className="mt-1 text-sm text-muted-foreground">
              A card on <span className="font-mono">bg-surface</span> with a{' '}
              <span className="font-mono">border-border</span> edge and{' '}
              <span className="font-mono">text-muted-foreground</span> body copy.
            </p>
            <div className="mt-3 flex items-center gap-2">
              <span className="rounded-full bg-score-7 px-2.5 py-0.5 text-xs font-bold text-background">88%</span>
              <span className="text-xs text-subtle-foreground">overall score</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

export default function StyleGuidePage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-foreground">Style Guide</h1>
        <p className="mt-1 text-muted-foreground">
          Semantic design tokens, the diverging score ramp, and core primitives — rendered in both themes at once. See{' '}
          <span className="font-mono text-sm">docs/design/color-scheme.md</span> for the full palette and contrast
          analysis.
        </p>
      </header>

      <div className="mb-8">
        <ThemePlayground />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Light theme (the default). `.light` forces light even if the visitor's saved theme is dark. */}
        <div className="light rounded-2xl border border-border bg-background p-6 text-foreground">
          <div className="mb-6 inline-block rounded-full bg-surface-elevated px-3 py-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Light
          </div>
          <Showcase />
        </div>

        {/* Dark theme — the .dark class re-scopes the CSS variables for this subtree. */}
        <div className="dark rounded-2xl border border-border bg-background p-6 text-foreground">
          <div className="mb-6 inline-block rounded-full bg-surface-elevated px-3 py-1 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            Dark
          </div>
          <Showcase />
        </div>
      </div>
    </div>
  );
}
