import { readFileSync } from 'node:fs';

import { createRealEffects } from './effects';
import { runApply } from './run';
import type { CheckReport } from './types';

const REPORT_PATH =
  process.env['CHECK_REPORT_PATH'] ?? 'restaurant-check-report.json';

async function main(): Promise<void> {
  const report = JSON.parse(readFileSync(REPORT_PATH, 'utf8')) as CheckReport;

  const effects = createRealEffects();
  const result = await runApply(report, effects);
  console.log(JSON.stringify(result));
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
