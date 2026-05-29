// v1.7.6 — Employer → industry-sector classifier.
//
// The "in-house" path to making individual-donor money meaningful. Per-firm
// numbers are noise (~2.5% of a legislator's base), but INDUSTRY rollup is
// signal: "finance = 32% of this legislator's itemized individual money" is
// the Wall-Street-candidate story the PAC Score can't see.
//
// We don't have OpenSecrets' RealCode crosswalk (API discontinued, bulk
// blocked), so we classify employer strings ourselves — same rules+overrides
// pattern as the PAC classifier. Two layers:
//   1. EMPLOYER_OVERRIDES — exact (normalized) names for the highest-dollar
//      employers, hand-verified.
//   2. keyword/regex rules — catch the long tail (LLP → law, UNIVERSITY →
//      education, CAPITAL/PARTNERS → finance, etc.).
//
// Sectors are coarse (OpenSecrets-sector-inspired). UNCLASSIFIED is the
// honest default — surfaced, not hidden.

export type IndustrySector =
  | 'FINANCE' // banks, PE, hedge funds, VC, asset mgmt, insurance, crypto exchanges
  | 'TECH' // software, internet, hardware, semiconductors
  | 'HEALTH' // pharma, biotech, hospitals, insurers, physicians
  | 'ENERGY' // oil/gas, utilities, mining, renewables
  | 'REAL_ESTATE' // developers, REITs, brokerages, construction
  | 'LAW_LOBBYING' // law firms, lobbying / government-affairs shops
  | 'DEFENSE' // defense / aerospace contractors
  | 'MEDIA_ENT' // film, music, publishing, broadcast, sports
  | 'AGRIBUSINESS' // agriculture, food, beverage, tobacco
  | 'MANUFACTURING' // industrial, auto, chemicals, consumer goods
  | 'TRANSPORT' // airlines, rail, shipping, logistics, auto dealers
  | 'RETAIL_HOSPITALITY' // retail, restaurants, hotels, gaming
  | 'EDUCATION' // universities, schools, ed institutions
  | 'LABOR' // unions
  | 'GOVERNMENT' // government employers, military, public sector
  | 'NONPROFIT_ADVOCACY' // foundations, advocacy orgs, think tanks
  | 'UNCLASSIFIED'; // no industry signal (incl. FEC catch-alls)

export const SECTOR_LABEL: Record<IndustrySector, string> = {
  FINANCE: 'Finance / Wall St',
  TECH: 'Tech',
  HEALTH: 'Healthcare / Pharma',
  ENERGY: 'Energy',
  REAL_ESTATE: 'Real Estate / Construction',
  LAW_LOBBYING: 'Law / Lobbying',
  DEFENSE: 'Defense',
  MEDIA_ENT: 'Media / Entertainment',
  AGRIBUSINESS: 'Agribusiness',
  MANUFACTURING: 'Manufacturing',
  TRANSPORT: 'Transportation',
  RETAIL_HOSPITALITY: 'Retail / Hospitality',
  EDUCATION: 'Education',
  LABOR: 'Labor',
  GOVERNMENT: 'Government / Public',
  NONPROFIT_ADVOCACY: 'Nonprofit / Advocacy',
  UNCLASSIFIED: 'Unclassified',
};

// Normalize an employer string for matching: uppercase, strip punctuation /
// legal suffixes / common noise, collapse whitespace.
export function normalizeEmployer(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[.,]/g, ' ')
    .replace(
      /\b(L\s*L\s*C|L\s*L\s*P|P\s*L\s*L\s*C|INC|CORP|CORPORATION|CO|COMPANY|LTD|LP|PC|PLC|GROUP|HOLDINGS?|USA|US|& CO)\b/g,
      ' ',
    )
    .replace(/\s+/g, ' ')
    .trim();
}

// Highest-dollar employers, hand-verified. Keyed by NORMALIZED name.
// (Run normalizeEmployer on the raw FEC string before lookup.)
const EMPLOYER_OVERRIDES: Record<string, IndustrySector> = {
  // Finance — PE / hedge funds / banks / asset mgmt / VC / crypto
  BLACKSTONE: 'FINANCE',
  'APOLLO GLOBAL MANAGEMENT': 'FINANCE',
  APOLLO: 'FINANCE',
  'APOLLO MANAGEMENT': 'FINANCE',
  'GOLDMAN SACHS': 'FINANCE',
  'CAPITAL GROUP': 'FINANCE',
  'ELLIOTT INVESTMENT MANAGEMENT': 'FINANCE',
  'ELLIOTT MANAGEMENT': 'FINANCE',
  'BAIN CAPITAL': 'FINANCE',
  'JANE STREET CAPITAL': 'FINANCE',
  'JANE STREET': 'FINANCE',
  'FISHER INVESTMENTS': 'FINANCE',
  'WINKLEVOSS CAPITAL MANAGEMENT': 'FINANCE',
  COINBASE: 'FINANCE',
  'ANDREESSEN HOROWITZ': 'FINANCE', // VC
  CITADEL: 'FINANCE',
  'JPMORGAN CHASE': 'FINANCE',
  JPMORGAN: 'FINANCE',
  'MORGAN STANLEY': 'FINANCE',
  'BANK OF AMERICA': 'FINANCE',
  'WELLS FARGO': 'FINANCE',
  'CHARLES SCHWAB': 'FINANCE',
  BLACKROCK: 'FINANCE',
  VANGUARD: 'FINANCE',
  KKR: 'FINANCE',
  CARLYLE: 'FINANCE',
  'SEQUOIA CAPITAL': 'FINANCE',
  'RDV CORPORATION': 'FINANCE', // DeVos family office
  RDV: 'FINANCE',
  // Tech
  GOOGLE: 'TECH',
  'GOOGLE LLC': 'TECH',
  ALPHABET: 'TECH',
  MICROSOFT: 'TECH',
  APPLE: 'TECH',
  META: 'TECH',
  AMAZON: 'TECH',
  NVIDIA: 'TECH',
  ORACLE: 'TECH',
  SALESFORCE: 'TECH',
  // Law / lobbying
  'KIRKLAND & ELLIS': 'LAW_LOBBYING',
  'KIRKLAND ELLIS': 'LAW_LOBBYING',
  'BGR GROUP': 'LAW_LOBBYING',
  'CORNERSTONE GOVERNMENT AFFAIRS': 'LAW_LOBBYING',
  INVARIANT: 'LAW_LOBBYING',
  'AKIN GUMP': 'LAW_LOBBYING',
  'BROWNSTEIN HYATT': 'LAW_LOBBYING',
  'HOLLAND & KNIGHT': 'LAW_LOBBYING',
  // Education
  'HARVARD UNIVERSITY': 'EDUCATION',
  'STANFORD UNIVERSITY': 'EDUCATION',
  'UNIVERSITY OF MICHIGAN': 'EDUCATION',
  'UNIVERSITY OF CALIFORNIA': 'EDUCATION',
  // Government / public (catch-alls that aren't industry)
  'US SENATE': 'GOVERNMENT',
  'U S SENATE': 'GOVERNMENT',
  'US HOUSE OF REPRESENTATIVES': 'GOVERNMENT',
  'FEDERAL GOVERNMENT': 'GOVERNMENT',
  'STATE OF CALIFORNIA': 'GOVERNMENT',
  // Noise → unclassified
  'NO EMPLOYER': 'UNCLASSIFIED',
  '2ND REQUEST MADE': 'UNCLASSIFIED',
  'INDIAN TRIBE': 'UNCLASSIFIED',
};

// Keyword rules applied to the NORMALIZED string, in priority order.
// First match wins. Tuned so high-signal tokens (LAW, UNIVERSITY) beat
// generic ones.
// NOTE: leading \b only — NO trailing \b. Trailing boundaries break stem
// matches (TECHNOLOG\b never matches "TECHNOLOGIES"; MANUFACTUR\b never
// matches "MANUFACTURING"). Leading \b avoids mid-word false positives.
// NOTE: leading \b only, NO trailing \b on the group — a trailing boundary
// breaks stem matches (UNIVERSIT)\b never matches "UNIVERSITY"; the Y blocks
// the boundary. Leading \b prevents mid-word false positives; we accept that
// "OIL" also matches "OILER" etc. (rare, low-harm).
const RULES: Array<{ re: RegExp; sector: IndustrySector }> = [
  // Law / lobbying — check before finance.
  {
    re: /\b(LAW|ATTORNEY|LEGAL|COUNSEL|LOBBY|GOVERNMENT AFFAIRS|GOVT AFFAIRS|PUBLIC AFFAIRS|STRATEGIES|RIFKIND|MOTLEY RICE|PAUL WEISS|JONES DAY|SIDLEY|LATHAM|SKADDEN|GIBSON DUNN|COVINGTON|WILMER)/,
    sector: 'LAW_LOBBYING',
  },
  // Education
  { re: /\b(UNIVERSIT|COLLEGE|SCHOOL|ACADEMY|EDUCATION|FACULTY|PROFESSOR|UCSF|UCLA)/, sector: 'EDUCATION' },
  // Health
  {
    re: /\b(HOSPITAL|HEALTH|MEDICAL|MEDICINE|PHARMA|BIOTECH|CLINIC|PHYSICIAN|DENTAL|NURS|THERAP|BIOSCIENCE|GENENTECH|PFIZER|MERCK|ELI LILLY|ABBVIE|KAISER)/,
    sector: 'HEALTH',
  },
  // Energy
  { re: /\b(ENERGY|OIL|PETROLEUM|SOLAR|UTILIT|ELECTRIC|EXXON|CHEVRON|NEXTERA|MINING|COAL)/, sector: 'ENERGY' },
  // Defense / aerospace
  {
    re: /\b(DEFENSE|AEROSPACE|LOCKHEED|RAYTHEON|BOEING|NORTHROP|GENERAL DYNAMICS|L3HARRIS|BAE SYSTEMS|PALANTIR|ANDURIL|CLEARPATH)/,
    sector: 'DEFENSE',
  },
  // Real estate / construction
  {
    re: /\b(REAL ESTATE|REALTY|REALTOR|PROPERT|DEVELOPMENT|DEVELOPER|CONSTRUCTION|BUILDER|HOMES|REIT|BROKERAGE)/,
    sector: 'REAL_ESTATE',
  },
  // Media / entertainment / telecom-media
  {
    re: /\b(MEDIA|ENTERTAINMENT|FILM|STUDIO|MUSIC|RECORDS|PUBLISHING|BROADCAST|TELEVISION|DISNEY|WARNER|NETFLIX|PARAMOUNT|COMCAST|DISH NETWORK)/,
    sector: 'MEDIA_ENT',
  },
  // Agribusiness / food
  {
    re: /\b(FARM|AGRICULTUR|AGRIBUSINESS|RANCH|DAIRY|CATTLE|FOOD|BEVERAGE|GROWER|CARGILL|TYSON)/,
    sector: 'AGRIBUSINESS',
  },
  // Transportation
  {
    re: /\b(AIRLINE|AIRWAYS|RAILROAD|RAILWAY|SHIPPING|LOGISTICS|TRUCKING|FREIGHT|TRANSPORT|DELTA AIR|FEDEX)/,
    sector: 'TRANSPORT',
  },
  // Retail / hospitality / gaming
  { re: /\b(RETAIL|RESTAURANT|HOTEL|RESORT|CASINO|GAMING|HOSPITALITY|STORE)/, sector: 'RETAIL_HOSPITALITY' },
  // Tech (generic)
  { re: /\b(SOFTWARE|TECHNOLOG|INTERNET|SEMICONDUCTOR|TELECOM|DIGITAL|CYBER|CLOUD)/, sector: 'TECH' },
  // Manufacturing / industrial
  { re: /\b(MANUFACTUR|INDUSTR|AUTOMOTIVE|MOTORS|CHEMICAL|STEEL|MACHINE|ULINE)/, sector: 'MANUFACTURING' },
  // Labor
  { re: /\b(UNION|AFL-?CIO|TEAMSTER|SEIU|AFSCME|UAW|UFCW|IBEW|LABORERS)/, sector: 'LABOR' },
  // Nonprofit / advocacy
  {
    re: /\b(FOUNDATION|NONPROFIT|NON-PROFIT|ADVOCACY|ASSOCIATION|COALITION|ALLIANCE|SOCIETY|ACTION FUND)/,
    sector: 'NONPROFIT_ADVOCACY',
  },
  // Finance (generic) — last so specific industries win first.
  {
    re: /\b(CAPITAL|PARTNERS|INVESTMENT|MANAGEMENT|ASSET|EQUITY|VENTURE|BANK|FINANC|INSURANCE|SECURITIES|FUND|ADVISOR|WCAS|BERKSHIRE)/,
    sector: 'FINANCE',
  },
];

export function classifyEmployer(raw: string): IndustrySector {
  if (!raw) return 'UNCLASSIFIED';
  const norm = normalizeEmployer(raw);
  if (!norm) return 'UNCLASSIFIED';
  // Try override on the normalized form, then on the raw uppercase (some
  // overrides include suffixes the normalizer strips).
  if (EMPLOYER_OVERRIDES[norm]) return EMPLOYER_OVERRIDES[norm];
  const rawUpper = raw.toUpperCase().trim();
  if (EMPLOYER_OVERRIDES[rawUpper]) return EMPLOYER_OVERRIDES[rawUpper];
  for (const { re, sector } of RULES) {
    if (re.test(norm)) return sector;
  }
  return 'UNCLASSIFIED';
}
