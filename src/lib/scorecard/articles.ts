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

/** A targeted-primary case study: who was targeted, how they stood, who won, how the winner voted. */
export interface ArticleCase {
  /** e.g. "NY-16 · 2024 Democratic primary". */
  race: string;
  /** Outside money + source, e.g. "~$14.5M (AIPAC / United Democracy Project)". */
  spend: string;
  /** The targeted candidate and their stance ("how they wanted to vote"). */
  targeted: string;
  targetedStance: string;
  /** The backed winner and how they have voted since (or "newly seated"). */
  winner: string;
  winnerRecord: string;
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
    title: 'Where the AIPAC Super PAC (UDP) spent its money — 2024, by party',
    highlight: { value: '~91%', label: 'spent inside Democratic primaries' },
    bars: [
      { label: 'Against Democrats', value: 20.0, valueLabel: '$20.0M', color: '#8B3A3A' },
      { label: 'Boosting Dem challengers', value: 12.4, valueLabel: '$12.4M', color: '#B5685A' },
      { label: 'Against Republicans', value: 3.0, valueLabel: '$3.0M', color: '#C8B98A' },
      { label: 'Boosting Republicans', value: 0, valueLabel: '$0', color: '#6B7C87' },
    ],
    caption:
      'FactCheck.org / FEC, Sept. 2024 snapshot of ~$35.6M in itemized independent expenditures; final spend for the cycle was $37.9M. About $32.4M — roughly 91% — landed inside Democratic primaries; only ~$3M went against Republicans, and nothing supported them.',
    note: '“UDP” is the United Democracy Project — AIPAC’s own super PAC, created and funded by AIPAC’s donor network to make the uncapped “independent expenditure” ads a candidate-contribution PAC legally can’t. When you see UDP money, you are seeing AIPAC money.',
  },
  body: `So what is up with that chart?

The short answer: **AIPAC and allied pro-Israel groups are among the largest outside spenders in American elections — and they aim that money almost entirely at Democratic *primaries*.** The point is not to beat Republicans. It is to decide which Democrats survive their own party's primary, in the low-turnout contests that usually settle who represents a safe-blue district.

## The money, by the numbers

In the 2023–24 cycle, AIPAC's two vehicles spent on the order of **$127 million** combined (FEC):

- The **AIPAC PAC** (~$55.2M) bundles capped contributions directly to candidates — and it does give to both parties.
- The **AIPAC Super PAC (UDP)** — formally the United Democracy Project, AIPAC's own super PAC — made **~$37.9M in uncapped independent expenditures** (~$61M total disbursed): the attack ads. *That* money concentrates in Democratic primaries, and it is where the chart above comes from.

They are not alone. **Democratic Majority for Israel** (DMFI PAC, ~$4.8M in 2024) runs the same play on a smaller scale. And on a different issue entirely, the crypto industry's **Fairshake** network deployed ~$133M in 2024 — including ~$10M to sink Katie Porter in California's Senate primary — proving the mechanism isn't unique to one cause: **a single national network can now decide a low-turnout primary with a late surge of uncapped money.**

## Why primaries, and why Democrats

A general election in a safe district is rarely in doubt. The **primary** is where the real choice happens — and primaries draw a fraction of the turnout, which means a few million dollars of late advertising goes much further. Because the targeted members (critics of U.S. military aid to Israel) are Democrats in Democratic districts, the money goes where it can change the outcome: the Democratic primary. That is the structural reason the chart looks the way it does — not a partisan accident.

## What the money actually buys

Here is the part our scorecard is built to show. Look at the two races below. In each, a single network spent millions to replace one Democrat with another — and on the **domestic** bills this scorecard tracks (Medicaid, wages, housing), the winner votes much like the member they replaced. **The money did not flip a seat between parties or change how the district votes on bread-and-butter issues. It swapped one Democrat for another over a single issue.** That is precisely why a single-issue network finds primaries worth the spend — and precisely the kind of concentrated, pre-vote pressure that Plank 1 (Honest Government) exists to make visible.

## The counterpoint

AIPAC and its supporters say independent expenditures are lawful, fully disclosed, and no different in kind from any other advocacy group exercising its First Amendment rights; that it backs candidates of both parties; and that its primary spending reflects genuine grassroots support for the U.S.–Israel relationship, not a hostile takeover. All true as far as it goes. The civic question this scorecard asks is narrower and applies to **every** network on **every** issue: when uncapped money from one national source can decide a low-turnout primary, can the voters in that district even see who is choosing their representative?`,
  cases: [
    {
      race: 'NY-16 · 2024 Democratic primary',
      spend: '~$19M+ (pro-Israel total)',
      targeted: 'Rep. Jamaal Bowman',
      targetedStance:
        "Squad member and sharp critic of U.S. military aid to Israel; early ceasefire advocate. AIPAC's super PAC (UDP) alone spent ~$14.5M — ~$9.9M to defeat him plus ~$4.8M to boost Latimer — the most any group has ever put into a U.S. House primary; AIPAC's PAC added ~$2.5M in direct contributions, and total ad spending in NY-16 reached ~$24.8M, the most expensive House primary in history.",
      winner: 'Rep. George Latimer',
      winnerRecord:
        "Now in the 119th Congress. Scorecard PAC Score 61. On the domestic bills we track he votes with his caucus — NO on the H.R.1 reconciliation's Medicaid cuts, YES on the workforce-bargaining and housing bills. What the money changed was the seat's posture on Israel, the issue it was spent over — not the district's domestic voting record.",
      sourceUrl: 'https://adimpact.com/blogs/blog/ny-cd-16-primary-2024',
    },
    {
      race: 'MO-01 · 2024 Democratic primary',
      spend: '~$11M+ (pro-Israel total)',
      targeted: 'Rep. Cori Bush',
      targetedStance:
        "Ceasefire advocate and critic of U.S. military aid to Israel. AIPAC's super PAC (UDP) spent ~$8.5M — over $5.2M to defeat her plus ~$3.3M to boost Wesley Bell — the second-most-expensive House primary in history; AIPAC's PAC added ~$2.4M in direct giving (making Bell its #2 all-time recipient) and DMFI spent more on top.",
      winner: 'Rep. Wesley Bell',
      winnerRecord:
        "Now in the 119th Congress. Scorecard PAC Score 31. Same pattern as NY-16 — NO on the H.R.1 Medicaid cuts, YES on the workforce and housing bills. A different stance on the lobby's issue; a familiar Democratic record on everything else.",
      sourceUrl:
        'https://www.opensecrets.org/news/2024/11/the-crypto-trio-how-the-cryptocurrency-industry-has-made-its-mark-on-2024-elections/',
    },
    {
      race: 'OH-11 · 2021 Democratic primary',
      spend: '~$2M (DMFI / pro-Israel)',
      targeted: 'Nina Turner',
      targetedStance:
        "Progressive who backed Israel aid but wanted it conditioned on human rights and would not condemn BDS — the reason Democratic Majority for Israel gave for opposing her. DMFI's PAC spent ~$941K in the 2021 special alone ($738K against Turner + $203K to boost Brown), ~$2M across the cycle.",
      winner: 'Shontel Brown',
      winnerRecord:
        'Now in the 119th Congress. In July 2025 she voted with the 422–6 majority to keep $500M in U.S.–Israel missile-defense funding (against an amendment to cut it) and has urged dropping conditions on Israel aid — the posture the spending was meant to secure.',
      sourceUrl:
        'https://truthout.org/articles/pro-israel-pac-has-spent-nearly-1-million-to-try-to-sink-nina-turners-campaign/',
    },
    {
      race: 'MD-04 · 2022 Democratic primary',
      spend: '~$6M (pro-Israel total)',
      targeted: 'Donna Edwards',
      targetedStance:
        'Former congresswoman and progressive critic of unconditional Israel aid, running to reclaim her old seat. AIPAC’s super PAC (UDP) spent roughly $5.5–6M against her / for Ivey, with DMFI adding ~$400K — and the ads attacked her as “ineffective” without ever mentioning Israel.',
      winner: 'Glenn Ivey',
      winnerRecord:
        'Now in the 119th Congress. Consistently votes for Israel military aid and opposes conditioning it — the position the campaign was waged to install. A different stance on the lobby’s issue; the seat itself stayed Democratic.',
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
