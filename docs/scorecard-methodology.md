# Scorecard Methodology — v1.0

_Working draft. Methodology version `v1.0`. Subject to change before public launch._

---

## What this scores

Every sitting member of Congress (federal scorecard) and every sitting member of the California State Legislature (state scorecard, v1) is scored against five planks of a cross-partisan civic platform.

Federal members are scored 0–5 on each of five planks for a total out of 25. California members are scored 0–5 on each of four planks (Plank 5 — _Peace and Strength_ — does not map to state-level policy) for a total out of 20.

Same rubric applies to every member regardless of party. Bernie Sanders and Josh Hawley are scored against the same markers.

## Scoring (v1.2 — point model)

Each verified position record contributes a signed integer point:

- **ACTED_FOR** → **+1** for ANY of:
  - Cosponsored the marker bill (any tier)
  - Voted yes on the marker bill in committee or on the floor
  - Under the corporate-PAC threshold (Plank 1 only)
- **ACTED_AGAINST** → **−1** for ANY of:
  - Voted no on the marker bill
  - Recorded NOT_VOTING on a committee roll where the legislator was seated (procedural denial)
  - Over the corporate-PAC threshold
- **NO_RECORD** → 0 (no position evidence; the marker doesn't contribute either way)

The marker's `actionType` (COSPONSOR vs VOTE_YES) determines which positive signals dominate when multiple exist (sponsor wins over vote), but **any** positive signal is enough to earn the +1. Earlier versions of the engine only counted cosponsorship for COSPONSOR-type markers; that was too strict — a senator who voted yes on a bill they didn't cosponsor still acted for it.

**Plank score** = sum of marker points on that plank. Can be negative.
**Total score** = sum of plank scores across all planks. Also signed.

Positive scores render green, negative scores render red, zero renders neutral gray. No artificial denominator (no "out of 20" or "out of 25") — the point total reflects the cumulative weight of recorded positions.

A score is published only after every constituent record traces to a public source (vote, cosponsorship, FEC filing, Cal-Access filing) and has passed the verification gate.

### Why this model

Earlier versions (v1.0 / v1.1) used a 0–5 rubric per plank with primary + secondary weighting. Reasons for switching to the point model:

1. **Action-reactive scoring.** A senator who cosponsors 12 marker bills and voted against 2 reads as +10 — the activity is preserved. The old rubric collapsed that into a 3/5 or 4/5 even though the underlying behavior was very different.
2. **Transparent weighting.** Each marker is worth ±1, full stop. No ambiguity about whether "primary alone" earns 3 or whether "primary + 1 secondary" earns 3 or 4.
3. **Computationally trivial.** Score = forCount − againstCount. Compute pass finishes in seconds at full population, vs. minutes with the rubric upserts.
4. **Coverage is its own indicator.** Page renders "based on X of Y markers measured" beside the score; thin coverage no longer looks like the same thing as low alignment.

## The five planks

### 1. Honest Government

End legalized bribery. Public servants, not private clients.

Federal primary marker: refuses corporate PAC money in current cycle (under 5% of total receipts, per FEC). Secondaries: stock-trading ban, public financing of elections, dark-money disclosure, lobbying-cooling-off reform.

California primary marker: refuses corporate PAC money in current cycle (under 5% of receipts, per Cal-Access). Secondaries: strengthening the Levine Act, lobbyist-gift caps, state-level dark-money disclosure, extended cooling-off period.

### 2. Our Children Our Future

The schools, science, technology, and infrastructure we hand down.

Federal primary marker: supported a major education / research / infrastructure / clean energy investment in the past two Congresses. Secondaries: clean energy investment, science research funding, environmental protection, early childhood, infrastructure beyond IIJA.

California primary marker: supported LCFF base and TK universalization (and opposed voucher / ESA proposals). Secondaries: SB 100 implementation, wildfire prevention, higher-ed funding floors, broadband.

### 3. Making a Living

A full-time job should support a life.

Federal primary marker: supported federal minimum wage increase to $15 or higher. Secondaries: wage theft / non-compete / anti-retaliation legislation, 36% loan rate cap, federal housing supply, paid family leave. Includes a **Republican alternative** secondary for the Romney–Cotton TEAM Act under Option C (see below).

California primary marker: supported housing supply legislation (composite — at least two of SB 9 / SB 10 successors, AB 2011, AB 2097, ADU expansion). Secondaries: AB 1482 tenant protections, wage theft enforcement, state loan rate caps, expanded Paid Family Leave.

### 4. The Care We Owe

Honor the promises this country has made.

Federal primary marker: supported a major healthcare cost or veterans benefit measure in the past two Congresses (IRA drug pricing, PACT Act, ACA subsidy expansion, Medical Debt Relief, or Medicare expansion). Secondaries: PACT Act, votes against Medicaid cuts, Social Security solvency legislation, childcare / paid leave. Includes a **Republican alternative** secondary for the Rubio New Parents Act under Option C.

California primary marker: supported Medi-Cal expansion and protection. Secondaries: CalRx affordable medication, state veterans home funding, county-level mental health capacity, state childcare assistance.

### 5. Peace and Strength (federal only)

Use American power wisely. End the forever wars. Audit the Pentagon.

Primary marker: supported a congressional war powers reassertion (AUMF repeal cosponsorship or Iran/Yemen/Venezuela WPR vote in 119th Congress). Secondaries: Pentagon audit accountability, major antitrust legislation, State Department funding, labor and environmental protections in trade agreements.

This plank does not map to state-level policy and is not part of the California scorecard.

## Option C — two-tier markers

Republican-authored policy alternatives count toward plank scores as **secondary markers** (never primary) when they meet both conditions:

1. Introduced as a standalone bill with at least 3 GOP cosponsors.
2. Directionally moves the policy in the plank's stated direction, even if smaller in magnitude than a Democratic vehicle.

This rule was adopted on 2026-04-29 to fix a methodological gap: without it, the scorecard read as scoring against Democratic legislative vehicles, and Republicans who authored conservative alternatives on minimum wage, paid leave, antitrust, etc. received no credit. The cross-partisan integrity claim depends on this rule.

Concrete examples in the seed data:

- **Plank 3 — _Making a Living_.** The Romney–Cotton TEAM Act (\$10/hour indexed minimum wage paired with E-Verify) counts as a secondary marker paralleling the Raise the Wage Act (\$15) primary. Members who cosponsor TEAM but not Raise the Wage receive secondary-marker credit on Plank 3.
- **Plank 4 — _The Care We Owe_.** The Rubio New Parents Act (paid parental leave funded by Social Security advances) counts as a secondary marker paralleling federal paid-leave proposals.

Republican alternatives never qualify as the _primary_ marker for a plank. The reasoning for each Option C call is documented in the marker's `methodologyNotes` and rendered on the public methodology page.

## Corporate PAC money definition

A member "refuses corporate PAC money" when corporate PAC contributions are under 5% of total campaign receipts in the current cycle.

**Federal source:** OpenSecrets bulk data, which pre-classifies PACs into corporate / labor / ideological / party / candidate categories from FEC filings. Imported into our `PacMoneyData` table with `dataSource = OPENSECRETS_BULK`. (The OpenSecrets API was discontinued in April 2025; bulk CSV downloads remain available.)

**California source:** Cal-Access raw data via the California Civic Data Coalition (CCDC) pipeline, hosted on Big Local News. Imported with `dataSource = CAL_ACCESS_CCDC`. Cal-Access does not pre-classify "corporate PAC" — that classification is held in our `CommitteeClassification` table, hand-curated for the top California committees. Every classification is publicly visible and challengeable.

A future graduation path uses FEC.gov directly (`api.open.fec.gov`) with our own PAC classification, switching `dataSource` to `FEC_DIRECT`. The scoring engine prefers higher-fidelity sources where multiple are present.

## Provisional bill numbers

Bill numbers in the seed data are flagged `isProvisional = true` until they are verified against authoritative sources (Congress.gov for federal, leginfo.legislature.ca.gov for California). Phase 2 sync against ProPublica / OpenStates does not run against provisional bills.

## Verification before publication

Every `MarkerAchievement` written by the automated pipeline starts unverified. A human reviewer must verify the evidence URL and toggle the achievement's verification flag before the resulting score is published. This is the credibility gate — without verification, no score is shown to the public.

## Challenges

Every published score is open to public challenge. A challenge form (Phase 5) accepts a rep ID, plank ID, description, and contact email. The verification team reviews each challenge and either updates the score or publishes the reasoning for declining to update it. Rejections are not silent.

## Three-state position records (v1.1)

Each `MarkerAchievement` row carries an `actionTaken` field with three values:

- **ACTED_FOR** — positive evidence that the legislator took the side the marker rewards (cosponsored, voted yes on a VOTE_YES marker, refused corporate PAC money under the threshold).
- **ACTED_AGAINST** — positive evidence the legislator took the opposite side (voted no on a VOTE_YES marker, accepted corporate PAC money over the threshold).
- **NO_RECORD** — implicit when no row exists. We don't have a public position record for this legislator on this marker yet.

The page rendering distinguishes all three (✓ green / ✗ slate / ? gray dashed) so legislators with thin coverage don't get treated as opposition by default. Each plank now carries a "based on X of Y markers measured" indicator, and the per-plank score is rendered with reduced opacity when measured coverage falls below 50%.

The scoring rubric itself is unchanged — `actionTaken === 'ACTED_FOR'` is what counts toward primary/secondary tallies. NO_RECORD does not penalize. ACTED_AGAINST does not deduct from the score (counts as zero like NO_RECORD), but it surfaces visibly on the page so readers can see who voted against the plank.

## Methodology versions

Methodology may change. Each `RepresentativeScore` row is stamped with the methodology version it was computed under. When the methodology changes, scores are recomputed under the new version; old versions remain in the database for audit purposes but are not displayed publicly.

This document is `v1.2` — replaces the v1.0/v1.1 0–5 rubric with the signed +1/−1 point model described above. Three-state position records (v1.1) and the coverage indicator are retained.
