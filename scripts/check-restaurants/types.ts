export interface LatLng {
  lat: number;
  lng: number;
}

export type BusinessStatus =
  | 'OPERATIONAL'
  | 'CLOSED_TEMPORARILY'
  | 'CLOSED_PERMANENTLY';

export interface Restaurant {
  name: string;
  slug: string;
  website: string;
  onlineOrderUrl: string;
  placeId?: string;
}

export interface DiscoveredPlace {
  placeId: string;
  name: string;
  location: LatLng;
  address: string;
  website: string | null;
  businessStatus: BusinessStatus;
}

export interface CheckReport {
  generatedAt: string;
  rawCount: number;
  corridorCount: number;
  aborted: boolean;
  additions: DiscoveredPlace[];
  closures: Restaurant[];
  backfills: Array<{ slug: string; placeId: string }>;
  warnings: string[];
  unmatchedExisting: Restaurant[];
}
