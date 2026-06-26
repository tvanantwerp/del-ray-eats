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
