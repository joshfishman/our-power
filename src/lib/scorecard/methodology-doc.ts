/**
 * What the public methodology page shows, and what it holds back.
 *
 * `docs/scorecard-methodology.md` is the working source of truth and carries a
 * long version history — every recompute, every curation reversal, every
 * superseded rubric. That record is essential for the people building this and
 * actively misleading for a reader arriving cold: it reads as churn, and it
 * advertises versions we no longer score against. The methodology is not
 * settled enough to publish its own archaeology, so only what is CURRENTLY true
 * gets rendered.
 */

/** `## ` sections withheld from the public page, matched by case-insensitive prefix. */
export const UNPUBLISHED_SECTIONS = ['Methodology versions'];

/**
 * Drops unpublished `## ` sections, keeping everything up to the next heading
 * of the same or higher level. Level-3 subsections nested inside a dropped
 * section go with it.
 */
export function stripUnpublishedSections(markdown: string): string {
  const kept: string[] = [];
  let skipping = false;
  for (const line of markdown.split('\n')) {
    const h2 = /^##\s+(.*)$/.exec(line);
    if (h2) {
      const heading = h2[1].trim().toLowerCase();
      skipping = UNPUBLISHED_SECTIONS.some((section) => heading.startsWith(section.toLowerCase()));
    } else if (/^#\s+/.test(line)) {
      // A level-1 heading always closes a skipped level-2 section.
      skipping = false;
    }
    if (!skipping) kept.push(line);
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n');
}
