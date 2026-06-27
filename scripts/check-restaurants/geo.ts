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
  const x =
    toRad(p.lng - origin.lng) * Math.cos(toRad(origin.lat)) * EARTH_RADIUS_M;
  const y = toRad(p.lat - origin.lat) * EARTH_RADIUS_M;
  return { x, y };
}

// Inverse of toLocalMeters: converts a metric offset (x east, y north) from
// origin back into lat/lng. Accurate over the short distances used here.
function fromLocalMeters(
  offset: { x: number; y: number },
  origin: LatLng,
): LatLng {
  const lat = origin.lat + (offset.y / EARTH_RADIUS_M) * (180 / Math.PI);
  const lng =
    origin.lng +
    (offset.x / (EARTH_RADIUS_M * Math.cos(toRad(origin.lat)))) *
      (180 / Math.PI);
  return { lat, lng };
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

// Returns evenly-spaced points along the line from `start` to `end`,
// extended by `extendMeters` beyond each endpoint, with consecutive points
// ~`spacingMeters` apart. Always includes both extended ends and guarantees
// at least one point (the midpoint) even for a zero-length segment.
export function tileCentersAlongSegment(
  start: LatLng,
  end: LatLng,
  spacingMeters: number,
  extendMeters: number,
): LatLng[] {
  const dir = toLocalMeters(end, start);
  const segLengthMeters = Math.hypot(dir.x, dir.y);

  if (segLengthMeters === 0) {
    return [start];
  }

  const ux = dir.x / segLengthMeters;
  const uy = dir.y / segLengthMeters;

  const totalLengthMeters = segLengthMeters + 2 * extendMeters;
  // Number of segments needed to cover totalLengthMeters at ~spacingMeters
  // apart, always at least 1 (which yields the two extended endpoints).
  const segments = Math.max(1, Math.ceil(totalLengthMeters / spacingMeters));
  const step = totalLengthMeters / segments;

  const points: LatLng[] = [];
  for (let i = 0; i <= segments; i++) {
    const alongMeters = -extendMeters + i * step;
    const offset = { x: ux * alongMeters, y: uy * alongMeters };
    points.push(fromLocalMeters(offset, start));
  }
  return points;
}
