# Split Check and Apply Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Split the restaurant-check script into a read-only **detection** entrypoint (`check`) that emits a JSON report + human summary, and an **action** entrypoint (`apply`) that consumes the report to create the Issue/PRs — so the detection half can be run and inspected without side effects.

**Architecture:** Refactor `run()` into `runCheck(client, deps) → CheckReport` (read-only) and `runApply(report, effects) → ApplyResult` (side effects). Add a `CheckReport` type, a pure `summarizeReport()` printer, and two entrypoints `check.ts` / `apply.ts`. Reuse all existing modules (`diff`, `geo`, `places-client`, `report`, `effects`, `config`). Update the workflow to run check → apply as two steps.

**Tech Stack:** TypeScript (tsx), Vitest, ESM, Node 24, pnpm, GitHub Actions, `gh` CLI.

## Global Constraints

- pnpm; latest versions. Node `>=22.12.0`, ESM, `astro/tsconfigs/strictest` (noUncheckedIndexedAccess, noUnusedLocals). Prettier: single quotes, semicolons, 2-space, trailing commas, arrowParens avoid — run `pnpm exec prettier --write` on changed files.
- `src/data/restaurants.json` single source of truth; `placeId` optional; `card.astro` untouched.
- Detection (`check`) performs NO writes/deletes/`gh`. Action (`apply`) performs NO Google API calls.
- Safety guard unchanged: corridor matches `< MIN_EXPECTED_RESULTS` ⇒ `aborted: true`, no action.
- Only `CLOSED_PERMANENTLY` ⇒ removal (lives in `diffRestaurants`).
- The report file `restaurant-check-report.json` is gitignored.

---

## File Structure

```
scripts/check-restaurants/
  types.ts          # + CheckReport
  report.ts         # + summarizeReport(); buildIssueBody() gains unmatchedExisting section
  report.test.ts    # + summarizeReport tests; buildIssueBody updated
  run.ts            # split run() -> runCheck() + runApply(); + CheckDeps, ApplyResult
  run.test.ts       # split into runCheck + runApply tests
  effects.ts        # + exported readRestaurants() reused by createRealEffects
  check.ts          # NEW entrypoint (detection)
  apply.ts          # NEW entrypoint (action)
  main.ts           # REMOVED
.github/workflows/check-restaurants.yml  # two steps: Check, Apply
package.json        # scripts: restaurants:check, restaurants:apply (replace check:restaurants)
.gitignore          # + restaurant-check-report.json
```

---

### Task 1: Report type, summary, and issue body

**Files:**
- Modify: `scripts/check-restaurants/types.ts`
- Modify: `scripts/check-restaurants/report.ts`
- Test: `scripts/check-restaurants/report.test.ts`

**Interfaces:**
- Produces:
  - `interface CheckReport { generatedAt: string; rawCount: number; corridorCount: number; aborted: boolean; additions: DiscoveredPlace[]; closures: Restaurant[]; backfills: Array<{ slug: string; placeId: string }>; warnings: string[]; unmatchedExisting: Restaurant[] }`
  - `summarizeReport(report: CheckReport): string`
  - `buildIssueBody(additions: DiscoveredPlace[], warnings: string[], unmatchedExisting: Restaurant[]): string` (added third param)

- [ ] **Step 1: Add the CheckReport type**

In `types.ts`, append:

```ts
export interface CheckReport {
  generatedAt: string;
  rawCount: number;
  corridorCount: number;
  aborted: boolean;
  additions: DiscoveredPlace[];
  closures: Restaurant[];
  backfills: Array<{ slug: string; placeId: string }>;
  warnings: string[];
  unmatchedExisting: Restaurant[];
}
```

- [ ] **Step 2: Write failing tests for summarizeReport and the buildIssueBody change**

In `report.test.ts`, add a `CheckReport` factory and tests. Add to the existing imports `summarizeReport` and `CheckReport`:

```ts
import {
  applyBackfills,
  applyClosures,
  buildIssueBody,
  imageFilesToDelete,
  serializeRestaurants,
  summarizeReport,
} from './report';
import type { CheckReport, DiscoveredPlace, Restaurant } from './types';

const report = (over: Partial<CheckReport>): CheckReport => ({
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

describe('summarizeReport', () => {
  test('reports counts and an abort notice when aborted', () => {
    const out = summarizeReport(
      report({ aborted: true, corridorCount: 3, rawCount: 5 }),
    );
    expect(out).toContain('3');
    expect(out.toLowerCase()).toContain('abort');
  });

  test('lists additions, backfills, closures, warnings, and unmatched', () => {
    const out = summarizeReport(
      report({
        additions: [d({ name: 'New Spot' })],
        backfills: [{ slug: 'lenas', placeId: 'p-lenas' }],
        closures: [r({ name: 'Gone', slug: 'gone' })],
        warnings: ['thai-peppers: verify'],
        unmatchedExisting: [r({ name: 'Zuki Moon', slug: 'zuki-moon' })],
      }),
    );
    expect(out).toContain('New Spot');
    expect(out).toContain('lenas');
    expect(out).toContain('Gone');
    expect(out).toContain('thai-peppers: verify');
    expect(out).toContain('Zuki Moon');
  });
});

describe('buildIssueBody unmatched section', () => {
  test('renders an unmatched-existing section when present', () => {
    const body = buildIssueBody([], [], [r({ name: 'Zuki Moon', slug: 'zuki-moon' })]);
    expect(body.toLowerCase()).toContain('manual');
    expect(body).toContain('Zuki Moon');
  });

  test('omits the unmatched section when empty', () => {
    const body = buildIssueBody([d({ name: 'New Spot' })], [], []);
    expect(body.toLowerCase()).not.toContain('manual review');
  });
});
```

(Reuse the existing `r(...)` and `d(...)` factories already in this file.)

- [ ] **Step 3: Run tests, verify they fail**

Run: `pnpm test scripts/check-restaurants/report.test.ts`
Expected: FAIL (`summarizeReport` not exported; `buildIssueBody` arity).

- [ ] **Step 4: Implement**

In `report.ts`, change `buildIssueBody` to accept a third parameter and render an "Entries needing manual review" section when non-empty:

```ts
export function buildIssueBody(
  additions: DiscoveredPlace[],
  warnings: string[],
  unmatchedExisting: Restaurant[],
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

  if (unmatchedExisting.length > 0) {
    lines.push('');
    lines.push('### Entries needing manual review');
    lines.push('');
    lines.push(
      'These existing restaurants were not found on the strip and have no `placeId` — verify whether they closed or moved:',
    );
    lines.push('');
    for (const r of unmatchedExisting) lines.push(`- ${r.name} (\`${r.slug}\`)`);
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

Add `summarizeReport` (import `CheckReport` from `./types`):

```ts
export function summarizeReport(report: CheckReport): string {
  const lines: string[] = [];
  lines.push(`Restaurant check @ ${report.generatedAt}`);
  lines.push(
    `Raw results: ${report.rawCount} | within corridor: ${report.corridorCount}`,
  );
  if (report.aborted) {
    lines.push(
      `ABORTED: corridor matches below the safety floor — no action would be taken.`,
    );
    return lines.join('\n');
  }
  lines.push('');
  lines.push(`Backfills (existing -> placeId): ${report.backfills.length}`);
  for (const b of report.backfills) lines.push(`  ${b.slug} -> ${b.placeId}`);
  lines.push('');
  lines.push(`New candidate additions: ${report.additions.length}`);
  for (const a of report.additions) lines.push(`  ${a.name} | ${a.address}`);
  lines.push('');
  lines.push(`Closures (CLOSED_PERMANENTLY): ${report.closures.length}`);
  for (const c of report.closures) lines.push(`  ${c.name} (${c.slug})`);
  lines.push('');
  lines.push(`Warnings: ${report.warnings.length}`);
  for (const w of report.warnings) lines.push(`  ${w}`);
  lines.push('');
  lines.push(
    `Existing entries needing manual review: ${report.unmatchedExisting.length}`,
  );
  for (const r of report.unmatchedExisting) lines.push(`  ${r.name} (${r.slug})`);
  return lines.join('\n');
}
```

- [ ] **Step 5: Run tests, verify pass**

Run: `pnpm test scripts/check-restaurants/report.test.ts` → PASS.
Run: `pnpm exec tsc --noEmit -p tsconfig.json` → clean (note: `run.ts` still calls the old `buildIssueBody` arity; it is updated in Task 2 — if tsc errors only in `run.ts` on buildIssueBody, that is expected and resolved by Task 2; report the error but proceed).

- [ ] **Step 6: Commit**

```bash
pnpm exec prettier --write scripts/check-restaurants/types.ts scripts/check-restaurants/report.ts scripts/check-restaurants/report.test.ts
git add scripts/check-restaurants/types.ts scripts/check-restaurants/report.ts scripts/check-restaurants/report.test.ts
git commit -m "feat: add CheckReport type, summarizeReport, and issue manual-review section"
```

---

### Task 2: Split run() into runCheck() and runApply()

**Files:**
- Modify: `scripts/check-restaurants/run.ts`
- Test: `scripts/check-restaurants/run.test.ts`

**Interfaces:**
- Consumes: `CheckReport` (types), `buildIssueBody` (new arity), `applyBackfills`/`applyClosures`/`imageFilesToDelete`/`serializeRestaurants` (report), `diffRestaurants` (diff), `isWithinCorridor` (geo), config, `PlacesClient`, `Effects`.
- Produces:
  - `interface CheckDeps { readRestaurants(): Promise<Restaurant[]>; log(msg: string): void }`
  - `interface ApplyResult { wrote: boolean; closures: number; backfills: number; issueReported: boolean }`
  - `runCheck(client: PlacesClient, deps: CheckDeps): Promise<CheckReport>`
  - `runApply(report: CheckReport, effects: Effects): Promise<ApplyResult>`
  - Keep the existing `Effects` interface in `run.ts`.

- [ ] **Step 1: Rewrite run.test.ts to test runCheck and runApply (failing)**

Replace the test imports `{ type Effects, run }` with `{ type Effects, runApply, runCheck }`. Keep the `SEGMENT`-derived `onAvenue` / `offCorridor` fixtures, `fakeClient`, `fakeEffects`, `place`, `padPlaces` helpers. Replace the `describe('run', ...)` block with:

```ts
describe('runCheck', () => {
  const deps = (existing: Restaurant[]) => ({
    readRestaurants: async () => existing,
    log: () => {},
  });

  test('aborts (no diff) when too few corridor results', async () => {
    const client = fakeClient([place({ placeId: 'only', name: 'Only One' })], {});
    const report = await runCheck(client, deps([]));
    expect(report.aborted).toBe(true);
    expect(report.additions).toEqual([]);
    expect(report.closures).toEqual([]);
  });

  test('classifies a permanently closed existing restaurant as a closure', async () => {
    const existing: Restaurant[] = [
      { name: 'Gone', slug: 'gone', website: '', onlineOrderUrl: '', placeId: 'p-gone' },
    ];
    const client = fakeClient(padPlaces(12), { 'p-gone': 'CLOSED_PERMANENTLY' });
    const report = await runCheck(client, deps(existing));
    expect(report.aborted).toBe(false);
    expect(report.closures.map(c => c.slug)).toEqual(['gone']);
    expect(report.corridorCount).toBe(12);
  });

  test('excludes out-of-corridor places from additions', async () => {
    const farEast = place({ placeId: 'p-far', name: 'Far Away Diner', location: offCorridor });
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
      { name: 'Gone', slug: 'gone', website: '', onlineOrderUrl: '', placeId: 'p-gone' },
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
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `pnpm test scripts/check-restaurants/run.test.ts`
Expected: FAIL (`runCheck`/`runApply` not exported).

- [ ] **Step 3: Rewrite run.ts**

Replace the body of `run.ts` with the split. Keep the existing `Effects` interface; add `CheckDeps`, `ApplyResult`; remove the old `run()` and `RunResult`:

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
import type { BusinessStatus, CheckReport, Restaurant } from './types';

export interface Effects {
  readRestaurants(): Promise<Restaurant[]>;
  writeRestaurants(json: string): Promise<void>;
  deleteImages(paths: string[]): Promise<void>;
  reportIssue(body: string): Promise<void>;
  openClosurePr(removed: Restaurant[]): Promise<void>;
  openBackfillPr(backfills: Array<{ slug: string; placeId: string }>): Promise<void>;
  log(msg: string): void;
}

export interface CheckDeps {
  readRestaurants(): Promise<Restaurant[]>;
  log(msg: string): void;
}

export interface ApplyResult {
  wrote: boolean;
  closures: number;
  backfills: number;
  issueReported: boolean;
}

export async function runCheck(
  client: PlacesClient,
  deps: CheckDeps,
): Promise<CheckReport> {
  const generatedAt = new Date().toISOString();
  const existing = await deps.readRestaurants();

  const raw = await client.searchNearby();
  const corridor = raw.filter(p =>
    isWithinCorridor(
      p.location,
      SEGMENT_START,
      SEGMENT_END,
      CORRIDOR_WIDTH_METERS,
      CORRIDOR_END_BUFFER_METERS,
    ),
  );
  deps.log(`Found ${raw.length} raw, ${corridor.length} within corridor.`);

  if (corridor.length < MIN_EXPECTED_RESULTS) {
    deps.log(
      `Only ${corridor.length} corridor results (< ${MIN_EXPECTED_RESULTS}). Marking aborted.`,
    );
    return {
      generatedAt,
      rawCount: raw.length,
      corridorCount: corridor.length,
      aborted: true,
      additions: [],
      closures: [],
      backfills: [],
      warnings: [],
      unmatchedExisting: [],
    };
  }

  const statuses = new Map<string, BusinessStatus | 'NOT_FOUND'>();
  for (const r of existing) {
    if (r.placeId) statuses.set(r.placeId, await client.getPlaceStatus(r.placeId));
  }

  const diff = diffRestaurants(existing, corridor, statuses);
  const backfilledSlugs = new Set(diff.backfills.map(b => b.slug));
  const unmatchedExisting = existing.filter(
    r => !r.placeId && !backfilledSlugs.has(r.slug),
  );

  return {
    generatedAt,
    rawCount: raw.length,
    corridorCount: corridor.length,
    aborted: false,
    additions: diff.additions,
    closures: diff.closures,
    backfills: diff.backfills,
    warnings: diff.warnings,
    unmatchedExisting,
  };
}

export async function runApply(
  report: CheckReport,
  effects: Effects,
): Promise<ApplyResult> {
  if (report.aborted) {
    effects.log('Report marked aborted; taking no action.');
    return { wrote: false, closures: 0, backfills: 0, issueReported: false };
  }

  const existing = await effects.readRestaurants();
  let next = applyBackfills(existing, report.backfills);
  if (report.closures.length > 0) {
    next = applyClosures(next, report.closures);
  }

  let wrote = false;
  if (report.backfills.length > 0 || report.closures.length > 0) {
    await effects.writeRestaurants(serializeRestaurants(next));
    wrote = true;
  }
  if (report.closures.length > 0) {
    await effects.deleteImages(imageFilesToDelete(report.closures));
    await effects.openClosurePr(report.closures);
  } else if (report.backfills.length > 0) {
    await effects.openBackfillPr(report.backfills);
  }

  await effects.reportIssue(
    buildIssueBody(report.additions, report.warnings, report.unmatchedExisting),
  );

  return {
    wrote,
    closures: report.closures.length,
    backfills: report.backfills.length,
    issueReported: true,
  };
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `pnpm test scripts/check-restaurants/run.test.ts` → PASS.
Run: `pnpm test` → full suite PASS.
Run: `pnpm exec tsc --noEmit -p tsconfig.json` → clean.

- [ ] **Step 5: Commit**

```bash
pnpm exec prettier --write scripts/check-restaurants/run.ts scripts/check-restaurants/run.test.ts
git add scripts/check-restaurants/run.ts scripts/check-restaurants/run.test.ts
git commit -m "refactor: split run() into runCheck (read-only) and runApply (effects)"
```

---

### Task 3: Entrypoints, effects reader, package scripts, gitignore, workflow

**Files:**
- Modify: `scripts/check-restaurants/effects.ts`
- Create: `scripts/check-restaurants/check.ts`
- Create: `scripts/check-restaurants/apply.ts`
- Delete: `scripts/check-restaurants/main.ts`
- Modify: `package.json`, `.gitignore`, `.github/workflows/check-restaurants.yml`

**Interfaces:**
- Consumes: `runCheck`/`runApply` (run.ts), `summarizeReport` (report.ts), `createPlacesClient` (places-client.ts), `createRealEffects` + new `readRestaurants` (effects.ts), `CheckReport` (types).
- Produces: `export async function readRestaurants(): Promise<Restaurant[]>` in effects.ts; two runnable entrypoints.

No unit tests (entrypoints do real I/O; verified by tsc + the existing suite still passing).

- [ ] **Step 1: Export a standalone readRestaurants from effects.ts**

In `effects.ts`, extract the restaurants read into an exported function and have `createRealEffects().readRestaurants` delegate to it:

```ts
export async function readRestaurants(): Promise<Restaurant[]> {
  return JSON.parse(await readFile(DATA_PATH, 'utf8')) as Restaurant[];
}
```

In `createRealEffects()`, replace the inline `readRestaurants` body with `readRestaurants,` (reference the module function). Keep all other effects unchanged.

- [ ] **Step 2: Create check.ts**

```ts
import { writeFileSync } from 'node:fs';

import { readRestaurants } from './effects';
import { createPlacesClient } from './places-client';
import { summarizeReport } from './report';
import { runCheck } from './run';

const REPORT_PATH =
  process.env['CHECK_REPORT_PATH'] ?? 'restaurant-check-report.json';

async function main(): Promise<void> {
  const apiKey = process.env['GOOGLE_PLACES_API_KEY'];
  if (!apiKey) {
    console.error('GOOGLE_PLACES_API_KEY is not set.');
    process.exit(1);
  }

  const client = createPlacesClient(apiKey);
  const report = await runCheck(client, {
    readRestaurants,
    log: msg => console.error(msg),
  });

  console.log(summarizeReport(report));
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.error(`\nReport written to ${REPORT_PATH}`);

  if (report.aborted) process.exit(1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 3: Create apply.ts**

```ts
import { readFileSync } from 'node:fs';

import { createRealEffects } from './effects';
import { runApply } from './run';
import type { CheckReport } from './types';

const REPORT_PATH =
  process.env['CHECK_REPORT_PATH'] ?? 'restaurant-check-report.json';

async function main(): Promise<void> {
  const report = JSON.parse(
    readFileSync(REPORT_PATH, 'utf8'),
  ) as CheckReport;

  const effects = createRealEffects();
  const result = await runApply(report, effects);
  console.log(JSON.stringify(result));
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 4: Remove main.ts**

```bash
git rm scripts/check-restaurants/main.ts
```

- [ ] **Step 5: Update package.json scripts**

Replace the `check:restaurants` entry with:

```json
    "restaurants:check": "tsx scripts/check-restaurants/check.ts",
    "restaurants:apply": "tsx scripts/check-restaurants/apply.ts",
```

- [ ] **Step 6: Gitignore the report**

Append to `.gitignore`:

```
restaurant-check-report.json
```

- [ ] **Step 7: Update the workflow to two steps**

In `.github/workflows/check-restaurants.yml`, replace the single "Run restaurant check" step with:

```yaml
      - name: Check restaurants (read-only)
        env:
          GOOGLE_PLACES_API_KEY: ${{ secrets.GOOGLE_PLACES_API_KEY }}
        run: pnpm restaurants:check

      - name: Apply changes (issue + PRs)
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: pnpm restaurants:apply
```

(Keep checkout, pnpm/setup-node, install, and git-identity steps as-is.)

- [ ] **Step 8: Verify**

Run: `pnpm exec tsc --noEmit -p tsconfig.json` → clean (no reference to the removed `main.ts`).
Run: `pnpm test` → full suite PASS.
Run: `pnpm build` → succeeds (ignore pre-existing large-PNG warnings).
Confirm `git grep -n "check:restaurants\|main.ts" -- package.json .github` returns nothing stale.

- [ ] **Step 9: Commit**

```bash
pnpm exec prettier --write scripts/check-restaurants/effects.ts scripts/check-restaurants/check.ts scripts/check-restaurants/apply.ts
git add -A
git commit -m "feat: split into restaurants:check and restaurants:apply entrypoints + workflow"
```

---

## Self-Review Notes

- Spec coverage: read-only detection entrypoint (Task 3 check.ts + Task 2 runCheck), JSON report + summary (Tasks 1, 3), action entrypoint consuming the report (Task 3 apply.ts + Task 2 runApply), abort no-ops (Task 2 runApply), two-step workflow + split secrets (Task 3), report gitignored (Task 3), unmatched-existing surfaced (Tasks 1, 2).
- Type consistency: `CheckReport` defined once (Task 1), consumed by `summarizeReport`/`runCheck`/`runApply`/`apply.ts`; `buildIssueBody` third-arg arity updated in Task 1 and called with three args in Task 2.
- No behavior change to detection logic beyond surfacing `unmatchedExisting`; closure/guard semantics preserved.
