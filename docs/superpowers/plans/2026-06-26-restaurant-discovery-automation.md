# Restaurant Discovery Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A scheduled GitHub Action that calls the Google Places API to detect restaurants newly opened or permanently closed on the Del Ray stretch of Mount Vernon Ave, opening a PR for confirmed closures and an Issue for new candidates.

**Architecture:** A TypeScript script in `scripts/check-restaurants/` split into a pure geometry/diff core (unit-tested), a mockable Places API client, and a reporter that performs file edits and `gh` Issue/PR side effects. An orchestrator wires them together behind injected effects so it is testable. A weekly GitHub Action runs it.

**Tech Stack:** TypeScript (run with `tsx`), Vitest for tests, Google Places API (New) over `fetch`, GitHub Actions, `gh` CLI for Issue/PR creation, pnpm.

## Global Constraints

- Package manager is **pnpm**; install latest versions (no pinned versions unless required).
- Node `>=22.12.0` (CI uses Node 24, matching local). ESM only (`"type"` is not set, but all script files use ESM `import`/`export` and `.ts`/`.mts`).
- TypeScript extends `astro/tsconfigs/strictest` — no implicit `any`, strict null checks, `noUncheckedIndexedAccess`. All new code must satisfy it.
- Prettier: single quotes, semicolons, 2-space indent, trailing commas, 80-col, `arrowParens: avoid`.
- `src/data/restaurants.json` is the single source of truth. Each entry is `{ name, slug, website, onlineOrderUrl }`; this plan adds an optional `placeId`. `card.astro` must remain untouched and unaffected.
- Every restaurant entry must have a matching `src/assets/images/<slug>.png` (the build throws otherwise), so removing an entry must also remove its image.
- Closures: only `CLOSED_PERMANENTLY` is auto-removed. `CLOSED_TEMPORARILY`, dropped-out-but-operational, and not-found are reported only.
- Safety guard: if Nearby Search returns fewer than `MIN_EXPECTED_RESULTS` corridor matches, abort with a non-zero exit and propose no removals.

---

## File Structure

```
scripts/check-restaurants/
  types.ts          # shared types: LatLng, BusinessStatus, Restaurant, DiscoveredPlace
  geo.ts            # pure geometry: haversine, point-to-segment, corridor test
  geo.test.ts
  diff.ts           # pure: slugify, name matching, diffRestaurants
  diff.test.ts
  config.ts         # corridor endpoints, widths, search params, type filter, guard threshold
  places-client.ts  # Google Places API (New) client (network)
  places-client.test.ts
  report.ts         # pure builders: issue body, JSON mutation, image paths to delete
  report.test.ts
  effects.ts        # real side effects: fs + gh CLI (thin wrappers)
  run.ts            # orchestration: run(client, effects) — testable
  run.test.ts
  main.ts           # entrypoint: wires real client + real effects, reads env
vitest.config.ts
.github/workflows/check-restaurants.yml
```

`package.json` gains devDeps (`vitest`, `tsx`, `@types/node`) and scripts (`test`, `check:restaurants`).

---

### Task 1: Test + runtime tooling

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `scripts/check-restaurants/smoke.test.ts` (temporary, deleted at end of task)

**Interfaces:**
- Consumes: nothing.
- Produces: working `pnpm test` (vitest) and `tsx` available for running scripts.

- [ ] **Step 1: Install dev dependencies**

```bash
pnpm add -D vitest tsx @types/node
```

- [ ] **Step 2: Add scripts to package.json**

Add these two entries to the `"scripts"` block in `package.json` (keep existing entries):

```json
    "test": "vitest run",
    "check:restaurants": "tsx scripts/check-restaurants/main.ts"
```

- [ ] **Step 3: Create vitest config**

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['scripts/**/*.test.ts'],
    environment: 'node',
  },
});
```

- [ ] **Step 4: Write a smoke test**

Create `scripts/check-restaurants/smoke.test.ts`:

```ts
import { expect, test } from 'vitest';

test('vitest harness runs', () => {
  expect(1 + 1).toBe(2);
});
```

- [ ] **Step 5: Run the smoke test**

Run: `pnpm test`
Expected: PASS, 1 test passed.

- [ ] **Step 6: Delete the smoke test and commit**

```bash
rm scripts/check-restaurants/smoke.test.ts
git add package.json pnpm-lock.yaml vitest.config.ts
git commit -m "chore: add vitest + tsx tooling for restaurant check script"
```

---

### Task 2: Shared types

**Files:**
- Create: `scripts/check-restaurants/types.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface LatLng { lat: number; lng: number }`
  - `type BusinessStatus = 'OPERATIONAL' | 'CLOSED_TEMPORARILY' | 'CLOSED_PERMANENTLY'`
  - `interface Restaurant { name: string; slug: string; website: string; onlineOrderUrl: string; placeId?: string }`
  - `interface DiscoveredPlace { placeId: string; name: string; location: LatLng; address: string; website: string | null; businessStatus: BusinessStatus }`

This task has no test (pure type declarations). It is folded here because every later task consumes these types.

- [ ] **Step 1: Create the types file**

Create `scripts/check-restaurants/types.ts`:

```ts
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
```

- [ ] **Step 2: Type-check and commit**

Run: `pnpm exec tsc --noEmit -p tsconfig.json`
Expected: no errors referencing `types.ts`.

```bash
git add scripts/check-restaurants/types.ts
git commit -m "feat: add shared types for restaurant check script"
```

---

### Task 3: Geometry core

**Files:**
- Create: `scripts/check-restaurants/geo.ts`
- Test: `scripts/check-restaurants/geo.test.ts`

**Interfaces:**
- Consumes: `LatLng` from `./types`.
- Produces:
  - `haversineMeters(a: LatLng, b: LatLng): number`
  - `projectToSegment(p: LatLng, a: LatLng, b: LatLng): { perpMeters: number; alongMeters: number; segLengthMeters: number }`
  - `isWithinCorridor(p: LatLng, segStart: LatLng, segEnd: LatLng, widthMeters: number, endBufferMeters: number): boolean`

`projectToSegment` uses a local equirectangular projection centered at `a`: convert lat/lng deltas to meters, then do 2-D vector projection. `alongMeters` is the signed distance from `a` along the segment direction (may be negative or exceed `segLengthMeters`). `perpMeters` is the absolute perpendicular distance.

- [ ] **Step 1: Write the failing tests**

Create `scripts/check-restaurants/geo.test.ts`:

```ts
import { describe, expect, test } from 'vitest';

import { haversineMeters, isWithinCorridor, projectToSegment } from './geo';

const BRADDOCK = { lat: 38.8204, lng: -77.061 };
const COMMONWEALTH = { lat: 38.8348, lng: -77.0672 };

describe('haversineMeters', () => {
  test('zero distance for identical points', () => {
    expect(haversineMeters(BRADDOCK, BRADDOCK)).toBeCloseTo(0, 5);
  });

  test('matches known distance between the two endpoints (~1.65 km)', () => {
    const d = haversineMeters(BRADDOCK, COMMONWEALTH);
    expect(d).toBeGreaterThan(1500);
    expect(d).toBeLessThan(1800);
  });
});

describe('projectToSegment', () => {
  test('a point on the segment start has ~0 perpendicular and ~0 along distance', () => {
    const r = projectToSegment(BRADDOCK, BRADDOCK, COMMONWEALTH);
    expect(r.perpMeters).toBeCloseTo(0, 1);
    expect(r.alongMeters).toBeCloseTo(0, 1);
  });

  test('along distance at the end equals segment length', () => {
    const r = projectToSegment(COMMONWEALTH, BRADDOCK, COMMONWEALTH);
    expect(r.alongMeters).toBeCloseTo(r.segLengthMeters, 0);
  });
});

describe('isWithinCorridor', () => {
  test('point near the midpoint of the avenue is inside', () => {
    const mid = { lat: 38.8276, lng: -77.0641 };
    expect(isWithinCorridor(mid, BRADDOCK, COMMONWEALTH, 150, 50)).toBe(true);
  });

  test('point ~one block (120 m) east is still inside a 150 m corridor', () => {
    // ~120 m east ≈ +0.00138 deg lng at this latitude
    const eastOfAvenue = { lat: 38.8276, lng: -77.0641 + 0.00138 };
    expect(isWithinCorridor(eastOfAvenue, BRADDOCK, COMMONWEALTH, 150, 50)).toBe(
      true,
    );
  });

  test('point ~400 m east is outside a 150 m corridor', () => {
    const farEast = { lat: 38.8276, lng: -77.0641 + 0.0046 };
    expect(isWithinCorridor(farEast, BRADDOCK, COMMONWEALTH, 150, 50)).toBe(
      false,
    );
  });

  test('point well south of Braddock is outside (beyond end buffer)', () => {
    const south = { lat: 38.815, lng: -77.0595 };
    expect(isWithinCorridor(south, BRADDOCK, COMMONWEALTH, 150, 50)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test scripts/check-restaurants/geo.test.ts`
Expected: FAIL with "Cannot find module './geo'" / functions not defined.

- [ ] **Step 3: Implement the geometry**

Create `scripts/check-restaurants/geo.ts`:

```ts
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
  const x = toRad(p.lng - origin.lng) * Math.cos(toRad(origin.lat)) *
    EARTH_RADIUS_M;
  const y = toRad(p.lat - origin.lat) * EARTH_RADIUS_M;
  return { x, y };
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test scripts/check-restaurants/geo.test.ts`
Expected: PASS, all geo tests green.

- [ ] **Step 5: Commit**

```bash
git add scripts/check-restaurants/geo.ts scripts/check-restaurants/geo.test.ts
git commit -m "feat: add corridor geometry for restaurant check"
```

---

### Task 4: Config

**Files:**
- Create: `scripts/check-restaurants/config.ts`

**Interfaces:**
- Consumes: `LatLng` from `./types`.
- Produces: `SEGMENT_START`, `SEGMENT_END`, `SEARCH_CENTER` (`LatLng`); `CORRIDOR_WIDTH_METERS`, `CORRIDOR_END_BUFFER_METERS`, `SEARCH_RADIUS_METERS`, `MIN_EXPECTED_RESULTS` (numbers); `INCLUDED_TYPES` (`readonly string[]`).

The two endpoint coordinates are approximate. **Before committing, verify them:** open Google Maps, find the Mount Vernon Ave ∩ E Braddock Rd intersection (south) and the Mount Vernon Ave ∩ Commonwealth Ave intersection (north), right-click → copy the lat/lng, and replace the values below if they differ materially. They are tunable; the corridor width absorbs small errors.

- [ ] **Step 1: Create the config file**

Create `scripts/check-restaurants/config.ts`:

```ts
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
```

- [ ] **Step 2: Type-check and commit**

Run: `pnpm exec tsc --noEmit -p tsconfig.json`
Expected: no errors referencing `config.ts`.

```bash
git add scripts/check-restaurants/config.ts
git commit -m "feat: add config for restaurant corridor + search params"
```

---

### Task 5: Diff core

**Files:**
- Create: `scripts/check-restaurants/diff.ts`
- Test: `scripts/check-restaurants/diff.test.ts`

**Interfaces:**
- Consumes: `Restaurant`, `DiscoveredPlace`, `BusinessStatus` from `./types`.
- Produces:
  - `slugify(name: string): string`
  - `normalizeName(name: string): string`
  - `nameSimilarity(a: string, b: string): number` (Jaccard over normalized tokens, 0..1)
  - `interface DiffResult { additions: DiscoveredPlace[]; closures: Restaurant[]; backfills: Array<{ slug: string; placeId: string }>; warnings: string[] }`
  - `diffRestaurants(existing: Restaurant[], discovered: DiscoveredPlace[], existingStatuses: Map<string, BusinessStatus | 'NOT_FOUND'>): DiffResult`

Logic:
- **closures:** existing entries whose `placeId` maps to `CLOSED_PERMANENTLY`.
- **backfills:** existing entries with no `placeId`, fuzzy-matched (similarity ≥ 0.6) to a discovered place; record `{ slug, placeId }`.
- **additions:** discovered places whose `placeId` is not held by any existing entry AND that did not match an existing entry by name.
- **warnings:** existing `placeId` mapping to `CLOSED_TEMPORARILY`; existing `placeId` mapping to `NOT_FOUND`; existing entry that is `OPERATIONAL`/known but absent from `discovered` (dropped out of corridor).

- [ ] **Step 1: Write the failing tests**

Create `scripts/check-restaurants/diff.test.ts`:

```ts
import { describe, expect, test } from 'vitest';

import { diffRestaurants, nameSimilarity, slugify } from './diff';
import type { BusinessStatus, DiscoveredPlace, Restaurant } from './types';

const place = (over: Partial<DiscoveredPlace>): DiscoveredPlace => ({
  placeId: 'p-default',
  name: 'Some Place',
  location: { lat: 38.8276, lng: -77.0641 },
  address: '123 Mount Vernon Ave',
  website: null,
  businessStatus: 'OPERATIONAL',
  ...over,
});

const restaurant = (over: Partial<Restaurant>): Restaurant => ({
  name: 'Some Place',
  slug: 'some-place',
  website: 'https://example.com',
  onlineOrderUrl: 'https://example.com/order',
  ...over,
});

describe('slugify', () => {
  test('lowercases, strips punctuation, hyphenates', () => {
    expect(slugify("Matt & Tony's All Day Kitchen + Bar")).toBe(
      'matt-tonys-all-day-kitchen-bar',
    );
  });

  test('collapses repeated separators and trims', () => {
    expect(slugify('  Hi/Fi  Tex-Mex  BBQ ')).toBe('hifi-tex-mex-bbq');
  });
});

describe('nameSimilarity', () => {
  test('identical names score 1', () => {
    expect(nameSimilarity('Thai Peppers', 'Thai Peppers')).toBe(1);
  });

  test('related names score above the 0.6 threshold', () => {
    expect(
      nameSimilarity('Del Ray Cafe', 'Del Ray Café Restaurant'),
    ).toBeGreaterThanOrEqual(0.6);
  });

  test('unrelated names score below threshold', () => {
    expect(nameSimilarity('Thai Peppers', 'Pork Barrel BBQ')).toBeLessThan(0.6);
  });
});

describe('diffRestaurants', () => {
  test('flags a permanently closed existing restaurant as a closure', () => {
    const existing = [restaurant({ slug: 'gone', placeId: 'p-gone' })];
    const statuses = new Map<string, BusinessStatus | 'NOT_FOUND'>([
      ['p-gone', 'CLOSED_PERMANENTLY'],
    ]);
    const result = diffRestaurants(existing, [], statuses);
    expect(result.closures.map(r => r.slug)).toEqual(['gone']);
    expect(result.additions).toEqual([]);
  });

  test('flags an unknown discovered place as an addition', () => {
    const existing = [restaurant({ slug: 'keep', placeId: 'p-keep' })];
    const discovered = [
      place({ placeId: 'p-keep', name: 'Keep' }),
      place({ placeId: 'p-new', name: 'Brand New Spot' }),
    ];
    const statuses = new Map<string, BusinessStatus | 'NOT_FOUND'>([
      ['p-keep', 'OPERATIONAL'],
    ]);
    const result = diffRestaurants(existing, discovered, statuses);
    expect(result.additions.map(p => p.placeId)).toEqual(['p-new']);
    expect(result.closures).toEqual([]);
  });

  test('backfills placeId for an existing entry with no placeId via name match', () => {
    const existing = [restaurant({ name: 'Thai Peppers', slug: 'thai-peppers' })];
    const discovered = [place({ placeId: 'p-thai', name: 'Thai Peppers' })];
    const statuses = new Map<string, BusinessStatus | 'NOT_FOUND'>();
    const result = diffRestaurants(existing, discovered, statuses);
    expect(result.backfills).toEqual([{ slug: 'thai-peppers', placeId: 'p-thai' }]);
    // matched by name, so NOT an addition
    expect(result.additions).toEqual([]);
  });

  test('warns on temporarily closed and on dropped-out operational entries', () => {
    const existing = [
      restaurant({ slug: 'temp', placeId: 'p-temp' }),
      restaurant({ slug: 'dropped', placeId: 'p-dropped' }),
    ];
    const statuses = new Map<string, BusinessStatus | 'NOT_FOUND'>([
      ['p-temp', 'CLOSED_TEMPORARILY'],
      ['p-dropped', 'OPERATIONAL'],
    ]);
    // p-dropped is operational but not in discovered list
    const result = diffRestaurants(existing, [], statuses);
    expect(result.closures).toEqual([]);
    expect(result.warnings.some(w => w.includes('temp'))).toBe(true);
    expect(result.warnings.some(w => w.includes('dropped'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test scripts/check-restaurants/diff.test.ts`
Expected: FAIL with "Cannot find module './diff'".

- [ ] **Step 3: Implement the diff core**

Create `scripts/check-restaurants/diff.ts`:

```ts
import type {
  BusinessStatus,
  DiscoveredPlace,
  Restaurant,
} from './types';

const NAME_MATCH_THRESHOLD = 0.6;

const STOPWORDS = new Set([
  'the',
  'restaurant',
  'cafe',
  'and',
  'of',
  'del',
  'ray',
  'va',
]);

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(name: string): Set<string> {
  return new Set(
    normalizeName(name)
      .split(' ')
      .filter(t => t.length > 0 && !STOPWORDS.has(t)),
  );
}

export function nameSimilarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 && tb.size === 0) return 1;
  if (ta.size === 0 || tb.size === 0) return 0;
  let intersection = 0;
  for (const t of ta) if (tb.has(t)) intersection += 1;
  const union = ta.size + tb.size - intersection;
  return intersection / union;
}

export interface DiffResult {
  additions: DiscoveredPlace[];
  closures: Restaurant[];
  backfills: Array<{ slug: string; placeId: string }>;
  warnings: string[];
}

export function diffRestaurants(
  existing: Restaurant[],
  discovered: DiscoveredPlace[],
  existingStatuses: Map<string, BusinessStatus | 'NOT_FOUND'>,
): DiffResult {
  const result: DiffResult = {
    additions: [],
    closures: [],
    backfills: [],
    warnings: [],
  };

  const knownPlaceIds = new Set(
    existing.map(r => r.placeId).filter((id): id is string => Boolean(id)),
  );
  const matchedDiscoveredIds = new Set<string>();

  // Backfill placeIds for existing entries that lack one, via name match.
  for (const r of existing) {
    if (r.placeId) continue;
    let best: { place: DiscoveredPlace; score: number } | null = null;
    for (const d of discovered) {
      const score = nameSimilarity(r.name, d.name);
      if (!best || score > best.score) best = { place: d, score };
    }
    if (best && best.score >= NAME_MATCH_THRESHOLD) {
      result.backfills.push({ slug: r.slug, placeId: best.place.placeId });
      knownPlaceIds.add(best.place.placeId);
      matchedDiscoveredIds.add(best.place.placeId);
    }
  }

  // Closures + warnings, driven by status of existing entries.
  for (const r of existing) {
    if (!r.placeId) continue;
    const status = existingStatuses.get(r.placeId);
    if (status === 'CLOSED_PERMANENTLY') {
      result.closures.push(r);
    } else if (status === 'CLOSED_TEMPORARILY') {
      result.warnings.push(
        `${r.slug}: reported CLOSED_TEMPORARILY — not removing, verify manually.`,
      );
    } else if (status === 'NOT_FOUND') {
      result.warnings.push(
        `${r.slug}: placeId ${r.placeId} not found by Places — verify manually.`,
      );
    } else if (!discovered.some(d => d.placeId === r.placeId)) {
      result.warnings.push(
        `${r.slug}: operational but absent from corridor search — verify it has not moved.`,
      );
    }
  }

  // Additions: discovered places not known and not name-matched to existing.
  for (const d of discovered) {
    if (knownPlaceIds.has(d.placeId) || matchedDiscoveredIds.has(d.placeId)) {
      continue;
    }
    const nameMatch = existing.some(
      r => nameSimilarity(r.name, d.name) >= NAME_MATCH_THRESHOLD,
    );
    if (!nameMatch) result.additions.push(d);
  }

  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test scripts/check-restaurants/diff.test.ts`
Expected: PASS, all diff tests green.

- [ ] **Step 5: Commit**

```bash
git add scripts/check-restaurants/diff.ts scripts/check-restaurants/diff.test.ts
git commit -m "feat: add diff core for restaurant additions/closures"
```

---

### Task 6: Places API client

**Files:**
- Create: `scripts/check-restaurants/places-client.ts`
- Test: `scripts/check-restaurants/places-client.test.ts`

**Interfaces:**
- Consumes: `DiscoveredPlace`, `BusinessStatus` from `./types`; config values from `./config`.
- Produces:
  - `interface PlacesClient { searchNearby(): Promise<DiscoveredPlace[]>; getPlaceStatus(placeId: string): Promise<BusinessStatus | 'NOT_FOUND'> }`
  - `createPlacesClient(apiKey: string, fetchFn?: typeof fetch): PlacesClient`

`searchNearby` POSTs to `https://places.googleapis.com/v1/places:searchNearby` with the config circle + `INCLUDED_TYPES`, requesting a field mask. `getPlaceStatus` GETs `https://places.googleapis.com/v1/places/{placeId}` with a `businessStatus` field mask; a 404 yields `'NOT_FOUND'`. `fetchFn` defaults to global `fetch` and is injected in tests.

- [ ] **Step 1: Write the failing tests**

Create `scripts/check-restaurants/places-client.test.ts`:

```ts
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
    const client = createPlacesClient('KEY', fetchFn as unknown as typeof fetch);
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

    const [url, init] = fetchFn.mock.calls[0];
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
    const client = createPlacesClient('KEY', fetchFn as unknown as typeof fetch);
    const places = await client.searchNearby();
    expect(places[0]?.website).toBeNull();
  });

  test('throws on non-OK search response', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ error: 'bad' }, 400));
    const client = createPlacesClient('KEY', fetchFn as unknown as typeof fetch);
    await expect(client.searchNearby()).rejects.toThrow();
  });
});

describe('getPlaceStatus', () => {
  test('returns the business status', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ businessStatus: 'CLOSED_PERMANENTLY' }),
    );
    const client = createPlacesClient('KEY', fetchFn as unknown as typeof fetch);
    expect(await client.getPlaceStatus('p-x')).toBe('CLOSED_PERMANENTLY');
  });

  test('returns NOT_FOUND on 404', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ error: 'no' }, 404));
    const client = createPlacesClient('KEY', fetchFn as unknown as typeof fetch);
    expect(await client.getPlaceStatus('p-missing')).toBe('NOT_FOUND');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test scripts/check-restaurants/places-client.test.ts`
Expected: FAIL with "Cannot find module './places-client'".

- [ ] **Step 3: Implement the client**

Create `scripts/check-restaurants/places-client.ts`:

```ts
import {
  INCLUDED_TYPES,
  SEARCH_CENTER,
  SEARCH_RADIUS_METERS,
} from './config';
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
```

Note: Nearby Search (New) caps `maxResultCount` at 20. The corridor is small, but if the strip ever exceeds 20 raw results this would truncate; acceptable for now (documented limitation).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test scripts/check-restaurants/places-client.test.ts`
Expected: PASS, all client tests green.

- [ ] **Step 5: Commit**

```bash
git add scripts/check-restaurants/places-client.ts scripts/check-restaurants/places-client.test.ts
git commit -m "feat: add Google Places API client"
```

---

### Task 7: Reporter (pure builders)

**Files:**
- Create: `scripts/check-restaurants/report.ts`
- Test: `scripts/check-restaurants/report.test.ts`

**Interfaces:**
- Consumes: `Restaurant`, `DiscoveredPlace` from `./types`; `slugify` from `./diff`.
- Produces:
  - `buildIssueBody(additions: DiscoveredPlace[], warnings: string[]): string`
  - `applyClosures(restaurants: Restaurant[], closures: Restaurant[]): Restaurant[]`
  - `applyBackfills(restaurants: Restaurant[], backfills: Array<{ slug: string; placeId: string }>): Restaurant[]`
  - `imageFilesToDelete(closures: Restaurant[]): string[]` (paths like `src/assets/images/<slug>.png`)
  - `serializeRestaurants(restaurants: Restaurant[]): string` (2-space JSON + trailing newline, matching the existing file)

`applyClosures`/`applyBackfills` return new arrays (no mutation). The issue body is deterministic markdown.

- [ ] **Step 1: Write the failing tests**

Create `scripts/check-restaurants/report.test.ts`:

```ts
import { describe, expect, test } from 'vitest';

import {
  applyBackfills,
  applyClosures,
  buildIssueBody,
  imageFilesToDelete,
  serializeRestaurants,
} from './report';
import type { DiscoveredPlace, Restaurant } from './types';

const r = (over: Partial<Restaurant>): Restaurant => ({
  name: 'X',
  slug: 'x',
  website: 'https://x.com',
  onlineOrderUrl: 'https://x.com/order',
  ...over,
});

const d = (over: Partial<DiscoveredPlace>): DiscoveredPlace => ({
  placeId: 'p-new',
  name: 'New Spot',
  location: { lat: 38.8276, lng: -77.0641 },
  address: '2000 Mount Vernon Ave',
  website: 'https://newspot.com',
  businessStatus: 'OPERATIONAL',
  ...over,
});

describe('applyClosures', () => {
  test('removes closed entries, leaves the rest, does not mutate input', () => {
    const input = [r({ slug: 'keep' }), r({ slug: 'gone' })];
    const out = applyClosures(input, [r({ slug: 'gone' })]);
    expect(out.map(x => x.slug)).toEqual(['keep']);
    expect(input).toHaveLength(2);
  });
});

describe('applyBackfills', () => {
  test('sets placeId on matching slugs only', () => {
    const input = [r({ slug: 'a' }), r({ slug: 'b' })];
    const out = applyBackfills(input, [{ slug: 'b', placeId: 'p-b' }]);
    expect(out.find(x => x.slug === 'a')?.placeId).toBeUndefined();
    expect(out.find(x => x.slug === 'b')?.placeId).toBe('p-b');
  });
});

describe('imageFilesToDelete', () => {
  test('maps slugs to image paths', () => {
    expect(imageFilesToDelete([r({ slug: 'gone' })])).toEqual([
      'src/assets/images/gone.png',
    ]);
  });
});

describe('serializeRestaurants', () => {
  test('2-space indented JSON ending in a newline', () => {
    const out = serializeRestaurants([r({ slug: 'x' })]);
    expect(out.endsWith('\n')).toBe(true);
    expect(out).toContain('  "slug": "x"');
  });
});

describe('buildIssueBody', () => {
  test('includes addition name, website, slug suggestion, and placeId', () => {
    const body = buildIssueBody([d({ name: 'New Spot' })], []);
    expect(body).toContain('New Spot');
    expect(body).toContain('https://newspot.com');
    expect(body).toContain('new-spot');
    expect(body).toContain('p-new');
    expect(body).toContain('maps.google.com');
  });

  test('renders warnings section when present', () => {
    const body = buildIssueBody([], ['thai-peppers: verify manually.']);
    expect(body).toContain('Warnings');
    expect(body).toContain('thai-peppers: verify manually.');
  });

  test('states when there is nothing to add', () => {
    const body = buildIssueBody([], []);
    expect(body.toLowerCase()).toContain('no new');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test scripts/check-restaurants/report.test.ts`
Expected: FAIL with "Cannot find module './report'".

- [ ] **Step 3: Implement the reporter**

Create `scripts/check-restaurants/report.ts`:

```ts
import { slugify } from './diff';
import type { DiscoveredPlace, Restaurant } from './types';

export function applyClosures(
  restaurants: Restaurant[],
  closures: Restaurant[],
): Restaurant[] {
  const closedSlugs = new Set(closures.map(c => c.slug));
  return restaurants.filter(r => !closedSlugs.has(r.slug));
}

export function applyBackfills(
  restaurants: Restaurant[],
  backfills: Array<{ slug: string; placeId: string }>,
): Restaurant[] {
  const bySlug = new Map(backfills.map(b => [b.slug, b.placeId]));
  return restaurants.map(r => {
    const placeId = bySlug.get(r.slug);
    return placeId ? { ...r, placeId } : r;
  });
}

export function imageFilesToDelete(closures: Restaurant[]): string[] {
  return closures.map(c => `src/assets/images/${c.slug}.png`);
}

export function serializeRestaurants(restaurants: Restaurant[]): string {
  return `${JSON.stringify(restaurants, null, 2)}\n`;
}

export function buildIssueBody(
  additions: DiscoveredPlace[],
  warnings: string[],
): string {
  const lines: string[] = [];
  lines.push('## Restaurant directory check');
  lines.push('');

  if (additions.length === 0) {
    lines.push('No new restaurant candidates found.');
  } else {
    lines.push(`### ${additions.length} new candidate(s)`);
    lines.push('');
    lines.push(
      'Finish each by adding an `onlineOrderUrl` and a `<slug>.png` image.',
    );
    lines.push('');
    for (const a of additions) {
      const slug = slugify(a.name);
      const mapsUrl = `https://maps.google.com/?q=place_id:${a.placeId}`;
      lines.push(`- **${a.name}**`);
      lines.push(`  - Address: ${a.address}`);
      lines.push(`  - Website: ${a.website ?? '(none provided)'}`);
      lines.push(`  - Suggested slug: \`${slug}\``);
      lines.push(`  - placeId: \`${a.placeId}\``);
      lines.push(`  - Google Maps: ${mapsUrl}`);
    }
  }

  if (warnings.length > 0) {
    lines.push('');
    lines.push('### Warnings');
    lines.push('');
    for (const w of warnings) lines.push(`- ${w}`);
  }

  lines.push('');
  return lines.join('\n');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test scripts/check-restaurants/report.test.ts`
Expected: PASS, all reporter tests green.

- [ ] **Step 5: Commit**

```bash
git add scripts/check-restaurants/report.ts scripts/check-restaurants/report.test.ts
git commit -m "feat: add reporter builders for issue body + json mutation"
```

---

### Task 8: Orchestration

**Files:**
- Create: `scripts/check-restaurants/run.ts`
- Test: `scripts/check-restaurants/run.test.ts`

**Interfaces:**
- Consumes: `PlacesClient` from `./places-client`; `isWithinCorridor` from `./geo`; `diffRestaurants` from `./diff`; reporter builders from `./report`; config from `./config`; types from `./types`.
- Produces:
  - `interface Effects { readRestaurants(): Promise<Restaurant[]>; writeRestaurants(json: string): Promise<void>; deleteImages(paths: string[]): Promise<void>; reportIssue(body: string): Promise<void>; openClosurePr(removed: Restaurant[]): Promise<void>; log(msg: string): void }`
  - `interface RunResult { additions: number; closures: number; backfills: number; warnings: number; aborted: boolean }`
  - `run(client: PlacesClient, effects: Effects): Promise<RunResult>`

Flow: search → corridor-filter → fetch statuses for existing placeIds → guard (`< MIN_EXPECTED_RESULTS` ⇒ abort, no removals) → diff → apply backfills + closures, write JSON, delete images, open closure PR if any → always report issue.

- [ ] **Step 1: Write the failing tests**

Create `scripts/check-restaurants/run.test.ts`:

```ts
import { describe, expect, test, vi } from 'vitest';

import type { PlacesClient } from './places-client';
import { run, type Effects } from './run';
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test scripts/check-restaurants/run.test.ts`
Expected: FAIL with "Cannot find module './run'".

- [ ] **Step 3: Implement the orchestrator**

Create `scripts/check-restaurants/run.ts`:

```ts
import {
  CORRIDOR_END_BUFFER_METERS,
  CORRIDOR_WIDTH_METERS,
  MIN_EXPECTED_RESULTS,
  SEGMENT_END,
  SEGMENT_START,
} from './config';
import { diffRestaurants } from './diff';
import { isWithinCorridor } from './geo';
import type { PlacesClient } from './places-client';
import {
  applyBackfills,
  applyClosures,
  buildIssueBody,
  imageFilesToDelete,
  serializeRestaurants,
} from './report';
import type { BusinessStatus, Restaurant } from './types';

export interface Effects {
  readRestaurants(): Promise<Restaurant[]>;
  writeRestaurants(json: string): Promise<void>;
  deleteImages(paths: string[]): Promise<void>;
  reportIssue(body: string): Promise<void>;
  openClosurePr(removed: Restaurant[]): Promise<void>;
  log(msg: string): void;
}

export interface RunResult {
  additions: number;
  closures: number;
  backfills: number;
  warnings: number;
  aborted: boolean;
}

export async function run(
  client: PlacesClient,
  effects: Effects,
): Promise<RunResult> {
  const existing = await effects.readRestaurants();

  const raw = await client.searchNearby();
  const discovered = raw.filter(p =>
    isWithinCorridor(
      p.location,
      SEGMENT_START,
      SEGMENT_END,
      CORRIDOR_WIDTH_METERS,
      CORRIDOR_END_BUFFER_METERS,
    ),
  );
  effects.log(
    `Found ${raw.length} raw, ${discovered.length} within corridor.`,
  );

  if (discovered.length < MIN_EXPECTED_RESULTS) {
    effects.log(
      `Only ${discovered.length} corridor results (< ${MIN_EXPECTED_RESULTS}). Aborting without removals.`,
    );
    return {
      additions: 0,
      closures: 0,
      backfills: 0,
      warnings: 0,
      aborted: true,
    };
  }

  const statuses = new Map<string, BusinessStatus | 'NOT_FOUND'>();
  for (const r of existing) {
    if (r.placeId) statuses.set(r.placeId, await client.getPlaceStatus(r.placeId));
  }

  const diff = diffRestaurants(existing, discovered, statuses);

  let next = applyBackfills(existing, diff.backfills);
  if (diff.closures.length > 0) {
    next = applyClosures(next, diff.closures);
  }

  if (diff.backfills.length > 0 || diff.closures.length > 0) {
    await effects.writeRestaurants(serializeRestaurants(next));
  }
  if (diff.closures.length > 0) {
    await effects.deleteImages(imageFilesToDelete(diff.closures));
    await effects.openClosurePr(diff.closures);
  }

  await effects.reportIssue(buildIssueBody(diff.additions, diff.warnings));

  return {
    additions: diff.additions.length,
    closures: diff.closures.length,
    backfills: diff.backfills.length,
    warnings: diff.warnings.length,
    aborted: false,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test scripts/check-restaurants/run.test.ts`
Expected: PASS, all run tests green.

- [ ] **Step 5: Commit**

```bash
git add scripts/check-restaurants/run.ts scripts/check-restaurants/run.test.ts
git commit -m "feat: add orchestrator with corridor filter + safety guard"
```

---

### Task 9: Real effects + entrypoint

**Files:**
- Create: `scripts/check-restaurants/effects.ts`
- Create: `scripts/check-restaurants/main.ts`

**Interfaces:**
- Consumes: `Effects` from `./run`; `Restaurant` from `./types`; `createPlacesClient` from `./places-client`; `run` from `./run`.
- Produces: `createRealEffects(): Effects`; `main.ts` default executable entrypoint.

These perform real I/O (`node:fs/promises`, `child_process` `gh`), so they are covered by the end-to-end manual verification step rather than unit tests (mocking `gh` and the filesystem here would test the mocks, not behavior).

- [ ] **Step 1: Create the real effects**

Create `scripts/check-restaurants/effects.ts`:

```ts
import { execFile } from 'node:child_process';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';

import type { Effects } from './run';
import type { Restaurant } from './types';

const execFileAsync = promisify(execFile);

const DATA_PATH = 'src/data/restaurants.json';
const ISSUE_TITLE = 'Restaurant directory check';
const PR_BRANCH = 'bot/restaurant-closures';

async function gh(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('gh', args);
  return stdout.trim();
}

export function createRealEffects(): Effects {
  return {
    async readRestaurants(): Promise<Restaurant[]> {
      return JSON.parse(await readFile(DATA_PATH, 'utf8')) as Restaurant[];
    },

    async writeRestaurants(json: string): Promise<void> {
      await writeFile(DATA_PATH, json, 'utf8');
    },

    async deleteImages(paths: string[]): Promise<void> {
      for (const p of paths) await rm(p, { force: true });
    },

    async reportIssue(body: string): Promise<void> {
      // Reuse an open issue with our title if present; else create one.
      const existing = await gh([
        'issue',
        'list',
        '--state',
        'open',
        '--search',
        `${ISSUE_TITLE} in:title`,
        '--json',
        'number',
        '--jq',
        '.[0].number // empty',
      ]);
      if (existing) {
        await gh(['issue', 'comment', existing, '--body', body]);
      } else {
        await gh([
          'issue',
          'create',
          '--title',
          `${ISSUE_TITLE} (${new Date().toISOString().slice(0, 10)})`,
          '--body',
          body,
        ]);
      }
    },

    async openClosurePr(removed: Restaurant[]): Promise<void> {
      const names = removed.map(r => r.name).join(', ');
      await execFileAsync('git', ['checkout', '-B', PR_BRANCH]);
      await execFileAsync('git', ['add', '-A']);
      await execFileAsync('git', [
        'commit',
        '-m',
        `chore: remove permanently closed restaurants (${names})`,
      ]);
      await execFileAsync('git', ['push', '-f', 'origin', PR_BRANCH]);
      await gh([
        'pr',
        'create',
        '--title',
        `Remove closed restaurants: ${names}`,
        '--body',
        `Auto-detected as CLOSED_PERMANENTLY by the Places API:\n\n${removed
          .map(r => `- ${r.name} (\`${r.slug}\`)`)
          .join('\n')}`,
        '--head',
        PR_BRANCH,
      ]);
    },

    log(msg: string): void {
      console.log(msg);
    },
  };
}
```

- [ ] **Step 2: Create the entrypoint**

Create `scripts/check-restaurants/main.ts`:

```ts
import { createRealEffects } from './effects';
import { createPlacesClient } from './places-client';
import { run } from './run';

async function main(): Promise<void> {
  const apiKey = process.env['GOOGLE_PLACES_API_KEY'];
  if (!apiKey) {
    console.error('GOOGLE_PLACES_API_KEY is not set.');
    process.exit(1);
  }

  const client = createPlacesClient(apiKey);
  const effects = createRealEffects();
  const result = await run(client, effects);

  console.log(JSON.stringify(result));
  if (result.aborted) process.exit(1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 3: Type-check the whole script**

Run: `pnpm exec tsc --noEmit -p tsconfig.json`
Expected: no errors in `scripts/check-restaurants/`.

- [ ] **Step 4: Run the full test suite**

Run: `pnpm test`
Expected: PASS, all suites green.

- [ ] **Step 5: Commit**

```bash
git add scripts/check-restaurants/effects.ts scripts/check-restaurants/main.ts
git commit -m "feat: add real effects + entrypoint for restaurant check"
```

---

### Task 10: GitHub Action workflow

**Files:**
- Create: `.github/workflows/check-restaurants.yml`

**Interfaces:**
- Consumes: the `check:restaurants` npm script; repo secret `GOOGLE_PLACES_API_KEY`; built-in `GITHUB_TOKEN`.
- Produces: a scheduled + manually-dispatchable workflow.

- [ ] **Step 1: Create the workflow**

Create `.github/workflows/check-restaurants.yml`:

```yaml
name: Check restaurants

on:
  schedule:
    - cron: '0 13 * * 1' # Mondays 13:00 UTC
  workflow_dispatch:

permissions:
  contents: write
  issues: write
  pull-requests: write

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - name: Configure git identity
        run: |
          git config user.name "del-ray-eats-bot"
          git config user.email "bot@users.noreply.github.com"

      - name: Run restaurant check
        env:
          GOOGLE_PLACES_API_KEY: ${{ secrets.GOOGLE_PLACES_API_KEY }}
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: pnpm check:restaurants
```

- [ ] **Step 2: Validate the YAML parses**

Run: `pnpm exec tsx -e "import {readFileSync} from 'node:fs'; console.log(readFileSync('.github/workflows/check-restaurants.yml','utf8').length>0?'ok':'empty')"`
Expected: prints `ok` (sanity check the file exists and is readable; GitHub validates schema on push).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/check-restaurants.yml
git commit -m "ci: add scheduled restaurant check workflow"
```

---

### Task 11: First live run — backfill placeIds + manual verification

This task is **operational**, run by the human with real credentials. It produces the one-time `placeId` backfill and confirms the corridor/endpoints are calibrated.

**Files:**
- Modify: `src/data/restaurants.json` (gains `placeId` per entry)

- [ ] **Step 1: Set the API key locally**

```bash
export GOOGLE_PLACES_API_KEY=your-key-here
gh auth status   # confirm gh is logged in for issue/PR creation
```

- [ ] **Step 2: Verify the endpoint coordinates**

Open Google Maps. Confirm `SEGMENT_START` (Mount Vernon Ave ∩ E Braddock Rd) and `SEGMENT_END` (Mount Vernon Ave ∩ Commonwealth Ave) in `config.ts` match the real intersections; adjust if needed and re-run `pnpm test` so geo tests still pass.

- [ ] **Step 3: Dry-run the search to eyeball the corridor**

Run a one-off inspection (no writes) to confirm the corridor captures the known list and excludes neighbors:

```bash
pnpm exec tsx -e "import {createPlacesClient} from './scripts/check-restaurants/places-client.ts'; import {isWithinCorridor} from './scripts/check-restaurants/geo.ts'; import {SEGMENT_START,SEGMENT_END,CORRIDOR_WIDTH_METERS,CORRIDOR_END_BUFFER_METERS} from './scripts/check-restaurants/config.ts'; const c=createPlacesClient(process.env.GOOGLE_PLACES_API_KEY); const raw=await c.searchNearby(); const inC=raw.filter(p=>isWithinCorridor(p.location,SEGMENT_START,SEGMENT_END,CORRIDOR_WIDTH_METERS,CORRIDOR_END_BUFFER_METERS)); console.log('raw',raw.length,'corridor',inC.length); for(const p of inC) console.log(p.name,'|',p.address);"
```

Expected: the printed list should contain your known restaurants (Lena's, Junction, Del Ray Café, etc.) and not obvious far-off places. If too greedy/strict, tune `CORRIDOR_WIDTH_METERS` and re-run.

- [ ] **Step 4: Run the real check to backfill placeIds**

```bash
pnpm check:restaurants
```

This writes `placeId` onto matched entries in `restaurants.json` (backfills), opens the candidates issue, and opens a closures PR only if something is `CLOSED_PERMANENTLY`.

- [ ] **Step 5: Review the placeId backfill diff**

Run: `git diff src/data/restaurants.json`
Expected: each existing entry gains a plausible `placeId`. Manually resolve any entry that did NOT get one (look it up in Maps, add the `placeId` by hand). Verify the candidates issue and any closures PR look correct.

- [ ] **Step 6: Commit the backfill**

```bash
git add src/data/restaurants.json
git commit -m "data: backfill Google placeId for existing restaurants"
```

- [ ] **Step 7: Confirm the production build still works**

Run: `pnpm build`
Expected: build succeeds (the added `placeId` field does not affect `card.astro` or image resolution).

---

## Self-Review Notes

- **Spec coverage:** data source (Task 6), corridor geo incl. one-block east/west (Task 3 + config Task 4), `placeId` schema + backfill (Tasks 2, 5, 8, 11), closures→PR (Tasks 7–9), additions→Issue with auto-filled website (Tasks 7, 9), safety guards / min-results abort & `CLOSED_PERMANENTLY`-only removal (Tasks 5, 8), idempotent issue/PR (Task 9), vitest pure-core tests + mocked client (Tasks 1, 3, 5, 6, 7, 8), scheduled Action (Task 10), cost (no task needed — inherent). All spec sections map to a task.
- **Type consistency:** `Restaurant`, `DiscoveredPlace`, `LatLng`, `BusinessStatus` defined once in Task 2 and imported everywhere; `Effects`/`RunResult`/`PlacesClient`/`DiffResult` signatures match across Tasks 6, 8, 9.
- **Known limitations (documented, acceptable):** Nearby Search `maxResultCount` caps at 20; endpoint coords are approximate and verified in Task 11.
