/**
 * Refreshes src/data/congress-legislators-current.json from the
 * unitedstates/congress-legislators GitHub Pages endpoint.
 *
 * Run with: npm run congress:update
 */

import { writeFileSync } from 'fs';
import { join } from 'path';

const URL = 'https://unitedstates.github.io/congress-legislators/legislators-current.json';
const OUTPUT = join(process.cwd(), 'src', 'data', 'congress-legislators-current.json');

async function main() {
  console.log(`Fetching ${URL} ...`);
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`Failed to fetch: ${res.status} ${res.statusText}`);
  const data = await res.json();
  writeFileSync(OUTPUT, JSON.stringify(data, null, 2));
  console.log(`Saved ${(data as unknown[]).length} legislators to ${OUTPUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
