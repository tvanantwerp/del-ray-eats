import { describe, expect, test } from 'vitest';

import {
  applyBackfills,
  applyClosures,
  buildIssueBody,
  imageFilesToDelete,
  serializeRestaurants,
} from './report';
import type { DiscoveredPlace, Restaurant } from './types';

const r = (over: Partial<Restaurant>): Restaurant => ({
  name: 'X',
  slug: 'x',
  website: 'https://x.com',
  onlineOrderUrl: 'https://x.com/order',
  ...over,
});

const d = (over: Partial<DiscoveredPlace>): DiscoveredPlace => ({
  placeId: 'p-new',
  name: 'New Spot',
  location: { lat: 38.8276, lng: -77.0641 },
  address: '2000 Mount Vernon Ave',
  website: 'https://newspot.com',
  businessStatus: 'OPERATIONAL',
  ...over,
});

describe('applyClosures', () => {
  test('removes closed entries, leaves the rest, does not mutate input', () => {
    const input = [r({ slug: 'keep' }), r({ slug: 'gone' })];
    const out = applyClosures(input, [r({ slug: 'gone' })]);
    expect(out.map(x => x.slug)).toEqual(['keep']);
    expect(input).toHaveLength(2);
  });
});

describe('applyBackfills', () => {
  test('sets placeId on matching slugs only', () => {
    const input = [r({ slug: 'a' }), r({ slug: 'b' })];
    const out = applyBackfills(input, [{ slug: 'b', placeId: 'p-b' }]);
    expect(out.find(x => x.slug === 'a')?.placeId).toBeUndefined();
    expect(out.find(x => x.slug === 'b')?.placeId).toBe('p-b');
  });
});

describe('imageFilesToDelete', () => {
  test('maps slugs to image paths', () => {
    expect(imageFilesToDelete([r({ slug: 'gone' })])).toEqual([
      'src/assets/images/gone.png',
    ]);
  });
});

describe('serializeRestaurants', () => {
  test('2-space indented JSON ending in a newline', () => {
    const out = serializeRestaurants([r({ slug: 'x' })]);
    expect(out.endsWith('\n')).toBe(true);
    expect(out).toContain('  "slug": "x"');
  });
});

describe('buildIssueBody', () => {
  test('includes addition name, website, slug suggestion, and placeId', () => {
    const body = buildIssueBody([d({ name: 'New Spot' })], []);
    expect(body).toContain('New Spot');
    expect(body).toContain('https://newspot.com');
    expect(body).toContain('new-spot');
    expect(body).toContain('p-new');
    expect(body).toContain('maps.google.com');
  });

  test('renders warnings section when present', () => {
    const body = buildIssueBody([], ['thai-peppers: verify manually.']);
    expect(body).toContain('Warnings');
    expect(body).toContain('thai-peppers: verify manually.');
  });

  test('states when there is nothing to add', () => {
    const body = buildIssueBody([], []);
    expect(body.toLowerCase()).toContain('no new');
  });
});
