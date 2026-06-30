import { describe, expect, test } from 'vitest';

import { SEGMENT_END, SEGMENT_START } from './config';
import type { PlacesClient } from './places-client';
import { type Effects, runApply, runCheck } from './run';
import type { BusinessStatus, DiscoveredPlace, Restaurant } from './types';

// A point on the corridor: the midpoint of the avenue segment, derived from
// config so these fixtures stay valid if the endpoints are recalibrated.
const onAvenue = {
  lat: (SEGMENT_START.lat + SEGMENT_END.lat) / 2,
  lng: (SEGMENT_START.lng + SEGMENT_END.lng) / 2,
};

// A point well outside the ~150 m corridor (~0.01° lng ≈ 850 m east).
const offCorridor = { lat: onAvenue.lat, lng: onAvenue.lng + 0.01 };

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
  backfillPrs: Array<Array<{ slug: string; placeId: string }>>;
} {
  const written: string[] = [];
  const deleted: string[] = [];
  const issues: string[] = [];
  const prs: Restaurant[][] = [];
  const backfillPrs: Array<Array<{ slug: string; placeId: string }>> = [];
  return {
    written,
    deleted,
    issues,
    prs,
    backfillPrs,
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
    openBackfillPr: async backfills => {
      backfillPrs.push(backfills);
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

describe('runCheck', () => {
  const deps = (existing: Restaurant[]) => ({
    readRestaurants: async () => existing,
    log: () => {},
  });

  test('aborts (no diff) when too few corridor results', async () => {
    const client = fakeClient(
      [place({ placeId: 'only', name: 'Only One' })],
      {},
    );
    const report = await runCheck(client, deps([]));
    expect(report.aborted).toBe(true);
    expect(report.additions).toEqual([]);
    expect(report.closures).toEqual([]);
  });

  test('classifies a permanently closed existing restaurant as a closure', async () => {
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
    const report = await runCheck(client, deps(existing));
    expect(report.aborted).toBe(false);
    expect(report.closures.map(c => c.slug)).toEqual(['gone']);
    expect(report.corridorCount).toBe(12);
  });

  test('excludes out-of-corridor places from additions', async () => {
    const farEast = place({
      placeId: 'p-far',
      name: 'Far Away Diner',
      location: offCorridor,
    });
    const client = fakeClient([...padPlaces(12), farEast], {});
    const report = await runCheck(client, deps([]));
    expect(report.additions.map(a => a.name)).not.toContain('Far Away Diner');
    expect(report.additions).toHaveLength(12);
  });

  test('lists existing entries with no placeId and no name match as unmatchedExisting', async () => {
    const existing: Restaurant[] = [
      { name: 'Ghost Diner', slug: 'ghost', website: '', onlineOrderUrl: '' },
    ];
    const client = fakeClient(padPlaces(12), {});
    const report = await runCheck(client, deps(existing));
    expect(report.unmatchedExisting.map(r => r.slug)).toEqual(['ghost']);
  });
});

describe('runApply', () => {
  const baseReport = (over: Partial<import('./types').CheckReport>) => ({
    generatedAt: '2026-06-29T00:00:00.000Z',
    rawCount: 48,
    corridorCount: 43,
    aborted: false,
    additions: [],
    closures: [],
    backfills: [],
    warnings: [],
    unmatchedExisting: [],
    ...over,
  });

  test('does nothing when the report is aborted', async () => {
    const effects = fakeEffects([]);
    const result = await runApply(baseReport({ aborted: true }), effects);
    expect(result.wrote).toBe(false);
    expect(effects.written).toHaveLength(0);
    expect(effects.prs).toHaveLength(0);
    expect(effects.issues).toHaveLength(0);
  });

  test('removes a closed restaurant, opens a closure PR, always reports an issue', async () => {
    const existing: Restaurant[] = [
      {
        name: 'Gone',
        slug: 'gone',
        website: '',
        onlineOrderUrl: '',
        placeId: 'p-gone',
      },
    ];
    const effects = fakeEffects(existing);
    const result = await runApply(
      baseReport({ closures: [existing[0]!] }),
      effects,
    );
    expect(result.closures).toBe(1);
    expect(effects.deleted).toContain('src/assets/images/gone.png');
    expect(effects.prs[0]?.map(r => r.slug)).toEqual(['gone']);
    expect(effects.written[0]).not.toContain('"gone"');
    expect(effects.issues).toHaveLength(1);
  });

  test('backfills only: opens a backfill PR, not a closure PR', async () => {
    const existing: Restaurant[] = [
      { name: 'Found Me', slug: 'found-me', website: '', onlineOrderUrl: '' },
    ];
    const effects = fakeEffects(existing);
    const result = await runApply(
      baseReport({ backfills: [{ slug: 'found-me', placeId: 'p-fm' }] }),
      effects,
    );
    expect(result.backfills).toBe(1);
    expect(effects.backfillPrs).toHaveLength(1);
    expect(effects.prs).toHaveLength(0);
    expect(effects.written).toHaveLength(1);
  });
});
