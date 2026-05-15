/* eslint-disable @typescript-eslint/no-use-before-define */
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { findBillByAnyId, findSiblingBills } from '@/lib/scorecard/queries';
import { LegislatorAvatar } from '@/components/scorecard/LegislatorAvatar';
import { METHODOLOGY_VERSION } from '@/lib/scorecard/scoring';

// Bill data changes often (sync runs append history entries, vote rolls
// arrive). Don't let Next cache this page across requests.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

type Props = { params: Promise<{ id: string }> };

const PARTY_LABEL: Record<string, string> = {
  D: 'Democrat',
  R: 'Republican',
  I: 'Independent',
};

// Vote-position pills sit on the navy/60 panel background. Border + text
// stay semantic (green/red/etc) so YES/NO are clearly distinct, but the
// fills are kept light enough to read against the dark backdrop.
const POSITION_COLOR: Record<string, string> = {
  YES: 'border-green-400 bg-green-50/90 text-green-900',
  NO: 'border-red-400 bg-red-50/90 text-red-900',
  NOT_VOTING: 'border-yellow-400 bg-yellow-50/90 text-yellow-900',
  EXCUSED: 'border-gray-400 bg-gray-50/90 text-gray-800',
  PRESENT: 'border-blue-400 bg-blue-50/90 text-blue-900',
  ABSTAINED: 'border-purple-400 bg-purple-50/90 text-purple-900',
};

export async function generateMetadata(props: Props): Promise<Metadata> {
  const params = await props.params;
  const bill = await findBillByAnyId(decodeURIComponent(params.id));
  if (!bill) return { title: 'Bill not found | Scorecard' };
  return {
    title: `${bill.billTitle} | Scorecard`,
    description: bill.publicDescription?.slice(0, 160) ?? `${bill.billTitle} — track who voted and act on this bill.`,
  };
}

export default async function BillIssuePage(props: Props) {
  const params = await props.params;
  const bill = await findBillByAnyId(decodeURIComponent(params.id));
  if (!bill) notFound();

  // Sibling bills under the same marker (e.g. AB-2200 historical when
  // viewing AB-1900 current). Rendered below the primary bill so the user
  // sees the full marker context — current vehicle + predecessors.
  const siblingBills = await findSiblingBills(bill.markerId, bill.id);

  // Debug log — visible in `npm run dev` server output. Tells us exactly
  // what shape procedureHistory has when the page renders.
  const ph = (bill as unknown as { procedureHistory?: unknown }).procedureHistory;
  console.log(
    `[bill-page] ${bill.billNumber}: procedureHistory typeof=${typeof ph}, isArray=${Array.isArray(ph)}, length=${
      Array.isArray(ph) ? ph.length : 'n/a'
    }, raw=${JSON.stringify(ph)?.slice(0, 200)}`,
  );

  const jurisdiction = bill.marker.plank.jurisdiction as 'FEDERAL' | 'CA';
  const sessionLabel =
    jurisdiction === 'CA'
      ? `${bill.congressNumber.toString().slice(0, 4)}-${bill.congressNumber.toString().slice(4)} CA Session`
      : `${bill.congressNumber}th Congress`;

  // Group votes by position so the page can show "voted no" prominently.
  const votesByPosition = {
    YES: bill.votes.filter((v) => v.position === 'YES'),
    NO: bill.votes.filter((v) => v.position === 'NO'),
    NOT_VOTING: bill.votes.filter((v) => v.position === 'NOT_VOTING'),
    EXCUSED: bill.votes.filter((v) => v.position === 'EXCUSED'),
    PRESENT: bill.votes.filter((v) => v.position === 'PRESENT'),
    ABSTAINED: bill.votes.filter((v) => v.position === 'ABSTAINED'),
  };

  const totalVotes = bill.votes.length;
  const noVoteRoll = totalVotes === 0;

  // When the focal bill has no votes, we promote sibling committee votes into
  // the primary vote-roll section so the page isn't a dead end.
  const siblingsWithVotes = siblingBills.filter((sib) => sib.votes.length > 0);
  const hasPromotedSiblingVotes = noVoteRoll && siblingsWithVotes.length > 0;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <Link href="/scorecard" className="text-sm text-[#F5DEB3]/80 hover:text-[#F5DEB3]">
        ← Back to scorecard
      </Link>

      <header className="mt-4 border-b-2 border-[#2C4A5E] pb-6">
        <p className="font-mono text-xs uppercase tracking-widest text-[#F5DEB3]/70">
          Plank {bill.marker.plank.number}. {bill.marker.plank.name} · {sessionLabel}
        </p>
        <h1 className="mt-1 font-serif text-4xl font-bold text-[#F5DEB3]">{bill.billTitle}</h1>
        <p className="mt-2 font-mono text-sm text-[#F5DEB3]/80">{bill.billNumber}</p>
        {bill.statusNote && (
          <p className="mt-3 inline-block rounded border border-[#2C4A5E] bg-[#2C4A5E]/60 px-3 py-1 text-sm text-[#F5DEB3]">
            {bill.statusNote}
          </p>
        )}
      </header>

      {bill.publicDescription && (
        <section className="mt-6">
          <h2 className="font-mono text-xs uppercase tracking-widest text-[#F5DEB3]/70">About this bill</h2>
          <p className="mt-2 whitespace-pre-line text-base leading-relaxed text-[#F5DEB3]">{bill.publicDescription}</p>
        </section>
      )}

      {bill.callToAction && (
        <section className="mt-8 rounded-lg border-2 border-[#8B3A3A] bg-[#2C4A5E]/60 p-6">
          <h2 className="font-serif text-2xl font-bold text-[#F5DEB3]">Call your representatives</h2>
          <p className="mt-2 text-sm text-[#F5DEB3]">
            {jurisdiction === 'CA'
              ? 'Find your Assembly Member and State Senator and ask them to support this bill.'
              : 'Find your members of Congress and ask them to support this bill.'}
          </p>
          <Link
            href="/civic/representatives"
            className="mt-3 inline-block rounded bg-[#8B3A3A] px-4 py-2 font-semibold text-[#F5DEB3] hover:bg-[#6B2A2A]">
            Look up my representatives →
          </Link>
          <div className="mt-4 rounded border border-[#2C4A5E] bg-[#2C4A5E]/80 p-4">
            <p className="font-mono text-xs uppercase tracking-widest text-[#F5DEB3]/70">Suggested script</p>
            <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-[#F5DEB3]">{bill.callToAction}</p>
          </div>
        </section>
      )}

      <ProcedureTimeline history={(bill as unknown as { procedureHistory?: unknown }).procedureHistory} />

      <SponsorSections bill={bill} />

      <section className="mt-10">
        <h2 className="font-serif text-2xl font-bold text-[#F5DEB3]">The vote roll</h2>
        {noVoteRoll && !hasPromotedSiblingVotes && (
          <div className="mt-3 rounded border border-[#2C4A5E] bg-[#2C4A5E]/60 p-4 text-sm text-[#F5DEB3]">
            <p className="font-semibold">No recorded floor vote yet.</p>
            <p className="mt-1">
              {bill.statusNote ??
                'A roll-call vote has not been recorded for this bill. Once it advances and a vote is recorded, every legislator’s position will appear here, sourced from the official record.'}
            </p>
          </div>
        )}
        {hasPromotedSiblingVotes && (
          <div className="mt-3">
            <div className="rounded border border-[#2C4A5E] bg-[#2C4A5E]/60 p-4 text-sm text-[#F5DEB3]">
              <p className="font-semibold">{bill.billNumber} hasn&rsquo;t had a recorded vote yet.</p>
              <p className="mt-1">
                These are the recorded committee positions on {siblingsWithVotes.map((s) => s.billNumber).join(', ')}{' '}
                &mdash; the same marker, same policy intent. Members who voted yes on{' '}
                {siblingsWithVotes.length > 1 ? 'any of these predecessors' : 'the predecessor'} still earn the marker
                even if they haven&rsquo;t yet cosponsored {bill.billNumber}.
              </p>
            </div>
            {siblingsWithVotes.map((sib) => {
              const sibSessionLabel =
                jurisdiction === 'CA'
                  ? `${sib.congressNumber.toString().slice(0, 4)}-${sib.congressNumber.toString().slice(4)} CA Session`
                  : `${sib.congressNumber}th Congress`;
              // voteContext carries the committee name; use the first vote's value
              // since all votes from the same committee hearing share the same context.
              const firstContext = sib.votes[0]?.voteContext ?? null;
              // Format voteDate as YYYY-MM-DD for display.
              const firstDate = sib.votes[0]?.voteDate;
              const dateLabel = firstDate instanceof Date ? firstDate.toISOString().slice(0, 10) : null;
              const sibVotes = sib.votes as unknown as VoteRowVote[];
              const sibNo = sibVotes.filter((v) => v.position === 'NO');
              const sibNV = sibVotes.filter((v) => v.position === 'NOT_VOTING');
              const sibYes = sibVotes.filter((v) => v.position === 'YES');
              const sibAbstained = sibVotes.filter((v) => v.position === 'ABSTAINED');
              const sibExcused = sibVotes.filter((v) => v.position === 'EXCUSED');
              const sibPresent = sibVotes.filter((v) => v.position === 'PRESENT');
              return (
                <div key={sib.id} className="mt-6">
                  <p className="font-mono text-xs uppercase tracking-widest text-[#F5DEB3]/70">
                    From {sib.billNumber} ({sibSessionLabel})
                  </p>
                  {(firstContext || dateLabel) && (
                    <p className="mt-0.5 text-sm text-[#F5DEB3]/80">
                      {firstContext ?? ''}
                      {firstContext && dateLabel ? ' · ' : ''}
                      {dateLabel ?? ''}
                    </p>
                  )}
                  <KilledItSection noVoters={sibNo} notVoting={sibNV} />
                  <VoteSection label="Voted Yes" votes={sibYes} positionKey="YES" accent="text-green-300" />
                  <VoteSection
                    label="Abstained"
                    votes={sibAbstained}
                    positionKey="ABSTAINED"
                    accent="text-purple-300"
                  />
                  <VoteSection label="Excused" votes={sibExcused} positionKey="EXCUSED" accent="text-[#F5DEB3]/80" />
                  <VoteSection label="Voted Present" votes={sibPresent} positionKey="PRESENT" accent="text-blue-300" />
                </div>
              );
            })}
          </div>
        )}
        {!noVoteRoll && (
          <>
            <p className="mt-1 text-sm text-[#F5DEB3]/80">
              {totalVotes} legislators on record. Members who didn&rsquo;t vote in committee are shown in this section
              too — for procedural purposes, not voting denies the bill the majority it needs, so they count alongside
              the explicit No votes.
            </p>
            {/* Combined "killed it" section: NO + NOT_VOTING shown together,
             * NV members tagged with "(NV)" so the procedural effect is clear. */}
            <KilledItSection noVoters={votesByPosition.NO} notVoting={votesByPosition.NOT_VOTING} />
            <VoteSection label="Voted Yes" votes={votesByPosition.YES} positionKey="YES" accent="text-green-300" />
            <VoteSection
              label="Excused"
              votes={votesByPosition.EXCUSED}
              positionKey="EXCUSED"
              accent="text-[#F5DEB3]/80"
            />
            <VoteSection
              label="Voted Present"
              votes={votesByPosition.PRESENT}
              positionKey="PRESENT"
              accent="text-blue-300"
            />
            <VoteSection
              label="Abstained"
              votes={votesByPosition.ABSTAINED}
              positionKey="ABSTAINED"
              accent="text-purple-300"
            />
          </>
        )}
      </section>

      {siblingBills.length > 0 && (
        <section className="mt-12 space-y-10 border-t-2 border-[#2C4A5E] pt-8">
          <h2 className="font-serif text-2xl font-bold text-[#F5DEB3]">Related bills under this marker</h2>
          <p className="text-sm text-[#F5DEB3]/80">
            Other bills tracked for the same policy marker. Historical predecessors and parallel vehicles are shown
            together so the full position record across sessions is visible.
          </p>
          {siblingBills.map((sib) => {
            const sibNoVoters = sib.votes.filter((v) => v.position === 'NO');
            const sibNotVoting = sib.votes.filter((v) => v.position === 'NOT_VOTING');
            const sibYesVoters = sib.votes.filter((v) => v.position === 'YES');
            const sibSessionLabel =
              jurisdiction === 'CA'
                ? `${sib.congressNumber.toString().slice(0, 4)}-${sib.congressNumber.toString().slice(4)} CA Session`
                : `${sib.congressNumber}th Congress`;
            return (
              <article key={sib.id} className="rounded border border-[#2C4A5E] bg-[#2C4A5E]/40 p-5">
                <p className="font-mono text-xs uppercase tracking-widest text-[#F5DEB3]/70">{sibSessionLabel}</p>
                <h3 className="mt-1 font-serif text-xl font-bold text-[#F5DEB3]">{sib.billTitle}</h3>
                <p className="mt-1 font-mono text-sm text-[#F5DEB3]/80">{sib.billNumber}</p>
                {sib.statusNote && (
                  <p className="mt-2 inline-block rounded border border-[#2C4A5E] bg-[#2C4A5E]/60 px-2 py-1 text-xs text-[#F5DEB3]">
                    {sib.statusNote}
                  </p>
                )}
                {/* Sibling sponsorships */}
                <SponsorSections bill={{ sponsorships: sib.sponsorships as unknown as SponsorshipRow[] }} />
                {/* Sibling vote roll — combined NO + NV. Suppressed when those
                 * votes were already promoted into the primary vote-roll panel
                 * above, to avoid showing the same rows twice. */}
                {!hasPromotedSiblingVotes && (
                  <>
                    {(sibNoVoters.length > 0 || sibNotVoting.length > 0) && (
                      <KilledItSection
                        noVoters={sibNoVoters as unknown as VoteRowVote[]}
                        notVoting={sibNotVoting as unknown as VoteRowVote[]}
                      />
                    )}
                    {sibYesVoters.length > 0 && (
                      <VoteSection
                        label="Voted Yes"
                        votes={sibYesVoters as unknown as VoteRowVote[]}
                        positionKey="YES"
                        accent="text-green-300"
                      />
                    )}
                  </>
                )}
              </article>
            );
          })}
        </section>
      )}

      <footer className="mt-12 border-t-2 border-[#2C4A5E] pt-4 text-xs text-[#F5DEB3]/70">
        <p>
          <Link href="/scorecard/methodology" className="underline hover:text-[#F5DEB3]">
            Methodology {METHODOLOGY_VERSION} →
          </Link>{' '}
          {bill.isProvisional ? 'Bill number is provisional pending verification against the official source.' : ''}{' '}
          <Link href="/scorecard" className="underline hover:text-[#F5DEB3]">
            See the full scorecard
          </Link>
          .
        </p>
      </footer>
    </div>
  );
}

interface VoteRowVote {
  id: string;
  position: string;
  voteContext: string | null;
  voteDate: Date | null;
  sourceUrl: string | null;
  legislator: {
    id: string;
    bioguideId: string | null;
    openStatesId: string | null;
    fullName: string;
    chamber: string;
    state: string;
    district: number | null;
    party: string;
    photoUrl: string | null;
  };
}

/** Combined "Voted No" + "Did Not Vote" section. NV members get an explicit
 *  "(NV)" tag because the procedural effect is the same — they denied the
 *  bill the votes it needed — but the form of the action is different. */
function KilledItSection({ noVoters, notVoting }: { noVoters: VoteRowVote[]; notVoting: VoteRowVote[] }) {
  const total = noVoters.length + notVoting.length;
  if (total === 0) return null;
  // Render NO voters first (more emphatic), NV after.
  const rows: Array<{ vote: VoteRowVote; tag: 'NO' | 'NV' }> = [
    ...noVoters.map((v) => ({ vote: v, tag: 'NO' as const })),
    ...notVoting.map((v) => ({ vote: v, tag: 'NV' as const })),
  ];
  return (
    <div className="mt-6">
      <h3 className="font-serif text-lg font-bold text-red-300">
        Voted No or Did Not Vote <span className="text-[#F5DEB3]/60">({total})</span>
      </h3>
      <p className="mt-1 text-xs text-[#F5DEB3]/70">
        {noVoters.length} explicit no · {notVoting.length} declined to vote (tagged NV)
      </p>
      <ul className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {rows.map(({ vote, tag }) => {
          const idForUrl = vote.legislator.bioguideId ?? vote.legislator.openStatesId ?? vote.legislator.id;
          return (
            <li
              key={vote.id}
              className={`flex items-center justify-between gap-3 rounded border px-3 py-2 ${
                tag === 'NO'
                  ? 'border-red-400 bg-red-50/90 text-red-900'
                  : 'border-yellow-400 bg-yellow-50/90 text-yellow-900'
              }`}>
              <Link
                href={`/scorecard/${encodeURIComponent(idForUrl)}`}
                className="flex min-w-0 flex-1 items-center gap-3 hover:underline">
                <LegislatorAvatar fullName={vote.legislator.fullName} photoUrl={vote.legislator.photoUrl} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">
                    {vote.legislator.fullName}
                    {tag === 'NV' && (
                      <span className="ml-1.5 inline-block rounded border border-current px-1 font-mono text-[10px] uppercase tracking-wide">
                        NV
                      </span>
                    )}
                  </p>
                  <p className="text-xs">
                    {PARTY_LABEL[vote.legislator.party] ?? vote.legislator.party} · {vote.legislator.state}
                    {vote.legislator.district != null && vote.legislator.chamber === 'REP'
                      ? ` ${vote.legislator.district}`
                      : ''}
                  </p>
                </div>
              </Link>
              {vote.sourceUrl && (
                <a
                  href={vote.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-2 shrink-0 text-xs underline"
                  aria-label="Source for this vote">
                  source
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

interface SponsorshipRow {
  id: string;
  sponsorTier: 'AUTHOR' | 'PRINCIPAL_COAUTHOR' | 'COAUTHOR' | 'COSPONSOR' | 'SPONSOR';
  sponsorOrder: number | null;
  legislator: {
    id: string;
    bioguideId: string | null;
    openStatesId: string | null;
    fullName: string;
    chamber: string;
    state: string;
    district: number | null;
    party: string;
    photoUrl: string | null;
  };
}

/** Authors + Cosponsors sections. Authors / Principal Coauthors get a
 *  prominent treatment with photos; rank-and-file cosponsors render in a
 *  denser grid. Renders nothing if the bill has no sponsorship records. */
function SponsorSections({ bill }: { bill: { sponsorships?: SponsorshipRow[] } }) {
  const sponsorships = bill.sponsorships ?? [];
  if (sponsorships.length === 0) return null;
  const authors = sponsorships.filter(
    (s) => s.sponsorTier === 'AUTHOR' || s.sponsorTier === 'PRINCIPAL_COAUTHOR' || s.sponsorTier === 'SPONSOR',
  );
  const cosponsors = sponsorships.filter((s) => s.sponsorTier === 'COAUTHOR' || s.sponsorTier === 'COSPONSOR');
  return (
    <section className="mt-10 space-y-8">
      {authors.length > 0 && (
        <div>
          <h2 className="font-serif text-2xl font-bold text-[#F5DEB3]">
            Author{authors.length > 1 ? 's' : ''}{' '}
            <span className="font-mono text-sm text-[#F5DEB3]/60">({authors.length})</span>
          </h2>
          <p className="mt-1 text-sm text-[#F5DEB3]/80">
            These legislators carried the bill — wrote it, fought for it, attached their name to it as principal
            sponsors.
          </p>
          <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {authors.map((s) => {
              const idForUrl = s.legislator.bioguideId ?? s.legislator.openStatesId ?? s.legislator.id;
              const tierLabel =
                s.sponsorTier === 'AUTHOR'
                  ? 'Author'
                  : s.sponsorTier === 'PRINCIPAL_COAUTHOR'
                  ? 'Principal coauthor'
                  : 'Sponsor';
              return (
                <li
                  key={s.id}
                  className="flex items-center gap-3 rounded border-2 border-[#8B3A3A] bg-[#2C4A5E]/80 px-3 py-3">
                  <Link
                    href={`/scorecard/${encodeURIComponent(idForUrl)}`}
                    className="flex min-w-0 flex-1 items-center gap-3 hover:underline">
                    <LegislatorAvatar fullName={s.legislator.fullName} photoUrl={s.legislator.photoUrl} size={48} />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-[#F5DEB3]">{s.legislator.fullName}</p>
                      <p className="text-xs text-[#F5DEB3]/80">
                        {PARTY_LABEL[s.legislator.party] ?? s.legislator.party} · {s.legislator.state}
                        {s.legislator.district != null && s.legislator.chamber === 'REP'
                          ? ` ${s.legislator.district}`
                          : ''}
                      </p>
                    </div>
                  </Link>
                  <span className="rounded bg-[#8B3A3A] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-[#F5DEB3]">
                    {tierLabel}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {cosponsors.length > 0 && (
        <div>
          <h2 className="font-serif text-2xl font-bold text-[#F5DEB3]">
            Cosponsors <span className="font-mono text-sm text-[#F5DEB3]/60">({cosponsors.length})</span>
          </h2>
          <p className="mt-1 text-sm text-[#F5DEB3]/80">
            Legislators who signed on to the bill as cosponsors. Their names are on the record.
          </p>
          <ul className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {cosponsors.map((s) => {
              const idForUrl = s.legislator.bioguideId ?? s.legislator.openStatesId ?? s.legislator.id;
              return (
                <li
                  key={s.id}
                  className="flex items-center gap-2 rounded border border-[#2C4A5E] bg-[#2C4A5E]/60 px-2 py-2">
                  <Link
                    href={`/scorecard/${encodeURIComponent(idForUrl)}`}
                    className="flex min-w-0 flex-1 items-center gap-2 hover:underline">
                    <LegislatorAvatar fullName={s.legislator.fullName} photoUrl={s.legislator.photoUrl} size={28} />
                    <div className="min-w-0 flex-1 text-sm">
                      <p className="truncate font-medium text-[#F5DEB3]">{s.legislator.fullName}</p>
                      <p className="text-[10px] text-[#F5DEB3]/70">
                        {PARTY_LABEL[s.legislator.party] ?? s.legislator.party} · {s.legislator.state}
                        {s.legislator.district != null && s.legislator.chamber === 'REP'
                          ? ` ${s.legislator.district}`
                          : ''}
                      </p>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

function VoteSection({
  label,
  votes,
  positionKey,
  accent,
}: {
  label: string;
  votes: VoteRowVote[];
  positionKey: string;
  accent: string;
}) {
  if (votes.length === 0) return null;
  return (
    <div className="mt-6">
      <h3 className={`font-serif text-lg font-bold ${accent}`}>
        {label} <span className="text-[#F5DEB3]/60">({votes.length})</span>
      </h3>
      <ul className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {votes.map((vote) => {
          const idForUrl = vote.legislator.bioguideId ?? vote.legislator.openStatesId ?? vote.legislator.id;
          return (
            <li
              key={vote.id}
              className={`flex items-center justify-between gap-3 rounded border px-3 py-2 ${
                POSITION_COLOR[positionKey] ?? 'border-gray-300 bg-white'
              }`}>
              <Link
                href={`/scorecard/${encodeURIComponent(idForUrl)}`}
                className="flex min-w-0 flex-1 items-center gap-3 hover:underline">
                <LegislatorAvatar fullName={vote.legislator.fullName} photoUrl={vote.legislator.photoUrl} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{vote.legislator.fullName}</p>
                  <p className="text-xs">
                    {PARTY_LABEL[vote.legislator.party] ?? vote.legislator.party} · {vote.legislator.state}
                    {vote.legislator.district != null && vote.legislator.chamber === 'REP'
                      ? ` ${vote.legislator.district}`
                      : ''}
                  </p>
                </div>
              </Link>
              {vote.sourceUrl && (
                <a
                  href={vote.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-2 shrink-0 text-xs underline"
                  aria-label="Source for this vote">
                  source
                </a>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

interface ProcedureEntry {
  date: string;
  chamber: string;
  action: string;
}

/** Heuristic flagger — turns the raw LegiScan action language into a tone hint
 *  so the timeline can highlight death-knell entries (red) and big wins (green)
 *  without needing structured status codes. */
function classifyAction(action: string): 'death' | 'win' | 'milestone' | 'normal' {
  const lower = action.toLowerCase();
  if (
    lower.includes('held under submission') ||
    lower.includes('died in committee') ||
    lower.includes('failed passage') ||
    lower.includes('vetoed') ||
    lower.includes('withdrawn from')
  ) {
    return 'death';
  }
  if (
    lower.includes('chaptered') ||
    lower.includes('signed by governor') ||
    lower.includes('became public law') ||
    lower.includes('approved by governor')
  ) {
    return 'win';
  }
  if (
    lower.includes('passed') ||
    lower.includes('do pass') ||
    lower.includes('engrossed') ||
    lower.includes('enrolled') ||
    lower.includes('referred to com') ||
    lower.includes('first hearing') ||
    lower.includes('amended')
  ) {
    return 'milestone';
  }
  return 'normal';
}

function ProcedureTimeline({ history }: { history: unknown }) {
  if (!Array.isArray(history) || history.length === 0) return null;
  const entries = history as ProcedureEntry[];
  return (
    <section className="mt-10">
      <h2 className="font-serif text-2xl font-bold text-[#F5DEB3]">The bill&rsquo;s journey</h2>
      <p className="mt-1 text-sm text-[#F5DEB3]/80">
        Every official action on this bill, in order. Sourced from the legislature&rsquo;s own record via LegiScan.
        &ldquo;Held under submission&rdquo; means the committee chair held the bill on the suspense file and never
        released it for a vote — the procedural way bills die without a public record of opposition.
      </p>
      <ol className="mt-4 space-y-2 border-l-2 border-[#2C4A5E] pl-5">
        {entries.map((e, i) => {
          const tone = classifyAction(e.action);
          const dotClass =
            tone === 'death'
              ? 'bg-[#8B3A3A] border-[#8B3A3A]'
              : tone === 'win'
              ? 'bg-green-400 border-green-400'
              : tone === 'milestone'
              ? 'bg-[#F5DEB3] border-[#F5DEB3]'
              : 'bg-[#2C4A5E] border-[#F5DEB3]/40';
          const textClass =
            tone === 'death'
              ? 'text-[#FFB4B4] font-semibold'
              : tone === 'win'
              ? 'text-green-200 font-semibold'
              : tone === 'milestone'
              ? 'text-[#F5DEB3]'
              : 'text-[#F5DEB3]/80';
          return (
            <li key={`${e.date}-${i}`} className="relative">
              <span
                className={`absolute -left-[27px] top-1.5 inline-block h-3 w-3 rounded-full border-2 ${dotClass}`}
                aria-hidden="true"
              />
              <p className="font-mono text-xs text-[#F5DEB3]/70">
                {e.date} {e.chamber === 'A' ? '· Assembly' : e.chamber === 'S' ? '· Senate' : ''}
              </p>
              <p className={`text-sm leading-relaxed ${textClass}`}>{e.action}</p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
