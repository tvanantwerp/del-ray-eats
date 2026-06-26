import { describe, expect, test, vi } from 'vitest';

import { createPlacesClient } from './places-client';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('searchNearby', () => {
  test('maps API places into DiscoveredPlace and sends key + field mask', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        places: [
          {
            id: 'p-1',
            displayName: { text: 'Lena’s' },
            formattedAddress: '401 E Braddock Rd',
            location: { latitude: 38.83, longitude: -77.065 },
            websiteUri: 'https://lenaswoodfire.com',
            businessStatus: 'OPERATIONAL',
          },
        ],
      }),
    );
    const client = createPlacesClient(
      'KEY',
      fetchFn as unknown as typeof fetch,
    );
    const places = await client.searchNearby();

    expect(places).toHaveLength(1);
    expect(places[0]).toMatchObject({
      placeId: 'p-1',
      name: 'Lena’s',
      address: '401 E Braddock Rd',
      website: 'https://lenaswoodfire.com',
      businessStatus: 'OPERATIONAL',
      location: { lat: 38.83, lng: -77.065 },
    });

    expect(fetchFn.mock.calls.length).toBeGreaterThan(0);
    const call = fetchFn.mock.calls[0] as unknown as [
      string | URL | Request,
      RequestInit | undefined,
    ];
    const [url, init] = call;
    expect(String(url)).toContain('places:searchNearby');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['X-Goog-Api-Key']).toBe('KEY');
    expect(headers['X-Goog-FieldMask']).toContain('places.businessStatus');
  });

  test('defaults website to null when absent', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        places: [
          {
            id: 'p-2',
            displayName: { text: 'No Site' },
            formattedAddress: '1 Mount Vernon Ave',
            location: { latitude: 38.82, longitude: -77.06 },
            businessStatus: 'OPERATIONAL',
          },
        ],
      }),
    );
    const client = createPlacesClient(
      'KEY',
      fetchFn as unknown as typeof fetch,
    );
    const places = await client.searchNearby();
    expect(places[0]?.website).toBeNull();
  });

  test('throws on non-OK search response', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ error: 'bad' }, 400));
    const client = createPlacesClient(
      'KEY',
      fetchFn as unknown as typeof fetch,
    );
    await expect(client.searchNearby()).rejects.toThrow();
  });
});

describe('getPlaceStatus', () => {
  test('returns the business status', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ businessStatus: 'CLOSED_PERMANENTLY' }),
    );
    const client = createPlacesClient(
      'KEY',
      fetchFn as unknown as typeof fetch,
    );
    expect(await client.getPlaceStatus('p-x')).toBe('CLOSED_PERMANENTLY');
  });

  test('returns NOT_FOUND on 404', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ error: 'no' }, 404));
    const client = createPlacesClient(
      'KEY',
      fetchFn as unknown as typeof fetch,
    );
    expect(await client.getPlaceStatus('p-missing')).toBe('NOT_FOUND');
  });
});
