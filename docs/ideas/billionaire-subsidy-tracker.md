# Idea: Billionaire Government-Subsidy Tracker

**Status:** Loose exploratory idea. NOT a spec. No code, no schema commitments. Nothing here is decided.

**One line:** The scorecard tracks money flowing _to_ politicians (PACs). The flip side is money flowing _from_ the public purse _to_ billionaires and their companies — contracts, grants, loans, subsidies, tax breaks. Can we quantify "how much has billionaire X extracted from the public purse," starting with Elon Musk, in a way that is cross-partisan, source-traceable, and honest about its limits?

---

## 1. The premise

Common Ground already measures one direction of the money/power relationship: **influence bought** — corporate-PAC contributions flowing to legislators (Plank 1, the PAC ranking page). This idea proposes a complementary surface measuring the other direction: **public money captured** — the dollars that flow from federal/state government out to a small number of very wealthy individuals through the companies they control.

The marquee example, and the reason this is timely, is Elon Musk. A February 2025 _Washington Post_ analysis — built on Good Jobs First data plus USAspending, FPDS, and SEC filings — put the lifetime government funding to Musk's companies at **at least $38 billion** over ~20 years, with another ~$11.8B in ongoing contract obligations on the books. That figure is the proof-of-concept: a single, citable, widely-reported number that demonstrates the question is answerable.

The civic frame: concentrated private wealth and concentrated public subsidy are two faces of the same accountability concern. A movement that asks "who is paying for our politics?" should also be able to ask "who is being paid by our government?" — and apply the same rubric to billionaires of every political stripe.

---

## 2. Data-source assessment

Two distinct money streams, both flowing _to_ the company (don't conflate with the PAC data, which flows _to_ politicians):

### USAspending.gov — federal contracts, grants, loans (the spine)

- **What it is:** Treasury's official open-data portal for federal awards, mandated by the DATA Act. Covers contracts, grants, direct payments, loans, and other financial assistance.
- **API:** Yes — full public REST API at `api.usaspending.gov`, no key required, open-source on GitHub (`fedspendingtransparency/usaspending-api`). Recipient-profile endpoints power the site's per-company pages and return aggregate award totals.
- **Attribution hooks:** Recipients carry **UEI** (and legacy DUNS) identifiers, plus **`recipient_parent_uei` / `recipient_parent_duns`** fields that roll subsidiaries up to a parent entity. This is the single most useful built-in feature for our problem — it lets you sum "all awards to the Tesla parent" rather than chasing dozens of subsidiary line items by hand.
- **Currency/lag:** Updates roughly monthly with a 30–90 day lag. Fine for a tracker that is historical/cumulative by nature.
- **License:** US government work, public domain. Free to reuse and republish. **This makes it the foundation.**
- **Caveat:** It records **gross award/obligation value**, not subsidy and not profit. A $20B SpaceX launch-services contract is the government _buying rockets_, not gifting money. More on this in §6.

### Good Jobs First "Subsidy Tracker" — state + local + federal subsidies/tax breaks (the canonical aggregator)

- **What it is:** The canonical database of economic-development subsidies, tax credits, abatements, and grants at federal, state, and local levels. This is the source behind the famous Musk totals — GJF themselves published the "$38 billion" framing and supplied the data WaPo used.
- **Coverage:** Strongest exactly where USAspending is weakest — **state and local tax abatements, credits, and reimbursements** that never appear in federal data. Includes a "Megadeals" list (packages ≥ $100M).
- **Parent aggregation:** GJF does the hard manual work of matching subsidiaries to parent companies, and paid downloads include parent identifiers (CIK, ISIN) to bridge to other datasets. This is genuinely valuable — it is the part nobody else does well.
- **API/access:** **No open API.** Search and on-screen display are free; **bulk CSV/XML download requires a paid subscription.** License terms for republication were not clearly documented in public pages and **must be confirmed directly with GJF before any reuse** (contact listed on their subscriptions page). Treat as: cite-and-link freely, but do not assume a right to ingest/redistribute their compiled dataset without permission.
- **Verdict:** Indispensable for the state/local + tax-break dimension and for parent-company mapping, but it is a **licensing question, not just an engineering one**. Phase 0/1 can cite GJF's published numbers (with attribution) without ingesting their database.

### SAM.gov / FPDS — federal procurement detail

- **What it is:** The transaction-level system of record for federal _contracts_ (every action and modification). FPDS's public site and ezSearch are being decommissioned ~Feb 24 2026; contract-award search and the new **SAM.gov Contract Awards API** (open.gsa.gov) are the successors.
- **vs USAspending:** FPDS/SAM is finer-grained (every contract modification) and fresher (daily/weekly). USAspending aggregates the same procurement feed and adds grants/loans. For our purposes USAspending is the better entry point; SAM/FPDS is a drill-down for verifying or itemizing a specific contract.
- **Access:** Full SAM.gov functionality needs a Login.gov account; public users can still read procurement data via USAspending. Public-domain data.
- **Verdict:** Useful as a verification/detail layer, not the primary feed.

### SEC filings / annual reports — the company's own numbers

- **What it is:** 10-Ks / annual reports sometimes disclose government revenue concentration, tax provisions, and benefits received. Public-domain via EDGAR.
- **Use:** A sanity-check and a source for things government data hides (e.g., how much of a company's revenue _is_ government). Hard to parse, inconsistent across filers, no clean per-subsidy line. **Supporting evidence, not a primary ledger.**

### State-level subsidy/incentive disclosures

- Highly fragmented — every state runs its own (often poor) disclosure regime. This is precisely the fragmentation GJF exists to solve. Direct state ingestion is a long tail not worth chasing early; lean on GJF for state/local.

### Others worth a mention

- **ProPublica / OpenCorporates / OpenSecrets** — adjacent context (org structure, the political-money side we already have).
- **DOE Loan Programs Office, Ex-Im Bank, NASA/DoD contract announcements** — agency-specific primary sources useful for spot-verifying marquee items (e.g., the 2010 DOE Tesla loan).

**Bottom line on sources:** USAspending (public-domain API) is the automatable spine for federal contracts/grants/loans. Good Jobs First is the irreplaceable layer for state/local subsidies and tax breaks and for parent-company mapping — but it is paid and license-gated. SAM/FPDS and SEC are verification/detail layers. The honest, defensible number is a _composition_ of these, exactly as WaPo did it — which is also why the WaPo/$38B figure is the right north star and the right cautionary tale.

---

## 3. The attribution problem (company $ → person)

This is the hard intellectual core, and the place where the feature most easily becomes misleading.

**The data attributes money to _companies_** (Tesla, SpaceX). The story wants to attribute it to a _person_ (Musk). Bridging that gap requires a defensible theory of when a company's public money is fairly described as accruing to an individual.

**Reasonable attribution bases, strongest to weakest:**

1. **Founder + controlling shareholder + CEO/chair** with effective control (Musk @ SpaceX; Bezos historically @ Amazon/Blue Origin; the Waltons collectively @ Walmart). Here it is fair to say the public money flows to an empire the individual built and controls — _with the explicit framing that it went to the company, and the person controls/benefits from the company._
2. **Large controlling stake without operational role** — weaker; the person benefits financially but "extracted" overstates agency.
3. **Minority/passive holding** — not fair to attribute. A 3% institutional position in a public contractor does not make you a subsidy recipient.

**Where it breaks down:**

- **Public companies with diffuse ownership** — Tesla's subsidies also benefit pension funds, index investors, and millions of small shareholders. Attributing 100% to Musk is rhetorically punchy and analytically false.
- **Contract ≠ personal income** — government pays SpaceX for launches; that revenue funds operations, payroll, and capital, not a wire transfer to Musk's checking account.
- **Diversified billionaires** — most of the Forbes list does not control a government-contract-heavy company at all.

**Design implication:** The unit of truth should be **the company and the award**, every figure source-linked. The _person_ is a lens layered on top, with the control relationship stated explicitly ("Companies Elon Musk founded and controls have received…"). Never imply the dollars landed in a personal account. This is both more honest and more legally defensible (§7).

---

## 4. Does it generalize?

**Works well — founder-controlled, government-adjacent empires:**

- **Musk** — Tesla, SpaceX/Starlink: contracts + EV/clean-energy subsidies + state tax deals. The archetype.
- **Bezos** — Blue Origin (NASA/DoD), Amazon (AWS GovCloud, JEDI-era contracts), plus warehouse-siting subsidies.
- **The Waltons / Walmart** — decades of state/local subsidies and abatements (a GJF staple).
- Defense-adjacent founders, large clean-energy developers, etc.

**Works poorly — and we must say so plainly:**

- **Pure financiers** (hedge-fund and PE billionaires) — wealth is in trading/management, not government contracts. Almost nothing to track here; their public-money exposure is portfolio-mediated and not attributable.
- **Media / consumer-brand / inheritance wealth** not tied to a contract-heavy company.
- **Diversified holding-company billionaires** — money is real but attribution is hopeless.

**Honest conclusion:** This is a **targeted tool for a specific archetype** (the founder-controlled, subsidy/contract-dependent empire), not a universal "billionaire scoreboard." Pretending otherwise invites the fair criticism that we cherry-pick who looks bad. The cross-partisan credibility move is to apply it to that archetype _wherever it appears_ — left-coded and right-coded billionaires alike — and to be upfront that many billionaires simply don't have a meaningful footprint in this dataset (which is itself an honest answer, not a gap).

---

## 5. Civic-scorecard fit

**Connection to the planks:** Closest to **Plank 1 (Honest Government)** — the concern with concentrated wealth distorting public decisions. PAC money (influence purchased) and subsidy capture (public money extracted) are the inflow and outflow of the same concentrated-power relationship.

**But it is not a legislator score**, and shouldn't be forced into the per-plank rubric. Legislators get scored; billionaires are not on a ballot and don't take pledges. Better framed as a **new companion "Power" surface** — a sibling to the legislator scorecard rather than a sixth plank. Tentative name in the civic register: something like **"The Public Ledger"** or **"Who the Government Pays."**

**Presentation — a billionaire profile page** balancing two columns:

- **Public money received** — contracts / grants / loans / subsidies / tax breaks, by company, by level (federal/state/local), each line source-linked, with the gross-vs-net distinction visible (see §6).
- **Political money given** — campaign and PAC contributions by the individual and their companies (data we partly have / can source).

The juxtaposition — "received $X from government, gave $Y to politics" — is the civic point, made without editorializing. Let the sourced numbers speak.

**Voice register (Lincoln–Eisenhower–MLK, cross-partisan):** Frame as stewardship of the public purse and equal scrutiny under one rule — "We the People are entitled to know who our government pays, and who pays our politics." Avoid "oligarch," "grift," partisan villain-framing, or singling out one ideological camp. Scrutinize billionaires of all political stripes by the same method; if the method only catches one side, that's a finding to disclose, not to hide.

---

## 6. Feasibility & phasing

- **Phase 0 — Manual proof-of-concept (Musk only).** Hand-assemble the Musk number from public sources (USAspending parent-recipient totals + GJF's published figures + a handful of marquee items spot-verified against SAM/FPDS/SEC). Reproduce something close to the WaPo $38B with every line citable. Goal: prove we can build a defensible, source-linked profile by hand. Pure research + a single static page; no schema.
- **Phase 1 — A handful of hand-curated billionaires.** Add 3–6 founder-controlled archetypes spanning the political spectrum (deliberately not all one party). Still curated; establish the profile-page template, the "received vs. given" layout, and the sourcing/footnote discipline.
- **Phase 2 — Semi-automated federal layer.** Wire the USAspending API (parent-recipient aggregation) to auto-pull federal contracts/grants/loans for tracked entities, refreshed on the existing manual-script cadence. State/local subsidies + tax breaks stay curated (GJF-sourced, license permitting).
- **Phase 3+ (speculative).** Deeper GJF integration (requires a license conversation), SAM Contract Awards API drill-downs, automated "received vs. given" reconciliation. Only if Phases 0–2 earn it.

**Data-quality caveats baked in from Phase 0 (non-negotiable):**

- **Gross contract value ≠ subsidy ≠ profit ≠ personal income.** Never present a single blended "Musk got $X" number without the breakdown by _type_ (contract / grant / loan / tax break) and a plain-English note that contracts are the government _buying things_. The blended figure is exactly what critics (fairly) hit the WaPo number on.
- **Loans are not gifts** — show repayment status (the DOE Tesla loan was repaid early, with interest).
- **Avoid double-counting** across USAspending and GJF (same award can appear in both).
- **Lifetime cumulative vs. annual** must be labeled; "$38B over 20 years" ≠ "$38B/year."
- **Coverage gaps are findings, not hidden** — classified/defense contracts and undisclosed-amount items are excluded; say so.

---

## 7. Risks

- **Defamation / accuracy bar — highest priority.** These are named, living, litigious people. Every number must trace to a specific public source on the page. No estimates presented as facts; no inferred "personal" dollars. The company/award is the unit of truth; the person is a clearly-labeled lens. Stick to what reputable outlets (WaPo) and public data already establish, and cite them.
- **Methodology transparency.** Like the legislator scorecard, this needs a published methodology doc explaining sources, the attribution theory, the gross-vs-net treatment, and known gaps — before any public launch. The credibility of the whole project rests on the method being legible and identical across subjects.
- **Cross-partisan integrity / selection bias.** If the tracked set skews toward one political camp, the tool reads as a hit list. Curate the archetype across the spectrum, and disclose the selection rule. "We track founder-controlled, contract/subsidy-heavy empires; here is everyone who qualifies" is defensible. "Here are the billionaires we don't like" is not.
- **Scope creep.** The temptation to become a general "billionaire wealth tracker" or net-worth scoreboard. Resist — this is specifically a _public-money-flow_ tool. Wealth, lifestyle, and unrelated controversy are out of scope.
- **Data licensing (GJF).** Citing published figures is fine; ingesting/redistributing the GJF dataset is a license question to settle before Phase 2+. Don't build on an assumption of free reuse.
- **Maintenance burden.** Like the legislator pipeline, runs would be manual/curated, not real-time. Set the freshness expectation honestly ("data through Q\_ 20\_\_").

---

## Recommended first step

Phase 0, Musk only: a single hand-built, fully source-linked profile that reconstructs the public-money total by type, sitting beside his political giving — proving the method is honest and reproducible before any code or schema.

## Sources

- [Washington Post — Elon Musk's business empire is built on $38 billion in government funding](https://www.washingtonpost.com/technology/interactive/2025/elon-musk-business-government-contracts-funding/)
- [Good Jobs First — Elon Musk's business empire is built on $38 billion in government funding](https://goodjobsfirst.org/elon-musks-business-empire-is-built-on-38-billion-in-government-funding/)
- [Good Jobs First — Our data fuels WaPo reporting on Musk](https://goodjobsfirst.org/our-data-fuels-wapo-reporting-on-musk/)
- [Good Jobs First Subsidy Tracker — Megadeals](https://subsidytracker.goodjobsfirst.org/megadeals)
- [Good Jobs First Subsidy Tracker — Data Sources](https://subsidytracker.goodjobsfirst.org/pages/data-sources)
- [Good Jobs First Subsidy Tracker — Subscriptions / access](https://subsidytracker.goodjobsfirst.org/plans)
- [USAspending API](https://api.usaspending.gov/)
- [USAspending — Analyst's Guide to Federal Spending Data](https://www.usaspending.gov/federal-spending-guide)
- [USAspending API contracts — recipient endpoints (GitHub)](https://github.com/fedspendingtransparency/usaspending-api/blob/master/usaspending_api/api_contracts/contracts/v2/recipient.md)
- [SAM.gov — Contract Award Data (FPDS migration)](https://sam.gov/fpds)
- [SAM.gov Contract Awards API (GSA Open Technology)](https://open.gsa.gov/api/contract-awards/)
- [Fortune — Musk's companies have received at least $20 billion from the government](https://fortune.com/2025/02/13/elon-musk-rich-taxpayer-expense/)
