// Nordsee Surfschule Glamping Dome + Haus Seeschwalbe (Hooksiel / Schillig): replays the pages recorded 2026-10-14.
// WordPress pages: script / style / svg bodies dropped. Sitelio shell: only the SiteFilesMap / PageData scripts kept. Sitelio
// page data (888 KB): reduced to the keys the adapter reads (types, positions, formattedText, mapPosition, gallery paths);
// the adapter output was identical before and after the reduction.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  nordseeSurfschuleDomeSeeschwalbeHooksiel, parseSeeschwalbe, sitelioPageFileUrl, ssExtraEn,
} from '../../src/offers/adapters/nordsee-surfschule-dome-seeschwalbe-hooksiel.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/nordsee-surfschule-dome-seeschwalbe-hooksiel');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };

test('seeschwalbe: Sitelio shell -> home page data file', () => {
  assert.equal(sitelioPageFileUrl(read('seeschwalbe-schillig.com_.')),
    'https://storage.googleapis.com/te-sitelio-sites/user-23270176/sites/43314517/57ab9664b26fbsdKmm02/d0cfb0d7cffe4012995a5c3750d33d5c.js');
});

test('seeschwalbe: apartments with capacities, seasons, extras, map, gallery', () => {
  const ss = parseSeeschwalbe(read('storage.googleapis.com_te-sitelio-sites'));
  assert.deepEqual(ss.apartments.map(a => [a.name, a.maxPersons]), [
    ['Nordwind', 4], ['Schwalbennest', 4], ['Brandung', 2], ['Strandkorb', 2], ['Muschel', 3], ['Seestern', 4],
    ['Leuchtturm', 4], ['Deichblick', 4], ['Auszeit', 2],
  ]);
  assert.equal(ss.seasons.length, 3);
  assert.match(ss.seasons[0], /^Hauptsaison 2026: \| 11\.10\.25 - 25\.10\.25/);
  assert.equal(ss.minStay, 'Mindestaufenthalt sind 3 Nächte. In den Sommerferien vermieten wir wochenweise ab samstags.');
  assert.deepEqual(ss.map, { lat: 53.697194, lng: 8.015756 });
  assert.ok(ss.images.length >= 30 && ss.images.every(u => u.startsWith('https://storage.googleapis.com/production-sitelio-')));
  assert.deepEqual(ss.extras.map(ssExtraEn).filter(Boolean), [
    'Child package (cot and high chair): EUR 15', 'Pets: EUR 7 per animal per night',
    'Linen package (bed linen + 2 towels): EUR 18 per person', 'Final cleaning: EUR 70 per stay',
  ]);
});

test('nordsee-surfschule: no slots (price on request)', async () => {
  const slots = await nordseeSurfschuleDomeSeeschwalbeHooksiel.fetchSlots(ctx);
  assert.deepEqual(slots, []);
  assert.deepEqual(checkSlots(slots).problems, []);
});

test('nordsee-surfschule: content', async () => {
  const c = await nordseeSurfschuleDomeSeeschwalbeHooksiel.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'accommodation');
  assert.equal(c.region, 'Hooksiel, Wangerland');
  assert.equal(c.spot, 'Hooksiel');
  assert.equal(c.spotCoords, undefined);
  assert.equal(c.kiteLessons, true);
  assert.match(c.summary, /glamping dome .* at its mooi Strandhaus station in Hooksiel, less than 200 m from the Hooksiel kite zone/);
  assert.match(c.summary, /9 holiday apartments for 2-4 people in Haus Seeschwalbe in Schillig/);
  assert.match(c.summary, /2027 season starts at Easter/);
  assert.equal(c.rooms.length, 10);
  assert.equal(c.rooms[0].name, 'Glamping Dome (Hooksiel)');
  assert.match(c.sourceText ?? '', /zweite Hauptstandort unserer Kiteschule/);
  assert.match(c.sourceText ?? '', /Unsere Ferienunterkünfte in Schillig sind ganzjährig buchbar/);
  assert.equal(c.imageUrls.length, 30);
  assert.ok(c.imageUrls[0].startsWith('https://www.nordsee-surfschule.de/wp-content/uploads/'));
});
