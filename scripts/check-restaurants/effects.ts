import { execFile } from 'node:child_process';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';

import { imageFilesToDelete } from './report';
import type { Effects } from './run';
import type { Restaurant } from './types';

const execFileAsync = promisify(execFile);

const DATA_PATH = 'src/data/restaurants.json';
const ISSUE_TITLE = 'Restaurant directory check';

function todayDateSuffix(): string {
  return new Date().toISOString().slice(0, 10);
}

async function gh(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('gh', args);
  return stdout.trim();
}

async function findOpenPrNumber(branch: string): Promise<string> {
  return gh([
    'pr',
    'list',
    '--head',
    branch,
    '--state',
    'open',
    '--json',
    'number',
    '--jq',
    '.[0].number // empty',
  ]);
}

export function createRealEffects(): Effects {
  return {
    async readRestaurants(): Promise<Restaurant[]> {
      return JSON.parse(await readFile(DATA_PATH, 'utf8')) as Restaurant[];
    },

    async writeRestaurants(json: string): Promise<void> {
      await writeFile(DATA_PATH, json, 'utf8');
    },

    async deleteImages(paths: string[]): Promise<void> {
      for (const p of paths) await rm(p, { force: true });
    },

    async reportIssue(body: string): Promise<void> {
      // Reuse an open issue with our title if present; else create one.
      const existing = await gh([
        'issue',
        'list',
        '--state',
        'open',
        '--search',
        `${ISSUE_TITLE} in:title`,
        '--json',
        'number',
        '--jq',
        '.[0].number // empty',
      ]);
      if (existing) {
        await gh(['issue', 'edit', existing, '--body', body]);
      } else {
        await gh([
          'issue',
          'create',
          '--title',
          `${ISSUE_TITLE} (${new Date().toISOString().slice(0, 10)})`,
          '--body',
          body,
        ]);
      }
    },

    async openClosurePr(removed: Restaurant[]): Promise<void> {
      const names = removed.map(r => r.name).join(', ');
      const branch = `bot/restaurant-closures-${todayDateSuffix()}`;
      const imagePaths = imageFilesToDelete(removed);
      await execFileAsync('git', ['checkout', '-B', branch]);
      await execFileAsync('git', ['add', '--', DATA_PATH, ...imagePaths]);
      await execFileAsync('git', [
        'commit',
        '-m',
        `chore: remove permanently closed restaurants (${names})`,
      ]);
      await execFileAsync('git', [
        'push',
        '--force-with-lease',
        'origin',
        branch,
      ]);
      const existingPr = await findOpenPrNumber(branch);
      if (!existingPr) {
        await gh([
          'pr',
          'create',
          '--title',
          `Remove closed restaurants: ${names}`,
          '--body',
          `Auto-detected as CLOSED_PERMANENTLY by the Places API:\n\n${removed
            .map(r => `- ${r.name} (\`${r.slug}\`)`)
            .join('\n')}`,
          '--head',
          branch,
        ]);
      }
    },

    async openBackfillPr(
      backfills: Array<{ slug: string; placeId: string }>,
    ): Promise<void> {
      const slugs = backfills.map(b => b.slug).join(', ');
      const branch = `bot/restaurant-backfills-${todayDateSuffix()}`;
      await execFileAsync('git', ['checkout', '-B', branch]);
      await execFileAsync('git', ['add', '--', DATA_PATH]);
      await execFileAsync('git', [
        'commit',
        '-m',
        `chore: backfill Google placeId for restaurants (${slugs})`,
      ]);
      await execFileAsync('git', [
        'push',
        '--force-with-lease',
        'origin',
        branch,
      ]);
      const existingPr = await findOpenPrNumber(branch);
      if (!existingPr) {
        await gh([
          'pr',
          'create',
          '--title',
          `Backfill placeId for restaurants: ${slugs}`,
          '--body',
          `Auto-matched to a Google Places result by name similarity:\n\n${backfills
            .map(b => `- \`${b.slug}\` → placeId \`${b.placeId}\``)
            .join('\n')}`,
          '--head',
          branch,
        ]);
      }
    },

    log(msg: string): void {
      console.log(msg);
    },
  };
}
