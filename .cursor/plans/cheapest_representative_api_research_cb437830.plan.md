---
name: Cheapest Representative API Research
overview: Recommend the lowest-cost API stack for U.S. federal/state/local elected representative lookup with contact info, based on current public pricing and coverage.
todos:
  - id: validate-final-sources
    content: Verify all selected providers are currently available and not deprecated.
    status: pending
  - id: define-lookup-waterfall
    content: Specify exact request order and fallback conditions between free and paid sources.
    status: pending
  - id: estimate-credit-burn
    content: Model expected Cicero credit usage based on local-resolution rate and cache hit rate.
    status: pending
  - id: prepare-build-recommendation
    content: Produce final implementation recommendation with cost guardrails and monitoring metrics.
    status: pending
isProject: false
---

# Cheapest U.S. Representative API Plan

## Goal

Identify the cheapest reliable way to get a user's elected representatives plus contact info across **federal, state, and local** levels in the U.S.

## Research-Based Recommendation

Use a **hybrid API stack** to minimize paid calls:

- **Address-to-geo (free):** U.S. Census Geocoder API (`geocoding.geo.census.gov`) for geocoding + geography lookup.
- **Federal reps + contacts (free):** `unitedstates/congress-legislators` data (includes `phone`, `address`, `contact_form`, office info).
- **State reps + contacts (free):** OpenStates API v3 (`/people.geo`, `/people`) with API key.
- **Local reps + contacts (paid fallback):** Cicero API only when local-level officials are required and missing from free sources.

This keeps the majority of traffic free and pays only for local coverage where nationwide free datasets are incomplete.

## Why this is cheapest

- Google Civic representatives endpoints were turned down (announced and fully shut down by Apr 30, 2025), so they are not a viable free source.
- OpenStates + Congress datasets cover major needs at zero direct API cost.
- Local nationwide coverage generally requires a commercial source; Cicero has transparent, low entry pricing (e.g., 5,000 credits at $298 commercial / $268 nonprofit-gov-edu) and can be used selectively.

## Practical implementation approach

1. Normalize user address and geocode via Census Geocoder.
2. Resolve federal officials via congressional district + congress-legislators contacts.
3. Resolve state officials via OpenStates geo/person endpoints.
4. If local offices are requested and unresolved, call Cicero for district/official/contact enrichment.
5. Cache resolved officials per normalized address to reduce repeat lookups and paid credits.

## Decision checkpoints

- **If you need one API only:** Cicero is the clearest all-levels option with published pricing.
- **If you optimize for lowest cost:** use the hybrid stack above.
- **If evaluating BallotReady/Ballotpedia/VoteSmart:** pricing is mostly sales-gated or non-public, so cannot be confirmed as cheaper than selective Cicero fallback without quotes.
