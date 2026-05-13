/* eslint-disable @typescript-eslint/no-use-before-define */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  findLegislatorByAnyId,
  getPublicPlanks,
  computePublishedTotal,
  computePlankCoverage,
} from '@/lib/scorecard/queries';
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
  const total = computePublishedTotal(legislator.scores);
  const chamberLabel =
    jurisdiction === 'FEDERAL' ? CHAMBER_LABEL_FEDERAL[legislator.chamber] : CHAMBER_LABEL_STATE[legislator.chamber];

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
      <Link href="/scorecard" className="text-sm text-gray-600 hover:text-gray-900">
        ← Back to scorecard
      </Link>

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
          {total === null ? (
            <div>
              <p className="font-mono text-xs uppercase tracking-widest text-gray-500">Score pending</p>
              <p className="mt-1 text-sm text-gray-600">Methodology v1.2 — no data yet</p>
            </div>
          ) : (
            <div>
              <ScoreNumber value={total} size="hero" />
              <p className="font-mono text-xs uppercase tracking-widest text-gray-500">Total score</p>
            </div>
          )}
        </div>
      </header>

      {total === null && (
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
          Same rubric applied to every legislator. Methodology v1.2.{' '}
          <Link href="/scorecard" className="underline">
            See the full scorecard
          </Link>
          .
        </p>
      </footer>
    </div>
  );
}

/** Score number renderer. Positive = green, negative = red, zero = neutral.
 *  Always prefixes positive numbers with "+" for clarity; negatives render
 *  with their native "-". Used at both hero (page header) and per-plank size. */
function ScoreNumber({ value, size }: { value: number; size: 'hero' | 'plank' }) {
  const colorClass =
    value > 0 ? 'text-green-600 dark:text-green-400' : value < 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-500';
  const sizeClass =
    size === 'hero' ? 'font-serif text-5xl font-bold tabular-nums' : 'font-serif text-2xl font-bold tabular-nums';
  const display = value > 0 ? `+${value}` : `${value}`;
  return <span className={`${sizeClass} ${colorClass}`}>{display}</span>;
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
          ? 'ml-2 rounded bg-[#8B3A3A] px-1.5 py-0.5 font-mono text-xs uppercase tracking-wide text-[#F5DEB3]'
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
    <section className="mt-12 rounded border border-[#2C4A5E] bg-[#2C4A5E]/60 p-5">
      <h2 className="font-mono text-xs uppercase tracking-widest text-[#F5DEB3]">Not weighed in on</h2>
      <p className="mt-2 text-sm text-[#F5DEB3]/90">
        Markers with bills currently in committee or pending — {legislatorName} has not cosponsored or voted on any of
        them yet. Each one is an opportunity to take a public position.
      </p>
      <ul className="mt-4 space-y-3">
        {gaps.slice(0, 12).map(({ plankNumber, plankName, marker }) => (
          <li key={marker.id} className="text-sm">
            <p className="font-medium text-[#F5DEB3]">{marker.name}</p>
            <p className="text-xs text-[#F5DEB3]/70">
              Plank {plankNumber}. {plankName} ·{' '}
              {marker.bills.map((b, i) => (
                <span key={b.id}>
                  {i > 0 && ', '}
                  <Link
                    href={`/scorecard/bills/${encodeURIComponent(b.publicSlug ?? b.billNumber)}`}
                    className="underline hover:text-[#F5DEB3]">
                    {b.billNumber}
                  </Link>
                </span>
              ))}
            </p>
          </li>
        ))}
        {gaps.length > 12 && (
          <li className="font-mono text-xs text-[#F5DEB3]/60">
            +{gaps.length - 12} more · scroll the plank sections above for the full list
          </li>
        )}
      </ul>
    </section>
  );
}
