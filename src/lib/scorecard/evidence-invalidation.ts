// Automatic invalidation of stale verifications — the guard that keeps
// `scripts/sync-marker-bills.ts` honest.
//
// The problem this exists to close: the sync upserts MarkerAchievement rows on
// every run, overwriting `actionTaken`, `evidenceType`, `evidenceSourceUrl`,
// `evidenceNotes` and `sponsorTier` with whatever LegiScan says today. It did
// that to VERIFIED rows too, without touching `reviewStatus`. So a row could
// claim "a named human opened this citation and agreed" while pointing at
// evidence that arrived after the review — a roll call re-tallied, a bill URL
// re-pointed, a sponsor added. The published score still traced to a human,
// but to a human who had approved something else.
//
// docs/scorecard-methodology.md promises every published score traces to
// human-verified evidence. A silently stale approval breaks that promise in
// the one direction that matters: it looks fine.
//
// Pure logic only — no Prisma, no I/O. The sync script reads the existing row,
// calls `planEvidenceInvalidation`, and persists whatever comes back inside the
// same transaction as the evidence write.

import type { ReviewStatus, TrustTier } from './verification';

/**
 * Provenance label written into `MarkerAchievementReview.reviewerEmail` for an
 * automatic invalidation. Deliberately not an address: nobody did this, and the
 * audit strip must not imply somebody did. Mirrors the machine-provenance
 * convention already used by `verifiedBy` ('pac-engine', 'auto-verify-temp').
 */
export const SYNC_INVALIDATOR_LABEL = 'sync-marker-bills';

/**
 * Evidence fields a re-sync may rewrite. A change to any of them means the
 * reviewer's approval no longer covers what the row now says.
 *
 * `evidenceNotes` is in this list on purpose even though it reads like prose.
 * It carries the specific recorded position ("Recorded NOT_VOTING on the roll
 * call") which `actionTaken` collapses to ACTED_AGAINST — a distinction a
 * reviewer would care about. The cost is that editing a note template in the
 * sync script invalidates every row it touches; the dry-run report exists so
 * that lands as a visible number before the write, not as a surprise backlog.
 *
 * `achieved` is deliberately absent: it is derived from `actionTaken` and would
 * only ever double-count a change already detected.
 */
export const MATERIAL_EVIDENCE_FIELDS = [
  'actionTaken',
  'evidenceType',
  'evidenceSourceUrl',
  'evidenceNotes',
  'sponsorTier',
] as const;

export type EvidenceFieldName = (typeof MATERIAL_EVIDENCE_FIELDS)[number];

/** The evidence half of a MarkerAchievement, as plain comparable values. */
export type EvidenceSnapshot = Record<EvidenceFieldName, string | null>;

export interface EvidenceFieldChange {
  field: EvidenceFieldName;
  before: string | null;
  after: string | null;
}

/** The review half of a MarkerAchievement — what decides whether we invalidate. */
export interface ReviewedAchievementRow extends EvidenceSnapshot {
  id: string;
  reviewStatus: ReviewStatus;
  verifiedAt: Date | null;
  verifierUserId: string | null;
  verifiedFromUrl: string | null;
}

/** Fields to write onto MarkerAchievement alongside the new evidence. */
export interface InvalidationUpdate {
  reviewStatus: 'PENDING';
  verifiedAt: null;
  verifiedBy: null;
  verifierUserId: null;
  verifiedFromUrl: null;
  reviewNote: string;
  rejectedAt: null;
}

/** Row to append to MarkerAchievementReview. */
export interface InvalidationAudit {
  achievementId: string;
  reviewerUserId: null;
  reviewerEmail: string;
  action: 'AUTO_INVALIDATE';
  previousStatus: 'VERIFIED';
  /** The URL the reviewer stated they opened, preserved before it is cleared. */
  citationUrl: string | null;
  note: string;
}

export interface EvidenceInvalidation {
  achievementId: string;
  /**
   * Which tier the approval held before this. GREEN = a named human approved
   * it, so this invalidation returns real work to the queue. YELLOW = a machine
   * stamped it. Both go back to PENDING; only the GREEN count is a backlog a
   * person has to work through, so the report separates them.
   */
  previousTier: Extract<TrustTier, 'GREEN' | 'YELLOW'>;
  changes: EvidenceFieldChange[];
  update: InvalidationUpdate;
  audit: InvalidationAudit;
}

/** Normalize for comparison so '' and null (and stray whitespace) don't churn. */
function normalize(value: string | null | undefined): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : value ?? null;
  return trimmed || null;
}

/** Every material field whose value differs between the stored and incoming evidence. */
export function diffEvidence(before: EvidenceSnapshot, after: EvidenceSnapshot): EvidenceFieldChange[] {
  const changes: EvidenceFieldChange[] = [];
  for (const field of MATERIAL_EVIDENCE_FIELDS) {
    const from = normalize(before[field]);
    const to = normalize(after[field]);
    if (from !== to) changes.push({ field, before: from, after: to });
  }
  return changes;
}

/** One-line human summary of a diff, for the audit note and the CLI report. */
export function describeChanges(changes: EvidenceFieldChange[]): string {
  return changes.map((c) => `${c.field}: ${c.before ?? '—'} → ${c.after ?? '—'}`).join('; ');
}

/**
 * Decide whether this sync write invalidates an existing verification.
 *
 * Returns null — meaning "write the evidence and leave the review state alone"
 * — in every case except one: the row is VERIFIED and at least one material
 * evidence field is actually changing.
 *
 * Notably NOT invalidated:
 *
 *  - PENDING rows. Nothing to invalidate; they are already in the queue.
 *  - REJECTED rows. A reviewer looked and said no. Re-queueing them on every
 *    evidence tweak is exactly the "rejected claims re-queue forever" failure
 *    the Phase 6 schema comment warns about, so a rejection stands until a
 *    person reopens it.
 *  - VERIFIED rows whose evidence is unchanged. Re-running the sync must be
 *    idempotent, or the queue fills up with rows nobody needs to look at.
 */
export function planEvidenceInvalidation(
  existing: ReviewedAchievementRow | null | undefined,
  incoming: EvidenceSnapshot,
): EvidenceInvalidation | null {
  // A row that does not exist yet is created PENDING — nothing to invalidate.
  if (!existing) return null;
  if (existing.reviewStatus !== 'VERIFIED') return null;

  const changes = diffEvidence(existing, incoming);
  if (changes.length === 0) return null;

  const summary = describeChanges(changes);
  const note = `Automatically returned to PENDING: sync-marker-bills rewrote evidence this verification did not cover. ${summary}`;

  return {
    achievementId: existing.id,
    previousTier: existing.verifierUserId !== null ? 'GREEN' : 'YELLOW',
    changes,
    update: {
      reviewStatus: 'PENDING',
      // Clearing verifiedAt drops the row out of scoring until it is reviewed
      // again — the same lever `planReview`'s REVOKE pulls. A published score
      // built on evidence nobody has seen is the thing we are preventing.
      verifiedAt: null,
      verifiedBy: null,
      verifierUserId: null,
      // The URL the reviewer opened is preserved on the audit row before it is
      // cleared here, so the trail still shows what they actually read.
      verifiedFromUrl: null,
      reviewNote: note,
      rejectedAt: null,
    },
    audit: {
      achievementId: existing.id,
      reviewerUserId: null,
      reviewerEmail: SYNC_INVALIDATOR_LABEL,
      action: 'AUTO_INVALIDATE',
      previousStatus: 'VERIFIED',
      citationUrl: normalize(existing.verifiedFromUrl),
      note,
    },
  };
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

/**
 * Running tally of what a sync invalidated (or, under --dry-run, would have).
 *
 * The point of counting is that a re-sync must not be able to quietly dump a
 * large backlog back into the verification queue. A number on stdout — before
 * the write, under --dry-run — is what makes that decision deliberate.
 */
export interface InvalidationReport {
  total: number;
  /** Rows a named human had approved. This is the real re-review backlog. */
  humanVerified: number;
  /** Rows a machine had stamped (auto-verify stand-in / PAC engine). */
  machineVerified: number;
  /** How many invalidations each material field was responsible for. */
  byField: Record<EvidenceFieldName, number>;
  entries: InvalidationReportEntry[];
}

export interface InvalidationReportEntry {
  achievementId: string;
  legislatorName: string;
  markerName: string;
  previousTier: 'GREEN' | 'YELLOW';
  changes: EvidenceFieldChange[];
}

export function newInvalidationReport(): InvalidationReport {
  return {
    total: 0,
    humanVerified: 0,
    machineVerified: 0,
    byField: Object.fromEntries(MATERIAL_EVIDENCE_FIELDS.map((f) => [f, 0])) as Record<EvidenceFieldName, number>,
    entries: [],
  };
}

/** Fold one invalidation into the running tally, returning the updated report. */
export function recordInvalidation(
  report: InvalidationReport,
  invalidation: EvidenceInvalidation,
  context: { legislatorName: string; markerName: string },
): InvalidationReport {
  const byField = { ...report.byField };
  for (const change of invalidation.changes) byField[change.field] += 1;

  const isHuman = invalidation.previousTier === 'GREEN';
  return {
    total: report.total + 1,
    humanVerified: report.humanVerified + (isHuman ? 1 : 0),
    machineVerified: report.machineVerified + (isHuman ? 0 : 1),
    byField,
    entries: [
      ...report.entries,
      {
        achievementId: invalidation.achievementId,
        legislatorName: context.legislatorName,
        markerName: context.markerName,
        previousTier: invalidation.previousTier,
        changes: invalidation.changes,
      },
    ],
  };
}

/** Render the report for the CLI. `dryRun` only changes the tense of the copy. */
export function formatInvalidationReport(report: InvalidationReport, options: { dryRun: boolean }): string {
  const verb = options.dryRun ? 'would be' : 'were';
  if (report.total === 0) {
    return `[invalidations] none — no verified achievement ${verb === 'were' ? 'had' : 'has'} its evidence rewritten.`;
  }

  const lines: string[] = [
    `[invalidations] ${report.total} verified achievement${report.total === 1 ? '' : 's'} ${verb} returned to PENDING`,
    `  ${report.humanVerified} human-verified (re-review backlog) · ${report.machineVerified} machine-verified`,
  ];

  const fields = MATERIAL_EVIDENCE_FIELDS.filter((f) => report.byField[f] > 0);
  lines.push(`  by field: ${fields.map((f) => `${f}=${report.byField[f]}`).join(' ')}`);

  // A field count equal to the total on a prose-only field is the signature of
  // a note-template edit rather than a real evidence change. Say so, because
  // the fix in that case is to correct the template, not to re-review anything.
  if (report.total > 1 && report.byField.evidenceNotes === report.total && fields.length === 1) {
    lines.push(
      `  NOTE: every invalidation is an evidenceNotes-only change. That usually means a note template changed, not the underlying evidence.`,
    );
  }

  for (const entry of report.entries) {
    lines.push(
      `  - [${entry.previousTier}] ${entry.legislatorName} · ${entry.markerName} — ${describeChanges(entry.changes)}`,
    );
  }
  return lines.join('\n');
}
