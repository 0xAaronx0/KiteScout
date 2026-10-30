import { test } from 'node:test';
import assert from 'node:assert/strict';
import { operatorReviewPatch, rejectedReviewSources, type OperatorReviewResult } from '../../src/pipeline/operator-review-patch.js';

const result = (links: Record<string, unknown>, notes: string[] = [], domain = 'op.example'): OperatorReviewResult =>
  ({ operatorId: '00000000-0000-4000-8000-000000000001', name: 'Op', domain, country: 'Kenya', listings: ['Stay'], found: 1, links, notes });

test('rejects a Google link without place name and a bstoked category page (dry run 2026-10-30)', () => {
  assert.deepEqual(rejectedReviewSources({ google_url: 'https://www.google.com/maps/place//@52.5402112,13.4479872,13z' }), ['google']);
  assert.deepEqual(rejectedReviewSources({ bstoked_url: 'https://bstoked.net/listings/type/cruise' }), ['bstoked']);
  assert.deepEqual(rejectedReviewSources({ google_url: 'https://www.google.com/maps/place/Kenyaways/@-4.3,39.5,17z',
    bstoked_url: 'https://bstoked.net/listings/kenyaways/' }), []);
});

test('patch keeps sources, averages kept ratings and drops guarded or skipped ones with their notes', () => {
  const links = { google_url: 'https://www.google.com/maps/place/Op/@1,2,17z', google_rating: 4.7, google_review_count: 248,
    tripadvisor_url: 'https://www.tripadvisor.com/x', tripadvisor_rating: 4.2, tripadvisor_review_count: 72 };
  const notes = ['TripAdvisor: search snippet (high)', 'Google: Maps search match (high)'];
  const full = operatorReviewPatch(result(links, notes), new Set(), '2026-10-30T10:00:00Z');
  assert.equal(full.google_rating, 4.7); assert.equal(full.tripadvisor_review_count, 72);
  assert.equal(full.avg_rating, 4.5); assert.equal(full.bstoked_url, null); assert.equal(full.reviews_checked_at, '2026-10-30T10:00:00Z');
  assert.equal(full.review_match_notes, notes.join(' | '));
  const skipped = operatorReviewPatch(result(links, notes), new Set(['op.example:google']), 'now');
  assert.equal(skipped.google_url, null); assert.equal(skipped.google_rating, null); assert.equal(skipped.avg_rating, 4.2);
  assert.equal(skipped.review_match_notes, 'TripAdvisor: search snippet (high)');
  const none = operatorReviewPatch(result({ google_url: 'https://www.google.com/maps/place//@52.5,13.4,13z' }, ['Google: x']), new Set(), 'now');
  assert.equal(none.google_url, null); assert.equal(none.avg_rating, null); assert.equal(none.review_match_notes, null);
});
