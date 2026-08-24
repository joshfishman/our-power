import { describe, it, expect } from 'vitest';
import {
  MATERIAL_EVIDENCE_FIELDS,
  SYNC_INVALIDATOR_LABEL,
  describeChanges,
  diffEvidence,
  formatInvalidationReport,
  newInvalidationReport,
  planEvidenceInvalidation,
  recordInvalidation,
  type EvidenceSnapshot,
  type ReviewedAchievementRow,
} from '@/lib/scorecard/evidence-invalidation';

const VERIFIED_AT = new Date('2026-08-01T09:00:00.000Z');

const evidence = (overrides: Partial<EvidenceSnapshot> = {}): EvidenceSnapshot => ({
  actionTaken: 'ACTED_FOR',
  evidenceType: 'VOTE',
  evidenceSourceUrl: 'https://legiscan.com/US/bill/HB1/2025',
  evidenceNotes: 'Voted yes per LegiScan roll call',
  sponsorTier: null,
  ...overrides,
});

const humanVerifiedRow = (overrides: Partial<ReviewedAchievementRow> = {}): ReviewedAchievementRow => ({
  id: 'ach_1',
  reviewStatus: 'VERIFIED',
  verifiedAt: VERIFIED_AT,
  verifierUserId: 'user_7',
  verifiedFromUrl: 'https://clerk.house.gov/Votes/2025101',
  ...evidence(),
  ...overrides,
});

describe('diffEvidence', () => {
  it('reports no change when the incoming evidence matches', () => {
    expect(diffEvidence(evidence(), evidence())).toEqual([]);
  });

  it('treats null, empty string, and whitespace as the same absent value', () => {
    const before = evidence({ evidenceSourceUrl: null, sponsorTier: '' });
    const after = evidence({ evidenceSourceUrl: '   ', sponsorTier: null });
    expect(diffEvidence(before, after)).toEqual([]);
  });

  it('reports every material field that changed', () => {
    const changes = diffEvidence(evidence(), evidence({ actionTaken: 'ACTED_AGAINST', evidenceNotes: 'Recorded NO' }));
    expect(changes.map((c) => c.field).sort()).toEqual(['actionTaken', 'evidenceNotes']);
  });

  it('covers exactly the documented material field set', () => {
    expect([...MATERIAL_EVIDENCE_FIELDS]).toEqual([
      'actionTaken',
      'evidenceType',
      'evidenceSourceUrl',
      'evidenceNotes',
      'sponsorTier',
    ]);
  });
});

describe('planEvidenceInvalidation', () => {
  it('does nothing for a row that does not exist yet', () => {
    expect(planEvidenceInvalidation(null, evidence())).toBeNull();
  });

  it('does nothing when a verified row is re-synced with identical evidence', () => {
    // Idempotence matters: without it, every routine sync refills the queue.
    expect(planEvidenceInvalidation(humanVerifiedRow(), evidence())).toBeNull();
  });

  it('does nothing to a PENDING row — it is already in the queue', () => {
    const row = humanVerifiedRow({ reviewStatus: 'PENDING', verifierUserId: null, verifiedAt: null });
    expect(planEvidenceInvalidation(row, evidence({ actionTaken: 'ACTED_AGAINST' }))).toBeNull();
  });

  it('does nothing to a REJECTED row, so rejected claims do not re-queue forever', () => {
    const row = humanVerifiedRow({ reviewStatus: 'REJECTED', verifiedAt: null, verifierUserId: null });
    expect(planEvidenceInvalidation(row, evidence({ evidenceSourceUrl: 'https://example.org/other' }))).toBeNull();
  });

  it('resets a human-verified row to PENDING when the evidence changes', () => {
    const plan = planEvidenceInvalidation(humanVerifiedRow(), evidence({ actionTaken: 'ACTED_AGAINST' }));

    expect(plan).not.toBeNull();
    expect(plan!.previousTier).toBe('GREEN');
    expect(plan!.update.reviewStatus).toBe('PENDING');
    expect(plan!.update.verifiedAt).toBeNull();
    expect(plan!.update.verifierUserId).toBeNull();
    expect(plan!.update.verifiedBy).toBeNull();
    expect(plan!.update.verifiedFromUrl).toBeNull();
    expect(plan!.update.rejectedAt).toBeNull();
  });

  it('writes an audit row that preserves what the reviewer actually opened', () => {
    const plan = planEvidenceInvalidation(humanVerifiedRow(), evidence({ evidenceSourceUrl: 'https://new.example' }));

    expect(plan!.audit).toMatchObject({
      achievementId: 'ach_1',
      reviewerUserId: null,
      reviewerEmail: SYNC_INVALIDATOR_LABEL,
      action: 'AUTO_INVALIDATE',
      previousStatus: 'VERIFIED',
      citationUrl: 'https://clerk.house.gov/Votes/2025101',
    });
    expect(plan!.audit.note).toContain('evidenceSourceUrl');
    expect(plan!.audit.note).toContain('https://new.example');
  });

  it('marks a machine-verified row YELLOW so the human backlog stays countable', () => {
    const row = humanVerifiedRow({ verifierUserId: null, verifiedFromUrl: null });
    const plan = planEvidenceInvalidation(row, evidence({ evidenceType: 'COSPONSOR' }));

    expect(plan!.previousTier).toBe('YELLOW');
    expect(plan!.audit.citationUrl).toBeNull();
  });

  it('invalidates on a sponsorTier change alone', () => {
    const plan = planEvidenceInvalidation(humanVerifiedRow(), evidence({ sponsorTier: 'PRINCIPAL_COAUTHOR' }));
    expect(plan!.changes).toEqual([{ field: 'sponsorTier', before: null, after: 'PRINCIPAL_COAUTHOR' }]);
  });
});

describe('describeChanges', () => {
  it('renders absent values as an em dash', () => {
    expect(describeChanges([{ field: 'sponsorTier', before: null, after: 'AUTHOR' }])).toBe('sponsorTier: — → AUTHOR');
  });
});

describe('invalidation report', () => {
  const build = (rows: Array<{ row: ReviewedAchievementRow; incoming: EvidenceSnapshot; name: string }>) => {
    let report = newInvalidationReport();
    for (const { row, incoming, name } of rows) {
      const plan = planEvidenceInvalidation(row, incoming);
      if (plan) report = recordInvalidation(report, plan, { legislatorName: name, markerName: 'Stock trading ban' });
    }
    return report;
  };

  it('counts human- and machine-verified invalidations separately', () => {
    const report = build([
      { row: humanVerifiedRow(), incoming: evidence({ actionTaken: 'ACTED_AGAINST' }), name: 'Rep. A' },
      {
        row: humanVerifiedRow({ id: 'ach_2', verifierUserId: null }),
        incoming: evidence({ evidenceType: 'COSPONSOR' }),
        name: 'Rep. B',
      },
    ]);

    expect(report.total).toBe(2);
    expect(report.humanVerified).toBe(1);
    expect(report.machineVerified).toBe(1);
    expect(report.byField.actionTaken).toBe(1);
    expect(report.byField.evidenceType).toBe(1);
    expect(report.entries).toHaveLength(2);
  });

  it('reports nothing when no verification was touched', () => {
    const text = formatInvalidationReport(newInvalidationReport(), { dryRun: true });
    expect(text).toContain('none');
  });

  it('leads a dry run with the count and the human backlog split', () => {
    const report = build([
      { row: humanVerifiedRow(), incoming: evidence({ actionTaken: 'ACTED_AGAINST' }), name: 'Rep. A' },
    ]);
    const text = formatInvalidationReport(report, { dryRun: true });

    expect(text).toContain('1 verified achievement would be returned to PENDING');
    expect(text).toContain('1 human-verified');
    expect(text).toContain('Rep. A');
  });

  it('flags a notes-only sweep as a likely template edit rather than real churn', () => {
    const report = build([
      { row: humanVerifiedRow(), incoming: evidence({ evidenceNotes: 'reworded' }), name: 'Rep. A' },
      { row: humanVerifiedRow({ id: 'ach_2' }), incoming: evidence({ evidenceNotes: 'reworded' }), name: 'Rep. B' },
    ]);
    const text = formatInvalidationReport(report, { dryRun: true });

    expect(text).toContain('note template changed');
  });
});
