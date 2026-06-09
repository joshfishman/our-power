# Senate Vote Expansion — Classification Plan (Issue #2: Senate under-coverage)

**Status: APPLIED (v0.9, 2026-06).** Senate scorable distinct bills moved **11 → 74**
via substantive cloture / motion-to-proceed / CRA-disapproval / war-powers / tariff /
foreign-military-sale votes. Final dispositions:

- **HIGH-confidence set: applied** as classified below (Plank 2 CRA environmental
  rollbacks, Plank 3 CFPB CRAs, Plank 5 war-powers discharges and tariff terminations).
- **Foreign-military-sale (FMS) disapprovals (SJRES 26/32/33/41/53/54/138): ADMITTED**
  at Plank 5, aligned = YES — the discharge motion is the substantive arms-sale check
  and squarely a congressional war-and-arms-authority question (owner decision).
- **SJRES 103 (VA reproductive-health-services CRA): EXCLUDED** — abortion-adjacent;
  out of register for this platform's non-culture-war scope (owner decision, locked).
- **The LOW-confidence remainder (~30 bills — appropriations/CR cloture series
  HR 1968 / HR 5371 / HR 7147 / HR 7148 / S 2882, messaging bills, name/direction
  traps, immigration and culture-war items): EXPLICITLY DROPPED, not pending.**
  They are excluded from scoring by decision, not awaiting review. Reopening any of
  them requires a fresh owner decision and a methodology-version bump.

The tables below are preserved as the classification record behind those decisions.

## Problem

U.S. Senators are currently scored on **11 distinct bills**; House members on 144. The Senate has
**107 distinct bills with recorded roll-call votes** — 96 are unused because the ingest/classifier
filtered out cloture and motion-to-proceed votes as "procedural." In the modern 60-vote-threshold
Senate, **cloture and motion-to-proceed are frequently THE decisive vote**. This plan re-admits the
substantive ones.

## Senate roll-call inventory (current)

| metric | value |
|---|---|
| total Senate roll-call votes | 244 |
| currently used (scorable + aligned + planked) votes | 54 |
| currently used distinct bills | **11** |
| unused votes | 190 |
| unused distinct bills | 97 |
| total distinct Senate bills with votes | 107 |

The 11 used bills: HR 1, HR 3944, HR 4, HR 4016, HR 6644, HR 6938, S 1383, S 2296, SJRES 13, SJRES 18, SJRES 28.

## Method / conventions used

Calibrated against the existing 11 used Senate bills and `src/lib/scorecard/plank-classifier.ts`:

- **KEEP:** cloture, cloture-on-motion-to-proceed, motion-to-proceed, On Passage, and joint-resolution
  votes **on a bill**. For war-powers/arms-sale joint resolutions, the "Motion to Discharge" is the only
  recorded floor vote (the resolution can't reach the floor otherwise), so it is the substantive vote and is KEPT.
- **EXCLUDE:** motion to adjourn/recess, quorum calls, points of order, motions to reconsider, decision-of-chair,
  motions to table, and en-bloc nominations resolutions (SRES "executive resolution authorizing en bloc
  consideration … of certain nominations") — these are confirmation-process machinery, not policy.
- **Aligned position by EFFECT, not name.** Most unused votes are **CRA disapproval resolutions** (chapter 8
  of title 5) that *repeal* an agency rule. Where the rule being killed is an environmental / energy-efficiency /
  consumer-finance protection, the platform-aligned vote is **NO** on the disapproval (matches the existing
  convention: SJRES 18 / SJRES 28 are used with aligned=NO).
- **Dedup:** the score counts a bill once regardless of how many roll calls it has, so per-bill counts below
  are distinct-bill counts; multiple `rollCallVoteId`s for one bill all get the same classification.

---

## HIGH confidence — ready to apply

### Plank 2 (Children/Future: environment, energy, climate) — CRA disapprovals, aligned = NO

Each of these is "congressional disapproval … of the rule submitted by [EPA / DOE / BLM / Interior / NPS / FWS]"
rolling back an environmental, clean-air, energy-efficiency, or public-lands protection. Killing the rule cuts a
platform priority, so **aligned = NO** on the disapproval. KEEP MTP + passage + cloture votes per bill.

| rollCallVoteId | bill | description | plank | aligned | conf | note |
|---|---|---|---|---|---|---|
| 1c642b6d-f815-4dd1-8388-f0a0fa3baaf7 / cbda341f-112e-4835-80f2-efd606fb0821 | HJRES 104 | MTP + passage — disapprove BLM Miles City RMP | 2 | NO | HIGH | oil/gas drilling on public land |
| 65edeefe-… / b95222e3-… | HJRES 105 | MTP + passage — disapprove BLM North Dakota RMP | 2 | NO | HIGH | |
| 91c93d47-… / aff99c69-… | HJRES 106 | MTP + passage — disapprove BLM Central Yukon RMP | 2 | NO | HIGH | |
| f7478e60-d749-4416-9993-f9dd6011cfe1 | HJRES 130 | passage — disapprove BLM Buffalo RMP | 2 | NO | HIGH | |
| 8afc1d24-3378-48a9-b628-73fd451257b7 | HJRES 131 | passage — disapprove BLM Coastal Plain (ANWR) oil & gas leasing | 2 | NO | HIGH | ANWR drilling |
| 1f83c4d9-… / fb1ba37e-… | HJRES 20 | MTP + passage — disapprove DOE gas water-heater efficiency std | 2 | NO | HIGH | |
| 6f5a7614-… / bb98306e-… | HJRES 24 | MTP + passage — disapprove DOE walk-in cooler/freezer efficiency std | 2 | NO | HIGH | |
| 1219f038-… / 09863f36-… | HJRES 42 | MTP + passage — disapprove DOE appliance-standards certification | 2 | NO | HIGH | |
| 2aa4e932-… / a2921d42-… | HJRES 75 | MTP + passage — disapprove DOE commercial-refrigeration efficiency std | 2 | NO | HIGH | |
| 5fade300-6f27-4890-8ad7-39faf5e0950c | HJRES 35 | passage — disapprove EPA methane waste-emissions charge | 2 | NO | HIGH | methane fee repeal |
| 7b81965c-… / ea8fb914-… | HJRES 60 | MTP + passage — disapprove NPS Glen Canyon motor-vehicle rule | 2 | NO | HIGH | |
| b2ca81f9-… / 27af8e07-… | HJRES 61 | MTP + passage — disapprove EPA rubber-tire HAP emission std | 2 | NO | HIGH | hazardous air pollutants |
| 9f7ec3ef-… / 9bb07271-… | HJRES 87 | MTP + passage — disapprove EPA CA Advanced Clean Trucks waiver | 2 | NO | HIGH | CA clean-vehicle waiver |
| fed817bf-… / bb1004be-… | HJRES 88 | MTP + passage — disapprove EPA CA Advanced Clean Cars II waiver | 2 | NO | HIGH | |
| d517c2a4-… / 3fec3328-… | HJRES 89 | MTP + passage — disapprove EPA CA Omnibus Low-NOx waiver | 2 | NO | HIGH | |
| 524a2449-… / 7f7b7e06-… | SJRES 11 | MTP + passage — disapprove BOEM marine-archaeology protection | 2 | NO | HIGH | |
| 58d97510-… / (incl. 121: b2…)… | SJRES 12 | MTP — disapprove EPA methane waste-emissions charge | 2 | NO | HIGH | dup of HJRES 35 subject |
| 45a85ba1-… / b754e3e0-… | SJRES 31 | MTP + passage — disapprove EPA Clean Air Act major-source reclassification | 2 | NO | HIGH | |
| 290e0abf-… / 449d58e8-… | SJRES 55 | MTP + passage — disapprove NHTSA hydrogen-vehicle safety std | 2 | NO | HIGH | KEEP MTP+passage only; drop the recess/table/POO rows |
| a2774459-8bcf-4f7c-bbb3-70e0061736c8 | SJRES 60 | MTP — disapprove EPA Indiana cross-state air-pollution rule | 2 | NO | HIGH | |
| bfcc321c-… | SJRES 69 | MTP — disapprove FWS Barred Owl management (wildlife) | 2 | NO | HIGH | species management |
| db2e7ea2-… | SJRES 71 | passage — terminate national energy "emergency" | 2 | YES | HIGH | YES = end the fossil-fuel emergency declaration |
| 16af17c1-… | SJRES 10 | passage — terminate national energy "emergency" | 2 | YES | HIGH | same as SJRES 71 |
| 459c638a-… | SJRES 76 | MTP — disapprove EPA oil/gas methane deadline-extension | 2 | NO | HIGH | |
| 27ded169-… | SJRES 86 | MTP — disapprove EPA South Dakota regional-haze plan | 2 | NO | HIGH | |
| 6a86039e-… | SJRES 139 | MTP — disapprove EPA Colorado regional-haze plan | 2 | NO | HIGH | |
| 02917b65-… | SJRES 89 | MTP — disapprove BLM Buffalo coal RMP | 2 | NO | HIGH | coal leasing |
| 3ed152e5-… | SJRES 91 | MTP — disapprove BLM Coastal Plain (ANWR) oil & gas leasing | 2 | NO | HIGH | ANWR (Senate companion to HJRES 131) |
| b7a3f325-… / fe27471a-… | SJRES 80 | MTP + passage — disapprove BLM NPR-Alaska activity plan | 2 | NO | HIGH | Arctic petroleum reserve |
| 1f83… see HJRES 20 | — | — | | | | |

> Note: SJRES 55 has 12 roll calls; only the MTP (290e0abf) and the Joint-Resolution passage (449d58e8)
> should be scored. The 10 recess/adjourn/table/point-of-order rows are procedural — EXCLUDE.

### Plank 5 (Peace & Strength: war powers) — war-powers discharge motions, aligned = YES

Each directs removal of U.S. armed forces from unauthorized hostilities (Iran / Venezuela / Cuba / generic).
The Motion to Discharge is the only recorded floor vote and is the substantive war-powers test. Platform plank 5
is explicitly war powers → **aligned = YES** (supporting the reassertion of congressional war authority).

| rollCallVoteId | bill | description | plank | aligned | conf | note |
|---|---|---|---|---|---|---|
| 868ead85-f028-4576-ad80-95650be22a61 | SJRES 104 | discharge — remove forces from Iran hostilities | 5 | YES | HIGH | |
| 6c0b8517-… | SJRES 114 | discharge — Iran war powers | 5 | YES | HIGH | |
| 1d5a776f-… | SJRES 116 | discharge — Iran war powers | 5 | YES | HIGH | |
| ca3747d3-… | SJRES 118 | discharge — Iran war powers | 5 | YES | HIGH | |
| d9a64385-… | SJRES 123 | discharge — Iran war powers | 5 | YES | HIGH | |
| 4572eaed-… | SJRES 163 | discharge — Iran war powers | 5 | YES | HIGH | |
| ff3a2a1f-… | SJRES 184 | discharge — Iran war powers | 5 | YES | HIGH | |
| 6d16a03c-… | SJRES 59 | discharge — Iran war powers | 5 | YES | HIGH | |
| 3c659166-… | SJRES 124 | point of order — Cuba war powers | 5 | YES | LOW→HIGH | point-of-order is the only vote; KEEP as war-powers signal, aligned=YES |
| d52965c0-… | SJRES 90 | discharge — Venezuela war powers | 5 | YES | HIGH | |
| b9d414eb-… / 2c6e4205-… | SJRES 98 | discharge (Agreed) + point of order — Venezuela war powers | 5 | YES | HIGH | KEEP discharge b9d414eb; POO 2c6e4205 optional |
| d93e4f5a-… | SJRES 83 | discharge — generic unauthorized-hostilities war powers | 5 | YES | HIGH | |

### Plank 5 (Peace & Strength: trade) — tariff / trade-emergency termination, aligned = YES

The platform's plank 5 covers trade-agreement labor protections and congressional check on trade. These
resolutions terminate emergency tariff declarations (a reassertion of congressional trade authority). **aligned = YES.**

| rollCallVoteId | bill | description | plank | aligned | conf | note |
|---|---|---|---|---|---|---|
| ea8ba07a-… | SJRES 37 | passage — terminate Canada-tariff emergency | 5 | YES | HIGH | |
| 4bb415c2-… | SJRES 77 | passage — terminate Canada-tariff emergency | 5 | YES | HIGH | |
| cb7ceaad-… | SJRES 88 | passage — terminate global-tariff emergency | 5 | YES | HIGH | |
| 207b958f-… | SJRES 49 | passage — terminate global-tariff emergency | 5 | YES | HIGH | (the Motion to Table 07a4b142 is procedural — EXCLUDE) |
| cbc7991a-… | SJRES 81 | passage — terminate Brazil-tariff emergency | 5 | YES | HIGH | |

### Plank 3 (Making a Living: consumer-finance protection) — CFPB CRA resolutions, aligned = NO

These disapprove CFPB consumer-protection rules (overdraft fees, medical-debt collection, servicemember
protections). Matches the existing convention (SJRES 18 / 28 used at plank 3, aligned=NO). Killing the
consumer protection cuts against the plank → **aligned = NO**.

| rollCallVoteId | bill | description | plank | aligned | conf | note |
|---|---|---|---|---|---|---|
| 5f660740-… | SJRES 130 | MTP — disapprove CFPB overdraft opt-in rule withdrawal | 3 | NO | HIGH | protects overdraft fee limits |
| c5294590-… | SJRES 132 | MTP — disapprove CFPB servicemember-protection rule withdrawal | 3 | NO | HIGH | |
| a418ba58-… | SJRES 141 | MTP — disapprove CFPB medical-debt collection rule withdrawal | 3 | NO | HIGH | |

---

## LOW confidence — reviewed and DROPPED (kept for the record)

> Disposition (v0.9): every bill in this table was **explicitly dropped, not left
> pending** — except the FMS arms-sale disapprovals (SJRES 26/32/33/41/53/54/138),
> which were admitted at Plank 5 aligned=YES, and SJRES 103, which was excluded as
> abortion-adjacent (owner decisions; see the status note at the top).

| rollCallVoteId | bill | description | proposed plank | aligned | conf | note / trap |
|---|---|---|---|---|---|---|
| 39fab46c-… | S 3385 | cloture — Lower Health Care Costs Act | 4 | YES? | LOW | Name suggests P4-aligned, but title/sponsor unverified — confirm sponsor party & content (could be a messaging bill). |
| fcea1ca8-… | S 3386 | cloture — Health Care Freedom for Patients Act of 2025 | 4 | NO? | LOW | **Name trap.** "Freedom" + Abortion/HHS subjects suggests ACA/repro rollback; likely aligned=NO. Verify content. |
| 16e4a39e-… | SJRES 84 | MTP — disapprove CMS ACA "Marketplace Integrity" rule | 4 | NO | LOW | CRA on an ACA rule; direction depends on whether the rule helped or hurt coverage. Review. |
| b3aad30d-… | SJRES 107 | MTP — disapprove IRS clean-electricity-credit termination rule | 2 | YES | LOW | Double-negative: disapproving a rule that *terminates* clean-energy credits = pro-clean-energy → aligned=YES. Confirm. |
| a0507ce3-… | SJRES 95 | MTP — disapprove IRS corporate-AMT/partnership rule | 1 or 3 | ? | LOW | Corporate tax; plank unclear (honest-govt vs making-a-living). Review. |
| 561009e7-… | SJRES 103 | MTP — disapprove VA reproductive-health-services rule | 4 | NO | LOW | Veterans + repro health; politically contentious; verify direction. |
| db…/853fa314 / 8f52a595 / 45e23ba1… | S 2882 | CR "Continuing Appropriations…Act 2026" cloture/passage | 4? | ? | LOW | Appropriations/CR — historically excluded as Economics. Could carry P4 riders. Review whether to score. |
| 027d13d8 / 8128c42a / 48c546f1 … | HR 5371 | FY26 CR cloture series (13 votes) | — | ? | LOW | Shutdown-fight CR. Many cloture votes; if scored, pick the decisive cloture. Direction depends on the CR's content. |
| 6a0273bc … (7 votes) | HR 7147 | FY26 consolidated-approps cloture series | — | ? | LOW | Same as HR 5371 — appropriations machinery; review. |
| 8ff885cb / fc04f28e | HR 7148 | consolidated-approps cloture + passage | — | ? | LOW | |
| 6beb96d3 / b6bf750e | HR 1968 | FY25 CR cloture + passage | — | ? | LOW | |
| d492d32d-… | S 2806 | cloture — Eliminate Shutdowns Act | 1 | ? | LOW | Govt-ops; possibly plank 1, but messaging bill. Review. |
| d5cb0108 / d0e14fd4 | S 3012 | cloture — Shutdown Fairness Act | 1 or 3 | ? | LOW | Pay during shutdown; plank unclear. |
| 22d366d7 / ed8e04f6 | HCONRES 14 | FY25 budget resolution MTP + adoption | 2/4 | NO? | LOW | Budget reconciliation vehicle for HR 1 (already scored aligned=NO P2/P4). Risk of double-count — review. |
| 2515ecd7 / c078ae10 / a3c75d57 / 110-111 | SCONRES 7/22/33 | budget-resolution MTP/adoption | 2/4 | NO? | LOW | Same reconciliation-vehicle concern as HCONRES 14. |
| 6d09d0d9 / d40a4c39 / 1e131588 | S 331 | fentanyl-scheduling cloture + passage | — | ? | LOW | Crime/Law — classifier maps Crime weakly; not clearly a CG plank. Likely EXCLUDE. |
| 8650ed62-… | HR 23 | cloture-MTP — ICC-sanctions bill | 5 | NO? | LOW | International Affairs; sanctioning the ICC cuts against rule-of-law/diplomacy. Contentious — review. |
| 0d820303 / 28dac48e / 2aaac1a9 / df39ec77 / 4a1dbeb6 / df9c4d04 / f3f3dc1d | SJRES 138/33/32/26/54/53/41 | arms-sale disapprovals (Israel / Qatar / UAE) | 5 | ? | LOW | **Politically loaded.** Discharge motions on foreign-military-sale disapprovals. Plank 5 (Peace) plausibly aligned=YES, but the project's "peace" plank scope on arms sales is a policy call — human must decide direction & whether to include. |
| bb68b353-… | SRES 195 | discharge — El Salvador human-rights report | 5 | ? | LOW | Foreign-affairs oversight; thin link to plank. Review. |
| 6b41433d / 6bd11d52 / 12e9b30a / 098b34f2 | HJRES 25 / SJRES 3 | disapprove IRS digital-asset broker-reporting rule | 1? | ? | LOW | **Name/direction trap.** Bipartisan (69-28). Repeals a crypto tax-reporting rule; could read as anti-transparency (P1 aligned=NO) OR a genuine overreach fix. Strongly bipartisan → review. |
| b826769d-… | SJRES 99 | MTP — disapprove USCIS work-authorization rule | — | ? | LOW | Immigration — classifier explicitly says CG planks don't cover immigration. Likely EXCLUDE. |
| df975581 / d9fef8c4 | HJRES 142 | disapprove DC tax-conformity act | 1? | ? | LOW | DC home-rule preemption; weak plank link. Likely EXCLUDE. |
| 935f61b8 / f801aa19 / bc4bf47e | HJRES 140 | disapprove BLM Boundary Waters MN land withdrawal | 2 | YES | LOW | **Direction trap.** This withdrawal *protects* land from mining; disapproving it = pro-mining. So aligned would be NO on disapproval — but note this is the inverse of the other BLM rows (those rules opened land). Review carefully. |
| df…/ S 1071 (3 votes) | S 1071 | disinter veteran's remains (single-case VA bill) | — | — | LOW | Private-relief-style bill; not plank policy. EXCLUDE. |
| 44b0d1cb / 200d643c / f0f8d80d / d371c191 / bf37148d / 63018c7e | S 1582 | GENIUS/stablecoin regulation cloture + passage | 1? | ? | LOW | Financial-sector regulation; plank unclear (consumer-finance P3 vs honest-govt P1). Bipartisan passage. Review. |
| 38ae6cd0 / 9202… | S 5 / others | immigration-detention bill (Laken Riley-style) | — | — | LOW | Immigration — EXCLUDE per classifier. |
| d457e31e / 868… | S 6 | Born-Alive Abortion Survivors cloture | — | — | LOW | Abortion messaging vote; not a CG plank. EXCLUDE. |
| d40… | S 9 | "Protection of Women in Sports" cloture | — | — | LOW | Culture-war messaging; not a CG plank. EXCLUDE. |
| 38ae6cd0-31f1-48d1-adee-b52377f1e5a3 | S 3627 | cloture — Pregnant Students' Rights Act | — | — | LOW | Abortion-adjacent messaging; EXCLUDE unless mapped to P4. |
| 04a04187 / f8c3e105 | SJRES 82 | disapprove HHS APA-text-adherence rule | 1 | ? | LOW | Administrative-procedure; weak plank link. Review. |
| be145701 / fbf0ff30 | SJRES 7 | disapprove FCC E-Rate homework-gap (broadband for students) | 2 | NO | LOW→MED | Repeals school-broadband subsidy → cuts education/Plank 2; aligned=NO. Reasonably confident but flagged for confirmation. |
| 290…/SJRES 55 procedural rows | SJRES 55 | recess/adjourn/table/POO/reconsider | — | — | EXCLUDE | procedural noise on an otherwise-kept bill |
| 612224a6 / 76872767 / 75c157da / 8636c68a / 48573e95 / d47c647e / ba94999b / 1ec34a15 / dd6735f4 / 4731e13c / 07e75a8e / 4078155a / d78719be / 1f062916 / 42d8b4f8 | SRES 377/412/520/532/690 | en-bloc nominations resolutions | — | — | EXCLUDE | confirmation-process machinery, not policy |
| 1f9ec084 | SRES 526 | cloture — withhold Senator pay during shutdown | 1 | YES? | LOW | Plausibly P1 (govt accountability); 97-0. Review. |

---

## Impact summary

### HIGH-confidence additions (ready to apply)

Distinct **new** bills by plank (none overlap the existing 11):

| plank | new distinct bills | examples |
|---|---|---|
| Plank 2 (environment/energy) | **~29** | HJRES 20/24/35/42/60/61/75/87/88/89/104/105/106/130/131; SJRES 10/11/12/31/55/60/69/71/76/80/86/89/91/139 |
| Plank 3 (consumer finance) | **3** | SJRES 130/132/141 |
| Plank 5 (war powers) | **~12** | SJRES 59/83/90/98/104/114/116/118/123/124/163/184 |
| Plank 5 (trade/tariff) | **5** | SJRES 37/49/77/81/88 |
| **HIGH total** | **~49 new distinct bills** | (~110 roll-call votes across them, dedup'd to bills) |

- **New Senate distinct-bill count after HIGH-confidence apply: 11 → ~60.**
- Plank 5 gains the most depth (war powers + trade ≈ 17 bills), directly fixing the filibuster-era blind spot.
- Plank 2 roughly **30×** its Senate coverage (the CRA environmental-rollback wave was almost entirely filtered out).
- Plank 1 gets **no** HIGH additions from the unused set (honest-government votes are scarce in this window;
  the few candidates — SRES 526, S 2806 — are LOW).
- Plank 4 gets **no** HIGH additions (all health/care candidates are name-trap or CR-rider risks → LOW).

### LOW-confidence / needs review

- **~30 distinct bills** flagged for human review (see table). Largest buckets:
  - Appropriations / continuing-resolution cloture series (HR 1968, HR 5371, HR 7147, HR 7148, S 2882) — historically
    excluded as "Economics"; decide policy on whether the decisive cloture should count.
  - Foreign-military-sale disapprovals (SJRES 26/32/33/41/53/54/138) — Plank 5 candidate but the project's "peace"
    plank scope on arms sales is a locked-brief judgment call.
  - Name/direction traps: S 3386 (Health Care **Freedom**), HJRES 25 / SJRES 3 (crypto broker-reporting),
    HJRES 140 (Boundary Waters — protective withdrawal, inverse direction), SJRES 84/107 (double-negative CRAs).
  - Messaging / out-of-scope: immigration (S 5, SJRES 99), abortion-sports culture-war (S 6, S 9, S 3627),
    private-relief (S 1071), en-bloc nominations (all SRES 377/412/520/532/690) — recommended **EXCLUDE**.

### Net

- Applying **HIGH** alone moves Senate distinct-bill coverage from **11 → ~60** (≈5.5×), with the biggest gains
  on Planks 2 and 5 — the planks most distorted by the cloture/MTP filter.
- Reviewing and selectively admitting the LOW bucket (especially the appropriations cloture and arms-sale
  resolutions) could push it further toward the 107-bill ceiling, but each needs a direction/scope decision.
