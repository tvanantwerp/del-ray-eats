import { describe, expect, test } from 'vitest';

import { haversineMeters, isWithinCorridor, projectToSegment } from './geo';

const BRADDOCK = { lat: 38.8204, lng: -77.061 };
const COMMONWEALTH = { lat: 38.8348, lng: -77.0672 };

describe('haversineMeters', () => {
  test('zero distance for identical points', () => {
    expect(haversineMeters(BRADDOCK, BRADDOCK)).toBeCloseTo(0, 5);
  });

  test('matches known distance between the two endpoints (~1.65 km)', () => {
    const d = haversineMeters(BRADDOCK, COMMONWEALTH);
    expect(d).toBeGreaterThan(1500);
    expect(d).toBeLessThan(1800);
  });
});

describe('projectToSegment', () => {
  test('a point on the segment start has ~0 perpendicular and ~0 along distance', () => {
    const r = projectToSegment(BRADDOCK, BRADDOCK, COMMONWEALTH);
    expect(r.perpMeters).toBeCloseTo(0, 1);
    expect(r.alongMeters).toBeCloseTo(0, 1);
  });

  test('along distance at the end equals segment length', () => {
    const r = projectToSegment(COMMONWEALTH, BRADDOCK, COMMONWEALTH);
    expect(r.alongMeters).toBeCloseTo(r.segLengthMeters, 0);
  });
});

describe('isWithinCorridor', () => {
  test('point near the midpoint of the avenue is inside', () => {
    const mid = { lat: 38.8276, lng: -77.0641 };
    expect(isWithinCorridor(mid, BRADDOCK, COMMONWEALTH, 150, 50)).toBe(true);
  });

  test('point ~one block (120 m) east is still inside a 150 m corridor', () => {
    // ~120 m east ≈ +0.00138 deg lng at this latitude
    const eastOfAvenue = { lat: 38.8276, lng: -77.0641 + 0.00138 };
    expect(isWithinCorridor(eastOfAvenue, BRADDOCK, COMMONWEALTH, 150, 50)).toBe(
      true,
    );
  });

  test('point ~400 m east is outside a 150 m corridor', () => {
    const farEast = { lat: 38.8276, lng: -77.0641 + 0.0046 };
    expect(isWithinCorridor(farEast, BRADDOCK, COMMONWEALTH, 150, 50)).toBe(
      false,
    );
  });

  test('point well south of Braddock is outside (beyond end buffer)', () => {
    const south = { lat: 38.815, lng: -77.0595 };
    expect(isWithinCorridor(south, BRADDOCK, COMMONWEALTH, 150, 50)).toBe(false);
  });
});
