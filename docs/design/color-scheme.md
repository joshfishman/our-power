# Our Power — Color & Typography System

Status: **implemented** (redesign-plan Phase 1). Base: **shadcn/ui stock defaults —
`new-york` style, `slate` base color, CSS variables on.**

The bespoke brand palette is retired. Wheat `#F5DEB3`, parchment `#C8B98A`, and
navy `#2C4A5E` are gone from the codebase; brick-red `#8B3A3A` did not map cleanly
onto either `--accent` or `--destructive` and was retired with them.

Every ratio in this document is **measured, not estimated**. `npm run design:contrast`
parses `src/app/globals.css` and recomputes all of them; it exits non-zero if any
pairing drops below its threshold.

---

## 1. Why the values moved but the architecture did not

The token _names_ already in `globals.css` — `background`, `foreground`, `card`,
`popover`, `primary`, `secondary`, `muted`, `accent`, `destructive`, `border`,
`input`, `ring` — are shadcn's exact schema. Adopting shadcn therefore meant
replacing token **values**, not plumbing.

**Decision: keep the existing RGB-triple convention; swap only the values.**

Tokens stay space-separated RGB triples consumed by Tailwind as
`rgba(var(--token) / <alpha-value>)`. shadcn's current published theme ships OKLCH
values behind `hsl()`-style vars, but converting the variable format would have
touched every one of the ~90 components and every `/<alpha>` call site (the app uses
`bg-primary/10`, `bg-muted/30`, `border-destructive/40` and friends heavily) for
zero visual gain. The RGB-triple form supports the same alpha syntax and is already
wired through `tailwind.config.js`. Cost of conversion: high. Benefit: none.

`darkMode: 'class'` is unchanged. `:root` and `.light` both define the light theme
so a subtree can force light inside a `.dark` ancestor — `/styleguide` renders both
themes side by side and depends on this.

---

## 2. The palette

### Core tokens — shadcn stock slate

| Token                      | Light     | Dark      |
| -------------------------- | --------- | --------- |
| `--background`             | `#ffffff` | `#020817` |
| `--foreground`             | `#020817` | `#f8fafc` |
| `--card`                   | `#ffffff` | `#0f172a` |
| `--card-foreground`        | `#020817` | `#f8fafc` |
| `--popover`                | `#ffffff` | `#0f172a` |
| `--popover-foreground`     | `#020817` | `#f8fafc` |
| `--primary`                | `#0f172a` | `#f8fafc` |
| `--primary-foreground`     | `#f8fafc` | `#0f172a` |
| `--secondary`              | `#f1f5f9` | `#1e293b` |
| `--secondary-foreground`   | `#0f172a` | `#f8fafc` |
| `--muted`                  | `#f1f5f9` | `#1e293b` |
| `--muted-foreground`       | `#475569` | `#94a3b8` |
| `--accent`                 | `#0f172a` | `#f8fafc` |
| `--accent-foreground`      | `#f8fafc` | `#0f172a` |
| `--destructive`            | `#b91c1c` | `#f87171` |
| `--destructive-foreground` | `#ffffff` | `#020817` |
| `--border`                 | `#e2e8f0` | `#1e293b` |
| `--input`                  | `#ffffff` | `#0f172a` |
| `--ring`                   | `#020817` | `#cbd5e1` |

### App-specific extras, derived from the same slate ramp

| Token                       | Light                 | Dark                  | Role                        |
| --------------------------- | --------------------- | --------------------- | --------------------------- |
| `--surface`                 | `#f8fafc`             | `#0f172a`             | cards                       |
| `--surface-elevated`        | `#f1f5f9`             | `#1e293b`             | raised panels               |
| `--overlay`                 | `#020817`             | `#000000`             | modal scrim                 |
| `--subtle-foreground`       | `#64748b`             | `#64748b`             | de-emphasized meta (see §3) |
| `--primary-accent`          | `#334155`             | `#cbd5e1`             | secondary ink               |
| `--secondary-accent`        | `#e2e8f0`             | `#334155`             | hover fill                  |
| `--success` / `-foreground` | `#15803d` / `#ffffff` | `#4ade80` / `#020817` |                             |
| `--warning` / `-foreground` | `#fef3c7` / `#92400e` | `#451a03` / `#fde68a` |                             |
| `--info` / `-foreground`    | `#1d4ed8` / `#ffffff` | `#60a5fa` / `#020817` |                             |

### Diverging score ramp

| Token               | Light     | Dark      | Light ratio on bg | Dark ratio on bg |
| ------------------- | --------- | --------- | ----------------: | ---------------: |
| `--score-1` worst   | `#b91c1c` | `#f87171` |              6.47 |             7.23 |
| `--score-2`         | `#c2410c` | `#fdba74` |              5.18 |            11.86 |
| `--score-3`         | `#b45309` | `#fcd34d` |              5.02 |            13.87 |
| `--score-4` neutral | `#475569` | `#94a3b8` |              7.58 |             7.80 |
| `--score-5`         | `#4d7c0f` | `#bef264` |              4.99 |            15.31 |
| `--score-6`         | `#15803d` | `#86efac` |              5.02 |            14.25 |
| `--score-7` best    | `#166534` | `#4ade80` |              7.13 |            11.48 |

---

## 3. Measured contrast

Worst case is always `--secondary` / `--muted` (`#f1f5f9` light, `#1e293b` dark) —
the tightest surface either theme has. Body text is held to **AA 4.5:1**.

### Text tokens — worst ratio across background, surface, surface-elevated, card, muted, secondary, popover

| Token                 |           Light worst |             Dark worst |
| --------------------- | --------------------: | ---------------------: |
| `foreground`          |                 18.26 |                  13.98 |
| `muted-foreground`    |                  6.92 |                   5.71 |
| `accent` / `primary`  |                 16.30 |                  13.98 |
| `destructive`         |                  5.91 |                   5.29 |
| `info`                |                  6.12 |                   5.75 |
| `success`             |                  4.58 |                   8.40 |
| `score-1` … `score-7` | 4.56 (score-5) … 6.92 | 5.29 (score-1) … 11.20 |

**Every one clears 4.5:1 in both themes.** The tightest pairing in the whole system
is `score-5` on `secondary` at 4.56:1.

### Paired foreground/background tokens

| Pair                                      | Light |  Dark |
| ----------------------------------------- | ----: | ----: |
| `primary-foreground` on `primary`         | 17.06 | 17.06 |
| `accent-foreground` on `accent`           | 17.06 | 17.06 |
| `secondary-foreground` on `secondary`     | 16.30 | 13.98 |
| `success-foreground` on `success`         |  5.02 | 11.48 |
| `warning-foreground` on `warning`         |  6.37 | 12.03 |
| `destructive-foreground` on `destructive` |  6.47 |  7.23 |
| `info-foreground` on `info`               |  6.70 |  7.87 |
| `card-foreground` on `card`               | 20.01 | 17.06 |

### The one carve-out: `--subtle-foreground`

`#64748b` (slate-500) in both themes. It is the **AA-Large / UI tier**, held to
**3:1**, and is documented as such:

| Surface                              | Light | Dark |
| ------------------------------------ | ----: | ---: |
| background                           |  4.76 | 4.20 |
| surface                              |  4.55 | 3.75 |
| surface-elevated / muted / secondary |  4.34 | 3.07 |

Use it only for de-emphasized meta — eyebrow labels, timestamps, source captions —
never for body copy. A value that cleared 4.5:1 on every surface in both themes
would be indistinguishable from `muted-foreground`, which would make the token
pointless. This is a deliberate three-tier ladder: `foreground` (max) →
`muted-foreground` (AA everywhere) → `subtle-foreground` (AA-Large).

### Focus ring vs. hairlines

`--ring` clears 3:1 comfortably (20.01 light, 13.47 dark) as WCAG 1.4.11 requires
for a state indicator. `--border` measures 1.23:1 (light) / 1.37:1 (dark) — this is
shadcn's stock slate hairline and is **intentional**. Separators are decorative and
never the sole indicator of a control's boundary, so 1.4.11 exempts them. The
checker reports these but does not gate on them.

---

## 4. Deviations from literal shadcn stock, and why

Three, all documented rather than silent:

1. **`--muted-foreground` light is `#475569` (slate-600), not stock `#64748b`.**
   Stock measures 4.34:1 on `--muted`/`--secondary`, which fails AA — and
   `text-muted-foreground` is the app's single most-used utility (419 call sites),
   frequently on those surfaces. Slate-600 takes it to 6.92:1.

2. **`--destructive` light is `#b91c1c`, dark `#f87171`.** shadcn's older slate
   theme used `#ef4444`, which is 3.76:1 on white — fine as a _background_ (which is
   how shadcn uses it) but failing as text. This app uses `text-destructive` for
   money figures and vote positions, so the shade steps to the AA-passing member of
   the same stock Tailwind red ramp. (shadcn's current default destructive is
   already at roughly red-600 lightness, so this is close to current stock anyway.)

3. **`--input` stays a field _background_ (`#ffffff` / `#0f172a`).** In stock shadcn
   `input` is a border color consumed as `border-input`; this app has 9 `bg-input`
   call sites and no `border-input`. Retaining the app's semantic avoids
   gray-filled text fields for no benefit.

Additionally, `--accent` is deliberately **identical to `--primary`**. Under stock
slate there is exactly one interactive ink color. The app uses `accent` for
selected/active/link emphasis (~86 call sites) and `primary` for buttons (~50), so
both names are kept — the distinction is reserved for a future brand pass, not
invented now.

---

## 5. Typography

Three families, three jobs. Loaded in `src/app/layout.tsx` via `next/font/google`,
exposed as `--font-sans` / `--font-serif` / `--font-mono` and wired into
`tailwind.config.js → theme.extend.fontFamily`.

| Utility      | Family         | Use for                                                                                       | Never use for           |
| ------------ | -------------- | --------------------------------------------------------------------------------------------- | ----------------------- |
| `font-sans`  | Poppins        | All UI and body copy. Default on `<body>`.                                                    | —                       |
| `font-serif` | Source Serif 4 | Editorial headings only — article/essay h1–h3.                                                | Body copy, labels       |
| `font-mono`  | IBM Plex Mono  | Numeric/tabular data: money, scores, percentages, vote counts, IDs. Pair with `tabular-nums`. | Prose, labels, eyebrows |

The rule exists because the codebase had Poppins at root fighting 298 `font-mono`
and 110 `font-serif` uses, most of them mono-as-prose. Phase 1 defines the system
and unwinds mono-as-prose on the pages it touched; the remaining call sites are
cleaned up as each page migrates in Phase 3.

---

## 6. Enforcement

**Arbitrary hex color classes are banned by ESLint** under `src/app/**` and
`src/components/**`. `.eslintrc.json` adds a `no-restricted-syntax` override
matching `/\[#[0-9a-fA-F]{3,8}/` against both `Literal` and `TemplateElement`
nodes, because class strings in this codebase are built both ways:

```
bg-[#8B3A3A]  text-[#F5DEB3]/70  border-[#C8B98A]/30   ← all errors
```

Such classes bypass the token layer entirely: they cannot respond to light/dark and
are never contrast-verified. Without the rule this regresses immediately — the 55
literals Phase 1 removed were _all_ introduced on `dev` after the v1.9 token
migration had already landed.

Two commands guard the system:

```bash
npm run lint             # bans arbitrary hex classes
npm run design:contrast  # re-measures every pairing from globals.css
```

---

## 7. Migration reference

| Old                                                             | New                                                                 |
| --------------------------------------------------------------- | ------------------------------------------------------------------- |
| `bg-[#2C4A5E]/60` panel + `text-[#F5DEB3]`                      | `bg-surface-elevated` + `text-foreground` / `text-muted-foreground` |
| `border-[#C8B98A]/30`                                           | `border-border`                                                     |
| `bg-[#8B3A3A]` + `text-[#F5DEB3]` badge                         | `bg-destructive text-destructive-foreground`                        |
| navy badge + wheat text                                         | `bg-accent text-accent-foreground`                                  |
| `text-[#8B3A3A]` money figure                                   | `text-destructive`                                                  |
| `bg-[#8B3A3A]/10` tinted panel                                  | `bg-destructive/10` + `border-destructive/40`                       |
| `bg-[#F5DEB3]/10` bar track                                     | `bg-muted-foreground/20`                                            |
| `bg-[#1d4ed8]` / `bg-[#b91c1c]` / `bg-[#6b7280]` party swatches | `bg-info` / `bg-score-1` / `bg-subtle-foreground`                   |
| `stroke="#8B3A3A"` (SVG)                                        | `stroke="rgb(var(--destructive))"`                                  |
| chart series hex in `articles.ts`                               | `rgb(var(--score-1))` etc.                                          |
| confidence high/medium/low hex                                  | `bg-success` / `bg-warning` / `bg-destructive` + paired foreground  |
| `bg-accent … text-white`                                        | `bg-accent … text-accent-foreground`                                |
| `bg-warning` used as a progress-bar fill                        | `bg-score-3` (warning is a surface token, not a fill)               |
| `border-white bg-black/70` marker                               | `border-background bg-foreground`                                   |

`Plank.color` in `federal-planks.ts` / `ca-planks.ts` still holds brand hex. Those
values are seed data written to the `Plank.color` column and are **not rendered by
any page**, so they were left alone rather than triggering a reseed.

---

## 8. Scope note

Phase 1 covers the token foundation, the typography system, the hex sweep, and
enforcement. It does **not** migrate the 16 scorecard pages onto a shared component
layer (Phase 2/3), and ~35 files still use theme-blind raw palette utilities
(`bg-slate-800`, `text-gray-500`) that ignore `.dark`. Those are tracked in
`docs/design/redesign-plan.md`.
