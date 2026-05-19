# Scorecard v1.6 — roll-call-alignment methodology

## Why

v1.5 ships a directionally-correct but **thin** signal. DW-NOMINATE calibration shows r = −0.488 vs the academic ideology standard — strong direction, weak magnitude. Audit: **92% of negatively-scored legislators have ≤ 2 voting signals total**. Their entire score is one war-powers vote (the only bill in the methodology with a real roll-call) plus the corporate-PAC ratio. Everything else is dead weight (4 markers at 5% coverage, 16 markers at 0% coverage).

The structural problem: we curated ~30 marker bills and hoped legislators would cosponsor or vote on them. They mostly don't. Cosponsorship is one-sided (D-cosponsors-D-bill, R-cosponsors-R-bill), and floor votes only happen on the 1-2 bills that actually move.

v1.6 inverts the problem: ingest **every** roll-call vote, classify each by plank, and score legislators on **alignment percentage** with the platform-preferred direction.

## The methodology shift

**v1.5:**

```
Plank score = Σ(weighted achievements) — signed integer, ~95% of legislators score on 1-2 markers
```

**v1.6:**

```
Plank score = (votes you cast aligned with platform direction)
            / (total plank-relevant votes you participated in)
            × 100
```

Same approach LCV (environment), ACU (conservative), AFL-CIO (labor) all use. Well-understood, hard to game, naturally robust to legislator-tenure differences.

## Decisions locked

1. **Classifier:** hybrid — LLM auto-classifies with confidence score; auto-accept above 0.9, queue for human review below. Manual review via an admin UI ("classification queue").
2. **Coverage:** both **federal AND California**. CA already has rich vote data from LegiScan; same pipeline against CA bills.
3. **Methodology version:** v1.6 strict — v1.5 score rows persist in DB for audit but are no longer published. Public surface only shows v1.6 numbers.

## Scoring rules

For each (legislator, plank):

- `voted_aligned = count(rollcall positions where position == aligned_position AND plank in vote.planks)`
- `voted_misaligned = count(positions where plank-relevant AND position != aligned_position)` — including absent / not voting / present (preserves v1.5's "all five non-yes count the same" stance from the methodology page)
- `plank_score = (voted_aligned / (voted_aligned + voted_misaligned)) × 100`

For legislators in office less than full cycle (e.g. mid-term replacements), only votes during their tenure count.

If a legislator has zero plank-relevant votes (impossible in practice for federal, can happen for new CA legislators): show "pending" — same fallback as v1.5.

**Total score across planks:** simple mean of per-plank percents. Range 0-100% (no negative scores under v1.6 — alignment is by definition non-negative). The current "-100% to +100%" anchored display becomes "0%-100% with a 50% midline marking the average legislator."

## Plank 1 keeps the corporate-PAC overlay

Plank 1 (Honest Government) has both a roll-call component AND the corporate-money component from v1.5. Roll-call alignment captures behavior on stock-trading bans, lobbying reform, voting rights. Corporate-money component captures campaign finance commitment.

```
Plank 1 score = 0.7 × (roll-call alignment on ethics votes)
              + 0.3 × (1 - combined_money_ratio)  // scaled 0-100
```

Weight ratio is debatable — 70/30 favors behavior over commitment, can revisit.

The MONEY vs PEOPLE classification from v1.5 stays — same DB tables, same ingest path.

## Data sources

**Federal:**

- `https://api.congress.gov/v3/house-vote/119/{session}` — vote list
- `https://api.congress.gov/v3/senate-vote/119/{session}` — same (if available)
- Clerk.gov XML for per-member tallies + vote question
- `https://api.congress.gov/v3/bill/119/{type}/{num}` — bill title, policy area, subjects
- `https://api.congress.gov/v3/bill/119/{type}/{num}/summaries` — bill summary

**California:**

- LegiScan CA session vote data (already in our DB partially via existing sync)
- May need expansion of bills tracked

## Classifier architecture

**Per-bill classification (LLM, called once per unique bill):**

Input: bill title, policy area, subjects, summary, sponsor party
Output:

```json
{
  "plank_numbers": [1, 2, 5],
  "aligned_position": "YES" | "NO" | null,
  "confidence": 0.95,
  "reasoning": "Bill is a clean-energy investment tax credit — Plank 2 (children/future) preferred direction is YES because we favor clean energy investment."
}
```

**Stage 1 — rule-based first pass:**

- Policy Area `Energy` → P2 likely (climate/clean energy)
- Policy Area `Armed Forces and National Security` → P5 likely (war powers, Pentagon audit) or P4 (veterans benefits)
- Policy Area `Government Operations and Politics` → P1 likely (ethics/disclosure)
- Policy Area `Labor and Employment` → P3 likely (worker protections)
- Policy Area `Social Welfare` → P4 likely (Medicare/Medicaid/Social Security)
- Etc.

**Stage 2 — LLM disambiguation:**

- Confidence < 0.9 from rule-based
- Ambiguous policy areas (`Commerce`, `Law`, `Economics and Public Finance`)
- Multi-plank candidates

**Direction inference:**

- Default: aligned_position derived from bill sponsor party + bill direction
  - D-sponsored progressive bills → aligned=YES
  - R-sponsored anti-progressive bills → aligned=NO (no on passage means platform-aligned)
- Exception cases identified by LLM (bipartisan bills, Republican-led alternatives that are still platform-aligned)

**Vote-type filter:**
Skip procedural votes — only score:

- "On Passage" / "On Final Passage"
- "On Motion to Suspend the Rules and Pass" (substantive)
- "On Concurring with Senate Amendments"
- "On Agreeing to the Conference Report"
- Possibly: "On Motion to Recommit" (sometimes substantive)

Skip: "On Ordering the Previous Question", "On Agreeing to the Resolution" (when resolution is procedural), motion to table, election of speaker, censures, etc.

## Schema additions

```prisma
model RollCallVote {
  id              String   @id @default(cuid())
  chamber         RollCallChamber
  congressNumber  Int
  sessionNumber   Int
  rollCallNumber  Int
  voteDate        DateTime
  voteQuestion    String
  voteResult      String
  voteType        String

  // Bill linkage
  billType        String?
  billNumber      String?
  billTitle       String?
  billPolicyArea  String?
  billSubjects    Json?

  // v1.6 classification
  plankNumbers    Int[]
  alignedPosition VotePosition?
  classificationConfidence Float?
  classificationSource String  @default("auto")  // auto | human | auto-then-human
  classificationReasoning String? @db.Text
  classifiedAt    DateTime?
  classifiedBy    String?
  reviewedAt      DateTime?
  reviewedBy      String?

  sourceUrl       String?

  positions       RollCallPosition[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([chamber, congressNumber, sessionNumber, rollCallNumber])
  @@index([plankNumbers])
  @@index([classifiedAt])
}

enum RollCallChamber {
  HOUSE
  SENATE
  CA_ASSEMBLY
  CA_SENATE
}

model RollCallPosition {
  id           String   @id @default(cuid())
  vote         RollCallVote @relation(fields: [voteId], references: [id], onDelete: Cascade)
  voteId       String
  legislator   Legislator @relation(fields: [legislatorId], references: [id], onDelete: Cascade)
  legislatorId String
  position     VotePosition

  createdAt DateTime @default(now())

  @@unique([voteId, legislatorId])
  @@index([legislatorId])
}
```

`MarkerBill`, `BillVote`, `BillSponsorship` stay in DB for historical methodology versions but stop driving v1.6 scoring.

## Admin review UI ("classification queue")

Minimal page at `/admin/scorecard/queue`. Lists votes where `classificationConfidence < 0.9` and `reviewedAt IS NULL`. For each row:

- Bill title, summary, policy area, subjects, sponsor party
- LLM's proposed `plank_numbers`, `aligned_position`, `reasoning`
- Approve / Edit / Reject buttons
- On approve: sets `reviewedAt`, `reviewedBy`, marks the vote ready for scoring

Auth: existing admin-role check.

Skipped for v1.6 launch if scope creeps — the LLM-only path can ship first with confidence threshold lowered to 0.8, and the admin UI lands in v1.6.1.

## UI changes

**`/scorecard/[id]` legislator detail:**

- Hero: replace ±% with 0-100% alignment (color graded green→red across the band)
- Per-plank section: "Plank N: 67% aligned (12 of 18 votes)"
- Click-through: list of plank-relevant votes the legislator participated in, with position vs aligned position highlighted
- "Pending" badge if zero plank-relevant votes (new legislator)

**`/scorecard` index:**

- Score column: % alignment, color-graded
- Sort default: highest alignment first
- Filter: by chamber + party + state stays the same

**`/scorecard/methodology`:**

- Full rewrite. Plank section becomes "How your representative is scored on Plank N." Methodology version table gets v1.6 row.

## Out of scope for v1.6

- **CA expansion beyond what LegiScan already has** — if there are CA bills not yet in our DB, defer to v1.6.1
- **Procedural vote scoring** — only substantive votes count
- **Cross-cycle methodology** — v1.6 covers 119th Congress only; 118th data ingested for historical reference but not scored

## Calibration target

After v1.6 ships and recompute runs:

- Pearson r with DW-NOMINATE dim1: expect **−0.80 to −0.92** (vs current −0.488)
- False-negative cohort (Vargas, Sánchez, Durbin) should shift from −50% range to mid-50%+ aligned
- False-positive cohort (Hawley, Blackburn) should drop from +35-50% to closer to their actual policy positions (~10-20%)

If the calibration jumps as expected, v1.6 is the right call. If correlation stays below −0.7, the LLM classifier is misclassifying — pause and audit.

## Rollback plan

v1.6 score rows go into the same `RepresentativeScore` table with `methodologyVersion = 'v1.6'`. v1.5 rows stay. If v1.6 misfires, the page's `CURRENT_METHODOLOGY = METHODOLOGY_VERSION` re-export keeps the public surface consistent — just revert the `METHODOLOGY_VERSION` constant and the page falls back to v1.5 immediately.

No data loss, no migrations required.

## Phased ship (recommended)

1. **Phase A: schema + ingest** — pull 119th Congress votes + bill metadata, no scoring yet. Verify data shape.
2. **Phase B: classifier** — run rule-based + LLM. Manually spot-check 30 high-confidence + 30 low-confidence classifications. Iterate prompt if needed.
3. **Phase C: scoring** — compute v1.6 scores. Run DW-NOMINATE calibration. Should be −0.80+. If not, debug.
4. **Phase D: UI** — rewrite pages. Methodology doc rewrite.
5. **Phase E: ship** — PR + Vercel preview + spot-check + merge.

Each phase is a separate PR. Earlier phases unblock parallel work on later phases.

## Estimated effort

| Phase                                   | Effort        | Blocking? |
| --------------------------------------- | ------------- | --------- |
| A. Schema + vote ingest                 | ~half day     | Yes       |
| B. Classifier (rule + LLM + spot-check) | ~half day     | Yes       |
| C. Scoring engine                       | ~half day     | After B   |
| D. UI rewrite                           | ~half day     | After C   |
| E. Methodology doc + ship               | ~2 hours      | Final     |
| **Total**                               | **~2-3 days** | —         |

Admin review UI: defer to v1.6.1 if it threatens the timeline. LLM-only with confidence floor of 0.8 is acceptable for launch.
