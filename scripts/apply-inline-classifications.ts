// Applies inline classifications (JSON file or stdin) to pac-candidates.csv.
// Used when I'm classifying PACs in the conversation — I write a JSON file
// listing {committeeId: {class, reason}} and this script merges it into the
// CSV's proposedClass + reason columns.
//
// Run:
//   npx tsx scripts/apply-inline-classifications.ts data/inline-classifications.json
//
// JSON format: { "C00000059": {"class": "CORPORATE", "reason": "..."}, ... }

import fs from 'fs';
import path from 'path';

const csvPath = path.join(process.cwd(), 'data', 'pac-candidates.csv');
const jsonPath = process.argv[2];
if (!jsonPath) {
  console.error('Usage: apply-inline-classifications.ts <path-to-json>');
  process.exit(1);
}

const overrides = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as Record<string, { class: string; reason: string }>;

const lines = fs.readFileSync(csvPath, 'utf-8').split('\n');
const header = lines[0];
const out = [header];
let applied = 0;
let missing = 0;
const seen = new Set<string>();

for (let i = 1; i < lines.length; i += 1) {
  const line = lines[i];
  if (!line.trim()) continue;
  // Parse with quote-aware splitter
  const cols: string[] = [];
  let cur = '';
  let inQ = false;
  for (const ch of line) {
    if (ch === '"' && !inQ) inQ = true;
    else if (ch === '"' && inQ) inQ = false;
    else if (ch === ',' && !inQ) {
      cols.push(cur);
      cur = '';
    } else cur += ch;
  }
  cols.push(cur);
  if (cols.length < 11) {
    out.push(line);
    continue;
  }
  const cmteId = cols[0];
  const override = overrides[cmteId];
  if (override) {
    cols[8] = override.class;
    cols[9] = `inline: ${override.reason}`;
    applied += 1;
    seen.add(cmteId);
  }
  // Rebuild line preserving CSV quote rules
  out.push(
    cols
      .map((c) => {
        if (c.includes(',') || c.includes('"') || c.includes('\n')) return '"' + c.replace(/"/g, '""') + '"';
        return c;
      })
      .join(','),
  );
}

for (const id of Object.keys(overrides)) {
  if (!seen.has(id)) missing += 1;
}

fs.writeFileSync(csvPath, out.join('\n'));

// Re-tally breakdown
const counts: Record<string, number> = {};
for (let i = 1; i < out.length; i += 1) {
  const cols = out[i].split(','); // class can't have a comma in it for our enum so this is safe
  if (cols.length < 11) continue;
  // Find the class column — col index 8 in clean rows, but quoted fields shift indices.
  // Safer: re-parse.
  let cur = '';
  let inQ = false;
  const parsed: string[] = [];
  for (const ch of out[i]) {
    if (ch === '"' && !inQ) inQ = true;
    else if (ch === '"' && inQ) inQ = false;
    else if (ch === ',' && !inQ) {
      parsed.push(cur);
      cur = '';
    } else cur += ch;
  }
  parsed.push(cur);
  if (parsed.length < 11) continue;
  const cls = parsed[8];
  counts[cls] = (counts[cls] ?? 0) + 1;
}

console.log(`Applied ${applied} overrides (${missing} committee_ids in JSON not found in CSV).`);
console.log('New breakdown:', JSON.stringify(counts));
