# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Del Ray Eats is a static directory of restaurants in the Del Ray neighborhood of Alexandria, VA, linking each to its website and online-ordering page. It is an Astro 7.x site styled with Tailwind, served as a PWA. React and the legacy `@astrojs/image` integration have been removed; images now use Astro's built-in `astro:assets`.

## Commands

Run from the repo root:

| Command           | Action                                                              |
|-------------------|--------------------------------------------------------------------|
| `pnpm dev`        | Dev server at `localhost:3000`                                      |
| `pnpm build`      | `astro build` then `generateSW` — outputs to `dist/`               |
| `pnpm preview`    | Preview the production build                                        |

`pnpm build` runs `generateSW` afterward, which invokes Workbox (`workbox.config.cjs`) to generate `dist/service-worker.js` by precaching everything under `dist/`. The service worker is registered from `src/layouts/base.astro`, so the build is only fully correct via `pnpm build` — running `astro build` alone skips SW generation. There are no test or lint scripts.

The package manager is **pnpm** (`pnpm-lock.yaml`); pnpm hoisting is configured via `shamefullyHoist: true` in `pnpm-workspace.yaml` (alongside the `allowBuilds` approvals for esbuild/sharp). Run `pnpm build` (not `astro build` alone) so `generateSW` runs and `dist/service-worker.js` is produced.

## Architecture

The entire site is one page driven by data:

- `src/data/restaurants.json` is the **single source of truth**. Each entry is `{ name, slug, website, onlineOrderUrl }`.
- `src/pages/index.astro` imports the JSON and maps each restaurant to a `Card`.
- `src/components/card.astro` renders each restaurant. The `slug` is load-bearing: the card resolves its image via `import.meta.glob('../assets/images/*.png')` keyed by `../assets/images/${restaurant.slug}.png`, so **every restaurant must have a matching `src/assets/images/<slug>.png`** or the build throws explicitly. Images are served through `astro:assets`'s `<Picture>` (avif/webp, jpeg fallback) with a CSS 4:3 crop (`aspect-[4/3] object-cover`).
- `src/layouts/base.astro` is the shared HTML shell (fonts, favicon, service-worker registration, page background).

**To add a restaurant:** add an object to `restaurants.json` and drop a `<slug>.png` into `src/assets/images/`. No other code changes are needed.

Dark mode is handled purely by Tailwind `dark:` variants (system preference). Fonts: Poppins (`font-heading`), Nunito (`font-sans`), loaded from Google Fonts in the layout.

## Conventions

Prettier config (`.prettierrc`): single quotes, semicolons, 2-space indent, trailing commas, 80-col, arrow parens avoided, and import sorting via `@trivago/prettier-plugin-sort-imports` (local `^[./]` imports grouped and separated). TypeScript extends Astro's `strictest` config.
