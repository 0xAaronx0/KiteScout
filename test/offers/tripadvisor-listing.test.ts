// Tripadvisor ratings (Aaron "TA-Fix ja", 2026-10-31): only a listing's main page counts. The 2026-10-30 run stored
// values from "-orNN" review subpages, single reviews, an FAQ and the bare home page (live examples below).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tripadvisorListingUrl } from '../../src/pipeline/tripadvisor-listing.js';
import { operatorReviewPatch, rejectedReviewSources, type OperatorReviewResult } from '../../src/pipeline/operator-review-patch.js';

const result = (links: Record<string, unknown>): OperatorReviewResult =>
  ({ operatorId: '00000000-0000-4000-8000-000000000001', name: 'Op', domain: 'op.example', country: null, listings: ['Stay'], found: 1, links, notes: ['TripAdvisor: x'] });

test('keeps main listing pages and folds "-orNN" review subpages back onto them', () => {
  const copacabana = 'https://www.tripadvisor.co.uk/Hotel_Review-g18718051-d1194318-Reviews-or20-Copacabana_Beach_Tarifa-Valdevaqueros_Tarifa_Costa_de_la_Luz_Andalucia.html';
  assert.equal(tripadvisorListingUrl(copacabana),
    'https://www.tripadvisor.co.uk/Hotel_Review-g18718051-d1194318-Reviews-Copacabana_Beach_Tarifa-Valdevaqueros_Tarifa_Costa_de_la_Luz_Andalucia.html');
  assert.equal(tripadvisorListingUrl('https://www.tripadvisor.com/AttractionProductReview-g297549-d17772300-or10-All_inclusive_one_week_kite_safari.html'),
    'https://www.tripadvisor.com/AttractionProductReview-g297549-d17772300-All_inclusive_one_week_kite_safari.html');
  const listing = 'https://www.tripadvisor.com/Attraction_Review-g297549-d17542499-Reviews-Dragonfly_Kite_Safaris-Hurghada_Red_Sea_and_the_Sinai.html';
  assert.equal(tripadvisorListingUrl(listing), listing);
  assert.equal(tripadvisorListingUrl(`${listing}?m=19905#REVIEWS`), listing);
  assert.equal(tripadvisorListingUrl(listing.replace('https://', 'http://')), listing);
});

test('rejects single reviews, FAQ pages, the home page and anything not on Tripadvisor', () => {
  for (const url of [
    'https://www.tripadvisor.com/FAQ_Answers-g15611600-d2243856-t920423-What_time_of_the_year_is_the_best_to_visit.html',
    'https://en.tripadvisor.com.hk/ShowUserReviews-g147384-d23420785-r877112134-5ElementsPro_Carriacou_Kiteboarding.html',
    'https://www.tripadvisor.com/',
    'https://www.tripadvisor.com/Profile/kiter123',
    'https://www.tripadvisor.com/ShowTopic-g1-i2-k3-Kite_trip.html',
    'https://tripadvisor.example.com/Hotel_Review-g1-d2-Reviews-X.html',
    'not a url',
  ]) assert.equal(tripadvisorListingUrl(url), null, url);
  assert.deepEqual(rejectedReviewSources({ tripadvisor_url: 'https://www.tripadvisor.com/FAQ_Answers-g15611600-d2243856-t920423-X.html' }), ['tripadvisor']);
});

test('writes only a main-page rating that comes with its review count; anything else is null, not a guess', () => {
  const haggerstone = operatorReviewPatch(result({ tripadvisor_url: 'https://www.tripadvisor.com/FAQ_Answers-g15611600-d2243856-t920423-X.html',
    tripadvisor_rating: 4.8 }), new Set(), 'now');
  assert.equal(haggerstone.tripadvisor_url, null); assert.equal(haggerstone.tripadvisor_rating, null); assert.equal(haggerstone.avg_rating, null);
  const sub = operatorReviewPatch(result({ tripadvisor_url: 'https://www.tripadvisor.com/Hotel_Review-g3844531-d2663699-Reviews-or10-Pousada_BGK-X.html',
    tripadvisor_rating: 4, tripadvisor_review_count: 516 }), new Set(), 'now');
  assert.equal(sub.tripadvisor_url, 'https://www.tripadvisor.com/Hotel_Review-g3844531-d2663699-Reviews-Pousada_BGK-X.html');
  // A value read from a subpage may be one review's bubbles: the link is kept (main page), the number is not.
  assert.equal(sub.tripadvisor_rating, null); assert.equal(sub.tripadvisor_review_count, null);
  const noCount = operatorReviewPatch(result({ tripadvisor_url: 'https://www.tripadvisor.com/Hotel_Review-g1-d2-Reviews-Main-X.html', tripadvisor_rating: 4 }), new Set(), 'now');
  assert.equal(noCount.tripadvisor_url, 'https://www.tripadvisor.com/Hotel_Review-g1-d2-Reviews-Main-X.html'); assert.equal(noCount.tripadvisor_rating, null);
  const main = operatorReviewPatch(result({ tripadvisor_url: 'https://www.tripadvisor.com/Hotel_Review-g1-d2-Reviews-Main-X.html', tripadvisor_rating: 3.5, tripadvisor_review_count: 210 }), new Set(), 'now');
  assert.equal(main.tripadvisor_rating, 3.5); assert.equal(main.tripadvisor_review_count, 210); assert.equal(main.avg_rating, 3.5);
});
