// Haukeliseter fjellstue (snowkite lodge, Haukelifjell): replays the seven dnt.no pages recorded 2026-10-28.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';
import { buildHkSlots, haukeliseterFjellstueHaukelifjell, hkImages, hkLines, parseHkPrices } from '../../src/offers/adapters/haukeliseter-fjellstue-haukelifjell.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/haukeliseter-fjellstue-haukelifjell');
process.env.OFFERS_FIXTURE_DIR = DIR;
const files = readdirSync(DIR);
const read = (prefix: string) => readFileSync(join(DIR, files.find(f => f.startsWith(prefix))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const PRICES = 'www.dnt.no_hytter_betjente_haukeliseter_bestilling2_prisliste_.';

test('haukeliseter: price list rows (member / non-member) and year', () => {
  const { year, rows } = parseHkPrices(hkLines(read(PRICES)));
  assert.equal(year, 2026);
  const row = (l: string) => rows.find(r => r.label.startsWith(l));
  assert.deepEqual(row('Fjellrom - pris for én person'), { label: 'Fjellrom - pris for én person (inkl. frokost)', member: 1515, nonMember: 1715 });
  assert.equal(row('Fjellrom - pris per ekstra person')?.nonMember, 525);
  assert.equal(row('Selvstellsrom')?.nonMember, 770);
  assert.equal(row('Stabbur og kuskeloft')?.nonMember, 520);
  assert.equal(row('Treretters middag')?.nonMember, 780);
  assert.equal(row('Hund'), undefined); // "200/115 ,-" is not one price
});

test('haukeliseter: four non-member season bands for the price-list year', async () => {
  const slots = await haukeliseterFjellstueHaukelifjell.fetchSlots(ctx);
  assert.deepEqual(checkSlots(slots).problems, []);
  assert.deepEqual(slots.map(s => [s.key, s.price, s.currency, s.priceUnit, s.priceBasis, s.occupancy, s.startDate, s.endDate, s.datePrecision, s.availability]), [
    ['mountain-room-1|2026', 1715, 'NOK', 'per_night', 'room', 1, '2026-01-01', '2026-12-31', 'season', 'unknown'],
    ['self-catering-bed|2026', 770, 'NOK', 'per_night', 'person', 1, '2026-01-01', '2026-12-31', 'season', 'unknown'],
    ['stabbur-bed|2026', 520, 'NOK', 'per_night', 'person', 1, '2026-01-01', '2026-12-31', 'season', 'unknown'],
    ['mountain-room-2|2026', 2240, 'NOK', 'per_night', 'room', 2, '2026-01-01', '2026-12-31', 'season', 'unknown'],
  ]);
});

test('haukeliseter: a price list without year fails loudly', () => {
  const lines = hkLines(read(PRICES)).filter(l => !/^Priser på Haukeliseter 20\d\d$/.test(l));
  assert.throws(() => buildHkSlots(lines), /price-list year missing/);
});

test('haukeliseter: photos only from Haukeliseter folders, not the related-hut cards', () => {
  const imgs = hkImages([read('www.dnt.no_hytter_betjente_haukeliseter_.')]);
  assert.ok(imgs.length >= 5);
  assert.ok(!imgs.some(u => /trollfjordhytta|saga_foto|olav-strand/.test(u)));
  for (const u of imgs) assert.match(u, /^https:\/\/www\.dnt\.no\/(globalassets|contentassets)\/.+\.jpe?g\?width=2000$/);
});

test('haukeliseter: content', async () => {
  const c = await haukeliseterFjellstueHaukelifjell.fetchContent(ctx);
  assert.equal(contentProblem(c), null);
  assert.equal(c.kind, 'accommodation');
  assert.equal(c.region, 'Haukelifjell');
  assert.match(c.summary, /weekend kite courses all winter with Kiteskolen/);
  assert.match(c.summary, /174 beds in 48 rooms/);
  assert.match(c.summary, /DNT members pay NOK 200 less per night/);
  assert.deepEqual(c.rooms.map(r => r.name), ['Mountain room', 'Nansen room 72', 'Self-catering room', 'Stabburet and Kuskeloftet']);
  assert.ok(c.optionalServices.includes('Breakfast NOK 230 (DNT members NOK 207)'));
  assert.equal(c.imageUrls.length, 30);
  assert.match(c.imageUrls[0], /haukeliseter-vinter-kitekurs/);
  assert.deepEqual(haukeliseterFjellstueHaukelifjell.disciplines, ['snowkite']);
  assert.equal(haukeliseterFjellstueHaukelifjell.operator.contactEmail, 'haukeliseter@dnt.no');
});
