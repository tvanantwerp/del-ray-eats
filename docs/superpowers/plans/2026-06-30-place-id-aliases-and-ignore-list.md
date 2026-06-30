# Place ID Aliases & Ignore List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let one directory entry own multiple Google Place IDs (`aliasPlaceIds`) and let a `src/data/ignored-places.json` suppress non-entry listings, so the discovery diff stops re-proposing duplicates/non-businesses and closure reasons across all of a business's listings.

**Architecture:** Additive schema (`aliasPlaceIds?` on `Restaurant`, new `IgnoredPlace` type + data file). `diffRestaurants` gains an `ignoredPlaceIds` set, treats each entry's `placeId ∪ aliasPlaceIds` as its owned IDs (suppressing aliases from additions; closing only when all owned IDs are permanently closed), and skips ignored IDs. `runCheck` fetches status for alias IDs and loads the ignore list via a new `readIgnoredPlaces` dependency. Then a one-time data edit applies the Gustave merge and the Evening Star / Front Porch split.

**Tech Stack:** TypeScript (tsx), Vitest, ESM, Node 24, pnpm.

## Global Constraints

- pnpm; latest versions. Node `>=22.12.0`, ESM, `astro/tsconfigs/strictest` (noUncheckedIndexedAccess, noUnusedLocals). Prettier: single quotes, semicolons, 2-space, trailing commas, arrowParens avoid — run `pnpm exec prettier --write` on changed files.
- `src/data/restaurants.json` is the single source of truth; `card.astro` and the rendered site are unaffected by `aliasPlaceIds`/ignore data.
- Merges are recorded by humans, never inferred automatically.
- Closure: an entry is a removal candidate only if EVERY owned ID (primary + aliases) that has a status is `CLOSED_PERMANENTLY`. A partial close ⇒ warning, not removal.
- Additions exclude: any entry's primary or alias ID, any ID in `ignored-places.json`, and name-matched places (existing 0.6 threshold).
- No live API calls in tests (mocked client).
- The build is already red (new entries pending images); this plan does not fix that and must not regress it further than the spec's documented Front Porch image.

---

## File Structure

```
scripts/check-restaurants/
  types.ts        # + Restaurant.aliasPlaceIds?, + IgnoredPlace
  diff.ts         # diffRestaurants gains ignoredPlaceIds; owned-ID union; multi-ID closure
  diff.test.ts    # 4th arg on existing calls + new alias/ignore/closure tests
  run.ts          # alias status lookups; readIgnoredPlaces in CheckDeps; pass ignore set
  run.test.ts     # deps gains readIgnoredPlaces; alias-lookup + ignore-flow tests
  effects.ts      # + readIgnoredPlaces() reading ignored-places.json
  check.ts        # wire readIgnoredPlaces into runCheck deps
src/data/
  ignored-places.json   # NEW, seeded with 7 non-entries
  restaurants.json      # Gustave merge + Evening Star/Front Porch split
```

---

### Task 1: Schema + diff logic

**Files:**
- Modify: `scripts/check-restaurants/types.ts`
- Modify: `scripts/check-restaurants/diff.ts`
- Test: `scripts/check-restaurants/diff.test.ts`

**Interfaces:**
- Produces:
  - `Restaurant` gains `aliasPlaceIds?: string[]`
  - `interface IgnoredPlace { placeId: string; name: string; reason: string }`
  - `diffRestaurants(existing: Restaurant[], discovered: DiscoveredPlace[], existingStatuses: Map<string, BusinessStatus | 'NOT_FOUND'>, ignoredPlaceIds: Set<string>): DiffResult` (added 4th param)

- [ ] **Step 1: Add the types**

In `types.ts`, add `aliasPlaceIds?: string[];` to the `Restaurant` interface (after `placeId`), and append:

```ts
export interface IgnoredPlace {
  placeId: string;
  name: string;
  reason: string;
}
```

- [ ] **Step 2: Write the failing tests**

In `diff.test.ts`, first add `new Set<string>()` as the 4th argument to EVERY existing `diffRestaurants(...)` call (they currently pass 3 args). Then add this block after the existing `describe('diffRestaurants', ...)`:

```ts
describe('diffRestaurants aliases + ignore', () => {
  test('an alias placeId is not proposed as a new addition', () => {
    const existing = [
      restaurant({ slug: 'gustave', placeId: 'p-main', aliasPlaceIds: ['p-alias'] }),
    ];
    const discovered = [
      place({ placeId: 'p-main', name: 'Gustave' }),
      place({ placeId: 'p-alias', name: 'Gustave Le Jardin' }),
    ];
    const statuses = new Map<string, BusinessStatus | 'NOT_FOUND'>([
      ['p-main', 'OPERATIONAL'],
      ['p-alias', 'OPERATIONAL'],
    ]);
    const result = diffRestaurants(existing, discovered, statuses, new Set());
    expect(result.additions).toEqual([]);
  });

  test('an ignored placeId is not proposed as a new addition', () => {
    const discovered = [place({ placeId: 'p-ign', name: '7-Eleven' })];
    const result = diffRestaurants(
      [],
      discovered,
      new Map(),
      new Set(['p-ign']),
    );
    expect(result.additions).toEqual([]);
  });

  test('closure only when all owned IDs are permanently closed', () => {
    const existing = [
      restaurant({ slug: 'gustave', placeId: 'p-a', aliasPlaceIds: ['p-b'] }),
    ];
    const statuses = new Map<string, BusinessStatus | 'NOT_FOUND'>([
      ['p-a', 'CLOSED_PERMANENTLY'],
      ['p-b', 'CLOSED_PERMANENTLY'],
    ]);
    const result = diffRestaurants(existing, [], statuses, new Set());
    expect(result.closures.map(r => r.slug)).toEqual(['gustave']);
  });

  test('a partial close warns instead of removing', () => {
    const existing = [
      restaurant({ slug: 'gustave', placeId: 'p-a', aliasPlaceIds: ['p-b'] }),
    ];
    const statuses = new Map<string, BusinessStatus | 'NOT_FOUND'>([
      ['p-a', 'CLOSED_PERMANENTLY'],
      ['p-b', 'OPERATIONAL'],
    ]);
    const result = diffRestaurants(existing, [], statuses, new Set());
    expect(result.closures).toEqual([]);
    expect(result.warnings.some(w => w.includes('gustave'))).toBe(true);
  });
});
```

- [ ] **Step 3: Run tests, verify they fail**

Run: `pnpm test scripts/check-restaurants/diff.test.ts`
Expected: FAIL (4th arg type / new behaviors).

- [ ] **Step 4: Implement the diff changes**

Replace `diffRestaurants` and add the `ownedPlaceIds` helper in `diff.ts`. Keep `slugify`, `normalizeName`, `tokens`, `nameSimilarity`, `DiffResult`, and the constants as they are. The new code:

```ts
function ownedPlaceIds(r: Restaurant): string[] {
  return [r.placeId, ...(r.aliasPlaceIds ?? [])].filter(
    (id): id is string => Boolean(id),
  );
}

export function diffRestaurants(
  existing: Restaurant[],
  discovered: DiscoveredPlace[],
  existingStatuses: Map<string, BusinessStatus | 'NOT_FOUND'>,
  ignoredPlaceIds: Set<string>,
): DiffResult {
  const result: DiffResult = {
    additions: [],
    closures: [],
    backfills: [],
    warnings: [],
  };

  const knownPlaceIds = new Set<string>();
  for (const r of existing) {
    for (const id of ownedPlaceIds(r)) knownPlaceIds.add(id);
  }

  const matchedDiscoveredIds = new Set<string>();
  const candidates = discovered.filter(d => !ignoredPlaceIds.has(d.placeId));

  // Backfill placeIds for existing entries that lack one, via name match.
  for (const r of existing) {
    if (r.placeId) continue;
    let best: { place: DiscoveredPlace; score: number } | null = null;
    for (const d of candidates) {
      const score = nameSimilarity(r.name, d.name);
      if (!best || score > best.score) best = { place: d, score };
    }
    if (best && best.score >= NAME_MATCH_THRESHOLD) {
      result.backfills.push({ slug: r.slug, placeId: best.place.placeId });
      knownPlaceIds.add(best.place.placeId);
      matchedDiscoveredIds.add(best.place.placeId);
    }
  }

  // Closures + warnings, across each entry's owned (primary + alias) IDs.
  for (const r of existing) {
    const owned = ownedPlaceIds(r);
    if (owned.length === 0) continue;
    const known = owned
      .map(id => existingStatuses.get(id))
      .filter((s): s is BusinessStatus | 'NOT_FOUND' => s !== undefined);

    if (known.length > 0 && known.every(s => s === 'CLOSED_PERMANENTLY')) {
      result.closures.push(r);
    } else if (known.some(s => s === 'CLOSED_PERMANENTLY')) {
      result.warnings.push(
        `${r.slug}: some listings permanently closed but others still active — verify manually.`,
      );
    } else if (known.some(s => s === 'CLOSED_TEMPORARILY')) {
      result.warnings.push(
        `${r.slug}: reported CLOSED_TEMPORARILY — not removing, verify manually.`,
      );
    } else if (known.some(s => s === 'NOT_FOUND')) {
      result.warnings.push(
        `${r.slug}: a placeId was not found by Places — verify manually.`,
      );
    } else if (!owned.some(id => discovered.some(d => d.placeId === id))) {
      result.warnings.push(
        `${r.slug}: operational but absent from corridor search — verify it has not moved.`,
      );
    }
  }

  // Additions: candidate places not owned/matched and not name-matched.
  for (const d of candidates) {
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

- [ ] **Step 5: Run tests, verify pass**

Run: `pnpm test scripts/check-restaurants/diff.test.ts` → PASS.
Run: `pnpm exec tsc --noEmit -p tsconfig.json` — expect ONE error in `run.ts` (its `diffRestaurants` call still passes 3 args); this is fixed in Task 2. No other errors. Report it.

- [ ] **Step 6: Commit**

```bash
pnpm exec prettier --write scripts/check-restaurants/types.ts scripts/check-restaurants/diff.ts scripts/check-restaurants/diff.test.ts
git add scripts/check-restaurants/types.ts scripts/check-restaurants/diff.ts scripts/check-restaurants/diff.test.ts
git commit -m "feat: aliasPlaceIds + ignore set in diffRestaurants (owned-ID closure)"
```

---

### Task 2: runCheck — alias status lookups + ignore list dependency

**Files:**
- Modify: `scripts/check-restaurants/run.ts`
- Test: `scripts/check-restaurants/run.test.ts`

**Interfaces:**
- Consumes: `diffRestaurants(..., ignoredPlaceIds)` (Task 1), `IgnoredPlace` (types).
- Produces:
  - `CheckDeps` gains `readIgnoredPlaces(): Promise<IgnoredPlace[]>`
  - `runCheck` fetches status for primary + alias IDs and passes an ignore set to the diff.

- [ ] **Step 1: Update run.test.ts (failing)**

In `run.test.ts`, the `runCheck` `deps` helper currently returns `{ readRestaurants, log }`. Add `readIgnoredPlaces: async () => []` to it:

```ts
  const deps = (existing: Restaurant[], ignored: IgnoredPlace[] = []) => ({
    readRestaurants: async () => existing,
    readIgnoredPlaces: async () => ignored,
    log: () => {},
  });
```

Add `IgnoredPlace` to the type import from `./types`. Then add these tests inside `describe('runCheck', ...)`:

```ts
  test('fetches status for alias IDs as well as the primary', async () => {
    const queried: string[] = [];
    const client: PlacesClient = {
      searchNearby: async () => padPlaces(12),
      getPlaceStatus: async id => {
        queried.push(id);
        return 'OPERATIONAL';
      },
    };
    const existing: Restaurant[] = [
      {
        name: 'Gustave',
        slug: 'gustave',
        website: '',
        onlineOrderUrl: '',
        placeId: 'p-main',
        aliasPlaceIds: ['p-alias'],
      },
    ];
    await runCheck(client, deps(existing));
    expect(queried).toContain('p-main');
    expect(queried).toContain('p-alias');
  });

  test('ignored places never appear as additions', async () => {
    const client = fakeClient(
      [...padPlaces(12), place({ placeId: 'p-ign', name: 'Ignore Me' })],
      {},
    );
    const ignored: IgnoredPlace[] = [
      { placeId: 'p-ign', name: 'Ignore Me', reason: 'test' },
    ];
    const report = await runCheck(client, deps([], ignored));
    expect(report.additions.map(a => a.placeId)).not.toContain('p-ign');
  });
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `pnpm test scripts/check-restaurants/run.test.ts`
Expected: FAIL (`readIgnoredPlaces` not used yet / alias IDs not queried).

- [ ] **Step 3: Implement run.ts changes**

Add `IgnoredPlace` to the type import from `./types`. Change `CheckDeps`:

```ts
export interface CheckDeps {
  readRestaurants(): Promise<Restaurant[]>;
  readIgnoredPlaces(): Promise<IgnoredPlace[]>;
  log(msg: string): void;
}
```

In `runCheck`, replace the status-lookup loop and the `diffRestaurants` call (the block from `const statuses = ...` through `const diff = ...`) with:

```ts
  const statuses = new Map<string, BusinessStatus | 'NOT_FOUND'>();
  for (const r of existing) {
    for (const id of [r.placeId, ...(r.aliasPlaceIds ?? [])]) {
      if (id && !statuses.has(id)) {
        statuses.set(id, await client.getPlaceStatus(id));
      }
    }
  }

  const ignored = await deps.readIgnoredPlaces();
  const ignoredPlaceIds = new Set(ignored.map(i => i.placeId));

  const diff = diffRestaurants(existing, corridor, statuses, ignoredPlaceIds);
```

(The `unmatchedExisting` computation and the `return` below it are unchanged.)

- [ ] **Step 4: Run tests, verify pass**

Run: `pnpm test scripts/check-restaurants/run.test.ts` → PASS.
Run: `pnpm test` → full suite PASS.
Run: `pnpm exec tsc --noEmit -p tsconfig.json` — expect ONE error in `check.ts` (its `runCheck` deps lack `readIgnoredPlaces`); fixed in Task 3. No other errors.

- [ ] **Step 5: Commit**

```bash
pnpm exec prettier --write scripts/check-restaurants/run.ts scripts/check-restaurants/run.test.ts
git add scripts/check-restaurants/run.ts scripts/check-restaurants/run.test.ts
git commit -m "feat: runCheck fetches alias statuses and loads the ignore list"
```

---

### Task 3: Ignore-list data file + effects reader + check wiring

**Files:**
- Create: `src/data/ignored-places.json`
- Modify: `scripts/check-restaurants/effects.ts`
- Modify: `scripts/check-restaurants/check.ts`

**Interfaces:**
- Consumes: `IgnoredPlace` (types), `CheckDeps.readIgnoredPlaces` (Task 2).
- Produces: `export async function readIgnoredPlaces(): Promise<IgnoredPlace[]>` in `effects.ts`.

No unit tests (file I/O + entrypoint); verified by tsc + the full suite.

- [ ] **Step 1: Create the seeded ignore file**

Create `src/data/ignored-places.json`:

```json
[
  {
    "placeId": "ChIJLU9Yoh-xt4kRG2tbSActftg",
    "name": "7-Eleven",
    "reason": "convenience store, not a restaurant"
  },
  {
    "placeId": "ChIJHzeoUh6xt4kRFlbivsqSUY8",
    "name": "Majestic Lounge",
    "reason": "bar inside Evening Star"
  },
  {
    "placeId": "ChIJKyknsx-xt4kRZM8qXq8X4Xk",
    "name": "No. 9 Lounge",
    "reason": "bar inside Evening Star"
  },
  {
    "placeId": "ChIJfUSzgsSxt4kRm6M1A1CpOag",
    "name": "Havana 151 - The Loft at Lena's",
    "reason": "event/loft space above Lena's"
  },
  {
    "placeId": "ChIJdT2PNcaxt4kRa5iz_1Ta3pU",
    "name": "Pattana Restaurant Group",
    "reason": "management/umbrella entity, not a venue"
  },
  {
    "placeId": "ChIJHxdFbx6xt4kR10P_YIYGJew",
    "name": "Territory Foods",
    "reason": "meal-prep/delivery, not a sit-down restaurant"
  },
  {
    "placeId": "ChIJZ9ekjXCxt4kRcswQFrKnQOs",
    "name": "Uncle Kebba's Lemonade",
    "reason": "beverage vendor, not a restaurant"
  }
]
```

- [ ] **Step 2: Add the reader to effects.ts**

In `effects.ts`, add `IgnoredPlace` to the type import from `./types`, add a path constant next to `DATA_PATH`:

```ts
const IGNORED_PATH = 'src/data/ignored-places.json';
```

and export, next to `readRestaurants`:

```ts
export async function readIgnoredPlaces(): Promise<IgnoredPlace[]> {
  return JSON.parse(await readFile(IGNORED_PATH, 'utf8')) as IgnoredPlace[];
}
```

- [ ] **Step 3: Wire it into check.ts**

In `check.ts`, change the effects import to include `readIgnoredPlaces`:

```ts
import { readIgnoredPlaces, readRestaurants } from './effects';
```

and add it to the `runCheck` deps object:

```ts
  const report = await runCheck(client, {
    readRestaurants,
    readIgnoredPlaces,
    log: msg => console.error(msg),
  });
```

- [ ] **Step 4: Verify**

Run: `pnpm exec tsc --noEmit -p tsconfig.json` → CLEAN (the check.ts error from Task 2 is resolved; no others).
Run: `pnpm test` → full suite PASS.
Run: `node -e "JSON.parse(require('fs').readFileSync('src/data/ignored-places.json','utf8')); console.log('valid json')"` → prints `valid json`.

- [ ] **Step 5: Commit**

```bash
pnpm exec prettier --write scripts/check-restaurants/effects.ts scripts/check-restaurants/check.ts src/data/ignored-places.json
git add src/data/ignored-places.json scripts/check-restaurants/effects.ts scripts/check-restaurants/check.ts
git commit -m "feat: seed ignored-places.json and load it in the check"
```

---

### Task 4: Data application — Gustave merge + Evening Star / Front Porch split

**Files:**
- Modify: `src/data/restaurants.json`

No code; a data edit verified by JSON validity, prettier, and assertions.

- [ ] **Step 1: Apply the data changes**

Run this script (it performs all four edits deterministically):

```bash
node -e '
const fs = require("fs");
const path = "src/data/restaurants.json";
const arr = JSON.parse(fs.readFileSync(path, "utf8"));

// 1. Gustave merge: remove the gustave-le-jardin entry...
const LE_JARDIN = "ChIJf0KwLQCxt4kRZU45T9PdiQQ";
const filtered = arr.filter(e => e.slug !== "gustave-le-jardin");
// ...and alias its placeId onto gustave-boulangerie.
const gustave = filtered.find(e => e.slug === "gustave-boulangerie");
if (!gustave) throw new Error("gustave-boulangerie not found");
gustave.aliasPlaceIds = [LE_JARDIN];

// 2. Evening Star: rename the combined entry to just Evening Star, and point
//    its order link at its own site (the old value was Front Porch's).
const es = filtered.find(e => e.slug === "evening-star");
if (!es) throw new Error("evening-star not found");
es.name = "Evening Star";
es.onlineOrderUrl = "https://www.eveningstarcafe.net/";

// 3. Add Front Porch as its own entry.
filtered.push({
  name: "The Front Porch",
  slug: "front-porch",
  website: "http://frontporch.menu/",
  onlineOrderUrl: "https://app.frontporch.menu/",
  placeId: "ChIJR6Vjsh-xt4kRQlSlGMjaWXg",
});

fs.writeFileSync(path, JSON.stringify(filtered, null, 2) + "\n");
console.log("entries:", filtered.length);
console.log("gustave aliasPlaceIds:", JSON.stringify(gustave.aliasPlaceIds));
console.log("evening-star name:", es.name);
console.log("has front-porch:", filtered.some(e => e.slug === "front-porch"));
'
```

Expected output:
```
entries: 39
gustave aliasPlaceIds: ["ChIJf0KwLQCxt4kRZU45T9PdiQQ"]
evening-star name: Evening Star
has front-porch: true
```

(Pre-task count is 39; this removes `gustave-le-jardin` and adds `front-porch`, so the net stays 39.)

- [ ] **Step 2: Verify JSON + formatting**

Run: `pnpm exec prettier --check src/data/restaurants.json`
Expected: `All matched files use Prettier code style!` (if it reports a style issue, run `pnpm exec prettier --write src/data/restaurants.json`).

Run: `pnpm test` → full suite still PASS (no code changed).

- [ ] **Step 3: Confirm the build state is as expected (still red on images only)**

Run: `pnpm build 2>&1 | grep -i "No image" | head -3`
Expected: the only build errors are missing `<slug>.png` images (now including `front-porch.png`, no longer `gustave-le-jardin.png`). This is the documented, pre-existing red-build state — NOT a regression from this task.

- [ ] **Step 4: Commit**

```bash
git add src/data/restaurants.json
git commit -m "data: merge Gustave Le Jardin as alias; split Evening Star / Front Porch"
```

---

## Manual verification (human, after Task 4)

These need the live API key and are not run by subagents:

- [ ] Run a live read-only check (from the worktree, `.env` loaded): `pnpm restaurants:check`.
  - **Additions** should now be ~0 (every corridor place is an entry's primary ID, an alias, ignored, or name-matched).
  - **Backfills** should be 0 (all listed entries already have a `placeId`).
  - **Unmatched existing** should be the four likely-closed entries (Benny Diforza's, French Toast DMV, Zuki Moon, Thai Peppers).
  - No 7-Eleven / lounges / Le Jardin / Havana 151 in additions.

---

## Self-Review Notes

- Spec coverage: `aliasPlaceIds` + `IgnoredPlace` (Task 1); additions exclude alias/ignored, multi-ID closure, partial-close warning (Task 1); alias status lookups + `readIgnoredPlaces` dep (Task 2); `ignored-places.json` seeded with the 7 listed IDs + effects reader + check wiring (Task 3); Gustave merge + Evening Star/Front Porch split with the exact IDs and order-URL change (Task 4). All spec sections map to a task.
- Type consistency: `diffRestaurants` 4-arg signature defined in Task 1 and called with 4 args in Task 2; `CheckDeps.readIgnoredPlaces` defined in Task 2, implemented in Task 3; `IgnoredPlace` defined in Task 1, used in Tasks 2–3.
- Interim tsc errors are documented and expected (Task 1 → run.ts; Task 2 → check.ts), resolved by the following task — same pattern as the prior split.
- The red build (missing images) is pre-existing and explicitly preserved, not introduced here.
