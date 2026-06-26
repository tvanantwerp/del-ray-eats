import { describe, expect, test } from 'vitest';

import { diffRestaurants, nameSimilarity, slugify } from './diff';
import type { BusinessStatus, DiscoveredPlace, Restaurant } from './types';

const place = (over: Partial<DiscoveredPlace>): DiscoveredPlace => ({
  placeId: 'p-default',
  name: 'Some Place',
  location: { lat: 38.8276, lng: -77.0641 },
  address: '123 Mount Vernon Ave',
  website: null,
  businessStatus: 'OPERATIONAL',
  ...over,
});

const restaurant = (over: Partial<Restaurant>): Restaurant => ({
  name: 'Some Place',
  slug: 'some-place',
  website: 'https://example.com',
  onlineOrderUrl: 'https://example.com/order',
  ...over,
});

describe('slugify', () => {
  test('lowercases, strips punctuation, hyphenates', () => {
    expect(slugify("Matt & Tony's All Day Kitchen + Bar")).toBe(
      'matt-tonys-all-day-kitchen-bar',
    );
  });

  test('collapses repeated separators and trims', () => {
    expect(slugify('  Hi/Fi  Tex-Mex  BBQ ')).toBe('hifi-tex-mex-bbq');
  });
});

describe('nameSimilarity', () => {
  test('identical names score 1', () => {
    expect(nameSimilarity('Thai Peppers', 'Thai Peppers')).toBe(1);
  });

  test('related names score above the 0.6 threshold', () => {
    expect(
      nameSimilarity('Del Ray Cafe', 'Del Ray Café Restaurant'),
    ).toBeGreaterThanOrEqual(0.6);
  });

  test('unrelated names score below threshold', () => {
    expect(nameSimilarity('Thai Peppers', 'Pork Barrel BBQ')).toBeLessThan(0.6);
  });
});

describe('diffRestaurants', () => {
  test('flags a permanently closed existing restaurant as a closure', () => {
    const existing = [restaurant({ slug: 'gone', placeId: 'p-gone' })];
    const statuses = new Map<string, BusinessStatus | 'NOT_FOUND'>([
      ['p-gone', 'CLOSED_PERMANENTLY'],
    ]);
    const result = diffRestaurants(existing, [], statuses);
    expect(result.closures.map(r => r.slug)).toEqual(['gone']);
    expect(result.additions).toEqual([]);
  });

  test('flags an unknown discovered place as an addition', () => {
    const existing = [restaurant({ slug: 'keep', placeId: 'p-keep' })];
    const discovered = [
      place({ placeId: 'p-keep', name: 'Keep' }),
      place({ placeId: 'p-new', name: 'Brand New Spot' }),
    ];
    const statuses = new Map<string, BusinessStatus | 'NOT_FOUND'>([
      ['p-keep', 'OPERATIONAL'],
    ]);
    const result = diffRestaurants(existing, discovered, statuses);
    expect(result.additions.map(p => p.placeId)).toEqual(['p-new']);
    expect(result.closures).toEqual([]);
  });

  test('backfills placeId for an existing entry with no placeId via name match', () => {
    const existing = [restaurant({ name: 'Thai Peppers', slug: 'thai-peppers' })];
    const discovered = [place({ placeId: 'p-thai', name: 'Thai Peppers' })];
    const statuses = new Map<string, BusinessStatus | 'NOT_FOUND'>();
    const result = diffRestaurants(existing, discovered, statuses);
    expect(result.backfills).toEqual([{ slug: 'thai-peppers', placeId: 'p-thai' }]);
    // matched by name, so NOT an addition
    expect(result.additions).toEqual([]);
  });

  test('warns on temporarily closed and on dropped-out operational entries', () => {
    const existing = [
      restaurant({ slug: 'temp', placeId: 'p-temp' }),
      restaurant({ slug: 'dropped', placeId: 'p-dropped' }),
    ];
    const statuses = new Map<string, BusinessStatus | 'NOT_FOUND'>([
      ['p-temp', 'CLOSED_TEMPORARILY'],
      ['p-dropped', 'OPERATIONAL'],
    ]);
    // p-dropped is operational but not in discovered list
    const result = diffRestaurants(existing, [], statuses);
    expect(result.closures).toEqual([]);
    expect(result.warnings.some(w => w.includes('temp'))).toBe(true);
    expect(result.warnings.some(w => w.includes('dropped'))).toBe(true);
  });
});
