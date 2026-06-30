import { readFile, writeFile } from 'node:fs/promises';

import type { Restaurant } from './types';

const DATA_PATH = 'src/data/restaurants.json';
const DETAILS_URL = 'https://places.googleapis.com/v1/places';

async function main(): Promise<void> {
  const apiKey = process.env['GOOGLE_PLACES_API_KEY'];
  if (!apiKey) {
    console.error('GOOGLE_PLACES_API_KEY is not set.');
    process.exit(1);
  }

  const restaurants = JSON.parse(
    await readFile(DATA_PATH, 'utf8'),
  ) as Restaurant[];

  let updated = 0;
  for (const r of restaurants) {
    if (!r.placeId) continue;
    const res = await fetch(`${DETAILS_URL}/${r.placeId}`, {
      headers: { 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': 'location' },
    });
    if (!res.ok) {
      console.warn(`Skipping ${r.slug} (${r.placeId}): HTTP ${res.status}`);
      continue;
    }
    const data = (await res.json()) as {
      location?: { latitude: number; longitude: number };
    };
    if (data.location) {
      r.location = {
        lat: data.location.latitude,
        lng: data.location.longitude,
      };
      updated += 1;
    }
  }

  await writeFile(
    DATA_PATH,
    `${JSON.stringify(restaurants, null, 2)}\n`,
    'utf8',
  );
  const missing = restaurants.filter(r => !r.location).map(r => r.slug);
  console.log(`Updated location for ${updated} entries.`);
  console.log(
    `Entries still without location (${missing.length}): ${missing.join(', ')}`,
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
