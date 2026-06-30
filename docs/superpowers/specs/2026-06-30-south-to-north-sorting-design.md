# South-to-North Restaurant Sorting — Design

**Date:** 2026-06-30
**Status:** Approved (design phase)

## Problem

`src/pages/index.astro` renders `restaurants.json` in raw array order. The list
was once hand-maintained roughly south-to-north (a proxy for proximity to the
maintainer's home at the south end of Del Ray), but newly added entries are now
appended to the end with no ordering. We want the page to display
south-to-north regardless of file order, and for new entries to slot into the
right place.

## Approach

Sort at **display time** by a stored per-entry coordinate (chosen over
physically reordering the file): the page is correct no matter how the file is
edited, and storing real lat/lng — rather than a single sort index — enables a
future client-side "sort by distance from me" feature.

## Data

Add an optional field to each `restaurants.json` entry (and the `Restaurant`
type in `scripts/check-restaurants/types.ts`):

```ts
location?: { lat: number; lng: number };
```

This is the same coordinate the check already obtains (`DiscoveredPlace.location`).

**One-time backfill:** a maintenance script `scripts/check-restaurants/backfill-locations.ts`
reads `restaurants.json`, and for each entry that has a `placeId` fetches the
place's `location` via Places **Place Details** (`GET .../v1/places/{placeId}`
with field mask `location`), writing `location: { lat, lng }`. Entries without a
`placeId` (the four likely-closed ones) get no location. The script reads
`GOOGLE_PLACES_API_KEY` from the environment (it does not load `.env` itself,
matching `check.ts`).

## Sorting

A pure, generic, testable helper `src/lib/sort-restaurants.ts`:

```ts
export function sortSouthToNorth<T extends { location?: { lat: number } }>(
  restaurants: T[],
): T[];
```

- Returns a new array (no mutation) sorted by `location.lat` **ascending**
  (south = lower latitude → north). The avenue runs essentially north–south, so
  latitude is an accurate proxy for "south-to-north" and keeps the site
  decoupled from the corridor-geometry module in `scripts/`.
- Entries **with no `location` sort to the end**, preserving their relative
  order (stable) so the closed-but-listed entries don't disrupt the list.

`index.astro` calls it before mapping:

```astro
const ordered = sortSouthToNorth(restaurants);
... ordered.map(restaurant => <Card restaurant={restaurant} />)
```

The generic structural type (`{ location?: { lat: number } }`) means the helper
does not import the full `Restaurant` type, keeping `src/` decoupled from
`scripts/`.

## Keeping new entries ordered

A newly added entry only sorts correctly if it has a `location`. Since additions
are human-curated via the discovery Issue (not auto-written), `buildIssueBody`
(`scripts/check-restaurants/report.ts`) will include each candidate's
coordinate, e.g. `Location: 38.8203, -77.0579`, so that when a restaurant is
added by hand its `location` can be filled in and it slots into place.

## Testing

- `src/lib/sort-restaurants.test.ts` (Vitest): sorts by latitude ascending;
  no-location entries go last and keep stable relative order; input not mutated.
  Extend the Vitest `include` glob to also cover `src/**/*.test.ts`.
- `report.test.ts`: `buildIssueBody` renders each addition's coordinate.
- `index.astro`: verified by `pnpm build` succeeding and producing the cards in
  south-to-north order.
- `backfill-locations.ts`: no unit test (network + file I/O); verified by a
  one-time run and inspecting the resulting `location` values.

## Out of Scope

- The client-side user-sortable UI (the stored coordinates enable it; building
  it is a separate future feature).
- Auto-adding discovered restaurants to `restaurants.json` (additions remain
  human-curated via the Issue).
- Geocoding the four `placeId`-less entries (they sort last until resolved).
