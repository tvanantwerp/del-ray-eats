import type { LatLng } from './types';

const EARTH_RADIUS_M = 6_371_000;

const toRad = (deg: number): number => (deg * Math.PI) / 180;

export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

// Local equirectangular projection: returns metric (x east, y north) relative
// to the origin point. Accurate over the short distances used here.
function toLocalMeters(p: LatLng, origin: LatLng): { x: number; y: number } {
  const x = toRad(p.lng - origin.lng) * Math.cos(toRad(origin.lat)) *
    EARTH_RADIUS_M;
  const y = toRad(p.lat - origin.lat) * EARTH_RADIUS_M;
  return { x, y };
}

export function projectToSegment(
  p: LatLng,
  a: LatLng,
  b: LatLng,
): { perpMeters: number; alongMeters: number; segLengthMeters: number } {
  const pv = toLocalMeters(p, a);
  const bv = toLocalMeters(b, a);
  const segLengthMeters = Math.hypot(bv.x, bv.y);
  if (segLengthMeters === 0) {
    return {
      perpMeters: Math.hypot(pv.x, pv.y),
      alongMeters: 0,
      segLengthMeters: 0,
    };
  }
  const ux = bv.x / segLengthMeters;
  const uy = bv.y / segLengthMeters;
  const alongMeters = pv.x * ux + pv.y * uy;
  const perpMeters = Math.abs(pv.x * uy - pv.y * ux);
  return { perpMeters, alongMeters, segLengthMeters };
}

export function isWithinCorridor(
  p: LatLng,
  segStart: LatLng,
  segEnd: LatLng,
  widthMeters: number,
  endBufferMeters: number,
): boolean {
  const { perpMeters, alongMeters, segLengthMeters } = projectToSegment(
    p,
    segStart,
    segEnd,
  );
  return (
    perpMeters <= widthMeters &&
    alongMeters >= -endBufferMeters &&
    alongMeters <= segLengthMeters + endBufferMeters
  );
}
