import { describe, expect, it } from 'vitest';
import { FEDERAL_PLANKS } from '@/lib/scorecard/federal-planks';
import { CA_PLANKS } from '@/lib/scorecard/ca-planks';
import type { SeedPlank } from '@/lib/scorecard/types';

function allPlanks(): SeedPlank[] {
  return [...FEDERAL_PLANKS, ...CA_PLANKS];
}

describe('scorecard seed: structural invariants', () => {
  it('federal scorecard has exactly 5 planks numbered 1-5', () => {
    expect(FEDERAL_PLANKS).toHaveLength(5);
    const numbers = FEDERAL_PLANKS.map((p) => p.number).sort();
    expect(numbers).toEqual([1, 2, 3, 4, 5]);
  });

  it('CA scorecard has exactly 4 planks numbered 1-4 (Plank 5 dropped per Option A)', () => {
    expect(CA_PLANKS).toHaveLength(4);
    const numbers = CA_PLANKS.map((p) => p.number).sort();
    expect(numbers).toEqual([1, 2, 3, 4]);
    // Sanity: federal Plank 5 slug should not appear in CA planks.
    const caSlugs = new Set(CA_PLANKS.map((p) => p.slug));
    expect(caSlugs.has('peace-and-strength')).toBe(false);
  });

  it('every plank has exactly one PRIMARY marker', () => {
    for (const plank of allPlanks()) {
      const primaries = plank.markers.filter((m) => m.markerType === 'PRIMARY');
      expect(primaries, `${plank.jurisdiction}/${plank.slug}`).toHaveLength(1);
    }
  });

  it('every plank has at least 3 secondary markers', () => {
    for (const plank of allPlanks()) {
      const secondaries = plank.markers.filter((m) => m.markerType === 'SECONDARY');
      expect(
        secondaries.length,
        `${plank.jurisdiction}/${plank.slug} has only ${secondaries.length} secondaries; need at least 3`,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it('plank slugs are unique within jurisdiction', () => {
    for (const set of [FEDERAL_PLANKS, CA_PLANKS]) {
      const slugs = set.map((p) => p.slug);
      expect(new Set(slugs).size).toBe(slugs.length);
    }
  });

  it('marker slugs are unique within their plank', () => {
    for (const plank of allPlanks()) {
      const slugs = plank.markers.map((m) => m.slug);
      expect(new Set(slugs).size, `${plank.slug} has duplicate marker slugs`).toBe(slugs.length);
    }
  });
});

describe('scorecard seed: Option C two-tier markers', () => {
  it('no PRIMARY marker is flagged as a Republican alternative', () => {
    for (const plank of allPlanks()) {
      for (const marker of plank.markers) {
        if (marker.markerType === 'PRIMARY') {
          expect(
            marker.isRepublicanAlternative ?? false,
            `${plank.slug}/${marker.slug} cannot be both PRIMARY and a Republican alternative`,
          ).toBe(false);
        }
      }
    }
  });

  it('every Republican alternative declares parallelMarkerSlug', () => {
    for (const plank of allPlanks()) {
      for (const marker of plank.markers) {
        if (marker.isRepublicanAlternative) {
          expect(
            marker.parallelMarkerSlug,
            `${plank.slug}/${marker.slug} must declare parallelMarkerSlug`,
          ).toBeTruthy();
        }
      }
    }
  });

  it('every parallelMarkerSlug points to a real marker on the same plank', () => {
    for (const plank of allPlanks()) {
      const slugSet = new Set(plank.markers.map((m) => m.slug));
      for (const marker of plank.markers) {
        if (marker.parallelMarkerSlug) {
          expect(
            slugSet.has(marker.parallelMarkerSlug),
            `${plank.slug}/${marker.slug} references missing parallel slug ${marker.parallelMarkerSlug}`,
          ).toBe(true);
        }
      }
    }
  });

  it('federal Plank 3 includes the Republican alternative TEAM Act marker (Option C)', () => {
    const plank3 = FEDERAL_PLANKS.find((p) => p.number === 3);
    expect(plank3).toBeDefined();
    const teamAlt = plank3!.markers.find((m) => m.slug === 'team-act-gop-alt');
    expect(teamAlt).toBeDefined();
    expect(teamAlt!.isRepublicanAlternative).toBe(true);
    expect(teamAlt!.parallelMarkerSlug).toBe('minimum-wage-increase');
  });

  it('federal Plank 4 includes the Republican alternative New Parents Act marker (Option C)', () => {
    const plank4 = FEDERAL_PLANKS.find((p) => p.number === 4);
    expect(plank4).toBeDefined();
    const newParentsAlt = plank4!.markers.find((m) => m.slug === 'new-parents-act-gop-alt');
    expect(newParentsAlt).toBeDefined();
    expect(newParentsAlt!.isRepublicanAlternative).toBe(true);
    expect(newParentsAlt!.parallelMarkerSlug).toBe('paid-leave-childcare');
  });
});

describe('scorecard seed: jurisdiction consistency', () => {
  it('federal planks all declare jurisdiction=FEDERAL', () => {
    for (const plank of FEDERAL_PLANKS) {
      expect(plank.jurisdiction).toBe('FEDERAL');
    }
  });

  it('CA planks all declare jurisdiction=CA', () => {
    for (const plank of CA_PLANKS) {
      expect(plank.jurisdiction).toBe('CA');
    }
  });
});
