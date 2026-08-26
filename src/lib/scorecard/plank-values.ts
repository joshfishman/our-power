/**
 * What each plank stands for, as a short list of commitments.
 *
 * These are the VALUES — the plain-language promises a plank makes to the
 * public. They are deliberately NOT the markers: a marker is a measurable
 * legislative act ("Cosponsored DISCLOSE Act") used to score a legislator,
 * whereas a value is the thing that act is in service of ("Full disclosure of
 * dark money"). The issues index shows values so a reader can see what a
 * commitment MEANS before seeing how it is scored.
 *
 * The wording is taken from each plank's `body` — the full plank text from the
 * project brief, which is seeded onto `Plank.body` — restructured from prose
 * into a scannable list. Keep the two in step: if a plank's brief text changes,
 * change the list here too.
 *
 * Keyed by plank slug, which federal and CA planks share (CA has planks 1–4;
 * plank 5 is federal only), so one map serves both jurisdictions.
 */
export const PLANK_VALUES: Record<string, readonly string[]> = {
  'honest-government': [
    'Public servants work for the public, not for private clients.',
    'No trading stocks on inside information.',
    'No corporate PAC money.',
    'No walking into a lobbying job the day you leave office — real cooling-off periods.',
    'Public financing of elections, so candidates answer to voters, not donors.',
    'Full disclosure of dark money.',
  ],
  'our-children-our-future': [
    'Strong public schools — every child deserves a good one in their neighborhood.',
    'Parental transparency and voice within public schools, without draining public dollars to vouchers or charters.',
    'Early childhood education.',
    'Federal science and technology research.',
    'Clean energy independence — solar, wind, nuclear, geothermal, batteries, the grid.',
    'Roads, bridges, broadband, water.',
    'Environmental stewardship.',
  ],
  'making-a-living': [
    'A federal minimum wage that means something.',
    'Stop wage theft and retaliation against workers who organize.',
    'End non-competes that trap workers in low-wage jobs.',
    'Cap predatory loan rates.',
    'Build housing.',
    'Paid family leave for working families.',
  ],
  'the-care-we-owe': [
    'Honor the promises this country made — to veterans, to elders, to working families who paid in.',
    'Veterans get the care they earned.',
    'Drug prices come down.',
    'Medicare and Medicaid stay strong.',
    'Social Security stays solvent and pays what people earned.',
    'Childcare and paid leave, so families can work and raise children at the same time.',
  ],
  'peace-and-strength': [
    'Strength means using power wisely.',
    'End the forever wars — Congress, not the executive alone, decides when American troops go into combat.',
    'Audit the Pentagon, every dollar accounted for.',
    'Break up monopolies that have grown too powerful — Big Tech, pharma, agriculture, defense.',
    'Real diplomacy, at parity with force projection.',
    'Trade deals that protect American workers and the environment.',
  ],
};

/** The commitments a plank makes, or an empty list if the slug is unknown. */
export function getPlankValues(slug: string): readonly string[] {
  return PLANK_VALUES[slug] ?? [];
}
