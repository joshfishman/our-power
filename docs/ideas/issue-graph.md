# Issue Graph — a crowdsourced map of issues and solutions

Idea doc. Nothing here is built yet. Companion to the Common Ground scorecard
(`docs/scorecard-methodology.md`); this page would live alongside it and share
its plank data.

**Drafted:** 2026-10-18.

---

## The idea

An interactive network graph of U.S. policy: issues, the solutions proposed for
them, and the bills that carry those solutions, joined by lines showing how they
relate. Anyone can explore it. Each visitor can click the pieces that matter to
them, and that choice is saved. Over time the graph shows, by size and weight,
which issues people care about most — a reading of public priority built from
use, not from a poll.

The initial graph is fed by a large sweep of current public polling — what
Americans say the country's problems are, and how much support each proposed
answer has — layered over the Common Ground platform. It also deliberately
includes new and untested ideas that no pollster has asked about yet, clearly
marked as such. It grows by contribution toward a map of the whole policy
landscape.

## Why it fits Our Power

- **The seed data already exists.** The five planks, their commitments, their
  markers, and the bills behind each marker are a ready-made graph:
  ~5 plank hubs → ~25 commitments → ~33 federal markers → the bills in
  `MarkerBill`. California adds its four planks.
- **It feeds the scorecard.** Marker rows already carry `popularSupport` from
  curated polls (methodology v1.9.2). The graph would give a second, organic
  signal of what matters to people — useful context, never a substitute for the
  polling floor.
- **It is a front door.** The scorecard asks "how does my legislator rate?"
  The graph asks "what do I care about?" — a gentler first question, and one
  that leads straight to the pledge and to campaigns on the same issues.

---

## Graph model

### Nodes

| Type       | What it is                                                                  | Seeded from                     |
| ---------- | --------------------------------------------------------------------------- | ------------------------------- |
| `PLANK`    | One of the five Common Ground planks — a hub                                | `Plank`                         |
| `ISSUE`    | A problem in plain words ("Members of Congress trade stocks they regulate") | `Plank.commitments`, then crowd |
| `SOLUTION` | A policy answer to an issue ("Ban congressional stock trading")             | `Marker`, then crowd            |
| `BILL`     | A specific bill carrying a solution                                         | `MarkerBill`                    |

Every node: short title, one-paragraph plain-language description, optional
source links, a `status` (`SEEDED | PROPOSED | APPROVED | REJECTED`), an
`origin` (`PLATFORM | POLLING | FRONTIER | COMMUNITY`) so the Common Ground
positions are always distinguishable from everything else, and an evidence
tier (see "Seeding" below) saying how much public opinion data stands behind
it.

### Edges

| Type             | Meaning                                                                                                                                                                                       |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PART_OF`        | Issue belongs under a plank                                                                                                                                                                   |
| `ADDRESSES`      | Solution addresses an issue                                                                                                                                                                   |
| `CARRIES`        | Bill carries a solution                                                                                                                                                                       |
| `ALTERNATIVE_TO` | Two solutions to the same issue from different directions (maps directly onto the Option C `parallelMarkerId` pairs — the Republican-led alternatives sit beside the primary, not beneath it) |
| `RELATED`        | Loose association between issues                                                                                                                                                              |
| `TENSION`        | Two solutions that pull against each other                                                                                                                                                    |

`ALTERNATIVE_TO` and `TENSION` matter: a cross-partisan map has to show that
there is more than one serious answer to most problems. A graph with only one
solution per issue would read as a platform, not a map.

### Interactions (the crowdsourced part)

- **"This matters to me"** — a toggle on any node. One per person per node.
  This is the priority signal.
- **Propose** — suggest a new issue, solution, or connection. Goes to a
  moderation queue; nothing community-made appears without approval.
- Later, maybe: **"I'd support this"** on solutions, distinct from "this
  matters" on issues. Keep v1 to one action so the signal stays clean.

---

## Seeding: a polling sweep, plus frontier ideas

The graph should not open as one platform's view of the world. Its first
version is built from what the public has actually said, then widened with
ideas the public hasn't been asked about yet.

### 1. The polling sweep

A one-time research pass (then refreshed on a schedule) across current national
polling. Two different measurements, kept apart:

| Measures                                       | Feeds                                                                  | Example sources                                                                                                                                                                                                                               |
| ---------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Salience** — what people name as a problem   | `ISSUE` nodes and their initial weight                                 | Gallup "Most Important Problem" (monthly, open-ended — the best long-run salience series), Pew Research priority surveys, AP-NORC issue questions                                                                                             |
| **Support** — how many favor a specific answer | `SOLUTION` nodes, with a support % and party crosstabs where published | Pew, AP-NORC, Gallup, KFF (health), YouGov/Economist, Ipsos, Marquette Law national, Data for Progress, Navigator, Echelon Insights, Program for Public Consultation (deliberative polls — notably good at finding cross-partisan majorities) |
| **Archive / back-check**                       | Verifying question wording and trends                                  | Roper Center iPoll (subscription), PollingReport.com                                                                                                                                                                                          |

Rules for the sweep, borrowed from the existing popular-support work on
`Marker.popularSupport` (`scripts/seed-marker-support.ts`, methodology v1.9.2):

- **Every figure carries a citation**: pollster, field dates, sample, source
  URL, and the exact question wording. Wording drives results more than
  anything else; a support number without its question is not usable.
- **Recency window**: field dates within the last ~24 months for support,
  last 12 for salience. Older polls kept as history, not as the current
  figure.
- **Multiple polls per node where possible**, shown as a range plus the
  median, not a single cherry-picked number. Spread across left-, right-, and
  nonpartisan-leaning pollsters on purpose.
- **Crosstabs by party** where the pollster publishes them. These are
  published aggregates, not data about our users, so they don't touch the
  privacy rules below. They let the graph show which ideas cross party lines —
  the Common Ground thesis made visible.
- **Same source of truth as the scorecard.** Where a polled solution is
  already a `Marker`, the graph reads `popularSupport` from that row rather
  than holding a second copy. A new sweep figure for a marker updates the
  marker (and is a methodology-doc change, since it can move the 55% floor).
- Store sweep results as a curated, reviewed data file (CSV/JSON in
  `data/polling/`) loaded by the seed script — not scraped live. A human
  checks each row before it lands.

Target size for the first sweep: on the order of 50–100 issues and 200–400
solutions, which is enough to cover the ground and still be reviewable by hand.

### 2. Frontier ideas — new and out there

Polling only covers what pollsters already ask about. The interesting part of a
map is the edge of it. The seed also includes ideas with little or no polling:

- Proposals from think tanks across the spectrum (e.g. Niskanen, Brookings,
  AEI, Roosevelt Institute, Cato, Urban Institute, Manhattan Institute),
  academic work, and state-level experiments that haven't gone national.
- Structural and long-horizon ideas: ranked-choice or proportional
  representation, citizens' assemblies, term limits on the Court,
  democracy vouchers, land value tax, baby bonds, a congressional
  apportionment increase, and similar.
- Each frontier node still needs a real source (a paper, a bill, a pilot
  program) — "out there" doesn't mean unsourced.

### Evidence tiers

Every `SOLUTION` node carries one, and the graph styles them differently so a
visitor always knows what they're looking at:

| Tier        | Meaning                                                         | Look                  |
| ----------- | --------------------------------------------------------------- | --------------------- |
| `MAJORITY`  | Polled, median support ≥ 55% (same line as the scorecard floor) | Solid                 |
| `CONTESTED` | Polled, below 55%                                               | Solid, muted          |
| `UNPOLLED`  | Real proposal, no usable national polling yet                   | Dashed outline        |
| `COMMUNITY` | Proposed by users, approved by moderation                       | Dashed, distinct mark |

Frontier and community ideas earn standing through the "this matters to me"
signal. A frontier idea that draws a lot of interest is a finding in itself —
and a candidate for the next polling ask, or for a partner organization to
commission a poll on.

---

## Software

### Rendering library — recommendation: Sigma.js + graphology

| Library                                              | Renders | Comfortable size           | Notes                                                                                                                                                                                                                            |
| ---------------------------------------------------- | ------- | -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sigma.js + graphology** (with `@react-sigma/core`) | WebGL   | tens of thousands of nodes | Graph model (graphology) is separate from rendering, so layout, filtering, and community detection run on the data, not the canvas. ForceAtlas2 layout available as a plugin. Best fit if this grows toward "all U.S. policies." |
| react-force-graph (2D)                               | Canvas  | low thousands              | Fastest to a working prototype; very little code. Good fallback if Sigma's React wrapper fights the App Router.                                                                                                                  |
| Cytoscape.js                                         | Canvas  | low thousands              | Strongest built-in analysis and styling language; heavier, more academic look.                                                                                                                                                   |
| React Flow (`@xyflow/react`)                         | DOM/SVG | hundreds                   | Built for editable diagrams, not exploratory networks. Wrong tool here.                                                                                                                                                          |

Pick Sigma + graphology. The seed graph is a few hundred nodes, which any of
these handle, but the stated goal is the full policy landscape, and Sigma is the
only one above that won't need replacing at that scale. Pin an exact version at
install time.

Rendering must be client-only (`dynamic(..., { ssr: false })`). Colors come
from the existing tokens — node fills read CSS variables at runtime; no
hard-coded hex (the ESLint rule applies). Plank hubs can use the plank's
`color` field only if it is moved onto a token first.

### Prior art worth studying

- **Pol.is** — open source, used by Taiwan's vTaiwan process. Crowdsources
  statements, people agree/disagree, and it surfaces consensus that crosses
  opinion groups. Its "find what divided people agree on" idea is close to the
  Common Ground thesis. AGPL-licensed — study it, don't vendor its code into
  this repo without a licensing decision.
- **Kialo** — structured pro/con argument trees. Useful for how it keeps
  community contributions orderly.

### Accessibility

A force graph is not accessible on its own. Ship a list view beside it — the
same nodes as a searchable, grouped list with the same "this matters" toggle —
and treat that as a first-class view, not a fallback. React Aria is already in
the stack for this.

---

## Data model sketch (Prisma)

```prisma
model IssueNode {
  id          String          @id @default(cuid())
  type        IssueNodeType   // PLANK | ISSUE | SOLUTION | BILL
  title       String
  description String          @db.Text
  status      IssueNodeStatus // SEEDED | PROPOSED | APPROVED | REJECTED
  origin      IssueNodeOrigin // PLATFORM | POLLING | FRONTIER | COMMUNITY
  evidenceTier EvidenceTier?  // MAJORITY | CONTESTED | UNPOLLED | COMMUNITY (solutions)
  salience    Float?          // % naming this issue as a problem (issues)
  plankId     String?         // set for nodes seeded from scorecard data
  markerId    String?
  markerBillId String?
  proposedById String?
  // denormalized count, refreshed on write; the source of truth is IssueNodeInterest
  interestCount Int           @default(0)
}

model IssueEdge {
  id       String        @id @default(cuid())
  fromId   String
  toId     String
  type     IssueEdgeType // PART_OF | ADDRESSES | CARRIES | ALTERNATIVE_TO | RELATED | TENSION
  status   IssueNodeStatus
  @@unique([fromId, toId, type])
}

// One row per poll result; a node shows the range + median of its rows.
// Markers keep using Marker.popularSupport — this table is for non-marker nodes.
model IssuePollResult {
  id           String   @id @default(cuid())
  nodeId       String
  measure      PollMeasure // SALIENCE | SUPPORT
  value        Float       // 0–100
  pollster     String
  fieldStart   DateTime
  fieldEnd     DateTime
  sampleSize   Int?
  population   String?     // adults / registered voters / likely voters
  questionText String   @db.Text
  sourceUrl    String
  partyCrosstab Json?      // { dem, rep, ind } where published
}

model IssueNodeInterest {
  nodeId    String
  userId    String
  createdAt DateTime @default(now())
  @@id([nodeId, userId])
}
```

Seed script: `prisma/seed-issue-graph.ts`, idempotent like
`seed-scorecard.ts`, reading planks/markers/bills from the database so the graph
never drifts from the scorecard.

## API

Following the existing public-route pattern (CORS + Upstash rate limit + Zod):

- `GET /api/issue-graph` — approved nodes and edges with aggregate interest
  counts. Cacheable.
- `POST /api/issue-graph/nodes/[id]/interest` — toggle. Auth required.
- `POST /api/issue-graph/proposals` — propose a node or edge. Auth required.
- Admin moderation sits with the Phase 6 verification UI work (PR #50) rather
  than becoming a second admin surface.

---

## Integrity and privacy

The whole value of the signal is that it's honest. Decisions:

- **Signed-in clicks only count.** Anonymous visitors can explore and toggle,
  saved locally, with a prompt to sign in to make it count. One account, one
  vote per node. Rate-limit toggles.
- **Aggregates only, never individuals.** Nobody can see what a given person
  selected. Hide a node's count until it passes a small threshold (e.g. 10) so
  early counts can't identify anyone.
- **No party or demographic collection in v1.** Tempting for "what crosses
  lines" analysis à la Pol.is, but it's sensitive data and changes the privacy
  posture. Revisit deliberately, if at all.
- **Moderation rules published.** What gets approved, what gets rejected, and
  why — same spirit as the published methodology.
- **Neutral copy.** Node titles and descriptions follow the project voice: civic,
  plain, cross-partisan. Community proposals are edited to that standard before
  approval.
- **Not a score input.** Interest counts never change a legislator's score. If
  that ever changes it's a methodology version bump with its own doc entry.

---

## Phases

0. **Polling sweep + frontier list** — research pass producing the reviewed
   `data/polling/` files and a sourced frontier-ideas list. This is research
   work, not code, and it gates everything after it.
1. **Read-only graph** from the sweep + seeded scorecard data. Sigma render,
   list view, evidence-tier styling, node detail panel showing the polls behind
   a node and linking to the existing `/scorecard/bills/[id]` and issue pages.
   Proves the library choice and the layout.
2. **"This matters to me"** — interest table, toggle API, node sizing by
   interest, a "most important to people" ranking.
3. **Proposals + moderation** — community nodes and edges.
4. **Refresh cadence** — re-run the salience sweep quarterly and support
   sweep twice a year; track how issue weight moves over time.

## Open questions

- Route: `/scorecard/map`, `/issues/graph`, or its own top-level page?
- Does "all potential U.S. policies" include positions Common Ground opposes?
  A true map should; the platform nodes stay marked as ours.
- How far out is "out there"? Needs a written inclusion rule for frontier
  ideas (real source required; anything else?) so curation doesn't look like
  editorializing.
- Roper iPoll subscription — worth paying for the archive, or is the free
  pollster-published data enough for the first sweep?
- Federal and California in one graph, or a jurisdiction toggle?
- Should campaigns (Our Power's `Campaign` model) attach to issue nodes, so a
  click on an issue leads to an action someone can take?
