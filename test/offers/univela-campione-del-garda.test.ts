// Campione Univela (Campione del Garda): replays the English pages recorded 2026-10-12 (script/style trimmed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  univelaCampioneDelGarda, parseUvKiteCourses, parseUvOffers, uvImages,
} from '../../src/offers/adapters/univela-campione-del-garda.js';
import { contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/univela-campione-del-garda');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const notes: string[] = [];
const ctx = { note: (t: string) => { notes.push(t); }, incomplete: () => {} };

test('univela: kite course prices (Garda Kitesurf)', () => {
  assert.deepEqual(parseUvKiteCourses(read('www.campioneunivela.it_en_courses_kite-surf_.')).map(c => [c.course, c.price]), [
    ['Try-Out Course', 90], ['Basic Course', 280], ['Kitesurfing Start Course', 280], ['Complete Course', 530], ['Single Lesson', 120],
  ]);
});

test('univela: packages on the offers page', () => {
  const o = parseUvOffers(read('www.campioneunivela.it_en_offers_.'));
  assert.equal(o.length, 6);
  assert.deepEqual(o.find(x => /Islands of Garda/.test(x.title))!.from, 300);
  assert.deepEqual(o.find(x => /Fun for Families/.test(x.title))!.from, 1480);
});

test('univela: no slots (rates only in the robots-disallowed engine), no request', async () => {
  assert.deepEqual(await univelaCampioneDelGarda.fetchSlots(ctx), []);
  assert.ok(notes.some(n => /Disallow: \//.test(n)));
});

test('univela: content', async () => {
  const c = await univelaCampioneDelGarda.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.title, 'Campione Univela');
  assert.equal(c.country, 'Italy');
  assert.equal(c.spot, 'Campione del Garda');
  assert.equal(c.mealPlan, 'breakfast');
  assert.match(c.summary, /kite courses run with Garda Kitesurf \(basic course EUR 280/);
  assert.deepEqual(c.rooms.map(r => r.name), ['Single Room', 'Double or twin room', 'Triple or quadruple room', 'Family room', 'Bed in a hostel room shared by 4 or 6 beds']);
  assert.ok(c.includedServices.includes('Deposit kitesurf boards') && c.includedServices.includes('Video monitored dryer room for wet equipment'));
  assert.ok(c.optionalServices.some(s => /Islands of Garda.*\(from EUR 300\)$/.test(s)));
  assert.ok(c.imageUrls.length >= 20 && c.imageUrls.every(u => /\/site\/assets\/files\/\d+\/[^/]+\.jpg$/.test(u) && !/\.\d+x\d+\./.test(u)));
  assert.equal(uvImages(['<img src="/site/assets/files/1/logo_x.0x100.jpg"><img src="/site/assets/files/9/a.640x400.jpg">'])[0], 'https://www.campioneunivela.it/site/assets/files/9/a.jpg');
});
