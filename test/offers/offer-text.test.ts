// Guards for user-facing offer text and hero videos (audit 2026-10-27, docs/app-inventar-report-2026-10-27.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasEmailAddress, internalNote, isPlayableVideoUrl } from '../../src/lib/offer-text.js';
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

// Aaron 2026-11-12: a partner school's address in a service line reached Scout chat answers.
test('hasEmailAddress: addresses yes, retina image names and handles no', () => {
  for (const t of ['Lessons with the school (VDWS, info@school-example.com)', 'write to a.b+c@mail.example.co.uk', 'MAIL@EXAMPLE.ORG'])
    assert.equal(hasEmailAddress(t), true, t);
  for (const t of ['hero@2x.webp', 'room-1@3x.jpg', 'follow @kiteschool on Instagram', 'kite@home', 'From EUR 80 per night', null, ''])
    assert.equal(hasEmailAddress(t), false, String(t));
});

test('contentProblem: rejects an e-mail address in any shown field, without echoing it; sourceText not checked', () => {
  assert.match(contentProblem({ ...base, optionalServices: ['SUP', 'Kiting with the school (VDWS, info@school-example.com)'] })!, /^e-mail address in optionalServices/);
  assert.match(contentProblem({ ...base, includedServices: ['Transfer, book via desk@lodge-example.com'] })!, /^e-mail address in includedServices/);
  assert.match(contentProblem({ ...base, summary: `${base.summary} Write to info@lodge-example.com.` })!, /^e-mail address in summary/);
  assert.match(contentProblem({ ...base, rooms: [{ name: 'Double', description: null, features: ['ask rooms@lodge-example.com'] }] })!, /^e-mail address in rooms/);
  assert.doesNotMatch(contentProblem({ ...base, summary: `${base.summary} Write to info@lodge-example.com.` })!, /lodge-example/);
  assert.equal(contentProblem({ ...base, sourceText: 'contact: info@lodge-example.com' }), null);
});
