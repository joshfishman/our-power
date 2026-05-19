# How we score

This scorecard measures every sitting member of Congress and every sitting member of the California State Legislature against five planks of a cross-partisan civic platform (four planks for California — see below). The same rubric applies to every legislator regardless of party: Bernie Sanders and Josh Hawley are scored against identical markers. Every point in every score traces to a public source — a vote roll, a cosponsorship record, an FEC filing, or a Cal-Access filing — and every score is reviewed by a human before it goes public.

## How v1.6 works

Each plank score is an **alignment percentage** — the share of plank-relevant votes the legislator cast the platform-aligned way. Same approach LCV (environmental scorecard), ACU (conservative scorecard), AFL-CIO (labor scorecard) use, applied to the five Common Ground planks.

For every roll-call vote in the 119th Congress (House and Senate) and every roll-call vote in the California 2025-26 legislative session:

1. **Classify the vote** — does it relate to one or more of the five planks? Bills purely outside the planks (judicial nominations, naming post offices, censures, ceremonial resolutions, procedural rules for considering other bills) don't contribute to scoring.
2. **Identify the platform-aligned position** — for plank-relevant votes, what's the YES/NO that aligns with the Common Ground platform? Most pro-plank bills are aligned=YES; bills that cut against the planks are aligned=NO. Republican-led Plank-3 and Plank-4 alternatives (Option C bills like Hawley's Higher Wages Act or Bice-Houlahan paid leave) are platform-aligned regardless of party.
3. **Tally** — for each (legislator, plank): aligned votes / (aligned + non-aligned) × 100.

Non-aligned includes the legislator's recorded "wrong" vote AND missed votes (NOT_VOTING, EXCUSED, ABSENT) — preserves the v1.5 stance that "the bill needed your position to pass, and you didn't deliver it." Procedural absences count the same as deliberate absences.

The total score across all five planks is the simple mean of per-plank percentages.

### Classification — how votes get tagged

Two stages:

1. **Rule-based first pass** — Congress.gov policy areas map to planks (Energy → Plank 2, Labor and Employment → Plank 3, Armed Forces → Plank 5, etc.). Subject-level keywords disambiguate (e.g., a bill in "Government Operations and Politics" about voting rights is Plank 1; about postal service is unrelated).
2. **LLM disambiguation** for ambiguous cases — bills where the policy area maps to multiple planks, or where sponsor party doesn't predict direction (bipartisan ethics bills, Option C alternatives). An LLM reads the bill title, summary, subjects, and sponsor party and proposes plank assignment + aligned direction + confidence.

Confidence below 0.5 → vote is **not scorable** (excluded from any plank's tally).

Every classification is logged with reasoning. Methodology version v1.6 ships with rule-based + LLM classifications. Human-review admin UI for borderline cases is v1.6.1 work.

### Calibration check

v1.6 correlates with DW-NOMINATE (the academic legislator-ideology standard from Voteview) at Pearson r ≈ **−0.69 to −0.91** (range across House-only vs full federal+CA dataset). Higher than v1.5 (−0.49). Below the −0.90 ceiling because the Common Ground methodology deliberately diverges from a pure left-right axis on a few dimensions — Hawley's anti-corporate-PAC stance is platform-aligned even though he's economically conservative, AFP-aligned spending counts negatively even when bipartisan-supported, etc.

### Corporate-PAC marker — separate Plank 1 overlay

The corporate-money score (refusal of corporate PAC money + corporate IE classification — see "Outside money" below) remains as a **separate Plank 1 component** alongside the vote-alignment percentage. v1.6 keeps it parallel rather than collapsed into a single Plank 1 number; the Plank 1 display shows both signals.

## The five planks

Planks 1–4 apply to both federal and California legislators. Plank 5 — Peace and Strength — is federal-only; it does not map to state-level policy and is not part of the California scorecard.

---

### Plank 1 — Honest Government

_End legalized bribery. Public servants, not private clients._

**Federal:** Public servants work for the public. End the system where members of Congress trade stocks on inside information, take corporate PAC money, and walk into lobbying jobs the day they leave office. Public financing of elections so candidates work for voters, not donors. Full disclosure of dark money. Real cooling-off periods between government service and lobbying.

**California:** Members of the California Legislature work for Californians. Stop pay-to-play. Strengthen the Levine Act. Limit lobbyist gifts. Disclose dark money in state campaigns. Real cooling-off periods between Sacramento and the lobby corps next door.

---

### Plank 2 — Our Children Our Future

_What we build and hand down to the next generation._

**Federal:** Strong public schools — every child deserves a good one in their neighborhood. Parental empowerment within public schools (transparency, voice in curriculum), without draining public dollars to vouchers or charters. Early childhood education. Federal science and technology research. Clean energy independence — solar, wind, nuclear, geothermal, batteries, the grid. Roads, bridges, broadband, water. Environmental stewardship.

**California:** Strong public schools — California's LCFF and TK rollouts mean every child has the chance to learn close to home. Real funding for UC, CSU, and community colleges. Climate action that meets SB 100 targets and the moment we are in. Wildfire prevention. Water infrastructure that holds for the next century. Broadband for every child.

---

### Plank 3 — Making a Living

_A full-time job should support a life. Wages, housing, no predatory lending._

**Federal:** A federal minimum wage that means something. Stop wage theft and retaliation against workers who organize. End non-competes that trap workers in low-wage jobs. Cap predatory loan rates. Build housing. Paid family leave for working families.

**California:** California has the highest housing costs in the country. The state minimum wage is meaningful but rent eats it. Build housing — SB 9, SB 10, ADU pathways, by-right zoning where it works. Stop wage theft. Cap predatory loan rates. Protect tenants from no-cause eviction. Keep workers' protections strong.

---

### Plank 4 — The Care We Owe

_Honor the promises this country has made — to veterans, elders, and working families._

**Federal:** The country made promises — to veterans, to elders, to working families who paid in. Honor them. Veterans get the care they earned. Drug prices come down. Medicare and Medicaid stay strong. Social Security stays solvent and pays what people earned. Childcare and paid leave so families can work and raise children at the same time.

**California:** Medi-Cal expansion has covered millions more Californians. Keep building that. CalRx for affordable medication. Real funding for state veterans homes and benefits. Mental health access that actually exists in your county. Childcare that working parents can afford.

---

### Plank 5 — Peace and Strength (federal only)

_Use American power wisely. End the forever wars. Audit the Pentagon._

Strength means using power wisely. End the forever wars — Congress, not the executive alone, decides when American troops go into combat. Audit the Pentagon, every dollar accounted for. Break up monopolies that have grown too powerful — Big Tech, pharma, agriculture, defense. Real diplomacy at parity with force projection. Trade deals that protect American workers and the environment.

This plank does not map to state-level policy and is not scored for California legislators.

---

## Two-tier markers (the Option C rule)

Some markers credit either the platform's preferred legislative vehicle or a Republican-authored alternative that moves in the same direction at smaller magnitude. Both vehicles count. A member who cosponsors the conservative alternative but not the progressive primary vehicle still earns secondary-marker credit — the cross-partisan integrity of this scorecard depends on that rule.

Two concrete examples:

- **Plank 3 — Making a Living.** The Higher Wages for American Workers Act (Hawley/Welch/Gallego, S.2013) counts as a secondary marker paralleling the Raise the Wage Act ($17/hr primary). Members who cosponsor the lower-magnitude alternative but not the primary earn secondary credit on Plank 3.
- **Plank 4 — The Care We Owe.** The More Paid Leave for More Americans Act (Bice-Houlahan, H.R.3089) counts as a secondary marker paralleling Democratic paid-leave proposals. It uses tax credits and federal-state partnership rather than payroll-tax funding — a different mechanism, the same direction.

Republican alternatives never qualify as the _primary_ marker for a plank. The reasoning for each two-tier call is documented in the marker's methodology notes and is publicly visible on the platform.

## Outside money: concentrated wealth vs. the people

The Plank 1 score counts the money flowing into a campaign that comes from
**concentrated wealth seeking access**, as distinct from the money flowing
from **grassroots members or workers**. The split is binary — every
political committee is either MONEY or PEOPLE — and only MONEY counts
against the legislator.

### The MONEY bucket — counts against you

- Corporate PACs and trade-association PACs (drug companies, defense
  contractors, banks, crypto-industry vehicles, etc.).
- Party committees (DNC, RNC, DSCC, NRSC, DCCC, NRCC). The major-party
  national committees are establishment vehicles regardless of which
  side you're on.
- Leadership super PACs: House Majority PAC, Senate Majority PAC,
  Congressional Leadership Fund, Senate Leadership Fund. These are funded
  by wealthy individual mega-donors and the party-aligned corporate
  donor base.
- Donor-class ideological super PACs: Club for Growth Action, Future
  Forward USA, Senate Conservatives Fund, AIPAC's UDP, American Bridge.
  A small number of wealthy donors fund each.

### The PEOPLE bucket — does NOT count against you

- Labor union PACs (AFL-CIO COPE, SEIU COPE, AFSCME PEOPLE, NEA Advocacy
  Fund, building-trades PACs). Funded by member dues from millions of
  workers.
- Grassroots advocacy with mass-membership funding (MoveOn, Planned
  Parenthood Votes, LCV Victory Fund, Equality PAC).
- Caucus member PACs (Congressional Progressive Caucus PAC, CHC Bold
  PAC). Funded by small contributions from caucus members and aligned
  small-dollar donors.
- Small-dollar progressive primary-challenger PACs (Justice Democrats,
  Leaders We Deserve).
- Civil rights mobilization (Black Voters Matter Action PAC).

### The ratio

    Outside-money ratio = (direct MONEY PAC contributions + MONEY IE supporting you + MONEY IE against your opponents)
                          ───────────────────────────────────────────────────────────────────────────────────────────
                          (total receipts + MONEY IE supporting you + MONEY IE against your opponents)

The score follows the same gradient as v1.4: under 5% → +1, 0% → +2,
above the upper anchors → −3.

**What's NOT in the formula: MONEY attacks ON you.** When a donor-class
super PAC spends to defeat a legislator, that's not money working for
them. We disclose those attacks in the PAC scoreboard table (small
italic column) but don't reward being attacked. Race competitiveness
drives attack spending in ways that don't track policy alignment.

### Why this binary, not corporate-vs-labor

Earlier methodology versions (v1.3 and v1.4) distinguished corporate
from labor from "ideological." That split confused two questions: _what
sector funds this committee?_ and _what kind of campaign-finance signal
is this?_ A leadership super PAC funded by twenty mega-donors and a
labor PAC funded by two million union members are categorically
different signals about who the legislator is responsive to, even
though both might oppose the same bill on a given vote.

v1.5 collapses to the question that matters for an accountability
scorecard: **does this money come from a concentrated few seeking
access, or from many people pooling small contributions?** Lincoln's
"government of the people, by the people, for the people" framing —
not a left-right framing.

### How we identify your opponents

For each cycle a legislator has run in, we count MONEY IE against
any of these:

- **Past completed cycles**: every candidate who filed for the same seat in the same cycle, including primary challengers and the general-election opponent.
- **Active upcoming cycle**: every candidate who has filed paperwork to run for this seat in the next election.

### How we classify MONEY vs PEOPLE

**Federal:** Two sources combined.

1. **FEC bulk Committee Master file** classifies the ~3,200 "connected" PACs sponsored by corporations, labor unions, trade associations, and membership organizations. Connected corporate / trade-association / cooperative PACs → MONEY. Connected labor PACs → PEOPLE. Membership orgs (e.g., AMA, AARP) default to MONEY because their funding model is concentrated professional fees, but specific entries can be moved to PEOPLE via the manual overlay.
2. **Hand-curated manual classification** for the major super PACs that the FEC bulk doesn't cover (non-connected committees). Every entry is publicly visible at `data/manual-super-pac-classifications.csv` in the public repo and open to challenge.

**Conservative-attribution rule:** committees with no classification default to MONEY. We'd rather over-count outside money pressure (penalizing legislators where some IE was actually grassroots) than under-count it (letting donor-class IE go unmeasured).

**California:** Cal-Access raw data via the California Civic Data Coalition (CCDC) pipeline. CA classifications haven't been populated yet — CA legislators score on direct PAC ratio only until the table is filled in.

The scoring engine prefers the highest-fidelity source where multiple records exist for the same legislator.

## Scores as percentages

Each legislator's total is a signed integer (sum of weighted markers
across planks). We display it as a percentage from −100% to +100% to
make it easier to read at a glance:

- **+100%** = the top-scoring legislator's raw score
- **−100%** = the bottom-scoring legislator's raw score
- Everyone else scales linearly between

The percentile anchors are computed once per methodology version (from
the first published compute) and frozen until the next version. That
keeps percentages stable across the lifetime of a methodology version
even as new bills are added.

The raw integer score is always visible alongside the percentage for
anyone who wants the unscaled signal.

## What we don't (yet) score

Honest accounting of current gaps:

- **Procedural deaths.** When a bill dies in conference committee, in a suspense file, or is "held under submission," that often happens off the record — no vote roll, no cosponsorship signal. We can't score what we can't see, so those moments of legislative burial don't show up in a member's numbers even when they're consequential.
- **Committee importance.** A committee chair who kills a bill in markup is doing something meaningfully different from a rank-and-file member who votes no on the floor. We don't yet weight by committee position or amendment authorship.
- **Vote record completeness.** We rely on LegiScan for vote records. If LegiScan doesn't have a roll call, we don't either — a gap in their coverage becomes a gap in ours.
- **Real-time IE tracking.** Schedule E filings update at FEC daily, but our scorecard recomputes on a schedule (weekly during election cycles, less often outside). A super PAC drop today won't show up until the next compute.
- **Per-super-PAC drill-downs.** We aggregate corporate IE spending into one number per legislator. We don't yet show "which corporate super PAC spent the most on this senator" — that data is captured but not surfaced. Future feature.

## Provisional bills

Some markers track bills that have been identified as likely vehicles but haven't yet been formally introduced or confirmed in the official record. These are flagged as provisional and are not scored until LegiScan confirms the bill number against the authoritative source (Congress.gov for federal, leginfo.legislature.ca.gov for California). A provisional flag on a marker is visible on the platform and in the methodology notes.

## Methodology versions

Each score row in the database is stamped with the methodology version it was computed under. When the methodology changes, scores are recomputed under the new version; old versions remain for audit purposes but are not shown publicly.

| Version | Released   | What changed                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v1.0    | 2026-04-29 | Initial 0–5 rubric, primary + secondary markers                                                                                                                                                                                                                                                                                                                                                                                                            |
| v1.1    | 2026-04-29 | Three-state position records (ACTED_FOR / ACTED_AGAINST / NO_RECORD)                                                                                                                                                                                                                                                                                                                                                                                       |
| v1.2    | 2026-05-12 | Switched from 0–5 rubric to signed +1/−1 point sum                                                                                                                                                                                                                                                                                                                                                                                                         |
| v1.3    | 2026-05-13 | Sponsor-tier weighted scoring (Author/Sponsor +3, Principal Coauthor/Coauthor +2, Cosponsor +1)                                                                                                                                                                                                                                                                                                                                                            |
| v1.4    | 2026-05-14 | Super-PAC IE inclusion (corporate IE supporting you + corporate IE against your opponents), continuous PAC gradient, anchored percent display                                                                                                                                                                                                                                                                                                              |
| v1.5    | 2026-05-15 | Collapse corporate-vs-labor classification to MONEY-vs-PEOPLE binary. Counts concentrated-wealth-funded committees (corporate, party leadership, donor-class super PACs) negatively; excludes grassroots / member-funded committees (labor unions, mass-membership advocacy). Plank 1 framing shifts to "government of the people, by the people, for the people."                                                                                         |
| v1.6    | 2026-05-19 | Methodology shift from curated marker bills to **alignment-percentage on every roll-call vote**. Pulls all 119th Congress House + Senate votes (~780) and all CA 2025-26 floor votes; classifies each by plank via rule-based + LLM hybrid; scores legislators on % of plank-relevant votes voted the platform-aligned way. ~270k vote records vs v1.5's ~430. Calibration vs DW-NOMINATE jumped from r=-0.49 (v1.5) to r=-0.69 full / r=-0.91 House-only. |
