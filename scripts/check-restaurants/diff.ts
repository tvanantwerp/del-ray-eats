import type { BusinessStatus, DiscoveredPlace, Restaurant } from './types';

const NAME_MATCH_THRESHOLD = 0.6;

const STOPWORDS = new Set(['the', 'and', 'of']);

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
  if (ta.size === 0 && tb.size === 0) return 0;
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

function ownedPlaceIds(r: Restaurant): string[] {
  return [r.placeId, ...(r.aliasPlaceIds ?? [])].filter((id): id is string =>
    Boolean(id),
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
