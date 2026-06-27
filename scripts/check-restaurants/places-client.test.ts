import { describe, expect, test, vi } from 'vitest';

import { createPlacesClient } from './places-client';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('searchNearby', () => {
  test('calls fetch once per tile center and maps API places into DiscoveredPlace', async () => {
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

    // One call per tile center along the corridor (more than one tile).
    expect(fetchFn.mock.calls.length).toBeGreaterThan(1);

    const call = fetchFn.mock.calls[0] as unknown as [
      string | URL | Request,
      RequestInit | undefined,
    ];
    const [url, init] = call;
    expect(String(url)).toContain('places:searchNearby');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['X-Goog-Api-Key']).toBe('KEY');
    expect(headers['X-Goog-FieldMask']).toContain('places.businessStatus');

    // Same placeId returned by every tile (mocked the same way) is unioned
    // and de-duplicated, so it appears exactly once in the final result.
    expect(places).toHaveLength(1);
    expect(places[0]).toMatchObject({
      placeId: 'p-1',
      name: 'Lena’s',
      address: '401 E Braddock Rd',
      website: 'https://lenaswoodfire.com',
      businessStatus: 'OPERATIONAL',
      location: { lat: 38.83, lng: -77.065 },
    });
  });

  test('unions and de-duplicates places returned by different tiles', async () => {
    let call = 0;
    const fetchFn = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return jsonResponse({
          places: [
            {
              id: 'p-shared',
              displayName: { text: 'Shared Place' },
              formattedAddress: '1 Mount Vernon Ave',
              location: { latitude: 38.82, longitude: -77.06 },
              businessStatus: 'OPERATIONAL',
            },
            {
              id: 'p-only-tile-1',
              displayName: { text: 'Only In Tile 1' },
              formattedAddress: '2 Mount Vernon Ave',
              location: { latitude: 38.821, longitude: -77.0605 },
              businessStatus: 'OPERATIONAL',
            },
          ],
        });
      }
      // Every subsequent tile call returns the shared place plus, on the
      // second call only, a place unique to that tile.
      return jsonResponse({
        places: [
          {
            id: 'p-shared',
            displayName: { text: 'Shared Place' },
            formattedAddress: '1 Mount Vernon Ave',
            location: { latitude: 38.82, longitude: -77.06 },
            businessStatus: 'OPERATIONAL',
          },
          ...(call === 2
            ? [
                {
                  id: 'p-only-tile-2',
                  displayName: { text: 'Only In Tile 2' },
                  formattedAddress: '3 Mount Vernon Ave',
                  location: { latitude: 38.822, longitude: -77.061 },
                  businessStatus: 'OPERATIONAL',
                },
              ]
            : []),
        ],
      });
    });
    const client = createPlacesClient(
      'KEY',
      fetchFn as unknown as typeof fetch,
    );
    const places = await client.searchNearby();

    expect(fetchFn.mock.calls.length).toBeGreaterThan(1);

    const placeIds = places.map(p => p.placeId).sort();
    expect(placeIds).toEqual(
      ['p-only-tile-1', 'p-only-tile-2', 'p-shared'].sort(),
    );
    // The shared placeId must appear exactly once despite being returned by
    // every tile.
    expect(placeIds.filter(id => id === 'p-shared')).toHaveLength(1);
  });

  test('drops a place whose location is missing rather than coercing to {0,0}', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        places: [
          {
            id: 'p-no-location',
            displayName: { text: 'No Location' },
            formattedAddress: '1 Mount Vernon Ave',
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
    expect(places).toHaveLength(0);
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

  test('throws if any tile request returns a non-OK response', async () => {
    let call = 0;
    const fetchFn = vi.fn(async () => {
      call += 1;
      if (call === 3) return jsonResponse({ error: 'bad' }, 400);
      return jsonResponse({ places: [] });
    });
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
