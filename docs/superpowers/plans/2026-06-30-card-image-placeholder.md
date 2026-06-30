# Card Image Placeholder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `card.astro` render a muted 4:3 placeholder block (and log a build warning) instead of throwing when a restaurant's `<slug>.png` is missing, so `pnpm build` succeeds with imageless entries.

**Architecture:** A single conditional in `card.astro`: keep the `import.meta.glob` slug lookup; when the loader is absent, `console.warn` and render a placeholder `<div>` with the same footprint as `<Picture>`; otherwise render `<Picture>` as today.

**Tech Stack:** Astro 7, Tailwind 4, `astro:assets`.

## Global Constraints

- pnpm; Node `>=22.12.0`; Astro 7; Tailwind utility classes (dark-mode via `dark:` variants), matching existing `card.astro` style.
- No schema change, no new data, no new dependency.
- Do NOT add "hide Order button" logic (out of scope — every entry has an `onlineOrderUrl`).
- Build verification only — there is no component-test framework (Vitest covers `scripts/` only).
- `pnpm build` runs `astro build` then `generateSW`; the build must go from red → green.

---

### Task 1: Placeholder fallback in card.astro

**Files:**
- Modify: `src/components/card.astro`

**Interfaces:**
- Consumes: `restaurant.slug`, `restaurant.name`; `import.meta.glob` image map (existing).
- Produces: a card that renders either `<Picture>` (image present) or a placeholder `<div>` (image absent), never throwing.

- [ ] **Step 1: Replace the throw with a warn + flag, and guard the loader call**

In `src/components/card.astro`, replace the frontmatter block from `const imageLoader = ...` through the `const { default: image } = await imageLoader();` line with:

```astro
const imageLoader = images[imageKey];

if (!imageLoader) {
  console.warn(
    `Using placeholder for "${restaurant.name}" — add src/assets/images/${restaurant.slug}.png.`,
  );
}

const image = imageLoader ? (await imageLoader()).default : null;
```

(Keep the existing `images` glob and `imageKey` lines above it unchanged.)

- [ ] **Step 2: Render the image or the placeholder in the template**

Replace the existing `<Picture ... />` element with a conditional. The placeholder keeps the same `aspect-[4/3] rounded-t-lg` footprint so the card layout is identical:

```astro
  {
    image ? (
      <Picture
        src={image}
        alt={`Exterior of ${restaurant.name}`}
        widths={[400, 800]}
        sizes="400px"
        formats={['avif', 'webp']}
        fallbackFormat="jpeg"
        class="w-full aspect-[4/3] object-cover rounded-t-lg"
      />
    ) : (
      <div
        class="w-full aspect-[4/3] rounded-t-lg bg-slate-200 dark:bg-slate-700 grid place-items-center"
      >
        <span class="font-sans text-sm text-slate-500 dark:text-slate-400">
          Photo coming soon
        </span>
      </div>
    )
  }
```

- [ ] **Step 3: Build to verify the placeholder unblocks the build**

Run: `pnpm build`
Expected: build **succeeds** (no "No image for restaurant" error). The output includes `Using placeholder for "..."` warnings for each imageless entry (e.g. `The Front Porch`, `Little Birdie VA`, etc.). The Workbox `generateSW` step completes.

- [ ] **Step 4: Confirm an image-bearing card is unchanged**

Run: `grep -c "aspect-\[4/3\] object-cover" dist/index.html`
Expected: a non-zero count — entries that have a real `<slug>.png` still render the `<Picture>` (the `object-cover` class only appears on real-image cards), confirming the existing path is intact.

- [ ] **Step 5: Commit**

```bash
git add src/components/card.astro
git commit -m "feat: render placeholder + warn for restaurants missing an image"
```

---

## Self-Review Notes

- Spec coverage: placeholder block in `card.astro` (Step 2), `console.warn` instead of throw (Step 1), same 4:3 footprint (Step 2), build goes green (Step 3), image cards unchanged (Step 4), no schema/dep change and no order-button logic (Global Constraints). All spec sections map to steps.
- Placeholder scan: every step has concrete code/commands; no TBDs.
- Consistency: `image` is `ImageMetadata | null`; `<Picture>` only renders when `image` is truthy, so its `src` is never null — satisfies `astro:assets` typing.
