import { describe, expect, it } from 'vitest';
import { CRUD_COVERAGE, USER_ACTIONS } from '@/lib/agent-native/capabilities';
import { getActionParityScore, getCrudCompletenessScore, getScorecardSnapshot } from '@/lib/agent-native/scorecard';

describe('agent-native scorecard', () => {
  it('computes action parity score from tracked user actions', () => {
    const parity = getActionParityScore();

    expect(parity.total).toBe(USER_ACTIONS.length);
    expect(parity.covered).toBeGreaterThan(0);
    expect(parity.covered).toBeLessThanOrEqual(parity.total);
    expect(parity.percentage).toBeGreaterThanOrEqual(0);
    expect(parity.percentage).toBeLessThanOrEqual(100);
  });

  it('computes CRUD completeness score from entity matrix', () => {
    const crud = getCrudCompletenessScore();

    expect(crud.total).toBe(CRUD_COVERAGE.length);
    expect(crud.covered).toBeGreaterThan(0);
    expect(crud.covered).toBeLessThanOrEqual(crud.total);
  });

  it('returns a scorecard snapshot with unsupported actions and incomplete entities', () => {
    const snapshot = getScorecardSnapshot();

    expect(snapshot.unsupportedActions.length).toBeGreaterThan(0);
    expect(snapshot.unsupportedActions.some((action) => action.id === 'auth.signIn')).toBe(true);
    expect(snapshot.incompleteEntities.some((entity) => entity.entity === 'Cause')).toBe(true);
  });

  // Non-regression baseline — update when scores legitimately improve
  it('parity score does not regress below baseline', () => {
    const parity = getActionParityScore();
    expect(parity.covered).toBeGreaterThanOrEqual(35);
    expect(parity.percentage).toBeGreaterThanOrEqual(83);
  });

  it('CRUD completeness does not regress below baseline', () => {
    const crud = getCrudCompletenessScore();
    expect(crud.covered).toBeGreaterThanOrEqual(6);
    expect(crud.percentage).toBeGreaterThanOrEqual(67);
  });
});
