// LegislativeDataSource — abstraction over external bill/sponsor/vote APIs.
//
// The Phase 2 implementation uses LegiScan for both federal and CA.
// This interface keeps a future swap to Congress.gov + OpenStates cheap:
// the sync engine talks to this surface, not to LegiScan directly.

export type DataSourceJurisdiction = 'FEDERAL' | 'CA';

export type SponsorTier = 'AUTHOR' | 'PRINCIPAL_COAUTHOR' | 'COAUTHOR' | 'COSPONSOR' | 'SPONSOR';

export type VotePosition = 'YES' | 'NO' | 'NOT_VOTING' | 'EXCUSED' | 'PRESENT' | 'ABSTAINED';

export interface NormalizedSponsor {
  externalPersonId: string; // LegiScan people_id (or other source's id) as a string
  name: string;
  party: string | null;
  tier: SponsorTier;
  /** Original sponsor_type_id from the source for audit purposes */
  rawTier: string | number;
  /** 1-indexed authorship order. 1 = primary author / lead sponsor; higher = coauthor. */
  sponsorOrder?: number;
}

export interface NormalizedRollCallVote {
  externalPersonId: string;
  position: VotePosition;
}

export interface NormalizedRollCall {
  externalRollCallId: string; // LegiScan roll_call_id, etc.
  description: string; // e.g. "Assembly Health Committee"
  date: string; // ISO 8601 date
  yes: number;
  no: number;
  notVoting: number;
  absent: number;
  passed: boolean;
  votes: NormalizedRollCallVote[];
  sourceUrl: string | null;
}

export interface NormalizedProcedureEntry {
  date: string; // ISO 8601
  chamber: string; // 'A' | 'S' | 'E' | etc.
  action: string;
}

export interface NormalizedBill {
  externalBillId: string; // LegiScan bill_id
  state: string; // e.g. "US", "CA"
  session: string; // e.g. "2023-2024 Regular"
  billNumber: string; // e.g. "AB-2200"
  title: string;
  description: string;
  status: string;
  sponsors: NormalizedSponsor[];
  rollCalls: NormalizedRollCall[];
  sourceUrl: string | null;
  /** Ordered timeline of procedural actions on the bill. Earliest first. */
  procedureHistory: NormalizedProcedureEntry[];
}

export interface BillLookupParams {
  jurisdiction: DataSourceJurisdiction;
  billNumber: string;
  /**
   * Session identifier as known to the source. For LegiScan this is
   * the session_id (int); we pass it through as a string here.
   */
  sessionId?: string;
}

export interface LegislativeDataSource {
  readonly name: string;

  /**
   * Resolves a bill by its public bill number within a jurisdiction/session.
   * Returns null if the bill cannot be found (logged but not thrown).
   */
  findBillByNumber(params: BillLookupParams): Promise<NormalizedBill | null>;

  /**
   * Returns a bill by its source-native id. Used during sync once the
   * MarkerBill row has its legiscanBillId backfilled.
   */
  getBillById(externalBillId: string): Promise<NormalizedBill | null>;
}
