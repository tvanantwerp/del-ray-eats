import type {
  BusinessStatus,
  DiscoveredPlace,
  Restaurant,
} from './types';

const NAME_MATCH_THRESHOLD = 0.6;

const STOPWORDS = new Set([
  'the',
  'restaurant',
  'cafe',
  'and',
  'of',
  'del',
  'ray',
  'va',
]);

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(name: string): Set<string> {
  return new Set(
    normalizeName(name)
      .split(' ')
      .filter(t => t.length > 0 && !STOPWORDS.has(t)),
  );
}

export function nameSimilarity(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 && tb.size === 0) return 1;
  if (ta.size === 0 || tb.size === 0) return 0;
  let intersection = 0;
  for (const t of ta) if (tb.has(t)) intersection += 1;
  const union = ta.size + tb.size - intersection;
  return intersection / union;
}

export interface DiffResult {
  additions: DiscoveredPlace[];
  closures: Restaurant[];
  backfills: Array<{ slug: string; placeId: string }>;
  warnings: string[];
}

export function diffRestaurants(
  existing: Restaurant[],
  discovered: DiscoveredPlace[],
  existingStatuses: Map<string, BusinessStatus | 'NOT_FOUND'>,
): DiffResult {
  const result: DiffResult = {
    additions: [],
    closures: [],
    backfills: [],
    warnings: [],
  };

  const knownPlaceIds = new Set(
    existing.map(r => r.placeId).filter((id): id is string => Boolean(id)),
  );
  const matchedDiscoveredIds = new Set<string>();

  // Backfill placeIds for existing entries that lack one, via name match.
  for (const r of existing) {
    if (r.placeId) continue;
    let best: { place: DiscoveredPlace; score: number } | null = null;
    for (const d of discovered) {
      const score = nameSimilarity(r.name, d.name);
      if (!best || score > best.score) best = { place: d, score };
    }
    if (best && best.score >= NAME_MATCH_THRESHOLD) {
      result.backfills.push({ slug: r.slug, placeId: best.place.placeId });
      knownPlaceIds.add(best.place.placeId);
      matchedDiscoveredIds.add(best.place.placeId);
    }
  }

  // Closures + warnings, driven by status of existing entries.
  for (const r of existing) {
    if (!r.placeId) continue;
    const status = existingStatuses.get(r.placeId);
    if (status === 'CLOSED_PERMANENTLY') {
      result.closures.push(r);
    } else if (status === 'CLOSED_TEMPORARILY') {
      result.warnings.push(
        `${r.slug}: reported CLOSED_TEMPORARILY — not removing, verify manually.`,
      );
    } else if (status === 'NOT_FOUND') {
      result.warnings.push(
        `${r.slug}: placeId ${r.placeId} not found by Places — verify manually.`,
      );
    } else if (!discovered.some(d => d.placeId === r.placeId)) {
      result.warnings.push(
        `${r.slug}: operational but absent from corridor search — verify it has not moved.`,
      );
    }
  }

  // Additions: discovered places not known and not name-matched to existing.
  for (const d of discovered) {
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
