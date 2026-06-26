import { describe, expect, test } from 'vitest';

import type { PlacesClient } from './places-client';
import { type Effects, run } from './run';
import type { BusinessStatus, DiscoveredPlace, Restaurant } from './types';

const onAvenue = { lat: 38.8276, lng: -77.0641 };

function fakeClient(
  discovered: DiscoveredPlace[],
  statuses: Record<string, BusinessStatus | 'NOT_FOUND'>,
): PlacesClient {
  return {
    searchNearby: async () => discovered,
    getPlaceStatus: async id => statuses[id] ?? 'NOT_FOUND',
  };
}

function fakeEffects(existing: Restaurant[]): Effects & {
  written: string[];
  deleted: string[];
  issues: string[];
  prs: Restaurant[][];
} {
  const written: string[] = [];
  const deleted: string[] = [];
  const issues: string[] = [];
  const prs: Restaurant[][] = [];
  return {
    written,
    deleted,
    issues,
    prs,
    readRestaurants: async () => existing,
    writeRestaurants: async json => {
      written.push(json);
    },
    deleteImages: async paths => {
      deleted.push(...paths);
    },
    reportIssue: async body => {
      issues.push(body);
    },
    openClosurePr: async removed => {
      prs.push(removed);
    },
    log: () => {},
  };
}

function place(over: Partial<DiscoveredPlace>): DiscoveredPlace {
  return {
    placeId: 'p',
    name: 'P',
    location: onAvenue,
    address: '2000 Mount Vernon Ave',
    website: null,
    businessStatus: 'OPERATIONAL',
    ...over,
  };
}

// Build N operational corridor places so the guard passes.
function padPlaces(n: number): DiscoveredPlace[] {
  return Array.from({ length: n }, (_, i) =>
    place({ placeId: `pad-${i}`, name: `Pad ${i}` }),
  );
}

describe('run', () => {
  test('aborts without removals when too few corridor results', async () => {
    const existing: Restaurant[] = [
      {
        name: 'Gone',
        slug: 'gone',
        website: '',
        onlineOrderUrl: '',
        placeId: 'p-gone',
      },
    ];
    const client = fakeClient([place({ placeId: 'only', name: 'Only One' })], {
      'p-gone': 'CLOSED_PERMANENTLY',
    });
    const effects = fakeEffects(existing);
    const result = await run(client, effects);

    expect(result.aborted).toBe(true);
    expect(effects.written).toHaveLength(0);
    expect(effects.deleted).toHaveLength(0);
    expect(effects.prs).toHaveLength(0);
  });

  test('removes a permanently closed restaurant and opens a PR', async () => {
    const existing: Restaurant[] = [
      {
        name: 'Gone',
        slug: 'gone',
        website: '',
        onlineOrderUrl: '',
        placeId: 'p-gone',
      },
    ];
    const client = fakeClient(padPlaces(12), {
      'p-gone': 'CLOSED_PERMANENTLY',
    });
    const effects = fakeEffects(existing);
    const result = await run(client, effects);

    expect(result.aborted).toBe(false);
    expect(result.closures).toBe(1);
    expect(effects.deleted).toContain('src/assets/images/gone.png');
    expect(effects.prs[0]?.map(r => r.slug)).toEqual(['gone']);
    expect(effects.written[0]).not.toContain('"gone"');
  });

  test('filters out-of-corridor discoveries from additions', async () => {
    const farEast = place({
      placeId: 'p-far',
      name: 'Far Away Diner',
      location: { lat: 38.8276, lng: -77.0641 + 0.01 },
    });
    const client = fakeClient([...padPlaces(12), farEast], {});
    const effects = fakeEffects([]);
    const result = await run(client, effects);

    // padPlaces are all in-corridor and become additions; farEast must not.
    expect(effects.issues[0]).not.toContain('Far Away Diner');
    expect(result.additions).toBe(12);
  });

  test('always reports an issue', async () => {
    const client = fakeClient(padPlaces(12), {});
    const effects = fakeEffects([]);
    await run(client, effects);
    expect(effects.issues).toHaveLength(1);
  });
});
