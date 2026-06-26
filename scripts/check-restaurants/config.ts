import type { LatLng } from './types';

// Mount Vernon Ave ∩ E Braddock Rd (south end of the strip). Verify in Maps.
export const SEGMENT_START: LatLng = { lat: 38.8204, lng: -77.061 };

// Mount Vernon Ave ∩ Commonwealth Ave (north end of the strip). Verify in Maps.
export const SEGMENT_END: LatLng = { lat: 38.8348, lng: -77.0672 };

// Center and radius of the Nearby Search circle covering the whole strip.
export const SEARCH_CENTER: LatLng = { lat: 38.8276, lng: -77.0641 };
export const SEARCH_RADIUS_METERS = 1200;

// Corridor: keep places within this perpendicular distance of the avenue line,
// extended slightly past each endpoint. ~150 m ≈ one block east/west.
export const CORRIDOR_WIDTH_METERS = 150;
export const CORRIDOR_END_BUFFER_METERS = 50;

// Abort and propose no removals if fewer than this many corridor matches return.
export const MIN_EXPECTED_RESULTS = 10;

// Broad type filter — the list includes a bakery, a coffee pub, a cheese shop.
export const INCLUDED_TYPES: readonly string[] = [
  'restaurant',
  'cafe',
  'coffee_shop',
  'bakery',
  'bar',
  'meal_takeaway',
  'meal_delivery',
  'ice_cream_shop',
  'sandwich_shop',
  'pizza_restaurant',
];
