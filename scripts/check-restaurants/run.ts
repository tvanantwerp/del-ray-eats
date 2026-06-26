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
import type { BusinessStatus, Restaurant } from './types';

export interface Effects {
  readRestaurants(): Promise<Restaurant[]>;
  writeRestaurants(json: string): Promise<void>;
  deleteImages(paths: string[]): Promise<void>;
  reportIssue(body: string): Promise<void>;
  openClosurePr(removed: Restaurant[]): Promise<void>;
  log(msg: string): void;
}

export interface RunResult {
  additions: number;
  closures: number;
  backfills: number;
  warnings: number;
  aborted: boolean;
}

export async function run(
  client: PlacesClient,
  effects: Effects,
): Promise<RunResult> {
  const existing = await effects.readRestaurants();

  const raw = await client.searchNearby();
  const discovered = raw.filter(p =>
    isWithinCorridor(
      p.location,
      SEGMENT_START,
      SEGMENT_END,
      CORRIDOR_WIDTH_METERS,
      CORRIDOR_END_BUFFER_METERS,
    ),
  );
  effects.log(`Found ${raw.length} raw, ${discovered.length} within corridor.`);

  if (discovered.length < MIN_EXPECTED_RESULTS) {
    effects.log(
      `Only ${discovered.length} corridor results (< ${MIN_EXPECTED_RESULTS}). Aborting without removals.`,
    );
    return {
      additions: 0,
      closures: 0,
      backfills: 0,
      warnings: 0,
      aborted: true,
    };
  }

  const statuses = new Map<string, BusinessStatus | 'NOT_FOUND'>();
  for (const r of existing) {
    if (r.placeId)
      statuses.set(r.placeId, await client.getPlaceStatus(r.placeId));
  }

  const diff = diffRestaurants(existing, discovered, statuses);

  let next = applyBackfills(existing, diff.backfills);
  if (diff.closures.length > 0) {
    next = applyClosures(next, diff.closures);
  }

  if (diff.backfills.length > 0 || diff.closures.length > 0) {
    await effects.writeRestaurants(serializeRestaurants(next));
  }
  if (diff.closures.length > 0) {
    await effects.deleteImages(imageFilesToDelete(diff.closures));
    await effects.openClosurePr(diff.closures);
  }

  await effects.reportIssue(buildIssueBody(diff.additions, diff.warnings));

  return {
    additions: diff.additions.length,
    closures: diff.closures.length,
    backfills: diff.backfills.length,
    warnings: diff.warnings.length,
    aborted: false,
  };
}
