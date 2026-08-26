// Static article system for the Common Ground scorecard.
//
// Articles are plain TypeScript content modules — NOT a database model — so
// they ship with the build and never touch the production schema. Each article
// attaches to either a plank (by slug) or a named section (e.g. the PAC page).
//
// Bodies are authored in Markdown and rendered with react-markdown + remark-gfm
// (already used by the methodology page). Keep the voice civic and even-handed:
// factual, sourced, accountability-oriented — never partisan advocacy.

export type ArticleSection = 'pac';

export interface ArticleSource {
  /** Short label shown in the sources list, e.g. "OpenSecrets, Outside Spending". */
  label: string;
  /** Optional public URL. */
  url?: string;
  /**
   * Set true for representative/illustrative citations whose exact figures the
   * author could not independently verify. Rendered with a visible
   * "representative citation" marker so readers never mistake them for
   * confirmed primary-source numbers.
   */
  representative?: boolean;
}

/** A bar or pie chart rendered above the article body (the thesis visual). */
export interface ArticleChart {
  title: string;
  /** 'bar' (default) renders horizontal bars; 'pie' renders a donut with a center highlight + % legend. */
  kind?: 'bar' | 'pie';
  /**
   * Segments, in display order. valueLabel is the human figure ("$20.0M");
   * value drives the bar width / pie slice. color overrides the tone-derived
   * fill (used by the pie to give same-tone slices distinct shades).
   */
  bars: Array<{ label: string; value: number; valueLabel: string; tone?: 'brick' | 'navy' | 'muted'; color?: string }>;
  /** Big number shown in the donut center (pie only), e.g. "~91%". */
  highlight?: { value: string; label: string };
  caption?: string;
  /** Optional explanatory note rendered under the chart (e.g. "UDP is AIPAC's super PAC"). */
  note?: string;
}

/** One side of a primary case — the targeted member or the backed winner. */
export interface ArticleCaseSide {
  name: string;
  /** Public headshot URL (bioguide.congress.gov or Wikimedia Commons). */
  photo?: string;
  /** One-sentence who-they-are summary. */
  summary: string;
  /** Bullet points: spending against them and/or their voting record. */
  bullets: string[];
}

/** A targeted-primary case study: who was targeted, who won, the money, and the records. */
export interface ArticleCase {
  /** e.g. "NY-16 · 2024 Democratic primary". */
  race: string;
  /** Outside money + source, e.g. "~$19M+ (pro-Israel total)". */
  spend: string;
  /** The targeted candidate (defeated). */
  targeted: ArticleCaseSide;
  /** The backed winner. */
  winner: ArticleCaseSide;
  sourceUrl?: string;
}

export interface Article {
  /** URL slug, unique across all articles. */
  slug: string;
  title: string;
  /** One-line standfirst / summary shown in lists and at the top of the page. */
  dek: string;
  /**
   * Plank this article attaches to (slug from federal-planks.ts / ca-planks.ts),
   * if any. Shown on the matching /scorecard/issues/[slug] page.
   */
  plankSlug?: string;
  /**
   * Non-plank section this article attaches to (e.g. the PAC ranking page),
   * if any. An article may set plankSlug, section, both, or neither.
   */
  section?: ArticleSection;
  /** Publication date, ISO yyyy-mm-dd. */
  publishedAt: string;
  /** Markdown body. */
  body: string;
  /** Optional thesis chart, rendered above the body. */
  chart?: ArticleChart;
  /** Optional case studies, rendered after the body. */
  cases?: ArticleCase[];
  sources: ArticleSource[];
}

// ---------------------------------------------------------------------------
// Article content
// ---------------------------------------------------------------------------

const AIPAC_SPENDING: Article = {
  slug: 'aipac-spending-in-primaries',
  title: 'AIPAC Spends by Party — Almost Entirely in Democratic Primaries',
  dek: "Look at where AIPAC's super-PAC money lands and one fact jumps out: it is a Democratic-primary operation. Here is the chart — and what the money actually buys.",
  plankSlug: 'honest-government',
  section: 'pac',
  publishedAt: '2026-06-24',
  chart: {
    kind: 'pie',
    title: 'AIPAC’s super-PAC spending — 2024 primaries, by party',
    highlight: { value: '~91%', label: 'spent inside Democratic primaries' },
    bars: [
      // Series colors reference the semantic token layer so charts follow light/dark.
      { label: 'Against Democrats', value: 20.0, valueLabel: '$20.0M', color: 'rgb(var(--score-1))' },
      { label: 'Boosting Dem challengers', value: 12.4, valueLabel: '$12.4M', color: 'rgb(var(--score-2))' },
      { label: 'Against Republicans', value: 3.0, valueLabel: '$3.0M', color: 'rgb(var(--score-4))' },
      { label: 'Boosting Republicans', value: 0, valueLabel: '$0', color: 'rgb(var(--subtle-foreground))' },
    ],
  },
  body: `## AIPAC’s super PAC, the United Democracy Project (UDP)

UDP is the single largest pro-Israel super-PAC vehicle (FactCheck.org / FEC, Sept. 2024 snapshot of ~$35.6M in itemized independent expenditures; $37.9M final). About $32.4M — roughly 91% — landed inside Democratic primaries; only ~$3M went against Republicans, and nothing supported them. Democratic Majority for Israel and other pro-Israel groups spend the same way on a smaller scale.

“UDP” is the United Democracy Project — AIPAC’s own super PAC, created and funded by AIPAC’s donor network to make the uncapped “independent expenditure” ads a candidate-contribution PAC legally can’t. When you see UDP money, you are seeing AIPAC money. (AIPAC’s separate, capped PAC does give to both parties — but the uncapped attack money shown here is the part aimed at primaries.)

## The Wrap on AIPAC in our politics

**AIPAC and allied pro-Israel groups are among the largest outside spenders in American elections — and they aim that money almost entirely at Democratic *primaries*.** The point is not to beat Republicans. It is to decide which Democrats survive their own party's primary, in the low-turnout contests that usually settle who represents a safe-blue district.

## The money, by the numbers

In the 2023–24 cycle, AIPAC's two vehicles spent on the order of **$127 million** combined (FEC):

- The **AIPAC PAC** (~$55.2M) bundles capped contributions directly to candidates — and it does give to both parties.
- The **AIPAC Super PAC (UDP)** — formally the United Democracy Project, AIPAC's own super PAC — made **~$37.9M in uncapped independent expenditures** (~$61M total disbursed): the attack ads. *That* money concentrates in Democratic primaries, and it is where the chart above comes from.

They are not alone. **Democratic Majority for Israel** (DMFI PAC, ~$4.8M in 2024) runs the same play on a smaller scale. And on a different issue entirely, the crypto industry's **Fairshake** network deployed ~$133M in 2024 — including ~$10M to sink Katie Porter in California's Senate primary — proving the mechanism isn't unique to one cause: **a single national network can now decide a low-turnout primary with a late surge of uncapped money.**

## Why primaries, and why Democrats

A general election in a safe district is rarely in doubt. The **primary** is where the real choice happens — and primaries draw a fraction of the turnout, which means a few million dollars of late advertising goes much further. Because the targeted members (critics of U.S. military aid to Israel) are Democrats in Democratic districts, the money goes where it can change the outcome: the Democratic primary. That is the structural reason the chart looks the way it does — not a partisan accident.

## What the money actually buys

Here is the part our scorecard is built to show. Look at the two races below. In each, a single network spent millions to replace one Democrat with another — and on the **domestic** bills this scorecard tracks (Medicaid, wages, housing), the winner votes much like the member they replaced. **The money did not flip a seat between parties or change how the district votes on bread-and-butter issues. It swapped one Democrat for another over a single issue.** That is precisely why a single-issue network finds primaries worth the spend — and precisely the kind of concentrated, pre-vote pressure that Our Power exists to make visible.

## Is there a legitimate reason for AIPAC Spending?

AIPAC and its supporters say independent expenditures are lawful, fully disclosed, and no different in kind from any other advocacy group exercising its First Amendment rights; that it backs candidates of both parties; and that its primary spending reflects genuine grassroots support for the U.S.–Israel relationship, not a hostile takeover. All true as far as it goes. The civic question this scorecard asks is narrower and applies to every network on every issue: **when uncapped money from one source can decide a low-turnout primary, can the voters in that district even see who is choosing their representative?**`,
  cases: [
    {
      race: 'NY-16 · 2024 Democratic primary',
      spend: '~$19M+ (pro-Israel total)',
      targeted: {
        name: 'Rep. Jamaal Bowman',
        photo: 'https://bioguide.congress.gov/photo/B001223.jpg',
        summary:
          "Two-term NY-16 progressive (the Squad) and one of the House's sharpest critics of U.S. military aid to Israel; an early Gaza-ceasefire backer.",
        bullets: [
          "Targeted by AIPAC's super PAC (UDP): ~$14.5M — roughly $9.9M in attack ads plus ~$4.8M to boost Latimer; AIPAC's PAC added ~$2.5M in direct giving.",
          'The most expensive U.S. House primary in history (~$24.8M total ad spend).',
          'Lost the June 2024 primary to George Latimer.',
        ],
      },
      winner: {
        name: 'Rep. George Latimer',
        photo: 'https://bioguide.congress.gov/photo/L000606.jpg',
        summary:
          'Former Westchester County Executive; now NY-16’s member in the 119th Congress. Scorecard PAC Score 61.',
        bullets: [
          "On the domestic bills we track he votes with his caucus: NO on the H.R.1 reconciliation's Medicaid cuts; YES on the workforce-bargaining and housing bills.",
          "What the money changed was the seat's posture on Israel — not its bread-and-butter voting record.",
        ],
      },
      sourceUrl: 'https://adimpact.com/blogs/blog/ny-cd-16-primary-2024',
    },
    {
      race: 'MO-01 · 2024 Democratic primary',
      spend: '~$11M+ (pro-Israel total)',
      targeted: {
        name: 'Rep. Cori Bush',
        photo: 'https://bioguide.congress.gov/photo/B001224.jpg',
        summary:
          'Two-term MO-01 progressive (the Squad); led the first post-Oct-7 congressional ceasefire resolution and voted against the Israel military-aid package.',
        bullets: [
          "Targeted by AIPAC's super PAC (UDP): ~$8.5M — over $5.2M in attack ads plus ~$3.3M to boost Bell; AIPAC's PAC added ~$2.4M direct (making Bell its #2 all-time recipient); DMFI spent more on top.",
          'The second-most-expensive House primary in history.',
          'Lost the August 2024 primary to Wesley Bell.',
        ],
      },
      winner: {
        name: 'Rep. Wesley Bell',
        photo: 'https://bioguide.congress.gov/photo/B001324.jpg',
        summary:
          'St. Louis County Prosecuting Attorney; now MO-01’s member in the 119th Congress. Scorecard PAC Score 31.',
        bullets: [
          'Same pattern as NY-16: NO on the H.R.1 Medicaid cuts; YES on the workforce and housing bills.',
          "A different stance on the lobby's issue; a familiar Democratic record on everything else.",
        ],
      },
      sourceUrl:
        'https://www.opensecrets.org/news/2024/11/the-crypto-trio-how-the-cryptocurrency-industry-has-made-its-mark-on-2024-elections/',
    },
    {
      race: 'OH-11 · 2021 Democratic primary',
      spend: '~$2M (DMFI / pro-Israel)',
      targeted: {
        name: 'Nina Turner',
        photo:
          'https://upload.wikimedia.org/wikipedia/commons/thumb/9/94/Nina_Turner_crop_light_and_color_corrected.jpg/500px-Nina_Turner_crop_light_and_color_corrected.jpg',
        summary:
          'Former Ohio state senator and Bernie Sanders campaign co-chair; backed Israel aid but wanted it conditioned on human rights and would not condemn BDS.',
        bullets: [
          'Targeted by Democratic Majority for Israel: ~$941K in the 2021 special alone ($738K in attack ads + $203K to boost Brown), ~$2M across the cycle.',
          'Lost the August 2021 special primary to Shontel Brown (and a 2022 rematch).',
        ],
      },
      winner: {
        name: 'Shontel Brown',
        photo: 'https://bioguide.congress.gov/photo/B001313.jpg',
        summary: 'Cuyahoga County Democratic Party chair; now OH-11’s member in the 119th Congress.',
        bullets: [
          'July 2025: voted with the 422–6 majority to keep $500M in U.S.–Israel missile-defense funding (against an amendment to cut it).',
          'Has urged dropping conditions on Israel aid — the posture the spending was meant to secure.',
        ],
      },
      sourceUrl:
        'https://truthout.org/articles/pro-israel-pac-has-spent-nearly-1-million-to-try-to-sink-nina-turners-campaign/',
    },
    {
      race: 'MD-04 · 2022 Democratic primary',
      spend: '~$6M (pro-Israel total)',
      targeted: {
        name: 'Donna Edwards',
        photo: 'https://bioguide.congress.gov/photo/E000290.jpg',
        summary:
          'Former MD-04 congresswoman (2008–2017) and progressive critic of unconditional Israel aid, running to reclaim her old seat.',
        bullets: [
          "Targeted by AIPAC's super PAC (UDP): roughly $5.5–6M against her / for Ivey, with DMFI adding ~$400K.",
          'The ads attacked her as “ineffective” and never mentioned Israel.',
          'Lost the July 2022 primary to Glenn Ivey.',
        ],
      },
      winner: {
        name: 'Glenn Ivey',
        photo: 'https://bioguide.congress.gov/photo/I000058.jpg',
        summary: 'Former Prince George’s County State’s Attorney; now MD-04’s member in the 119th Congress.',
        bullets: [
          'Consistently votes for Israel military aid and opposes conditioning it — the position the campaign was waged to install.',
          'A different stance on the lobby’s issue; the seat itself stayed Democratic.',
        ],
      },
      sourceUrl: 'https://theintercept.com/2022/07/20/aipac-maryland-donna-edwards-glenn-ivey-democrat/',
    },
  ],
  sources: [
    {
      label: 'FEC — United Democracy Project (C00799031), independent expenditures, 2024 cycle',
      url: 'https://www.fec.gov/data/committee/C00799031/',
    },
    {
      label: 'FEC — DMFI PAC (C00710848), 2024 cycle totals',
      url: 'https://www.fec.gov/data/committee/C00710848/?cycle=2024',
    },
    {
      label: 'FactCheck.org — United Democracy Project IE itemized by party (oppose/support, by race)',
      url: 'https://www.factcheck.org/2024/09/united-democracy-project-2/',
    },
    {
      label: 'AdImpact — NY-16 the most expensive House primary in history (UDP ~60% of spend)',
      url: 'https://adimpact.com/blogs/blog/ny-cd-16-primary-2024',
    },
    {
      label: 'Truthout — AIPAC/UDP poured a record $14.5M into defeating Bowman',
      url: 'https://truthout.org/articles/jamaal-bowman-loses-primary-after-aipac-poured-record-14-5m-into-race/',
    },
    {
      label: 'OpenSecrets — pro-Israel and crypto outside spending, 2024',
      url: 'https://www.opensecrets.org/news/2024/11/the-crypto-trio-how-the-cryptocurrency-industry-has-made-its-mark-on-2024-elections/',
    },
    {
      label: 'FactCheck.org — Fairshake (~$10M against Katie Porter)',
      url: 'https://www.factcheck.org/2024/04/fairshake/',
    },
    {
      label: 'Public Citizen — crypto corporations’ 2024 election spending',
      url: 'https://www.citizen.org/article/big-crypto-big-spending-2024/',
    },
  ],
};

// ---------------------------------------------------------------------------
// Registry + lookups
// ---------------------------------------------------------------------------

export const ARTICLES: Article[] = [AIPAC_SPENDING];

export function getAllArticles(): Article[] {
  return [...ARTICLES].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

export function getArticleBySlug(slug: string): Article | undefined {
  return ARTICLES.find((a) => a.slug === slug);
}

/** Articles attached to a given plank slug, newest first. */
export function getArticlesForPlank(plankSlug: string): Article[] {
  return getAllArticles().filter((a) => a.plankSlug === plankSlug);
}

/** Articles attached to a named section (e.g. the PAC page), newest first. */
export function getArticlesForSection(section: ArticleSection): Article[] {
  return getAllArticles().filter((a) => a.section === section);
}
