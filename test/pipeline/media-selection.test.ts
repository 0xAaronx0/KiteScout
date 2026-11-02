import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  acceptShared, acceptVerdict, isOwnSiteImage, MAX_MEDIA, namedPlaces, photoStem, placeTerms, planAutoFill,
  selectionImageRows, type FillPlan, type MediaRow,
} from '../../src/pipeline/media-selection.js';

const U = 'https://caribbeankitecruise.com/wp-content/uploads';
const V2 = 'https://caribbeankitecruise.com/v2/wp-content/uploads';
const row = (id: string, url: string, status: string, sort: number | null, kind = 'image'): MediaRow => ({ id, kind, url, status, sort });

/** What the auto writer does with a plan (media-auto.ts writeOutcome), applied to rows in memory. */
function writePlan(rows: MediaRow[], plan: FillPlan): MediaRow[] {
  let out = rows.map(r => ({ ...r }));
  for (const b of plan.base) {
    if (b.id) out = out.map(r => (r.id === b.id ? { ...r, status: 'applied', sort: b.sort } : r));
    else out.push(row(`new-${b.sort}`, b.url, 'applied', b.sort));
  }
  out = out.map(r => (plan.stale.includes(r.id) ? { ...r, status: 'rejected', sort: null } : r));
  for (const p of plan.picks) out = out.map(r => (r.id === p.id && r.status === 'candidate' ? { ...r, status: 'selected', sort: p.sort } : r));
  return out;
}

const live5 = ['white-sands.jpg', 'slider-turks-2.jpg', 'columbus.jpg', 'caicos-bank.jpg', 'sandy-island.jpg'].map(f => `${U}/${f}`);
const pool = Array.from({ length: 9 }, (_, i) => row(`c${i}`, `${V2}/new-${i}.jpg`, 'candidate', null));

// ---------------------------------------------------------------------------
// Rule 1: apply rebuilds from ALL sorted selected/applied rows
// ---------------------------------------------------------------------------
test('rule 1: a retry of two failed downloads rebuilds the whole set, never just the stragglers', () => {
  const rows = [
    ...Array.from({ length: 8 }, (_, i) => row(`a${i}`, `${U}/a${i}.jpg`, 'applied', i)),
    row('s8', `${U}/s8.jpg`, 'selected', 8),
    row('s9', `${U}/s9.jpg`, 'selected', 9),
    row('c', `${U}/c.jpg`, 'candidate', null),
    row('r', `${U}/r.jpg`, 'rejected', 3), // a rejected row keeps no place, even with a sort left over
    row('v', `${U}/v.mp4`, 'selected', null, 'video'),
  ];
  const set = selectionImageRows(rows);
  assert.deepEqual(set.map(r => r.id), ['a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 's8', 's9']);
});

test('rule 1: sorted by sort with gaps, capped at MAX_MEDIA', () => {
  const rows = Array.from({ length: 14 }, (_, i) => row(`a${i}`, `${U}/a${i}.jpg`, 'applied', 20 - i));
  const set = selectionImageRows(rows);
  assert.equal(set.length, MAX_MEDIA);
  assert.equal(set[0].id, 'a13');
});

// ---------------------------------------------------------------------------
// Rule 2: the live set stays, picks only go behind it, 12 media combined
// ---------------------------------------------------------------------------
test('rule 2: a curated set stays as it is and the picks go behind it, hero video counts toward 12', () => {
  const rows = [...live5.map((u, i) => row(`l${i}`, u, 'applied', i)), ...pool];
  const plan = planAutoFill({ liveUrls: live5, rows, hasVideo: true, picks: pool.map(p => p.id) });
  assert.equal(plan.skip, null);
  assert.deepEqual(plan.base, [], 'rows already hold the live set: nothing rewritten');
  assert.equal(plan.room, 6);
  assert.deepEqual(plan.picks.map(p => p.sort), [5, 6, 7, 8, 9, 10]);
  const set = selectionImageRows(writePlan(rows, plan)).map(r => r.url);
  assert.deepEqual(set.slice(0, 5), live5, 'same photos, same order, same hero');
  assert.equal(set.length + 1, MAX_MEDIA);
});

test('rule 2: gaps in the curated sort (a removed photo) are kept, picks start after the last sort', () => {
  const sorts = [0, 1, 2, 4, 5];
  const rows = [...live5.map((u, i) => row(`l${i}`, u, 'applied', sorts[i])), ...pool];
  const plan = planAutoFill({ liveUrls: live5, rows, hasVideo: false, picks: ['c0', 'c1'] });
  assert.deepEqual(plan.base, []);
  assert.deepEqual(plan.picks, [{ id: 'c0', sort: 6 }, { id: 'c1', sort: 7 }]);
  assert.deepEqual(selectionImageRows(writePlan(rows, plan)).map(r => r.url), [...live5, `${V2}/new-0.jpg`, `${V2}/new-1.jpg`]);
});

test('rule 2: an applied row that is no longer live leaves the set (Turks & Caicos 2026-11-02: 6 applied, 5 live)', () => {
  const rows = [...live5.map((u, i) => row(`l${i}`, u, 'applied', i)), row('gone', `${U}/Duotone.jpg`, 'applied', 5), ...pool];
  const plan = planAutoFill({ liveUrls: live5, rows, hasVideo: false, picks: ['c0'] });
  assert.deepEqual(plan.stale, ['gone']);
  assert.deepEqual(plan.picks, [{ id: 'c0', sort: 5 }]);
  const set = selectionImageRows(writePlan(rows, plan)).map(r => r.url);
  assert.deepEqual(set, [...live5, `${V2}/new-0.jpg`], 'apply would not bring the removed photo back');
});

test('rule 2: a pipeline-curated offer (live rows still candidates, one without a row) becomes the applied base first', () => {
  const rows = [row('l0', live5[0], 'candidate', null), row('l1', live5[1], 'candidate', null), row('l2', live5[2], 'rejected', null), ...pool];
  const live = live5.slice(0, 4);
  const plan = planAutoFill({ liveUrls: live, rows, hasVideo: false, picks: ['c3', 'l0', 'c4'] });
  assert.deepEqual(plan.base, [
    { id: 'l0', url: live5[0], sort: 0, hero: true },
    { id: 'l1', url: live5[1], sort: 1, hero: false },
    { id: 'l2', url: live5[2], sort: 2, hero: false },
    { id: null, url: live5[3], sort: 3, hero: false },
  ]);
  assert.deepEqual(plan.picks, [{ id: 'c3', sort: 4 }, { id: 'c4', sort: 5 }], 'a live photo is never picked again');
  assert.deepEqual(selectionImageRows(writePlan(rows, plan)).map(r => r.url), [...live, `${V2}/new-3.jpg`, `${V2}/new-4.jpg`]);
});

test('rule 2: rows in another order than live are rewritten to the live order', () => {
  const rows = [...live5.map((u, i) => row(`l${i}`, u, 'applied', 4 - i)), ...pool];
  const plan = planAutoFill({ liveUrls: live5, rows, hasVideo: false, picks: ['c0'] });
  assert.deepEqual(plan.base.map(b => [b.id, b.sort]), [['l0', 0], ['l1', 1], ['l2', 2], ['l3', 3], ['l4', 4]]);
  assert.deepEqual(selectionImageRows(writePlan(rows, plan)).map(r => r.url), [...live5, `${V2}/new-0.jpg`]);
});

test('rule 2: a pending admin save is left to apply, a full listing gets nothing', () => {
  const pending = [...live5.map((u, i) => row(`l${i}`, u, 'applied', i)), row('s', `${U}/s.jpg`, 'selected', 0), ...pool];
  const p1 = planAutoFill({ liveUrls: live5, rows: pending, hasVideo: false, picks: ['c0'] });
  assert.match(p1.skip ?? '', /pending/);
  assert.deepEqual([p1.base, p1.stale, p1.picks], [[], [], []]);

  const live11 = Array.from({ length: 11 }, (_, i) => `${U}/f${i}.jpg`);
  const full = [...live11.map((u, i) => row(`l${i}`, u, 'applied', i)), ...pool];
  const p2 = planAutoFill({ liveUrls: live11, rows: full, hasVideo: true, picks: ['c0'] });
  assert.equal(p2.skip, 'full');
  assert.deepEqual(p2.picks, []);
});

test('rule 2: picks of non-candidate rows are ignored', () => {
  const rows = [...live5.map((u, i) => row(`l${i}`, u, 'applied', i)), row('rej', `${U}/x.jpg`, 'rejected', null), ...pool];
  const plan = planAutoFill({ liveUrls: live5, rows, hasVideo: false, picks: ['rej', 'l2', 'c1', 'c1'] });
  assert.deepEqual(plan.picks, [{ id: 'c1', sort: 5 }]);
});

// ---------------------------------------------------------------------------
// Rule 3: own site, one copy
// ---------------------------------------------------------------------------
test('rule 3: photoStem matches WordPress size / scale / edit copies and moved folders', () => {
  assert.equal(photoStem(`${V2}/G0351099-scaled-e1778065435626.jpg`), photoStem(`${U}/G0351099.jpg`));
  assert.equal(photoStem(`${V2}/Kite-spot-Tobago-Cays-650-1200x800.jpg`), photoStem(`${U}/Kite-spot-Tobago-Cays-650.jpg`));
  assert.notEqual(photoStem(`${U}/Punta-Bonita-2.jpg`), photoStem(`${U}/Punta-Bonita.jpg`));
  assert.equal(photoStem('https://images.squarespace-cdn.com/content/v1/abc/1612/image-asset.jpeg'), null);
});

test("rule 3: only the provider's own site or its site builder's CDN", () => {
  const hosts = ['caribbeankitecruise.com'];
  assert.ok(isOwnSiteImage(`${V2}/a.jpg`, hosts));
  assert.ok(isOwnSiteImage('https://www.caribbeankitecruise.com/a.jpg', hosts));
  assert.ok(isOwnSiteImage('https://i0.wp.com/caribbeankitecruise.com/wp-content/uploads/a.jpg', hosts));
  assert.ok(isOwnSiteImage('https://static.wixstatic.com/media/abc~mv2.jpg', hosts));
  assert.ok(!isOwnSiteImage('https://i0.wp.com/elsewhere.com/a.jpg', hosts));
  assert.ok(!isOwnSiteImage('https://bstoked.azureedge.net/ac-5-w0p4.jpg?width=1920', hosts));
  assert.ok(!isOwnSiteImage('https://images.unsplash.com/photo-1.jpg', hosts));
});

// ---------------------------------------------------------------------------
// Rule 4: the place
// ---------------------------------------------------------------------------
const grenadines = {
  country: 'Saint Vincent and the Grenadines', region: 'The Grenadines', title: 'Grenadines Kitesurf & Wingfoil Cruise',
  spots: ['Union Island', 'Tobago Cays', 'Mayreau', 'Canouan', 'Morpion', 'Palm Island', 'Fregate Island'],
};

test('rule 4: placeTerms keeps the names and drops generic geography and trip words', () => {
  const t = placeTerms(grenadines);
  for (const w of ['grenadines', 'vincent', 'tobago', 'mayreau', 'canouan', 'morpion', 'fregate']) assert.ok(t.includes(w), w);
  for (const w of ['island', 'union', 'palm', 'saint', 'kitesurf', 'wingfoil', 'cruise', 'the']) assert.ok(!t.includes(w), w);
});

test('rule 4: namedPlaces reads file names, plural and one-letter-off spellings', () => {
  const turks = placeTerms({ country: 'Turks and Caicos Islands', region: 'Turks and Caicos', spots: ['Grand Turk', 'Providenciales'] });
  assert.deepEqual(namedPlaces(`${V2}/the-trip-turks-3.jpg`, turks), ['turks', 'turk']);
  const g = placeTerms(grenadines);
  assert.deepEqual(namedPlaces(`${V2}/Paddleboarding-in-Mayrau-lagoon-with-kite-cruise.jpg`, g), ['mayreau']);
  assert.deepEqual(namedPlaces(`${V2}/Kite_Wing_Frigate.jpg`, g), ['fregate']);
  assert.deepEqual(namedPlaces(`${V2}/KitespotTobagoCays.jpg`, g), ['tobago']);
  assert.deepEqual(namedPlaces(`${V2}/Kite-Cruise-on-Luxury-Catamaran.jpg`, g), []);
});

test('rule 4: acceptVerdict for photos judged per listing', () => {
  assert.equal(acceptVerdict({ keep: true, place: 'generic' }, { tied: false }), null);
  assert.equal(acceptVerdict({ keep: true, place: 'this' }, { tied: true }), null);
  assert.equal(acceptVerdict({ keep: true, place: 'unsure' }, { tied: true }), null);
  assert.match(acceptVerdict({ keep: true, place: 'unsure' }, { tied: false }) ?? '', /unsure/);
  assert.match(acceptVerdict({ keep: true, place: 'other' }, { tied: true }) ?? '', /another place/);
  assert.match(acceptVerdict({ keep: false, place: 'generic' }, { tied: true }) ?? '', /not a fitting/);
  assert.match(acceptVerdict(null, { tied: true }) ?? '', /not judged/);
});

test('rule 4: a site-wide photo of a multi-destination provider needs every pass to call it placeless', () => {
  const ok = { keep: true, land: 'background' as const, place: null };
  assert.equal(acceptShared([ok, { ...ok, land: 'none' }]), null);
  assert.match(acceptShared([ok, { ...ok, land: 'prominent' }]) ?? '', /subject/);
  assert.match(acceptShared([ok, { ...ok, place: 'Anegada' }]) ?? '', /Anegada/);
  assert.match(acceptShared([ok, null]) ?? '', /every pass/);
  assert.match(acceptShared([]) ?? '', /every pass/);
  assert.match(acceptShared([ok, { ...ok, keep: false }]) ?? '', /not a fitting/);
});
