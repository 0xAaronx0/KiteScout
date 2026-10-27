// Guards for user-facing offer text and hero videos (audit 2026-10-27, docs/app-inventar-report-2026-10-27.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { internalNote, isPlayableVideoUrl } from '../../src/lib/offer-text.js';
import { contentProblem } from '../../src/offers/validate.js';
import type { OfferContent } from '../../src/offers/types.js';

test('internalNote: research notes from the live audit', () => {
  assert.equal(internalNote('accommodation included (the page does not describe it)'), 'the page does not describe');
  assert.ok(internalNote('PHP 19,900 per person; the safari page does not state the length, the home page lists it as 3 days'));
  assert.ok(internalNote('The page does not name the beach; the map pin near San Juanico is approximate.'));
  assert.ok(internalNote('Kite surfing in the lagoon (no kite school or rental named on the site)'));
  assert.ok(internalNote("The website doesn't mention rental gear."));
});

test('internalNote: traveller-facing text passes', () => {
  for (const t of [
    'From EUR 80 per night (as printed on the site)',
    'Rooms from EUR 45 per night (printed on the site, © 2024)',
    'Rates are in USD and do not include VAT (16%)',
    'Hotel Todo Bien is an oceanfront boutique hotel on La Ventana bay',
    'The 2027 weeks are not published yet',
    'Beginner Kitesurf Course (approx 10 hours)',
    null, '',
  ]) assert.equal(internalNote(t), null, String(t));
});

test('isPlayableVideoUrl: files yes, watch pages no', () => {
  assert.equal(isPlayableVideoUrl('https://www.youtube.com/watch?v=nexERs_Z8bM'), false);
  assert.equal(isPlayableVideoUrl('https://youtu.be/nexERs_Z8bM'), false);
  assert.equal(isPlayableVideoUrl('https://vimeo.com/123456'), false);
  assert.equal(isPlayableVideoUrl('https://player.vimeo.com/external/1.mp4'), false);
  assert.equal(isPlayableVideoUrl('ftp://x.example/a.mp4'), false);
  assert.equal(isPlayableVideoUrl('not a url'), false);
  assert.equal(isPlayableVideoUrl('https://abc.supabase.co/storage/v1/object/public/cruise-videos/x/hero.mp4'), true);
  assert.equal(isPlayableVideoUrl('https://cdn.shopify.com/videos/c/o/v/de00216d.mp4'), true);
  assert.equal(isPlayableVideoUrl('https://g-miyakojima.com/movie/top.mp4?v=2'), true);
});

const base: OfferContent = {
  kind: 'accommodation', title: 'Test Kite Lodge', summary: 'A small kite lodge on the beach with six rooms and a kite school next door.',
  continent: 'Europe', country: 'Spain', region: null, spot: null, itinerarySpots: [], durationDays: null, skillLevels: [],
  kiteLessons: null, equipmentRental: null, beginnerFriendly: null, includedServices: [], optionalServices: [],
  accommodation: null, mealPlan: null, languages: [], rooms: [], imageUrls: [], heroVideoUrl: null,
  sourceUrl: 'https://example.com', bookingUrl: null, sourceText: 'the page does not say anything about rooms',
};

test('contentProblem: rejects a YouTube hero and research notes in shown fields, not in sourceText', () => {
  assert.equal(contentProblem(base), null); // sourceText is ours
  assert.match(contentProblem({ ...base, heroVideoUrl: 'https://www.youtube.com/watch?v=x' })!, /heroVideoUrl not a playable/);
  assert.match(contentProblem({ ...base, accommodation: 'rooms (the page does not describe them)' })!, /internal note in accommodation/);
  assert.match(contentProblem({ ...base, optionalServices: ['SUP', 'Kiting (no rental named on the site)'] })!, /internal note in optionalServices/);
  assert.match(contentProblem({ ...base, rooms: [{ name: 'Double', description: 'The site does not say the size.', features: [] }] })!, /internal note in rooms/);
});
