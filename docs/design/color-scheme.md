# Our Power — Color & Readability Audit + Proposed Scheme

Status: proposal (no component code refactored). Author: design/frontend audit.
All contrast ratios below were computed with the WCAG 2.1 relative-luminance
formula. AA thresholds: **4.5:1** for body text, **3:1** for large text (≥18.66px
bold / ≥24px) and UI elements.

---

## 1. Current-state summary

### Mechanism (the good part)
- **Tailwind `darkMode: 'class'`** (`tailwind.config.js:48`). Theme toggled by
  adding/removing `.dark` on `<html>` via `ThemeContext` + an inline no-flash
  script in `layout.tsx:47`.
- **Semantic tokens via CSS variables.** `globals.css` defines `:root` and
  `.dark` token sets as space-separated RGB triples; `tailwind.config.js` maps
  them to utilities with `rgba(var(--token) / <alpha-value>)`. Tokens exist for
  background, foreground, card, popover, primary, secondary, muted, accent,
  success, warning, destructive, border, input. This is a clean, modern setup.
- UI primitives (`Button`, `TextInput`, `buttonVariants.ts`) mostly consume
  these tokens correctly. The token-based parts of the app are **not** the
  problem.

### The three structural defects
1. **The "light" theme is actually dark.** `:root` (the default, no-class state)
   ships dark-navy values: `--background: 15 23 42` (slate-900),
   `--foreground: 226 232 240` (near-white). So "light mode" = a dark theme, and
   `.dark` = an even darker theme (`--background: 8 12 28`). There is no true
   light theme. `ThemeContext` defaults to `'light'`, which renders dark. This
   inversion is the root reason anything authored with a light-mode mental model
   breaks.
2. **The scorecard is a hardcoded-hex light-theme island.** The entire
   `/scorecard/*` tree (and admin scorecard pages) ignores the token system and
   hardcodes three hex colors — `#2C4A5E` navy (291 uses), `#8B3A3A` brick red
   (67), `#F5DEB3`/`#FFE9B8` wheat (55) — assuming a white page. But these pages
   render inside the `(unprotected)` group on the **dark** token background, with
   **no `dark:` variants**, and the three hexes are frequently combined into
   pairings that collide (navy-on-navy, navy-on-brick, wheat-on-white). This
   subsystem is the overwhelming majority of unreadable text.
3. **Brand hue mismatch.** The logo gradient is purple/magenta
   (`#AE5388 → #3D1052`, `public/logo.svg`), the token `--primary` is sky-blue
   (`56 189 248`), and the scorecard brand is navy + brick-red + wheat. Three
   unrelated brand stories. The proposal unifies on a teal/cyan civic primary
   with a navy/brick scorecard accent that is contrast-safe.

---

## 2. Prioritized readability findings (grouped by root cause)

### Root cause A — navy-on-navy / navy-on-brick collisions (CRITICAL, invisible text)
The same dark hex used for both text and background, or two dark hexes paired.

| Ratio | Where | Classes |
|------:|-------|---------|
| **1.00:1** | `src/components/ui/../scorecard/LegislatorAvatar.tsx:49` | `bg-[#2C4A5E] ... text-[#2C4A5E]` — avatar initials are literally invisible |
| **1.23:1** | `scorecard/page.tsx:212,221` | `bg-[#8B3A3A] ... text-[#2C4A5E]` (active sort toggle) |
| 1.23:1 | `scorecard/bills/[id]/page.tsx:123,461`; `scorecard/[id]/page.tsx:556` | brick-red bg + navy text on pills/buttons |
| → ~1.0 on hover | `scorecard/page.tsx:130,139,356`; `scorecard/page.tsx:355` (FilterChip) | `bg-white ... text-[#2C4A5E] hover:bg-[#2C4A5E]/80` — navy text on near-navy hover bg |

### Root cause B — wheat text on white (CRITICAL)
Wheat is a near-white tint; only legible on dark surfaces, but used on white.

| Ratio | Where | Classes |
|------:|-------|---------|
| **1.19:1** | `scorecard/page.tsx:175` | `text-[#FFE9B8]` link inside a `bg-white` section |
| 1.31:1 | anywhere `#F5DEB3` is used as text on white | `text-[#F5DEB3]` |

(Note: the admin audit/queue pages use `text-[#F5DEB3]` on `bg-[#2C4A5E]/60`,
which *would* be readable on solid navy — but `/60` alpha over a white parent
washes the navy toward gray and erodes the ratio. Treat as fragile, fix with the
token migration.)

### Root cause C — dark-theme accent colors on light surfaces (HIGH)
`*-300` / `*-400` Tailwind shades chosen for dark panels, used on light cards.

| Ratio | Where | Classes |
|------:|-------|---------|
| **1.82:1** | `scorecard/[id]/page.tsx:786,835,965,1164` | `text-red-300` dollar figures on `bg-gray-50` — key numbers nearly invisible |
| ~2.3:1 | same file, other `text-red-300` on light | as above |

### Root cause D — mid-tone score-band colors below AA on white (HIGH, widespread)
The 0–100 score color ramp (`colorClassFor` in `scorecard/page.tsx:304` and the
two ramps in `scorecard/[id]/page.tsx:414,477`) uses `-600`/`-500` shades that
fail on white in the middle of the band — exactly where most legislators score.

| Ratio | Shade on white | Verdict |
|------:|----------------|---------|
| **2.94:1** | `text-yellow-600` (50–59% band) | fails AA body |
| **3.09:1** | `text-lime-600` (60–69% band) | fails AA body |
| 3.4–3.5:1 | `text-amber-600` (40–49%) | fails AA body |
| 4.5:1+ | `text-green-700`, `text-red-700`, `text-orange-600` | pass |

Because the natural score distribution clusters in the 30–70% band, the
*most-shown* scores are the *least* readable. This is the single most impactful
scorecard fix.

### Root cause E — `text-gray-*` and `text-black` with a light-mode assumption (MEDIUM)
Sprinkled in social components that render on the dark token bg.

| Where | Classes | Problem |
|-------|---------|---------|
| `src/components/CreatePostModalLauncher.tsx:39` | `text-gray-500 group-hover:text-black` | `text-black` on the dark `--background` → ~1.2:1 on hover |
| `src/components/CommentReplies.tsx:27,28` | `text-gray-500` | 3.69:1 on dark bg — borderline; muted-foreground token is the correct choice |
| `src/components/ui/CalendarCell.tsx:46` | `text-gray-400` disabled | acceptable but should be a token |

### What is NOT broken (don't "fix" it)
- `--muted-foreground` on the default bg: **6.96:1** — fine.
- `--secondary-foreground` on `--secondary`: **6.91:1** — fine.
- Token-driven buttons/inputs: fine.
The token system is healthy; the damage is concentrated in hardcoded scorecard
hex and a handful of stray grays.

---

## 3. Proposed color scheme — ONE coherent, accessible palette

### Design intent
Civic/activism, trustworthy, document-like. Keep the existing **navy** as the
serious "scorecard/ink" anchor and **brick red** as the call-to-action/danger
accent (these read as American-civic and are already brand-adjacent), but unify
the app primary on a **teal/cyan** that descends from the current sky-blue
`--primary` so the social app doesn't change identity. Provide a **true light
theme and a true dark theme**, both token-driven. Add a contrast-safe
**diverging score scale** so the scorecard ramp meets AA at every step.

> Note on the purple logo: it stays as the logo mark. The proposal does not adopt
> purple as an interactive color because a purple primary at AA on both themes is
> harder to tune; teal is the safer system color and already matches the app.

### Token set — LIGHT theme (the new default)
Values as `R G B` (globals.css format) with the hex and the key contrast check.

| Token | RGB | Hex | Role / check |
|-------|-----|-----|--------------|
| `--background` | `255 255 255` | `#ffffff` | page |
| `--surface` | `248 250 252` | `#f8fafc` | cards (slate-50) |
| `--surface-elevated` | `241 245 249` | `#f1f5f9` | raised panels (slate-100) |
| `--overlay` | `15 23 42 / .55` | navy 55% | modal scrim |
| `--foreground` | `30 41 59` | `#1e293b` | **14.6:1** on bg ✅ |
| `--muted-foreground` | `71 85 105` | `#475569` | **7.6:1** on bg, **6.9:1** on surface-elevated ✅ |
| `--subtle-foreground` | `100 116 139` | `#64748b` | **4.76:1** on bg — large/UI only ✅ (≥3:1) |
| `--border` | `226 232 240` | `#e2e8f0` | hairlines |
| `--input` | `255 255 255` | `#ffffff` | field bg (border supplies edge) |
| `--ring` | `8 145 178` | `#0891b2` | focus ring (3:1 vs white ✅) |
| `--primary` | `14 116 144` | `#0e7490` | teal-700; **5.36:1** on white ✅ |
| `--primary-foreground` | `255 255 255` | `#ffffff` | **5.36:1** on primary ✅ |
| `--secondary` | `241 245 249` | `#f1f5f9` | neutral button bg |
| `--secondary-foreground` | `30 41 59` | `#1e293b` | 13:1 ✅ |
| `--accent` | `159 50 50` | `#9f3232` | brick (replaces #8B3A3A, darkened for AA) |
| `--accent-foreground` | `255 255 255` | `#ffffff` | **7.06:1** on accent ✅ |
| `--success` | `21 128 61` | `#15803d` | green-700 |
| `--success-foreground` | `255 255 255` | `#ffffff` | **5.02:1** ✅ |
| `--warning` | `254 249 195` | `#fef9c3` | amber-100 bg |
| `--warning-foreground` | `133 77 14` | `#854d0e` | **6.38:1** on warning ✅ |
| `--destructive` | `185 28 28` | `#b91c1c` | red-700 |
| `--destructive-foreground` | `255 255 255` | `#ffffff` | **6.47:1** ✅ |
| `--info` | `14 116 144` | `#0e7490` | = primary |

### Token set — DARK theme
| Token | RGB | Hex | Role / check |
|-------|-----|-----|--------------|
| `--background` | `11 17 32` | `#0b1120` | page |
| `--surface` | `15 23 42` | `#0f172a` | cards (slate-900) |
| `--surface-elevated` | `30 41 59` | `#1e293b` | raised (slate-800) |
| `--overlay` | `0 0 0 / .6` | — | scrim |
| `--foreground` | `226 232 240` | `#e2e8f0` | **15.3:1** on bg ✅ |
| `--muted-foreground` | `148 163 184` | `#94a3b8` | **7.3:1** on bg, **5.7:1** on surface-elevated ✅ |
| `--subtle-foreground` | `100 116 139` | `#64748b` | large/UI only |
| `--border` | `30 42 70` | `#1e2a46` | hairlines |
| `--input` | `15 23 42` | `#0f172a` | field bg |
| `--ring` | `56 189 248` | `#38bdf8` | focus ring |
| `--primary` | `56 189 248` | `#38bdf8` | cyan-400; **8.8:1** on bg ✅ |
| `--primary-foreground` | `11 17 32` | `#0b1120` | **8.8:1** on primary ✅ |
| `--secondary` | `30 41 59` | `#1e293b` | — |
| `--secondary-foreground` | `226 232 240` | `#e2e8f0` | 12:1 ✅ |
| `--accent` | `248 113 113` | `#f87171` | red-400 (text-safe on dark) |
| `--accent-foreground` | `11 17 32` | `#0b1120` | 7:1+ ✅ |
| `--success` | `74 222 128` | `#4ade80` | green-400 |
| `--success-foreground` | `11 17 32` | `#0b1120` | 9:1+ ✅ |
| `--warning` | `250 204 21` | `#facc15` | — |
| `--warning-foreground` | `11 17 32` | `#0b1120` | 11:1+ ✅ |
| `--destructive` | `248 113 113` | `#f87171` | red-400 |
| `--destructive-foreground` | `11 17 32` | `#0b1120` | 7:1+ ✅ |
| `--info` | `56 189 248` | `#38bdf8` | = primary |

### Diverging score scale (−100%..+100%, or 0..100% bands)
A 7-step red↔neutral↔green ramp. **Light values are tuned so the colored text
clears AA 4.5:1 on white**; dark values are the lighter siblings for dark
surfaces. Use the dark-side colors only on dark surfaces.

| Band | Light (text on white) | Ratio | Dark (text on slate-900) |
|------|----------------------|------:|--------------------------|
| Worst (red) | `#b91c1c` | **6.47:1** | `#fca5a5` |
| Bad (orange) | `#c2410c` | **5.18:1** | `#fdba74` |
| Below avg (amber) | `#a16207` | **4.92:1** | `#fcd34d` |
| Neutral | `#475569` | **7.58:1** | `#94a3b8` |
| Above avg (lime) | `#4d7c0f` | **4.99:1** | `#bef264` |
| Good (green) | `#15803d` | **5.02:1** | `#86efac` |
| Best (deep green) | `#166534` | **7.13:1** | `#4ade80` |

Token names: `--score-1` … `--score-7` (or `--score-worst` … `--score-best`).
This directly replaces the `colorClassFor()` ramps; the `yellow-600`/`lime-600`/
`amber-600` mid-band failures become `#a16207`/`#4d7c0f` and pass.

### How it maps onto the project mechanism
1. In `globals.css`, replace the `:root` block with the **light** tokens above
   and the `.dark` block with the **dark** tokens (add `--surface`,
   `--surface-elevated`, `--overlay`, `--subtle-foreground`, `--info`,
   `--score-1..7`, `--ring` as a real color — note `--ring` is currently a stray
   `1rem` length value, which is a bug).
2. In `tailwind.config.js → theme.extend.colors`, add the new tokens following
   the existing `rgba(var(--token) / <alpha-value>)` pattern:
   `surface`, `surface-elevated`, `overlay`, `subtle-foreground`, `info`,
   `info-foreground`, `score-1`…`score-7`. (Keep the existing entries; they keep
   working with the new values.)
3. `darkMode: 'class'` stays. `ThemeContext` stays; its `'light'` default now
   actually means light.

---

## 4. Migration map (offending class → token)

Mechanical find/replace, scoped to the scorecard + stray grays. No logic changes.

| Current | Replace with | Notes |
|---------|-------------|-------|
| `bg-white` (scorecard pages/cards) | `bg-background` or `bg-surface` | now a real white in light theme |
| `bg-gray-50` (stat cards) | `bg-surface-elevated` | |
| `text-[#2C4A5E]` | `text-foreground` (headings) / `text-muted-foreground` (meta) | navy ink → semantic |
| `text-[#2C4A5E]/70`, `/90` | `text-muted-foreground` / `text-subtle-foreground` | drop alpha; alpha was the contrast killer |
| `bg-[#2C4A5E]`, `bg-[#2C4A5E]/60`,`/80` | `bg-secondary` / `bg-accent` (active) | never pair with navy text again |
| `text-[#8B3A3A]` | `text-accent` | |
| `bg-[#8B3A3A]` + `text-[#2C4A5E]` | `bg-accent text-accent-foreground` | white-on-brick 7:1 |
| `text-[#F5DEB3]`, `text-[#FFE9B8]` | `text-accent-foreground` on dark, else `text-foreground` | wheat text is never AA on light — remove |
| `bg-[#F5DEB3]` (logo chip, bars) | keep as decorative fill only (never as text bg) | |
| `LegislatorAvatar` `text-[#2C4A5E]` on `bg-[#2C4A5E]` | `bg-secondary text-secondary-foreground` | fixes 1.0:1 |
| `text-red-300` on light cards | `text-destructive` (light = `#b91c1c`) | fixes 1.8:1 |
| `colorClassFor` `text-yellow-600/lime-600/amber-600` | `text-score-4/5/3` (the AA-tuned ramp) | mid-band fix |
| `text-gray-500` (social) | `text-muted-foreground` | |
| `group-hover:text-black` (`CreatePostModalLauncher.tsx:39`) | `group-hover:text-foreground` | |
| `text-gray-400` disabled (`CalendarCell.tsx:46`) | `text-subtle-foreground` | |
| `Badge.tsx` `bg-red-500 text-white` | `bg-destructive text-destructive-foreground` | already AA; tokenize for theme parity |
| `--ring: 1rem` (globals.css:31) | `--ring: 8 145 178` (light) / `56 189 248` (dark) | it's currently a length, not a color — fix |

Suggested order: (1) globals.css + tailwind tokens, (2) `LegislatorAvatar` and
the `text-red-300` numbers (most visible bugs), (3) the score ramps, (4)
scorecard hex sweep, (5) stray grays.

---

## 5. Storybook decision

**Verdict: do NOT add Storybook. Add a single internal `/styleguide` route
instead.**

Rationale: Storybook is a heavyweight dependency (its own bundler, config, ~40+
transitive packages, a parallel build, and CI surface) and its main value —
isolated component development and a story matrix — is overkill here. The real
need is to *see the palette and core primitives in both themes side-by-side*
while migrating, and to prevent regressions. That is satisfied by a single
App-Router page (e.g. `src/app/(info)/styleguide/page.tsx`, or gated behind a
dev/admin check) that renders: every token swatch with its computed contrast
ratio vs its intended foreground, the score ramp, and the core primitives
(`Button` all modes/sizes, `TextInput`, `Badge`, `Select`, cards, a sample score
pill) — duplicated once in a `.dark` wrapper so both themes show at once. Zero
new dependencies, lives in the existing Next.js app, and doubles as the
acceptance check for this migration. Recommend Storybook only if the team later
wants per-component interaction testing or a published design-system site —
neither is a current need.

---

## Appendix — contrast cheat sheet (worst current offenders)
- navy-on-navy avatar: **1.00:1** (target ≥4.5)
- wheat `#FFE9B8` link on white: **1.19:1**
- navy text on brick `#8B3A3A`: **1.23:1**
- `red-300` figures on `gray-50`: **1.82:1**
- `yellow-600` score on white: **2.94:1**
- `lime-600` score on white: **3.09:1**

Every proposed pairing in §3 was verified ≥4.5:1 for body text (min 4.92) and
≥4.76:1 for the one large/UI-only `subtle-foreground` color.
