// Latitudes Nord (Finse camp + the four tours that share its parser): replays /prochains-voyages recorded 2026-10-19
// (scripts and comments trimmed) and the three trip reports recorded 2026-10-21 (photos). Trip-sheet facts are constants (LN_PDF), released only while the same PDF is linked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  latitudesNordFinseSnowkiteWeeks, buildLnSlots, LN_PRODUCTS, LN_STORIES, lnStoryImageUrls, parseFrenchRange, parseLnContent,
  parseLnRows, parseLnStoryImages,
} from '../../src/offers/adapters/latitudes-nord-finse-snowkite-weeks.js';
import { latitudesNordSnowkiteLightRyfylkeSetesdal } from '../../src/offers/adapters/latitudes-nord-snowkite-light-ryfylke-setesdal.js';
import { latitudesNordSnowkiteCapNord } from '../../src/offers/adapters/latitudes-nord-snowkite-cap-nord.js';
import { latitudesNordSnowkiteNordkinnVaranger } from '../../src/offers/adapters/latitudes-nord-snowkite-nordkinn-varanger.js';
import { latitudesNordSnowkiteIcelandVolcanoes } from '../../src/offers/adapters/latitudes-nord-snowkite-iceland-volcanoes.js';
import { todayIso } from '../../src/offers/parse.js';
import { checkSlots, contentProblem } from '../../src/offers/validate.js';

const DIR = join(import.meta.dirname, '../fixtures/offers/latitudes-nord-finse-snowkite-weeks');
process.env.OFFERS_FIXTURE_DIR = DIR;
const html = readFileSync(join(DIR, readdirSync(DIR).find(f => f.startsWith('www.latitudes-nord.fr_prochains-voyages.'))!), 'utf8');
const ctx = { note: () => {}, incomplete: () => {} };
const TODAY = '2026-10-19';
const TOURS = [latitudesNordSnowkiteLightRyfylkeSetesdal, latitudesNordSnowkiteCapNord, latitudesNordSnowkiteNordkinnVaranger, latitudesNordSnowkiteIcelandVolcanoes];

test('latitudes nord: French date ranges', () => {
  assert.deepEqual(parseFrenchRange('Du 24 février au 08 mars 2026'), { start: '2026-02-24', end: '2026-03-08' });
  assert.deepEqual(parseFrenchRange('Du 22 au 31 mars 2026'), { start: '2026-03-22', end: '2026-03-31' });
  assert.deepEqual(parseFrenchRange('du 1er au 9 avril 2027'), { start: '2027-04-01', end: '2027-04-09' });
  assert.deepEqual(parseFrenchRange('Du 28 décembre au 4 janvier 2027'), { start: '2026-12-28', end: '2027-01-04' });
});

test('latitudes nord: listing rows (malformed markup, raw-HTML parse)', () => {
  const rows = parseLnRows(html);
  assert.deepEqual(rows.map(r => [r.id, r.season, r.start, r.end, r.country]), [
    [45, 'Voyages Hiver 2026', '2026-02-24', '2026-03-08', 'Norvège'],
    [28, 'Voyages Hiver 2026', '2026-03-10', '2026-03-20', 'Norvège'],
    [46, 'Voyages Printemps 2026', '2026-03-22', '2026-04-01', 'Norvège'],
    [48, 'Voyages Printemps 2026', '2026-04-17', '2026-05-01', 'Islande'],
    [47, 'Voyages Hiver 2027', '2027-02-06', '2027-02-13', 'Norvège'],
    [14, 'Voyages Hiver 2027', '2027-02-13', '2027-02-20', 'Norvège'],
  ]);
  assert.equal(rows[3].pdfPath, "/ups/files/journey/48/Snowkite Exploration Volcans d'Islande_fiche presentation 2026.pdf");
  assert.match(rows[4].title, /DECOUVERTE Finse/);
});

test('latitudes nord: Finse = two dated weeks, EUR 2,500 per person, on request', () => {
  const { ok, problems } = checkSlots(buildLnSlots(parseLnRows(html), LN_PRODUCTS.finse, TODAY));
  assert.deepEqual(problems, []);
  assert.deepEqual(ok.map(s => [s.key, s.endDate, s.price, s.currency, s.priceBasis, s.availability]), [
    ['2027-02-06|discovery', '2027-02-13', 2500, 'EUR', 'person', 'on_request'],
    ['2027-02-13|advanced', '2027-02-20', 2500, 'EUR', 'person', 'on_request'],
  ]);
  assert.deepEqual(buildLnSlots(parseLnRows(html), LN_PRODUCTS.finse, '2027-02-07').map(s => s.key), ['2027-02-13|advanced']);
});

test('latitudes nord: a new PDF releases the date but not the hand-read price', () => {
  const rows = parseLnRows(html).map(r => (r.id === 47 ? { ...r, pdfPath: '/ups/files/journey/47/Snowkite FINSE 2028.pdf' } : r));
  const notes: string[] = [];
  const s = buildLnSlots(rows, LN_PRODUCTS.finse, TODAY, notes);
  assert.equal(s[0].price, null);
  assert.equal(s[1].price, 2500);
  assert.match(notes[0], /not hand-read yet/);
});

test('latitudes nord: tours list only 2026 dates -> no slots; a future row would become a slot', async () => {
  for (const p of [LN_PRODUCTS.light, LN_PRODUCTS.capnord, LN_PRODUCTS.varanger, LN_PRODUCTS.iceland]) {
    assert.deepEqual(buildLnSlots(parseLnRows(html), p, TODAY), [], p.key);
  }
  const byKey = Object.fromEntries(Object.values(LN_PRODUCTS).map(p => [p.key, p]));
  for (const a of TOURS) assert.deepEqual(await a.fetchSlots(ctx), buildLnSlots(parseLnRows(html), byKey[a.key], todayIso()), a.key);
  const future = parseLnRows(html).map(r => (r.id === 28 ? { ...r, start: '2027-03-09', end: '2027-03-19' } : r));
  const s = buildLnSlots(future, LN_PRODUCTS.capnord, TODAY);
  assert.deepEqual(s.map(x => [x.key, x.price]), [['2027-03-09|cap-nord', 3200]]);
});

test('latitudes nord: adapter slots match the builder for today (Finse)', async () => {
  assert.deepEqual(await latitudesNordFinseSnowkiteWeeks.fetchSlots(ctx), buildLnSlots(parseLnRows(html), LN_PRODUCTS.finse, todayIso()));
});

test('latitudes nord: content, pinned date', () => {
  const finse = parseLnContent(html, LN_PRODUCTS.finse, TODAY);
  assert.equal(contentProblem(finse), null);
  assert.equal(finse.kind, 'camp');
  assert.equal(finse.spot, 'Finse, Hardangervidda');
  assert.equal(finse.durationDays, 8);
  assert.match(finse.summary, /Next dates: 6 February to 13 February 2027 \(discovery week\), 13 February to 20 February 2027 \(advanced week\)/);
  assert.equal(finse.imageUrls.length, 2);
  const cap = parseLnContent(html, LN_PRODUCTS.capnord, TODAY);
  assert.equal(cap.kind, 'tour');
  assert.deepEqual(cap.itinerarySpots.map(s => s.name), ['Alta', 'Magerøya', 'Porsangerhalvøya', 'Kvaløya']);
  assert.match(cap.summary, /Runs every year; 2027 dates not yet published \(2026: 10 March to 20 March 2026\)/);
  assert.match(cap.summary, /from EUR 3,200 per person/);
  const ice = parseLnContent(html, LN_PRODUCTS.iceland, TODAY);
  assert.match(ice.summary, /The price is on request\. 2027 dates not yet published \(2026: 17 April to 1 May 2026\)\./);
  assert.equal(ice.itinerarySpots.length, 6);
  assert.equal(ice.bookingUrl, "https://www.latitudes-nord.fr/ups/files/journey/48/Snowkite%20Exploration%20Volcans%20d'Islande_fiche%20presentation%202026.pdf");
});

test('latitudes nord: every adapter content passes the gate', async () => {
  for (const a of [latitudesNordFinseSnowkiteWeeks, ...TOURS]) {
    const c = await a.fetchContent(ctx);
    assert.equal(contentProblem(c), null, a.key);
    assert.equal(c.kind, a.kind);
    assert.ok(c.imageUrls.length >= 1 && c.imageUrls.every(u => /^https:\/\/www\.latitudes-nord\.fr\/ups\/images\/(journey|story)\//.test(u)), a.key);
  }
});

// --- photos from the operator's own trip reports (recorded 2026-10-21, text blocks trimmed) ----------------------
const story = (path: string): string =>
  readFileSync(join(DIR, readdirSync(DIR).find(f => f.startsWith(`www.latitudes-nord.fr_${path.slice(1).replace(/\//g, '_')}`.slice(0, 80)))!), 'utf8');
const allStories = (): Record<string, string> =>
  Object.fromEntries(Object.values(LN_STORIES).flat().map(st => [st.path, story(st.path)]));
const names = (urls: string[]): string[] => urls.map(u => decodeURIComponent(u.split('/').pop()!));

test('latitudes nord: trip-report photos parse with captions (cover first)', () => {
  const imgs = parseLnStoryImages(story('/carnets-et-photos/snowkite-dans-le-skarvheimen-hardanger-norvege'));
  assert.equal(imgs.length, 46);
  assert.equal(imgs[0].src, '/ups/images/story/13/IMG_0483.jpg');
  assert.match(imgs.find(i => i.src.endsWith('/P1100745.jpg'))!.caption, /refuge de Finsehytta/);
  const varanger = parseLnStoryImages(story('/carnets-et-photos/snowkite-en-peninsule-du-varanger-extremite-nord-est-de-la-norvege'));
  assert.equal(varanger.length, 45);
  assert.ok(varanger.slice(1).every(i => i.src.startsWith('/ups/images/journey/38/')));
});

test('latitudes nord: every hand-picked photo is on its recorded report', () => {
  for (const [key, list] of Object.entries(LN_STORIES)) {
    for (const st of list) assert.equal(lnStoryImageUrls(story(st.path), st).length, st.pick.length, `${key} ${st.path}`);
  }
});

test('latitudes nord: each trip gets photos of its own region, junk and other trips excluded', async () => {
  const st = allStories();
  const img = (p: keyof typeof LN_PRODUCTS) => parseLnContent(html, LN_PRODUCTS[p], TODAY, st).imageUrls;
  const finse = img('finse');
  assert.equal(finse.length, 12);
  assert.ok(finse.slice(0, 2).every(u => u.includes('/ups/images/journey/')), 'listing vignettes stay first');
  assert.ok(names(finse).includes('P1100745.jpg') && names(finse).includes('P1130401.jpg'), 'Finsehytta hut + Finse village');
  assert.ok(finse.slice(2).every(u => u.includes('/ups/images/story/13/')));
  const light = img('light');
  assert.equal(light.length, 10);
  assert.ok(light.slice(1).every(u => u.includes('/ups/images/story/36/')));
  assert.ok(!names(light).includes('IMG_4330 copie.jpg'), 'no portrait of the guides');
  const varanger = img('varanger');
  assert.equal(varanger.length, 12);
  for (const junk of ['P1110685bis.jpg', 'P1110991bis.jpg', 'Photo Klemet.jpg', 'P1120159bis.jpg']) {
    assert.ok(!names(varanger).includes(junk), `walrus / road / third-party / reindeer excluded: ${junk}`);
  }
  // Iceland: the own Iceland reports are summer treks (misleading for a winter trip) -> listing vignette only
  assert.equal(LN_STORIES[LN_PRODUCTS.iceland.key], undefined);
  assert.deepEqual(names(img('iceland')), ['P1000788 bis.jpg']);
  // Cap Nord: no report on the site, and the Varanger report is not borrowed
  assert.deepEqual(names(img('capnord')), ['P1230583.jpg']);
});

test('latitudes nord: photos only while the report still shows them; a missing report keeps the vignette', () => {
  const path = '/carnets-et-photos/snowkite-dans-le-skarvheimen-hardanger-norvege';
  const trimmed = story(path).replace(/<img class="test" src="\/ups\/images\/story\/13\/P1100745\.jpg"[^>]*>/, '');
  const urls = parseLnContent(html, LN_PRODUCTS.finse, TODAY, { [path]: trimmed }).imageUrls;
  assert.equal(urls.length, 11);
  assert.ok(!names(urls).includes('P1100745.jpg'));
  assert.equal(parseLnContent(html, LN_PRODUCTS.finse, TODAY, {}).imageUrls.length, 2);
});

test('latitudes nord: Iceland content asks for the listing only (no report request)', async () => {
  // replay throws on any page without a fixture (the Iceland reports have none), the adapter would turn that into a note
  const notes: string[] = [];
  const c = await latitudesNordSnowkiteIcelandVolcanoes.fetchContent({ note: n => notes.push(n), incomplete: () => {} });
  assert.deepEqual(notes, []);
  assert.deepEqual(names(c.imageUrls), ['P1000788 bis.jpg']);
  assert.equal(latitudesNordSnowkiteIcelandVolcanoes.fetchBudget, 2);
  assert.equal(latitudesNordFinseSnowkiteWeeks.fetchBudget, 3);
  assert.deepEqual(await latitudesNordSnowkiteIcelandVolcanoes.fetchSlots(ctx), buildLnSlots(parseLnRows(html), LN_PRODUCTS.iceland, todayIso()));
});
