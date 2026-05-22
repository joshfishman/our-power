// v1.7.2 Track A spike — corporate PAC classification candidates (bulk FEC).
//
// Parses FEC bulk data files (data/fec-bulk-2024/) instead of hitting the API
// pagination, because /committees/ doesn't sort by receipts (returns 422).
//
// Inputs (download once via fec.gov bulk URLs):
//   data/fec-bulk-2024/cm.txt    — committee master (org_type, connected_org)
//   data/fec-bulk-2024/webk24.txt — PAC summary (receipts, contributions)
//
// Output:
//   data/pac-candidates.csv      — top 300 PACs by contributions_to_other_cmtes
//                                  with auto-classification proposal column
//
// FEC organization_type field:
//   C = Corporation                  → corporate
//   T = Trade Association            → corporate (industry)
//   W = Corporation w/o capital stock → corporate
//   M = Membership organization       → ambiguous (lean ideological)
//   L = Labor organization            → labor
//   V = Cooperative                   → ambiguous
//   (blank)                           → use name patterns

import fs from 'fs';
import path from 'path';

// Multi-cycle: union all 4 cycles' PAC universes so we classify any PAC
// that ever showed up in our 8-year window, not just the ones still active
// in 2024. Many older corporate / DARK_MONEY super PACs disappeared after
// their target election but still appear in older itpas2.txt files; we
// want them classified so historic contribution data isn't UNCLASSIFIED.
const CYCLE_BULK_DIRS = [
  path.join(process.cwd(), 'data', 'fec-bulk-2018'),
  path.join(process.cwd(), 'data', 'fec-bulk-2020'),
  path.join(process.cwd(), 'data', 'fec-bulk-2022'),
  path.join(process.cwd(), 'data', 'fec-bulk-2024'),
];
const WEBK_BY_CYCLE = [
  { dir: path.join(process.cwd(), 'data', 'fec-bulk-2018'), webk: 'webk18.txt' },
  { dir: path.join(process.cwd(), 'data', 'fec-bulk-2020'), webk: 'webk20.txt' },
  { dir: path.join(process.cwd(), 'data', 'fec-bulk-2022'), webk: 'webk22.txt' },
  { dir: path.join(process.cwd(), 'data', 'fec-bulk-2024'), webk: 'webk24.txt' },
];

// Process ALL non-party PACs (no top-N limit) so we have complete coverage
// for any future per-leg score audit. The LLM classifier can chew through
// the ~11K rows in ~45 min at $0.003 per call.
const TOP_N = 100_000;

// webk24.txt schema (pipe-delimited, no header)
// idx 0:  CMTE_ID
// idx 1:  CMTE_NM
// idx 2:  CMTE_TP                  (Q/N = direct PAC; O/V/W/I/E/U = Super/Hybrid)
// idx 5:  TTL_RECEIPTS             (total fundraised)
// idx 22: CONTRIB_TO_OTHER_CMTE    (direct candidate contributions — Q/N path)
// idx 23: IND_EXP                  (independent expenditures — Super PAC path)
const WEBK_CMTE_ID = 0;
const WEBK_CMTE_NM = 1;
const WEBK_CMTE_TP = 2;
const WEBK_TTL_RECEIPTS = 5;
const WEBK_CONTRIB_TO_OTHER = 22;
const WEBK_IND_EXP = 23;

// Committee types we classify:
//   Q = Qualified non-party PAC (corporate, labor, etc.)
//   N = Non-qualified non-party PAC
//   O = Independent expenditure-only (Super PAC)
//   I = Independent expenditure-only PAC (hybrid pre-CU)
//   V = Hybrid PAC (with Non-Contribution Account)
//   W = Hybrid PAC (with Non-Contribution Account, Nonqualified)
//   U = Single-candidate independent expenditure
//   E = Independent expenditure filer (entity)
// Skipped: X/Y (party), H/S/P (candidates), C (communication cost), D (delegate)
const CLASSIFY_TYPES = new Set(['Q', 'N', 'O', 'I', 'V', 'W', 'U', 'E']);

// cm.txt schema (pipe-delimited, no header)
// idx 0:  CMTE_ID
// idx 1:  CMTE_NM
// idx 9:  CMTE_DSGN
// idx 10: CMTE_TP
// idx 12: ORG_TP
// idx 13: CONNECTED_ORG_NM
const CM_CMTE_ID = 0;
const CM_ORG_TP = 12;
const CM_CONNECTED_ORG = 13;

interface PacRow {
  committee_id: string;
  name: string;
  committee_type: string;
  total_receipts: number;
  contribs_to_others: number;
  ind_exp: number;
  /** Sort key: max(contribs_to_others, ind_exp) — captures both paths. */
  influence_volume: number;
  org_type: string;
  connected_org: string;
}

function parsePipe(line: string): string[] {
  return line.split('|');
}

function loadCmIndex(): Map<string, { org_type: string; connected_org: string }> {
  // Union all 4 cycles' committee master files. Most recent wins on conflict
  // since committee metadata can change (org_type re-filing, sponsor name
  // updates). Iterate older→newer so newer values overwrite.
  const map = new Map<string, { org_type: string; connected_org: string }>();
  for (const dir of CYCLE_BULK_DIRS) {
    const cmPath = path.join(dir, 'cm.txt');
    if (!fs.existsSync(cmPath)) continue;
    const text = fs.readFileSync(cmPath, 'utf-8');
    for (const line of text.split('\n')) {
      if (!line) continue;
      const cols = parsePipe(line);
      const id = cols[CM_CMTE_ID];
      if (!id) continue;
      map.set(id, {
        org_type: (cols[CM_ORG_TP] ?? '').trim(),
        connected_org: (cols[CM_CONNECTED_ORG] ?? '').trim(),
      });
    }
  }
  return map;
}

function loadPacRows(cmIndex: Map<string, { org_type: string; connected_org: string }>): PacRow[] {
  // Union across all 4 cycles. Per-PAC aggregates use the MAX of each cycle's
  // receipts/contribs/IE (a PAC that spent $20M in 2020 + $1M in 2024 should
  // be ranked by the $20M peak, not the latest). Most-recent cycle's metadata
  // wins for cmtype if the PAC ever changed type.
  const merged = new Map<string, PacRow>();
  for (const { dir, webk } of WEBK_BY_CYCLE) {
    const webkPath = path.join(dir, webk);
    if (!fs.existsSync(webkPath)) continue;
    const text = fs.readFileSync(webkPath, 'utf-8');
    for (const line of text.split('\n')) {
      if (!line) continue;
      const cols = parsePipe(line);
      const id = cols[WEBK_CMTE_ID];
      if (!id) continue;
      const cmtype = (cols[WEBK_CMTE_TP] ?? '').trim();
      if (!CLASSIFY_TYPES.has(cmtype)) continue;
      const cm = cmIndex.get(id) ?? { org_type: '', connected_org: '' };
      const contribs = Number(cols[WEBK_CONTRIB_TO_OTHER] ?? 0);
      const indExp = Number(cols[WEBK_IND_EXP] ?? 0);
      const receipts = Number(cols[WEBK_TTL_RECEIPTS] ?? 0);
      const existing = merged.get(id);
      if (existing) {
        existing.total_receipts = Math.max(existing.total_receipts, receipts);
        existing.contribs_to_others = Math.max(existing.contribs_to_others, contribs);
        existing.ind_exp = Math.max(existing.ind_exp, indExp);
        existing.influence_volume = Math.max(existing.contribs_to_others, existing.ind_exp);
        // Most-recent committee_type wins
        existing.committee_type = cmtype;
      } else {
        merged.set(id, {
          committee_id: id,
          name: cols[WEBK_CMTE_NM] ?? '',
          committee_type: cmtype,
          total_receipts: receipts,
          contribs_to_others: contribs,
          ind_exp: indExp,
          influence_volume: Math.max(contribs, indExp),
          org_type: cm.org_type,
          connected_org: cm.connected_org,
        });
      }
    }
  }
  return [...merged.values()];
}

// Explicit overrides by FEC committee_id. These are reviewed-by-human
// decisions that beat the heuristic. Each entry must have a one-line
// rationale so the methodology stays auditable.
const COMMITTEE_OVERRIDES: Record<string, { class: string; reason: string }> = {
  // NRA — user's explicit call: NRA stays as DARK_MONEY (industry+extremist),
  // even though parallel gun-debate PACs are ACTIVIST. Asymmetric but
  // documented user direction.
  C00053553: { class: 'DARK_MONEY', reason: 'NRA Political Victory Fund — industry+extremist (user override)' },

  // ACTIVIST — issue-cause-based advocacy. These advance a specific policy
  // commitment (gun safety, climate, women's representation, abortion both
  // sides) rather than just trying to swing elections for a party. They
  // don't count against the legislator's PAC score, BUT we expose them in
  // a per-issue scoreboard so readers can see who takes money from cause
  // PACs they care about.
  C00688655: { class: 'ACTIVIST', reason: 'Everytown Victory Fund — gun safety advocacy' },
  C00540443: { class: 'ACTIVIST', reason: 'Giffords PAC — gun safety advocacy' },
  C00473918: { class: 'ACTIVIST', reason: "Women Vote — women's representation advocacy (EMILY List arm)" },
  C00486845: { class: 'ACTIVIST', reason: 'LCV Victory Fund — League of Conservation Voters (climate)' },
  C00817536: { class: 'ACTIVIST', reason: 'Climate Power Action — climate advocacy' },

  // Generic-patriotic-named billionaire-funded SWING super PACs (no specific
  // cause, just elect their team). These stay DARK_MONEY.
  C00796045: { class: 'DARK_MONEY', reason: 'Truth and Courage PAC — Vance-aligned billionaire swing PAC' },
  C00741769: { class: 'DARK_MONEY', reason: 'Strategic Victory Fund IE PAC — dark-money swing' },
  C00821439: { class: 'DARK_MONEY', reason: 'American Values 2024 — RFK Jr / Tim Mellon $50M swing' },

  // RJC Victory Fund is the Republican Jewish Coalition's super PAC arm —
  // same org as the main RJC PAC we classify as FOREIGN_POLICY.
  C00528554: { class: 'FOREIGN_POLICY', reason: 'RJC Victory Fund — RJC super PAC arm' },

  // ─── v1.7.1 sleeper-sweep cleanup (user review of doesn't-count bucket) ───
  //
  // Methodology principle (user direction): funding source, not party.
  // Progressive grassroots small-dollar orgs (Justice Dems, Swing Left,
  // Progressive Turnout, Vote Save America, etc.) STAY in IDEOLOGICAL.
  // Vague-patriotic billionaire-funded R PACs move to DARK_MONEY.
  // Union arms misclassified as IDEOLOGICAL move to LABOR.
  // Single-issue cause advocacy misclassified as LEADERSHIP/IDEOLOGICAL
  // moves to ACTIVIST. Industry trade group misclassified as LEADERSHIP
  // moves to CORPORATE.

  // LABOR — union arms mis-tagged as IDEOLOGICAL
  C00488486: { class: 'LABOR', reason: 'CWA Working Voices — CWA union arm' },
  C00490375: { class: 'LABOR', reason: 'National Nurses United for Patient Protection — nurses union' },
  C00754051: { class: 'LABOR', reason: 'Workers Vote — labor mobilization' },

  // ACTIVIST — single-issue cause advocacy mis-tagged elsewhere
  C00860155: { class: 'ACTIVIST', reason: 'Montana Outdoor Values Action Fund — conservation' },
  C00493262: { class: 'ACTIVIST', reason: 'Montana Hunters and Anglers — conservation' },
  C00826263: { class: 'ACTIVIST', reason: 'Hispanic Leadership Alliance — demographic mobilization' },
  C00633248: { class: 'ACTIVIST', reason: '314 Action Fund — recruiting scientists to run' },
  C00685297: { class: 'ACTIVIST', reason: "Elect Democratic Women — women's representation" },
  C00817122: { class: 'ACTIVIST', reason: 'GOA Victory Fund — Gun Owners of America (parallel to Everytown)' },
  C00868679: { class: 'ACTIVIST', reason: 'Americans for Contraception — reproductive rights' },

  // CORPORATE — industry trade group mis-tagged as LEADERSHIP
  C00023028: { class: 'CORPORATE', reason: 'National Cotton Council — cotton industry trade' },

  // DARK_MONEY — vague-patriotic billionaire-funded swing PACs (R-aligned)
  // mis-tagged as IDEOLOGICAL. House Freedom orgs are Mercer/Heritage-network
  // funded; American Revival + Great American Comeback are generic-patriotic
  // swing super PACs; RSLC is the party-aligned state operation.
  C00662221: { class: 'DARK_MONEY', reason: 'House Freedom Action — billionaire-funded R primary ops' },
  C00552851: { class: 'DARK_MONEY', reason: 'House Freedom Fund — billionaire-funded R primary ops' },
  C00639229: { class: 'DARK_MONEY', reason: 'American Revival PAC — vague-patriotic R swing' },
  C00841148: { class: 'DARK_MONEY', reason: 'Great American Comeback — vague-patriotic R swing' },
  C00779595: { class: 'DARK_MONEY', reason: 'RSLC PAC — Republican State Leadership Committee' },

  // From IE-supporting-Kim audit (2024 Senate race):
  C00871079: { class: 'DARK_MONEY', reason: 'Leadership with Integrity PAC — billionaire-funded Kim super PAC' },
  C90022500: { class: 'DARK_MONEY', reason: 'Working New Jersey — Reid Hoffman-aligned NJ super PAC' },
  C00679316: { class: 'DARK_MONEY', reason: 'Committee to Build the Economy — Hoffman vehicle' },
  C00831404: { class: 'ACTIVIST', reason: 'With Honor Fund II — veterans-in-office advocacy' },
  C00689745: { class: 'ACTIVIST', reason: 'Make the Road Action — immigrant rights' },
  C00678839: { class: 'IDEOLOGICAL', reason: 'Indivisible Action — grassroots progressive' },
};

function autoClassify(c: PacRow): { proposed: string; reason: string } {
  // 1. Explicit committee_id overrides take precedence over all heuristics.
  const override = COMMITTEE_OVERRIDES[c.committee_id];
  if (override) return { proposed: override.class, reason: `override: ${override.reason}` };

  const orgType = c.org_type;
  const name = c.name.toUpperCase();
  const sponsor = c.connected_org.toUpperCase();
  const blob = `${name} | ${sponsor}`;

  // Leadership PACs — politicians' personal PACs that bundle/distribute to
  // other candidates. Not corporate, not labor — intra-political transfer.
  // We check this FIRST so a leadership PAC sponsored by a corporate-named
  // person doesn't get mis-tagged.
  // Order matters here. Run in this sequence:
  //   1. CONDUIT (ActBlue / WinRed — exclude from scoring entirely)
  //   2. FOREIGN_POLICY (AIPAC etc. — counts against)
  //   3. DARK_MONEY (Super PACs with billionaire-network funding — counts against)
  //   4. LEADERSHIP (politician personal PACs — doesn't count)
  //   5. org_type-based CORPORATE / LABOR
  //   6. Name-pattern CORPORATE / IDEOLOGICAL fallback
  //
  // FP/DM run before LEADERSHIP because some dark-money super PACs have names
  // that loosely match leadership patterns (e.g. "Victory Committee" in
  // connected_org). FP/DM is the more specific signal.

  // Conduit committees (ActBlue, WinRed) — neither a donor nor a corruption
  // signal; they pass through individual donations. Exclude from classification
  // entirely so they don't dilute the ratio numerator or denominator.
  if (/^ACTBLUE$/.test(name) || /^WINRED$/.test(name)) {
    return { proposed: 'CONDUIT', reason: 'donor-conduit committee, not a real PAC' };
  }

  // Foreign-policy advocacy PACs — domiciled in US, funded by US individuals,
  // but their entire purpose is shaping US foreign policy on a single country/
  // region issue. They spend massively to primary legislators who dissent from
  // their position (AIPAC defeated Bowman/Bush in 2024). Counts against the
  // legislator's PAC score AND gets its own scoreboard for transparency.
  const foreignPolicyPatterns = [
    /\bAIPAC\b/,
    /AMERICAN ISRAEL/,
    /\bNORPAC\b/,
    /J ?STREET/,
    /JSTREETPAC/,
    /REPUBLICAN JEWISH/,
    /DEMOCRATIC MAJORITY FOR ISRAEL/,
    /\bDMFI\b/,
    /PRO-ISRAEL AMERICA/,
    /UNITED DEMOCRACY PROJECT/,
    /\bUDP\b PAC/,
    /TURKISH AMERICAN/,
    /HELLENIC AMERICAN/,
    /INDIAN AMERICAN POLITICAL/,
    /TAIWANESE AMERICAN/,
    /CUBAN AMERICAN.*POLITICAL/,
    /KOREAN AMERICAN.*POLITICAL/,
    /ARMENIAN ASSEMBLY/,
    /\bANCA\b/,
    /VIETNAMESE AMERICAN.*POLITICAL/,
  ];
  for (const p of foreignPolicyPatterns) {
    if (p.test(blob)) return { proposed: 'FOREIGN_POLICY', reason: `/${p.source}/` };
  }

  // Dark-money-funded partisan ideological super PACs. Distinct from grassroots
  // ideological (Sierra Club, NARAL — funded by small-dollar individuals) in
  // that these draw heavily from billionaire networks and 501(c)(4)
  // pass-throughs that don't disclose donors. Public reporting from OpenSecrets,
  // Center for Public Integrity, Sludge documents these networks. Counts
  // against the legislator.
  const darkMoneyPatterns = [
    // Republican-aligned dark-money super PACs
    /SENATE CONSERVATIVES FUND/,
    /CLUB FOR GROWTH/,
    /\bCFG\b/,
    /AMERICAN CROSSROADS/,
    /CROSSROADS GPS/,
    /ONE NATION/,
    /AMERICAN ACTION NETWORK/,
    /\bAAN\b/,
    /CONGRESSIONAL LEADERSHIP FUND/,
    /\bCLF\b/,
    /SENATE LEADERSHIP FUND/,
    /\bSLF\b PAC/,
    /\bSLF\b/,
    /FREEDOMWORKS FOR AMERICA/,
    /\bFWA\b PAC/,
    /MAKE AMERICA GREAT AGAIN/,
    /AMERICA FIRST POLICIES/,
    /MAGA INC/,
    /PRESERVE AMERICA PAC/,
    /WIN IT BACK PAC/,
    /KEYSTONE RENEWAL/,
    /RESTORATION PAC/,
    /RIGHT FOR AMERICA/,
    /AMERICA PAC/,
    /LAST BEST PLACE/,
    /HEROES PAC/,
    /JOBS NOT MOBS/,
    /BUILD THE WALL/,
    /\bAFP ACTION\b/,
    /MAINSTREAM REPUBLICANS/,
    /WINNING FOR WOMEN/,
    /\bWFW\b PAC/,
    /NEVER BACK DOWN/,
    /AMERICANS FOR PROSPERITY/,
    /HONOR PAC/,
    // Democratic-aligned dark-money super PACs
    /SENATE MAJORITY PAC/,
    /\bSMP\b/,
    /HOUSE MAJORITY PAC/,
    /\bHMP\b/,
    /MAJORITY FORWARD/,
    /AMERICAN BRIDGE/,
    /\bAB PAC\b/,
    /PRIORITIES USA/,
    /WINSENATE/,
    /WINHOUSE/,
    /\bWFP\b PAC/,
    /WORKING FAMILIES PARTY/,
    /FUTURE FORWARD/,
    /\bFF PAC\b/,
    /DEMOCRACY PAC/,
    /PROTECT PROGRESS/,
    /SIXTEEN THIRTY/,
    /\b1630 FUND/,
    /REPUBLICAN ACCOUNTABILITY PAC/,
    /CONGRESSIONAL FREEDOM/,
    /WITH HONOR FUND/,
    // State-focused / single-issue right-aligned dark-money super PACs
    /BUCKEYE VALUES/,
    /SENTINEL ACTION FUND/,
    /TRUST IN THE MISSION/,
    /FIX WASHINGTON/,
    /RETIRE CAREER POLITICIAN/,
    /OPPORTUNITY MATTERS FUND/,
    /STANDING STRONG PAC/,
    /\bSTAND FOR\b.*\bAMERICA\b/,
    /AMERICAN PATRIOTS/,
    /ONE FOR ALL COMMITTEE/,
    /YOUR COMMUNITY PAC/,
    // Left-aligned dark-money / 501(c)(4) PACs
    /FOR OUR FUTURE/,
    /AMERICA VOTES/,
    /CITIZENS FOR RESPONSIBILITY/,
    /MARYLAND'S FUTURE/,
    /\bRBG PAC\b/,
  ];
  for (const p of darkMoneyPatterns) {
    if (p.test(blob)) return { proposed: 'DARK_MONEY', reason: `/${p.source}/` };
  }

  // Tighter LEADERSHIP detection: the "VICTORY FUND" pattern was over-firing
  // on ideological orgs like LCV Victory Fund, NRA Political Victory Fund,
  // Everytown Victory Fund. We now require that either:
  //   (a) the PAC's NAME contains a politician-leadership cue, OR
  //   (b) the connected_org is a politician's candidate committee
  // — not just any "VICTORY FUND" / "VICTORY COMMITTEE" string. PACs that
  // bear an organization's name (LCV, NRA, EVERYTOWN, RJC) get handled by
  // the foreign-policy / dark-money / ideological branches above.
  const isOrgNamedPac =
    /\b(LCV|NRA|EVERYTOWN|RJC|EDF|LEAGUE|SIERRA|NARAL|PLANNED PARENTHOOD|RIFLE|GIFFORDS|AIPAC|J STREET)\b/.test(name);
  if (isOrgNamedPac) {
    // Fall through to ideological / foreign-policy branches below — don't
    // claim as LEADERSHIP just because the connected_org has "Victory Fund".
  } else {
    const leadershipPatterns = [
      // Connected-org references to a named politician (most reliable signal)
      // — leadership PACs are required to disclose the sponsoring politician's
      // committee in the connected_organization_name field.
      /\bTEAM [A-Z]+/,
      /\bELECT [A-Z]+/,
      /VICTORY (FUND|COMMITTEE)/,
      /VICTORY PAC/,
      /\bFOR (CONGRESS|SENATE|PRESIDENT)\b/,
      /\bELECT DIVERSE/,
      /COLE COMBINED COMMITTEE/,
      /COMMANDER ZINKE/,
      /CRAPO\b/,
      /BOOZMAN/,
      /MCHENRY/,
      /HUDSON/,
      /\bSCOTT\b/,
      /RICKETTS/,
      /\bCOLE\b/,
      // Final four generics — all confirmed leadership PACs:
      // PURPOSE PAC (Mark Pocan), IN THE ARENA PAC (Joni Ernst's catchphrase),
      // LETS GET TO WORK PAC (Rick Scott's gubernatorial-era PAC), SPIKE PAC (Mike Lee)
      /^PURPOSE PAC\b/,
      /IN THE ARENA PAC/,
      /LETS GET TO WORK PAC/,
      /^SPIKE PAC\b/,
      /PROTECT FREEDOM/, // Rand Paul-aligned
      // Common leadership-PAC name shapes
      /PAC TO THE/,
      /\bMAJORITY (COMMITTEE|MAKERS|FUND)\b/,
      /\bMINORITY (LEADER|MAKERS)\b/,
      /LEADERSHIP COUNCIL/,
      /\bHOLDING OUR MAJORITY/,
      /COMMITTEE FOR THE/,
      /AMERIPAC/,
      /EYE OF THE TIGER/,
      /HUCK PAC/,
      /\bE-PAC\b/,
      /COMMON VALUES PAC/,
      /STAND FOR AMERICA/,
      /CA LUV PAC/,
      /MR\. SOUTHERN MISSOURIAN/,
      /FAIR SHOT/,
      /NEW DEMOCRAT COALITION ACTION/,
      /BLUE DOG PAC/,
      /WINDEM/,
      /\bWIN ?DEM\b/,
      /\bPATRIOTS PAC\b/,
      /COURAGE PAC/,
      /RESTORE OUR FUTURE/,
      /MAINSTREET PARTNERSHIP/,
      /BUCHANAN AND SCALISE/,
      /CAUCUS PAC/,
      /VICTORY 2024/,
      /VICTORY 2026/,
      /TRUMAN.*INITIATIVE/,
      /\bDEMS\b.*\bFUND\b/,
      /TOGETHER\b.*\bMAJORITY/,
      /NC RED/,
      /TEAM STAND FOR AMERICA/,
      /DAVIDS NEW DEMS/,
      /AGUILAR/,
      /PELOSI/,
      /HOYER/,
      /MCCARTHY/,
      /SCALISE/,
      /MCCONNELL/,
      /SCHUMER/,
      /JEFFRIES/,
      /CLARK\b/,
      /EMMER/,
      /STEFANIK/,
      /BARRASSO/,
      /THUNE\b/,
      /JOHN BOOZMAN/,
      /\bELISE\b/,
      /HAKEEM/,
      /\bHAWLEY\b/,
      /\bWARREN\b/,
    ];
    for (const p of leadershipPatterns) {
      if (p.test(blob)) return { proposed: 'LEADERSHIP', reason: `/${p.source}/` };
    }
  } // end !isOrgNamedPac

  if (orgType === 'C' || orgType === 'W') return { proposed: 'CORPORATE', reason: `org_type=${orgType} (Corporation)` };
  if (orgType === 'T') return { proposed: 'CORPORATE', reason: 'org_type=T (Trade Association)' };
  if (orgType === 'L') return { proposed: 'LABOR', reason: 'org_type=L (Labor)' };
  // org_type=M (Membership) is ambiguous — Realtors/Insurance/Bankers/etc. are
  // trade-aligned even though they file as membership orgs. Fall through to
  // name patterns to disambiguate.

  const laborPatterns = [
    /AFL-?CIO/,
    /\bUNION\b/,
    /TEAMSTER/,
    /\bUAW\b/,
    /UFCW/,
    /\bSEIU\b/,
    /AFSCME/,
    /\bIBEW\b/,
    /PLUMBER/,
    /CARPENTER/,
    /MACHINIST/,
    /STEELWORKER/,
    /COMMUNICATION WORKERS/,
    /UNITE HERE/,
    /\bNEA\b/,
    /AMERICAN FEDERATION/,
    /BUILDING TRADES/,
    /LABORERS/,
    /TRADES COUNCIL/,
    /COPE\b/,
    /BOILERMAKER/,
    /TRANSPORT WORKERS/,
    /SHEET METAL/,
    /OPERATING ENGINEERS/,
    /ELECTRICAL WORKERS/,
    /ROOFERS/,
    /BRICKLAYER/,
    /FIRE FIGHTERS/,
    /POLICE OFFICERS/,
    /POSTAL WORKERS/,
    /LETTER CARRIERS/,
    /\bAFA\b/,
    /\bAPWU\b/,
    /\bNALC\b/,
    /WORKING FAMILIES/,
    /SHIPYARD/,
    /UNITED STEEL/,
  ];
  for (const p of laborPatterns) if (p.test(blob)) return { proposed: 'LABOR', reason: `/${p.source}/` };

  // ACTIVIST — single-issue cause advocacy. Doesn't count against (legitimate
  // citizen engagement on issues) but tracked separately in the per-issue
  // scoreboard so readers can see who takes which advocacy money. Run BEFORE
  // ideological so issue-specific PACs route here cleanly.
  const activistPatterns = [
    // Gun safety / gun rights
    /EVERYTOWN/,
    /MOMS DEMAND/,
    /\bBRADY\b/,
    /GIFFORDS/,
    /GUN OWNERS/,
    /GUN RIGHTS/,
    // Climate / environment
    /SIERRA CLUB/,
    /\bLCV\b/,
    /LEAGUE OF CONSERVATION VOTERS/,
    /\bEDF ACTION/,
    /\bEDF VOTES/,
    /\bNRDC\b/,
    /CLIMATE POWER/,
    /CLIMATE\b.*\bACTION/,
    /SUNRISE/,
    /SAVE THE EARTH/,
    // Reproductive rights (both sides)
    /NARAL/,
    /PLANNED PARENTHOOD/,
    /WOMEN VOTE/,
    /SUSAN B ANTHONY/,
    /WOMEN SPEAK OUT/,
    /\bEMILY'?S LIST/,
    /WOMEN'S POLITICAL/,
    /WOMEN'S CAUCUS/,
    /WOMEN'S DEFENSE LEAGUE/,
    // Civil rights / LGBTQ+
    /EQUALITY PAC/,
    /HUMAN RIGHTS CAMPAIGN/,
    /\bHRC\b PAC/,
    /\bACLU\b/,
    /LAMBDA LEGAL/,
    /GAY.*LESBIAN/,
    /\bLGBT\b/,
    // Demographic mobilization
    /\bBLACKPAC\b/,
    /BLACK VOTERS MATTER/,
    /SOMOS PAC/,
    /LATINO VICTORY/,
    /AAPI VICTORY/,
    /ASIAN AMERICAN POWER/,
    /HARRIETT TUBMAN/,
    /SISTERLOVE/,
    /\bNHA ACTION\b/,
    /CARE IN ACTION/,
    // Voting rights / democracy advocacy
    /END CITIZENS UNITED/,
    /COMMON CAUSE/,
    /DEMAND JUSTICE/,
    /CITIZENS FOR ETHICS/,
    /STAND UP REPUBLIC/,
    /REPRESENT US/,
    /ISSUE ONE/,
    /UNITE AMERICA/,
    // Veterans advocacy
    /VOTEVETS/,
    /VOTE VETS/,
    /COMMON DEFENSE/,
    /COUNCIL FOR A LIVABLE WORLD/,
    /WITH HONOR/,
    /SERVE AMERICA MOVEMENT/,
    // Other single-issue advocacy
    /STUDENT BORROWER/,
    /COLOR OF CHANGE/,
    /INDIVISIBLE/,
    /MOVEON/,
    /MOVE ?ON/,
  ];
  for (const p of activistPatterns) {
    if (p.test(blob)) return { proposed: 'ACTIVIST', reason: `/${p.source}/` };
  }

  const ideologicalPatterns = [
    // Grassroots-funded BROAD partisan/values PACs (not single-issue). The
    // single-issue advocacy moved to ACTIVIST above. Foreign-policy + dark-
    // money are their own classes (count against). This bucket is the broad
    // partisan stance grassroots PACs.
    /STOP MAGA/,
    /DEMOCRATIC VOTERS/,
    /DEMOCRATIC ELECTION FUND/,
    /DEMOCRATS UNITED/,
    /ELECT DEMOCRATIC/,
    /AMERICAN REVIVAL/,
    /GREAT AMERICAN COMEBACK/,
    /VOTE SAVE AMERICA/,
    /BULLDOG PAC/,
    /BUILDING BRIDGES/,
    /HOUSE FREEDOM/,
    /CONGRESSIONAL PROGRESSIVE/,
    /BLUE DOG/,
    /CHC BOLD PAC/,
    /MAINSTREET PARTNERSHIP/,
    /WORKERS VOTE/,
    /WORKING VOICES/,
    /NURSES UNITED/,
    /\bACLU\b/,
    /NRA\b/,
    /\bGOA\b/,
    /\bAIPAC\b/,
    /J STREET/,
    /SUNRISE/,
    /CLIMATE/,
    /\bENVIRONMENT/,
    /HUMAN RIGHTS/,
    /CIVIL RIGHTS/,
    /GUN OWNERS/,
    /GUN RIGHTS/,
    /CHRISTIAN COALITION/,
    /FAMILY RESEARCH/,
    /HERITAGE\b/,
    /CLUB FOR GROWTH/,
    /AMERICANS FOR PROSPERITY/,
    /WINNING FOR WOMEN/,
    /VOTEVETS/,
    /VOTE VETS/,
    /COMMON DEFENSE/,
    /COUNCIL FOR A LIVABLE WORLD/,
    /INDIVISIBLE/,
    /SWING LEFT/,
    /\bBRADY\b/,
    /EVERYTOWN/,
    /MOMS DEMAND/,
    /\bJ-PAC\b/,
    /SAVE DEMOCRACY/,
    /END CITIZENS UNITED/,
    /STAND UP/,
    /MAINSTREET PARTNERSHIP/,
    /\bPDA\b/,
    /BLACK LIVES/,
    /HUMAN RIGHTS CAMPAIGN/,
    /AMNESTY/,
    /\bFREEDOMWORKS\b/,
    /DEMOCRATIC GOVERNORS/,
    /REPUBLICAN GOVERNORS/,
    /DCCC/,
    /NRCC/,
    /DSCC/,
    /NRSC/,
    /DLCC/,
    /RSLC/,
    /AMERICAN BRIDGE/,
    /MAJORITY FORWARD/,
    /CITIZENS FOR/,
    /PROTECT OUR/,
    /AMERICAN VALUES/,
    /CHARGED UP/,
    /NEXT WAVE/,
    /HIGHER GROUND/,
    /\bAIRPAC\b/,
    /\bWFP\b/,
    /WORKING FAMILIES PARTY/,
  ];
  for (const p of ideologicalPatterns) if (p.test(blob)) return { proposed: 'IDEOLOGICAL', reason: `/${p.source}/` };

  const corporatePatterns = [
    // Accounting / consulting / professional services firms
    /DELOITTE/,
    /ERNST.*YOUNG/,
    /\bEY\b PAC/,
    /KPMG/,
    /PWC\b/,
    /PRICEWATERHOUSE/,
    /MCKINSEY/,
    /ACCENTURE/,
    /BOOZ ALLEN/,
    /CERTIFIED PUBLIC ACCOUNTANT/,
    /\bAICPA\b/,
    /\bRSM\b/,
    /BAKER TILLY/,
    /GRANT THORNTON/,
    /BDO\b/,
    // Law / lobbying firms
    /HOLLAND.*KNIGHT/,
    /AKIN GUMP/,
    /\bLLP\b/,
    /\bLLC\b/,
    /\bPLLC\b/,
    /\b(BAKER|JONES DAY|SIDLEY|LATHAM|KIRKLAND|SKADDEN|GIBSON DUNN|ARNOLD.*PORTER|HOGAN LOVELLS|MAYER BROWN|MORGAN LEWIS|GREENBERG TRAURIG|DLA PIPER|REED SMITH|VINSON.*ELKINS|VENABLE|COVINGTON|WILMERHALE|ORRICK|FOLEY.*LARDNER|WHITE.*CASE)\b/,
    // Medical / specialty physician trade groups (operate as corporate lobby)
    /AMERICAN ACADEMY OF/,
    /AMERICAN COLLEGE OF/,
    /AMERICAN SOCIETY OF/,
    /EMERGENCY PHYSICIAN/,
    /FAMILY PHYSICIAN/,
    /PEDIATRICIAN/,
    /SURGEON/,
    /\bNFIB\b/,
    /NATIONAL FEDERATION OF INDEPENDENT BUSINESS/,
    /\bPOET PAC\b/, // Poet Industries ethanol producer
    /\bGRIDIRON\b/, // Outdoor industry trade
    /\bAKIN GUMP\b/,
    // Crypto / fintech industry super PACs (2024 cycle dominated by these)
    /FAIRSHAKE/,
    /DEFEND AMERICAN JOBS/,
    /PROTECT PROGRESS/,
    /CRYPTO/,
    /BLOCKCHAIN/,
    /CFFE PAC/, // Citizens for Free Enterprise — corporate dark money
    // Industry trade-association patterns (file as org_type=M but function as corporate lobby)
    /REALTOR/,
    /\bNAR\b/,
    /HOMEBUILDER/,
    /INSURANCE AGENTS/,
    /INSURANCE BROKERS/,
    /\bBANKERS ASSOCIATION/,
    /MORTGAGE BANKERS/,
    /CREDIT UNION/,
    /AUTO DEALERS/,
    /RESTAURANT ASSOCIATION/,
    /HOSPITAL ASSOCIATION/,
    /CHIROPRACTIC/,
    /DENTAL ASSOCIATION/,
    /MEDICAL ASSOCIATION/,
    /TRIAL LAWYERS/,
    /\bATLA\b/,
    /OPTOMETRIC/,
    /\bAAFP\b/,
    /BROADCASTERS/,
    /CABLE.*TELECOMMUNICATIONS/,
    /WIRELESS ASSOCIATION/,
    /TELEPHONE COOPERATIVE/,
    /BEER WHOLESALERS/,
    /WINE.*SPIRITS/,
    /FOOD INDUSTRY/,
    /GROCERS ASSOCIATION/,
    /CONVENIENCE STORES/,
    /TRUCKING ASSOCIATION/,
    /AIRLINES.*PILOTS/,
    /AIRPORTS COUNCIL/,
    /CONTRACTORS/,
    /ROOFING/,
    /HOME FURNISHINGS/,
    /MANUFACTURED HOUSING/,
    /APARTMENT/,
    /CORN GROWERS/,
    /COTTON COUNCIL/,
    /FARM BUREAU/,
    /DAIRY/,
    /CATTLEMEN/,
    /WHEAT GROWERS/,
    /SOYBEAN/,
    /SUGAR CANE/,
    /POULTRY/,
    /\bNCBA\b/,
    /AGRIBUSINESS/,
    /CROPLIFE/,
    /CHEMISTRY COUNCIL/,
    /PETROLEUM/,
    /OIL.*GAS/,
    /COAL\b/,
    /ELECTRIC COOPERATIVE/,
    /UTILITY/,
    /NUCLEAR ENERGY/,
    /POWER GENERATION/,
    /GAS ASSOCIATION/,
    /PROPANE/,
    /AEROSPACE INDUSTRIES/,
    /SECURITIES INDUSTRY/,
    /FUTURES INDUSTRY/,
    /VENTURE CAPITAL/,
    /INVESTMENT COMPANY INSTITUTE/,
    /\bICI\b PAC/,
    /HEDGE FUND/,
    /PRIVATE EQUITY/,
    /MULTIFAMILY HOUSING/,
    /NATIONAL ASSOCIATION OF.*INSURANCE/,
    /SHEET METAL CONTRACTORS/,
    // Generic name endings that suggest corporate
    /\bINC\b/,
    /\bCORP\b/,
    /\bCO\b PAC/,
    /\bLLC\b/,
    /\bLP\b PAC/,
    /BOEING/,
    /LOCKHEED/,
    /RAYTHEON/,
    /NORTHROP/,
    /\bGE\b/,
    /GENERAL DYNAMICS/,
    /HONEYWELL/,
    /EXXON/,
    /CHEVRON/,
    /BP\b/,
    /SHELL\b/,
    /CONOCOPHILLIPS/,
    /PHILLIPS 66/,
    /VALERO/,
    /MARATHON/,
    /PFIZER/,
    /MERCK/,
    /JOHNSON & JOHNSON/,
    /ABBVIE/,
    /AMGEN/,
    /BRISTOL.MYERS/,
    /ELI LILLY/,
    /GILEAD/,
    /NOVARTIS/,
    /\bGSK\b/,
    /ASTRAZENECA/,
    /SANOFI/,
    /AMAZON/,
    /GOOGLE/,
    /ALPHABET/,
    /META PLATFORMS/,
    /FACEBOOK/,
    /MICROSOFT/,
    /APPLE INC/,
    /\bIBM\b/,
    /ORACLE/,
    /SALESFORCE/,
    /COMCAST/,
    /AT&T/,
    /VERIZON/,
    /T-MOBILE/,
    /CHARTER COMMUNICATIONS/,
    /DISNEY/,
    /WARNER/,
    /PARAMOUNT/,
    /JPMORGAN/,
    /JP MORGAN/,
    /GOLDMAN SACHS/,
    /MORGAN STANLEY/,
    /CITIGROUP/,
    /BANK OF AMERICA/,
    /WELLS FARGO/,
    /BLACKROCK/,
    /BLACKSTONE/,
    /\bKKR\b/,
    /CARLYLE/,
    /\bUBS\b/,
    /CREDIT SUISSE/,
    /DEUTSCHE BANK/,
    /HSBC/,
    /MASTERCARD/,
    /VISA INC/,
    /AMERICAN EXPRESS/,
    /PAYPAL/,
    /WALMART/,
    /KROGER/,
    /TARGET/,
    /COSTCO/,
    /HOME DEPOT/,
    /LOWE/,
    /COCA.COLA/,
    /PEPSICO/,
    /NESTLE/,
    /CONAGRA/,
    /TYSON/,
    /KRAFT/,
    /UNITED ?HEALTH/,
    /CVS HEALTH/,
    /ANTHEM/,
    /CIGNA/,
    /HUMANA/,
    /\bHCA\b/,
    /ELEVANCE/,
    /AETNA/,
    /BLUE CROSS/,
    /KAISER/,
    /MEDTRONIC/,
    /STRYKER/,
    /\bUPS\b/,
    /FEDEX/,
    /DELTA AIR/,
    /AMERICAN AIRLINES/,
    /UNITED AIRLINES/,
    /SOUTHWEST AIRLINES/,
    /UNION PACIFIC/,
    /\bCSX\b/,
    /NORFOLK SOUTHERN/,
    /CATERPILLAR/,
    /DEERE/,
    /GENERAL MOTORS/,
    /FORD MOTOR/,
    /STELLANTIS/,
    /TOYOTA/,
    /TESLA/,
    /\bKOCH\b/,
    /CHAMBER OF COMMERCE/,
    /BUSINESS ROUNDTABLE/,
    /\bASSOCIATION\b/,
    /REALTOR/,
    /MORTGAGE BANKERS/,
    /HOMEBUILDERS/,
    /TRIAL LAWYERS/,
    /AMERICAN MEDICAL/,
    /\bAMA\b/,
    /AMERICAN HOSPITAL/,
    /\bAHIP\b/,
    /PHRMA/,
    /BIOTECH/,
    /SEMICONDUCTOR/,
    /AEROSPACE/,
    /DEFENSE INDUSTRIES/,
    /AUTO DEALERS/,
    /BEVERAGE/,
    /TOBACCO/,
    /ALTRIA/,
    /\bMARS\b/,
    /COMPANY\b/,
    /HOLDINGS/,
    /INDUSTRIES/,
    /\bGROUP\b PAC/,
    /BANKERS/,
    /\bINSURANCE\b/,
    /\bENERGY\b/,
    /\bDEFENSE\b/,
    /\bAEROSPACE\b/,
    /\bRAILROAD/,
    /\bRESTAURANT/,
    /\bRETAIL/,
    /\bWIRELESS/,
    /\bCABLE/,
    /\bMEDIA\b/,
    /\bHEALTH SYSTEMS/,
    /POLITICAL ACTION COMMITTEE OF/,
    /EMPLOYEES PAC/,
    /EMPLOYEES POLITICAL/,
  ];
  for (const p of corporatePatterns) if (p.test(blob)) return { proposed: 'CORPORATE', reason: `/${p.source}/` };

  return { proposed: 'UNKNOWN', reason: 'no signal' };
}

function csvEscape(v: string | number): string {
  const s = String(v);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

// Preserve previously-applied inline / override / llm classifications when
// re-running the spike. The CSV is the source of truth for human-reviewed
// rows; we only re-auto-classify rows whose reason looks like an
// auto-generated regex hit (i.e. starts with "/" or is empty). Anything
// tagged "inline:", "override:", or "llm:" is locked.
function loadExistingClassifications(): Map<string, { proposed: string; reason: string }> {
  const existing = new Map<string, { proposed: string; reason: string }>();
  const csvPath = path.join(process.cwd(), 'data', 'pac-candidates.csv');
  if (!fs.existsSync(csvPath)) return existing;
  const text = fs.readFileSync(csvPath, 'utf-8');
  const lines = text.split('\n');
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) continue;
    const cols: string[] = [];
    let cur = '';
    let inQ = false;
    for (const ch of line) {
      if (ch === '"' && !inQ) inQ = true;
      else if (ch === '"' && inQ) inQ = false;
      else if (ch === ',' && !inQ) {
        cols.push(cur);
        cur = '';
      } else cur += ch;
    }
    cols.push(cur);
    if (cols.length < 11) continue;
    const id = cols[0];
    const reason = cols[9] ?? '';
    const proposed = cols[8] ?? '';
    // Lock human-reviewed rows. Auto-generated reasons start with "/" (regex)
    // or "org_type=" or "no signal" — those can be re-run.
    const isLocked = reason.startsWith('inline:') || reason.startsWith('override:') || reason.startsWith('llm:');
    if (isLocked && proposed) {
      existing.set(id, { proposed, reason });
    }
  }
  return existing;
}

function main(): void {
  console.log(`[spike-pac-candidates] parsing bulk FEC files...`);
  const cmIndex = loadCmIndex();
  console.log(`  cm.txt union (4 cycles): ${cmIndex.size} committees`);
  const pacs = loadPacRows(cmIndex);
  console.log(`  webk union (4 cycles): ${pacs.length} non-party PACs (Q/N/O/I/V/W/U/E)`);

  const existing = loadExistingClassifications();
  console.log(`  preserving ${existing.size} human-reviewed classifications from existing CSV`);

  pacs.sort((a, b) => b.influence_volume - a.influence_volume);
  const top = pacs.slice(0, TOP_N);

  const lines: string[] = [];
  lines.push(
    'committee_id,name,committee_type,org_type,connected_org,total_receipts,contribs_to_others,ind_exp,proposedClass,reason,finalClass',
  );
  const counts: Record<string, number> = {
    CORPORATE: 0,
    FOREIGN_POLICY: 0,
    DARK_MONEY: 0,
    ACTIVIST: 0,
    CONDUIT: 0,
    LEADERSHIP: 0,
    LABOR: 0,
    IDEOLOGICAL: 0,
    UNKNOWN: 0,
  };
  for (const p of top) {
    // Locked rows from existing CSV win over auto-classifier.
    const lock = existing.get(p.committee_id);
    let proposed: string;
    let reason: string;
    if (lock) {
      proposed = lock.proposed;
      reason = lock.reason;
    } else {
      const auto = autoClassify(p);
      proposed = auto.proposed;
      reason = auto.reason;
    }
    counts[proposed] = (counts[proposed] ?? 0) + 1;
    lines.push(
      [
        p.committee_id,
        p.name,
        p.committee_type,
        p.org_type,
        p.connected_org,
        p.total_receipts.toFixed(0),
        p.contribs_to_others.toFixed(0),
        p.ind_exp.toFixed(0),
        proposed,
        reason,
        '',
      ]
        .map(csvEscape)
        .join(','),
    );
  }
  const outPath = path.join(process.cwd(), 'data', 'pac-candidates.csv');
  fs.writeFileSync(outPath, lines.join('\n'));
  console.log(`\n[spike-pac-candidates] wrote ${top.length} rows to ${outPath}`);
  console.log(`[spike-pac-candidates] breakdown: ${JSON.stringify(counts)}`);
  console.log(`\nTop 30 by influence volume (max of direct contribs OR independent expenditures):`);
  for (const p of top.slice(0, 30)) {
    const { proposed } = autoClassify(p);
    const path =
      p.committee_type === 'Q' || p.committee_type === 'N'
        ? `direct=$${p.contribs_to_others.toFixed(0)}`
        : `IE=$${p.ind_exp.toFixed(0)}`;
    console.log(
      `  ${proposed.padEnd(14)} ${p.committee_type} ${p.committee_id} ${path.padEnd(22)} ${p.name.slice(0, 55)}`,
    );
  }
  console.log(`\nNext: open data/pac-candidates.csv, edit finalClass for any wrong/UNKNOWN rows.`);
}

// Export the classifier so other scripts can reuse it without triggering main().
export { autoClassify, COMMITTEE_OVERRIDES };
export type { PacRow };

// Guard: only run main() when invoked directly (e.g. `npx tsx
// scripts/spike-pac-candidates.ts`). Importing this file from another
// script should not kick off the full webk-summary regeneration.
if (require.main === module) {
  main();
}
