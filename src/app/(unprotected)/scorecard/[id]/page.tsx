/* eslint-disable @typescript-eslint/no-use-before-define */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  findLegislatorByAnyId,
  getPublicPlanks,
  computePublishedTotal,
  computePlankCoverage,
  getLegislatorPacScore,
  computeTwoScoreAverage,
  getLegislatorBillBreakdown,
  getLegislatorMoneyTrail,
  getTopDonorsForLegislator,
  getOpposedByPacs,
  getLegislatorLeadershipPacInflows,
  getLegislatorIndividualMoney,
  getLegislatorPacInfluence20222024,
  getLegislatorDimeProfile,
} from '@/lib/scorecard/queries';
import type {
  BillBreakdownRow,
  PacMoneyTrail,
  TopDonor,
  LeadershipPacInflows,
  IndividualMoney,
  DimeProfile,
} from '@/lib/scorecard/queries';
import { METHODOLOGY_VERSION } from '@/lib/scorecard/scoring';
import { LegislatorAvatar } from '@/components/scorecard/LegislatorAvatar';

type Props = { params: Promise<{ id: string }> };

const PARTY_LABEL: Record<string, string> = {
  D: 'Democrat',
  R: 'Republican',
  I: 'Independent',
};

const CHAMBER_LABEL_FEDERAL: Record<string, string> = {
  SEN: 'U.S. Senate',
  REP: 'U.S. House of Representatives',
};

const CHAMBER_LABEL_STATE: Record<string, string> = {
  SEN: 'California State Senate',
  REP: 'California State Assembly',
};

export async function generateMetadata(props: Props): Promise<Metadata> {
  const params = await props.params;
  const legislator = await findLegislatorByAnyId(decodeURIComponent(params.id));
  if (!legislator) return { title: 'Legislator not found | Scorecard' };
  return {
    title: `${legislator.fullName} | Scorecard`,
    description: `We the People scorecard for ${legislator.fullName} — same rubric applied to every legislator.`,
  };
}

export default async function LegislatorScorecardPage(props: Props) {
  const params = await props.params;
  const legislator = await findLegislatorByAnyId(decodeURIComponent(params.id));
  if (!legislator) notFound();

  const jurisdiction = legislator.jurisdiction as 'FEDERAL' | 'CA';
  const planks = await getPublicPlanks(jurisdiction);
  // v1.7.1 two-score model:
  //   Voting Record = mean of per-plank alignment percentages (0-100)
  //   PAC Score     = v1.7.1 computed from PacContribution per-class breakdown
  //                   (CORPORATE + DARK_MONEY + FOREIGN_POLICY / total influence)
  //   Avg           = simple mean of the two
  // We compute the money trail in parallel; v1.7.1 PAC Score and per-class
  // breakdown both come out of getLegislatorMoneyTrail.
  // For CA legislators we don't have PacContribution data — fall back to the
  // legacy v1.7 PAC score from PacMoneyData.
  const votingScore = computePublishedTotal(legislator.scores);
  const [
    moneyTrail,
    topDonors,
    opposedBy,
    legacyPacScore,
    leadershipPacInflows,
    individualMoney,
    pacInfluence2Cyc,
    dimeProfile,
  ] = await Promise.all([
    jurisdiction === 'FEDERAL' ? getLegislatorMoneyTrail(legislator.id) : Promise.resolve(null as PacMoneyTrail | null),
    jurisdiction === 'FEDERAL' ? getTopDonorsForLegislator(legislator.id, 15) : Promise.resolve([] as TopDonor[]),
    jurisdiction === 'FEDERAL' ? getOpposedByPacs(legislator.id, 10) : Promise.resolve([] as TopDonor[]),
    getLegislatorPacScore(legislator.id),
    jurisdiction === 'FEDERAL'
      ? getLegislatorLeadershipPacInflows(legislator.id)
      : Promise.resolve(null as LeadershipPacInflows | null),
    jurisdiction === 'FEDERAL'
      ? getLegislatorIndividualMoney(legislator.id)
      : Promise.resolve(null as IndividualMoney | null),
    // v1.8.2 — cycle-matched PAC influence so the Individual vs PAC % isn't
    // structurally PAC-biased (individual data is 2022 + 2024 only).
    jurisdiction === 'FEDERAL' ? getLegislatorPacInfluence20222024(legislator.id) : Promise.resolve(0),
    jurisdiction === 'FEDERAL' ? getLegislatorDimeProfile(legislator.id) : Promise.resolve(null as DimeProfile | null),
  ]);
  const pacScore = moneyTrail?.pacScore ?? legacyPacScore;
  const avgScore = computeTwoScoreAverage(pacScore, votingScore);
  const chamberLabel =
    jurisdiction === 'FEDERAL' ? CHAMBER_LABEL_FEDERAL[legislator.chamber] : CHAMBER_LABEL_STATE[legislator.chamber];

  // v1.7.1 — per-plank bill breakdown. Every bill that contributes to each
  // plank's score, with the legislator's position (vote and/or cosponsorship).
  const billBreakdown = await getLegislatorBillBreakdown(
    legislator.id,
    jurisdiction,
    legislator.chamber as 'SEN' | 'REP',
  );

  // Index achievements by markerId for fast lookup in the per-plank grid.
  const achievementByMarker = new Map(legislator.achievements.map((a) => [a.markerId, a]));
  const scoreByPlank = new Map(legislator.scores.map((s) => [s.plankId, s]));

  // Coverage stat per plank: how many markers do we actually have a
  // position record for? Drives the "based on X of Y measured" indicator
  // and dampens the visual weight of low-coverage 0/5 scores.
  // Pass bills+slug through so empty markers don't dilute the denominator.
  const coverageByPlank = computePlankCoverage(
    planks.map((p) => ({
      id: p.id,
      markers: p.markers.map((m) => ({ id: m.id, slug: m.slug, bills: m.bills ?? [] })),
    })),
    legislator.achievements as Array<{
      markerId: string;
      actionTaken?: 'ACTED_FOR' | 'ACTED_AGAINST' | 'NO_RECORD' | null;
    }>,
  );

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="flex items-baseline justify-between gap-3">
        <Link href="/scorecard" className="text-sm text-gray-600 hover:text-gray-900">
          ← Back to scorecard
        </Link>
        {/* v1.8.6 — single canonical methodology stamp at the top of the page.
            Sub-stamps inside each section read as "introduced in vX" notes,
            not as conflicting page-wide versions. */}
        <Link
          href="/scorecard/methodology"
          title="Methodology version applied to every score on this page"
          className="font-mono text-[10px] uppercase tracking-widest text-[#2C4A5E]/80 hover:text-[#8B3A3A]">
          Methodology {METHODOLOGY_VERSION} (latest applied) →
        </Link>
      </div>

      <header className="mt-4 flex items-center gap-6 border-b-2 border-gray-900 pb-6">
        <LegislatorAvatar fullName={legislator.fullName} photoUrl={legislator.photoUrl} size={96} />
        <div className="min-w-0 flex-1">
          <p className="font-mono text-xs uppercase tracking-widest text-gray-500">{chamberLabel}</p>
          <h1 className="mt-1 font-serif text-4xl font-bold text-gray-900">{legislator.fullName}</h1>
          <p className="mt-1 text-base text-gray-700">
            {PARTY_LABEL[legislator.party] ?? legislator.party} · {legislator.state}
            {legislator.district != null && legislator.chamber === 'REP' ? `, District ${legislator.district}` : ''}
          </p>
        </div>
        <div className="text-right">
          {avgScore === null ? (
            <div>
              <p className="font-mono text-xs uppercase tracking-widest text-gray-500">Score pending</p>
              <p className="mt-1 text-sm text-gray-600">Methodology {METHODOLOGY_VERSION} — no data yet</p>
            </div>
          ) : (
            <HeroTwoScore
              pacScore={pacScore}
              votingScore={votingScore}
              avgScore={avgScore}
              planksCount={legislator.scores.length}
            />
          )}
        </div>
      </header>

      {avgScore === null && (
        <div className="mt-6 rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-semibold">Scoring is in development.</p>
          <p className="mt-1">
            The methodology and marker definitions are public. The automated pipeline that pulls cosponsorship, vote,
            and PAC-money data has not yet been verified for{' '}
            {jurisdiction === 'FEDERAL' ? 'the 119th Congress' : 'the 2025-2026 California session'}, so no score is
            published. Markers below show the structure that will be scored.
          </p>
        </div>
      )}

      {jurisdiction === 'FEDERAL' && moneyTrail && moneyTrail.totalInfluence > 0 && (
        <MoneyTrail moneyTrail={moneyTrail} topDonors={topDonors} opposedBy={opposedBy} />
      )}

      {jurisdiction === 'FEDERAL' && leadershipPacInflows && leadershipPacInflows.pacCount > 0 && (
        <LeadershipPacInflowsSection inflows={leadershipPacInflows} />
      )}

      {jurisdiction === 'FEDERAL' && dimeProfile && (
        <DonorProfileSection profile={dimeProfile} party={legislator.party} />
      )}

      {jurisdiction === 'FEDERAL' && individualMoney && individualMoney.totalItemized > 0 && (
        <IndividualMoneySection money={individualMoney} pacTotalInfluence2Cyc={pacInfluence2Cyc} />
      )}

      <section className="mt-8 space-y-8">
        {planks.map((plank) => {
          const plankScore = scoreByPlank.get(plank.id);
          const coverage = coverageByPlank.get(plank.id);
          const isLowCoverage =
            coverage !== undefined &&
            coverage.totalMarkers > 0 &&
            coverage.measuredMarkers / coverage.totalMarkers < 0.5;
          return (
            <article key={plank.id} className="border-l-4 border-gray-900 pl-4">
              <header className="flex items-baseline justify-between">
                <h2 className="font-serif text-2xl font-bold text-gray-900">
                  Plank {plank.number}. {plank.name}
                </h2>
                <span
                  className={isLowCoverage ? 'opacity-50' : ''}
                  title={isLowCoverage ? 'Score is based on limited data — see coverage note below' : undefined}>
                  {plankScore ? (
                    <ScoreNumber value={plankScore.score} size="plank" />
                  ) : (
                    <span className="font-serif text-2xl font-bold text-gray-400">—</span>
                  )}
                </span>
              </header>
              <p className="mt-1 italic text-gray-700">{plank.tagline}</p>
              {coverage && (
                <p className="mt-1 font-mono text-xs uppercase tracking-wide text-gray-500">
                  {coverage.measuredMarkers === 0
                    ? `No position records yet · ${coverage.totalMarkers} markers tracked`
                    : `Based on ${coverage.measuredMarkers} of ${coverage.totalMarkers} markers measured · ${coverage.forCount} for · ${coverage.againstCount} against`}
                </p>
              )}

              <BillBreakdownList breakdown={billBreakdown.get(plank.number)?.bills ?? []} />

              {(() => {
                // Only render markers where this legislator has a recorded
                // position (ACTED_FOR or ACTED_AGAINST). NO_RECORD markers
                // are surfaced in the "Not weighed in on" section below the
                // planks, so the per-plank list stays focused on what they
                // actually did.
                const positioned = plank.markers.filter((m) => {
                  const ach = achievementByMarker.get(m.id) as
                    | { actionTaken?: AchievementStatus | null; achieved?: boolean }
                    | undefined;
                  const status = (ach?.actionTaken ?? (ach?.achieved ? 'ACTED_FOR' : 'NO_RECORD')) as AchievementStatus;
                  return status === 'ACTED_FOR' || status === 'ACTED_AGAINST';
                });
                if (positioned.length === 0) {
                  return (
                    <p className="mt-4 text-sm italic text-gray-500">
                      No positions recorded for this plank yet — see &ldquo;Not weighed in on&rdquo; below.
                    </p>
                  );
                }
                return (
                  <ul className="mt-4 space-y-2">
                    {positioned.map((marker) => {
                      const achievement = achievementByMarker.get(marker.id);
                      const status = ((achievement as unknown as { actionTaken?: AchievementStatus | null })
                        ?.actionTaken ?? (achievement?.achieved ? 'ACTED_FOR' : 'NO_RECORD')) as AchievementStatus;
                      return (
                        <li key={marker.id} className="flex items-start gap-3 text-sm">
                          <MarkerStatusIcon status={status} />
                          <div className="flex-1">
                            <p className="font-medium text-gray-900">
                              {marker.name}
                              {/* "Primary" / "GOP alt" badges hidden until we have clearer copy
                                  for what they mean (they were being read as per-legislator
                                  credit rather than marker-type labels). */}
                              <SponsorBadge
                                tier={(achievement as unknown as { sponsorTier?: string | null })?.sponsorTier ?? null}
                              />
                              {marker.slug?.includes('corporate-pac-refusal') ? (
                                <PacContinuousScore
                                  achievementScore={
                                    (achievement as unknown as { achievementScore?: unknown })?.achievementScore
                                  }
                                  evidenceNotes={achievement?.evidenceNotes ?? null}
                                />
                              ) : null}
                            </p>
                            {achievement?.evidenceSourceUrl && (
                              <a
                                href={achievement.evidenceSourceUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="mt-0.5 block text-xs text-gray-600 underline hover:text-gray-900">
                                Evidence →
                              </a>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                );
              })()}
            </article>
          );
        })}
      </section>

      <NoRecordOpportunities
        planks={planks}
        achievementByMarker={achievementByMarker}
        legislatorName={legislator.fullName}
      />

      <footer className="mt-12 border-t-2 border-gray-900 pt-4 text-xs text-gray-500">
        <p>
          Same rubric applied to every legislator.{' '}
          <Link href="/scorecard/methodology" className="underline hover:text-[#8B3A3A]">
            Methodology {METHODOLOGY_VERSION} →
          </Link>{' '}
          <Link href="/scorecard" className="underline">
            See the full scorecard
          </Link>
          .
        </p>
      </footer>
    </div>
  );
}

/** v1.7 hero — two scores side-by-side with the Average as the headline.
 *  Layout (right-aligned in the page header):
 *
 *     ┌───────┬───────┬───────────┐
 *     │  PAC  │ Voting│  AVERAGE  │
 *     │  82%  │  67%  │    75%    │
 *     └───────┴───────┴───────────┘
 *
 *  The Average is rendered a step larger so the eye lands on it first.
 *  Either of PAC or Voting can be null (e.g. no PAC data yet) — we render
 *  "—" for the missing side and let the user know via a sub-line. */
function HeroTwoScore({
  pacScore,
  votingScore,
  avgScore,
  planksCount,
}: {
  pacScore: number | null;
  votingScore: number | null;
  avgScore: number;
  planksCount: number;
}) {
  return (
    <div className="flex items-end justify-end gap-3">
      <HeroCell label="PAC" value={pacScore} />
      <HeroCell label="Voting" value={votingScore} subline={planksCount > 0 ? `${planksCount}-plank avg` : undefined} />
      <HeroCell label="Average" value={avgScore} large />
    </div>
  );
}

function HeroCell({
  label,
  value: rawValue,
  large = false,
  subline,
}: {
  label: string;
  value: number | null;
  large?: boolean;
  subline?: string;
}) {
  // v1.8.6 — clamp the displayed value to ≥0 so the hero tiles never read as
  // a "−2% Voting" (a few legislators have plank-level scores that arithmetic
  // out below zero in edge cases). The raw stored score is untouched; this is
  // a render-layer guard only.
  const value = rawValue === null ? null : Math.max(0, rawValue);
  // v1.7 — steep gradient inside the 30-70% band where the real distribution
  // lives. Pinned to natural percentages, no calibration.
  const colorClass =
    value === null
      ? 'text-gray-400'
      : value >= 80
      ? 'text-green-700'
      : value >= 70
      ? 'text-green-600'
      : value >= 60
      ? 'text-lime-600'
      : value >= 50
      ? 'text-yellow-600'
      : value >= 40
      ? 'text-amber-600'
      : value >= 30
      ? 'text-orange-600'
      : value >= 20
      ? 'text-red-500'
      : 'text-red-700';
  const sizeClass = large ? 'text-6xl' : 'text-4xl';
  return (
    <div className={large ? 'min-w-[6rem]' : 'min-w-[4rem]'}>
      <p className="font-mono text-[10px] uppercase tracking-widest text-gray-500">{label}</p>
      <p className={`mt-0.5 font-serif font-bold tabular-nums ${colorClass} ${sizeClass}`}>
        {value === null ? '—' : `${value}%`}
      </p>
      {subline && <p className="mt-0.5 font-mono text-[9px] uppercase tracking-wide text-gray-400">{subline}</p>}
    </div>
  );
}

/** v1.4 — renders the continuous PAC marker score (e.g. "+1.8 · 1.2% combined
 *  corporate donations") next to the marker name. Pulls the ratio out of
 *  `evidenceNotes` (written by scripts/compute-scores.ts as
 *  `combined-corporate=<n>%`). If the achievementScore is missing, renders
 *  nothing — caller already has the marker's name + ✓/✗ icon to convey state. */
function PacContinuousScore({
  achievementScore,
  evidenceNotes,
}: {
  achievementScore: unknown;
  evidenceNotes: string | null;
}) {
  if (achievementScore === null || achievementScore === undefined) return null;
  const score = Number(achievementScore);
  if (!Number.isFinite(score)) return null;
  const ratioMatch = evidenceNotes?.match(/combined-corporate=(\d+(?:\.\d+)?)%/);
  const ratio = ratioMatch ? parseFloat(ratioMatch[1]) : null;
  return (
    <span className="ml-2 font-mono text-xs text-gray-600">
      {score.toFixed(1)}
      {ratio !== null ? ` · ${ratio.toFixed(1)}% combined corporate donations` : ''}
    </span>
  );
}

/** Per-plank score renderer. Under v1.7 each plank score is a 0-100
 *  alignment percent (votes + cosponsorship folded together at the bill
 *  level), so we color it on the same steep gradient as the hero. */
function ScoreNumber({ value: rawValue, size }: { value: number; size: 'hero' | 'plank' }) {
  // v1.8.6 — clamp the displayed plank score to ≥0. Raw `RepresentativeScore`
  // rows occasionally compute slightly negative when a plank has more
  // misaligned secondary votes than aligned ones with the current weights;
  // surfacing "Plank 1 −1%" reads as broken to a casual viewer. Stored value
  // is unchanged.
  const value = Math.max(0, rawValue);
  const colorClass =
    value >= 80
      ? 'text-green-700'
      : value >= 70
      ? 'text-green-600'
      : value >= 60
      ? 'text-lime-600'
      : value >= 50
      ? 'text-yellow-600'
      : value >= 40
      ? 'text-amber-600'
      : value >= 30
      ? 'text-orange-600'
      : value >= 20
      ? 'text-red-500'
      : 'text-red-700';
  const sizeClass =
    size === 'hero' ? 'font-serif text-5xl font-bold tabular-nums' : 'font-serif text-2xl font-bold tabular-nums';
  return <span className={`${sizeClass} ${colorClass}`}>{value}%</span>;
}

/** Three-state position icon. ACTED_FOR = brick-red ✓, ACTED_AGAINST = solid
 *  ✗ outlined in slate, NO_RECORD = dashed circle with ?. The asymmetry is
 *  deliberate: "we don't know" should look distinct from "they took the
 *  opposite side" — that's the whole point of the v1.1 redesign. */
type AchievementStatus = 'ACTED_FOR' | 'ACTED_AGAINST' | 'NO_RECORD';
function MarkerStatusIcon({ status }: { status: AchievementStatus }) {
  if (status === 'ACTED_FOR') {
    return (
      <span
        aria-label="Acted for"
        title="Acted for — cosponsored / voted yes"
        className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#8B3A3A] text-xs font-bold text-white">
        ✓
      </span>
    );
  }
  if (status === 'ACTED_AGAINST') {
    return (
      <span
        aria-label="Acted against"
        title="Acted against — voted no on a marker requiring yes"
        className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-[#2C4A5E] bg-[#F5DEB3] text-xs font-bold text-[#2C4A5E]">
        ✗
      </span>
    );
  }
  return (
    <span
      aria-label="No record"
      title="No record — we don't yet have this legislator's position on this marker"
      className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-dashed border-gray-400 text-xs text-gray-400">
      ?
    </span>
  );
}

/** Tier badge — only renders when an achievement traces to sponsorship.
 *  Author / principal coauthor get the high-emphasis brick-red badge;
 *  cosponsors get the muted slate-on-wheat. Vote-only ACTED_FOR rows
 *  render no badge (the ✓ icon is enough). */
function SponsorBadge({ tier }: { tier: string | null | undefined }) {
  if (!tier) return null;
  const isLead = tier === 'AUTHOR' || tier === 'PRINCIPAL_COAUTHOR' || tier === 'SPONSOR';
  const label =
    tier === 'AUTHOR'
      ? 'Author'
      : tier === 'PRINCIPAL_COAUTHOR'
      ? 'Principal coauthor'
      : tier === 'COAUTHOR'
      ? 'Coauthor'
      : tier === 'COSPONSOR'
      ? 'Cosponsor'
      : tier === 'SPONSOR'
      ? 'Sponsor'
      : tier;
  return (
    <span
      title={`${label} — credit traces to sponsorship`}
      className={
        isLead
          ? 'ml-2 rounded bg-[#8B3A3A] px-1.5 py-0.5 font-mono text-xs uppercase tracking-wide text-[#2C4A5E]'
          : 'ml-2 rounded border border-[#2C4A5E] bg-[#F5DEB3] px-1.5 py-0.5 font-mono text-xs uppercase tracking-wide text-[#2C4A5E]'
      }>
      {label}
    </span>
  );
}

/** Action-oriented section: lists markers where we have NO position record
 *  for this legislator, framed as "asks they haven't taken a position on yet."
 *  Empty-list legislators (those with full coverage) don't see this. */
interface NoRecordPlankMarker {
  id: string;
  name: string;
  bills: Array<{ id: string; publicSlug: string | null; billNumber: string; billTitle: string }>;
}
interface NoRecordPlank {
  id: string;
  number: number;
  name: string;
  markers: NoRecordPlankMarker[];
}
function NoRecordOpportunities({
  planks,
  achievementByMarker,
  legislatorName,
}: {
  planks: NoRecordPlank[];
  achievementByMarker: Map<string, { actionTaken?: 'ACTED_FOR' | 'ACTED_AGAINST' | 'NO_RECORD' | null }>;
  legislatorName: string;
}) {
  // Collect markers with bills + no position record
  const gaps: Array<{ plankNumber: number; plankName: string; marker: NoRecordPlankMarker }> = [];
  for (const p of planks) {
    for (const m of p.markers) {
      if (m.bills.length === 0) continue;
      const ach = achievementByMarker.get(m.id);
      const hasPosition =
        ach &&
        ((ach as { actionTaken?: string }).actionTaken === 'ACTED_FOR' ||
          (ach as { actionTaken?: string }).actionTaken === 'ACTED_AGAINST');
      if (!hasPosition) {
        gaps.push({ plankNumber: p.number, plankName: p.name, marker: m });
      }
    }
  }
  if (gaps.length === 0) return null;
  return (
    <section className="mt-12 rounded border border-[#2C4A5E] border-gray-200 bg-white p-5 shadow-sm">
      <h2 className="font-mono text-xs uppercase tracking-widest text-[#2C4A5E]">Not weighed in on</h2>
      <p className="mt-2 text-sm text-[#2C4A5E]">
        Markers with bills currently in committee or pending — {legislatorName} has not cosponsored or voted on any of
        them yet. Each one is an opportunity to take a public position.
      </p>
      <ul className="mt-4 space-y-3">
        {gaps.slice(0, 12).map(({ plankNumber, plankName, marker }) => (
          <li key={marker.id} className="text-sm">
            <p className="font-medium text-[#2C4A5E]">{marker.name}</p>
            <p className="text-xs text-[#2C4A5E]/80">
              Plank {plankNumber}. {plankName} ·{' '}
              {marker.bills.map((b, i) => (
                <span key={b.id}>
                  {i > 0 && ', '}
                  <Link
                    href={`/scorecard/bills/${encodeURIComponent(b.publicSlug ?? b.billNumber)}`}
                    className="underline hover:text-[#2C4A5E]">
                    {b.billNumber}
                  </Link>
                </span>
              ))}
            </p>
          </li>
        ))}
        {gaps.length > 12 && (
          <li className="font-mono text-xs text-[#2C4A5E]/70">
            +{gaps.length - 12} more · scroll the plank sections above for the full list
          </li>
        )}
      </ul>
    </section>
  );
}

/** v1.7.1 — per-plank bill list. Shows every bill in the leg's universe with
 *  the position (✓ aligned vote, ✗ misaligned vote, — no vote) plus tier badges
 *  for cosponsor / marker-sponsor. Empty list renders nothing — the plank's
 *  score is still pending if we have no data. */
function BillBreakdownList({ breakdown }: { breakdown: BillBreakdownRow[] }) {
  if (breakdown.length === 0) return null;
  return (
    <div className="mt-3 space-y-1">
      <p className="font-mono text-[10px] uppercase tracking-widest text-gray-500">
        {breakdown.filter((b) => b.isAligned).length} aligned of {breakdown.length} bills
      </p>
      <ul className="divide-y divide-gray-200 rounded border border-gray-200 text-sm">
        {breakdown.map((b) => (
          <li key={`${b.source}|${b.billType}|${b.billNumber}`} className="flex items-center gap-2 px-3 py-1.5">
            <BillPositionIcon row={b} />
            <span className="font-mono text-xs text-gray-600">
              {b.billType}/{b.billNumber}
            </span>
            <span className="flex-1 truncate text-sm text-gray-800">
              {b.markerName ? <span className="italic text-gray-500">{b.markerName} · </span> : null}
              {b.billTitle ?? <span className="text-gray-400">(no title)</span>}
            </span>
            {b.cosponsored && (
              <span className="rounded bg-[#8B3A3A] px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-white">
                cosponsor
              </span>
            )}
            {b.source === 'marker' && !b.cosponsored && (
              <span className="rounded border border-gray-300 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-gray-500">
                marker
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Icon column for the bill breakdown. Communicates the leg's relationship to
 *  the bill in one glyph:
 *    ✓ — aligned: voted aligned OR cosponsored (final v1.7.1 decision)
 *    ✗ — voted misaligned
 *    — — no recorded vote, no cosponsorship */
function BillPositionIcon({ row }: { row: BillBreakdownRow }) {
  if (row.isAligned) {
    return (
      <span
        title={row.cosponsored ? 'Cosponsored' : `Voted ${row.legPosition ?? 'aligned'}`}
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-green-600 text-xs font-bold text-white">
        ✓
      </span>
    );
  }
  if (row.legPosition && row.legPosition !== row.alignedPosition) {
    return (
      <span
        title={`Voted ${row.legPosition} (aligned position was ${row.alignedPosition})`}
        className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-600 text-xs font-bold text-white">
        ✗
      </span>
    );
  }
  return (
    <span
      title="No recorded vote or cosponsorship"
      className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-dashed border-gray-400 text-xs text-gray-400">
      —
    </span>
  );
}

/** v1.7.1 — "Money trail" section on the legislator detail page. Renders the
 *  PAC Score, the per-class breakdown, top donor PACs, and IE-opposed PACs.
 *  Sourced from PacContribution joined to PacClassification (4-cycle aggregate). */
const PAC_CLASS_TONE: Record<string, { bg: string; label: string; countsAgainst: boolean }> = {
  CORPORATE: { bg: 'bg-red-700 text-white', label: 'Corporate', countsAgainst: true },
  DARK_MONEY: { bg: 'bg-red-800 text-white', label: 'Dark Money', countsAgainst: true },
  FOREIGN_POLICY: { bg: 'bg-red-600 text-white', label: 'Foreign Policy', countsAgainst: true },
  ACTIVIST: { bg: 'bg-lime-700 text-white', label: 'Activist', countsAgainst: false },
  LABOR: { bg: 'bg-blue-700 text-white', label: 'Labor', countsAgainst: false },
  LEADERSHIP: { bg: 'bg-yellow-700 text-white', label: 'Leadership PAC', countsAgainst: false },
  IDEOLOGICAL: { bg: 'bg-purple-700 text-white', label: 'Ideological', countsAgainst: false },
  CONDUIT: { bg: 'bg-gray-600 text-white', label: 'Conduit', countsAgainst: false },
  PARTY: { bg: 'bg-indigo-700 text-white', label: 'Party Committee', countsAgainst: false },
  UNKNOWN: { bg: 'bg-gray-500 text-white', label: 'Unknown', countsAgainst: false },
};

function MoneyTrail({
  moneyTrail,
  topDonors,
  opposedBy,
}: {
  moneyTrail: PacMoneyTrail;
  topDonors: TopDonor[];
  opposedBy: TopDonor[];
}) {
  const {
    countsAgainst,
    totalInfluence,
    denominator,
    totalReceipts,
    pacScore,
    byClass,
    ieOpposeTotal,
    jfcPassThroughTotal,
    beneficiaryCountsAgainst,
    beneficiaryPacScore,
  } = moneyTrail;
  // Sort classes by dollar amount desc for the breakdown bars. v1.8.6 — drop
  // negative-net slices (refund-heavy CONDUIT in particular) from the bars;
  // they were rendering as "−3% Conduit $−14,593" which read as nonsense.
  // Stash the dropped totals so we can surface them as a one-line footnote
  // below the breakdown — preserving the disclosure without polluting the
  // visualization.
  const rawClassRows = Object.entries(byClass).sort((a, b) => b[1] - a[1]);
  const classRows = rawClassRows.filter(([, amt]) => amt > 0);
  const negativeClassRows = rawClassRows.filter(([, amt]) => amt < 0);
  // The PAC Score uses receipts+IE_SUPPORT as denominator (matches the v1.7.1
  // spike). countsAgainst / totalInfluence — i.e. how concentrated the PAC
  // intake is — is a separate "PAC mix" stat, shown as well.

  return (
    <section className="mt-8 rounded border border-2 border-[#8B3A3A] border-gray-200 bg-white p-5 shadow-sm">
      <header className="flex items-baseline justify-between gap-3">
        <h2 className="font-serif text-2xl font-bold text-[#2C4A5E]">Money trail</h2>
        <p
          title="Money trail surface introduced in v1.7.1; applied methodology shown at page top."
          className="font-mono text-xs uppercase tracking-widest text-[#2C4A5E]/80">
          4-cycle aggregate
        </p>
      </header>
      <p className="mt-1 text-sm text-[#2C4A5E]">
        Where this legislator&apos;s PAC + Super PAC IE money came from across 2018–2024.{' '}
        <Link href="/scorecard/methodology/pac-classes" className="underline hover:text-white">
          How classes work →
        </Link>
      </p>

      {/* Top stats row */}
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded bg-gray-50 p-3">
          <p className="font-mono text-[10px] uppercase tracking-widest text-[#2C4A5E]/70">Counts against</p>
          <p className="mt-1 font-serif text-2xl font-bold tabular-nums text-red-300">
            ${(countsAgainst / 1000).toFixed(0)}K
          </p>
          <p className="mt-0.5 font-mono text-[10px] text-[#2C4A5E]/70">Corp + Dark + Foreign</p>
        </div>
        <div className="rounded bg-gray-50 p-3">
          <p className="font-mono text-[10px] uppercase tracking-widest text-[#2C4A5E]/70">Total raised</p>
          <p className="mt-1 font-serif text-2xl font-bold tabular-nums text-[#2C4A5E]">
            $
            {denominator >= 1_000_000
              ? `${(denominator / 1_000_000).toFixed(1)}M`
              : `${(denominator / 1000).toFixed(0)}K`}
          </p>
          <p className="mt-0.5 font-mono text-[10px] text-[#2C4A5E]/70">
            Receipts ${(totalReceipts / 1000).toFixed(0)}K + IE support
          </p>
        </div>
        <div className="rounded bg-gray-50 p-3">
          <p className="font-mono text-[10px] uppercase tracking-widest text-[#2C4A5E]/70">PAC Score</p>
          <p className="mt-1 font-serif text-2xl font-bold tabular-nums text-[#2C4A5E]">
            {pacScore !== null ? `${pacScore}%` : '—'}
          </p>
          <p className="mt-0.5 font-mono text-[10px] text-[#2C4A5E]/70">1 − counts-against ÷ total raised</p>
        </div>
        <div className="rounded bg-gray-50 p-3">
          <p className="font-mono text-[10px] uppercase tracking-widest text-[#2C4A5E]/70">IE against</p>
          <p className="mt-1 font-serif text-2xl font-bold tabular-nums text-[#2C4A5E]/80">
            ${(ieOpposeTotal / 1000).toFixed(0)}K
          </p>
          <p className="mt-0.5 font-mono text-[10px] text-[#2C4A5E]/70">opposed this leg</p>
        </div>
      </div>

      {/* Beneficiary PAC Score — alt view crediting IE against defeated opponents */}
      {beneficiaryCountsAgainst > 0 && (
        <div className="mt-4 rounded border border-gray-300 bg-gray-50 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-widest text-[#2C4A5E]/70">
                Beneficiary PAC Score <span className="text-[10px] normal-case text-[#2C4A5E]/50">— alt view</span>
              </p>
              <p className="mt-1 font-serif text-2xl font-bold tabular-nums text-[#2C4A5E]">
                {beneficiaryPacScore !== null ? `${beneficiaryPacScore}%` : '—'}
              </p>
            </div>
            <div className="text-right">
              <p className="font-mono text-[10px] uppercase tracking-widest text-[#2C4A5E]/70">
                + Indirect (IE against opponent)
              </p>
              <p className="mt-1 font-serif text-lg font-bold tabular-nums text-red-300">
                +$
                {beneficiaryCountsAgainst >= 1_000_000
                  ? `${(beneficiaryCountsAgainst / 1_000_000).toFixed(1)}M`
                  : `${(beneficiaryCountsAgainst / 1000).toFixed(0)}K`}
              </p>
            </div>
          </div>
          <p className="mt-2 text-xs text-[#2C4A5E]/90">
            Includes IE money corporate / dark-money / foreign-policy PACs spent against this legislator&apos;s defeated
            primary or general-election opponents. View B from the methodology: the legislator materially benefited from
            that spending even though it wasn&apos;t filed directly for them. The PAC Score above remains the official
            per-FEC-target measure.
          </p>
        </div>
      )}

      {/* Per-class breakdown */}
      <div className="mt-5">
        <p className="font-mono text-xs uppercase tracking-widest text-[#2C4A5E]/70">Breakdown by class</p>
        <ul className="mt-2 space-y-1.5">
          {classRows.map(([cls, amt]) => {
            const tone = PAC_CLASS_TONE[cls] ?? PAC_CLASS_TONE.UNKNOWN;
            const pct = totalInfluence > 0 ? (amt / totalInfluence) * 100 : 0;
            return (
              <li key={cls} className="flex items-center gap-3 text-sm">
                <span
                  className={`inline-flex w-32 justify-center rounded px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide ${tone.bg}`}>
                  {tone.label}
                </span>
                <div className="flex-1">
                  <div className="h-2 w-full overflow-hidden rounded-full bg-gray-50">
                    <div
                      className={`h-full ${tone.countsAgainst ? 'bg-red-500' : 'bg-[#F5DEB3]'}`}
                      style={{ width: `${Math.min(100, pct)}%` }}
                    />
                  </div>
                </div>
                <span className="w-24 text-right font-mono text-xs tabular-nums text-[#2C4A5E]">
                  ${amt.toLocaleString()}
                </span>
                <span className="w-12 text-right font-mono text-xs tabular-nums text-[#2C4A5E]/80">
                  {pct.toFixed(0)}%
                </span>
              </li>
            );
          })}
        </ul>
        {jfcPassThroughTotal > 0 && (
          <p className="mt-2 font-mono text-[11px] text-[#2C4A5E]/80">
            <span className="font-semibold text-[#2C4A5E]">via JFC:</span> $
            {Math.round(jfcPassThroughTotal).toLocaleString()} attributed to corporate PACs routed through Joint
            Fundraising Committees (apportioned by JFC outbound share).
          </p>
        )}
        {negativeClassRows.length > 0 && (
          <p className="mt-2 font-mono text-[11px] text-[#2C4A5E]/80">
            {negativeClassRows.map(([cls, amt], i) => {
              const tone = PAC_CLASS_TONE[cls] ?? PAC_CLASS_TONE.UNKNOWN;
              return (
                <span key={cls}>
                  {i > 0 && ' · '}
                  <span className="font-semibold text-[#2C4A5E]">{tone.label} (net of refunds):</span> −$
                  {Math.abs(Math.round(amt)).toLocaleString()}
                </span>
              );
            })}
          </p>
        )}
      </div>

      {/* Top donor PACs */}
      {topDonors.length > 0 && (
        <div className="mt-6">
          <p className="font-mono text-xs uppercase tracking-widest text-[#2C4A5E]/70">Top donor PACs</p>
          <ul className="mt-2 divide-y divide-[#F5DEB3]/10 rounded border border-gray-200">
            {topDonors.slice(0, 10).map((d) => {
              const tone = PAC_CLASS_TONE[d.class] ?? PAC_CLASS_TONE.UNKNOWN;
              return (
                <li key={d.committeeId} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                  <Link
                    href={`/scorecard/pac/${d.committeeId.toLowerCase()}`}
                    className="flex-1 truncate text-[#2C4A5E] hover:underline">
                    {d.name}
                  </Link>
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide ${tone.bg}`}>
                    {tone.label}
                  </span>
                  <span className="w-24 shrink-0 text-right font-mono text-xs tabular-nums text-[#2C4A5E]">
                    ${d.total.toLocaleString()}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* IE-opposed PACs (info only) */}
      {opposedBy.length > 0 && (
        <div className="mt-6">
          <p className="font-mono text-xs uppercase tracking-widest text-[#2C4A5E]/70">
            Super PACs that spent against this legislator
          </p>
          <p className="mt-1 text-xs text-[#2C4A5E]/80">
            Independent expenditures opposing the legislator&apos;s campaign. Shown for transparency — does NOT affect
            the PAC Score (this is money against them).
          </p>
          <ul className="mt-2 divide-y divide-[#F5DEB3]/10 rounded border border-gray-200">
            {opposedBy.slice(0, 5).map((d) => {
              const tone = PAC_CLASS_TONE[d.class] ?? PAC_CLASS_TONE.UNKNOWN;
              return (
                <li key={d.committeeId} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                  <Link
                    href={`/scorecard/pac/${d.committeeId.toLowerCase()}`}
                    className="flex-1 truncate text-[#2C4A5E] hover:underline">
                    {d.name}
                  </Link>
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide ${tone.bg}`}>
                    {tone.label}
                  </span>
                  <span className="w-24 shrink-0 text-right font-mono text-xs tabular-nums text-red-300">
                    ${d.ieOppose.toLocaleString()}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

// v1.7.2 — Leadership PAC inflows section. Shows money flowing INTO the
// legislator's leadership PAC(s). These dollars don't count toward the
// legislator's PAC Score (it's not their campaign money), but they ARE an
// influence-flow signal worth surfacing — corporate PACs often prefer
// leadership PACs because limits are looser.
function LeadershipPacInflowsSection({ inflows }: { inflows: LeadershipPacInflows }) {
  const { pacCount, totalAll, totalCounted, pacs, topDonors } = inflows;
  return (
    <section className="mt-8 rounded border border-[#8B3A3A]/60 border-gray-200 bg-white p-5 shadow-sm">
      <header className="flex items-baseline justify-between gap-3">
        <h2 className="font-serif text-xl font-bold text-[#2C4A5E]">Leadership PAC inflows</h2>
        <p
          title="Leadership PAC inflows surface introduced in v1.7.2; applied methodology shown at page top."
          className="font-mono text-[10px] uppercase tracking-widest text-[#2C4A5E]/80">
          informational
        </p>
      </header>
      <p className="mt-1 text-sm text-[#2C4A5E]">
        This legislator sponsors {pacCount === 1 ? 'a leadership PAC' : `${pacCount} leadership PACs`} — legally
        separate committee(s) that collect PAC + individual money and redistribute to other candidates. These dollars
        don&apos;t count toward this legislator&apos;s PAC Score (it&apos;s not their campaign money), but they show
        influence flowing through their network.
      </p>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded bg-gray-50 p-3">
          <p className="font-mono text-[10px] uppercase tracking-widest text-[#2C4A5E]/70">Total inbound (4-cycle)</p>
          <p className="mt-1 font-serif text-xl font-bold tabular-nums text-[#2C4A5E]">
            ${totalAll >= 1_000_000 ? `${(totalAll / 1_000_000).toFixed(1)}M` : `${(totalAll / 1000).toFixed(0)}K`}
          </p>
        </div>
        <div className="rounded bg-gray-50 p-3">
          <p className="font-mono text-[10px] uppercase tracking-widest text-[#2C4A5E]/70">From counted classes</p>
          <p className="mt-1 font-serif text-xl font-bold tabular-nums text-red-300">
            $
            {totalCounted >= 1_000_000
              ? `${(totalCounted / 1_000_000).toFixed(1)}M`
              : `${(totalCounted / 1000).toFixed(0)}K`}
          </p>
          <p className="mt-0.5 font-mono text-[10px] text-[#2C4A5E]/70">Corp + Dark + Foreign</p>
        </div>
        <div className="col-span-2 rounded bg-gray-50 p-3 sm:col-span-1">
          <p className="font-mono text-[10px] uppercase tracking-widest text-[#2C4A5E]/70">Leadership PAC(s)</p>
          <ul className="mt-1 space-y-0.5">
            {pacs.map((p) => (
              <li key={p.committeeId} className="font-mono text-[11px] text-[#2C4A5E]">
                <Link href={`/scorecard/pac/${p.committeeId.toLowerCase()}`} className="hover:underline">
                  {p.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {topDonors.length > 0 && (
        <div className="mt-5">
          <p className="font-mono text-xs uppercase tracking-widest text-[#2C4A5E]/70">Top donors to these PACs</p>
          <ul className="mt-2 divide-y divide-[#F5DEB3]/10 rounded border border-gray-200">
            {topDonors.slice(0, 10).map((d) => {
              const tone = PAC_CLASS_TONE[d.class] ?? PAC_CLASS_TONE.UNKNOWN;
              return (
                <li key={d.committeeId} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                  <Link
                    href={`/scorecard/pac/${d.committeeId.toLowerCase()}`}
                    className="flex-1 truncate text-[#2C4A5E] hover:underline">
                    {d.name}
                  </Link>
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide ${tone.bg}`}>
                    {tone.label}
                  </span>
                  <span
                    className={`w-24 shrink-0 text-right font-mono text-xs tabular-nums ${
                      tone.countsAgainst ? 'text-red-300' : 'text-[#2C4A5E]'
                    }`}>
                    ${d.total.toLocaleString()}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <p className="mt-3 font-mono text-[10px] text-[#2C4A5E]/70">
        Mapping currently covers a curated list of well-known leadership PACs plus FEC&apos;s ccl.txt linkage file
        (~30-40 legislators). Coverage will grow as additional mappings are added to{' '}
        <code className="text-[#2C4A5E]/90">data/leadership-pacs-manual.csv</code>.
      </p>
    </section>
  );
}

// v1.7.5 — Individual contributions section. The ~53%-of-all-money layer the
// PAC Score is blind to: itemized individual donations (≥$200) to the
// legislator's campaign, with the top employers by dollar. Surfaces the
// industry / firm concentration in the donor base (e.g. Goldman Sachs,
// Blackstone, big law) that PAC totals can't see.
function IndividualMoneySection({
  money,
  pacTotalInfluence2Cyc,
}: {
  money: IndividualMoney;
  // v1.8.2: PAC DIRECT+IE_SUPPORT for 2022 + 2024 only — matches the cycle
  // window of `totalItemized`. The 4-cycle `totalInfluence` would bias the
  // ratio because we never ingested 2018/2020 individual contribution files.
  pacTotalInfluence2Cyc: number;
}) {
  const { totalItemized, contributionCount, cyclesAvailable, topEmployers, industryMix, industryClassifiedTotal } =
    money;
  // v1.8.6 — defensive empty-state. Parent already gates on totalItemized>0
  // but if we ever wind up here with 0, render a single graceful "no data"
  // line instead of the full breakdown with zeros + a narrative blurb.
  if (totalItemized === 0) {
    return (
      <section className="mt-8 rounded border border-[#2C4A5E] border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="font-serif text-xl font-bold text-[#2C4A5E]">Individual donors</h2>
        <p className="mt-2 text-sm italic text-[#2C4A5E]/80">
          No itemized FEC individual filings for this cycle yet.
        </p>
      </section>
    );
  }
  const grandTotal = totalItemized + pacTotalInfluence2Cyc;
  const indivPct = grandTotal > 0 ? Math.round((totalItemized / grandTotal) * 100) : 0;
  const maxEmployer = topEmployers.length > 0 ? topEmployers[0].total : 0;
  const topIndustries = industryMix.slice(0, 8);
  const maxIndustry = topIndustries.length > 0 ? topIndustries[0].total : 0;
  // v1.8.3 — surface industry-mix coverage explicitly. industryMix is built
  // from the stored top-25 employers per cycle (LegislatorIndividualMoney.
  // topEmployers), which for big-fundraising senators covers only single-
  // digit % of the full itemized base. Without this number the per-industry
  // % looks like a share of the whole donor base; it isn't.
  const coveragePct = totalItemized > 0 ? (industryClassifiedTotal / totalItemized) * 100 : 0;

  return (
    <section className="mt-8 rounded border border-[#2C4A5E] border-gray-200 bg-white p-5 shadow-sm">
      <header className="flex items-baseline justify-between gap-3">
        <h2 className="font-serif text-xl font-bold text-[#2C4A5E]">Individual donors</h2>
        <p
          title="Individual donors surface introduced in v1.7.5; applied methodology shown at page top."
          className="font-mono text-[10px] uppercase tracking-widest text-[#2C4A5E]/80">
          cycles {cyclesAvailable.sort((a, b) => a - b).join(', ')}
        </p>
      </header>
      <p className="mt-1 text-sm text-[#2C4A5E]">
        Itemized individual contributions (≥$200) to this legislator&apos;s campaign — the donor base the PAC Score
        doesn&apos;t measure. Employers are self-reported on FEC filings; retirees / self-employed are excluded from the
        list below so real organizations surface.
      </p>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded bg-gray-50 p-3">
          <p className="font-mono text-[10px] uppercase tracking-widest text-[#2C4A5E]/70">Itemized individual $</p>
          <p className="mt-1 font-serif text-2xl font-bold tabular-nums text-[#2C4A5E]">
            $
            {totalItemized >= 1_000_000
              ? `${(totalItemized / 1_000_000).toFixed(1)}M`
              : `${(totalItemized / 1000).toFixed(0)}K`}
          </p>
        </div>
        <div className="rounded bg-gray-50 p-3">
          <p className="font-mono text-[10px] uppercase tracking-widest text-[#2C4A5E]/70"># of contributions</p>
          <p className="mt-1 font-serif text-2xl font-bold tabular-nums text-[#2C4A5E]">
            {contributionCount.toLocaleString()}
          </p>
        </div>
        <div className="col-span-2 rounded bg-gray-50 p-3 sm:col-span-1">
          <p className="font-mono text-[10px] uppercase tracking-widest text-[#2C4A5E]/70">
            Individual vs PAC (2022–2024)
          </p>
          <p className="mt-1 font-serif text-2xl font-bold tabular-nums text-[#2C4A5E]">{indivPct}%</p>
          <p className="mt-0.5 font-mono text-[10px] text-[#2C4A5E]/70">
            of (individual + PAC) money, 2-cycle window — individual data is 2022 + 2024 only, so PAC $ is scoped to
            match.
          </p>
        </div>
      </div>

      {/* v1.7.6 Industry rollup — sectors of the top reported employers.
          Honest framing: "of donor money we can assign to an industry, the
          mix is X." Per-firm $ is noise (~2.5% of base); per-industry is
          where the Wall-Street / Big Law / Big Pharma story lives. */}
      {topIndustries.length > 0 && (
        <div className="mt-5">
          <p className="font-mono text-xs uppercase tracking-widest text-[#2C4A5E]/70">
            Top donor industries
            <span className="ml-2 text-[10px] normal-case text-[#2C4A5E]/60">
              — ${Math.round(industryClassifiedTotal).toLocaleString()} classified ({coveragePct.toFixed(1)}% of $
              {Math.round(totalItemized).toLocaleString()} itemized)
            </span>
          </p>
          <ul className="mt-2 space-y-1">
            {topIndustries.map((r) => {
              const widthPct = maxIndustry > 0 ? (r.total / maxIndustry) * 100 : 0;
              const isFinance = r.sector === 'FINANCE';
              return (
                <li key={r.sector} className="flex items-center gap-3 text-sm">
                  <span className="w-44 shrink-0 truncate text-[#2C4A5E]" title={r.label}>
                    {r.label}
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-50">
                    <div
                      className={`h-full ${isFinance ? 'bg-amber-400/80' : 'bg-[#F5DEB3]/60'}`}
                      style={{ width: `${Math.max(2, widthPct)}%` }}
                    />
                  </div>
                  <span className="w-24 shrink-0 text-right font-mono text-xs tabular-nums text-[#2C4A5E]">
                    ${Math.round(r.total).toLocaleString()}
                  </span>
                  <span className="w-12 shrink-0 text-right font-mono text-[10px] tabular-nums text-[#2C4A5E]/70">
                    {r.pctOfClassified.toFixed(0)}%
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 font-mono text-[10px] text-[#2C4A5E]/60">
            Industry mix is computed from the top 25 reported employers per cycle ({coveragePct.toFixed(1)}% of the
            itemized base for this legislator). The rest is small/scattered donors with no employer signal — FEC
            catch-alls (retired, self-employed) and tens of thousands of small local employers. Per-firm $ alone is weak
            signal (~2-3% of base); per-industry concentration on the slice we can see is where the funding-source story
            lives.
          </p>
        </div>
      )}

      {topEmployers.length > 0 && (
        <div className="mt-5">
          <p className="font-mono text-xs uppercase tracking-widest text-[#2C4A5E]/70">Top donor employers</p>
          <ul className="mt-2 space-y-1">
            {topEmployers.map((e) => {
              const widthPct = maxEmployer > 0 ? (e.total / maxEmployer) * 100 : 0;
              return (
                <li key={e.employer} className="flex items-center gap-3 text-sm">
                  <span className="w-52 shrink-0 truncate text-[#2C4A5E]" title={e.employer}>
                    {e.employer}
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-50">
                    <div className="h-full bg-[#F5DEB3]/70" style={{ width: `${Math.max(2, widthPct)}%` }} />
                  </div>
                  <span className="w-24 shrink-0 text-right font-mono text-xs tabular-nums text-[#2C4A5E]">
                    ${e.total.toLocaleString()}
                  </span>
                  <span className="w-12 shrink-0 text-right font-mono text-[10px] tabular-nums text-[#2C4A5E]/70">
                    {e.count.toLocaleString()}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 font-mono text-[10px] text-[#2C4A5E]/60">
            Employer = sum of contributions from individuals reporting that employer. Not a corporate PAC contribution —
            it&apos;s the firm&apos;s employees giving personally. Industry-level rollup is a future pass.
          </p>
        </div>
      )}
    </section>
  );
}

// v1.7.6 — Donor profile (DIME). Whole-base funding-character metrics that
// sidestep the per-employer noise: donor-base ideology (Bonica cfscore) and
// small-dollar % (grassroots vs big-check). Joined by FEC candidate id.
function DonorProfileSection({ profile, party }: { profile: DimeProfile; party: string }) {
  const { contributorCfscore, smallDollarPct, totalUnitemized, totalIndivContribs, cyclesAvailable } = profile;

  // Map a cfscore (roughly −2…+2) to a 0-100 left↔right position for the bar.
  const cf = contributorCfscore;
  const cfPos = cf === null ? 50 : Math.max(0, Math.min(100, ((cf + 2) / 4) * 100));
  const cfLabel =
    cf === null
      ? 'no score'
      : cf <= -0.75
      ? 'strongly progressive donor base'
      : cf < -0.25
      ? 'lean-progressive donor base'
      : cf <= 0.25
      ? 'centrist / mixed donor base'
      : cf < 0.75
      ? 'lean-conservative donor base'
      : 'strongly conservative donor base';

  return (
    <section className="mt-8 rounded border border-[#2C4A5E] border-gray-200 bg-white p-5 shadow-sm">
      <header className="flex items-baseline justify-between gap-3">
        <h2 className="font-serif text-xl font-bold text-[#2C4A5E]">Donor base</h2>
        <p className="font-mono text-[10px] uppercase tracking-widest text-[#2C4A5E]/80">
          DIME · cycles {cyclesAvailable.sort((a, b) => a - b).join(', ')}
        </p>
      </header>
      <p className="mt-1 text-sm text-[#2C4A5E]">
        Whole-base funding character from Stanford&apos;s DIME (Bonica). Unlike a single employer (which is rarely more
        than ~2% of the base), these summarize <em>who</em> funds this legislator across every donor.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {/* Donor ideology */}
        <div className="rounded bg-gray-50 p-4">
          <p className="font-mono text-[10px] uppercase tracking-widest text-[#2C4A5E]/70">Donor-base ideology</p>
          <p className="mt-1 font-serif text-2xl font-bold tabular-nums text-[#2C4A5E]">
            {cf === null ? '—' : cf.toFixed(2)}
          </p>
          <p className="mt-0.5 text-xs text-[#2C4A5E]/90">{cfLabel}</p>
          {cf !== null && (
            <div className="mt-2">
              <div className="relative h-2 w-full rounded-full bg-gradient-to-r from-[#1d4ed8] via-[#9ca3af] to-[#b91c1c]">
                <span
                  className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-black/70"
                  style={{ left: `${cfPos}%` }}
                />
              </div>
              <div className="mt-1 flex justify-between font-mono text-[9px] uppercase tracking-wide text-[#2C4A5E]/60">
                <span>progressive</span>
                <span>conservative</span>
              </div>
            </div>
          )}
        </div>

        {/* Small-dollar % */}
        <div className="rounded bg-gray-50 p-4">
          <p className="font-mono text-[10px] uppercase tracking-widest text-[#2C4A5E]/70">Small-dollar share</p>
          <p className="mt-1 font-serif text-2xl font-bold tabular-nums text-[#2C4A5E]">
            {smallDollarPct === null ? '—' : `${smallDollarPct.toFixed(0)}%`}
          </p>
          <p className="mt-0.5 text-xs text-[#2C4A5E]/90">
            of individual money is small-dollar (&lt;$200) — grassroots vs big-check signal.
          </p>
          {smallDollarPct !== null && (
            <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-black/40">
              <div className="h-full bg-[#F5DEB3]/70" style={{ width: `${Math.min(100, smallDollarPct)}%` }} />
            </div>
          )}
          {totalUnitemized + totalIndivContribs > 0 ? (
            <p className="mt-2 font-mono text-[10px] text-[#2C4A5E]/60">
              ${(totalUnitemized / 1000).toFixed(0)}K small-dollar · ${(totalIndivContribs / 1000).toFixed(0)}K itemized
            </p>
          ) : null}
        </div>
      </div>
      <p className="mt-3 font-mono text-[10px] text-[#2C4A5E]/60">
        Ideology = Bonica CFscore of the donor base (−2 progressive … +2 conservative). Party shown: {party}. Source:
        Database on Ideology, Money &amp; Politics, Stanford.
      </p>
    </section>
  );
}
