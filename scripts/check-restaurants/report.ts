import { slugify } from './diff';
import type { CheckReport, DiscoveredPlace, Restaurant } from './types';

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
    for (const r of unmatchedExisting)
      lines.push(`- ${r.name} (\`${r.slug}\`)`);
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
  for (const r of report.unmatchedExisting)
    lines.push(`  ${r.name} (${r.slug})`);
  return lines.join('\n');
}
