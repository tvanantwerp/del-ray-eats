import { createRealEffects } from './effects';
import { createPlacesClient } from './places-client';
import { run } from './run';

async function main(): Promise<void> {
  const apiKey = process.env['GOOGLE_PLACES_API_KEY'];
  if (!apiKey) {
    console.error('GOOGLE_PLACES_API_KEY is not set.');
    process.exit(1);
  }

  const client = createPlacesClient(apiKey);
  const effects = createRealEffects();
  const result = await run(client, effects);

  console.log(JSON.stringify(result));
  if (result.aborted) process.exit(1);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
