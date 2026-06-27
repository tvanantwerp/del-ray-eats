import {
  INCLUDED_TYPES,
  SEARCH_TILE_EXTEND_METERS,
  SEARCH_TILE_RADIUS_METERS,
  SEARCH_TILE_SPACING_METERS,
  SEGMENT_END,
  SEGMENT_START,
} from './config';
import { tileCentersAlongSegment } from './geo';
import type { BusinessStatus, DiscoveredPlace } from './types';

const SEARCH_URL = 'https://places.googleapis.com/v1/places:searchNearby';
const DETAILS_URL = 'https://places.googleapis.com/v1/places';

const SEARCH_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.location',
  'places.websiteUri',
  'places.businessStatus',
].join(',');

interface ApiPlace {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude: number; longitude: number };
  websiteUri?: string;
  businessStatus?: BusinessStatus;
}

export interface PlacesClient {
  searchNearby(): Promise<DiscoveredPlace[]>;
  getPlaceStatus(placeId: string): Promise<BusinessStatus | 'NOT_FOUND'>;
}

// Returns null (rather than coercing to {0,0}) when the API omits location,
// so the caller can drop the place instead of silently mislocating it.
function mapPlace(p: ApiPlace): DiscoveredPlace | null {
  if (!p.location) return null;
  return {
    placeId: p.id,
    name: p.displayName?.text ?? '',
    address: p.formattedAddress ?? '',
    location: {
      lat: p.location.latitude,
      lng: p.location.longitude,
    },
    website: p.websiteUri ?? null,
    businessStatus: p.businessStatus ?? 'OPERATIONAL',
  };
}

export function createPlacesClient(
  apiKey: string,
  fetchFn: typeof fetch = fetch,
): PlacesClient {
  return {
    async searchNearby(): Promise<DiscoveredPlace[]> {
      // Places API (New) searchNearby caps results at 20 with no
      // pagination, so we tile small overlapping circles along the
      // corridor and union the results by placeId instead of relying on a
      // single large-radius search.
      const tileCenters = tileCentersAlongSegment(
        SEGMENT_START,
        SEGMENT_END,
        SEARCH_TILE_SPACING_METERS,
        SEARCH_TILE_EXTEND_METERS,
      );

      const found = new Map<string, DiscoveredPlace>();
      for (const center of tileCenters) {
        const res = await fetchFn(SEARCH_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': apiKey,
            'X-Goog-FieldMask': SEARCH_FIELD_MASK,
          },
          body: JSON.stringify({
            includedTypes: INCLUDED_TYPES,
            maxResultCount: 20,
            locationRestriction: {
              circle: {
                center: {
                  latitude: center.lat,
                  longitude: center.lng,
                },
                radius: SEARCH_TILE_RADIUS_METERS,
              },
            },
          }),
        });
        if (!res.ok) {
          throw new Error(
            `Places searchNearby failed: ${res.status} ${await res.text()}`,
          );
        }
        const data = (await res.json()) as { places?: ApiPlace[] };
        for (const apiPlace of data.places ?? []) {
          const place = mapPlace(apiPlace);
          if (place) found.set(place.placeId, place);
        }
      }
      return [...found.values()];
    },

    async getPlaceStatus(
      placeId: string,
    ): Promise<BusinessStatus | 'NOT_FOUND'> {
      const res = await fetchFn(`${DETAILS_URL}/${placeId}`, {
        method: 'GET',
        headers: {
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': 'businessStatus',
        },
      });
      if (res.status === 404) return 'NOT_FOUND';
      if (!res.ok) {
        throw new Error(
          `Places details failed: ${res.status} ${await res.text()}`,
        );
      }
      // A 200 response with no businessStatus is treated the same as
      // NOT_FOUND, which is warning-only and never triggers a removal —
      // intentionally conservative in the face of an unexpected API shape.
      const data = (await res.json()) as { businessStatus?: BusinessStatus };
      return data.businessStatus ?? 'NOT_FOUND';
    },
  };
}
