/* eslint-disable @typescript-eslint/no-use-before-define */
// Plank classifier (introduced v1.6, current under v1.9.1). Maps roll-call
// votes (via their bill's policy area + subjects + title) onto one or more of
// the 5 Common Ground planks.
//
// Two-stage:
//   1. Rule-based mapping from Congress.gov policy areas → likely planks.
//      For most policy areas, the plank is unambiguous (e.g. Energy → P2,
//      Armed Forces → P5). Returns high confidence when the area maps
//      cleanly and the subjects don't contradict.
//   2. LLM fallback (caller's responsibility) for ambiguous cases: policy
//      areas that map to multiple planks, or where subjects suggest a
//      different plank than the area.
//
// The classifier also returns the *aligned position* — what counts as
// platform-aligned (YES or NO on the vote) given the bill's direction.
// Default heuristic: D-sponsored bills aligned=YES, R-sponsored bills
// aligned=NO (the platform opposes most R-led legislation). Exception
// cases (bipartisan good-government bills, R-led Plank-3 alternatives
// under Option C) are flagged for LLM review.

export type PlankNumber = 1 | 2 | 3 | 4 | 5;
export type AlignedPosition = 'YES' | 'NO' | null;

export interface ClassifyInput {
  policyArea: string | null;
  subjects: string[]; // legislative-subject tags
  title: string;
  sponsorParty: string | null; // 'D' | 'R' | 'I'
  voteQuestion: string; // e.g. "On Passage", "On Motion to Suspend the Rules and Pass"
  voteType: string;
}

export interface Classification {
  plankNumbers: PlankNumber[];
  alignedPosition: AlignedPosition;
  confidence: number; // 0.0-1.0
  reasoning: string;
  needsReview: boolean; // true when confidence < 0.9 or rule-based hit ambiguity
}

// Procedural vote questions we exclude from scoring entirely. These don't
// represent positions on substantive policy.
const PROCEDURAL_QUESTIONS = new Set([
  'On Ordering the Previous Question',
  'On Agreeing to the Resolution', // when paired with procedural rules; needs subject check
  'On Motion to Table',
  'On Motion to Adjourn',
  'On Approving the Journal',
  'On the Speaker',
  'Election of the Speaker',
  'On the Question of Consideration',
]);

// Policy area → plank mapping. High-confidence matches that map cleanly
// to a single plank. Multi-plank areas are listed as arrays and trigger
// subject-level disambiguation.
const POLICY_AREA_TO_PLANKS: Record<string, { planks: PlankNumber[]; confidence: number; note?: string }> = {
  // Plank 1 — Honest Government
  'Government Operations and Politics': { planks: [1], confidence: 0.85, note: 'usually ethics/disclosure/oversight' },

  // Plank 2 — Children Our Future
  Energy: { planks: [2], confidence: 0.95 },
  'Environmental Protection': { planks: [2], confidence: 0.95 },
  Education: { planks: [2], confidence: 0.95 },
  'Science, Technology, Communications': { planks: [2], confidence: 0.85, note: 'mostly research / broadband / STEM' },
  'Public Lands and Natural Resources': { planks: [2], confidence: 0.9 },
  'Water Resources Development': { planks: [2], confidence: 0.9 },
  Animals: { planks: [2], confidence: 0.7, note: 'wildlife / conservation' },
  Agriculture: { planks: [2], confidence: 0.7 },
  'Agriculture and Food': { planks: [2], confidence: 0.7 },

  // Plank 3 — Making a Living
  'Labor and Employment': { planks: [3], confidence: 0.95 },
  Housing: { planks: [3], confidence: 0.95 },
  'Housing and Community Development': { planks: [3], confidence: 0.95 },

  // Plank 4 — The Care We Owe
  'Social Welfare': { planks: [4], confidence: 0.9, note: 'Social Security / welfare' },
  Health: { planks: [4], confidence: 0.95 },
  Families: { planks: [4], confidence: 0.8, note: 'paid leave / childcare AND family planning vary' },

  // Plank 5 — Peace and Strength
  'Armed Forces and National Security': { planks: [5], confidence: 0.85, note: 'sometimes P4 veterans-care overlap' },
  'International Affairs': { planks: [5], confidence: 0.95 },
  'Foreign Trade and International Finance': { planks: [5], confidence: 0.9 },

  // Ambiguous / multi-plank — needs LLM review
  Commerce: { planks: [3, 5], confidence: 0.5, note: 'consumer prot / antitrust split' },
  'Finance and Financial Sector': { planks: [3, 1], confidence: 0.5, note: 'consumer-finance vs corp regulation' },
  Taxation: { planks: [3, 5], confidence: 0.4, note: 'tax policy crosses many planks' },
  'Economics and Public Finance': { planks: [3], confidence: 0.4, note: 'mostly appropriations/CR — often unrelated' },
  Law: { planks: [1], confidence: 0.5, note: 'mixed — civil rights vs judicial-reform vs criminal-justice' },
  'Crime and Law Enforcement': { planks: [1], confidence: 0.4, note: 'often partisan but not Common-Ground-aligned' },
  Immigration: { planks: [], confidence: 0.3, note: 'CG planks do not cover immigration directly' },

  // Procedural / structural — exclude
  Congress: { planks: [], confidence: 0.95, note: 'usually procedural rules' },
  Transportation: { planks: [2], confidence: 0.6, note: 'infrastructure sometimes P2' },
  'Transportation and Public Works': { planks: [2], confidence: 0.6 },

  // Default fallback when policy area unknown / blank
};

// Subject-level overrides that boost specific bills above the policy-area default.
// Most often used to flip ambiguous Commerce / Law / Crime votes into a specific plank.
const SUBJECT_HINTS: Array<{ pattern: RegExp; plank: PlankNumber; reasoning: string }> = [
  // Plank 1: ethics, lobbying, disclosure, voting rights, dark money
  {
    pattern: /stock trad(ing|es)|ethics(?:.*congress)?|insider trading|congressional disclosure/i,
    plank: 1,
    reasoning: 'congressional ethics / stock trading',
  },
  {
    pattern: /campaign finance|public financing of elections|dark money|disclose act|gerryman/i,
    plank: 1,
    reasoning: 'campaign finance reform',
  },
  {
    pattern: /voting rights|election integrity|voter access|polling place|absentee|mail.in voting/i,
    plank: 1,
    reasoning: 'voting rights',
  },
  { pattern: /lobbying.*reform|cooling.?off period|revolving door/i, plank: 1, reasoning: 'lobbying reform' },

  // Plank 2: climate / clean energy / education / research / environment
  {
    pattern: /climate (change|crisis)|greenhouse gas|carbon emission|net zero/i,
    plank: 2,
    reasoning: 'climate policy',
  },
  {
    pattern: /clean energy|renewable energy|solar|wind power|nuclear power|geothermal|battery storage/i,
    plank: 2,
    reasoning: 'clean energy',
  },
  {
    pattern: /chips and science act|nsf|research funding|stem education/i,
    plank: 2,
    reasoning: 'science / research funding',
  },

  // Plank 3: minimum wage / housing / worker protection / paid leave / loans
  {
    pattern: /minimum wage|wage theft|right.to.organize|fair labor standards|workforce mobility/i,
    plank: 3,
    reasoning: 'wage / labor protection',
  },
  {
    pattern: /affordable housing|housing supply|rent(al)?|tenant protection|eviction/i,
    plank: 3,
    reasoning: 'housing',
  },
  { pattern: /paid (family|medical) leave|family.and.medical.insurance/i, plank: 3, reasoning: 'paid leave' },
  {
    pattern: /predatory lending|interest rate cap|usury|payday lending|consumer credit/i,
    plank: 3,
    reasoning: 'predatory lending',
  },

  // Plank 4: medicare/medicaid/veterans/drug pricing/social security
  { pattern: /medicare|medicaid|prescription drug|drug pric/i, plank: 4, reasoning: 'healthcare / drug pricing' },
  { pattern: /social security|retirement security|elderly assistance/i, plank: 4, reasoning: 'Social Security' },
  {
    pattern: /veteran.*benefit|veterans.*health|va.health|toxic exposure|pact act/i,
    plank: 4,
    reasoning: 'veterans benefits',
  },
  { pattern: /childcare|child care|child tax credit|family services/i, plank: 4, reasoning: 'childcare' },

  // Plank 5: war powers / Pentagon audit / antitrust / trade
  {
    pattern: /war powers|aumf|use of military force|withdrawal of (united states )?armed forces/i,
    plank: 5,
    reasoning: 'war powers',
  },
  {
    pattern: /pentagon audit|defense.*audit|department of defense (audit|accountability)/i,
    plank: 5,
    reasoning: 'Pentagon audit',
  },
  { pattern: /antitrust|competition policy|monopoly|merger review/i, plank: 5, reasoning: 'antitrust' },
  { pattern: /state department|foreign service|diplomatic/i, plank: 5, reasoning: 'diplomatic capacity' },
  {
    pattern: /trade agreement|tariff|free trade|usmca|labor (and|standards).*trade/i,
    plank: 5,
    reasoning: 'trade policy',
  },
];

// Vote-question filter — is this a substantive vote we should score on?
// voteType is accepted but currently not used; reserved for future
// disambiguation (e.g., "On Final Passage" voteType is always substantive,
// but "Yea-And-Nay" alone isn't enough to tell).
// eslint-disable-next-line no-unused-vars, @typescript-eslint/no-unused-vars
export function isSubstantiveVote(voteQuestion: string, _voteType: string): boolean {
  const q = voteQuestion.trim();
  if (PROCEDURAL_QUESTIONS.has(q)) return false;
  // "On Agreeing to the Resolution" is procedural when the underlying resolution is a
  // rule for considering a bill. We'd need to check the resolution's text. For v1.6
  // we err on excluding these.
  if (/On (Ordering|Approving|Adjourning)/i.test(q)) return false;
  if (/Election of/i.test(q)) return false;
  // Common substantive vote questions:
  if (
    /On Passage|On Final Passage|On Motion to Suspend the Rules and Pass|On Concurring|On Agreeing to the Conference Report|On Motion to Recommit/i.test(
      q,
    )
  )
    return true;
  // Default: treat as not substantive (conservative)
  return false;
}

// Classify a single vote based on its bill metadata.
export function classifyVote(input: ClassifyInput): Classification {
  // Procedural votes always score "needsReview=false, plankNumbers=[]"
  if (!isSubstantiveVote(input.voteQuestion, input.voteType)) {
    return {
      plankNumbers: [],
      alignedPosition: null,
      confidence: 0.95,
      reasoning: `Procedural vote: ${input.voteQuestion}`,
      needsReview: false,
    };
  }

  // 1. Subject-level keyword check — strongest signal
  for (const hint of SUBJECT_HINTS) {
    const haystack = `${input.title} ${input.subjects.join(' ')}`;
    if (hint.pattern.test(haystack)) {
      const direction = inferAlignedPosition(input.sponsorParty, hint.plank);
      const dirAdj = confidenceAdjustmentForDirection(input.sponsorParty, hint.plank);
      const confidence = 0.95 * dirAdj;
      return {
        plankNumbers: [hint.plank],
        alignedPosition: direction,
        confidence,
        reasoning: `Subject hint: ${hint.reasoning}${dirAdj < 1 ? ' (direction reduced-confidence)' : ''}`,
        needsReview: direction === null || confidence < 0.8,
      };
    }
  }

  // 2. Policy area fallback
  const area = input.policyArea;
  if (!area) {
    return {
      plankNumbers: [],
      alignedPosition: null,
      confidence: 0.3,
      reasoning: 'No policy area on bill — cannot classify without LLM',
      needsReview: true,
    };
  }
  const mapping = POLICY_AREA_TO_PLANKS[area];
  if (!mapping) {
    return {
      plankNumbers: [],
      alignedPosition: null,
      confidence: 0.3,
      reasoning: `Unknown policy area: ${area} — falls through to LLM`,
      needsReview: true,
    };
  }
  if (mapping.planks.length === 0) {
    return {
      plankNumbers: [],
      alignedPosition: null,
      confidence: mapping.confidence,
      reasoning: `Policy area "${area}" doesn't map to any plank${mapping.note ? ` (${mapping.note})` : ''}`,
      needsReview: mapping.confidence < 0.9,
    };
  }
  if (mapping.planks.length === 1) {
    const direction = inferAlignedPosition(input.sponsorParty, mapping.planks[0]);
    const dirAdj = confidenceAdjustmentForDirection(input.sponsorParty, mapping.planks[0]);
    const confidence = mapping.confidence * dirAdj;
    return {
      plankNumbers: [mapping.planks[0]],
      alignedPosition: direction,
      confidence,
      reasoning: `Policy area "${area}" → P${mapping.planks[0]}${mapping.note ? ` (${mapping.note})` : ''}${
        dirAdj < 1 ? ' (direction reduced-confidence)' : ''
      }`,
      needsReview: direction === null || confidence < 0.8,
    };
  }
  // Multi-plank: flag for LLM
  return {
    plankNumbers: mapping.planks,
    alignedPosition: null,
    confidence: mapping.confidence,
    reasoning: `Policy area "${area}" maps to multiple planks (${mapping.planks
      .map((p) => `P${p}`)
      .join(', ')}) — needs LLM disambiguation`,
    needsReview: true,
  };
}

// Infer the aligned position from sponsor party + plank.
//
// Default heuristic for ALL planks: D-sponsored bills aligned=YES (the
// Common Ground platform leans toward Democratic-led legislation on the
// 5 planks); R-sponsored bills aligned=NO (R bills generally cut against
// platform direction). This gets the direction right on the majority of
// floor votes — and accepting it with reduced CONFIDENCE on edge cases
// (P1 bipartisan ethics; P3/P4 Option C R-alternatives) means the
// scoring still works while flagging those rows for human review in
// the admin queue.
//
// Confidence adjustments:
//   - P1 + R-sponsor: confidence multiplier 0.6 (often bipartisan)
//   - P3/P4 + R-sponsor: confidence multiplier 0.6 (Option C possible)
//   - Otherwise: full confidence from policy-area mapping
// eslint-disable-next-line no-unused-vars, @typescript-eslint/no-unused-vars
function inferAlignedPosition(sponsorParty: string | null, _plank: PlankNumber): AlignedPosition {
  if (!sponsorParty || sponsorParty === 'I') return null;
  // D-sponsored → platform-aligned = YES (vote yes on the bill = aligned)
  // R-sponsored → platform-aligned = NO  (vote no on the bill = aligned)
  return sponsorParty === 'D' ? 'YES' : 'NO';
}

// Confidence adjustment for ambiguous (plank, sponsorParty) combos —
// these are correct on average but may misfire on specific bills, so we
// tag them lower-confidence and flag for review.
function confidenceAdjustmentForDirection(sponsorParty: string | null, plank: PlankNumber): number {
  if (!sponsorParty) return 0.7; // unknown sponsor → reduce confidence
  if (plank === 1 && sponsorParty === 'R') return 0.7; // bipartisan ethics possible
  if ((plank === 3 || plank === 4) && sponsorParty === 'R') return 0.7; // Option C possible
  return 1.0;
}
