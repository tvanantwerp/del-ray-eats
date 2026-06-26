import { slugify } from './diff';
import type { DiscoveredPlace, Restaurant } from './types';

export function applyClosures(
  restaurants: Restaurant[],
  closures: Restaurant[],
): Restaurant[] {
  const closedSlugs = new Set(closures.map(c => c.slug));
  return restaurants.filter(r => !closedSlugs.has(r.slug));
}

export function applyBackfills(
  restaurants: Restaurant[],
  backfills: Array<{ slug: string; placeId: string }>,
): Restaurant[] {
  const bySlug = new Map(backfills.map(b => [b.slug, b.placeId]));
  return restaurants.map(r => {
    const placeId = bySlug.get(r.slug);
    return placeId ? { ...r, placeId } : r;
  });
}

export function imageFilesToDelete(closures: Restaurant[]): string[] {
  return closures.map(c => `src/assets/images/${c.slug}.png`);
}

export function serializeRestaurants(restaurants: Restaurant[]): string {
  return `${JSON.stringify(restaurants, null, 2)}\n`;
}

export function buildIssueBody(
  additions: DiscoveredPlace[],
  warnings: string[],
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

  if (warnings.length > 0) {
    lines.push('');
    lines.push('### Warnings');
    lines.push('');
    for (const w of warnings) lines.push(`- ${w}`);
  }

  lines.push('');
  return lines.join('\n');
}
