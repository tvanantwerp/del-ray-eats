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
import type {
  BusinessStatus,
  CheckReport,
  IgnoredPlace,
  Restaurant,
} from './types';

export interface Effects {
  readRestaurants(): Promise<Restaurant[]>;
  writeRestaurants(json: string): Promise<void>;
  deleteImages(paths: string[]): Promise<void>;
  reportIssue(body: string): Promise<void>;
  openClosurePr(removed: Restaurant[]): Promise<void>;
  openBackfillPr(
    backfills: Array<{ slug: string; placeId: string }>,
  ): Promise<void>;
  log(msg: string): void;
}

export interface CheckDeps {
  readRestaurants(): Promise<Restaurant[]>;
  readIgnoredPlaces(): Promise<IgnoredPlace[]>;
  log(msg: string): void;
}

export interface ApplyResult {
  wrote: boolean;
  closures: number;
  backfills: number;
  issueReported: boolean;
}

export async function runCheck(
  client: PlacesClient,
  deps: CheckDeps,
): Promise<CheckReport> {
  const generatedAt = new Date().toISOString();
  const existing = await deps.readRestaurants();

  const raw = await client.searchNearby();
  const corridor = raw.filter(p =>
    isWithinCorridor(
      p.location,
      SEGMENT_START,
      SEGMENT_END,
      CORRIDOR_WIDTH_METERS,
      CORRIDOR_END_BUFFER_METERS,
    ),
  );
  deps.log(`Found ${raw.length} raw, ${corridor.length} within corridor.`);

  if (corridor.length < MIN_EXPECTED_RESULTS) {
    deps.log(
      `Only ${corridor.length} corridor results (< ${MIN_EXPECTED_RESULTS}). Marking aborted.`,
    );
    return {
      generatedAt,
      rawCount: raw.length,
      corridorCount: corridor.length,
      aborted: true,
      additions: [],
      closures: [],
      backfills: [],
      warnings: [],
      unmatchedExisting: [],
    };
  }

  const statuses = new Map<string, BusinessStatus | 'NOT_FOUND'>();
  for (const r of existing) {
    for (const id of [r.placeId, ...(r.aliasPlaceIds ?? [])]) {
      if (id && !statuses.has(id)) {
        statuses.set(id, await client.getPlaceStatus(id));
      }
    }
  }

  const ignored = await deps.readIgnoredPlaces();
  const ignoredPlaceIds = new Set(ignored.map(i => i.placeId));

  const diff = diffRestaurants(existing, corridor, statuses, ignoredPlaceIds);
  const backfilledSlugs = new Set(diff.backfills.map(b => b.slug));
  const unmatchedExisting = existing.filter(
    r => !r.placeId && !backfilledSlugs.has(r.slug),
  );

  return {
    generatedAt,
    rawCount: raw.length,
    corridorCount: corridor.length,
    aborted: false,
    additions: diff.additions,
    closures: diff.closures,
    backfills: diff.backfills,
    warnings: diff.warnings,
    unmatchedExisting,
  };
}

export async function runApply(
  report: CheckReport,
  effects: Effects,
): Promise<ApplyResult> {
  if (report.aborted) {
    effects.log('Report marked aborted; taking no action.');
    return { wrote: false, closures: 0, backfills: 0, issueReported: false };
  }

  const existing = await effects.readRestaurants();
  let next = applyBackfills(existing, report.backfills);
  if (report.closures.length > 0) {
    next = applyClosures(next, report.closures);
  }

  let wrote = false;
  if (report.backfills.length > 0 || report.closures.length > 0) {
    await effects.writeRestaurants(serializeRestaurants(next));
    wrote = true;
  }
  if (report.closures.length > 0) {
    await effects.deleteImages(imageFilesToDelete(report.closures));
    await effects.openClosurePr(report.closures);
  } else if (report.backfills.length > 0) {
    await effects.openBackfillPr(report.backfills);
  }

  await effects.reportIssue(
    buildIssueBody(report.additions, report.warnings, report.unmatchedExisting),
  );

  return {
    wrote,
    closures: report.closures.length,
    backfills: report.backfills.length,
    issueReported: true,
  };
}
