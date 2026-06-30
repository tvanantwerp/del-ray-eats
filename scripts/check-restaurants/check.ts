import { writeFileSync } from 'node:fs';

import { readIgnoredPlaces, readRestaurants } from './effects';
import { createPlacesClient } from './places-client';
import { summarizeReport } from './report';
import { runCheck } from './run';

const REPORT_PATH =
  process.env['CHECK_REPORT_PATH'] ?? 'restaurant-check-report.json';

async function main(): Promise<void> {
  const apiKey = process.env['GOOGLE_PLACES_API_KEY'];
  if (!apiKey) {
    console.error('GOOGLE_PLACES_API_KEY is not set.');
    process.exit(1);
  }

  const client = createPlacesClient(apiKey);
  const report = await runCheck(client, {
    readRestaurants,
    readIgnoredPlaces,
    log: msg => console.error(msg),
  });

  console.log(summarizeReport(report));
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.error(`\nReport written to ${REPORT_PATH}`);

  if (report.aborted) process.exit(1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
