# Card Image Placeholder — Design

**Date:** 2026-06-30
**Status:** Approved (design phase)

## Problem

`card.astro` resolves each restaurant's image by slug via
`import.meta.glob('../assets/images/*.png')` and **throws at build** when
`src/assets/images/<slug>.png` is missing. Newly discovered/split restaurant
entries (e.g. `front-porch` and the other recently added spots) have no image
yet, so `pnpm build` currently fails. We want the build to succeed with a
visible placeholder, while still surfacing which entries need a real photo.

## Solution

In `card.astro`, when the slug has no matching image, render a **CSS/markup
placeholder block** in place of `<Picture>` and **`console.warn`** (instead of
throwing). Entries that *do* have an image are unchanged.

## Design

- Keep the existing `import.meta.glob` lookup and `imageKey`/`imageLoader`
  resolution.
- Replace the `if (!imageLoader) throw ...` guard with: if `imageLoader` is
  absent, set a `hasImage = false` flag and `console.warn(\`Using placeholder
  for "\${restaurant.name}" — add src/assets/images/\${restaurant.slug}.png\`)`.
  Only call `imageLoader()` when present.
- In the template, conditionally render:
  - **Has image:** the existing `<Picture ... class="w-full aspect-[4/3]
    object-cover rounded-t-lg" />`.
  - **No image:** a `<div>` with the **same footprint** — `aspect-[4/3]
    rounded-t-lg` — a muted background (light + `dark:` variants consistent with
    the card, e.g. slate tones), centered, containing a small "Photo coming
    soon" label (with the restaurant name available via `alt`-equivalent
    context). No icon dependency required; text only is fine.
- No schema change, no new data, no new dependency. The rest of the card (name,
  Website/Order buttons) is untouched.

## Scope

- **In:** image fallback + build warning in `card.astro`.
- **Out (YAGNI):** hiding the "Order Now" button (every entry currently has an
  `onlineOrderUrl`); pulling images from the Google Places API; any schema flag
  for "needs image".

## Testing / Verification

- `pnpm build` **succeeds** (previously red) with the current data, which
  includes imageless entries.
- Build output includes a `console.warn` line for each imageless entry.
- Spot-check the rendered output (`pnpm preview` or `dist/`): imageless cards
  show the placeholder block at the correct 4:3 size; cards with images are
  visually unchanged.

(There is no component-test framework in this project — Vitest covers the
`scripts/` logic only — so verification is the build + a visual check, matching
how the rest of the site is validated.)
