# Marker public-support gate — at-a-glance

**The gate (methodology v0.9).** A marker is only *scored* if the position it
measures has **at least 55% overall public support** (a solid majority). A score
below that threshold would mean penalizing a legislator for voting against
something most Americans want — a fringe-ideology trap this scorecard refuses to
fall into. We keep our convictions; we only grade on the ones the country shares.

This file is the at-a-glance gate reference. The full evidence — question
wording, pollsters, dates, partisan splits, source URLs, and match-confidence —
lives in [`public-support-audit.md`](./public-support-audit.md). The machine-
readable version (keyed by `Marker.slug`) is
`src/lib/scorecard/public-support.ts`.

## Gate rules

- **Threshold: 55%** overall support in the best-matched poll.
- **Basis: overall majority only.** A popular-but-partisan position (e.g. war
  powers, 70% overall but a deep D/R split) still passes on its aggregate
  number. The partisan split is recorded for transparency, not used to gate.
- **No-poll positions pass by documented judgment** (`proxyPass=true`) only when
  the position is self-evidently popular and a direct poll simply doesn't exist.
  Two markers qualify: corporate-PAC refusal and the PACT Act.
- **Antitrust is anchored to the concept, not the bill.** "Break up Big Tech /
  open markets" polls ~74–85%; the bill-specific Open App Markets Act wording
  polls ~32%. We cite the concept-level number and keep the marker.
- **Unresearched or sub-majority positions fail** the gate and do not score
  until they are substantiated.

## Ranked by public support

Sorted high → low. "Gate" is the pass/fail call at 55%.

| Rank | # | Marker (slug) | Plank | Support % | Gate | Match | Note |
|------|---|---------------|-------|-----------|------|-------|------|
| 1 | 5 | Ban congressional stock trading (`stock-trading-ban`) | 1 | **86** | PASS | HIGH | R 87 / D 88 / I 81 |
| 2 | 3 | DISCLOSE Act — dark-money disclosure (`disclose-act`) | 1 | **85** | PASS | HIGH | R 85 / D 88 / I 84 |
| 2 | 22 | Medicare drug-price negotiation (`major-care-vote`) | 4 | **85** | PASS | HIGH | R 77 / D 92 / I 89 |
| 4 | 8 | Clean-energy investment (`clean-energy-investment`) | 2 | **86** | PASS | HIGH | R 83 / D 95 / I 86 |
| 5 | 9 | Federal science research funding (`science-research-funding`) | 2 | **84** | PASS | HIGH | broad bipartisan |
| 6 | 7/11 | Infrastructure & broadband — IIJA (`infrastructure-broadband`) | 2 | **83** | PASS | HIGH | R 79 / D 87 |
| 6 | 17 | Housing supply / affordability (`housing-supply`) | 3 | **83** | PASS | HIGH | strong bipartisan |
| 6 | 25 | Audit the Pentagon (`pentagon-audit`) | 5 | **83** | PASS | HIGH | R 82 / D 84 / I 84 — most cross-partisan item |
| 9 | 13 | Paid family & medical leave (`paid-family-leave`) | 3 | **82** | PASS | HIGH | R 76 / D 90 |
| 10 | 23 | Social Security solvency, protect benefits (`social-security-solvency`) | 4 | **85** | PASS | HIGH | oppose-cuts framing 82–92%; fiscal honesty maintained |
| 11 | 16 | Cap predatory loan / credit-card rates (`loan-rate-cap`) | 3 | **77** | PASS | MEDIUM | consumer survey; cap level varies |
| 11 | 20 | Protect Medicaid from cuts (`medicaid-protection`) | 4 | **76** | PASS | HIGH | R 55 / D 95 / I 79 |
| 11 | 21 | Childcare + paid-leave investment (`paid-leave-childcare`) | 4 | **76** | PASS | HIGH | R 61 / D 86 |
| 11 | 19 | GOP paid-leave tax-credit alt (`new-parents-act-gop-alt`) | 4 | **76** | PASS | MEDIUM | Option C; rides broader paid-leave |
| 15 | 12 | Early-childhood education (`early-childhood`) | 2 | **74** | PASS | HIGH | R 61 / D 86 / I 74 |
| 15 | 27 | Antitrust — open markets (`antitrust-major`) | 5 | **74** | PASS | MEDIUM | concept-level framing; see note |
| 17 | 10 | Environmental protection — Clean Water (`environmental-protection`) | 2 | **70** | PASS | HIGH | strong bipartisan |
| 17 | 26 | War powers — Congress authorizes war (`war-powers`) | 5 | **70** | PASS | HIGH | R 36 / D 91 / I 78 — popular but most partisan |
| 19 | 6 | Major science/manufacturing vote — CHIPS (`major-investment-vote`) | 2 | **65** | PASS | MEDIUM | D 71 / R 62 |
| 19 | 18 | Federal $15 minimum wage (`minimum-wage-increase`) | 3 | **65** | PASS | HIGH | R 41 / D 90 / I 64 |
| 19 | 14 | GOP wage-floor alt — Hawley (`team-act-gop-alt`) | 3 | **65** | PASS | MEDIUM | Option C; rides the $15 number |
| 19 | 4 | Lobbying cooling-off (`lobbying-cooling-off`) | 1 | **65** | PASS | HIGH | R 65 / D 67 |
| 23 | 15 | Wage-theft / non-compete reform (`wage-theft-noncompete`) | 3 | **62** | PASS | MEDIUM | non-compete proxy (59–66%) |
| 24 | 2 | Public financing of elections (`public-financing`) | 1 | **60** | PASS | MEDIUM | framing-sensitive |
| 25 | 28 | Labor/environment in trade deals (`trade-protections`) | 5 | **55** | PASS | MEDIUM | right at the line; volatile |
| — | 1 | Refuse corporate PAC money (`corporate-pac-refusal`) | 1 | **no poll** | PASS (judgment) | LOW | ~80% "donors have too much influence" proxy; also bill-less → not in voting tally |
| — | 24 | PACT Act — burn-pit care (`pact-act`) | 4 | **no poll** | PASS (judgment) | LOW | Senate vote 86–11; strong veteran backing |

## Tally

- **27 markers, all pass** the 55% gate:
  - **25 pass on a real poll** (≥55% overall support).
  - **2 pass by documented judgment** with no direct poll: corporate-PAC refusal
    (#1) and the PACT Act (#24).
- **0 markers fail.** The one marker that failed the gate when this audit was
  first run — State Department funding (`state-department-funding`, Plank 5) —
  has since been **deleted outright** (removed from the seed and the database):
  no poll existed, the position was not self-evidently majority-popular, and
  rather than carrying a permanently-gated-out marker we removed it.

**The gate excludes nothing from the live voting tally today** — every marker
in the catalog clears 55% (or passes on documented judgment). The gate's job is
forward-looking: it sets the bar any new marker must clear before it can move a
legislator's score.

## The antitrust framing note (locked)

Antitrust is the scorecard's most framing-dependent position. We anchor the
marker to the broad, durable majority — "break up Big Tech / open markets / rein
in Apple & Google," which polls **~74–85%** across both parties — rather than to
the narrow Open App Markets Act provision wording, which never cleared ~32% in
bill-specific polling. The marker passes the gate at the concept level, and the
public source we cite is the concept poll, not the bill. Plank 5 keeps the
"peace" name and the antitrust marker is retained.

## Locked decisions reflected here

- **Plank 2** rewards public-school investment; no vouchers/charters marker.
- **Plank 3** uses a federal $15 minimum-wage primary plus a Republican-led
  wage-floor alternative (Option C, #14); no PRO Act marker.
- **Plank 4** Social Security marker is scored on *protecting benefits* with
  fiscal honesty on solvency — not on benefit cuts.
- **Plank 5** keeps "Peace and Strength" as its name.
