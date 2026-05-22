// v1.7.2 — LLM-classify the UNKNOWN tail from spike-pac-candidates.
//
// Reads data/pac-candidates.csv, finds rows where proposedClass=UNKNOWN, and
// asks Claude (via KIE) to classify each into one of the 6 taxonomy buckets.
// Writes back data/pac-candidates.csv with proposedClass + reason updated for
// every row we successfully classify.
//
// Cost guard: ~140 PACs × 1 call each at ~300 tokens output = ~$0.50 total.
// We process in parallel batches of 5 to keep latency reasonable.

import './load-env';
import fs from 'fs';
import path from 'path';

const KIE_API_KEY = process.env.KIE_API_KEY!;
const KIE_URL = 'https://api.kie.ai/claude/v1/messages';
const KIE_MODEL = 'claude-opus-4-7';
const PARALLEL = 5;

const SYSTEM_PROMPT = `You are a campaign-finance taxonomy expert classifying federal PACs for the Common Ground civic scorecard.

Each PAC must fit one of eight classes:

1. CORPORATE — Industry-aligned PACs. Includes:
   - Direct corporate PACs (Boeing PAC, Pfizer PAC, AT&T PAC, Comcast PAC)
   - Trade-association PACs that lobby for industry interests (Realtors, Bankers, Insurance Brokers, AMA, AHIP, PhRMA, NFIB, Chamber of Commerce)
   - Crypto industry super PACs (Fairshake, Defend American Jobs, Protect Progress)
   - Law/lobbying firm PACs (Akin Gump, Holland & Knight)
   - Accounting/consulting firm PACs (Deloitte, EY, KPMG, McKinsey)
   - Medical specialty associations operating as corporate lobby (AAFP, ACEP)

2. FOREIGN_POLICY — US-domiciled PACs whose primary purpose is shaping US foreign policy toward a specific country or region. They reward/punish legislators based on foreign-policy votes. Examples: AIPAC, J Street, Republican Jewish Coalition, NORPAC, Democratic Majority for Israel, Pro-Israel America, United Democracy Project, Turkish American PACs, Indian American Political Action Committees, Cuban/Korean/Vietnamese American Political PACs.

3. DARK_MONEY — Partisan super PACs and 501(c)(4)-aligned PACs heavily funded by billionaire networks or undisclosed donors, not transparent small-dollar grassroots. Examples:
   - Republican-aligned: Senate Conservatives Fund, Club for Growth, Crossroads, Senate Leadership Fund, Congressional Leadership Fund, MAGA Inc, America PAC (Musk), Preserve America, Win It Back, Restoration, Never Back Down (DeSantis), Lincoln Project, Sentinel Action Fund, Americans for Prosperity Action, Tell It Like It Is.
   - Democratic-aligned: Senate Majority PAC (WinSenate), House Majority PAC (HMP), Future Forward (FF PAC), Priorities USA, American Bridge (AB PAC), Majority Forward, Democracy PAC, For Our Future, Sixteen Thirty Fund.
   - State-focused dark-money: Buckeye Values, Leadership for Ohio, Battleground NY, A Better Wisconsin Together.

4. LABOR — Labor union PACs and labor-affiliated political committees. Examples: SEIU COPE, LIUNA PAC, AFT, IBEW, UFCW, AFSCME, NEA, Air Line Pilots, Teamsters, UA Plumbers & Pipefitters, Communications Workers of America, Workers Vote, National Nurses United.

5. ACTIVIST — Single-issue cause advocacy PACs. The org's purpose is to advance a specific policy commitment (gun safety, gun rights, climate, abortion, women's representation, voting rights, civil rights, veterans' advocacy, immigration) rather than just elect candidates. Funding can be mixed (some grassroots, some big donors) but the org is genuinely cause-oriented. Examples:
   - Gun debate (both sides): Everytown Victory Fund, Giffords PAC, Brady, Moms Demand, Gun Owners of America. (Note: NRA Political Victory Fund is an exception — classified as DARK_MONEY due to industry+extremist funding pattern.)
   - Climate / environment: Sierra Club, LCV Victory Fund, EDF Action, NRDC Action, Climate Power Action, Sunrise.
   - Reproductive rights (both sides): Planned Parenthood, NARAL, EMILY's List, Women Vote, Susan B Anthony List, Women Speak Out.
   - Civil rights / LGBTQ+: HRC PAC, ACLU PAC, Equality PAC, Lambda Legal.
   - Demographic mobilization: BlackPAC, Somos PAC, Latino Victory, AAPI Victory, Care in Action.
   - Democracy / voting rights: End Citizens United, Common Cause, Demand Justice, Citizens for Ethics, Represent Us.
   - Veterans: VoteVets, Common Defense, With Honor.
   - Other single-issue: Color of Change (racial justice), Student Borrower (debt relief), MoveOn, Indivisible.

6. IDEOLOGICAL — BROAD partisan/values grassroots PACs that aren't single-issue (left/right caucus PACs, etc.). Distinct from ACTIVIST (which is single-cause). Examples: Stop MAGA PAC, Democratic Voters PAC, Building Bridges PAC, generic patriotic small-dollar PACs without billionaire funding. Most PACs aren't in this bucket — when in doubt between IDEOLOGICAL and ACTIVIST, prefer ACTIVIST if there's a clear cause; prefer IDEOLOGICAL only for broad partisan organizing.

7. LEADERSHIP — Politician-controlled PACs that distribute money to other candidates. The PAC bears a politician's name, common phrases ("Friends of", "Team X"), or is sponsored by their candidate committee. Examples: AMERIPAC (Hoyer), Eye of the Tiger PAC (Scalise), PAC to the Future (Pelosi), E-PAC (Stefanik), Stand for America (Nikki Haley), In the Arena (Joni Ernst), Spike PAC (Mike Lee), Protect Freedom (Rand Paul), Common Values (Barrasso). Note: ideological orgs with "Victory Fund" in the name (LCV Victory Fund, NRA Political Victory Fund, Everytown Victory Fund) are NOT leadership — they go to ACTIVIST.

8. UNKNOWN — RARELY USED. Reserve UNKNOWN only for committees whose name is a pure acronym with no contextual hint AND no connected organization. Examples where UNKNOWN is acceptable: "VPP" with no connected_org, "SD PAC" with no connected_org. NOT acceptable: any PAC with patriotic vocabulary ("Defend Us PAC"), industry keywords ("Automotive Free Trade"), single-issue phrasing ("Demand Justice"), state names ("Save California"), or named after a politician ("John Bolton PAC"). Make the call.

Disambiguation tips for tricky cases:
- "Action Fund" or "Action" suffix on a partisan-named PAC (Senate Conservatives Action, AFP Action, Sentinel Action) = the Super PAC arm of an ideological/dark-money group → usually DARK_MONEY.
- State-named Super PAC + significant IE spending (Battleground NY, Buckeye Values, Save California, Leadership for Ohio) → DARK_MONEY.
- Auto / Automotive / Auto Dealers / Free Trade PACs → CORPORATE (auto industry).
- "Demand Justice", "End Citizens United", "Common Cause" → IDEOLOGICAL (single-issue advocacy).
- "APIA", "AAPI", "Asian American" → IDEOLOGICAL (demographic mobilization, like BlackPAC/Somos).
- "Hunters and Anglers" or "Outdoor" naming → IDEOLOGICAL (conservation/sportsmen).
- Named after a politician (John Bolton PAC, Friends of X) → LEADERSHIP.
- Generic patriotic super PAC name with no connected org + high IE spending → DARK_MONEY (default for committee_type O/V/W).

Methodology stance:
- CORPORATE, FOREIGN_POLICY, DARK_MONEY count AGAINST the legislator's PAC score (influence-buying signals).
- ACTIVIST, LABOR, IDEOLOGICAL, LEADERSHIP do NOT count against (cause advocacy, labor organizing, broad partisan grassroots, or intra-political transfer).
- Be conservative: if a Super PAC has a vague patriotic name and no clear cause (e.g. "Truth and Courage PAC", "America First Action"), classify as DARK_MONEY (it's swinging elections, not advancing a cause).
- If a Super PAC has a clear cause in its name even if billionaire-funded (e.g. "Everytown for Gun Safety", "Climate Power Action"), classify as ACTIVIST (it exists for the cause, not just to swing).
- Distinguish ACTIVIST from IDEOLOGICAL by: ACTIVIST has a single-issue cause; IDEOLOGICAL is broader partisan/values stance.

Output via the classifyPac tool.`;

interface PacRow {
  committee_id: string;
  name: string;
  committee_type: string;
  org_type: string;
  connected_org: string;
  total_receipts: string;
  contribs_to_others: string;
  ind_exp: string;
  proposedClass: string;
  reason: string;
  finalClass: string;
}

function parseCsv(text: string): { header: string; rows: PacRow[] } {
  const lines = text.split('\n');
  const header = lines[0];
  const rows: PacRow[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) continue;
    // Handle quoted fields with commas
    const cols: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (const ch of line) {
      if (ch === '"' && !inQuotes) inQuotes = true;
      else if (ch === '"' && inQuotes) inQuotes = false;
      else if (ch === ',' && !inQuotes) {
        cols.push(cur);
        cur = '';
      } else cur += ch;
    }
    cols.push(cur);
    if (cols.length < 11) continue;
    rows.push({
      committee_id: cols[0],
      name: cols[1],
      committee_type: cols[2],
      org_type: cols[3],
      connected_org: cols[4],
      total_receipts: cols[5],
      contribs_to_others: cols[6],
      ind_exp: cols[7],
      proposedClass: cols[8],
      reason: cols[9],
      finalClass: cols[10] ?? '',
    });
  }
  return { header, rows };
}

function csvEscape(v: string): string {
  if (v.includes(',') || v.includes('"') || v.includes('\n')) return '"' + v.replace(/"/g, '""') + '"';
  return v;
}

function rowToCsv(r: PacRow): string {
  return [
    r.committee_id,
    r.name,
    r.committee_type,
    r.org_type,
    r.connected_org,
    r.total_receipts,
    r.contribs_to_others,
    r.ind_exp,
    r.proposedClass,
    r.reason,
    r.finalClass,
  ]
    .map(csvEscape)
    .join(',');
}

interface LlmResult {
  class: string;
  reason: string;
}

async function classifyPac(r: PacRow): Promise<LlmResult | null> {
  const userText = `Classify this PAC.

Committee name: ${r.name}
Committee type: ${r.committee_type} (Q/N=direct PAC; O/V/W/I=Super PAC or hybrid)
Org type: ${r.org_type || '(blank)'}
Connected org: ${r.connected_org || '(none)'}
Total receipts: $${r.total_receipts}
Direct contributions to candidates: $${r.contribs_to_others}
Independent expenditures: $${r.ind_exp}

Output via the classifyPac tool.`;

  const body = {
    model: KIE_MODEL,
    max_tokens: 250,
    stream: false,
    system: SYSTEM_PROMPT,
    tools: [
      {
        name: 'classifyPac',
        description: 'Classify the PAC into one of the 7 Common Ground campaign-finance taxonomy classes.',
        input_schema: {
          type: 'object',
          properties: {
            class: {
              type: 'string',
              enum: [
                'CORPORATE',
                'FOREIGN_POLICY',
                'DARK_MONEY',
                'ACTIVIST',
                'LABOR',
                'IDEOLOGICAL',
                'LEADERSHIP',
                'UNKNOWN',
              ],
              description: 'The classification bucket.',
            },
            reason: {
              type: 'string',
              description: 'One short sentence explaining the call.',
            },
          },
          required: ['class', 'reason'],
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'classifyPac' },
    messages: [{ role: 'user', content: userText }],
  };

  const res = await fetch(KIE_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KIE_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.warn(`  [llm] HTTP ${res.status} for ${r.committee_id} ${r.name}: ${text.slice(0, 150)}`);
    return null;
  }
  const json = (await res.json()) as {
    code?: number;
    msg?: string;
    content?: Array<{ type: string; input?: unknown }>;
  };
  // KIE returns HTTP 200 with code=402/etc for API-level errors (credits,
  // rate limit). Surface these loudly so we don't silently fail across 100s
  // of calls.
  if (json.code && json.code !== 200) {
    console.warn(`  [llm] KIE error code=${json.code} for ${r.committee_id}: ${json.msg ?? '(no msg)'}`);
    return null;
  }
  const toolBlock = json.content?.find((c) => c.type === 'tool_use');
  if (!toolBlock?.input) return null;
  const out = toolBlock.input as Record<string, unknown>;
  const cls = String(out.class ?? 'UNKNOWN').toUpperCase();
  const allowed = new Set([
    'CORPORATE',
    'FOREIGN_POLICY',
    'DARK_MONEY',
    'ACTIVIST',
    'LABOR',
    'IDEOLOGICAL',
    'LEADERSHIP',
    'UNKNOWN',
  ]);
  if (!allowed.has(cls)) return null;
  return {
    class: cls,
    reason: String(out.reason ?? '').slice(0, 200),
  };
}

async function main(): Promise<void> {
  if (!KIE_API_KEY) {
    console.error('KIE_API_KEY missing');
    process.exit(1);
  }
  const csvPath = path.join(process.cwd(), 'data', 'pac-candidates.csv');
  const { header, rows } = parseCsv(fs.readFileSync(csvPath, 'utf-8'));
  const unknowns = rows.filter((r) => r.proposedClass === 'UNKNOWN');
  console.log(`[llm-classify-pacs] ${rows.length} total rows, ${unknowns.length} UNKNOWN to classify`);

  let processed = 0;
  let updated = 0;
  for (let i = 0; i < unknowns.length; i += PARALLEL) {
    const batch = unknowns.slice(i, i + PARALLEL);
    const results = await Promise.all(batch.map((r) => classifyPac(r)));
    for (let j = 0; j < batch.length; j += 1) {
      const r = batch[j];
      const out = results[j];
      processed += 1;
      if (out && out.class !== 'UNKNOWN') {
        r.proposedClass = out.class;
        r.reason = `llm: ${out.reason}`;
        updated += 1;
      }
    }
    if (processed % 25 === 0 || processed === unknowns.length) {
      console.log(`  classified ${processed}/${unknowns.length}, ${updated} updated`);
    }
  }

  // Write CSV back
  const out: string[] = [header];
  for (const r of rows) out.push(rowToCsv(r));
  fs.writeFileSync(csvPath, out.join('\n'));
  console.log(
    `\n[llm-classify-pacs] ✓ ${updated} UNKNOWN rows reclassified, ${unknowns.length - updated} still UNKNOWN`,
  );

  // Final breakdown
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.proposedClass] = (counts[r.proposedClass] ?? 0) + 1;
  console.log(`[llm-classify-pacs] final breakdown: ${JSON.stringify(counts)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
