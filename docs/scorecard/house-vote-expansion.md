# House Vote Expansion — Classification Plan (House under-coverage follow-up)

**Status:** Classification plan only. **No DB writes performed.** Apply via
`npx tsx scripts/apply-house-expansion.ts --apply` (defaults to `--dry-run`), then re-run
`npx tsx scripts/compute-scores.ts`. Companion to `docs/scorecard/senate-vote-expansion.md`
(Issue #2) — same method, same conventions.

## Problem

House members are currently scored on **144 distinct bills** (202 roll calls used) out of
**340 distinct bills** with recorded votes (537 House roll calls total). Unlike the Senate —
where the cloture/MTP filter silently dropped most substantive votes — the House classifier
already caught the bulk of substantive passage votes. The unused pile (335 roll calls) is
dominated by genuine floor mechanics (rule adoptions, Previous Question, MTRs) and off-plank
messaging bills. This pass re-admits the substantive plank-relevant votes that slipped through,
and flags the amendment-vote traps.

## House roll-call inventory (current)

| metric | value |
|---|---|
| total House roll-call votes | 537 |
| currently used (scorable + aligned + planked) votes | 202 |
| currently used distinct bills | **144** |
| unused votes | 335 |
| total distinct House bills with votes | 340 |

Unused-vote breakdown by question type: 69 "On Agreeing to the Resolution" (mostly HRES rule
adoptions), 59 "On Passage", 52 "On Ordering the Previous Question", 44 "On Agreeing to the
Amendment", 47 suspension votes ("Suspend the Rules and Pass/Agree"), 20 "On Motion to
Recommit", plus table/adjourn/refer/discharge/quorum/journal noise.

## Method / conventions used

Same conventions as the Senate doc, adapted to House procedure:

- **KEEP (substantive):** "On Passage", "On Motion to Suspend the Rules and Pass[, as Amended]"
  (suspension passage IS the passage vote), conference-report and concur-in-Senate-amendment
  votes, veto overrides ("Passage, Objections of the President To The Contrary Notwithstanding"),
  and CRA disapprovals — **when the underlying bill maps to a plank**.
- **War-powers caveat on "On Agreeing to the Resolution":** for **HCONRES war-powers
  resolutions** (§5(c) removal directives), "On Agreeing to the Resolution" is the substantive
  floor vote on the resolution itself — these are KEPT (the House analog of the Senate's
  war-powers discharge motions). The blanket exclusion of "On Agreeing to the Resolution"
  applies to **HRES rule adoptions** ("Providing for consideration of …"), which are pure
  party-line floor mechanics.
- **EXCLUDE (procedural / partisan mechanics):** HRES rule adoptions, "On Ordering the Previous
  Question" (all 52 are on HRES rules), motions to adjourn/table/refer/reconsider, quorum calls
  ("Call of the House", "Call by States"), Election of the Speaker, censure/impeachment-discipline
  machinery, and "On Motion to Recommit" unless the MTR has clear substantive plank content
  (none of the 20 unused MTRs do — all are minority-party procedural shots fired right before
  passage).
- **Aligned position by EFFECT, not name** (bill-name traps judged by actual effect).
- **Messaging / out-of-scope bills excluded:** immigration, abortion-adjacent and culture-war
  bills (owner precedent: SJRES 103 was excluded as abortion-adjacent), crime/law-enforcement,
  appropriations/CR/budget vehicles (Senate precedent: HR 1968/5371/7147/7148, HCONRES 14,
  SCONRES excluded), crypto/fin-dereg (Senate precedent: HJRES 25, S 1582 excluded).
- **Dedup:** the score counts a bill once regardless of how many roll calls it has; per-bill
  counts below are distinct-bill counts.

### ⚠️ The amendment-vote trap (House-specific)

"On Agreeing to the Amendment" roll calls attach to the **parent bill's** `(billType, billNumber)`.
The apply-script model keys by bill, so a bill's amendment votes and passage votes would share
**one** `alignedPosition` — but an amendment's aligned direction can be the **opposite** of the
bill's (e.g. a protective amendment to a platform-misaligned bill: voting YES on the amendment is
platform-aligned even though the bill's aligned position is NO). Any amendment roll call whose
direction is not independently verified to match the bill's passage direction is **EXCLUDED via
the script's per-bill `excludeVoteIds` mechanism** (or, for bills not in this plan, simply left
unused). Every such case is flagged below.

| parent bill | status | amendment roll calls | trap risk |
|---|---|---|---|
| HR 3838 (NDAA FY26) | already scored P5 / NO | **17** | HIGH — NDAA amendments cut both ways (war-powers, Pentagon-audit amendments would be aligned YES while the bill is aligned NO). **Must stay unused.** They currently are; do not bulk-admit. |
| HR 4776 (SPEED Act, NEPA rollback) | already scored P2 / NO | **3** (all Failed) | HIGH — failed minority amendments to a NEPA-rollback bill are almost certainly protective (aligned YES ≠ bill's NO). **Must stay unused.** |
| HR 2483 (SUPPORT Act reauth) | **in this plan**, P4 / YES | **1** (Failed, 213-210) | Direction unverified — **actively excluded** in `apply-house-expansion.ts` via `excludeVoteIds` (id `137e3315-d683-4644-8b80-ba8f5eeb3f5f`). |
| HR 7148 (Consolidated Approps 2026) | excluded (appropriations) | 2 | moot (bill excluded) — noted for completeness |
| HR 1048 (DETERRENT Act) | LOW | 4 (all Failed) | if ever admitted, exclude or separately classify |
| HR 3383 (capital formation) | LOW | 3 (all Failed) | same |
| HR 7567 (Farm bill 2026) | LOW | 10 (+1 MTR) | same — farm-bill amendments are a direction minefield |
| HR 2988 (anti-ESG ERISA) | LOW | 1 (Agreed to) (+1 MTR) | same |

**Total flagged: 41 amendment roll calls across 8 parent bills; 1 requires an active exclusion
in the apply script (HR 2483); 20 sit on already-scored bills (HR 3838, HR 4776) and must remain
unused.** (The remaining handful of unused amendment votes attach to HRES rules — excluded
wholesale with their parents.)

---

## HIGH confidence — ready to apply

### Plank 5 (Peace & Strength: war powers) — HCONRES §5(c) removal directives, aligned = YES

The House analog of the Senate's war-powers discharge motions. Each directs the President,
pursuant to §5(c) of the War Powers Resolution, to remove U.S. Armed Forces from unauthorized
hostilities (Venezuela strikes / related campaigns). "On Agreeing to the Resolution" is the
substantive vote on the resolution itself, not a rule adoption. All six failed by razor-thin
margins (ties or ±7) — maximally discriminating votes. **Aligned = YES.**

| bill | description | plank(s) | aligned | votes (roll calls) | tally |
|---|---|---|---|---|---|
| HCONRES 38 | war powers — remove U.S. forces from hostilities (R-sponsored; cross-party) | 5 | YES | 1 | Failed 212-219 |
| HCONRES 40 | war powers — remove U.S. forces from hostilities | 5 | YES | 1 | Failed 213-213 |
| HCONRES 61 | war powers — remove U.S. forces from hostilities | 5 | YES | 1 | Failed 210-215 |
| HCONRES 64 | war powers — remove U.S. forces from Venezuela hostilities | 5 | YES | 1 | Failed 210-212 |
| HCONRES 68 | war powers — remove U.S. forces from Venezuela | 5 | YES | 1 | Failed 215-215 |
| HCONRES 75 | war powers — remove U.S. forces from hostilities | 5 | YES | 1 | Failed 211-211 |

### Plank 4 (The Care We Owe) — substantive healthcare passage, aligned = YES

| bill | description | plank(s) | aligned | votes (roll calls) | tally |
|---|---|---|---|---|---|
| HR 2483 | SUPPORT for Patients and Communities Reauthorization Act of 2025 — bipartisan opioid/substance-use-disorder treatment reauthorization. **Passage only**; the attached amendment roll call is excluded (trap, see above). | 4 | YES | 1 (of 2; 1 excluded) | Passed 364-56 |

### Plank 2 (Children/Future: environment) — conservation suspension passage, aligned = YES

Minor but clean environmental bills (invasive-species response). Near-unanimous, so low
discrimination, but genuinely plank-relevant — same "it's the truth" standard the owner applied
to the Senate set.

| bill | description | plank(s) | aligned | votes (roll calls) | tally |
|---|---|---|---|---|---|
| HR 375 | Continued Rapid Ohia Death Response Act of 2025 (invasive-pathogen response) | 2 | YES | 1 | Passed 355-60 |
| HR 776 | Nutria Eradication and Control Reauthorization Act of 2025 | 2 | YES | 1 | Passed 357-54 |

---

## LOW confidence — needs human review

| bill | description | proposed plank | aligned | conf | note / trap |
|---|---|---|---|---|---|
| HJRES 117 | terminate the 2025-07-30 (Brazil-tariff) national emergency. Only recorded vote is "On Motion to Table the Motion to Discharge Committee" (Passed 198-198+chair). | 5 | NO (on the table) | LOW | **Double inversion:** tabling the discharge kills the tariff-termination resolution, so the platform-aligned vote is NO on the table. Senate convention excludes table motions, but (like SJRES 124's point-of-order) this is the ONLY floor vote. Owner call. |
| HR 131 | veto override (Failed) — Finish the Arkansas Valley Conduit Act (water infrastructure) | 2 | YES? | LOW | Veto override on a water-infrastructure bill; verify why it was vetoed before scoring. |
| HR 7567 | Farm, Food, and National Security Act of 2026 (farm bill) | 2/3? | ? | LOW | Major omnibus — SNAP/conservation direction needs review. 10 amendment votes + MTR attached (trap). |
| HR 2988 | Protecting Prudent Investment of Retirement Savings Act (anti-ESG ERISA mandate) | 2 | NO? | LOW | Restricts climate-aligned investing → plausibly P2 aligned NO, but pitched as fiduciary protection. Amendment (Agreed to) + MTR attached (trap). |
| HR 1048 | DETERRENT Act — foreign-gift disclosure for universities | 1? | YES? | LOW | Transparency framing but China-focused education bill; 4 amendment votes attached (trap). |
| HR 77 | Midnight Rules Relief Act — en-bloc CRA disapproval mechanics | 1/2? | NO? | LOW | Regulatory-process mechanics (admin-procedure family the Senate doc left LOW, cf. SJRES 82). |
| HR 4405 | Epstein Files Transparency Act | 1 | YES? | LOW | Government-transparency; plausibly P1 YES but 427-1 (near-zero discrimination, cf. SRES 526 97-0 left LOW). |
| HR 6019 | repeal Senate-office notification provisions (legal process on disclosure of Senate data) | 1? | ? | LOW | Congressional-records/separation-of-powers; thin plank link. |
| HR 7959 | IRS Whistleblower Program Improvement Act | 1? | YES? | LOW | Whistleblower-adjacent; near-unanimous suspension. |
| HR 3357 | Enhancing Multi-Class Share Disclosures Act (D) | 1? | YES? | LOW | Corporate-governance disclosure; weak plank link. |
| HR 884 | prohibit noncitizen voting in DC elections | 1? | NO? | LOW | HR 22 (SAVE Act) precedent is used at P1/NO, but this is also DC home-rule preemption (HJRES 142 family → excluded). Owner call. |
| HR 1834 | Breaking the Gridlock Act (D omnibus, passed via discharge petition) | ? | ? | LOW | Grab-bag content unverified; review what's actually in it. |
| HR 36 | MEGOBARI Act (sanctions on Georgian Dream officials) | 5? | ? | LOW | International-affairs; HR 23 (ICC sanctions) is used at P5/NO, but direction here (pro-democracy sanctions) differs. Review. |
| HR 2035 | American Cargo for American Ships Act (D, cargo preference for U.S.-flag vessels) | 5/3? | YES? | LOW | Trade/maritime-labor adjacent. |
| S 723 | Tribal Trust Land Homeownership Act (mortgage processing on trust land) | 3? | YES? | LOW | Housing-adjacent (P3 housing); minor. |
| HR 1011 | Emergency Conservation Program Improvement Act | 2? | YES? | LOW | Farmland disaster-conservation; marginal. |
| HR 973 | Setting Consumer Standards for Lithium-Ion Batteries Act (D) | 3? | YES? | LOW | Consumer product safety — P3's scope is economic (wages/finance/housing); product safety is a stretch. Review as a trio with HR 1442 / HR 1770. |
| HR 1442 | Youth Poisoning Protection Act (D) | 3? | YES? | LOW | Same consumer-safety trio. |
| HR 1770 | Consumer Safety Technology Act (D) | 3? | YES? | LOW | Same consumer-safety trio. |
| HR 3383 | Incentivizing New Ventures … Capital Formation Act | 3? | NO? | LOW | Investor-protection rollback?; 3 amendment votes attached (trap). |
| HRES 432 | Motion to Discharge (Passed, D) — forces consideration of HR 2550 (nullify collective-bargaining-exclusion EO; HR 2550 already scored P3/YES) | 3? | YES? | LOW | House discharge-petition votes are substantive tests (Senate MTD analog) but the vehicle is a rule. If admitted, keep the discharge vote; the follow-on rule adoption is mechanics. |
| HRES 780 | Motion to Discharge (Passed, D) — forces consideration of HR 1834 | ? | ? | LOW | Depends on HR 1834's classification. |
| HRES 965 | Motion to Discharge (Passed, D) — forces consideration of HR 1689 (already scored P5/YES) | 5? | YES? | LOW | Same discharge-vehicle question as HRES 432. |

**LOW bucket: 23 distinct bills.**

---

## EXCLUDED categories (with examples)

- **HRES rule adoptions** ("Providing for consideration of …"): ~60 "On Agreeing to the
  Resolution" votes + 3 "On Consideration of the Resolution" — pure party-line floor mechanics.
- **"On Ordering the Previous Question"**: all 52 (every one is on an HRES rule).
- **Motions to Recommit**: all 20 unused MTRs (procedural minority shots; none carry visible
  substantive plank content).
- **Adjourn / table / refer / reconsider / quorum / journal / Speaker election**: motions to
  adjourn (4), censure/discipline machinery (HRES 189, 537, 539, 713, 878, 888, 893, 939,
  HRES 1100), Call of the House / Call by States / Election of the Speaker.
- **Appropriations / CR / budget vehicles** (Senate precedent): HR 1968, HR 5371, HR 7147,
  HR 7148, HR 7744, HR 8029 (shutdown pay, cf. S 3012), HCONRES 14, SCONRES 33.
- **Immigration** (out of plank scope): HR 29 / S 5 (Laken Riley), HR 30, HR 275, HR 495,
  HR 875, HR 993, HR 1958, HR 2056, HR 2931, HR 2966, HR 3486, HR 4371, HR 4638, HRES 1128.
- **Abortion-adjacent / culture-war** (SJRES 103 owner precedent): HR 21 (Born-Alive), HR 28
  (Women & Girls in Sports), HR 498 (Do No Harm in Medicaid — Medicaid-coverage restriction but
  gender-medicine culture-war vehicle), HR 6945 (pregnancy-center funding).
- **Crime / law enforcement** (not a CG plank; S 331 precedent): HR 27 / S 331 (HALT Fentanyl),
  HR 35, HR 2096, HR 2189, HR 2240, HR 2243, HR 2255, HR 2853, HR 3492, HR 4922, HR 5107,
  HR 5125, HR 5140, HR 5143, HR 5214, HR 5625, HR 6260, HR 8365, HCONRES 30, HCONRES 96,
  HRES 1252.
- **Crypto / financial dereg** (Senate precedent — HJRES 25 / SJRES 3 / S 1582 excluded):
  HJRES 25, S 1582 (GENIUS), HR 3633 (CLARITY), HR 1919 (anti-CBDC), HR 3394, HR 3422, HR 3351.
- **DC home-rule preemption** (HJRES 142 family): HJRES 142, plus the DC crime bills above.
- **Messaging resolutions**: HCONRES 58 (socialism), HRES 352/481/488/516/519/719/1099/1156/
  1182/1251/1259/1128.
- **Minor admin / single-purpose suspension bills** (no plank content): HR 33, 152, 153, 192,
  227, 504, 517, 804, 818, 825, 856, 859, 997, 1156, 1491, 1526 (NORRA — judicial procedure),
  1608, 1642, 1804, 2965, 2987, 3095, 3424, 3425, 4058, 4305, 5348, 5763, 5764, 6329, 7613,
  S 284, S 2503.

---

## Impact summary

### HIGH-confidence additions (ready to apply)

Distinct **new** bills by plank (none overlap the existing 144):

| plank | new distinct bills | roll calls admitted | examples |
|---|---|---|---|
| Plank 2 (environment) | **2** | 2 | HR 375, HR 776 |
| Plank 4 (care/health) | **1** | 1 | HR 2483 (passage only; amendment excluded) |
| Plank 5 (war powers) | **6** | 6 | HCONRES 38/40/61/64/68/75 |
| **HIGH total** | **9 new distinct bills** | **9 roll calls** | |

- **New House distinct-bill count after HIGH-confidence apply: 144 → 153.**
- The headline gain is **Plank 5 war powers**: six razor-thin (tie or near-tie) §5(c) votes that
  are the House's most discriminating peace-plank tests — the exact class the Senate expansion
  re-admitted via discharge motions.
- The House's small HIGH yield (vs. the Senate's ~49) is expected: the House classifier already
  captured 144 substantive bills; the unused pile is overwhelmingly genuine procedure
  (rules + PQ + MTR = 141 of the 335 unused votes) and off-plank messaging.

### LOW-confidence / needs review

- **23 distinct bills** flagged (table above). Largest buckets: direction-trap vehicles
  (HJRES 117 table-of-discharge, HR 2988 anti-ESG, HR 3383), major omnibus needing content
  review (HR 7567 farm bill, HR 1834), discharge-petition vehicles (HRES 432/780/965), and
  weak-plank-link transparency bills (HR 4405, HR 7959, HR 6019, HR 3357).

### Amendment-trap exclusions

- **41 amendment roll calls flagged across 8 parent bills** (see trap table). One requires an
  active per-bill exclusion in the apply script (HR 2483); 20 sit on already-scored bills
  (HR 3838 NDAA ×17, HR 4776 SPEED ×3) and **must remain unused**; the rest attach to LOW or
  excluded bills.
