/**
 * Fetches current CA state legislators from OpenStates bulk CSV
 * and writes them to src/data/ca-state-legislators.json.
 *
 * Usage: npx tsx scripts/update-ca-legislators.ts
 */

import fs from 'fs';
import path from 'path';

const CSV_URL = 'https://data.openstates.org/people/current/ca.csv';
const OUT_PATH = path.resolve(__dirname, '../src/data/ca-state-legislators.json');

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (const char of line) {
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  result.push(current);
  return result;
}

async function main() {
  console.log('Fetching CA legislators from', CSV_URL);
  const res = await fetch(CSV_URL);
  if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
  const csv = await res.text();

  const lines = csv.split('\n').filter((l) => l.trim());
  const headers = lines[0].split(',');

  const legislators = lines
    .slice(1)
    .map((line) => {
      const vals = parseCSVLine(line);
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => (obj[h] = vals[i] || ''));
      return obj;
    })
    .filter((l) => l.name && l.current_district)
    .map((l) => {
      const links = (l.links || '').split(';').filter(Boolean);
      const contactUrl = links.find((u) => /contact/i.test(u)) || links[0] || null;
      const websiteUrl = links.find((u) => !/contact/i.test(u)) || null;
      return {
        openStatesId: l.id || null,
        name: l.name,
        party: l.current_party || null,
        chamber: l.current_chamber as 'upper' | 'lower',
        district: parseInt(l.current_district, 10),
        email: l.email || null,
        phone: l.capitol_voice || l.district_voice || null,
        photoUrl: l.image || null,
        contactUrl,
        websiteUrl,
      };
    });

  fs.writeFileSync(OUT_PATH, JSON.stringify(legislators, null, 2) + '\n');
  const upper = legislators.filter((l) => l.chamber === 'upper').length;
  const lower = legislators.filter((l) => l.chamber === 'lower').length;
  console.log(`Wrote ${legislators.length} legislators (${upper} senate, ${lower} assembly) to ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
