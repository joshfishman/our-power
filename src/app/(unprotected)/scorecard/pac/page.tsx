/* eslint-disable @typescript-eslint/no-use-before-define */
import type { Metadata } from 'next';
import Link from 'next/link';
import prisma from '@/lib/prisma/prisma';
import { PacSortableTable, type PacRow } from '@/components/scorecard/PacSortableTable';
import { METHODOLOGY_VERSION } from '@/lib/scorecard/scoring';
import { getArticlesForSection } from '@/lib/scorecard/articles';

export const metadata: Metadata = {
  title: 'Corporate PAC Money | We the People Scorecard',
  description:
    'Every member of Congress and the California Legislature, ranked by corporate PAC share of campaign receipts in the current cycle. Members under 5% receive Plank 1 — Honest Government — primary marker credit.',
};

const CORPORATE_PAC_THRESHOLD = 0.05;

interface SearchParams {
  jurisdiction?: string;
  chamber?: string;
  party?: string;
  state?: string;
}

export default async function PacScorecardPage(props: { searchParams: Promise<SearchParams> }) {
  const searchParams = await props.searchParams;
  // Pull every legislator with at least one PacMoneyData row, joined with
  // their best (highest-fidelity, most-recent) PAC record.
  const legislators = await prisma.legislator.findMany({
    where: {
      isActive: true,
      pacData: { some: {} },
      ...(searchParams.jurisdiction === 'FEDERAL' || searchParams.jurisdiction === 'CA'
        ? { jurisdiction: searchParams.jurisdiction }
        : {}),
      ...(searchParams.chamber === 'SEN' || searchParams.chamber === 'REP' ? { chamber: searchParams.chamber } : {}),
      ...(searchParams.party === 'D' || searchParams.party === 'R' || searchParams.party === 'I'
        ? { party: searchParams.party }
        : {}),
      ...(searchParams.state ? { state: searchParams.state.toUpperCase() } : {}),
    },
    select: {
      id: true,
      bioguideId: true,
      openStatesId: true,
      fullName: true,
      chamber: true,
      state: true,
      district: true,
      party: true,
      jurisdiction: true,
      photoUrl: true,
      pacData: {
        orderBy: [{ dataSource: 'asc' }, { cycleYear: 'desc' }],
        take: 1,
        select: {
          cycleYear: true,
          corporatePacAmount: true,
          totalReceipts: true,
          corporatePacPercentage: true,
          dataSource: true,
          dataSourceUrl: true,
          corporateIeSupportAmount: true,
          corporateIeAgainstOpponentAmount: true,
          corporateIeAgainstSelfAmount: true,
          combinedCorporateRatio: true,
        },
      },
    },
  });

  // Rank ascending by corporate PAC share — refusers (lowest %) at the top.
  const ranked = legislators
    .map((l) => ({ ...l, latest: l.pacData[0] }))
    .filter((l) => l.latest)
    .sort(
      (a, b) =>
        Number(a.latest.combinedCorporateRatio ?? a.latest.corporatePacPercentage ?? 0) -
        Number(b.latest.combinedCorporateRatio ?? b.latest.corporatePacPercentage ?? 0),
    );

  const refuserCount = ranked.filter(
    (l) => Number(l.latest.combinedCorporateRatio ?? l.latest.corporatePacPercentage ?? 0) < CORPORATE_PAC_THRESHOLD,
  ).length;

  const articles = getArticlesForSection('pac');

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <Link href="/scorecard" className="text-sm text-muted-foreground hover:text-foreground">
        ← Back to scorecard
      </Link>

      <header className="mt-4 border-b-2 border-border pb-6">
        <p className="font-mono text-xs uppercase tracking-widest text-subtle-foreground">
          Plank 1 — Honest Government
        </p>
        <h1 className="mt-1 font-serif text-4xl font-bold text-foreground">Corporate PAC Money</h1>
        <p className="mt-2 max-w-2xl text-base text-muted-foreground">
          Every legislator, ranked by the share of their current-cycle campaign receipts that came from corporate PACs.
          Members under <span className="font-semibold text-accent">5%</span> earn the Plank 1 primary marker. Same
          threshold applied to every legislator regardless of party.
        </p>
        <p className="mt-2 text-xs text-subtle-foreground">
          Current cycle data · sources: FEC + Cal-Access via CCDC. Combined % includes corporate IE spending FOR this
          legislator and AGAINST their same-cycle opponents. Corporate IE attacking is disclosed but not scored.
        </p>
      </header>

      {articles.length > 0 && (
        <section className="mt-6 rounded border border-2 border-accent bg-surface p-5 shadow-sm">
          <h2 className="font-mono text-xs uppercase tracking-widest text-foreground">Reading on this issue</h2>
          <ul className="mt-3 space-y-3">
            {articles.map((article) => (
              <li key={article.slug}>
                <Link
                  href={`/scorecard/articles/${encodeURIComponent(article.slug)}`}
                  className="block hover:underline">
                  <p className="font-serif text-lg font-semibold text-foreground">{article.title}</p>
                  <p className="text-sm text-muted-foreground">{article.dek}</p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <JurisdictionToggle active={searchParams.jurisdiction} searchParams={searchParams} />

      {ranked.length === 0 ? (
        <EmptyState jurisdiction={searchParams.jurisdiction} />
      ) : (
        <>
          <div className="mt-6 flex flex-wrap items-center gap-4 text-sm">
            <span className="rounded bg-accent px-2 py-1 font-mono text-xs uppercase tracking-wide text-white">
              {refuserCount} refusing corporate PACs
            </span>
            <span className="text-muted-foreground">
              of {ranked.length} legislator{ranked.length === 1 ? '' : 's'} with data
            </span>
            <FilterChips searchParams={searchParams} />
          </div>

          <PacSortableTable
            rows={ranked.map<PacRow>((l) => ({
              id: l.id,
              bioguideId: l.bioguideId,
              openStatesId: l.openStatesId,
              fullName: l.fullName,
              chamber: l.chamber,
              state: l.state,
              district: l.district,
              party: l.party,
              photoUrl: l.photoUrl,
              // pct uses combinedCorporateRatio (v1.4) when available, falls back to v1.3 direct-only
              pct: Number(l.latest.combinedCorporateRatio ?? l.latest.corporatePacPercentage ?? 0),
              corpAmount: Number(l.latest.corporatePacAmount),
              totalReceipts: Number(l.latest.totalReceipts),
              ieSupport: Number(l.latest.corporateIeSupportAmount ?? 0),
              ieAgainstOpponent: Number(l.latest.corporateIeAgainstOpponentAmount ?? 0),
              ieAttacking: Number(l.latest.corporateIeAgainstSelfAmount ?? 0),
            }))}
            hideStateColumn={searchParams.jurisdiction === 'CA'}
          />
        </>
      )}

      <footer className="mt-12 border-t-2 border-border pt-4 text-xs text-subtle-foreground">
        <p>
          Same threshold applied to every legislator. Ranked low-to-high.{' '}
          <Link href="/scorecard/methodology" className="underline hover:text-accent">
            Methodology {METHODOLOGY_VERSION} →
          </Link>{' '}
          <Link href="/scorecard" className="underline">
            Full scorecard →
          </Link>
        </p>
      </footer>
    </div>
  );
}

function buildPacUrl(searchParams: SearchParams, jurisdiction: string | undefined): string {
  // Build the /scorecard/pac URL with the jurisdiction set (or cleared)
  // and every other filter preserved. Empty string clears the filter.
  const params = new URLSearchParams();
  if (jurisdiction) params.set('jurisdiction', jurisdiction);
  if (searchParams.chamber) params.set('chamber', searchParams.chamber);
  if (searchParams.party) params.set('party', searchParams.party);
  if (searchParams.state) params.set('state', searchParams.state);
  const qs = params.toString();
  return qs ? `/scorecard/pac?${qs}` : '/scorecard/pac';
}

function JurisdictionToggle({ active, searchParams }: { active: string | undefined; searchParams: SearchParams }) {
  const options: Array<{ key: string | undefined; label: string }> = [
    { key: undefined, label: 'All' },
    { key: 'FEDERAL', label: 'Federal' },
    { key: 'CA', label: 'California' },
  ];
  return (
    <div className="mt-6 inline-flex rounded-md border border-border bg-surface p-1">
      {options.map((opt) => {
        const isActive = (active ?? undefined) === opt.key;
        return (
          <Link
            key={opt.label}
            href={buildPacUrl(searchParams, opt.key)}
            className={
              isActive
                ? 'rounded bg-accent px-4 py-1.5 font-mono text-xs uppercase tracking-wide text-white'
                : 'rounded border border-border px-4 py-1.5 font-mono text-xs uppercase tracking-wide text-foreground shadow-sm hover:bg-surface-elevated'
            }>
            {opt.label}
          </Link>
        );
      })}
    </div>
  );
}

function FilterChips({ searchParams }: { searchParams: SearchParams }) {
  // Jurisdiction is shown by the toggle above, so we exclude it here.
  const chips: Array<[string, string]> = [];
  if (searchParams.chamber) chips.push(['Chamber', searchParams.chamber]);
  if (searchParams.party) chips.push(['Party', searchParams.party]);
  if (searchParams.state) chips.push(['State', searchParams.state.toUpperCase()]);
  if (chips.length === 0) return null;
  return (
    <span className="text-subtle-foreground">
      {chips.map(([k, v], i) => (
        <span key={k}>
          {i > 0 && ' · '}
          <span className="font-mono text-xs uppercase tracking-wide">
            {k}: {v}
          </span>
        </span>
      ))}{' '}
      <Link href="/scorecard/pac" className="text-xs underline">
        clear
      </Link>
    </span>
  );
}

function EmptyState({ jurisdiction }: { jurisdiction?: string }) {
  if (jurisdiction === 'CA') {
    return (
      <div className="mt-8 rounded border border-2 border-dashed border-border bg-surface px-6 py-12 shadow-sm">
        <p className="text-center font-serif text-2xl font-bold text-foreground">No California PAC data ingested yet</p>
        <p className="mx-auto mt-3 max-w-2xl text-center text-sm text-foreground">
          California campaign finance lives in <strong>Cal-Access</strong>. Two paths to populate: a curated CSV
          (fastest, transparent) or the{' '}
          <a
            href="https://calaccess.californiacivicdata.org/downloads/latest/"
            target="_blank"
            rel="noopener noreferrer"
            className="underline">
            CCDC Big Local News
          </a>{' '}
          processed exports (full coverage, requires schema setup).
        </p>

        <div className="mx-auto mt-6 grid max-w-3xl gap-4 md:grid-cols-2">
          <div className="rounded border border-border bg-surface p-4 text-left">
            <p className="font-mono text-xs uppercase tracking-widest text-foreground">Curated CSV (fastest)</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Hand-pick CA legislators using publicly-published Cal-Access committee summaries. Each row cites its
              source URL — auditable line by line.
            </p>
            <pre className="mt-3 overflow-auto rounded bg-muted px-3 py-2 text-left text-[11px] text-foreground">
              {`# Header:
openStatesId,cycleYear,corporatePacAmount,\\
totalReceipts,sourceUrl

npm run scorecard:ingest-ca-pac -- \\
  --csv=src/data/curated-pac-ca-2026.csv
npm run scorecard:compute -- \\
  --auto-verify --publish --jurisdiction=CA`}
            </pre>
          </div>

          <div className="rounded border border-border bg-surface p-4 text-left">
            <p className="font-mono text-xs uppercase tracking-widest text-foreground">CCDC bulk (full coverage)</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Skeleton wired up; needs a CCDC snapshot on disk and the{' '}
              <code className="font-mono">CommitteeClassification</code> table populated for the top ~500 CA committees
              so &ldquo;corporate&rdquo; can be distinguished from labor / ideological / candidate.
            </p>
            <pre className="mt-3 overflow-auto rounded bg-muted px-3 py-2 text-left text-[11px] text-foreground">
              {`# Download CCDC processed CSVs to:
#   ./data/calaccess/{cycle}/
npm run scorecard:ingest-ca-pac -- \\
  --ccdc-dir=./data/calaccess/2026 \\
  --cycle=2026`}
            </pre>
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Or switch to{' '}
          <Link href="/scorecard/pac?jurisdiction=FEDERAL" className="underline">
            Federal
          </Link>{' '}
          for the FEC-backed view.
        </p>
      </div>
    );
  }
  return (
    <div className="mt-8 rounded border border-2 border-dashed border-border bg-surface px-6 py-12 shadow-sm">
      <p className="text-center font-serif text-2xl font-bold text-foreground">No PAC data ingested yet</p>
      <p className="mt-2 text-center text-sm text-foreground">
        This page is wired up but <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">PacMoneyData</code>{' '}
        is empty. PAC data lives in a different system from legislation — your LegiScan API key does not cover it. Three
        paths to populate it, in order of recommended fastest-to-real-data:
      </p>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <div className="rounded border-2 border-accent bg-surface p-4">
          <p className="font-mono text-xs uppercase tracking-widest text-accent">Path A · FEC.gov API (fastest)</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Pulls per-candidate cycle totals straight from FEC. Free instant key from{' '}
            <a href="https://api.data.gov/signup/" target="_blank" rel="noopener noreferrer" className="underline">
              api.data.gov
            </a>
            . Caveat: counts ALL non-party PAC dollars, not strictly corporate-classified — see footnote.
          </p>
          <pre className="mt-3 overflow-auto rounded bg-muted px-3 py-2 text-left text-[11px] text-foreground">
            {`# Add to .env.local:
#   FEC_API_KEY=<your_key>
npm run scorecard:ingest-fec -- \\
  --cycle=2026
npm run scorecard:compute -- \\
  --auto-verify --publish`}
          </pre>
        </div>

        <div className="rounded border border-border bg-surface p-4">
          <p className="font-mono text-xs uppercase tracking-widest text-foreground">
            Path B · OpenSecrets bulk (highest fidelity)
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Free login, manual download, then ingest. OpenSecrets pre-classifies PACs as corporate / labor / ideological
            — strictly methodology-compliant.
          </p>
          <pre className="mt-3 overflow-auto rounded bg-muted px-3 py-2 text-left text-[11px] text-foreground">
            {`# Download to ./data/opensecrets/2026/
#   cands26.txt cmtes26.txt pacs262.txt
npm run scorecard:ingest-pac -- \\
  --opensecrets-dir=./data/opensecrets/2026
npm run scorecard:compute -- \\
  --auto-verify --publish`}
          </pre>
          <p className="mt-2 text-xs text-subtle-foreground">
            <a
              href="https://www.opensecrets.org/bulk-data"
              target="_blank"
              rel="noopener noreferrer"
              className="underline">
              opensecrets.org/bulk-data →
            </a>
          </p>
        </div>

        <div className="rounded border border-border bg-surface p-4">
          <p className="font-mono text-xs uppercase tracking-widest text-foreground">
            Path C · Curated CSV (transparent)
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Hand-pick a few legislators using publicly-published OpenSecrets numbers. Each row cites its source URL —
            auditable line by line, slow to scale.
          </p>
          <pre className="mt-3 overflow-auto rounded bg-muted px-3 py-2 text-left text-[11px] text-foreground">
            {`# CSV header:
bioguideId,cycleYear,corporatePacAmount,\\
totalReceipts,sourceUrl

npm run scorecard:ingest-pac -- \\
  --csv=src/data/curated-pac-2026.csv
npm run scorecard:compute -- \\
  --auto-verify --publish`}
          </pre>
        </div>
      </div>

      <p className="mt-6 text-center text-xs text-subtle-foreground">
        Why FEC counts &ldquo;all non-party PAC&rdquo; instead of strictly corporate: FEC publishes raw filings without
        the corporate / labor / ideological classification. OpenSecrets does that classification on top of FEC data. To
        get strict corporate-only from FEC alone, the schema&rsquo;s{' '}
        <code className="font-mono">CommitteeClassification</code> table needs to be populated by walking each PAC
        contributor and tagging org type — that work isn&rsquo;t built yet, and until it is, FEC_DIRECT rows are the
        broader proxy. The scoring engine prefers OpenSecrets data when both sources are present.
      </p>
    </div>
  );
}
