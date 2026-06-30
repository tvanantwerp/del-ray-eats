# Place ID Aliases & Ignore List — Design

**Date:** 2026-06-30
**Status:** Approved (design phase)

## Problem

A single directory entry can correspond to **multiple** Google Place IDs (e.g.
Gustave Boulangerie and "Gustave Le Jardin" are one business — same menu, just
indoor vs. outdoor seating — with two listings). Separately, the corridor
contains real Google places that are **never** directory entries (the 7-Eleven,
the lounges inside the Evening Star building, the event loft above Lena's,
meal-prep/ghost kitchens). The current model assumes one `placeId` per entry and
has nowhere to record "these IDs are the same business" or "this ID is not a
business I list." As a result the discovery automation re-proposes the same
duplicates and non-entries on every run, and closure detection can't reason
about a business that has more than one listing.

**Merge criterion is editorial, not automatic:** the decision to treat two
listings as one business is the maintainer's judgment ("is it really one
menu?"), informed by — but not determined by — a shared website. The data model
must *let the maintainer record* a merge; it must never merge on its own.

## Approach

Additive schema (chosen over a `placeId → placeIds[]` migration, which would
churn every existing entry, and over an external all-in-one meta file, which
would split each entry's identity away from the entry):

1. **`aliasPlaceIds` on entries** — an entry "owns" its primary `placeId` plus
   any IDs in an optional `aliasPlaceIds: string[]`.
2. **`src/data/ignored-places.json`** — a flat, self-documenting list of Place
   IDs that are permanently *not* directory entries.

## Schema

`Restaurant` (in `restaurants.json`) gains one optional field:

```jsonc
{
  "name": "Gustave Boulangerie",
  "slug": "gustave-boulangerie",
  "website": "https://gustaveboulangerie.com/",
  "onlineOrderUrl": "...",
  "placeId": "ChIJ_Yvbazext4kRUooIHHWoBZU",
  "aliasPlaceIds": ["ChIJf0KwLQCxt4kRZU45T9PdiQQ"]
}
```

New `src/data/ignored-places.json`:

```jsonc
[
  {
    "placeId": "ChIJLU9Yoh-xt4kRG2tbSActftg",
    "name": "7-Eleven",
    "reason": "convenience store, not a restaurant"
  }
]
```

New TypeScript types (`scripts/check-restaurants/types.ts`):

- `Restaurant` gains `aliasPlaceIds?: string[]`.
- `interface IgnoredPlace { placeId: string; name: string; reason: string }`.

## Matching & Closure Logic

`diffRestaurants` gains an `ignoredPlaceIds: Set<string>` parameter and changes
three behaviors:

- **Owned IDs:** for each entry, its *owned* set = `placeId` ∪ `aliasPlaceIds`.
  The union of all entries' owned sets is the set of "claimed" IDs.
- **Additions:** a discovered place is a new candidate only if its `placeId` is
  not claimed, not in `ignoredPlaceIds`, and not name-matched to an existing
  entry. This is what stops aliases, ignored places, and known businesses from
  being re-proposed.
- **Closure:** an entry is a removal candidate only if **every** owned ID for
  which we have a status reports `CLOSED_PERMANENTLY`. If any owned ID is
  `OPERATIONAL`, the business is open. A **partial** close (some owned IDs
  `CLOSED_PERMANENTLY`/`NOT_FOUND` while others operational) yields a *warning*,
  not a removal.
- **Backfill** is unchanged: an existing entry with no `placeId` is fuzzy-matched
  by name and assigned a primary `placeId`.

`runCheck` changes:

- **Status lookups** now cover each entry's primary **and** alias IDs (the
  status map is keyed by `placeId`).
- A new **`readIgnoredPlaces()`** dependency loads `ignored-places.json`;
  `runCheck` builds the `ignoredPlaceIds` set and passes it to `diffRestaurants`.
  Ignored places are still counted in `rawCount`/`corridorCount` (they are real
  corridor results) but never become additions.

The `CheckReport` is unchanged in shape; ignored/aliased places simply never
appear in `additions`.

## Affected Units

- `types.ts` — `aliasPlaceIds`, `IgnoredPlace`.
- `diff.ts` — owned-ID union, ignore filtering, multi-ID closure. Unit-tested.
- `run.ts` — alias status lookups, `readIgnoredPlaces` in `CheckDeps`, pass
  ignore set to diff. Unit-tested.
- `effects.ts` — `readIgnoredPlaces()` reading `src/data/ignored-places.json`.
- `check.ts` — wire `readIgnoredPlaces`.
- `src/data/ignored-places.json` — new data file (seeded, see below).

`card.astro` and the rendered site are unaffected by `aliasPlaceIds`/ignore
data.

## Data Application (one-time, part of this work)

**Gustave merge:**
- Delete the `gustave-le-jardin` entry (added earlier in this branch).
- Add `aliasPlaceIds: ["ChIJf0KwLQCxt4kRZU45T9PdiQQ"]` to `gustave-boulangerie`.

**Evening Star / Front Porch split** (different menus ⇒ separate entries):
- Rename the existing `evening-star` entry from "Evening Star / Front Porch" to
  **"Evening Star"** (slug stays `evening-star`, primary `placeId`
  `ChIJQTUpsx-xt4kRhuKYyACNrgI`, website `eveningstarcafe.net`). Its
  `onlineOrderUrl` becomes its website (the previous value was Front Porch's
  ordering app); keeps its existing `evening-star.png`.
- Add a new **"Front Porch"** entry: slug `front-porch`, website
  `http://frontporch.menu/`, `onlineOrderUrl` `https://app.frontporch.menu/`,
  `placeId` `ChIJR6Vjsh-xt4kRQlSlGMjaWXg`. Needs a `front-porch.png`
  (build stays red until added, consistent with the other pending new entries).

**Seed `ignored-places.json`** (7 entries):

| Place ID | Name | Reason |
|---|---|---|
| ChIJLU9Yoh-xt4kRG2tbSActftg | 7-Eleven | convenience store, not a restaurant |
| ChIJHzeoUh6xt4kRFlbivsqSUY8 | Majestic Lounge | bar inside Evening Star |
| ChIJKyknsx-xt4kRZM8qXq8X4Xk | No. 9 Lounge | bar inside Evening Star |
| ChIJfUSzgsSxt4kRm6M1A1CpOag | Havana 151 - The Loft at Lena's | event/loft space above Lena's |
| ChIJdT2PNcaxt4kRa5iz_1Ta3pU | Pattana Restaurant Group | management/umbrella entity, not a venue |
| ChIJHxdFbx6xt4kR10P_YIYGJew | Territory Foods | meal-prep/delivery, not a sit-down restaurant |
| ChIJZ9ekjXCxt4kRcswQFrKnQOs | Uncle Kebba's Lemonade | beverage vendor, not a restaurant |

After this, every corridor place is exactly one of: a directory entry's primary
ID, an entry's alias ID, an ignored ID, or a genuine new candidate.

## Testing

- `diff.ts`: unit tests for alias-suppressed additions, ignore-suppressed
  additions, all-owned-IDs-closed ⇒ closure, partial-close ⇒ warning.
- `run.ts`: unit tests that alias IDs get status lookups and that
  `ignoredPlaceIds` flows from `readIgnoredPlaces` into the diff.
- No live API calls in tests (mocked client, as before).

## Out of Scope

- Displaying sub-venue/alias details on a card (YAGNI — aliases are suppression
  only).
- Automatic merge inference from shared websites (merges remain a human edit).
- Supplying images / real order URLs for the new/split entries.
