import { describe, expect, test } from 'vitest';

import { sortSouthToNorth } from './sort-restaurants';

type Entry = { slug: string; location?: { lat: number } };

describe('sortSouthToNorth', () => {
  test('orders by latitude ascending (south to north)', () => {
    const input: Entry[] = [
      { slug: 'north', location: { lat: 38.83 } },
      { slug: 'south', location: { lat: 38.81 } },
      { slug: 'mid', location: { lat: 38.82 } },
    ];
    expect(sortSouthToNorth(input).map(e => e.slug)).toEqual([
      'south',
      'mid',
      'north',
    ]);
  });

  test('entries without a location sort last, in stable order', () => {
    const input: Entry[] = [
      { slug: 'a', location: { lat: 38.82 } },
      { slug: 'no1' },
      { slug: 'b', location: { lat: 38.81 } },
      { slug: 'no2' },
    ];
    expect(sortSouthToNorth(input).map(e => e.slug)).toEqual([
      'b',
      'a',
      'no1',
      'no2',
    ]);
  });

  test('does not mutate the input array', () => {
    const input: Entry[] = [
      { slug: 'a', location: { lat: 38.82 } },
      { slug: 'b', location: { lat: 38.81 } },
    ];
    const before = input.map(e => e.slug);
    sortSouthToNorth(input);
    expect(input.map(e => e.slug)).toEqual(before);
  });
});
