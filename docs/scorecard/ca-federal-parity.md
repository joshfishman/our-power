# CA ↔ Federal Parity Audit (Common Ground scorecard, v0.9)

**Question (owner directive):** "We've had a lot of updates on federal — make sure CA tracks."

This audits every v0.9 voting/PAC/gating change against the California
jurisdiction and records, for each, whether CA **TRACKS**, is **PARTIAL**,
**DOESN'T**, or is **N/A**, with the reason. The one fixable gap — the
public-support gate being wired federal-only — is closed in this same change
(Task 2 below).

All counts below were confirmed by read-only queries against the live DB on
2026-06-10.

---

## Verdict table

| # | v0.9 change | Verdict | Reason |
|---|---|---|---|
| 1 | Ratio voting model (same engine, jurisdiction BOTH) | **TRACKS** | `computePlankTallies` / `loadAlignmentUniverse` in `voting-alignment.ts` are jurisdiction-agnostic; `compute-scores.ts` runs `--jurisdiction=BOTH`. DB shows 5,280 CA `RepresentativeScore` rows across 120 CA legislators — CA legislators already receive v0.9 ratio scores. |
| 2 | Cosponsorship-only-helps + absence-drags-where-eligible | **TRACKS** | Same engine path. CA roll-call bills drag on a missed/NO vote (denominator) exactly like federal; CA marker cosponsorship only ever helps (un-cosponsored markers excluded from the denominator). No CA-specific branch — identical logic. |
| 3 | Non-voting delegates (federal territories) | **N/A** | `NON_VOTING_DELEGATE_STATES` (AS/GU/VI/MP/PR/DC) is a federal-House construct. California has no non-voting members; `isNonVotingDelegate` only fires for `chamber === 'REP'` federal seats. Nothing to mirror. |
| 4 | Full MONEY-bucket PAC (CA re-ingested via `CA_COUNTS_AGAINST_CLASSES`) | **TRACKS** | CA PAC money is ingested through the CCDC pipeline into `PacMoneyData` (`dataSource = CAL_ACCESS_CCDC`): 239 rows across 120 CA legislators, cycles 2024 + 2026. The counts-against class set (`calaccess-parser.ts` `CA_COUNTS_AGAINST_CLASSES`) is applied. The PAC score is its own headline number and never enters a plank voting tally — same as federal. |
| 5 | Per-cycle / drop-incomplete PAC | **PARTIAL (by design — data limit)** | Federal uses per-contributor `PacContribution` rows and drops incomplete cycles. CA has **0** `PacContribution` rows — CA only holds the precomputed single-cycle aggregate in `PacMoneyData.combinedCorporateRatio`. The just-landed commit (`f6dbfc1`) makes CA read the **latest complete cycle**, which is CA's analog of federal's per-cycle averaging. It is not federal-style multi-cycle averaging because the per-contributor rows that averaging needs simply do not exist for CA. Documented as a data limit, not a bug. |
| 6 | Counts money-against-opponents (`IE_OPPOSE_BENEFICIARY`) | **DOESN'T (data-limited)** | Confirmed: of 239 CA `PacMoneyData` rows, **0** have `corporateIeAgainstOpponentAmount > 0` — the CA ingest dry-run's vs-opp = $0 holds across every CA legislator. Cal-Access CCDC exports do not carry beneficiary-IE attribution, so CA has no against-opponents signal to count. Flagged as a data limitation; the schema field exists and will populate if a future CA IE source lands. |
| 7 | Vote-coverage expansion (federal Senate 11→74, House 144→153) | **TRACKS — no expansion warranted** | Confirmed distinct scorable bills by chamber: HOUSE 153, SENATE 74, **CA_ASSEMBLY 261, CA_SENATE 73**. CA coverage (334 distinct scorable bills) is already healthier than federal (227) and was not the thing that needed expanding. ~1,867 CA roll-call rows are not scored, but those are unmarked procedural / non-plank votes (expected — not every roll call maps to a plank), not a coverage gap. No CA expansion needed. |
| 8 | Public-support gate | **DOESN'T → FIXED in this change** | The gate in `loadMarkerSlots` was wired `m.plank.jurisdiction === 'FEDERAL' && !passesPublicSupportGate(...)`, so CA markers were never gated. Fixed: added CA `PUBLIC_SUPPORT` entries (each riding its parallel federal poll) and removed the `=== 'FEDERAL'` condition so CA is gated by the same 55% evidence. See Task 2. |
| 9 | Option-C markers (federal-only GOP alternatives) | **N/A (CA doesn't want its own today)** | The three Option-C markers (`team-act-gop-alt`, `childcare-tax-credit-gop-alt`, `road-to-housing-gop-alt`, plus `new-parents-act-gop-alt`/`star-act-gop-alt`) are tied to specific federal Republican-authored bills. CA planks carry no `isRepublicanAlternative` markers, and there is no CA GOP-alt bill set in the dataset. A CA Option-C track would be a future, separate decision — not part of "make CA track the recent federal updates." Left as N/A by design. |

---

## Task 2 — closing the public-support-gate gap for CA

**Problem.** The v0.9 public-support gate (only score a marker whose underlying
position clears a 55% public-support majority) was applied to FEDERAL markers
only. CA markers — which deliberately mirror the same federal platform
positions — were left **ungated**. That is the asymmetry the directive flags.

**Fix.**

1. Added a `PUBLIC_SUPPORT` entry for every CA marker slug in
   `src/lib/scorecard/public-support.ts`. Each CA entry **rides the support
   number of its federal parallel** (noted `rides federal <slug>` in the
   `source`/`note`), because there is no CA-specific polling yet. This keeps CA
   markers gated by the **same** evidence as their federal twins instead of
   ungated. CA-specific polling is a future refinement.

2. Removed the `m.plank.jurisdiction === 'FEDERAL'` condition from the gate in
   `loadMarkerSlots` (`src/lib/scorecard/voting-alignment.ts`) so CA markers are
   gated too.

### CA → federal parallel map

| CA marker slug | Plank | Rides federal slug | Gate basis |
|---|---|---|---|
| `corporate-pac-refusal-ca` | 1 | `corporate-pac-refusal` | proxyPass (also bill-less PAC signal) |
| `levine-act-strengthen` | 1 | `disclose-act` (85%) | anti-pay-to-play ≈ dark-money/influence |
| `lobbyist-gifts-ca` | 1 | `lobbying-cooling-off` (65%) | lobbying-restriction family |
| `dark-money-disclosure-ca` | 1 | `disclose-act` (85%) | direct analog |
| `cooling-off-ca` | 1 | `lobbying-cooling-off` (65%) | direct analog (bill-less today) |
| `public-school-investment-ca` | 2 | `early-childhood` (74%) | education-investment family |
| `climate-sb100-ca` | 2 | `clean-energy-investment` (86%) | clean-energy analog (bill-less today) |
| `wildfire-prevention-ca` | 2 | `environmental-protection` (70%) | environment/resilience analog |
| `higher-ed-funding-ca` | 2 | `early-childhood` (74%) | education-investment family |
| `broadband-ca` | 2 | `infrastructure-broadband` (83%) | direct analog |
| `housing-supply-ca` | 3 | `housing-supply` (83%) | direct analog |
| `tenant-protection-ca` | 3 | `housing-supply` (83%) | nearest popular parallel (housing security); LOW-confidence proxy |
| `wage-theft-ca` | 3 | `wage-theft-noncompete` (62%) | direct analog |
| `loan-rate-cap-ca` | 3 | `loan-rate-cap` (77%) | direct analog (bill-less today) |
| `paid-leave-sdi-ca` | 3 | `paid-family-leave` (82%) | direct analog |
| `medi-cal-expansion-ca` | 4 | `medicaid-protection` (76%) | Medi-Cal = CA Medicaid |
| `calrx-ca` | 4 | `major-care-vote` (85%) | drug-pricing/affordability analog |
| `veterans-ca` | 4 | `pact-act` | proxyPass (veterans-support; bill-less today) |
| `mental-health-ca` | 4 | `major-care-vote` (85%) | nearest healthcare-access parallel; LOW-confidence proxy |
| `childcare-ca` | 4 | `paid-leave-childcare` (76%) | direct analog |
| `calcare-single-payer` | 4 | *(none — no clear popular parallel)* | **proxyPass, NOT dropped** |

**The one position with no clear popular parallel — `calcare-single-payer`.**
There is no federal single-payer marker, and single-payer / Medicare-for-All
polling is framing-sensitive and hovers near rather than clearly above 55%. Per
the Task-2 instruction ("if any CA position has no clear popular parallel, leave
it `proxyPass: true` with a documented note rather than dropping it"), it is kept
as `proxyPass`. This is consistent with the marker's own copy, which already
flags single-payer as an opt-in vote-of-conscience signal (cosponsoring/voting
yes only HELPS; it never drags) and tags it for cross-partisan review.

### Verification (read-only)

- **All 21 CA marker slugs** have a `PUBLIC_SUPPORT` entry and **every one passes
  the 55% gate** (`missing entries: 0 | fail-gate: 0`).
- **CA marker-slot count is unchanged after gating: 16 before, 16 after.** The 16
  bill-backed CA markers all survive; the 5 bill-less CA markers
  (`corporate-pac-refusal-ca`, `climate-sb100-ca`, `loan-rate-cap-ca`,
  `cooling-off-ca`, `veterans-ca`) were already skipped by the `bills.length === 0`
  guard and remain skipped — gating drops **nothing**.
- `npx tsc --noEmit` reports no errors in `public-support.ts` or
  `voting-alignment.ts`. (Three pre-existing repo errors live in files owned by
  other agents — `scripts/ingest-fec-classifications.ts` and the methodology
  page's missing `react-markdown`/`remark-gfm` — and are unrelated to this
  change; they persist with these edits stashed.)

### Recompute required

These changes alter which CA markers are gated (and confirm none drop), so the
human must run the final recompute (`compute-scores.ts`) to refresh CA
`RepresentativeScore` rows. No DB writes were made by this task.
