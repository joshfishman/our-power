# Welfare for Billionaires — revenue research notes

Working notes behind the revenue half of `/scorecard/power`. Companion to
`billionaire-subsidy-tracker.md` (the original idea doc) and to the data-source
catalog in `docs/scorecard-methodology.md`.

**Retrieved:** 2026-08-26. Every figure below moves; re-run the ingest and
re-check the filings before citing any of it in public material.

---

## The distinction this page exists to draw

The first version of these pages summed contracts, subsidies, loans, and
regulatory credits into a single "money in" headline. That is the mistake the
page was built to expose, committed by the page itself. Four different things
were being added:

| Kind                    | What it actually is                                                                   | Counts toward the "given" headline?  |
| ----------------------- | ------------------------------------------------------------------------------------- | ------------------------------------ |
| **Contract revenue**    | The government wanted a launch, a cloud, a data platform, and paid a negotiated price | No — reported separately as "earned" |
| **Subsidy / abatement** | Cash or forgone tax revenue, with no service bought in return                         | Yes                                  |
| **Tax credit (supply)** | A credit paid to the company itself (e.g. §45X manufacturing)                         | Yes                                  |
| **Tax credit (demand)** | A credit paid to the company's _customers_ (e.g. the §30D EV credit)                  | No — never touched the company       |
| **Loan**                | Repaid. Tesla repaid its DOE loan early, at a profit to taxpayers                     | No — displayed, excluded             |
| **Regulatory credit**   | Paid by _rival automakers_ buying compliance credits. Not Treasury money at all       | No — displayed, excluded             |
| **Political spending**  | Money flowing the opposite direction                                                  | Never                                |

The page now leads with two figures — **earned** and **given** — and states in
copy that they must not be added.

---

## What I found: federal revenue (USAspending)

`npm run scorecard:ingest-usaspending` pulls prime-contract **obligations** from
`api.usaspending.gov` (no key required). Obligations are dollars the government
has legally committed — the closest public measure of revenue earned from
taxpayers.

Cumulative FY2008–FY2025, and the two most recent years:

| Company                      | Profile | FY2024 | FY2025 | Cumulative since FY2008 |
| ---------------------------- | ------- | ------ | ------ | ----------------------- |
| SpaceX                       | Musk    | $3.40B | $3.01B | **$14.49B**             |
| Palantir Technologies        | Thiel   | $541M  | $1.02B | **$3.60B**              |
| Blue Origin                  | Bezos   | $520M  | $936M  | **$2.43B**              |
| Anduril Industries           | Thiel\* | $657M  | $612M  | **$1.87B**              |
| Amazon (AWS + selling ents.) | Bezos   | $248M  | $333M  | **$772M**               |
| Tesla, Inc.                  | Musk    | $67K   | $17K   | **$438K**               |
| Walmart / Wal-Mart Stores    | Walton  | $0     | $0     | **$452K**               |

\* Anduril is a Founders Fund portfolio company. Thiel is an **investor, not the
operator**; the row is displayed but flagged and excluded from totals.

### Three findings worth keeping

1. **Tesla and Walmart are not federal contractors.** Under a million dollars
   each, cumulatively, across eighteen years. Their public money is subsidies,
   tax credits, and demand-side programs — not contracts. The near-zero rows are
   kept on the page deliberately: it is a finding, not a coverage gap, and it
   guards against the assumption that every large company lives off contracts.
2. **SpaceX's federal revenue is growing fast and is now the dominant fact of
   the Musk profile** — roughly $3B/year, more than six times Tesla's _lifetime_
   federal contracting, and far larger than the $3.8B in subsidies the same
   profile documents.
3. **Palantir's obligations nearly doubled in FY2025** ($541M → $1.02B).

### Where this measure undercounts, and by how much I cannot say

- **Classified and intelligence work is largely absent.** This is the biggest
  gap and it is not quantifiable from public data.
- **Resellers break attribution.** Federal cloud is very often bought through
  Carahsoft, Four Points Technology, or ECS Federal, and USAspending credits the
  _reseller_. AWS's $772M is therefore a floor and a poor one — Amazon's real
  federal business is certainly much larger. I did not find a defensible public
  method to attribute reseller volume back to AWS, and I did not guess.
- **Subawards are excluded.** These are prime obligations only.
- **Obligations ≠ recognized revenue.** Palantir booked $1.855B of US-government
  revenue in FY2025 against $1.02B of prime obligations — the gap is subcontract
  work, non-federal government customers, and revenue-recognition timing. Both
  numbers are on the page, labelled as the different things they are.

---

## Corrections made to existing figures

Auditing the curated data against sources turned up several figures that were
being summed when they should not have been:

- **Palantir's 10-K US-government revenue** (FY2022–FY2025) was typed as
  _contract awards_ and summed on top of the individual contract line items —
  the same dollars counted twice. Retyped to `COMPANY_REPORTED_GOV_REVENUE` and
  excluded from totals (they are overlapping annual snapshots; summing four
  consecutive years of a revenue line invents money).
- **Announced ceilings counted as money paid.** The NSA "Wild and Stormy" $10B,
  JWCC's $9B shared four ways, NSSL Phase 3, and Palantir's $10B Army enterprise
  agreement are all _spending limits_, frequently never reached.
- **The cancelled Amazon HQ2 New York package** (~$3B) was counted despite never
  having been paid — the deal collapsed in February 2019.
- **Walmart SNAP register revenue** sat in the subsidy bucket. SNAP dollars are
  revenue Walmart earns at the register when customers spend a public benefit —
  not a handout to Walmart. Moved to the revenue side.
- **Regulatory credits and a repaid loan** were inflating Musk's "money in"
  headline by roughly $11.9B. Both are now displayed with their own subtotals
  and explicitly excluded from the headline.

Net effect on the Musk profile: the headline "given" figure fell from ~$38B to
**$3.8B**, with **$14.5B** reported separately as earned contract revenue. The
smaller number is the honest one.

---

## Company-reported government revenue (SEC filings)

### SpaceX is no longer private — this changed the whole picture

SpaceX completed its IPO in **June 2026** and now files with the SEC (CIK
0001181412). The prospectus states outright:

> In 2025, approximately one-fifth of our revenue was attributable to agencies
> within the U.S. federal government.

On 2025 revenue of $18.67B that implies roughly **$3.9B** — consistent in
magnitude with the $3.01B of FY2025 prime obligations USAspending shows, with
the gap explained by fiscal-period differences, Starlink and Starshield service
revenue, and non-public awards.

**Read the denominator carefully.** The financials are retrospectively recast to
include **xAI** (acquired February 2026) and **X**, so "SpaceX revenue" is not
the rocket company: 2025 splits into Space $4.09B, Starlink $11.39B, AI $3.20B.
The page says so on the line item. There is also an unnamed "Customer A" at 20.9%
of 2025 revenue that is very likely the federal government in aggregate — but the
prospectus never says so, so we did not assert it.

Source: [424B4 prospectus](https://www.sec.gov/Archives/edgar/data/1181412/000162828026042639/spaceexplorationtechnologi.htm)

### Palantir — the US-government figure is not in the 10-K

| Period  | Total revenue | Government revenue | Gov % | US government |
| ------- | ------------- | ------------------ | ----- | ------------- |
| FY2022  | $1.91B        | $1.07B             | 56.2% | ~$826M        |
| FY2024  | $2.87B        | $1.57B             | 54.8% | ~$1.20B       |
| FY2025  | $4.48B        | $2.40B             | 53.7% | **$1.855B**   |
| Q2 2026 | $1.94B        | $990M              | 51.2% | $809M         |

The 10-K discloses only Government vs. Commercial segments and revenue by
geography. **The US-government figure exists only in the quarterly earnings
releases** filed as 8-K Exhibit 99.1 — the page now cites those, not the 10-K.
Note the trend: government revenue is growing fast in dollars while _falling_ as
a share of the company, because commercial is growing faster.

### Tesla — regulatory credits and "manufacturing credits"

Regulatory credit revenue: $1,790M (2023), $2,763M (2024), **$1,993M (2025)**;
down 49% in H1 2026 after the July 2025 tax law narrowed the programs.

**Tesla's filings never use the string "45X."** It calls them _manufacturing
credits_ and books them as a **reduction of cost of revenues**, not as revenue:
$474M (2023), $1,381M (2024), **$1,685M (2025)**.

A defensible framing, all from the same filing: 2025 net income attributable to
common stockholders was $3,794M. Regulatory credits alone were **~52% of net
income**; credits plus manufacturing credits came to **~97%** of it.

### Amazon and Walmart disclose nothing — and that is the finding

- **Amazon** publishes no government or public-sector revenue figure. "Public
  sector" appears **zero times** in its 2025 and 2024 10-Ks. Its stated policy is
  that government incentives "are recorded as reductions to the cost of related
  assets or expenses" — subsidies vanish into cost lines by design.
- **Walmart's** widely-cited "18% of SNAP / $13B in 2013" **was never in a
  filing.** The string "SNAP" appears nowhere in the FY2013, FY2014, or FY2026
  10-Ks; it was a statement to reporters. This correction matters — the page
  previously described it as "last officially disclosed."
- And the government end is closed too: in _Food Marketing Institute v. Argus
  Leader Media_ (2019) the Supreme Court held store-level SNAP redemption data
  confidential under FOIA Exemption 4. **The public is legally barred from
  knowing how much public money any single retailer collects.** The best
  available figure is a Numerator retail-panel estimate of ~25.5% of SNAP grocery
  dollars — modelled, not filed.

---

## Good Jobs First Subsidy Tracker (retrieved 2026-08-26)

| Parent     | Subsidies   | Awards | Loans   |
| ---------- | ----------- | ------ | ------- |
| Amazon.com | **$15.16B** | 447    | $2.2M   |
| Tesla Inc  | **$3.16B**  | 110    | $466.5M |
| Walmart    | **$287.2M** | 631    | $0      |
| SpaceX     | $19.7M      | 8      | $106.1M |
| Palantir   | not listed  | —      | —       |

Two traps worth recording:

- **The "SpaceX" entry is mostly X, not SpaceX.** Good Jobs First files
  Twitter/X's Oregon property-tax abatements under the SpaceX parent —
  $16.5M of the $19.7M. Actual rocket-company awards are about **$3.2M**.
- **Amazon's figure is contested against Good Jobs First's own headline.** Its
  Amazon Tracker still reads "$11.6 Billion and Counting," last updated January
  2025, well behind the $15.16B on its Subsidy Tracker parent page. The page
  cites the higher, more current figure and names the discrepancy rather than
  silently picking one.
- Access note: the tracker sits behind a Cloudflare challenge; `curl` and
  automated fetches return 403. A browser session or a data subscription is
  required, which is why these figures are transcribed rather than ingested.

**Data-center abatements are the fastest-growing category.** Indiana disclosed
$655M lost to its data-center exemption as of 2025 and that **more than 83% went
to Amazon — $50.5M in 2024 and $561M in 2025**, a 1,011% single-year increase to
one company. State-level projections elsewhere (Virginia $1.94B, Ohio $1.6B,
Georgia $2.5B) cover all companies, not Amazon alone, and are revised estimates
rather than settled figures. **14 of the 37 states** with these exemptions
publish no timely loss figure at all.

---

## Political cycles — 2024 and 2026 (FEC filings)

Every 2026 figure is a **floor**: quarterly super-PAC filers report only through
2026-06-30, monthly corporate PACs through 2026-07-31, and the heaviest spending
window is still ahead.

| Figure                   | 2024 cycle  | 2026 cycle-to-date      |
| ------------------------ | ----------- | ----------------------- |
| Musk (personal)          | **$292.7M** | **$90.3M** (super PACs) |
| Walton family (≥$10K)    | **$42.9M**  | **$24.0M**              |
| Thiel                    | **$0**      | **$2.35M**              |
| Bezos (personal)         | **$15,000** | **$15,000**             |
| Walmart PAC → candidates | $1.92M      | $1.92M                  |
| Amazon PAC → candidates  | $1.46M      | $1.53M                  |

### Corrections this forced to figures already on the page

- **Thiel gave $0 in 2024**, not the ~$1.7M previously shown. A full sweep of
  itemized contributions for the two-year period returns no record belonging to
  him. (Caveat: Form 5 personal independent expenditures were not separately
  swept; his 2022 giving ran through super-PAC contributions, so a Form 5 would
  be out of pattern, but that side is strictly unverified.)
- **Thiel's 2026 total is $2.35M**, not ~$5.85M. A raw FEC search returns ~$3.19M
  but $842,700 of that is joint-fundraising money re-reported downstream — the
  same dollars twice.
- **The Walton family's 2024 total is $42.9M**, roughly double the $21.99M
  previously shown.
- **Musk's 2024 total is $292.7M** from his own filings, confirming the reported
  "more than $290 million" from primary documents.
- **The "Bezos" money attached to the With Honor Fund is his parents'** — Miguel
  and Jacklyn Bezos, including a $5,000,000 gift from Miguel in April 2026. Jeff
  Bezos's name appears on none of it. His own $10M With Honor gift was in 2018.
  A civic-accountability page repeating this attribution would be publishing an
  error, so the page now names the distinction explicitly.

### Two findings worth putting in front of readers

- **There is no "America Party."** Musk announced it in July 2025, but no such
  committee exists at the FEC — a Form 1 that briefly appeared was disowned by
  Musk as fraudulent and removed. His 2026 money runs through the pre-existing
  America PAC and established Republican infrastructure.
- **America PAC has spent $52.3M this cycle and only $87,133 of it on federal
  independent expenditures.** The money is going to operations, not to ads for
  candidates.
- **The Walton family's giving is genuinely mixed** — Americans for Prosperity
  Action alongside Unite America PAC, WelcomePAC, the Republican Accountability
  PAC, and the LCV Victory Fund. Worth showing, because it cuts against a
  one-party reading.

### A reproducibility warning

OpenFEC's `/schedules/schedule_a/` **ignores `page=2` when sorted** and returns
the identical first 100 rows. Seek pagination (`last_index` +
`last_contribution_receipt_amount`) with deduplication by `sub_id` is required.
A first pass at the Walton aggregate produced $85.76M — exactly double the truth.
Any family aggregate also depends on which name variants you accept; FEC name
strings are inconsistent and a different roster lands on a different number.

---

## What I could not source, and why

- **Amazon's true federal revenue.** Amazon does not break out public-sector or
  government revenue in its 10-K, and the reseller problem above defeats
  bottom-up estimation. Stated as a floor on the page, with the limitation named.
- **Blue Origin revenue.** Still private — an EDGAR search returns no CIK and no
  filings of any kind, not even a Form D. The revenue figures that circulate come
  from third-party aggregators with no traceable methodology, so the page uses
  USAspending contract obligations instead, which are primary and defensible.
  (SpaceX was in this category until its June 2026 IPO; see above.)
- **Walmart's SNAP revenue, in any year.** No filed figure has ever existed, and
  the _Argus Leader_ decision closes the government side too. The Numerator
  panel estimate (~25.5% of SNAP grocery dollars) is the best available and is
  labelled as modelled, not filed.
- **A defensible cumulative state/local subsidy total.** Good Jobs First is the
  only broad source, and it says plainly that its own totals are floors —
  disclosure is patchy and many abatements are never published at all.

---

## What needs manual acquisition

These are the things a session with only public web access cannot get:

1. **Good Jobs First Subsidy Tracker bulk data.** The site is queryable but the
   underlying dataset requires a request. Would replace several transcribed
   figures with an auditable file and a repeatable refresh.
2. **State-level abatement records.** Nevada's Gigafactory package, the Texas
   Starbase county abatements, and Amazon's data-center deals in Virginia, Ohio,
   Oregon, and Indiana are administered locally, and several are only obtainable
   by public-records request. This is where the largest unmeasured subsidies are.
3. **FPDS-NG contract detail beyond what the USAspending API exposes**, if
   per-award drill-downs are ever wanted on the page.
4. **A paid federal-contracting dataset** (GovWin, Bloomberg Government) if
   reseller pass-through attribution ever needs to be solved properly. This is
   the single largest accuracy gap on the revenue side.

---

## Recommended additions — and a cross-partisan problem

The page's own rule is that it profiles _whoever takes the most public money, of
any party_. It does not currently live up to that: all four profiles are marked
`right` or `mixed`, and none `left`. That is a credibility problem for a
cross-partisan project, and it is fixable, because the biggest omissions
genuinely span the spectrum. All figures below are USAspending prime obligations,
FY2008–FY2025, retrieved 2026-08-26.

| Candidate                         | Federal contract revenue                                               | Why it belongs                                                                                                                            |
| --------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Michael Dell** (Dell)           | **~$26.6B** (Dell Federal Systems $14.68B + Dell Marketing $11.89B)    | Larger than SpaceX. A founder-controlled fortune living substantially on federal purchasing, and currently absent. The clearest omission. |
| **Larry Ellison** (Oracle)        | **~$9.4B** (Oracle Health Government Services $7.94B + Oracle America) | Founder-controlled, very large federal health-IT revenue, and a major political donor.                                                    |
| **Michael Bloomberg** (Bloomberg) | ~$334M (Bloomberg Finance LP + Bloomberg Industry Group)               | Modest revenue, but an enormous political spender who **leans left** — the natural test of whether the page applies one rule to everyone. |

Two notes on candidates I checked and would _not_ add on revenue grounds:

- **Koch.** Koch Industries barely registers in federal contracting (Georgia-Pacific
  ~$51M; "Heckler & Koch" is an unrelated firearms company). The Koch story is
  subsidies and political spending, not contract revenue — profile it on those
  terms or not at all.
- **Microsoft ($5.7B)** and **Google ($28M)** are large or notable federal
  vendors but are not founder-controlled fortunes today, which is the selection
  criterion the page uses.

Adding Dell and Ellison would make the page more accurate about where public
money actually goes. Adding Bloomberg would make its cross-partisan claim true
rather than merely stated. I would do all three before adding anyone else.

---

## Reproducing this

```bash
npm run scorecard:ingest-usaspending -- --dry-run   # inspect, write nothing
npm run scorecard:ingest-usaspending                # refresh the JSON series
npm run scorecard:ingest-usaspending -- --entity=palantir --start-fy=2020
```

No API key and no database writes. Output:
`src/lib/scorecard/usaspending-federal-revenue.json`.
