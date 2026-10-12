// GKS Kite House (Esposende): static snapshot of 2026-10-12 (portal exception, no network), so the test
// checks the snapshot itself: valid content, no slots, a map pin in range, photo sources.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  gksKiteHouseEsposende, gksKiteHouseContent, GKS_PHOTOS, GKS_SITE_URL,
} from '../../src/offers/adapters/gks-kite-house-esposende.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';
import { requestsSoFar } from '../../src/offers/http.js';

const notes: string[] = [];
const ctx = { note: (t: string) => { notes.push(t); }, incomplete: () => {} };

test('gks-kite-house: snapshot content passes the gate', async () => {
  const c = await gksKiteHouseEsposende.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'accommodation');
  assert.equal(c.title, 'GKS Kite House');
  assert.equal(c.country, 'Portugal');
  assert.equal(c.sourceUrl, GKS_SITE_URL); // official page, not the portal
  assert.equal(c.durationDays, null);
  assert.equal(c.mealPlan, 'self_catering');
  assert.match(c.summary, /GKS Go Kite School/);
  assert.match(c.summary, /five minutes on foot from the school's kite centre/);
  const sentences = c.summary.split(/(?<=\.)\s+/);
  assert.ok(sentences.length >= 2 && sentences.length <= 4);
  assert.deepEqual(c.rooms.map(r => r.name), ['Couple room']);
  assert.ok(c.optionalServices.some(s => /90 min EUR 120/.test(s)));
  assert.match(c.sourceText ?? '', /MANUAL SNAPSHOT 2026-10-12/);
});

test('gks-kite-house: map pin in range (GKS kite centre, Esposende)', () => {
  const { spotCoords } = gksKiteHouseContent();
  assert.ok(spotCoords);
  assert.ok(Math.abs(spotCoords.lat) <= 90 && Math.abs(spotCoords.lng) <= 180);
  // Esposende, northern Portugal
  assert.ok(spotCoords.lat > 41.4 && spotCoords.lat < 41.7 && spotCoords.lng > -8.9 && spotCoords.lng < -8.6);
});

test('gks-kite-house: no slots (price on request), no network', async () => {
  const before = requestsSoFar();
  const slots = await gksKiteHouseEsposende.fetchSlots(ctx);
  assert.deepEqual(slots, []);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.equal(requestsSoFar(), before);
  assert.ok(notes.some(n => /static snapshot/.test(n)));
  assert.equal(gksKiteHouseEsposende.confidence, 'low');
  assert.equal(gksKiteHouseEsposende.fetchBudget, 0);
});

test('gks-kite-house: photos only from the school site and the host listing', () => {
  const urls = gksKiteHouseContent().imageUrls;
  assert.equal(urls.length, GKS_PHOTOS.length);
  assert.ok(urls.every(u => u.startsWith('https://static.wixstatic.com/media/60b055_')
    || u.startsWith('https://a0.muscache.com/im/pictures/hosting/Hosting-1179036553258423285/')));
  // own-site photos first
  assert.ok(urls.slice(0, 5).every(u => u.includes('wixstatic')));
  assert.ok(urls.every(u => !/\/user\/|profile_pic/.test(u)));
});
