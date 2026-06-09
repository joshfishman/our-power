# Option-C Expansion — Researched Candidate List (119th Congress)

**Status: RESEARCH DOCUMENT — awaiting owner approval. No code or seed changes have been made.**

Date: 2026-06-09
Researcher: Claude (research session, `scorecard/voting` worktree)

## Scope and method

The Option-C rule (methodology, "Two-tier markers") credits Republican-authored alternative bills as
SECONDARY markers when (a) introduced as standalone bills with 3+ GOP cosponsors and (b) directionally
aligned with the plank. Today only 2 of 27 federal markers are Option-C (`team-act-gop-alt`,
`new-parents-act-gop-alt`), which caps how well a principled Republican can score. This document is the
vetted expansion list, one section per plank.

**Verification sources.** Cosponsor party splits marked *(verified: congress.gov API)* were pulled live on
2026-06-09 via `api.congress.gov` (DEMO_KEY). Items marked *(press/news)* are from sponsor press releases
or news coverage found via web search. Items marked **UNVERIFIED** could not be confirmed against
congress.gov directly — no cosponsor count below is fabricated; where I could not verify, I say so.
The local LegiScan bulk dataset and `LEGISCAN_API_KEY` were **not** available in this worktree, so no
`legiscanBillId` pins are provided — every recommended SeedBill must ship `isProvisional: true` (the
default) until `scripts/sync-marker-bills.ts` resolves and pins it.

**Public-support gate.** Every new marker slug MUST get an entry in
`src/lib/scorecard/public-support.ts` — `passesPublicSupportGate()` returns `false` for unknown slugs, so
a new marker without a gate entry silently never scores. Reused polling is noted per candidate.

---

## Plank 1 — Honest Government

| Bill | Sponsor | GOP cosponsors | What it does | Alignment | Public support | RECOMMEND |
|---|---|---|---|---|---|---|
| H.R.5106 Restore Trust in Congress Act | Fitzpatrick (R-PA) | **33 R** (+103 D) *(verified: congress.gov API)* | Comprehensive prohibition on stock trading/ownership by members, spouses, dependents; broader than blind-trust approaches | Full alignment, full magnitude — co-led with AOC/Roy/Burchett | Reuse `stock-trading-ban` 86% (PPC/UMD) | **YES — but as a bill-addition, not a new Option-C marker** (see note) |
| S.58 PELOSI Act | Hawley (R-MO) | 1 R (Moreno) *(verified: congress.gov API)* | Stock-trading ban; superseded by Hawley's own S.1498 HONEST Act (renamed markup vehicle, already a marker bill) | Aligned but redundant | n/a | **NO** — fails 3+ GOP; redundant with S.1498 |
| BLAST Act (lifetime lobbying ban) | Warren (D-MA), co-led by Rick Scott (R-FL) | **UNVERIFIED** (introduced ~May 2026; bill number not located) | Replaces cooling-off periods with a lifetime lobbying ban on former members | Aligned, but Democrat-authored — not Option-C eligible | Reuse `lobbying-cooling-off` 65% | **NO as Option-C** — watch as future bill-addition to `lobbying-cooling-off` once number/cosponsors verified |

**Plank 1 conclusion: no new Option-C marker.** The stock-trading lane already flows GOP credit — the
existing `stock-trading-ban` marker's lead bill (S.1498 HONEST Act) is Hawley-authored, and H.R.4890
ETHICS Act carries R cosponsors. The actionable improvement is adding **H.R.5106** as a fourth bill under
the existing `stock-trading-ban` marker, which extends credit to its 33 House R cosponsors (vs. the
handful on H.R.4890). No GOP-authored standalone exists for the public-financing or DISCLOSE lanes.

Sources: [congress.gov S.1498](https://www.congress.gov/bill/119th-congress/senate-bill/1498/text) ·
[Fitzpatrick press](https://fitzpatrick.house.gov/2025/9/news-fitzpatrick-leads-historic-bipartisan-effort-to-ban-congressional-stock-trading) ·
[Roll Call on HSGAC 8-7](https://rollcall.com/2025/07/30/senate-panel-advances-bill-banning-congressional-stock-trading/) ·
[Rick Scott BLAST press](https://www.rickscott.senate.gov/2026/5/sens-rick-scott-elizabeth-warren-introduce-bill-to-permanently-ban-members-of-congress-from-lobbying)

---

## Plank 2 — Our Children Our Future

| Bill | Sponsor | GOP cosponsors | What it does | Alignment | Public support | RECOMMEND |
|---|---|---|---|---|---|---|
| S.847 Child Care Availability and Affordability Act | **Britt (R-AL)** + Kaine (D-VA) | **9 R named** — Ernst, Capito, Collins, Curtis, Tillis, McCormick, Tuberville, Sullivan, Ricketts *(press/FFYF; exact congress.gov count UNVERIFIED)* | Makes CDCTC refundable + larger, raises DCAP cap to $7,500, expands 45F employer childcare credit | Strong — tax-credit mechanism vs. the D-coded direct-funding vehicles (American Family Act, CCWFA); classic Option-C "same direction, different mechanism" | Reuse `early-childhood` 74% (FFYF/POS) | **YES — strongest Plank 2 candidate** |
| H.R.1827 (House companion, Carbajal D + Lawler R + Davids D + Ciscomani R) | Carbajal (D-CA) | Lawler + Ciscomani co-leads; full count **UNVERIFIED** (number sourced from PoliScore; Problem Solvers Caucus endorsed) | Same as S.847 | Same | Same | YES as second bill under same marker (verify number first) |
| H.R.471 / S.1462 Fix Our Forests Act | Westerman (R-AR) + Peters (D-CA); Senate: Curtis (R-UT), Sheehy (R-MT), Hickenlooper (D), Padilla (D) | House **passed 279–141 (215 R yes, roll call exists)**; Senate Ag committee 18-5; ~40 House original cosponsors | Wildfire resilience: forest-management projects, fire-safe communities, streamlined environmental approvals | **MIXED** — BPC and 64 House Dems + Padilla support; Sierra Club opposes the NEPA-streamlining title. Not a sham bill, but the owner must make the stewardship-vs-streamlining judgment call | **NEEDS POLLING** — no entry maps; wildfire/forest-management polling research required before it can score | **QUALIFIED YES** — second-tier; gate-blocked until polled |
| S.98 Rural Broadband Protection Act (signed into law) | Capito (R-WV) | **1 R cosponsor** (Curtis) *(committee report; Klobuchar/Peters are the others)* | FCC vetting of high-cost-program broadband applicants | Aligned but tiny credit surface — passed by unanimous/voice processes (roll calls **UNVERIFIED**), so almost no one gets vote or cosponsor credit | Reuse `infrastructure-broadband` 83% | **NO** — fails 3+ GOP cosponsors |
| H.R.3667 Strengthening American Nuclear Energy Act | UNVERIFIED sponsor | **2 R** *(verified: congress.gov API)* | Nuclear expansion | Aligned | n/a | **NO** — fails 3+ GOP |
| S.2082 Nuclear REFUEL Act | UNVERIFIED (R) | 1 cosponsor total (Whitehouse, D) *(verified: congress.gov API)* | Spent-fuel reprocessing definition fix | Narrow | n/a | **NO** |

**Nuclear note:** no 119th GOP-authored nuclear/permitting standalone with 3+ GOP cosponsors surfaced in
this pass — the ADVANCE Act generation became law in the 118th and the 119th GOP nuclear bills found
(S.4267 codifying executive orders, S.1739/S.1801 international financing, H.R.3667, S.2082) are either
partisan-framed or thinly cosponsored. A deeper dedicated search could still find one.

Sources: [Britt press](https://www.britt.senate.gov/news/press-releases/u-s-senators-katie-britt-tim-kaine-representatives-mike-lawler-salud-carbajal-lead-bipartisan-bicameral-proposal-to-make-child-care-more-affordable/) ·
[FFYF explainer](https://www.ffyf.org/resources/2025/03/first-five-things-britt-kaine-child-care-plan/) ·
[FOFA Wikipedia (House 279–141)](https://en.wikipedia.org/wiki/Fix_Our_Forests_Act) ·
[Curtis press (Senate cmte 18-5)](https://www.curtis.senate.gov/press-releases/senate-advances-fix-our-forests-act-marking-key-progress-to-combat-wildfires/) ·
[Sierra Club critique](https://www.sierraclub.org/sierra/fix-our-forests-name-only) ·
[S.98 committee report](https://www.congress.gov/committee-report/119th-congress/senate-report/14)

---

## Plank 3 — Making a Living

| Bill | Sponsor | GOP cosponsors | What it does | Alignment | Public support | RECOMMEND |
|---|---|---|---|---|---|---|
| H.R.6644 21st Century ROAD to Housing Act | **French Hill (R-AR)**, chair, w/ Waters (D) | **15 R + 16 D cosponsors** *(verified: congress.gov API)*; House passed under suspension Feb 2026; **Senate passed with 89 votes, Mar 2026** (NBC/NPR) | 303-page supply package: construction grants/pilots, manufactured-housing reform, limits on Wall Street bulk-buying single-family homes | Strong — the GOP-authored counterpart to the D-coded LIHTC/supply bills already on `housing-supply` | Reuse `housing-supply` 83% (BPC/NHC/Morning Consult) | **YES — strongest candidate in this document** |
| S.2651 ROAD to Housing Act of 2025 | **Tim Scott (R-SC)** + Warren (D) | 0 cosponsors *(verified: congress.gov API — committee-product bill, reported from Banking 24-0)* | The Senate half that was merged into the 21st Century package | Same | Same | YES as second bill under the same marker — credit flows via roll calls, not cosponsorship |
| GOP non-compete bills | — | — | None found in the 119th; the Workforce Mobility Act (S.2031, already a marker bill) is itself bipartisan | — | — | **No new marker needed** for the non-compete lane |

**Note on roll calls:** which engrossed vehicle carried the 89-vote Senate passage (H.R.6644 as amended
vs. a Senate number) is **UNVERIFIED** — the sync run must confirm the roll calls LegiScan attaches before
flipping `isProvisional`. House passage was under suspension; whether it was a recorded vote is also
UNVERIFIED.

Sources: [Senate Banking release](https://www.banking.senate.gov/newsroom/minority/scott-warren-release-21st-century-road-to-housing-act-legislative-package-to-boost-housing-supply-and-bring-down-costs) ·
[NBC (Senate passage, 89 votes)](https://www.nbcnews.com/politics/congress/senate-passes-major-housing-affordability-bill-warren-scott-rcna263046) ·
[NPR](https://www.npr.org/2026/03/12/nx-s1-5742566/senate-bipartisan-housing-bill-investors-ban) ·
[Niskanen analysis](https://www.niskanencenter.org/bipartisan-road-to-housing/)

---

## Plank 4 — The Care We Owe

| Bill | Sponsor | GOP cosponsors | What it does | Alignment | Public support | RECOMMEND |
|---|---|---|---|---|---|---|
| H.R.2102 Major Richard Star Act | **Bilirakis (R-FL)** | **122 R** (+191 D; 326 total as of 2026-05-11) *(GovTrack via search)* | Ends the offset that docks a dollar of earned military retirement for every dollar of VA disability for ~50k combat-injured veterans | Strong — "veterans get the care they earned" is the plank's first promise | **NEEDS JUDGMENT ENTRY** — no public poll located; proxy evidence is the 326-cosponsor House supermajority + MOAA/veteran-group backing (same proxyPass pattern as `pact-act`) | **YES** |
| S.1032 Major Richard Star Act (Senate) | Blumenthal (D-CT) | 79 cosponsors incl. Crapo, Rick Scott, Boozman, Britt, Capito, Cornyn, Cotton *(press/GovTrack via search; exact R count UNVERIFIED)* | Same | Same | Same | YES as second bill under the same marker (gives senators a credit path) |
| S.1587 Fair Prescription Drug Prices for Americans Act | **Hawley (R-MO)** + Welch (D) | **1 cosponsor total** *(verified: congress.gov API)* | International reference pricing (most-favored-nation style) for drugs | Aligned | Would ride `major-care-vote` 85% | **NO** — fails 3+ GOP. Watch: if it picks up cosponsors it becomes the natural drug-pricing Option-C |
| S.4189 INSULIN Act of 2026 | Shaheen (D-NH) | 21 cosponsors, D-led *(verified: congress.gov API)* | $35/month insulin cap for private plans | Aligned but Democrat-authored — not Option-C eligible | n/a | **NO as Option-C** — candidate bill-addition to `major-care-vote` instead |
| S.529 Capping Prescription Costs Act | Warnock (D-GA) *(verified: congress.gov API)* | — | D-led cap bill | Not GOP-authored | n/a | **NO** |

**Definitional note for the owner:** the Star Act is not a "smaller-magnitude alternative" to a
Democratic vehicle — it is *the* bipartisan veterans vehicle, GOP-authored in the House. Two ways to seed
it: (a) Option-C marker as specified below (visible GOP-credit narrative, consistent
`isRepublicanAlternative` flag), or (b) plain bill-addition under the existing `pact-act` marker, whose
description ("or cosponsored major veterans benefit expansion") already fits. Either flows identical
credit; (a) is specified below because this document's charge is Option-C expansion — flag if you prefer (b).

Sources: [MOAA SITREP](https://www.moaa.org/content/publications-and-media/news-articles/2026-news-articles/benefits/moaa-sitrep-the-major-richard-star-act/) ·
[GovTrack H.R.2102](https://www.govtrack.us/congress/bills/119/hr2102) ·
[EANGUS reintroduction](https://eangus.org/major-richard-star-act-reintroduced-in-119th-congress/) ·
[Hawley S.1587 press](https://www.hawley.senate.gov/new-hawley-introduces-bill-protect-families-big-pharma-cap-insulin-prices/)

---

## Plank 5 — Peace and Strength

| Bill | Sponsor | GOP cosponsors | What it does | Alignment | Public support | RECOMMEND |
|---|---|---|---|---|---|---|
| H.R.7555 Audit the Pentagon Act of 2026 (existing marker bill) | Pocan (D-WI) **co-led by Biggs (R-AZ)** | **3 R of 21 cosponsors** *(press/GovTrack via search)* | Pentagon forfeits 0.5–1% of budget per failed audit | Already seeded | Already gated (83%) | **NO NEW MARKER NEEDED — GOP credit already flows** via Biggs + 3 R cosponsors |
| RECEIPTS Act (Ernst, R-IA) | Ernst (R-IA) | **UNVERIFIED** — bill number not located (introduced ~Feb 2026) | Clean Pentagon audit by 2028; AI-assisted auditing; DFAS transfer penalty | Aligned | Would reuse `pentagon-audit` 83% | **Watch** — once number/cosponsors verified, candidate **bill-addition** to `pentagon-audit` (fills the marker's missing Senate credit path) |
| H.Con.Res.38 Iran WPR (existing primary-marker bill) | **Massie (R-KY)** | **0 other R** (94 D cosponsors) *(verified: congress.gov API + press)* | War-powers removal directive | Already seeded | Already gated (70%) | No GOP-authored war-powers standalone with 3+ GOP cosponsors exists in the 119th |
| Senate WPR roll calls (Iran, June 2025; Venezuela, late 2025/2026 — Kaine-led, Paul co-sponsoring) | Kaine (D-VA) w/ Paul (R-KY) | D-led; GOP credit would flow via **VOTE_YES roll calls** (Paul, Murkowski et al.), numbers **UNVERIFIED** | Force removal resolutions that received recorded Senate votes | Aligned | Reuse `war-powers` 70% | **Bill-addition candidate** (not Option-C): adding the Senate WPR roll calls to the `war-powers` marker is the only realistic way GOP senators earn Plank 5 primary credit |

**Plank 5 conclusion: nothing viable for a new Option-C marker.** The Pentagon-audit lane already credits
the GOP side (Biggs co-lead), and no GOP-authored war-powers/antitrust standalone with 3+ GOP cosponsors
exists. The real gaps are *bill coverage* gaps (Senate audit vehicle; Senate WPR roll calls), not marker
gaps.

Sources: [Pocan-Biggs press](https://pocan.house.gov/media-center/press-releases/pocan-biggs-introduce-audit-pentagon-act) ·
[Military.com on Ernst RECEIPTS](https://www.military.com/daily-news/2026/02/11/exclusive-gop-senator-introduces-legislation-audit-pentagon-heres-why.html) ·
[Massie press](https://massie.house.gov/news/documentsingle.aspx?DocumentID=395731) ·
[The Hill (Khanna-Massie)](https://thehill.com/homenews/house/5745037-khanna-massie-war-powers-iran/)

---

## Recommended seed list

Three new Option-C markers (Planks 2, 3, 4), zero for Planks 1 and 5. All SeedBill entries omit
`isProvisional` (defaults `true`) and `legiscanBillId` (must be pinned by the sync, which refuses
provisional bills — run `npm run scorecard:sync -- --dry-run` first). Every new slug also needs a
`PUBLIC_SUPPORT` entry (drafted below) or it will never score.

### 1. Plank 2 — `childcare-tax-credit-gop-alt`

```ts
{
  slug: 'childcare-tax-credit-gop-alt',
  name: 'Republican-led childcare affordability alternative',
  markerType: 'SECONDARY',
  description:
    'Cosponsored the Republican-led Child Care Availability and Affordability Act, a tax-credit-based alternative to direct-funding childcare proposals.',
  methodologyNotes:
    'Option C two-tier marker (expansion batch 2026-06). Britt (R-AL)/Kaine (D-VA) S.847 modernizes the CDCTC (refundable, larger), DCAP, and the 45F employer credit — same direction as the American Family Act / Child Care for Working Families Act vehicles, different (tax-credit) mechanism. 9 GOP Senate cosponsors verified via sponsor press + FFYF as of 2026-06-09.',
  displayOrder: 7,
  isRepublicanAlternative: true,
  parallelMarkerSlug: 'early-childhood',
  bills: [
    {
      congressNumber: 119,
      billType: 'SENATE_BILL',
      billNumber: 'S.847',
      billTitle: 'Child Care Availability and Affordability Act',
      actionType: 'COSPONSOR',
      notes:
        'Britt (R-AL) + Kaine (D-VA). GOP cosponsors incl. Ernst, Capito, Collins, Curtis, Tillis, McCormick, Tuberville, Sullivan, Ricketts (press/FFYF, 2026-06-09).',
    },
    {
      congressNumber: 119,
      billType: 'HOUSE_BILL',
      billNumber: 'H.R.1827', // UNVERIFIED — confirm via sync before seeding
      billTitle: 'Child Care Availability and Affordability Act',
      actionType: 'COSPONSOR',
      notes:
        'House companion, Carbajal (D) + Lawler (R) + Davids (D) + Ciscomani (R). Bill number sourced from PoliScore — VERIFY against congress.gov/LegiScan before seeding.',
    },
  ],
}
```

`public-support.ts` addition (reuses existing polling — position matches `early-childhood`):

```ts
'childcare-tax-credit-gop-alt': { pct: 74, byParty: { D: 86, R: 61, I: 74 }, source: 'rides FFYF/POS childcare number', asOf: '2023-07', confidence: 'MEDIUM', note: 'No poll names the Britt bill; maps to the childcare-assistance question used for early-childhood.' },
```

### 2. Plank 3 — `road-to-housing-gop-alt`

```ts
{
  slug: 'road-to-housing-gop-alt',
  name: 'Republican-led housing supply alternative',
  markerType: 'SECONDARY',
  description:
    'Cosponsored or voted for the Republican-led ROAD to Housing package, a supply-side alternative to tax-credit-based housing vehicles.',
  methodologyNotes:
    'Option C two-tier marker (expansion batch 2026-06). Hill (R-AR) H.R.6644 / Scott (R-SC) S.2651 — construction grants and pilots, manufactured-housing reform, limits on institutional bulk purchases of single-family homes. Passed the Senate with 89 votes (2026-03); House passed under suspension (2026-02). Roll-call vehicle attribution UNVERIFIED until sync — confirm which engrossed number carried final passage.',
  displayOrder: 7,
  isRepublicanAlternative: true,
  parallelMarkerSlug: 'housing-supply',
  bills: [
    {
      congressNumber: 119,
      billType: 'HOUSE_BILL',
      billNumber: 'H.R.6644',
      billTitle: '21st Century ROAD to Housing Act',
      actionType: 'COSPONSOR',
      notes:
        'Hill (R-AR), 15 R + 16 D cosponsors (congress.gov API, 2026-06-09). Senate passage 89 votes 2026-03 — add VOTE_YES roll call at sync if LegiScan attaches it to this number.',
    },
    {
      congressNumber: 119,
      billType: 'SENATE_BILL',
      billNumber: 'S.2651',
      billTitle: 'ROAD to Housing Act of 2025',
      actionType: 'COSPONSOR',
      notes:
        'Tim Scott (R-SC) + Warren (D). 0 cosponsors (committee product, reported 24-0) — credit flows via roll calls, not cosponsorship.',
    },
  ],
}
```

`public-support.ts` addition:

```ts
'road-to-housing-gop-alt': { pct: 83, source: 'rides BPC/NHC/Morning Consult housing-supply number', asOf: '2024', confidence: 'MEDIUM', note: 'No poll names the ROAD package; maps to the build-more-housing question used for housing-supply.' },
```

### 3. Plank 4 — `star-act-gop-alt`

```ts
{
  slug: 'star-act-gop-alt',
  name: 'Republican-led veterans concurrent-receipt bill (Major Richard Star Act)',
  markerType: 'SECONDARY',
  description:
    'Cosponsored the Major Richard Star Act, ending the offset that reduces earned military retirement pay dollar-for-dollar against VA disability for combat-injured veterans.',
  methodologyNotes:
    'Option C two-tier marker (expansion batch 2026-06). Bilirakis (R-FL) H.R.2102 with 122 GOP House cosponsors (of 326, as of 2026-05-11); Senate S.1032 (Blumenthal lead) carries Crapo/Scott/Boozman/Britt/Capito/Cornyn/Cotton among 79. Alternative framing: this could instead be seeded as plain bill-additions under the existing pact-act marker — owner choice; credit flow is identical.',
  displayOrder: 7,
  isRepublicanAlternative: true,
  parallelMarkerSlug: 'pact-act',
  bills: [
    {
      congressNumber: 119,
      billType: 'HOUSE_BILL',
      billNumber: 'H.R.2102',
      billTitle: 'Major Richard Star Act',
      actionType: 'COSPONSOR',
      notes: 'Bilirakis (R-FL). 326 cosponsors (191 D / 122 R) as of 2026-05-11 (GovTrack).',
    },
    {
      congressNumber: 119,
      billType: 'SENATE_BILL',
      billNumber: 'S.1032',
      billTitle: 'Major Richard Star Act',
      actionType: 'COSPONSOR',
      notes: 'Blumenthal (D-CT), 79 cosponsors, heavy bipartisan (exact R count UNVERIFIED).',
    },
  ],
}
```

`public-support.ts` addition (judgment-pass — needs owner sign-off, same pattern as `pact-act`):

```ts
'star-act-gop-alt': { pct: null, proxyPass: true, source: '326-cosponsor House supermajority; MOAA + veteran-group backing', asOf: '2026-05', confidence: 'LOW', note: 'No public-opinion poll located for concurrent receipt. Pass on documented judgment, mirroring the pact-act precedent. OWNER APPROVAL REQUIRED — this expands the judgment-pass list from 2 to 3.' },
```

### Second-tier (owner judgment / blocked items)

- **Plank 2 — Fix Our Forests Act (H.R.471 Westerman / S.1462 Curtis).** Real bipartisan wildfire bill
  with a House roll call (279–141) that would credit 215 Republicans, but (a) the conservation movement
  is split on its NEPA-streamlining title, and (b) **no public-support polling entry exists** — it is
  gate-blocked until wildfire/forest-management polling is researched. Decide alignment + commission the
  polling lookup before seeding.

### Bill-additions (not Option-C, but surfaced by this research — separate change if approved)

1. **H.R.5106 Restore Trust in Congress Act → `stock-trading-ban`** (33 R cosponsors; verified).
2. **Ernst RECEIPTS Act → `pentagon-audit`** once bill number/cosponsors verified (fills the marker's
   missing Senate path).
3. **Senate Iran/Venezuela WPR roll calls → `war-powers`** (only realistic GOP-senator credit path on the
   Plank 5 primary; resolution numbers UNVERIFIED).
4. **S.4189 INSULIN Act → `major-care-vote`** (D-led but heavily bipartisan; optional).

### Implementation checklist (for the executing session)

1. Verify H.R.1827 and the ROAD-to-Housing final-passage vehicle on congress.gov before seeding.
2. Seed markers with `isProvisional` defaulted `true`; run `scripts/sync-marker-bills.ts --dry-run`, pin
   `legiscanBillId`s, then sync for real.
3. Add the three `PUBLIC_SUPPORT` entries (drafted above) in the same change — unknown slugs never score.
4. Update `docs/scorecard-methodology.md` (Two-tier markers section + version-table row) and
   `docs/scorecard/public-support-audit.md` / `marker-public-support.md` in the same change — the marker
   count moves from 27→30 federal and the judgment-pass list from 2→3 (methodology-version bump →
   recompute + preview spot-check per workflow rules).
