# South-to-North Sorting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Display restaurants south-to-north by sorting `index.astro` on a stored per-entry `location` coordinate, backfilled from the Places API, with new candidates' coordinates surfaced in the discovery Issue.

**Architecture:** Add optional `location: { lat, lng }` to entries. A pure generic `sortSouthToNorth` helper (in `src/lib/`) sorts by latitude ascending (no-location entries last); `index.astro` applies it before rendering. A one-time `backfill-locations.ts` populates existing entries; `buildIssueBody` gains each candidate's coordinate.

**Tech Stack:** Astro 7, Tailwind 4, TypeScript (tsx), Vitest, Node 24, pnpm, Google Places API (New).

## Global Constraints

- pnpm; Node `>=22.12.0`; ESM; TypeScript `astro/tsconfigs/strictest` (noUncheckedIndexedAccess, noUnusedLocals). Prettier where it applies (note: `prettier` cannot parse `.astro` in this repo's CLI invocation — do NOT run prettier on `card.astro`/`index.astro`; format `.ts` files normally).
- `restaurants.json` single source of truth; `card.astro` unaffected. Build must stay green (`pnpm build` exit 0).
- Sort key is **latitude ascending**; entries without `location` sort **last**, stable.
- The helper stays decoupled from `scripts/` via a generic structural type (no `Restaurant` import).
- No live API calls in unit tests.

---

## File Structure

```
scripts/check-restaurants/
  types.ts            # + Restaurant.location?: { lat; lng }
  report.ts           # buildIssueBody: add a Location line per addition
  report.test.ts      # assert the coordinate renders
  backfill-locations.ts  # NEW one-time maintenance script
src/lib/
  sort-restaurants.ts      # NEW pure sortSouthToNorth helper
  sort-restaurants.test.ts # NEW
src/pages/index.astro   # sort before mapping
vitest.config.ts        # include src/**/*.test.ts
src/data/restaurants.json  # gains location on entries with a placeId (Task 3 run)
```

---

### Task 1: Sort helper, schema field, and index.astro

**Files:**
- Modify: `scripts/check-restaurants/types.ts`
- Modify: `vitest.config.ts`
- Create: `src/lib/sort-restaurants.ts`
- Create: `src/lib/sort-restaurants.test.ts`
- Modify: `src/pages/index.astro`

**Interfaces:**
- Produces:
  - `Restaurant` gains `location?: { lat: number; lng: number }`
  - `sortSouthToNorth<T extends { location?: { lat: number } }>(restaurants: T[]): T[]`

- [ ] **Step 1: Add the schema field**

In `scripts/check-restaurants/types.ts`, add to the `Restaurant` interface (after `aliasPlaceIds?`):

```ts
  location?: { lat: number; lng: number };
```

- [ ] **Step 2: Let Vitest find src tests**

In `vitest.config.ts`, change the `include` line to:

```ts
    include: ['scripts/**/*.test.ts', 'src/**/*.test.ts'],
```

- [ ] **Step 3: Write the failing sort test**

Create `src/lib/sort-restaurants.test.ts`:

```ts
import { describe, expect, test } from 'vitest';

import { sortSouthToNorth } from './sort-restaurants';

type Entry = { slug: string; location?: { lat: number } };

describe('sortSouthToNorth', () => {
  test('orders by latitude ascending (south to north)', () => {
    const input: Entry[] = [
      { slug: 'north', location: { lat: 38.83 } },
      { slug: 'south', location: { lat: 38.81 } },
      { slug: 'mid', location: { lat: 38.82 } },
    ];
    expect(sortSouthToNorth(input).map(e => e.slug)).toEqual([
      'south',
      'mid',
      'north',
    ]);
  });

  test('entries without a location sort last, in stable order', () => {
    const input: Entry[] = [
      { slug: 'a', location: { lat: 38.82 } },
      { slug: 'no1' },
      { slug: 'b', location: { lat: 38.81 } },
      { slug: 'no2' },
    ];
    expect(sortSouthToNorth(input).map(e => e.slug)).toEqual([
      'b',
      'a',
      'no1',
      'no2',
    ]);
  });

  test('does not mutate the input array', () => {
    const input: Entry[] = [
      { slug: 'a', location: { lat: 38.82 } },
      { slug: 'b', location: { lat: 38.81 } },
    ];
    const before = input.map(e => e.slug);
    sortSouthToNorth(input);
    expect(input.map(e => e.slug)).toEqual(before);
  });
});
```

- [ ] **Step 4: Run the test, verify it fails**

Run: `pnpm test src/lib/sort-restaurants.test.ts`
Expected: FAIL ("Cannot find module './sort-restaurants'").

- [ ] **Step 5: Implement the helper**

Create `src/lib/sort-restaurants.ts`:

```ts
export function sortSouthToNorth<T extends { location?: { lat: number } }>(
  restaurants: T[],
): T[] {
  return restaurants
    .map((restaurant, index) => ({ restaurant, index }))
    .sort((a, b) => {
      const aLat = a.restaurant.location?.lat;
      const bLat = b.restaurant.location?.lat;
      if (aLat === undefined && bLat === undefined) return a.index - b.index;
      if (aLat === undefined) return 1;
      if (bLat === undefined) return -1;
      if (aLat !== bLat) return aLat - bLat;
      return a.index - b.index;
    })
    .map(entry => entry.restaurant);
}
```

(The `index` tiebreaker makes the sort stable for equal/absent latitudes regardless of the engine's sort stability.)

- [ ] **Step 6: Run the test, verify it passes**

Run: `pnpm test src/lib/sort-restaurants.test.ts` → PASS.

- [ ] **Step 7: Apply the sort in index.astro**

Replace the frontmatter and the `restaurants.map(...)` call in `src/pages/index.astro`. The full new frontmatter:

```astro
---
import restaurants from '../data/restaurants.json';

import Card from '../components/card.astro';
import BaseLayout from '../layouts/base.astro';
import { sortSouthToNorth } from '../lib/sort-restaurants';

const ordered = sortSouthToNorth(restaurants);
---
```

And change the map from `restaurants.map(restaurant => (` to:

```astro
      ordered.map(restaurant => (
```

(Leave the `<li><Card .../></li>` body unchanged. Do not run prettier on this `.astro` file.)

- [ ] **Step 8: Verify the full suite, types, and build**

Run: `pnpm test` → PASS (now includes the new src test).
Run: `pnpm exec tsc --noEmit -p tsconfig.json` → clean.
Run: `pnpm build` → succeeds (exit 0). (Before Task 3 backfills coordinates, entries have no `location`, so all sort "last" and order is unchanged — that's expected; Task 3 makes the ordering take effect.)

- [ ] **Step 9: Commit**

```bash
pnpm exec prettier --write scripts/check-restaurants/types.ts vitest.config.ts src/lib/sort-restaurants.ts src/lib/sort-restaurants.test.ts
git add scripts/check-restaurants/types.ts vitest.config.ts src/lib/sort-restaurants.ts src/lib/sort-restaurants.test.ts src/pages/index.astro
git commit -m "feat: sort restaurants south-to-north by stored location"
```

---

### Task 2: Surface coordinates in the discovery Issue

**Files:**
- Modify: `scripts/check-restaurants/report.ts`
- Test: `scripts/check-restaurants/report.test.ts`

**Interfaces:**
- Consumes: `DiscoveredPlace.location` (existing `{ lat, lng }`).
- Produces: `buildIssueBody` output includes a `Location: <lat>, <lng>` line per addition (signature unchanged).

- [ ] **Step 1: Write the failing test**

In `scripts/check-restaurants/report.test.ts`, add to the `describe('buildIssueBody ...')` area (the `d(...)` factory already sets `location: { lat: 38.8276, lng: -77.0641 }`):

```ts
  test('includes each addition coordinate so new entries can be sorted', () => {
    const body = buildIssueBody(
      [d({ name: 'New Spot', location: { lat: 38.8203, lng: -77.0579 } })],
      [],
      [],
    );
    expect(body).toContain('38.8203');
    expect(body).toContain('-77.0579');
  });
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm test scripts/check-restaurants/report.test.ts`
Expected: FAIL (coordinate not in output).

- [ ] **Step 3: Add the Location line**

In `report.ts`, inside `buildIssueBody`'s additions loop, add a `Location` line right after the `Address` line:

```ts
      lines.push(`  - Address: ${a.address}`);
      lines.push(`  - Location: ${a.location.lat}, ${a.location.lng}`);
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `pnpm test scripts/check-restaurants/report.test.ts` → PASS.
Run: `pnpm test` → full suite PASS.
Run: `pnpm exec tsc --noEmit -p tsconfig.json` → clean.

- [ ] **Step 5: Commit**

```bash
pnpm exec prettier --write scripts/check-restaurants/report.ts scripts/check-restaurants/report.test.ts
git add scripts/check-restaurants/report.ts scripts/check-restaurants/report.test.ts
git commit -m "feat: include candidate coordinates in the discovery issue"
```

---

### Task 3: Location backfill script (+ one-time run)

**Files:**
- Create: `scripts/check-restaurants/backfill-locations.ts`
- Modify (by running the script): `src/data/restaurants.json`

**Interfaces:**
- Consumes: `Restaurant` (now with `location?`), `GOOGLE_PLACES_API_KEY`.
- Produces: a runnable maintenance script; populated `location` on entries.

No unit test (network + file I/O); verified by `tsc` and a one-time run.

- [ ] **Step 1: Create the backfill script**

Create `scripts/check-restaurants/backfill-locations.ts`:

```ts
import { readFile, writeFile } from 'node:fs/promises';

import type { Restaurant } from './types';

const DATA_PATH = 'src/data/restaurants.json';
const DETAILS_URL = 'https://places.googleapis.com/v1/places';

async function main(): Promise<void> {
  const apiKey = process.env['GOOGLE_PLACES_API_KEY'];
  if (!apiKey) {
    console.error('GOOGLE_PLACES_API_KEY is not set.');
    process.exit(1);
  }

  const restaurants = JSON.parse(
    await readFile(DATA_PATH, 'utf8'),
  ) as Restaurant[];

  let updated = 0;
  for (const r of restaurants) {
    if (!r.placeId) continue;
    const res = await fetch(`${DETAILS_URL}/${r.placeId}`, {
      headers: { 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': 'location' },
    });
    if (!res.ok) {
      console.warn(`Skipping ${r.slug} (${r.placeId}): HTTP ${res.status}`);
      continue;
    }
    const data = (await res.json()) as {
      location?: { latitude: number; longitude: number };
    };
    if (data.location) {
      r.location = { lat: data.location.latitude, lng: data.location.longitude };
      updated += 1;
    }
  }

  await writeFile(DATA_PATH, `${JSON.stringify(restaurants, null, 2)}\n`, 'utf8');
  const missing = restaurants.filter(r => !r.location).map(r => r.slug);
  console.log(`Updated location for ${updated} entries.`);
  console.log(`Entries still without location (${missing.length}): ${missing.join(', ')}`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Type-check**

Run: `pnpm exec tsc --noEmit -p tsconfig.json` → clean.
Run: `pnpm test` → full suite still PASS (no test changes).

- [ ] **Step 3: Commit the script**

```bash
pnpm exec prettier --write scripts/check-restaurants/backfill-locations.ts
git add scripts/check-restaurants/backfill-locations.ts
git commit -m "feat: add one-time location backfill maintenance script"
```

- [ ] **Step 4 (OPERATIONAL — run by the controller/human with the API key):** Populate locations

This step needs `GOOGLE_PLACES_API_KEY` and is not run by a subagent. With the key in the environment:

```bash
pnpm exec tsx scripts/check-restaurants/backfill-locations.ts
```

Expected: `Updated location for ~35 entries.` and a "still without location" list of the four `placeId`-less entries (`benny-diforzas, french-toast-dmv, zuki-moon, thai-peppers`).

- [ ] **Step 5: Verify the sort now takes effect, then commit the data**

Run: `pnpm exec prettier --check src/data/restaurants.json` (run `--write` if needed).
Run: `pnpm build` → succeeds. Spot-check `dist/index.html`: card order runs south (e.g. South China / Bella Napoli near Braddock) to north (e.g. Stracci / Los Tios near Commonwealth).

```bash
git add src/data/restaurants.json
git commit -m "data: backfill restaurant coordinates for south-to-north sorting"
```

---

## Self-Review Notes

- Spec coverage: `location?` field (Task 1 Step 1); generic `sortSouthToNorth` by latitude asc with no-location-last + stable (Task 1 Steps 3,5); `index.astro` applies it (Step 7); Vitest covers `src` (Step 2); coordinates in the Issue (Task 2); `backfill-locations.ts` + run (Task 3). All spec sections map to tasks.
- Placeholder scan: every step has concrete code/commands; no TBDs.
- Type consistency: `sortSouthToNorth<T extends { location?: { lat: number } }>` used identically in helper, test, and `index.astro`; `Restaurant.location` shape `{ lat; lng }` matches the backfill script's writes and `DiscoveredPlace.location`.
- Note: `prettier` is intentionally not run on the two `.astro` files (its CLI cannot infer a parser for them here); their changes are validated by `pnpm build`.
