import { describe, expect, test } from 'vitest';

import {
  haversineMeters,
  isWithinCorridor,
  projectToSegment,
  tileCentersAlongSegment,
} from './geo';
import type { LatLng } from './types';

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
    expect(
      isWithinCorridor(eastOfAvenue, BRADDOCK, COMMONWEALTH, 150, 50),
    ).toBe(true);
  });

  test('point ~400 m east is outside a 150 m corridor', () => {
    const farEast = { lat: 38.8276, lng: -77.0641 + 0.0046 };
    expect(isWithinCorridor(farEast, BRADDOCK, COMMONWEALTH, 150, 50)).toBe(
      false,
    );
  });

  test('point well south of Braddock is outside (beyond end buffer)', () => {
    const south = { lat: 38.815, lng: -77.0595 };
    expect(isWithinCorridor(south, BRADDOCK, COMMONWEALTH, 150, 50)).toBe(
      false,
    );
  });
});

describe('tileCentersAlongSegment', () => {
  test('returns a sane number of tiles for the real segment with spacing 200 / extend 50', () => {
    const tiles = tileCentersAlongSegment(BRADDOCK, COMMONWEALTH, 200, 50);
    // Segment is ~1.65 km; extended by 50 m on each end gives ~1.75 km,
    // spaced ~200 m apart => roughly 8-12 tiles.
    expect(tiles.length).toBeGreaterThanOrEqual(8);
    expect(tiles.length).toBeLessThanOrEqual(12);
  });

  test('first tile is ~50 m before the start, extended away from the segment', () => {
    const tiles = tileCentersAlongSegment(BRADDOCK, COMMONWEALTH, 200, 50);
    const first = tiles[0];
    expect(first).toBeDefined();
    const distFromStart = haversineMeters(first as LatLng, BRADDOCK);
    expect(distFromStart).toBeGreaterThan(40);
    expect(distFromStart).toBeLessThan(60);
    // It should be on the far side of start relative to the segment (alongMeters < 0).
    const { alongMeters } = projectToSegment(
      first as LatLng,
      BRADDOCK,
      COMMONWEALTH,
    );
    expect(alongMeters).toBeLessThan(0);
  });

  test('last tile is ~50 m beyond the end, extended away from the segment', () => {
    const tiles = tileCentersAlongSegment(BRADDOCK, COMMONWEALTH, 200, 50);
    const last = tiles[tiles.length - 1];
    expect(last).toBeDefined();
    const distFromEnd = haversineMeters(last as LatLng, COMMONWEALTH);
    expect(distFromEnd).toBeGreaterThan(40);
    expect(distFromEnd).toBeLessThan(60);
    const { alongMeters, segLengthMeters } = projectToSegment(
      last as LatLng,
      BRADDOCK,
      COMMONWEALTH,
    );
    expect(alongMeters).toBeGreaterThan(segLengthMeters);
  });

  test('consecutive tiles are spaced no more than ~spacing apart', () => {
    const tiles = tileCentersAlongSegment(BRADDOCK, COMMONWEALTH, 200, 50);
    for (let i = 1; i < tiles.length; i++) {
      const prev = tiles[i - 1];
      const curr = tiles[i];
      expect(prev).toBeDefined();
      expect(curr).toBeDefined();
      const gap = haversineMeters(prev as LatLng, curr as LatLng);
      expect(gap).toBeLessThanOrEqual(210);
    }
  });

  test('guarantees at least one point even for a zero-length segment', () => {
    const tiles = tileCentersAlongSegment(BRADDOCK, BRADDOCK, 200, 50);
    expect(tiles.length).toBeGreaterThanOrEqual(1);
  });

  test('guarantees at least one point for a very short segment with large spacing', () => {
    const nearby = { lat: 38.8205, lng: -77.061 };
    const tiles = tileCentersAlongSegment(BRADDOCK, nearby, 500, 0);
    expect(tiles.length).toBeGreaterThanOrEqual(1);
  });
});
