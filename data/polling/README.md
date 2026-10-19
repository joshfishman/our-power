# data/polling — issue-graph polling sweep (Phase 0)

The research pass for Phase 0 of [`docs/ideas/issue-graph.md`](../../docs/ideas/issue-graph.md).
It is curated, sourced data for seeding the issue graph. Nothing loads these files yet, and they do
not change any score. `Marker.popularSupport` and the scorecard were not touched in this pass.

**Swept:** 2026-10-18. **Support window:** fielded on or after 2024-10-01.
**Salience window:** fielded on or after 2025-10-01.

| File           | What it is                                                                                 | Size                    |
| -------------- | ------------------------------------------------------------------------------------------ | ----------------------- |
| `issues.csv`   | Issue taxonomy: the `issue_id` join key used by the other three files                      | 80 issues               |
| `salience.csv` | What Americans name as the country's problems; one row per (poll, response category)       | 373 rows, 48 issues     |
| `support.csv`  | Support for specific policy solutions; one row per poll result, several polls per solution | 853 rows, 443 solutions |
| `frontier.csv` | New or untested proposals with little or no national polling; one row per source           | 137 rows, 133 ideas     |

## Status: researched, machine-checked, human review still owed

The spec says a human checks each row before it lands in the graph. That review has **not**
happened yet. What was done instead:

- Each row was gathered by a research agent that opened the pollster's page or topline PDF and
  recorded the exact question wording, field dates, sample, and URL. Agents were told never to
  fill a value from memory, and to leave a field blank (with the reason in `notes`) rather than guess.
- Every file passed a validation script: required fields present, dates ISO and inside the
  window, percents in 0–100, known `issue_id`s and marker slugs, no duplicate ids across support
  and frontier.
- A fact-check re-opened the sources for a random sample of 100 rows (60 support, 20 salience,
  20 frontier). Results: 0 WRONG, 0 UNREACHABLE. Support 55 OK / 5 MINOR; salience 19 OK / 1 MINOR; frontier 13 OK / 7 MINOR. Every MINOR was a date, title, attribution or base issue with the number itself correct; all were fixed or annotated. Each range was checked twice by independent checkers, and the two runs agreed. Every number checked was right, but a 100-row sample of 1,363 rows cannot rule out errors elsewhere.
- A reviewer pass fixed marker mappings, normalised pollster names, and dropped rows that did not
  measure policy support (listed under "Dropped in review").

Treat every row as **provisional until a person signs it off**. Use `wording_exact`, `notes`, and
the caveats below to decide what to check first.

## Columns

### support.csv

| Column                                | Meaning                                                                                                                                                                                                                                                                                                            |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `solution_id`                         | Stable kebab-case id, shared by every poll of the same policy                                                                                                                                                                                                                                                      |
| `solution_title`                      | Plain civic verb phrase                                                                                                                                                                                                                                                                                            |
| `issue_id`                            | Join to `issues.csv`                                                                                                                                                                                                                                                                                               |
| `marker_slug`                         | Scorecard marker in `src/lib/scorecard/federal-planks.ts`, if one fits                                                                                                                                                                                                                                             |
| `marker_relation`                     | `EQUIVALENT` (this solution is the marker's policy), `RELATED` (same ground, different policy or framing), `INVERSE` (the opposite policy, e.g. "cut Medicaid" against `medicaid-protection`). Only `EQUIVALENT` rows are candidates to update `Marker.popularSupport`, and only through a methodology-doc change. |
| `direction`                           | Where the idea sits in current debate: `left`, `right`, or `cross` (bipartisan sponsorship). Describes the idea, not the pollster.                                                                                                                                                                                 |
| `pollster`, `sponsor`, `source_lean`  | Who fielded the poll, who paid (blank = self-sponsored), and the pollster's lean: `nonpartisan`, `left`, or `right`                                                                                                                                                                                                |
| `field_start`, `field_end`            | ISO dates. If only the month was published, the month's first or last day is used and `notes` says so.                                                                                                                                                                                                             |
| `sample_size`, `population`, `mode`   | As published. Split-sample items record the full N unless `notes` says otherwise.                                                                                                                                                                                                                                  |
| `question_text`, `wording_exact`      | The pollster's wording. `wording_exact=N` means a paraphrase from a release or chart (166 rows), so check these first.                                                                                                                                                                                             |
| `support_pct`, `oppose_pct`           | Toplines. **Support always means support for the solution as titled.** Where the question was worded the other way, the values are flipped and `notes` says so.                                                                                                                                                    |
| `party_dem`, `party_rep`, `party_ind` | Support within each party, only where the pollster published crosstabs                                                                                                                                                                                                                                             |
| `source_url`, `notes`                 | Most primary page reached, and everything a reviewer needs to know about the row                                                                                                                                                                                                                                   |

### issues.csv

`issue_id, issue_title, map_caption, domain, plank_slug`. `issue_title` is the research label
used to map pollster categories. `map_caption` is the plain problem statement shown over a
cluster of demands on the map. Every map dot is a demand (a `solution_title`, always written
verb-first), never an issue or topic. Issues with no demands don't appear on the map.

### featured.csv

`headline_id, headline, issue_id, backing_solution_ids, evidence_note`. Headline demands are curated,
plain-language demands shown prominently on the map (for example "End the war in Iran"). Each is
backed by one or more demands in `support.csv` or `frontier.csv` (semicolon-separated ids), and its
evidence note says what was actually polled. A headline's support is read from its backing demands,
never stated on its own. These are editorial picks; review them like any other platform position. Map labels are always headline demands, never problem statements; a cluster without a headline
is shown unlabeled.

### salience.csv

`issue_id, issue_title, pollster, series, field_start, field_end, sample_size, population,
question_text, wording_exact, response_category, value_pct, party_*, source_url, notes`.
`response_category` is the pollster's own label, for example Gallup "Immigration". Several pollster
categories can map to one `issue_id`, and some mappings are approximate (noted per row).

### frontier.csv

`solution_id, solution_title, issue_id, description, source_type (paper|bill|pilot|report|book|law),
source_title, source_org, source_lean (left|right|libertarian|center|academic|nonpartisan),
source_date, source_url, state_or_pilot, polling_status, polling_note`.

- An idea can have several rows, one per source (e.g. participatory budgeting in NYC and Chicago).
- `polling_status`:
  - `UNPOLLED`: no national poll found.
  - `THIN`: only a state, old, sponsored, or unrepresentative poll; `polling_note` describes it.
  - `POLLED`: the idea now has polling in `support.csv` under the same `solution_id`. Four rows,
    kept for their source.
- `UNPOLLED` means no poll turned up in a capped search, not that none exists.

## Evidence tier (computed, not stored)

Per the spec, a solution's tier is computed from its `support.csv` rows. Use the median
`support_pct`: **MAJORITY** if it is ≥ 55, **CONTESTED** if it is below 55. Frontier ideas are **UNPOLLED**.
On this sweep that gives 257 MAJORITY and 179 CONTESTED solutions.

139 solutions have a median of 55% or more among **both** Democrats and Republicans (counting
rows with published crosstabs only). That is the Common Ground thesis in data. Many of them come from
PPC, so read the PPC caveat below before quoting the count.

## Caveats a reviewer needs

1. **Program for Public Consultation (UMD) rows run high.** PPC uses a "policymaking simulation":
   respondents get a briefing and pro/con arguments, then choose. That is good for finding informed
   cross-partisan agreement, but it is not comparable to a cold topline. Items were asked of
   about four-fifths of the sample, and N records the full 2,509.
2. **Wording moves results.** Some solutions carry polls with very different numbers because the
   questions differ: defend Taiwan (30–60%), NATO withdrawal (17–37%), Greenland (9–53%), and
   independent redistricting (51% in a forced choice, 81% at PPC). Show the range and the
   question, never a single number.
3. **Grouped variants.** A few solutions merge closely related questions (e.g. several Ukraine
   settlement options, military vs economic aid cuts). Those rows say `[Grouped variant: …]` in
   `notes`, and a later pass may split them.
4. **Multiple-choice items** record the share choosing that option as support, with oppose blank.
5. **Sponsored polls** (an advocacy group or interested industry paid for the poll) carry the
   sponsor in `sponsor`. Examples: the American Diabetes Association on insulin, NACDS on PBMs,
   Unite America on open primaries. The lean labels on these are judgment calls.
6. **Harvard CAPS/Harris is labelled `right`.** The brief put it in the right-leaning group for
   balance, though it presents itself as nonpartisan. Change that in one place if the project
   disagrees.
7. **Some rows rest on news coverage or a chart.** The values were taken from a news story or by
   matching chart labels to items by order; `notes` flags each one. A handful have blank
   `support_pct` (oppose-only or net-favourability results). These are kept for context and
   excluded from tier medians.
8. **2026 context.** Many foreign-policy rows reflect events in the window: the U.S.–Israel–Iran
   war that began in March 2026, and the capture of Maduro in January 2026.
9. **Gallup monthly MIP rows** have no sample size (it is not in Gallup's trend table). Their field
   dates come from Gallup's satisfaction trend table for the same monthly surveys.

## Known gaps (good targets for the next sweep)

No qualifying national poll since 2024-10-01 was found for:

- **Economy and labor:** Hawley's $15 floor (`team-act-gop-alt`), a $17 minimum wage, non-compete
  bans, wage theft, stock buybacks, breaking up big tech, the PRO Act as a whole.
- **Guns and justice:** raising the gun purchase age to 21, concealed-carry reciprocity, ghost guns,
  qualified immunity, cashless bail.
- **Health:** drug importation, surprise billing, out-of-pocket caps other than insulin, home care
  for seniors.
- **Technology:** the Kids Online Safety Act, a federal data privacy law, Section 230.
- **Education:** student loan forgiveness, tuition-free community college.
- **Government:** DC statehood, no-budget-no-pay, banning members' spouses from trading.
- **Housing and environment:** standalone zoning or ADU support, lead pipe replacement.
- **Defense:** the Pentagon audit (`pentagon-audit`), mandatory national service.

Several have strong polls from just before the window (e.g. KFF August 2024 on insulin and
out-of-pocket caps; Issue One/Fairplay August 2024 on KOSA). The sweep also ran into a shared
web-search cap, so the first pass leaned on pollsters whose sites can be browsed directly (Pew,
Gallup, AP-NORC, KFF, YouGov, PPC, Harvard Harris, Echelon, Data for Progress, Navigator).
Ipsos, Marquette, NBC/WSJ and Fox salience series are thin or absent. Roper iPoll was not used.

Salience never surfaced several issues as named problems: gerrymandering, unions, childcare,
paid leave, drug prices, Medicare/Medicaid, mental health, long-term care, China, war powers,
Pentagon spending, rural decline, loneliness, disasters. That is a finding: they are issues
people support action on when asked, not ones they volunteer.

## Dropped in review

- Napolitan News "balance the federal budget": it rested on a search snippet with no field dates.
- Echelon "universal rent control": it measured vote-likelihood for a candidate, possibly among
  Democrats only, not policy support.
- Marker mappings removed: tariff authority was tagged `trade-protections`, but that marker is
  labor and environment standards in trade deals. Zero-interest student loans was tagged
  `loan-rate-cap`, but that marker is a 36% consumer-credit cap.

## Refreshing

Spec cadence: salience quarterly, support twice a year. Keep the same ids, append new poll rows
rather than overwriting, and re-run the window filter. Older rows become history, not the current
figure.
