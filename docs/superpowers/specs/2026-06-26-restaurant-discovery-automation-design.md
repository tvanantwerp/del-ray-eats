# Restaurant Discovery Automation — Design

**Date:** 2026-06-26
**Status:** Approved (design phase)

## Problem

`src/data/restaurants.json` is the single source of truth for Del Ray Eats, but it
is maintained by hand. The original list was collected by manually browsing Google
Maps for restaurants on the Mount Vernon Avenue strip in Del Ray, Alexandria VA,
between Braddock Road (south) and Commonwealth Avenue (north). The list drifts out
of date as restaurants open and close.

**Goal:** Automatically detect when a restaurant should be *added* (newly opened) or
*removed* (permanently closed) on this strip. Detection is the primary value;
full hands-off automation is desirable where it is safe.

## Scope & Priorities

- **Most important:** reliably knowing when to add a new restaurant or remove a closed one.
- **Closures** can be fully automated — removing a closed restaurant needs no manual enrichment.
- **Additions** inherently need a human touch: the `onlineOrderUrl` and the per-restaurant
  image cannot be sourced automatically. The Google-provided website *can* be auto-filled.

## Data Source

**Google Places API (New).** Chosen because its `business_status` field
(`OPERATIONAL` / `CLOSED_TEMPORARILY` / `CLOSED_PERMANENTLY`) directly answers the
"did it close?" question, and Nearby Search lets us query by location. Requires a
Google Cloud account with billing enabled; expected real cost is ~$0 given the tiny
query volume (well within the monthly free credit).

## Architecture

A single Node script (matches the existing pnpm/Node toolchain), executed by a
**scheduled GitHub Action** (weekly cron + manual `workflow_dispatch`). The API key
is stored in the repo secret `GOOGLE_PLACES_API_KEY`.

Each run:

1. **Fetch** current restaurants on the strip via Places **Nearby Search (New)**.
2. **Load** `src/data/restaurants.json`.
3. **Diff** the two sets by stable identity (`placeId`).
4. **Act** — open a PR for confirmed closures; open/update an Issue for new candidates.

The script is structured into three parts to isolate I/O from logic:

- **Places client** — the only part that touches the network; mockable in tests.
- **Pure diff/filter core** — no I/O. Corridor filtering, diffing, slug generation.
  Fully unit-testable.
- **Reporter** — writes the PR / Issue via the `gh` CLI or GitHub API.

## Geographic Scope — Corridor Filter

The strip is a line segment, not a circle, and must also include businesses up to
roughly one block east or west of the Avenue (e.g., Del Ray Café, which is just off
Mount Vernon Ave but belongs on the list).

Approach:

1. Geocode the two bounding intersections once: Braddock Rd ∩ Mount Vernon Ave (south
   endpoint) and Commonwealth Ave ∩ Mount Vernon Ave (north endpoint). These define a
   line segment.
2. Run Nearby Search over a circle that covers the whole strip, with a **broad type
   filter** (restaurant, cafe, bakery, coffee shop, bar, meal takeaway/delivery, etc.)
   — the existing list includes a bakery, a coffee pub, and a cheese shop.
3. **Keep** a result only if:
   - its **perpendicular distance to the segment is ≤ ~150m** (~one block), **and**
   - its **projection onto the segment falls between the two endpoints** (plus a small
     buffer at each end).

This is pure geometry (point-to-segment distance) — no address string matching — so it
is fully unit-testable. The corridor width and end buffer are **tunable constants** so
the filter can be widened or narrowed after observing the first run.

## Stable Identity — `placeId` Schema Addition

Matching JSON entries to Google results via fuzzy name matching is fragile (re-flagging
the same place as "new," or missing a closure). Instead, add a **`placeId`** field to
each entry in `restaurants.json` — Google's permanent business identifier.

- Closure detection becomes exact: query that `placeId`'s `business_status` directly.
- Duplicate "new" flags are prevented: a discovered place whose `placeId` is already in
  the data is not new.
- The change is **purely additive** — `card.astro` only consumes
  `name`/`slug`/`website`/`onlineOrderUrl` + the image, so nothing else changes.

**One-time backfill:** the first run fuzzy-matches each existing restaurant to its
`placeId` and proposes the assignments via a PR for human confirmation. After that,
`placeId` is the matching key.

## Outputs & Safety Guards

**Closures → Pull Request.** For each existing restaurant whose `placeId` reports
`business_status: CLOSED_PERMANENTLY`, the PR removes its entry from
`restaurants.json` and deletes its `src/assets/images/<slug>.png`. The PR body lists
each removal and the reason.

**New candidates → Issue.** Opens (or updates) a single issue listing each newly
discovered place with: name, address, Google-provided `website`, a Google Maps link,
the `placeId`, and a suggested `slug`. The human finishes `onlineOrderUrl` + image.

**Safety guards** (a bad API response must not destroy data):

- If the search returns 0 or implausibly few results, **abort** without proposing any
  removals.
- Only `CLOSED_PERMANENTLY` triggers removal. `CLOSED_TEMPORARILY`, or a place silently
  dropping out of results while still `OPERATIONAL`, is **reported in the issue, not
  auto-removed**.
- Issue/PR creation is **idempotent** — reuse the open issue / existing branch rather
  than stacking duplicates each week.

## Testing

- **Pure core** (corridor filter, diffing, slug generation) gets unit tests with fixture
  data via **vitest**. The project currently has no test setup; a minimal one is added.
- The Places client is **mocked** in tests — no live API calls in CI.

## Cost

~30 places, one Nearby Search plus a handful of Place Details calls, run weekly.
Comfortably within Google's monthly free credit — effectively $0.

## Out of Scope

- Automatic sourcing of `onlineOrderUrl` and per-restaurant images.
- Detecting changes other than open/close (e.g., renamed or relocated businesses) beyond
  what `placeId` + the new-candidate issue naturally surfaces.
