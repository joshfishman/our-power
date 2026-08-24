# Design cleanup plan — adopt shadcn/ui defaults

Status: proposed · Author: audit of `dev` @ 3485143 · Date: 2026-08-24

## 1. Diagnosis (measured, not impressions)

The color **token system is not the problem**. PR #62 (v1.9) landed a real
light/dark semantic token layer in `src/app/globals.css`, WCAG-verified, with a
`/styleguide` page. Rendering `/scorecard` live shows 6 background colors and 13
text colors, all token-derived, in both themes. That layer is worth keeping.

The problem is everything built around it:

| #   | Finding                                        | Measurement                                                                                                                                          |
| --- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **No shared component layer on the scorecard** | 16 pages, 5,828 LOC, **0** import from `src/components/ui`                                                                                           |
| 2   | **No canonical page width**                    | 7 distinct `max-w-*` values across pages; 6 pages mix two widths internally                                                                          |
| 3   | **Three unrelated typefaces fighting**         | Poppins at root, 298× `font-mono`, 110× `font-serif`, 1× `font-sans`                                                                                 |
| 4   | **Brand hex survived the token migration**     | 55 hardcoded literals (`#F5DEB3` wheat, `#8B3A3A` brick, `#C8B98A` parchment, `#2C4A5E` navy) across 5 files — all pages added on `dev` _after_ v1.9 |
| 5   | **Theme-blind palette utilities**              | 35 files use raw `bg-slate-800` / `text-gray-500` style classes that ignore `.dark`                                                                  |
| 6   | **One unmaintainable page**                    | `scorecard/[id]/page.tsx` is 1,638 lines                                                                                                             |
| 7   | **Docs drifted**                               | `CLAUDE.md` still documents the pre-v1.9 `text-gray-900 → parchment` override, which no longer exists                                                |

Items 4 and 5 are the literal "crazy colors." Items 1–3 are why they keep
coming back: with no component floor, every new page re-invents its own.

## 2. The pick: shadcn/ui, stock defaults

**shadcn/ui, `new-york` style, `slate` base color, on the existing Tailwind v3.**

Why this and not something else:

- The token names already in `globals.css` — `background`, `foreground`, `card`,
  `popover`, `primary`, `secondary`, `muted`, `accent`, `destructive`, `border`,
  `input`, `ring` — **are shadcn's exact schema.** Adopting it replaces token
  _values_, not the architecture. This is the cheapest possible migration.
- Copy-in components, no runtime dependency, no theming engine to fight.
- Tailwind-native, so `prettier-plugin-tailwindcss` and the existing lint setup
  keep working unchanged.
- Ships precisely the primitives the scorecard is hand-rolling: Card, Table,
  Badge, Tabs, Separator, Accordion, Tooltip, Chart.

Rejected: Mantine / MUI / Chakra (runtime theming engine, fights Tailwind, full
rewrite). Radix Themes (displaces Tailwind's role). React Aria Components +
Tailwind (keeps the current stack but supplies no defaults to fall back on —
which is the entire point of this exercise).

**Known risk:** shadcn is Radix-based; this app uses React Aria for ~10
interactive primitives (Select, DatePicker, Calendar, Toast, Popover,
DropdownMenu, Switch). Do **not** rip those out in the same pass — restyle them
with the new tokens and revisit after the visible surface is fixed. Mixing a
primitive-library swap into a visual refactor is the single biggest way this
goes wrong.

## 3. Phases

Each phase = its own branch + PR + Vercel preview verification, per the repo's
stated workflow.

### Phase 0 — baseline & safety net (½ day)

- **Merge `dev` → `main` first.** 14 commits of scorecard work are unshipped;
  branch the redesign off a shipped baseline, not off pending work.
- Add Playwright visual snapshots for all 16 scorecard pages + the main app
  pages, light **and** dark. A 5,800-LOC visual refactor without snapshots is
  unverifiable — this is the gate for everything below.

### Phase 1 — install stock defaults (1 day)

- `npx shadcn@latest init` → `new-york`, base color `slate`, CSS variables on.
- **Overwrite the token values in `globals.css` with shadcn's stock slate
  palette.** Keep the app-specific tokens that carry real meaning
  (`--score-1..7`, `--surface`, `--surface-elevated`, `--subtle-foreground`) but
  re-derive them from the slate ramp so they stay in-family.
- Retire wheat / parchment / navy entirely. Brick-red survives only as
  `--accent` / `--destructive` if it survives at all.
- **One typeface for UI.** Keep Poppins (or move to Inter) as `--font-sans`.
  Reserve a single serif for editorial H1/H2 only. Remove `font-mono` from prose
  — keep it strictly for numeric data in tables.
- Update `/styleguide` and `docs/design/color-scheme.md` to the new palette;
  fix the stale `CLAUDE.md` theme section in the same PR.

### Phase 2 — the component floor (2–3 days)

- Add stock shadcn: Card, Table, Badge, Button, Tabs, Separator, Accordion,
  Tooltip, Alert, Skeleton, Chart.
- Add exactly four app wrappers on top, introducing **no new colors**:
  - `<PageShell>` — the one canonical width, plus eyebrow / title / lede slots
  - `<StatTile>` — the score and money figures
  - `<ScoreBadge>` — the _only_ consumer of `--score-1..7`
  - `<DataTable>` — the ranking/roll-call tables
- Add an ESLint rule banning arbitrary hex (`/\[#[0-9a-f]{3,8}\]/`) and raw
  palette utilities under `src/app/**`. Without enforcement this regresses.

### Phase 3 — migrate the scorecard (3–5 days)

Page order, by impact; 2–3 pages per PR, each diffed against Phase 0 snapshots
in both themes:
`/scorecard` → `/scorecard/[id]` (split the 1,638-line file while migrating) →
`/pac` + `/pac/[id]` → `/races` + `/race/[seat]` → `/issues` →
`/power` + `/power/[slug]` → `/articles/[slug]` → `/methodology`.

### Phase 4 — migrate the Our Power app (2–3 days)

feed, campaigns, profile, onboarding. These _do_ already use
`src/components/ui`, so this is mostly re-pointing ~30 primitives at stock
equivalents. React Aria components stay; they get restyled, not replaced.

### Phase 5 — accessibility & polish (1–2 days)

Contrast audit in both themes, focus rings, keyboard nav on the new tables,
`prefers-reduced-motion`. Replace the bespoke ratio table in
`color-scheme.md` with shadcn defaults plus measured deltas.

**Total ≈ 2–3 weeks focused. The site stops looking broken at the end of
Phase 2 — Phase 3 onward is consolidation.**
