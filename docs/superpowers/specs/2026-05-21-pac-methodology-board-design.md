# v1.7.1 PAC Methodology Board + Scoreboards — Design

**Status:** Draft, in progress (2026-05-21)

## Problem

The v1.7 PAC Score was a single number with no transparency into where it came from. Now that we have an 8-class PAC taxonomy with ~$4B classified across 11,440 federal PACs, we need:

1. A **methodology board** — public-facing page explaining how the PAC Score is computed and what each PAC class means
2. **Per-PAC scoreboards** — dashboard pages for high-profile PACs (AIPAC, NRA, etc.) showing every legislator they've given to + amounts + trends
3. **Per-issue scoreboards** — aggregated views of ACTIVIST PACs by cause (gun-safety, climate, reproductive-rights, etc.)
4. **Legislator detail page additions** — show the dollar breakdown by class on each legislator's page, with drill-downs

## The Taxonomy (settled)

| Class              | Counts against?                  | Examples                                                        |
| ------------------ | -------------------------------- | --------------------------------------------------------------- |
| **CORPORATE**      | ⚠️ Yes                           | Boeing PAC, AT&T PAC, Realtors PAC, AMA PAC                     |
| **DARK_MONEY**     | ⚠️ Yes                           | Senate Conservatives Fund, FF PAC, House Majority PAC, MAGA Inc |
| **FOREIGN_POLICY** | ⚠️ Yes (+ own scoreboard)        | AIPAC, J Street, RJC, NORPAC                                    |
| **ACTIVIST**       | Doesn't count (+ own scoreboard) | Everytown, Sierra Club, LCV, BlackPAC                           |
| **LABOR**          | Doesn't count                    | SEIU, AFT, IBEW, UAW                                            |
| **LEADERSHIP**     | Doesn't count                    | Pelosi's PAC, Scalise's PAC, Hawley's PAC                       |
| **IDEOLOGICAL**    | Doesn't count                    | Justice Democrats, Stop MAGA, Vote Save America                 |
| **CONDUIT**        | Excluded                         | ActBlue, WinRed                                                 |

### Methodology rationale, in plain language

- **CORPORATE / DARK_MONEY / FOREIGN_POLICY** are the **influence-buying** classes — money flowing from corporations, billionaire networks, or foreign-policy lobbies to legislators in expectation of votes.
- **LABOR** = worker organizations. Not corrupting; pro-worker advocacy.
- **ACTIVIST** = single-issue cause advocacy (gun safety, climate, etc.). Legitimate citizen engagement, transparent funding.
- **LEADERSHIP** = politicians' personal PACs. Intra-political transfer.
- **IDEOLOGICAL** = broad partisan grassroots, small-dollar funded.
- **CONDUIT** = ActBlue/WinRed pass-throughs. Just plumbing.

## URL Structure

```
/scorecard/pac/                      — index of headline PACs (AIPAC, NRA, top 50)
/scorecard/pac/aipac                 — AIPAC detail page (lifetime giving)
/scorecard/pac/nra                   — NRA detail page
/scorecard/pac/c00797670             — generic by-FEC-ID URL fallback
/scorecard/issues/                   — issue index (gun-safety, climate, etc.)
/scorecard/issues/gun-safety         — aggregate of gun-safety ACTIVIST PACs
/scorecard/issues/climate            — aggregate of climate ACTIVIST PACs
/scorecard/methodology               — methodology board (already exists, expand it)
/scorecard/methodology/pac-classes   — drill into the 8-class taxonomy
/scorecard/[id]                      — legislator detail (existing) gets new "Money trail" section
```

## Page designs

### `/scorecard/pac/[id]` — per-PAC scoreboard

Header: PAC name + class badge + lifetime + 2024-cycle total
Body:

1. **Top recipients** table (all-time): legislator name, party, chamber, state, $ received, # transactions, link to legislator page
2. **Distribution by party / chamber** — pie chart-ish breakdown
3. **Trend** — bar chart of contributions by cycle (2018/2020/2022/2024)
4. **Funding sources** (if known) — note where the PAC's money comes from

### `/scorecard/issues/[slug]` — per-issue scoreboard

Header: issue name + total $ this cycle + PACs in this bucket
Body:

1. **PACs in this issue bucket** — list with $ totals
2. **Top recipients across all PACs in this issue**
3. **Issue framing** — short explainer ("Gun-safety advocacy includes Everytown, Giffords, Brady...")

### `/scorecard/methodology/pac-classes` — methodology page

For each of the 8 classes:

- Plain-language definition
- 3-5 example PACs (linked to their per-PAC pages)
- Rationale for counts-against vs doesn't-count
- Edge cases (e.g. why NRA is DARK_MONEY but Everytown is ACTIVIST)

Plus:

- Link to the full classification CSV in the repo (so anyone can audit)
- "How to challenge a classification" — instructions

### Legislator detail page — new "Money trail" section

Under the existing hero:

- **Total PAC dollars (counts-against)** — big number, with breakdown by class
- **Top donor PACs** — top 10 by $ with class badges
- **PAC Score** — `(1 − counts_against / total_influence) × 100`
- **Drill-downs**: "From AIPAC: $X", "From NRA: $Y", "From corporate industries: $Z"
- Link to the methodology page

## Data sources

All already loaded:

- `BillCosponsor` (existing) — for marker scoring
- `PacMoneyData` (existing) — needs to be re-ingested under the new methodology
- New: `PacClassification` table or just the CSV in repo (committee_id → class)
- New: `PacContribution` table — every (donor_pac, recipient_legislator, amount, cycle) from itpas2.txt

## Build order

1. Schema: `PacClassification` table from CSV + `PacContribution` table per cycle
2. Ingest script: `ingest-fec-classified.ts` — parse itpas2.txt for all 4 cycles, classify donor, sum per (leg, donor-class, kind)
3. Migration: drop old PacMoneyData v1.7 numbers, recompute under v1.7.1
4. UI: per-PAC scoreboard page (server component, simple table)
5. UI: per-issue scoreboard page (server component, aggregated)
6. UI: methodology board expansion (markdown + tables)
7. UI: legislator detail "Money trail" section

## Open questions

- Do we ship the methodology board public BEFORE the underlying scores update? Risk: users see methodology that doesn't match current scores.
- Multi-cycle aggregate vs single-cycle? Spike suggested multi-cycle is the right move; commit to 4-cycle aggregate (2018+2020+2022+2024) in the headline.
- IE OPPOSE money — show on legislator pages as "this PAC tried to defeat you" or hide entirely?
