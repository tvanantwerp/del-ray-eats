import { INCLUDED_TYPES, SEARCH_CENTER, SEARCH_RADIUS_METERS } from './config';
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

function mapPlace(p: ApiPlace): DiscoveredPlace {
  return {
    placeId: p.id,
    name: p.displayName?.text ?? '',
    address: p.formattedAddress ?? '',
    location: {
      lat: p.location?.latitude ?? 0,
      lng: p.location?.longitude ?? 0,
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
                latitude: SEARCH_CENTER.lat,
                longitude: SEARCH_CENTER.lng,
              },
              radius: SEARCH_RADIUS_METERS,
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
      return (data.places ?? []).map(mapPlace);
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
      const data = (await res.json()) as { businessStatus?: BusinessStatus };
      return data.businessStatus ?? 'NOT_FOUND';
    },
  };
}
