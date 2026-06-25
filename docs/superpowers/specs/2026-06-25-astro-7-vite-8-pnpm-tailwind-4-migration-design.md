# Astro 7 / Vite 8 / pnpm / Tailwind 4 Migration — Design

**Date:** 2026-06-25
**Status:** Approved

## Goal

Modernize the Del Ray Eats toolchain so future content updates sit on a current,
supported foundation. Upgrade Astro 2.9 → 7, let Vite 8 come in transitively,
migrate the package manager from Yarn to pnpm, and upgrade Tailwind 3 → 4. Along
the way, perform the refactors these upgrades force (chiefly the `@astrojs/image`
→ `astro:assets` migration) and remove unused scaffolding.

The site's behavior and appearance must be unchanged: a static, single-page
directory of restaurants, served as a PWA, with system-preference dark mode.

## Confirmed Decisions

- **Tailwind:** upgrade to v4 (CSS-first config via `@tailwindcss/vite`).
- **React:** remove entirely (`@astrojs/react`, `react`, `react-dom`,
  `@types/react`). It is currently scaffolded but unused — no `.jsx`/`.tsx`
  files and nothing imports React. Re-addable later if interactivity is needed.
- **Vite:** do not pin a `vite` devDependency; let Astro 7 own the Vite 8
  version transitively. Acceptable as long as the build works.
- **StackBlitz cruft:** remove.

## Current State (verified)

- Astro `^2.9.2`, `@astrojs/image` `^0.17.2`, `@astrojs/react` `^2.2.1`,
  Tailwind `^3.3.3` via PostCSS (`autoprefixer`, `cssnano`).
- `react`/`react-dom`/`@types/react` present but unused.
- `fs-extra` present but **unused** (no references in repo source).
- `yarn.lock` + `yarn-error.log` present; `.npmrc` already contains the
  pnpm-specific `shamefully-hoist = true`.
- 29 restaurants in `src/data/restaurants.json`, each requiring a matching
  `src/assets/images/<slug>.png`.
- `src/styles/global.css` is only the three `@tailwind` directives.
- `src/components/button.astro` has no imports. `card.astro` is the only
  consumer of `@astrojs/image`.
- Target versions (published, verified): Astro 7.0.3 (engines: node ≥22.12 —
  local Node is 24.16), Vite 8.1.0, Tailwind 4.3.1, `@tailwindcss/vite` 4.3.1,
  `workbox-cli` 7.4.1.

## Changes

### 1. Package manager → pnpm

- Delete `yarn.lock` and `yarn-error.log`.
- Generate `pnpm-lock.yaml` via `pnpm install` (commit it).
- Keep `.npmrc` as-is.
- `package.json` `build` script: `astro build && npm run generateSW` →
  `astro build && pnpm generateSW`.
- Update `README.md` `npm` references to `pnpm`.
- Update `CLAUDE.md`: the "mixed package manager history" note is resolved —
  state that pnpm is canonical and the `npm`/`yarn` references are gone.

### 2. Dependency changes (`package.json`)

- **Upgrade:** `astro` `^2.9.2` → `^7.0.3`.
- **Add:** `tailwindcss` `^4.3`, `@tailwindcss/vite` `^4.3`.
- **Remove:** `@astrojs/image`, `@astrojs/react`, `react`, `react-dom`,
  `@types/react`, `tailwindcss@3`, `autoprefixer`, `cssnano`, `fs-extra`.
- **Keep:** `prettier`, `prettier-plugin-astro`,
  `@trivago/prettier-plugin-sort-imports`, `sharp`, `workbox-cli`.
- Install with unpinned latest-compatible versions per usual practice; do not
  add an explicit `vite` dependency.

### 3. astro:assets image migration (`src/components/card.astro`)

`@astrojs/image`'s `<Picture>` and its `aspectRatio`/`fit`/`position` props are
removed in Astro 3+. Replace with Astro's built-in `astro:assets`:

- Resolve images via `import.meta.glob<{ default: ImageMetadata }>(
  '../assets/images/*.png')`, keyed by
  `` `../assets/images/${restaurant.slug}.png` ``.
- `await` the matched loader. **If no entry matches the slug, throw an explicit
  error** — preserving today's "build fails on a missing image" guarantee.
- Render `import { Picture } from 'astro:assets'` with
  `formats={['avif', 'webp']}`, `fallbackFormat="jpeg"`, `widths={[400, 800]}`,
  and appropriate `sizes`/`alt`.
- Recreate the 4:3 cover crop in **CSS** (it was previously a build-time crop):
  `class="w-full aspect-[4/3] object-cover rounded-t-lg"` on the rendered image.
  Visually equivalent; source PNGs no longer need pre-cropping.

### 4. Tailwind 4 migration

- Delete `tailwind.config.cjs` and `postcss.config.cjs`.
- `src/styles/global.css`: replace the three `@tailwind` directives with
  `@import "tailwindcss";`, and move the font-family theme (Poppins heading,
  Nunito sans stack) into an `@theme` block (CSS-first config). v4 auto-detects
  content, so no `content` array is needed.
- `astro.config.mjs`: remove `react()` and `image()` integrations; add
  `@tailwindcss/vite` to `vite.plugins`. Result is a minimal config with the
  Tailwind Vite plugin and no integrations.

### 5. Misc forced fixes & cleanup

- `src/env.d.ts`: `/// <reference types="@astrojs/image/client" />` →
  `/// <reference types="astro/client" />`.
- Remove empty `packages/` directory.
- Remove `.stackblitzrc` and `sandbox.config.json` (StackBlitz template cruft).
- Remove stray `.DS_Store` files.

## Out of Scope

- Restaurant content/data changes (the broader "lots of updates" come later).
- Any visual redesign, new features, or interactivity.
- Adding test or lint tooling.

## Verification

1. `pnpm install` succeeds and produces `pnpm-lock.yaml`.
2. `pnpm dev` serves the site at `localhost:3000`; smoke-test the page.
3. `pnpm build` completes **including** the `generateSW` step and emits
   `dist/service-worker.js`.
4. `pnpm preview`: all 29 cards render with images; dark mode (system
   preference) works; website/order buttons present. Appearance matches the
   pre-migration site.
5. No automated tests/lints exist to run.

## Risks

- **astro:assets API surface** differs from `@astrojs/image`; the `<Picture>`
  prop set and the CSS-crop approach are the main correctness risk — covered by
  the visual verification step.
- **Tailwind 4 behavioral diffs** (default styles/preflight changes between v3
  and v4) could shift appearance subtly; caught by the side-by-side check.
- **Workbox** precache glob is unchanged and should keep working; verify the SW
  file is emitted and registered.
