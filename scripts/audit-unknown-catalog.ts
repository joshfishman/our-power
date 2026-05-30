// v1.8.7 — Audit #29: catalog remaining UNKNOWN PAC committees.
//
// Queries the top-N UNKNOWN-classified committees by total counts-against
// dollars (sum over PacContribution.amount where donor's class is currently
// UNKNOWN). Exports CSV for human review + a summary breakdown.
//
// Usage:
//   npx tsx scripts/audit-unknown-catalog.ts [--top=200] [--out=data/unknown-catalog-202605.csv]

import './load-env';
import fs from 'fs';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const topArg = args.find((a) => a.startsWith('--top='));
  const outArg = args.find((a) => a.startsWith('--out='));
  const top = topArg ? Number(topArg.split('=')[1]) : 200;
  const outPath = outArg ? outArg.split('=')[1] : 'data/unknown-catalog-202605.csv';

  // Overall UNKNOWN dollar total (all counts-against kinds)
  const totalRow = await prisma.$queryRaw<Array<{ count: string; total: string }>>`
    SELECT COUNT(DISTINCT pc."committeeId")::text AS count,
           COALESCE(SUM(k.amount::numeric), 0)::text AS total
    FROM "PacClassification" pc
    LEFT JOIN "PacContribution" k ON k."donorCommitteeId" = pc."committeeId"
      AND k.kind IN ('DIRECT', 'IE_SUPPORT')
    WHERE pc.class = 'UNKNOWN'
      AND pc."finalClass" IS NULL
  `;
  const totalUnknownCount = Number(totalRow[0].count);
  const totalUnknownDollars = Number(totalRow[0].total);
  console.log(`[audit] UNKNOWN committees: ${totalUnknownCount.toLocaleString()}`);
  console.log(`[audit] UNKNOWN counts-against dollars: $${Math.round(totalUnknownDollars).toLocaleString()}`);

  // Top-N UNKNOWN committees by counts-against dollars
  const rows = await prisma.$queryRaw<
    Array<{
      committeeId: string;
      name: string;
      connectedOrg: string | null;
      committeeType: string | null;
      orgType: string | null;
      total: string;
      contribCount: string;
    }>
  >`
    SELECT pc."committeeId",
           pc."name",
           pc."connectedOrg",
           pc."committeeType",
           pc."orgType",
           COALESCE(SUM(k.amount::numeric), 0)::text AS total,
           COUNT(k.id)::text AS "contribCount"
    FROM "PacClassification" pc
    LEFT JOIN "PacContribution" k ON k."donorCommitteeId" = pc."committeeId"
      AND k.kind IN ('DIRECT', 'IE_SUPPORT')
    WHERE pc.class = 'UNKNOWN'
      AND pc."finalClass" IS NULL
    GROUP BY pc."committeeId", pc."name", pc."connectedOrg", pc."committeeType", pc."orgType"
    HAVING COALESCE(SUM(k.amount::numeric), 0) > 0
    ORDER BY COALESCE(SUM(k.amount::numeric), 0) DESC
    LIMIT ${top}
  `;

  // Write CSV
  const header = 'rank,committeeId,name,connectedOrg,committeeType,orgType,totalCountsAgainst,contribCount\n';
  const csv = rows
    .map((r, i) => {
      const esc = (s: string | null) => {
        if (s === null || s === undefined) return '';
        const t = String(s).replace(/"/g, '""');
        return /[",\n]/.test(t) ? `"${t}"` : t;
      };
      return [
        i + 1,
        r.committeeId,
        esc(r.name),
        esc(r.connectedOrg),
        esc(r.committeeType),
        esc(r.orgType),
        Number(r.total).toFixed(2),
        r.contribCount,
      ].join(',');
    })
    .join('\n');
  fs.writeFileSync(outPath, header + csv + '\n');

  const top200Dollars = rows.reduce((s, r) => s + Number(r.total), 0);
  console.log(`[audit] wrote ${rows.length} rows to ${outPath}`);
  console.log(
    `[audit] top-${rows.length} dollars: $${Math.round(top200Dollars).toLocaleString()} (${((top200Dollars / totalUnknownDollars) * 100).toFixed(1)}% of UNKNOWN $)`,
  );

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
