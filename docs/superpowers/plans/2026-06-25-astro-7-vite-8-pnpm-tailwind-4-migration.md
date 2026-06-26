# Astro 7 / Vite 8 / pnpm / Tailwind 4 Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate Del Ray Eats from Astro 2.9 to Astro 7 (Vite 8 transitive), switch Yarn → pnpm, and upgrade Tailwind 3 → 4, performing the forced refactors (`@astrojs/image` → `astro:assets`) and removing unused scaffolding, with no change to behavior or appearance.

**Architecture:** Three sequential tasks. Task 1 rebuilds the dependency tree under pnpm — after it, install works but the build does not yet (config/code still reference removed packages); this is expected. Task 2 is the migration core (Astro 7 config, Tailwind 4 CSS-first config, `astro:assets` card refactor) and is the first task that produces a fully green build, verified visually. Task 3 removes cruft and updates docs.

**Tech Stack:** Astro 7, Vite 8 (transitive), Tailwind 4 via `@tailwindcss/vite`, `astro:assets` (built-in `<Picture>`, sharp transitive via Astro), pnpm, Workbox CLI for the service worker.

## Global Constraints

- Package manager is **pnpm** (`pnpm-lock.yaml` is the only lockfile; no `yarn.lock`/`package-lock.json`).
- Install dependencies at **latest** compatible versions (caret ranges); do not pin exact versions. Do **not** add an explicit `vite` dependency — Astro 7 owns Vite 8 transitively.
- Node ≥ 22.12 (Astro 7 engine requirement; local Node is 24.16).
- The site must remain a static single-page restaurant directory, PWA-enabled, with system-preference dark mode. **No** visual redesign, new features, or interactivity.
- `src/data/restaurants.json` stays the single source of truth; each of the 29 entries requires a matching `src/assets/images/<slug>.png`, and a **missing image must fail the build** (preserved via an explicit thrown error).
- `pnpm build` must run `astro build` **and** `generateSW`, emitting `dist/service-worker.js`.
- React is removed entirely. No `react`, `react-dom`, `@types/react`, or `@astrojs/react`.

---

### Task 1: pnpm migration & dependency manifest

**Files:**
- Delete: `yarn.lock`, `yarn-error.log`
- Modify: `package.json` (name, `build` script, full `devDependencies` replacement)
- Create: `pnpm-lock.yaml` (generated)

**Interfaces:**
- Produces: a pnpm-managed dependency tree with `astro@^7`, `tailwindcss@^4`, `@tailwindcss/vite@^4`, and `vite@8` transitively present; the `build` script invokes `pnpm generateSW`.

- [ ] **Step 1: Remove Yarn artifacts**

```bash
cd /Users/tvanantwerp/Documents/personal/del-ray-eats
git rm -q yarn.lock yarn-error.log
```

- [ ] **Step 2: Rewrite `package.json` scripts/name and empty out devDependencies**

Replace the entire file with (the empty `devDependencies` is filled by `pnpm add` in Step 3):

```json
{
  "name": "del-ray-eats",
  "version": "0.0.1",
  "private": true,
  "scripts": {
    "dev": "astro dev",
    "start": "astro dev",
    "build": "astro build && pnpm generateSW",
    "generateSW": "SW_DIST_PATH=dist/ workbox generateSW workbox.config.cjs",
    "preview": "astro preview"
  },
  "devDependencies": {}
}
```

- [ ] **Step 3: Install the new dependency set at latest (generates lockfile)**

```bash
pnpm add -D astro tailwindcss @tailwindcss/vite @trivago/prettier-plugin-sort-imports prettier prettier-plugin-astro workbox-cli
```

This fetches latest of each, writes caret ranges into `devDependencies`, and creates `pnpm-lock.yaml`. (`sharp` is intentionally omitted — Astro 7 pulls it transitively; an explicit `sharp@^0.35` would version-split against Astro's `^0.34`.)

- [ ] **Step 4: Verify the resolved tree**

```bash
pnpm ls astro tailwindcss @tailwindcss/vite vite
```

Expected: `astro 7.x`, `tailwindcss 4.x`, `@tailwindcss/vite 4.x` listed as direct deps, and `vite 8.x` present (direct or transitive). Confirm none of `@astrojs/image`, `@astrojs/react`, `react`, `react-dom`, `@types/react`, `autoprefixer`, `cssnano`, `fs-extra` appear in `package.json`.

- [ ] **Step 5: Confirm no stray lockfiles**

```bash
ls yarn.lock package-lock.json 2>/dev/null; test -f pnpm-lock.yaml && echo "pnpm-lock.yaml OK"
```

Expected: the `ls` reports no such files; prints `pnpm-lock.yaml OK`.

> Note: `pnpm build` will **not** succeed yet — `astro.config.mjs`, `card.astro`, and `env.d.ts` still reference removed packages. That is fixed in Task 2.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "Migrate to pnpm and rebuild dependency tree for Astro 7 / Tailwind 4"
```

---

### Task 2: Astro 7 + Tailwind 4 + astro:assets migration

**Files:**
- Modify: `astro.config.mjs` (remove `react()`/`image()`, add `@tailwindcss/vite`)
- Delete: `tailwind.config.cjs`, `postcss.config.cjs`
- Modify: `src/styles/global.css` (Tailwind 4 CSS-first config)
- Modify: `src/env.d.ts` (`@astrojs/image/client` → `astro/client`)
- Modify: `src/components/card.astro` (`@astrojs/image` → `astro:assets`)

**Interfaces:**
- Consumes: the pnpm dependency tree from Task 1 (`astro@^7`, `tailwindcss@^4`, `@tailwindcss/vite@^4`).
- Produces: a fully green `pnpm build` (including `generateSW` → `dist/service-worker.js`) and a visually unchanged site. `card.astro` resolves images via `import.meta.glob` and throws on a missing slug image.

- [ ] **Step 1: Rewrite `astro.config.mjs`**

```js
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

export default defineConfig({
  vite: {
    plugins: [tailwindcss()],
  },
});
```

- [ ] **Step 2: Delete the PostCSS / Tailwind 3 config files**

```bash
git rm -q tailwind.config.cjs postcss.config.cjs
```

- [ ] **Step 3: Rewrite `src/styles/global.css` (Tailwind 4 CSS-first)**

The `--font-heading` / `--font-sans` theme tokens produce the existing `font-heading` / `font-sans` utilities used in the markup.

```css
@import 'tailwindcss';

@theme {
  --font-heading: 'Poppins', sans-serif;
  --font-sans:
    'Nunito', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
    'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', sans-serif,
    'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji';
}
```

- [ ] **Step 4: Fix `src/env.d.ts`**

```ts
/// <reference types="astro/client" />
```

- [ ] **Step 5: Rewrite `src/components/card.astro` to use `astro:assets`**

Resolves the per-slug image via `import.meta.glob`, throws on a missing image (preserving the build-fails guarantee), and recreates the 4:3 cover crop in CSS (`aspect-[4/3] object-cover`) instead of the old build-time crop.

```astro
---
import { Picture } from 'astro:assets';

import Button from './button.astro';

const { restaurant } = Astro.props;

const images = import.meta.glob<{ default: ImageMetadata }>(
  '../assets/images/*.png',
);
const imageKey = `../assets/images/${restaurant.slug}.png`;
const imageLoader = images[imageKey];

if (!imageLoader) {
  throw new Error(
    `No image for restaurant "${restaurant.name}" (expected ${imageKey}). ` +
      `Add src/assets/images/${restaurant.slug}.png.`,
  );
}

const { default: image } = await imageLoader();
---

<article
  class="grid drop-shadow-md hover:drop-shadow-lg hover:scale-105 transition-all h-full border border-slate-500 rounded-lg"
  style="grid-template-rows: auto 1fr;"
>
  <Picture
    src={image}
    alt={`Exterior of ${restaurant.name}`}
    widths={[400, 800]}
    sizes="400px"
    formats={['avif', 'webp']}
    fallbackFormat="jpeg"
    class="w-full aspect-[4/3] object-cover rounded-t-lg"
  />
  <div class="grid items-end rounded-b-lg bg-white dark:bg-slate-800 -mt-8">
    <h1
      class="font-heading text-xl text-center text-slate-800 dark:text-slate-100 p-4"
    >
      {restaurant.name}
    </h1>
    <div class="grid grid-cols-2 justify-items-stretch gap-4 px-4 pb-4">
      <Button href={restaurant.website} external inverted>Visit Website</Button>
      <Button href={restaurant.onlineOrderUrl} external>Order Now</Button>
    </div>
  </div>
</article>
```

- [ ] **Step 6: Type-check the project**

```bash
pnpm exec astro check
```

Expected: completes with 0 errors. (`ImageMetadata` resolves from `astro/client`; no references to `@astrojs/image` remain.) If `astro check` reports the `@astrojs/check`/`typescript` dependency is missing, install it with `pnpm add -D @astrojs/check typescript` and re-run.

- [ ] **Step 7: Run the full production build**

```bash
pnpm build
```

Expected: `astro build` reports all pages built and images optimized, then `generateSW` (Workbox) logs the precache manifest. Confirm the SW file exists:

```bash
test -f dist/service-worker.js && echo "service-worker.js OK"
```

Expected: prints `service-worker.js OK`.

- [ ] **Step 8: Visually verify the production build**

```bash
pnpm preview
```

Open `localhost:3000` (or the printed URL) and confirm: all 29 cards render with images at a 4:3 crop, headings use Poppins and body uses Nunito, the website/order buttons appear, and toggling the OS appearance to Dark switches the page to dark styling. Stop the preview server when done. This is the primary correctness gate for the `astro:assets` and Tailwind 4 changes.

- [ ] **Step 9: Commit**

```bash
git add astro.config.mjs src/styles/global.css src/env.d.ts src/components/card.astro
git commit -m "Migrate to Astro 7 config, Tailwind 4, and astro:assets"
```

---

### Task 3: Remove cruft & update docs

**Files:**
- Delete: `packages/` (empty dir), `.stackblitzrc`, `sandbox.config.json`, stray `.DS_Store` files
- Modify: `README.md` (npm → pnpm; trim StackBlitz starter boilerplate)
- Modify: `CLAUDE.md` (resolve the "mixed package manager" note to pnpm)

**Interfaces:**
- Consumes: the green build from Task 2.
- Produces: a repo with no leftover StackBlitz/template cruft and docs that describe the pnpm + Astro 7 reality.

- [ ] **Step 1: Remove cruft files**

```bash
cd /Users/tvanantwerp/Documents/personal/del-ray-eats
git rm -q --ignore-unmatch .stackblitzrc sandbox.config.json
rmdir packages 2>/dev/null || true
find . -name .DS_Store -not -path './node_modules/*' -delete
```

(`.DS_Store` is already gitignored, so the `find` only cleans the working tree.)

- [ ] **Step 2: Update `README.md` — replace the commands table and install references with pnpm**

Replace the existing commands table (the `npm install` / `npm run …` rows) with:

```markdown
| Command           | Action                                       |
|:----------------  |:-------------------------------------------- |
| `pnpm install`    | Installs dependencies                        |
| `pnpm dev`        | Starts local dev server at `localhost:3000`  |
| `pnpm build`      | Build the production site to `./dist/`       |
| `pnpm preview`    | Preview the build locally, before deploying  |
```

And replace the top-of-file StackBlitz starter heading/badge (lines for `# Astro Starter Kit: Minimal`, the `npm init astro` block, and the StackBlitz badge/"Seasoned astronaut" note) with a one-line project description:

```markdown
# Del Ray Eats

A static directory of restaurants in the Del Ray neighborhood of Alexandria, VA, linking each to its website and online-ordering page. Built with Astro and Tailwind, served as a PWA.
```

- [ ] **Step 3: Update `CLAUDE.md` package-manager note**

In the Commands section, change the command table's `npm run …` references to `pnpm …`, and replace the "Note:" paragraph about mixed package-manager history (the `npm`/`.npmrc`/`yarn.lock` note) with:

```markdown
The package manager is **pnpm** (`pnpm-lock.yaml`); `.npmrc`'s `shamefully-hoist` is a pnpm setting. Run `pnpm build` (not `astro build` alone) so `generateSW` runs and `dist/service-worker.js` is produced.
```

Also update the Overview line that says "React and (legacy) `@astrojs/image` integrations" to reflect that React and `@astrojs/image` were removed and images now use built-in `astro:assets`, and update the `card.astro` description (it no longer uses `@astrojs/image`'s `<Picture>`; it uses `astro:assets` `<Picture>` with a CSS 4:3 crop).

- [ ] **Step 4: Verify the build still passes after cleanup**

```bash
pnpm build && test -f dist/service-worker.js && echo "build OK"
```

Expected: build completes and prints `build OK`.

- [ ] **Step 5: Confirm cruft is gone**

```bash
ls .stackblitzrc sandbox.config.json yarn.lock yarn-error.log 2>/dev/null; test -d packages && echo "packages still exists" || echo "packages removed"
```

Expected: the `ls` finds none of those files; prints `packages removed`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Remove StackBlitz/template cruft and update docs for pnpm + Astro 7"
```

---

## Self-Review

**Spec coverage:**
- pnpm migration (delete yarn files, generate lockfile, build script, README/CLAUDE) → Tasks 1 & 3 ✓
- Astro 2 → 7 upgrade → Task 1 (dep) + Task 2 (config/code) ✓
- Vite 8 transitive, unpinned → Task 1 Global Constraints + Step 4 verify ✓
- Remove `@astrojs/image`, `@astrojs/react`, `react`, `react-dom`, `@types/react`, `autoprefixer`, `cssnano`, `fs-extra` → Task 1 Step 2/3 + verify Step 4 ✓
- Tailwind 4 via `@tailwindcss/vite`, delete `tailwind.config.cjs`/`postcss.config.cjs`, `@theme` in global.css → Task 2 Steps 1–3 ✓
- `astro:assets` card refactor with `import.meta.glob`, explicit throw on missing image, CSS 4:3 cover crop → Task 2 Step 5 ✓
- `env.d.ts` fix → Task 2 Step 4 ✓
- Cruft removal (packages/, .stackblitzrc, sandbox.config.json, .DS_Store) → Task 3 Step 1 ✓
- Verification (install, dev/preview, build incl. SW, visual + dark mode) → Task 1 Steps 4–5, Task 2 Steps 6–8, Task 3 Steps 4–5 ✓

**Deviation from spec (intentional):** spec listed `sharp` under "keep"; plan drops the explicit `sharp` dep because Astro 7 depends on `sharp@^0.34` directly and an explicit `sharp@^0.35` would version-split. Functionally equivalent; flagged to the user.

**Placeholder scan:** no TBD/TODO/"handle edge cases"; all file contents shown in full.

**Type consistency:** `import.meta.glob<{ default: ImageMetadata }>` → `imageLoader()` resolves `{ default: ImageMetadata }` → `image` passed to `<Picture src>`; `ImageMetadata` provided by `astro/client` (env.d.ts). Consistent across Task 2 steps.
