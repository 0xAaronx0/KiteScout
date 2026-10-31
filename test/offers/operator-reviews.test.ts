import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { averageRating, operatorReviewPatch, rejectedReviewSources, type OperatorReviewResult } from '../../src/pipeline/operator-review-patch.js';

const result = (links: Record<string, unknown>, notes: string[] = [], domain = 'op.example'): OperatorReviewResult =>
  ({ operatorId: '00000000-0000-4000-8000-000000000001', name: 'Op', domain, country: 'Kenya', listings: ['Stay'], found: 1, links, notes });

test('rejects a Google link without place name and a bstoked category page (dry run 2026-10-30)', () => {
  assert.deepEqual(rejectedReviewSources({ google_url: 'https://www.google.com/maps/place//@52.5402112,13.4479872,13z' }), ['google']);
  assert.deepEqual(rejectedReviewSources({ bstoked_url: 'https://bstoked.net/listings/type/cruise' }), ['bstoked']);
  assert.deepEqual(rejectedReviewSources({ google_url: 'https://www.google.com/maps/place/Kenyaways/@-4.3,39.5,17z',
    bstoked_url: 'https://bstoked.net/listings/kenyaways/' }), []);
});

test('patch keeps sources, averages kept ratings and drops guarded or skipped ones with their notes', () => {
  const links = { tripadvisor_url: 'https://www.tripadvisor.com/x', tripadvisor_rating: 4.2, tripadvisor_review_count: 72,
    bstoked_url: 'https://bstoked.net/listings/op/', bstoked_rating: 4.8, bstoked_review_count: 9 };
  const notes = ['TripAdvisor: search snippet (high)', 'bSTOKED: listing (high)'];
  const full = operatorReviewPatch(result(links, notes), new Set(), '2026-10-30T10:00:00Z');
  assert.equal(full.tripadvisor_review_count, 72); assert.equal(full.bstoked_rating, 4.8);
  assert.equal(full.avg_rating, 4.5); assert.equal(full.reviews_checked_at, '2026-10-30T10:00:00Z');
  assert.equal(full.review_match_notes, notes.join(' | '));
  const skipped = operatorReviewPatch(result(links, notes), new Set(['op.example:bstoked']), 'now');
  assert.equal(skipped.bstoked_url, null); assert.equal(skipped.bstoked_rating, null); assert.equal(skipped.avg_rating, 4.2);
  assert.equal(skipped.review_match_notes, 'TripAdvisor: search snippet (high)');
  const none = operatorReviewPatch(result({ bstoked_url: 'https://bstoked.net/listings/type/cruise' }, ['bSTOKED: x']), new Set(), 'now');
  assert.equal(none.bstoked_url, null); assert.equal(none.avg_rating, null); assert.equal(none.review_match_notes, null);
});

// Aaron 2026-10-31 (#607, "607 b"): no Google Maps pages are fetched and no Google numbers are written or averaged.
test('Google is neither written nor averaged; a stored google_url stays untouched', () => {
  const patch = operatorReviewPatch(result({ google_url: 'https://www.google.com/maps/place/Op/@1,2,17z', google_rating: 4.9, google_review_count: 500,
    tripadvisor_url: 'https://www.tripadvisor.com/x', tripadvisor_rating: 4.0 }, ['Google: Maps search match (high)', 'TripAdvisor: x']), new Set(), 'now');
  for (const col of ['google_url', 'google_rating', 'google_review_count']) assert.equal(col in patch, false, col);
  assert.equal(patch.avg_rating, 4.0);
  assert.equal(patch.review_match_notes, 'TripAdvisor: x');
  assert.equal(averageRating({ google_rating: 5, tripadvisor_rating: 4.1, bstoked_rating: null }), 4.1);
  assert.equal(averageRating({ google_rating: 5, tripadvisor_rating: null, bstoked_rating: null }), null);
  const collector = readFileSync(new URL('../../src/pipeline/extract-cruise-reviews.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(collector, /google\.com\/maps|maps\.app\.goo\.gl|CONSENT|SOCS/);
});
