// CAL-ACCESS raw-file parser.
//
// Reads the six raw .csv files published by CCDC/Big Local News and rolls
// them up into per-legislator corporate-PAC totals. Used by
// scripts/ingest-cal-access.ts when --ccdc-dir is passed.
//
// Algorithm:
//
//  Pass 1 — CVR_CAMPAIGN_DISCLOSURE_CD.csv
//    For each Form 460 filing in our cycle window, match the candidate
//    (CAND_NAML + DIST_NO + OFFICE_CD) to a Legislator row. Build:
//      filingToLegislator: Map<filingId, { legislatorId, cycleYear }>
//
//  Pass 2 — RCPT_CD.csv (the 3+ GB one — must stream)
//    For each receipt whose FILING_ID is in our map:
//      - Add AMOUNT to that legislator's total for the cycle.
//      - If ENTITY_CD === 'COM' and the contributor name classifies as
//        CORPORATE (or TRADE_ASSOCIATION), also add to corporatePacAmount.
//
// Output: PacAggregate[] — one row per (legislator, cycleYear).
//
// We deliberately do NOT load filername_cd / filer_filings_cd into memory.
// rcpt_cd.csv already carries the contributor name in CTRIB_NAML, which is
// what the classifier needs. cvr_campaign_disclosure_cd.csv carries the
// FILING_ID -> FILER_ID + candidate-identity fields we need for Pass 1.

import { createReadStream } from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse';

export interface CalAccessLegislator {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  chamber: 'SEN' | 'REP';
  district: number | null;
}

export interface PacAggregate {
  legislatorId: string;
  cycleYear: number;
  corporatePacAmount: number;
  totalReceipts: number;
  contributorBreakdown: Map<string, { amount: number; classification: CommitteeClass }>;
}

export type CommitteeClass =
  | 'CORPORATE'
  | 'LABOR'
  | 'PARTY'
  | 'CANDIDATE'
  | 'IDEOLOGICAL'
  | 'TRADE_ASSOCIATION'
  | 'UNCLASSIFIED';

/**
 * Heuristic name-based classifier. Order matters — labor/party/candidate
 * checks run before corporate so a "Teamsters Local 853 Political Action
 * Fund" doesn't get tagged corporate just because it contains "FUND".
 *
 * Methodology principle: conservative attribution. When in doubt, return
 * UNCLASSIFIED — the corporate-PAC ratio counts only confirmed corporate
 * contributions, so misclassifying borderline cases as UNCLASSIFIED can
 * only LOWER a legislator's reported corporate share, never inflate it.
 */
export function classifyCommittee(rawName: string): CommitteeClass {
  if (!rawName) return 'UNCLASSIFIED';
  const name = rawName.toUpperCase();

  if (
    /\b(LABOR|UNION|WORKERS|EMPLOYEES|AFL-CIO|AFL CIO|TEAMSTER|BROTHERHOOD|NURSE|FIREFIGHTER|FIRE FIGHTER|POLICE|SHERIFF|TEACHER|EDUCATORS|FEDERATION|IBEW|SEIU|UFCW|UAW|CARPENTER|PLUMBER|ELECTRICIAN|LABORER|IATSE|UFCW|ASSOC.* OF ELECTRICAL|DRIVE COMMITTEE|TRADE COUNCIL|COPE FUND|COPE COMMITTEE|UA LOCAL|UNITED ASSOCIATION|MACHINIST|OPERATING ENGINEERS|LONGSHORE|LIUNA|PIPE TRADES)\b/.test(
      name,
    )
  ) {
    return 'LABOR';
  }

  if (
    /\b(DEMOCRATIC PARTY|REPUBLICAN PARTY|LIBERTARIAN PARTY|GREEN PARTY|PARTY CENTRAL|STATE CENTRAL COMMITTEE|COUNTY CENTRAL COMMITTEE|PARTY EXECUTIVE|DCCC|RNC|DNC|NRCC|DSCC|NRSC)\b/.test(
      name,
    )
  ) {
    return 'PARTY';
  }

  // Candidate-controlled committees (incl. inter-candidate transfers). The
  // 2024/2026/etc. year suffix common on CA committee names is captured via
  // the broader "FOR (STATE )?(ASSEMBLY|SENATE|...)" pattern.
  if (
    /\b(FRIENDS OF|COMMITTEE TO ELECT|COMMITTEE TO RE-?ELECT|RE-?ELECT|FOR (STATE |U\.?S\.? |LIEUTENANT |CITY |COUNTY )?(ASSEMBLY|SENATE|CONGRESS|GOVERNOR|MAYOR|SUPERVISOR|ATTORNEY GENERAL|TREASURER|CONTROLLER|GOVERNOR|SECRETARY OF STATE|INSURANCE COMMISSIONER|BOARD OF EQUALIZATION|COUNCIL|SCHOOL BOARD))\b/.test(
      name,
    )
  ) {
    return 'CANDIDATE';
  }

  // Ballot-measure committees aren't candidate committees and aren't
  // "corporate PAC money" in the methodology sense — they fund yes/no
  // campaigns on propositions. Bucket separately as IDEOLOGICAL.
  if (/\bBALLOT MEASURE COMMITTEE\b|\bYES ON \d+\b|\bNO ON \d+\b|\bYES ON PROP\b|\bNO ON PROP\b/.test(name)) {
    return 'IDEOLOGICAL';
  }

  if (
    /\b(SIERRA|ENVIRONMENTAL|CONSERVATION|EQUALITY|CHOICE|PLANNED PARENTHOOD|HUMAN RIGHTS|CIVIL LIBERTIES|ACLU|NRA|GUN OWNERS|RIGHT TO LIFE|RIGHT-TO-LIFE|PRO-CHOICE|PRO-LIFE|PROGRESSIVE|CONSERVATIVE|TAXPAYERS|HOWARD JARVIS|YIMBY|SMART JUSTICE|CRIMINAL JUSTICE REFORM|GOVERN FOR CALIFORNIA|GFC COURAGE|WOMEN.S LIST|WOMEN.S POLITICAL|LGBT|LESBIAN|GAY|BISEXUAL|TRANSGENDER|QUEER|LATINO CAUCUS|BLACK CAUCUS|ASIAN PACIFIC|API CAUCUS|HISPANIC CAUCUS|JEWISH CAUCUS|VETERAN.* CAUCUS|MOMS DEMAND|GIFFORDS|EVERYTOWN|END CITIZENS UNITED|COMMON CAUSE)\b/.test(
      name,
    )
  ) {
    return 'IDEOLOGICAL';
  }

  if (
    /\b(ASSOCIATION|ASSN|REALTORS|BUILDERS|MANUFACTURERS|RETAILERS|DENTAL|MEDICAL|PHYSICIAN|HOSPITAL|BANKERS|CREDIT UNION LEAGUE|TRIAL LAWYERS|TRUCKING|GROCERS|RESTAURANT|HOTEL|APARTMENT|RENTAL HOUSING|CHAMBER OF COMMERCE|CHAMBER PAC|INDUSTRY|INDUSTRIES|GROWERS|FARM BUREAU|AGRICULTURE|CONTRACTORS|ENGINEERS|ARCHITECTS|PHARMACISTS|OPTOMETRISTS|VETERINARIAN|ACCOUNTANTS|CPA|REAL ESTATE)\b/.test(
      name,
    )
  ) {
    return 'TRADE_ASSOCIATION';
  }

  // Known corporate PAC names (firms that file their own employee PACs in CA).
  // Match without word boundaries for compact tickers like UPSPAC.
  if (
    /(UBER|LYFT|AT&T|ATT INC|PG&E|SEMPRA|EDISON|SOUTHERN CALIFORNIA GAS|GOOGLE|META |FACEBOOK|AMAZON|MICROSOFT|APPLE INC|TESLA|CHEVRON|EXXON|VALERO|SHELL OIL|MARATHON PETROLEUM|ANTHEM|KAISER PERMANENTE|BLUE SHIELD|BLUE CROSS|UNITEDHEALTH|HEALTHNET|WELLPOINT|CVS|WALGREENS|RITE AID|WALMART|TARGET|COSTCO|WELLS FARGO|JPMORGAN|CITIGROUP|GOLDMAN SACHS|MORGAN STANLEY|BANK OF AMERICA|UNION BANK|MUFG|US BANK|COMERICA|UNION PACIFIC|BNSF|FEDEX|UPSPAC|UPS POLITICAL|VERIZON|T-MOBILE|SPRINT|COMCAST|CHARTER|COX COMMUNICATIONS|DISH NETWORK|NETFLIX|DISNEY|VIACOM|FOX |NEWS CORP|WARNER|UNIVERSAL|TIME WARNER|DAIMLER|FORD MOTOR|GENERAL MOTORS|TOYOTA|HONDA|NISSAN|VOLKSWAGEN|HYUNDAI|KIA|BMW|MERCEDES|AMERICAN HONDA|HONEYWELL|RAYTHEON|LOCKHEED MARTIN|BOEING|GENERAL DYNAMICS|NORTHROP GRUMMAN|BNY MELLON|STATE FARM|FARMERS INSURANCE|ALLSTATE|GEICO|LIBERTY MUTUAL|TRAVELERS|METLIFE|PRUDENTIAL|MASS MUTUAL|NEW YORK LIFE|NORTHWESTERN MUTUAL|JOHN HANCOCK)/.test(
      name,
    )
  ) {
    return 'CORPORATE';
  }

  // Coalition / front-group patterns that consistently track to corporate
  // PAC money in CA — verified by inspecting filings.
  if (
    /\b(CALIFORNIANS FOR JOBS|CALIFORNIANS FOR A STRONG ECONOMY|CALIFORNIANS FOR JOBS AND A STRONG ECONOMY|CALIFORNIA BUSINESS|CALIFORNIA BUSINESS PAC|CABPAC|CALIFORNIA CHAMBER|JOB CREATORS)\b/.test(
      name,
    )
  ) {
    return 'CORPORATE';
  }

  if (
    /\b(PAC|POLITICAL ACTION|GOOD GOVERNMENT|INC|CORP|LLC|COMPANY|TECHNOLOGIES|TECHNOLOGY|FINANCIAL|BANK|INSURANCE|ENERGY|OIL|GAS|UTILITIES|PHARMA|BIOTECH|HEALTHCARE|HOMEBUILDERS|TELECOMMUNICATIONS|WIRELESS|DEFENSE|AEROSPACE|TRANSPORT|RAILROAD|AIRLINES|HOSPITALITY|DISTRIBUTORS|BEVERAGE|BREWING|BREWERS|WINE|SPIRITS|TOBACCO|CANNABIS|MARIJUANA|GAMING|GAMBLING|CASINO|RACING)\b/.test(
      name,
    )
  ) {
    return 'CORPORATE';
  }

  return 'UNCLASSIFIED';
}

/**
 * Returns true if the classification should count toward the corporate
 * PAC ratio. Trade associations are bundled with corporate per
 * methodology — they're the corporate sector's vehicle for collective
 * lobbying.
 */
export function isCorporateForRatio(c: CommitteeClass): boolean {
  return c === 'CORPORATE' || c === 'TRADE_ASSOCIATION';
}

/**
 * Normalize a name for matching: uppercase, strip diacritics (Pérez →
 * PEREZ), strip punctuation, collapse whitespace, drop common suffixes
 * (Jr/Sr/III/IV). Diacritic stripping is essential — Cal-Access stores
 * filer names as ASCII, so without normalization legislators like
 * Pérez, Limón, González never match.
 */
export function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[.,'"`-]/g, ' ')
    .replace(/\b(JR|SR|II|III|IV|V)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

interface CycleWindow {
  cycleYear: number;
  startYear: number;
  endYear: number;
}

/**
 * CA election cycles are two-year. We label the cycle by its ending
 * (election) year — 2026 means receipts dated 2025-01-01 through
 * 2026-12-31. Matches the federal convention used by the OpenSecrets
 * ingest already in our DB.
 */
export function cyclesFor(cycleYears: readonly number[]): CycleWindow[] {
  return cycleYears.map((y) => ({ cycleYear: y, startYear: y - 1, endYear: y }));
}

function parseCalAccessDate(raw: string): { year: number } | null {
  if (!raw) return null;
  // Cal-Access dates: "M/D/YYYY 12:00:00 AM" (sometimes M/D/YY).
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(raw.trim());
  if (!match) return null;
  return { year: parseInt(match[3], 10) };
}

function pickCycle(year: number, cycles: readonly CycleWindow[]): CycleWindow | null {
  for (const c of cycles) {
    if (year >= c.startYear && year <= c.endYear) return c;
  }
  return null;
}

/**
 * Index legislators by (district, chamber) — each pair is unique to one
 * currently sitting member, so this gives an unambiguous lookup. Name
 * verification is a token-overlap sanity check on the CVR row rather
 * than an exact match (Cal-Access stores compound surnames like
 * "Martinez Valladares" and hyphenated "Ortega-Toro" that don't match
 * our DB's single-token lastName).
 */
function buildLegislatorIndex(legislators: CalAccessLegislator[]): Map<string, CalAccessLegislator> {
  const idx = new Map<string, CalAccessLegislator>();
  for (const l of legislators) {
    if (l.district == null) continue;
    idx.set(`${l.district}|${l.chamber}`, l);
  }
  return idx;
}

/** Tokens that appear inside names but carry no identifying weight. */
const NAME_FILLERS = new Set(['Y', 'DE', 'LA', 'EL', 'DEL', 'VAN', 'VON', 'DI', 'DA']);

/**
 * Token-overlap last-name match. Returns true if any normalized token of
 * the DB lastName/fullName appears in the CVR-supplied lastName.
 * Handles three patterns that broke exact matching:
 *  - splitName artifacts ("María Elena Durazo" → DB lastName "Elena Durazo")
 *  - compound Spanish surnames ("Martinez Valladares")
 *  - hyphenated names ("Ortega-Toro")
 */
function isLastNameMatch(dbLastName: string, dbFullName: string, cvrLastName: string): boolean {
  const dbTokens = new Set(
    [...normalizeName(dbLastName).split(' '), ...normalizeName(dbFullName).split(' ')].filter(
      (t) => t.length >= 3 && !NAME_FILLERS.has(t),
    ),
  );
  const cvrTokens = normalizeName(cvrLastName)
    .split(' ')
    .filter((t) => t.length >= 3 && !NAME_FILLERS.has(t));
  if (dbTokens.size === 0 || cvrTokens.length === 0) return false;
  return cvrTokens.some((t) => dbTokens.has(t));
}

/**
 * Token-overlap match between two full names from different data sources.
 * Normalizes both, then checks whether any non-filler token (≥3 chars)
 * from `nameA` appears in the token set of `nameB`.
 *
 * Designed for FEC ↔ DB legislator matching where the FEC format is
 * "LASTNAME, FIRSTNAME" and the DB stores "First Last".
 */
export function lastNameTokensOverlap(nameA: string, nameB: string): boolean {
  const tokensA = new Set(
    normalizeName(nameA)
      .split(' ')
      .filter((t) => t.length >= 3 && !NAME_FILLERS.has(t)),
  );
  const tokensB = normalizeName(nameB)
    .split(' ')
    .filter((t) => t.length >= 3 && !NAME_FILLERS.has(t));
  if (tokensA.size === 0 || tokensB.length === 0) return false;
  return tokensB.some((t) => tokensA.has(t));
}

/**
 * CAL-ACCESS OFFICE_CD values for state legislative offices.
 * Source: https://calaccess.californiacivicdata.org/documentation/calaccess-files/lookup-codes-cd/
 *   STE = State Senate
 *   ASM = State Assembly
 * Empirically (verified by scanning a sample CVR), these are the codes
 * for sitting CA legislators. We accept either the code or any value
 * starting with "STA" or "ASM" defensively.
 */
function chamberFromOffice(officeCd: string | undefined): 'SEN' | 'REP' | null {
  if (!officeCd) return null;
  const o = officeCd.toUpperCase().trim();
  if (o === 'STE' || o === 'SEN' || o === 'STATE SENATE') return 'SEN';
  if (o === 'ASM' || o === 'STATE ASSEMBLY' || o.startsWith('ASS')) return 'REP';
  return null;
}

interface CsvStreamOptions {
  /** If set, only process rows where this filter passes. Faster than calling cb for every row. */
  filter?: (row: Record<string, string>) => boolean;
}

async function streamCsv(
  filePath: string,
  options: CsvStreamOptions,
  rowHandler: (row: Record<string, string>) => void,
): Promise<number> {
  return new Promise((resolve, reject) => {
    let rowCount = 0;
    const parser = createReadStream(filePath).pipe(
      parse({
        columns: true,
        skip_empty_lines: true,
        relax_column_count: true,
        relax_quotes: true,
        bom: true,
      }),
    );
    parser.on('data', (row: Record<string, string>) => {
      rowCount += 1;
      if (options.filter && !options.filter(row)) return;
      try {
        rowHandler(row);
      } catch (err) {
        parser.destroy(err as Error);
      }
    });
    parser.on('end', () => resolve(rowCount));
    parser.on('error', reject);
  });
}

export interface CalAccessIngestResult {
  aggregates: PacAggregate[];
  matchedLegislatorCount: number;
  totalReceiptRowsScanned: number;
  filingsMatched: number;
  unclassifiedTopContributors: Array<{ name: string; amount: number }>;
}

/**
 * Top-level entry point.
 *
 * @param dir   Path to the directory holding the raw CAL-ACCESS CSVs.
 * @param legislators  CA legislator rows to match against.
 * @param cycleYears   List of election years (e.g. [2024, 2026]) to bin
 *                     receipts into. Each year denotes a 2-year cycle
 *                     ending in that year.
 */
export async function parseCalAccess(
  dir: string,
  legislators: CalAccessLegislator[],
  cycleYears: readonly number[],
): Promise<CalAccessIngestResult> {
  const cycles = cyclesFor(cycleYears);
  const minStart = Math.min(...cycles.map((c) => c.startYear));
  const maxEnd = Math.max(...cycles.map((c) => c.endYear));
  const legIndex = buildLegislatorIndex(legislators);

  console.log(
    `[ca-access] cycles: ${cycles.map((c) => `${c.startYear}-${c.endYear}`).join(', ')}; legislators: ${
      legislators.length
    }; indexable: ${legIndex.size}`,
  );

  // ---- Pass 1: cvr_campaign_disclosure_cd → filing-to-legislator map ----
  const filingToLegislator = new Map<string, { legislatorId: string; cycleYear: number }>();
  const matchedLegIds = new Set<string>();
  console.log('[ca-access] Pass 1: scanning cvr_campaign_disclosure_cd.csv...');
  const cvrRows = await streamCsv(
    path.join(dir, 'cvr_campaign_disclosure_cd.csv'),
    {
      filter: (row) => row.FORM_TYPE === 'F460',
    },
    (row) => {
      const thru = parseCalAccessDate(row.THRU_DATE) ?? parseCalAccessDate(row.FROM_DATE);
      if (!thru) return;
      // Loose cycle pre-filter — we still confirm exact bin per receipt later.
      if (thru.year < minStart || thru.year > maxEnd + 1) return;

      const cvrLastName = row.CAND_NAML || '';
      if (!cvrLastName) return;
      const district = parseInt(row.DIST_NO || '', 10);
      if (!Number.isFinite(district)) return;

      const chamber = chamberFromOffice(row.OFFICE_CD);
      if (!chamber) return;

      const match = legIndex.get(`${district}|${chamber}`);
      if (!match) return;
      // Name sanity check — prevents matching against a previous holder
      // of the same seat (filings from a prior senator/AM with the same
      // district number get filtered here).
      if (!isLastNameMatch(match.lastName, match.fullName, cvrLastName)) return;

      const cycle = pickCycle(thru.year, cycles);
      if (!cycle) return;

      filingToLegislator.set(row.FILING_ID, { legislatorId: match.id, cycleYear: cycle.cycleYear });
      matchedLegIds.add(match.id);
    },
  );
  console.log(
    `[ca-access] Pass 1: scanned ${cvrRows.toLocaleString()} F460 cvr rows; ${filingToLegislator.size.toLocaleString()} filings tied to ${
      matchedLegIds.size
    }/${legislators.length} legislators.`,
  );

  if (filingToLegislator.size === 0) {
    return {
      aggregates: [],
      matchedLegislatorCount: 0,
      totalReceiptRowsScanned: 0,
      filingsMatched: 0,
      unclassifiedTopContributors: [],
    };
  }

  // ---- Pass 2: rcpt_cd → aggregate per (legislator, cycle) ----
  type Agg = {
    total: number;
    corporate: number;
    contributors: Map<string, { amount: number; classification: CommitteeClass }>;
  };
  const agg = new Map<string, Agg>();
  const unclassifiedAmounts = new Map<string, number>();
  let rcptCount = 0;
  let rcptMatched = 0;

  console.log('[ca-access] Pass 2: streaming rcpt_cd.csv (this is the large file)...');
  await streamCsv(path.join(dir, 'rcpt_cd.csv'), {}, (row) => {
    rcptCount += 1;
    const target = filingToLegislator.get(row.FILING_ID);
    if (!target) return;
    rcptMatched += 1;
    const amount = Number(row.AMOUNT);
    if (!Number.isFinite(amount) || amount === 0) return;

    const key = `${target.legislatorId}|${target.cycleYear}`;
    let a = agg.get(key);
    if (!a) {
      a = { total: 0, corporate: 0, contributors: new Map() };
      agg.set(key, a);
    }
    a.total += amount;

    if (row.ENTITY_CD === 'COM') {
      const contribName = row.CTRIB_NAML || '';
      const classification = classifyCommittee(contribName);
      const existing = a.contributors.get(contribName);
      if (existing) {
        existing.amount += amount;
      } else {
        a.contributors.set(contribName, { amount, classification });
      }
      if (isCorporateForRatio(classification)) {
        a.corporate += amount;
      }
      if (classification === 'UNCLASSIFIED' && contribName) {
        unclassifiedAmounts.set(contribName, (unclassifiedAmounts.get(contribName) ?? 0) + amount);
      }
    }
  });
  console.log(
    `[ca-access] Pass 2: scanned ${rcptCount.toLocaleString()} receipts; ${rcptMatched.toLocaleString()} attributed to tracked legislators.`,
  );

  const aggregates: PacAggregate[] = [];
  for (const [key, a] of agg.entries()) {
    const [legislatorId, cycleStr] = key.split('|');
    aggregates.push({
      legislatorId,
      cycleYear: parseInt(cycleStr, 10),
      corporatePacAmount: a.corporate,
      totalReceipts: a.total,
      contributorBreakdown: a.contributors,
    });
  }

  const unclassifiedTopContributors = [...unclassifiedAmounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .map(([name, amount]) => ({ name, amount }));

  return {
    aggregates,
    matchedLegislatorCount: matchedLegIds.size,
    totalReceiptRowsScanned: rcptCount,
    filingsMatched: filingToLegislator.size,
    unclassifiedTopContributors,
  };
}

// -------------------------------------------------------------------------
// v1.4: Form 496 / IE parser
// -------------------------------------------------------------------------
//
// Form 496 is the CA "Late Independent Expenditure Report" filed when a
// committee spends $1,000+ independently for or against a candidate in the
// 90-day window before an election. The CCDC bulk download does NOT publish
// a standalone `s496_cd.csv`; instead, the IE expenditure line items live in
// `expn_cd.csv` under `FORM_TYPE='F461P5'` — Schedule E (Independent
// Expenditures Made) of Form 461 (Major Donor / Independent Expenditure
// Committee Campaign Statement). Rows on this schedule carry the candidate
// the IE was made for or against (`CAND_NAML`, `OFFICE_CD`, `JURIS_CD`,
// `DIST_NO`) plus `SUP_OPP_CD` ('S' = support, 'O' = oppose) and the
// spender's `FILING_ID` (joined to `cvr_campaign_disclosure_cd.csv` for
// FILER_ID).
//
// Algorithm:
//
//  Pass 1 — cvr_campaign_disclosure_cd.csv: build Map<FILING_ID, FILER_ID>.
//  Pass 2 — expn_cd.csv filtered to FORM_TYPE='F461P5': for each row,
//    resolve filing→filer, gate by corporate-spender set, parse expenditure
//    date to cycle, match target candidate (chamber+district) to a
//    legislator OR to one of that legislator's race opponents, then
//    accumulate into the right IE bucket.

export interface CalAccessIeBuckets {
  legislatorId: string;
  cycleYear: number;
  corporateIeSupportAmount: number;
  corporateIeAgainstOpponentAmount: number;
  corporateIeAgainstSelfAmount: number;
}

export interface ParseCalAccessIeLegislator {
  id: string;
  openStatesId: string | null;
  fullName: string;
  state: string;
  chamber: 'SEN' | 'REP';
  district: number | null;
}

export interface ParseCalAccessIeRaceCandidate {
  externalCandidateId: string;
  candidateName: string;
  state: string;
  chamber: 'SEN' | 'REP';
  district: number | null;
  legislatorId: string | null;
}

export interface ParseCalAccessIeArgs {
  dataDir: string;
  legislators: ReadonlyArray<ParseCalAccessIeLegislator>;
  raceCandidatesByCycle: Map<number, ReadonlyArray<ParseCalAccessIeRaceCandidate>>;
  /**
   * Cal-Access FILER_IDs (committeeId on CommitteeClassification) classified
   * as CORPORATE or TRADE_ASSOCIATION for jurisdiction=CA. Only IE rows
   * whose spending filer is in this set contribute to the buckets.
   */
  corporateSpenderFilerIds: ReadonlySet<string>;
  cycles: ReadonlyArray<number>;
}

export interface CalAccessIeIngestResult {
  buckets: CalAccessIeBuckets[];
  ieRowsScanned: number;
  ieRowsAttributed: number;
  filingsMappedToFiler: number;
}

/**
 * Round an expenditure-date year to the cycle year (next even year).
 * 2023→2024, 2024→2024, 2025→2026, 2026→2026. Matches the federal
 * convention used by FEC and the existing `cyclesFor` PAC code.
 */
function cycleForYear(year: number): number {
  return year % 2 === 0 ? year : year + 1;
}

/**
 * Match a target candidate (parsed from an F461P5 row) against the legislator
 * roster and that cycle's race-candidate roster. Returns whichever attribution
 * bucket the row falls into, or null if no match.
 *
 *  - 'self-support'    : target == this legislator, SUP_OPP_CD='S'
 *  - 'self-oppose'     : target == this legislator, SUP_OPP_CD='O'
 *  - 'opponent-oppose' : target == one of this legislator's opponents in
 *                        the same cycle/race, SUP_OPP_CD='O'
 *
 * The opponent path requires the RaceCandidate table to be populated. If
 * empty (e.g. CA RaceCandidate seeding is still stubbed), the opponent
 * bucket simply stays at $0 — that's expected for v1.4.
 */
function matchIeTarget(
  targetLastName: string,
  targetFirstName: string,
  targetChamber: 'SEN' | 'REP',
  targetDistrict: number | null,
  supOpp: 'S' | 'O',
  legislators: ReadonlyArray<ParseCalAccessIeLegislator>,
  raceCandidates: ReadonlyArray<ParseCalAccessIeRaceCandidate>,
): { legislatorId: string; bucket: 'self-support' | 'self-oppose' | 'opponent-oppose' } | null {
  const targetFullName = `${targetFirstName} ${targetLastName}`.trim();

  // Direct match against the legislator roster (self).
  for (const l of legislators) {
    if (l.chamber !== targetChamber) continue;
    if (targetDistrict != null && l.district !== targetDistrict) continue;
    if (!lastNameTokensOverlap(l.fullName, targetFullName)) continue;
    if (supOpp === 'S') return { legislatorId: l.id, bucket: 'self-support' };
    if (supOpp === 'O') return { legislatorId: l.id, bucket: 'self-oppose' };
  }

  // Opponent path: only opposing spend counts (supporting an opponent is
  // not "corporate money working against me" in v1.4 methodology).
  if (supOpp !== 'O') return null;

  for (const rc of raceCandidates) {
    if (rc.chamber !== targetChamber) continue;
    if (targetDistrict != null && rc.district !== targetDistrict) continue;
    if (!lastNameTokensOverlap(rc.candidateName, targetFullName)) continue;

    // Find the legislator who shares this race (same chamber + district +
    // cycle) but is NOT this candidate. That legislator gets the "money
    // spent against my opponent" credit.
    for (const l of legislators) {
      if (l.chamber !== targetChamber) continue;
      if (rc.district != null && l.district !== rc.district) continue;
      if (lastNameTokensOverlap(l.fullName, rc.candidateName)) continue; // skip if this IS the candidate
      return { legislatorId: l.id, bucket: 'opponent-oppose' };
    }
  }

  return null;
}

export async function parseCalAccessIe(args: ParseCalAccessIeArgs): Promise<CalAccessIeIngestResult> {
  const { dataDir, legislators, raceCandidatesByCycle, corporateSpenderFilerIds, cycles } = args;
  const cycleSet = new Set(cycles);

  console.log(
    `[ca-access-ie] cycles: ${[...cycleSet].join(', ')}; legislators: ${legislators.length}; corporate spenders: ${
      corporateSpenderFilerIds.size
    }; race-candidates loaded for cycles: ${[...raceCandidatesByCycle.keys()].join(', ') || '(none)'}`,
  );

  if (corporateSpenderFilerIds.size === 0) {
    console.log('[ca-access-ie] no CA corporate/trade-association filer IDs classified — skipping IE pass.');
    return { buckets: [], ieRowsScanned: 0, ieRowsAttributed: 0, filingsMappedToFiler: 0 };
  }

  // ---- Pass 1: cvr_campaign_disclosure_cd → filing→filerId map ----
  const filingToFiler = new Map<string, string>();
  console.log('[ca-access-ie] Pass 1: scanning cvr_campaign_disclosure_cd.csv for FILING_ID → FILER_ID...');
  const cvrRows = await streamCsv(path.join(dataDir, 'cvr_campaign_disclosure_cd.csv'), {}, (row) => {
    const filingId = row.FILING_ID;
    const filerId = row.FILER_ID;
    if (!filingId || !filerId) return;
    // The same FILING_ID can appear multiple times (one per amendment);
    // the FILER_ID is stable across amendments so a simple set is fine.
    filingToFiler.set(filingId, filerId);
  });
  console.log(
    `[ca-access-ie] Pass 1: scanned ${cvrRows.toLocaleString()} cvr rows; ${filingToFiler.size.toLocaleString()} filing→filer mappings`,
  );

  // ---- Pass 2: stream expn_cd.csv filtered to F461P5 ----
  type BucketKey = string; // `${legislatorId}|${cycleYear}`
  const buckets = new Map<BucketKey, CalAccessIeBuckets>();
  let ieRowsScanned = 0;
  let ieRowsAttributed = 0;

  function getBucket(legislatorId: string, cycleYear: number): CalAccessIeBuckets {
    const key = `${legislatorId}|${cycleYear}`;
    let b = buckets.get(key);
    if (!b) {
      b = {
        legislatorId,
        cycleYear,
        corporateIeSupportAmount: 0,
        corporateIeAgainstOpponentAmount: 0,
        corporateIeAgainstSelfAmount: 0,
      };
      buckets.set(key, b);
    }
    return b;
  }

  console.log('[ca-access-ie] Pass 2: streaming expn_cd.csv for F461P5 IE rows (large file — be patient)...');
  await streamCsv(path.join(dataDir, 'expn_cd.csv'), { filter: (row) => row.FORM_TYPE === 'F461P5' }, (row) => {
    ieRowsScanned += 1;

    const filerId = filingToFiler.get(row.FILING_ID);
    if (!filerId) return;
    if (!corporateSpenderFilerIds.has(filerId)) return;

    const supOppRaw = (row.SUP_OPP_CD || '').toUpperCase().trim();
    if (supOppRaw !== 'S' && supOppRaw !== 'O') return;
    const supOpp = supOppRaw as 'S' | 'O';

    const chamber = chamberFromOffice(row.OFFICE_CD);
    if (!chamber) return;

    const districtRaw = parseInt(row.DIST_NO || '', 10);
    const district = Number.isFinite(districtRaw) ? districtRaw : null;

    const exp = parseCalAccessDate(row.EXPN_DATE);
    if (!exp) return;
    const cycleYear = cycleForYear(exp.year);
    if (!cycleSet.has(cycleYear)) return;

    const amount = Number(row.AMOUNT);
    if (!Number.isFinite(amount) || amount <= 0) return;

    const targetLast = row.CAND_NAML || '';
    const targetFirst = row.CAND_NAMF || '';
    if (!targetLast) return;

    const raceCands = raceCandidatesByCycle.get(cycleYear) ?? [];
    const matched = matchIeTarget(targetLast, targetFirst, chamber, district, supOpp, legislators, raceCands);
    if (!matched) return;

    ieRowsAttributed += 1;
    const b = getBucket(matched.legislatorId, cycleYear);
    if (matched.bucket === 'self-support') b.corporateIeSupportAmount += amount;
    else if (matched.bucket === 'self-oppose') b.corporateIeAgainstSelfAmount += amount;
    else if (matched.bucket === 'opponent-oppose') b.corporateIeAgainstOpponentAmount += amount;
  });

  console.log(
    `[ca-access-ie] Pass 2: scanned ${ieRowsScanned.toLocaleString()} F461P5 rows; ${ieRowsAttributed.toLocaleString()} attributed; ${
      buckets.size
    } (legislator, cycle) buckets with non-zero IE`,
  );

  return {
    buckets: [...buckets.values()],
    ieRowsScanned,
    ieRowsAttributed,
    filingsMappedToFiler: filingToFiler.size,
  };
}
