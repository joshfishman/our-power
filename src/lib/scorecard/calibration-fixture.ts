// Federal scorecard calibration fixture.
//
// Expected total scores (out of 25) for 10 senators spanning the political
// spectrum, used as Phase 4 validation: when the scoring engine runs
// against real ProPublica/Congress.gov data, these totals should land
// within +/- 2 points of the calibrated estimates.
//
// Sourced from the methodology calibration exercise documented in the
// project brief. None of these are publication-ready scores — they are
// targets for the engine to approximate before any score is published.

export interface CalibrationEntry {
  bioguideId: string;
  fullName: string;
  expectedTotal: number; // Out of 25
  expectedTotalRangeMin: number;
  expectedTotalRangeMax: number;
}

export const FEDERAL_CALIBRATION_FIXTURE: CalibrationEntry[] = [
  {
    bioguideId: 'S000033',
    fullName: 'Bernie Sanders',
    expectedTotal: 23.5,
    expectedTotalRangeMin: 23,
    expectedTotalRangeMax: 24,
  },
  {
    bioguideId: 'W000817',
    fullName: 'Elizabeth Warren',
    expectedTotal: 22.5,
    expectedTotalRangeMin: 22,
    expectedTotalRangeMax: 23,
  },
  {
    bioguideId: 'K000384',
    fullName: 'Tim Kaine',
    expectedTotal: 17.5,
    expectedTotalRangeMin: 17,
    expectedTotalRangeMax: 18,
  },
  {
    bioguideId: 'S000148',
    fullName: 'Charles Schumer',
    expectedTotal: 15.5,
    expectedTotalRangeMin: 15,
    expectedTotalRangeMax: 16,
  },
  {
    bioguideId: 'K000377',
    fullName: 'Mark Kelly',
    expectedTotal: 14.5,
    expectedTotalRangeMin: 14,
    expectedTotalRangeMax: 15,
  },
  {
    bioguideId: 'H001089',
    fullName: 'Josh Hawley',
    expectedTotal: 14.5,
    expectedTotalRangeMin: 14,
    expectedTotalRangeMax: 15,
  },
  {
    bioguideId: 'M001153',
    fullName: 'Lisa Murkowski',
    expectedTotal: 13.5,
    expectedTotalRangeMin: 13,
    expectedTotalRangeMax: 14,
  },
  {
    bioguideId: 'P000603',
    fullName: 'Rand Paul',
    expectedTotal: 10.5,
    expectedTotalRangeMin: 10,
    expectedTotalRangeMax: 11,
  },
  {
    bioguideId: 'L000577',
    fullName: 'Mike Lee',
    expectedTotal: 10.5,
    expectedTotalRangeMin: 10,
    expectedTotalRangeMax: 11,
  },
  {
    bioguideId: 'M000355',
    fullName: 'Mitch McConnell',
    expectedTotal: 6.5,
    expectedTotalRangeMin: 6,
    expectedTotalRangeMax: 7,
  },
];
