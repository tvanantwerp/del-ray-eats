import { describe, expect, test } from 'vitest';

import {
  applyBackfills,
  applyClosures,
  buildIssueBody,
  imageFilesToDelete,
  serializeRestaurants,
  summarizeReport,
} from './report';
import type { CheckReport, DiscoveredPlace, Restaurant } from './types';

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

const report = (over: Partial<CheckReport>): CheckReport => ({
  generatedAt: '2026-06-29T00:00:00.000Z',
  rawCount: 48,
  corridorCount: 43,
  aborted: false,
  additions: [],
  closures: [],
  backfills: [],
  warnings: [],
  unmatchedExisting: [],
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

describe('summarizeReport', () => {
  test('reports counts and an abort notice when aborted', () => {
    const out = summarizeReport(
      report({ aborted: true, corridorCount: 3, rawCount: 5 }),
    );
    expect(out).toContain('3');
    expect(out.toLowerCase()).toContain('abort');
  });

  test('lists additions, backfills, closures, warnings, and unmatched', () => {
    const out = summarizeReport(
      report({
        additions: [d({ name: 'New Spot' })],
        backfills: [{ slug: 'lenas', placeId: 'p-lenas' }],
        closures: [r({ name: 'Gone', slug: 'gone' })],
        warnings: ['thai-peppers: verify'],
        unmatchedExisting: [r({ name: 'Zuki Moon', slug: 'zuki-moon' })],
      }),
    );
    expect(out).toContain('New Spot');
    expect(out).toContain('lenas');
    expect(out).toContain('Gone');
    expect(out).toContain('thai-peppers: verify');
    expect(out).toContain('Zuki Moon');
  });
});

describe('buildIssueBody', () => {
  test('includes addition name, website, slug suggestion, and placeId', () => {
    const body = buildIssueBody([d({ name: 'New Spot' })], [], []);
    expect(body).toContain('New Spot');
    expect(body).toContain('https://newspot.com');
    expect(body).toContain('new-spot');
    expect(body).toContain('p-new');
    expect(body).toContain('maps.google.com');
  });

  test('renders warnings section when present', () => {
    const body = buildIssueBody([], ['thai-peppers: verify manually.'], []);
    expect(body).toContain('Warnings');
    expect(body).toContain('thai-peppers: verify manually.');
  });

  test('states when there is nothing to add', () => {
    const body = buildIssueBody([], [], []);
    expect(body.toLowerCase()).toContain('no new');
  });

  test('renders an unmatched-existing section when present', () => {
    const body = buildIssueBody(
      [],
      [],
      [r({ name: 'Zuki Moon', slug: 'zuki-moon' })],
    );
    expect(body.toLowerCase()).toContain('manual');
    expect(body).toContain('Zuki Moon');
  });

  test('omits the unmatched section when empty', () => {
    const body = buildIssueBody([d({ name: 'New Spot' })], [], []);
    expect(body.toLowerCase()).not.toContain('manual review');
  });

  test('includes each addition coordinate so new entries can be sorted', () => {
    const body = buildIssueBody(
      [d({ name: 'New Spot', location: { lat: 38.8203, lng: -77.0579 } })],
      [],
      [],
    );
    expect(body).toContain('38.8203');
    expect(body).toContain('-77.0579');
  });
});
