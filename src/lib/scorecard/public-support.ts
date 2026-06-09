// Public-support gate (methodology v0.9).
//
// Choice (b): keep convictions, but only SCORE a marker if a majority of the
// public supports the underlying position. This keeps the platform out of
// "fringe ideology" territory — a low score on a gated marker means the
// legislator voted against something most Americans want, not against our
// politics. Numbers + sources are documented in docs/scorecard/public-support-audit.md.
//
// Stored as code (not a DB column) on purpose: the values are static polling
// snapshots, they're version-controlled + citable, and this avoids a schema
// migration on the shared database.
//
// Gate decisions (locked):
//   - Threshold: 55% (solid majority).
//   - Basis: overall majority only (partisan-but-popular items like war powers
//     still pass; their split is recorded for display/transparency).
//   - No-poll positions PASS on documented judgment (proxyPass=true) when the
//     position is self-evidently popular (corporate-PAC refusal, PACT Act).
//   - Antitrust kept at the concept level ("break up / open markets", ~74%),
//     not the bill-specific Open App Markets wording (~32%).

export const PUBLIC_SUPPORT_GATE = 55;

export interface MarkerSupport {
  /** Best-matched support %, or null when there is no usable poll. */
  pct: number | null;
  oppose?: number;
  byParty?: { D?: number; R?: number; I?: number };
  source: string;
  asOf: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  /** No direct poll, but kept as supported on documented judgment. */
  proxyPass?: boolean;
  note?: string;
}

// Keyed by Marker.slug. See the audit doc for question wording + URLs.
export const PUBLIC_SUPPORT: Record<string, MarkerSupport> = {
  // ── Plank 1 — Honest Government ──
  'stock-trading-ban': { pct: 86, oppose: 9, byParty: { R: 87, D: 88, I: 81 }, source: 'PPC/UMD', asOf: '2023-05', confidence: 'HIGH' },
  'disclose-act': { pct: 85, oppose: 15, byParty: { R: 85, D: 88, I: 84 }, source: 'Brennan Center', asOf: '2026-06', confidence: 'HIGH' },
  'lobbying-cooling-off': { pct: 65, byParty: { R: 65, D: 67 }, source: 'PPC/UMD', asOf: '2022-06', confidence: 'HIGH' },
  'public-financing': { pct: 60, source: 'Brennan/Data for Progress', asOf: '2023', confidence: 'MEDIUM', note: 'Framing-sensitive: ~60% for "voluntary small-donor matching"; lower on bare "taxpayer-funded" framings.' },
  'corporate-pac-refusal': { pct: null, proxyPass: true, byParty: {}, source: 'Pew influence proxy (~80% "donors have too much influence")', asOf: '2023', confidence: 'LOW', note: 'No direct poll. Also the PAC-score signal (bill-less) — excluded from the voting tally anyway. Pass on proxy + cross-partisan trust study.' },

  // ── Plank 2 — Our Children Our Future ──
  'major-investment-vote': { pct: 65, byParty: { D: 71, R: 62 }, source: 'Morning Consult/Politico (CHIPS)', asOf: '2022', confidence: 'MEDIUM' },
  'clean-energy-investment': { pct: 86, oppose: 10, byParty: { D: 95, R: 83, I: 86 }, source: 'SEIA', asOf: '2024-09', confidence: 'HIGH' },
  'science-research-funding': { pct: 84, source: 'Pew', asOf: '2025-10', confidence: 'HIGH' },
  'environmental-protection': { pct: 70, source: 'Morning Consult / Walton FF (Clean Water Act)', asOf: '2022-09', confidence: 'HIGH' },
  'infrastructure-broadband': { pct: 83, byParty: { R: 79, D: 87 }, source: 'AP-NORC (IIJA)', asOf: '2021-07', confidence: 'HIGH' },
  'early-childhood': { pct: 74, byParty: { D: 86, R: 61, I: 74 }, source: 'First Five Years Fund / POS', asOf: '2023-07', confidence: 'HIGH' },
  'childcare-tax-credit-gop-alt': { pct: 74, byParty: { D: 86, R: 61, I: 74 }, source: 'rides FFYF/POS childcare number', asOf: '2023-07', confidence: 'MEDIUM', note: 'No poll names the Britt bill; maps to the childcare-assistance question used for early-childhood.' },

  // ── Plank 3 — Making a Living ──
  'paid-family-leave': { pct: 82, byParty: { D: 90, R: 76 }, source: 'BPC / Morning Consult', asOf: '2024', confidence: 'HIGH' },
  'minimum-wage-increase': { pct: 65, oppose: 33, byParty: { D: 90, R: 41, I: 64 }, source: 'Pew / PPC-UMD ($15)', asOf: '2023', confidence: 'HIGH' },
  'team-act-gop-alt': { pct: 65, byParty: { D: 90, R: 41, I: 64 }, source: 'rides the $15 PPC-UMD number', asOf: '2023', confidence: 'MEDIUM', note: 'No poll names the Hawley bill; maps to the $15 minimum-wage question.' },
  'wage-theft-noncompete': { pct: 62, source: 'Ipsos (non-compete ban)', asOf: '2024-05', confidence: 'MEDIUM', note: 'Non-compete proxy (59–66%); wage-theft itself not separately polled.' },
  'loan-rate-cap': { pct: 77, source: 'LendingTree', asOf: '2024', confidence: 'MEDIUM', note: 'Consumer survey, not top-tier pollster; cap level varies (10–36%).' },
  'housing-supply': { pct: 83, source: 'BPC / NHC / Morning Consult', asOf: '2024', confidence: 'HIGH' },
  'road-to-housing-gop-alt': { pct: 83, source: 'rides BPC/NHC/Morning Consult housing-supply number', asOf: '2024', confidence: 'MEDIUM', note: 'No poll names the ROAD package; maps to the build-more-housing question used for housing-supply.' },

  // ── Plank 4 — The Care We Owe ──
  'major-care-vote': { pct: 85, oppose: 14, byParty: { D: 92, R: 77, I: 89 }, source: 'KFF (Medicare drug-price negotiation)', asOf: '2024-09', confidence: 'HIGH' },
  'social-security-solvency': { pct: 85, byParty: { D: 84, R: 83, I: 80 }, source: 'Data for Progress / AP-NORC / Navigator (oppose cuts)', asOf: '2023', confidence: 'HIGH', note: 'Oppose-cuts framing runs 82–92%.' },
  'medicaid-protection': { pct: 76, oppose: 22, byParty: { D: 95, R: 55, I: 79 }, source: 'KFF (oppose major cuts)', asOf: '2025-05', confidence: 'HIGH' },
  'paid-leave-childcare': { pct: 76, byParty: { D: 86, R: 61 }, source: 'FFYF / BPC (childcare + paid leave)', asOf: '2024', confidence: 'HIGH' },
  'new-parents-act-gop-alt': { pct: 76, source: 'sponsor poll; consistent with BPC paid-leave 82%', asOf: '2024', confidence: 'MEDIUM', note: 'GOP tax-credit paid-leave approach; rides broader paid-leave support.' },
  'pact-act': { pct: null, proxyPass: true, source: 'Senate vote 86–11; strong veteran-group backing', asOf: '2022', confidence: 'LOW', note: 'No public-opinion poll found; passed with overwhelming bipartisan legislative consensus. Pass on judgment.' },
  'star-act-gop-alt': { pct: null, proxyPass: true, source: '~316-cosponsor House supermajority (122 R); MOAA + veteran-group backing', asOf: '2026-05', confidence: 'LOW', note: 'No public-opinion poll located for concurrent receipt. Pass on documented judgment, mirroring the pact-act precedent. The 122 GOP House cosponsors are the evidence.' },

  // ── Plank 5 — Peace and Strength ──
  'pentagon-audit': { pct: 83, byParty: { D: 84, R: 82, I: 84 }, source: 'Data for Progress', asOf: '2023-10', confidence: 'HIGH', note: 'Most cross-partisan item in the scorecard.' },
  'war-powers': { pct: 70, oppose: 27, byParty: { D: 91, R: 36, I: 78 }, source: 'Quinnipiac / Marist / Gallup', asOf: '2026-01', confidence: 'HIGH', note: 'Popular overall but the most partisan item; clears the majority gate but is not consensus.' },
  'antitrust-major': { pct: 74, source: 'YouGov / "rein in Apple & Google" framing', asOf: '2023', confidence: 'MEDIUM', note: 'Concept-level ("break up / open markets") polls 74–85%; the specific Open App Markets Act provisions poll ~32%. Kept at the concept level per methodology decision — cite the concept poll, not the bill.' },
  'trade-protections': { pct: 55, source: 'Progressive Policy Institute', asOf: '2023', confidence: 'MEDIUM', note: 'Soft and volatile (~55%); right at the gate. Trade polling is tariff-contaminated.' },
};

/**
 * Does a marker clear the public-support gate?
 *   - proxyPass markers (documented judgment, no poll): included.
 *   - polled markers: included iff pct >= PUBLIC_SUPPORT_GATE.
 *   - unknown markers (no entry) OR null pct without proxyPass: EXCLUDED
 *     (returns false) — they must be substantiated before they score.
 */
export function passesPublicSupportGate(slug: string): boolean {
  const s = PUBLIC_SUPPORT[slug];
  if (!s) return false;
  if (s.proxyPass) return true;
  if (s.pct == null) return false;
  return s.pct >= PUBLIC_SUPPORT_GATE;
}
