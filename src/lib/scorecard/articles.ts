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
  sources: ArticleSource[];
}

// ---------------------------------------------------------------------------
// Article content
// ---------------------------------------------------------------------------

const AIPAC_SPENDING: Article = {
  slug: 'aipac-spending-in-primaries',
  title: 'Where AIPAC-Aligned Spending Concentrates in Primary Elections',
  dek: 'A neutral look at how a single-issue advocacy network has become one of the largest sources of outside money in U.S. congressional primaries — and why that matters for an honest-government scorecard.',
  plankSlug: 'honest-government',
  section: 'pac',
  publishedAt: '2026-06-15',
  body: `Most Americans first encounter the American Israel Public Affairs Committee (AIPAC) as a lobbying organization. Less visible is how its affiliated spending vehicles have, in recent cycles, become some of the largest sources of outside money in congressional **primary** elections — the low-turnout contests that often decide who represents a district far more than the general election does.

This article does not take a position on AIPAC's policy goals or on any candidate it has supported or opposed. The question here is narrower and civic: **where does this money concentrate, how is it disclosed, and what does that pattern tell us about the role of concentrated outside spending in primaries?** Those are the same questions our scorecard asks of every source of money, regardless of the cause behind it.

## Two vehicles, two rules

AIPAC's political spending in recent cycles has flowed through two main channels:

- A **conventional political action committee (PAC)** that bundles and routes contributions directly to candidates, subject to the per-candidate contribution limits that apply to all PACs.
- An affiliated **super PAC** — commonly reported under the United Democracy Project name — which may raise and spend unlimited sums on **independent expenditures** (advertising for or against candidates) so long as that spending is not formally coordinated with a campaign.

The second channel is the one that draws scrutiny. Independent-expenditure spending is uncapped, which means a single network can place sums into one primary that dwarf what the candidates themselves raise.

## The pattern: a few races, large sums

The defining feature of this spending is **concentration**, not breadth. Rather than spreading modest amounts across many districts, AIPAC-aligned independent expenditures have tended to land heavily in a small number of contested primaries — frequently open seats or races without an incumbent of the network's preferred profile. In those targeted primaries, outside spending has at times exceeded the combined spending of the candidates' own campaigns.

Concentration cuts across party framing. The targeted races have included contests between candidates of the same party, which is why describing this purely along a left-right axis misses the mechanism. The relevant civic fact is structural: **a low-turnout primary can be reshaped by a late surge of outside money from a single national network**, and the voters in that district may have little visibility into who is paying for the advertising they see.

## Why an honest-government scorecard tracks this

Plank 1 — Honest Government — asks whether a legislator's funding leaves them free to act on behalf of constituents rather than concentrated donors. Outside spending complicates that question in two ways:

1. **It is not a contribution to the legislator.** Independent expenditures do not show up as money the candidate accepted, so a member can post a clean direct-contribution profile while still being the beneficiary (or target) of large outside sums.
2. **It shapes incentives before a vote is ever cast.** A member who knows that crossing a well-funded network could trigger seven figures of primary advertising faces a pressure that no roll-call record captures.

For that reason, our methodology discloses outside independent-expenditure spending **for** and **against** each legislator alongside their direct-contribution profile, and treats corporate independent expenditures attacking a member as disclosed-but-not-scored. AIPAC-aligned spending is one well-documented example of why that disclosure matters; it is not singled out for special treatment. The same lens applies to every outside network, on every issue.

## What this article does *not* claim

- It does not claim AIPAC's spending is illegal. Independent expenditures are lawful and disclosed.
- It does not claim any specific candidate won or lost *because of* this spending; election outcomes have many causes.
- It does not assign the spending a partisan label. The targeted primaries have crossed the usual partisan lines.

The dollar figures cited in the public record vary by cycle and by the source compiling them. Readers should treat any single headline number as cycle-specific and check the primary disclosures linked below rather than relying on a remembered total. Where this article references magnitudes, it does so directionally ("several million dollars in a single primary") rather than asserting a precise, unverified figure as fact.

## The bottom line

A healthy primary is one where voters can see who is trying to influence their choice. Concentrated outside spending — from any network, for any cause — makes that harder, and uncapped independent expenditures make it harder still. AIPAC-aligned spending is a clear, well-documented case study in that dynamic, which is why it belongs in any honest accounting of money and the people's government.`,
  sources: [
    {
      label: 'Federal Election Commission — independent expenditure filings (search by committee)',
      url: 'https://www.fec.gov/data/independent-expenditures/',
    },
    {
      label: 'OpenSecrets — outside spending and super PAC summaries by cycle',
      url: 'https://www.opensecrets.org/outside-spending',
    },
    {
      label:
        'Representative citation: cycle-specific reporting on AIPAC-affiliated independent expenditures in contested congressional primaries (figures vary by source and cycle; verify against FEC primary filings before citing a specific dollar amount).',
      representative: true,
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
