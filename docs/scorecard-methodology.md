# How we score

This scorecard measures every sitting member of Congress and every sitting member of the California State Legislature against five planks of a cross-partisan civic platform (four planks for California — see below). The same rubric applies to every legislator regardless of party: Bernie Sanders and Josh Hawley are scored against identical markers. Every point in every score traces to a public source — a vote roll, a cosponsorship record, an FEC filing, or a Cal-Access filing — and every score is reviewed by a human before it goes public.

## The basics

Each legislator earns or loses points based on what they actually do on the bills tracked under each plank. Yes votes and cosponsorship earn points. A recorded "no" vote, an unexcused or excused absence on a recorded roll, or a vote of "present" loses a point. A position we have no record of doesn't count either way — it doesn't penalize a legislator, but it also doesn't help them. Thin coverage shows up explicitly on each plank as a "based on X of Y markers measured" indicator, so a score based on three markers reads differently from one based on twelve.

Plank scores are signed integers — they can be positive, negative, or zero. A positive total renders green, a negative total renders red, zero renders neutral. There is no artificial denominator: the number reflects the cumulative weight of every recorded position.

## The weight table

| What                                                                         | Points |
| ---------------------------------------------------------------------------- | ------ |
| Wrote the bill (author / lead sponsor)                                       | +3     |
| Co-led the bill (principal coauthor / coauthor)                              | +2     |
| Signed on (cosponsor)                                                        | +1     |
| Voted yes (committee or floor)                                               | +1     |
| Voted no, didn't vote when present, was excused, abstained, or voted present | −1     |
| Took less than 5% of campaign money from corporate PACs                      | +1     |
| Took 5% or more from corporate PACs                                          | −1     |
| No record on this marker                                                     | 0      |

> All five non-yes vote positions count the same: −1. Including officially-excused absences. We treat them the same because the bill needed your yes to pass — if you weren't there to give it, the procedural effect is identical regardless of why.

**Plank score** = sum of all weighted points on that plank. Can be negative.  
**Total score** = sum of plank scores across all planks. Also signed.

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

## Corporate PAC money

A legislator "refuses corporate PAC money" when corporate PAC contributions are under 5% of total campaign receipts in the current cycle.

**Federal source:** OpenSecrets bulk data, which pre-classifies PACs into corporate, labor, ideological, party, candidate, and trade-association categories from FEC filings. (The OpenSecrets API was discontinued in April 2025; bulk CSV downloads remain available and are imported into our database.)

**California source:** Cal-Access raw data via the California Civic Data Coalition (CCDC) pipeline, hosted on Big Local News. Cal-Access does not pre-classify "corporate PAC" — that classification is maintained in our `CommitteeClassification` table, hand-curated for the top California committees. Every classification is publicly visible and open to challenge.

A future upgrade path uses FEC.gov directly with our own PAC classification. The scoring engine prefers the highest-fidelity source where multiple records exist for the same legislator.

## What we don't (yet) score

Honest accounting of current gaps:

- **Procedural deaths.** When a bill dies in conference committee, in a suspense file, or is "held under submission," that often happens off the record — no vote roll, no cosponsorship signal. We can't score what we can't see, so those moments of legislative burial don't show up in a member's numbers even when they're consequential.
- **Committee importance.** A committee chair who kills a bill in markup is doing something meaningfully different from a rank-and-file member who votes no on the floor. We don't yet weight by committee position or amendment authorship.
- **Vote record completeness.** We rely on LegiScan for vote records. If LegiScan doesn't have a roll call, we don't either — a gap in their coverage becomes a gap in ours.

## Provisional bills

Some markers track bills that have been identified as likely vehicles but haven't yet been formally introduced or confirmed in the official record. These are flagged as provisional and are not scored until LegiScan confirms the bill number against the authoritative source (Congress.gov for federal, leginfo.legislature.ca.gov for California). A provisional flag on a marker is visible on the platform and in the methodology notes.

## Methodology versions

Each score row in the database is stamped with the methodology version it was computed under. When the methodology changes, scores are recomputed under the new version; old versions remain for audit purposes but are not shown publicly.

| Version | Released   | What changed                                                                                    |
| ------- | ---------- | ----------------------------------------------------------------------------------------------- |
| v1.0    | 2026-04-29 | Initial 0–5 rubric, primary + secondary markers                                                 |
| v1.1    | 2026-04-29 | Three-state position records (ACTED_FOR / ACTED_AGAINST / NO_RECORD)                            |
| v1.2    | 2026-05-12 | Switched from 0–5 rubric to signed +1/−1 point sum                                              |
| v1.3    | 2026-05-13 | Sponsor-tier weighted scoring (Author/Sponsor +3, Principal Coauthor/Coauthor +2, Cosponsor +1) |
