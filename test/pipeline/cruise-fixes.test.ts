// Audit 2026-10-27 data fixes: the rules behind `pnpm cli data-fixes plan` (rows trimmed from the live audit dump).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPerNightAmount, daysFromLabel, deriveCharterWeek, derivePerPerson, planCruiseFix, planPackageFix, revertPlan, SERVICE_FIXES, TEXT_FIXES, type CruiseRow } from '../../src/pipeline/cruise-fixes.js';

const TODAY = '2026-10-28';
const row = (over: Partial<CruiseRow>): CruiseRow => ({
  id: '00000000-0000-0000-0000-000000000000', slug: 's', title: 'T', country: 'Egypt', countries: ['Egypt'], region: 'Red Sea',
  continent: 'Africa', itinerary_spots: null, dates: null, pricing: null, price_from_eur: null, currency: 'EUR', price_pp_cabin: null,
  price_pp_cabin_currency: null, price_basis_note: null, season_text: null,
  price_charter_week: null, price_charter_week_currency: null, duration_days: null,
  summary: null, accommodation: null, included_services: null, optional_services: null, ...over,
});

test('derivePerPerson: skips upgrades, courses, rental, meals and per-night options', () => {
  const egypsy = { raw: '€ 1350 Cruise Only package', currency: 'EUR', options: [
    { basis: 'per_person', label: 'Cruise Only – Standard Shared Twin Cabin', price: 1350, currency: 'EUR' },
    { basis: 'per_cabin', label: 'Panorama King Bed Cabin (upgrade, per couple)', price: 500, currency: 'EUR' },
    { basis: 'per_person', label: 'Sea View Cabin (upgrade, per person)', price: 150, currency: 'EUR' },
    { basis: 'per_person', label: 'Single Cabin (upgrade, solo use)', price: 950, currency: 'EUR' },
    { basis: 'per_person', label: 'Beginner Kite Course (12h group + gear)', price: 550, currency: 'EUR' },
    { basis: 'per_person', label: 'Refreshing Course (6h group + 2-day rental)', price: 250, currency: 'EUR' },
  ] };
  assert.deepEqual(derivePerPerson(egypsy), { price: 1350, currency: 'EUR', source: 'option "Cruise Only – Standard Shared Twin Cabin"' });
  assert.equal(derivePerPerson({ raw: 'ab 249.- € pro Person pro Nacht', currency: 'EUR', per_person: 249,
    options: [{ basis: 'per_person', label: 'Per person per night (freerider – kitesurfing / wingfoiling)', price: 249, currency: 'EUR' }] }), null);
  assert.equal(derivePerPerson({ raw: 'starting at $7,470; Local fare at €575 per person', options: [
    { basis: 'whole_boat', label: 'Whole Boat – 1 week private charter', price: 7470, currency: 'USD' },
    { basis: 'per_person', label: 'Local fare meal package (per person)', price: 575, currency: 'EUR' },
  ] }), null);
  // the trip price itself may be called a fee
  assert.equal(derivePerPerson({ raw: 'Camp Fee: 1800 – 2200 euro / kiter', options: [{ basis: 'per_person', label: 'Camp Fee (per kiter)', price: 1800, currency: 'EUR' }] })!.price, 1800);
});

test('planCruiseFix: Egypsy upgrade surcharge -> the cruise price', () => {
  const e = planCruiseFix(row({
    pricing: { raw: '€ 1350 Cruise Only package', currency: 'EUR', options: [
      { basis: 'per_person', label: 'Cruise Only – Standard Shared Twin Cabin', price: 1350, currency: 'EUR' },
      { basis: 'per_cabin', label: 'Panorama King Bed Cabin (upgrade, per couple)', price: 500, currency: 'EUR' },
    ] },
    price_from_eur: 1350, price_pp_cabin: 250, price_pp_cabin_currency: 'EUR',
    price_basis_note: 'pp: cabin option "Panorama King Bed Cabin (upgrade, per couple)" ÷2 (double occupancy)',
  }), TODAY);
  assert.deepEqual(e.set.price_pp_cabin, { before: 250, after: 1350 });
  assert.equal(e.set.price_pp_cabin_currency, undefined); // unchanged
  assert.deepEqual(e.set.price_basis_note.after, 'pp: option "Cruise Only - Standard Shared Twin Cabin"'); // plain hyphen in what we write
  assert.equal(e.set.price_from_eur, undefined);
});

test('planCruiseFix: Kiteme gear rental -> trip price; null and 2025 dates dropped', () => {
  const e = planCruiseFix(row({
    pricing: { raw: 'From: €1,600.00', currency: 'EUR', options: [
      { basis: 'per_person', label: 'Kite Safari on the Red Sea (May 2025)', price: 1600, currency: 'EUR' },
      { basis: 'per_person', label: 'Full Gear Rental (1 week)', price: 450, currency: 'EUR' },
    ] },
    price_from_eur: 1600, price_pp_cabin: 450, price_pp_cabin_currency: 'EUR', price_basis_note: 'pp: cheapest per-person option "Full Gear Rental (1 week)"',
    dates: [{ price: 1750, status: null, currency: 'EUR', end_date: null, start_date: null }, { price: 1600, status: 'available', currency: 'EUR', end_date: null, start_date: '2025-05-01' }],
  }), TODAY);
  assert.deepEqual(e.set.price_pp_cabin, { before: 450, after: 1600 });
  assert.deepEqual(e.set.dates.after, [{ price: 1600, status: 'available', currency: 'EUR', end_date: null, start_date: '2025-05-01' }]); // past kept, empty row gone
  assert.match(e.why.join(' '), /add-on\/upgrade/);
});

test('planCruiseFix: per-night prices leave price_from_eur and p.p. empty, or use the EUR trip price', () => {
  const kai = planCruiseFix(row({
    pricing: { raw: 'ab 249.- € pro Person pro Nacht', currency: 'EUR', per_person: 249,
      options: [{ basis: 'per_person', label: 'Per person per night (freerider – kitesurfing / wingfoiling)', price: 249, currency: 'EUR' }] },
    price_from_eur: 249, price_pp_cabin: 249, price_pp_cabin_currency: 'EUR',
    price_basis_note: 'pp: cheapest per-person option "Per person per night (freerider – kitesurfing / wingfoiling)"',
  }), TODAY);
  assert.deepEqual([kai.set.price_pp_cabin.after, kai.set.price_pp_cabin_currency.after, kai.set.price_from_eur.after], [null, null, null]);
  const kai2027 = planCruiseFix(row({ pricing: { raw: 'ab 129€ pPpN', currency: 'EUR' }, price_from_eur: 129 }), TODAY);
  assert.deepEqual(kai2027.set.price_from_eur, { before: 129, after: null });
  const windlovers = planCruiseFix(row({
    pricing: { raw: '179 € pro Person / Nacht* ab – *Preis für eine 14-tägige Reise', currency: 'EUR', per_person: 179,
      options: [{ basis: 'per_person', label: 'Per person per night (low season, Croatia, max capacity, 14-day trip)', price: 179, currency: 'EUR' }] },
    price_from_eur: 179, price_pp_cabin: 2506, price_pp_cabin_currency: 'EUR', price_basis_note: 'pp: AI-parsed from pricing.raw',
  }), TODAY);
  assert.deepEqual(windlovers.set, { price_from_eur: { before: 179, after: 2506 } });
  // "7 nights" is a trip length, not a per-night price
  assert.deepEqual(planCruiseFix(row({ pricing: { raw: 'From €1750 /pers – 8 days / 7 nights' }, price_from_eur: 1750 }), TODAY).set, {});
});

test('planCruiseFix: continent, region, German text; a clean row stays empty', () => {
  const e = planCruiseFix(row({ id: '7bf8639b-3a24-462c-a75d-34e48909d680', continent: null, country: 'Bahamas', region: 'Bahamas / Exumas',
    title: 'Kitesafari nach Wunsch – Custom Red Sea Safari', season_text: 'individuell, Hurghada, Ägypten' }), TODAY);
  assert.deepEqual(e.set.continent, { before: null, after: 'North America' });
  assert.deepEqual(e.set.region, { before: 'Bahamas / Exumas', after: 'Exumas' });
  assert.equal(e.set.title.after, 'Custom Red Sea Kite Safari');
  assert.equal(e.set.season_text.after, 'Dates on request, from Hurghada, Egypt');
  assert.deepEqual(planCruiseFix(row({ dates: [{ start_date: '2027-03-01', end_date: '2027-03-08', price: 1500, currency: 'EUR', status: 'available' }] }), TODAY).set, {});
});

test('planPackageFix: YouTube hero and research notes', () => {
  const e = planPackageFix({ id: 'p', title: 'P', hero_video_url: 'https://www.youtube.com/watch?v=nexERs_Z8bM', accommodation: 'accommodation included (the page does not describe it)',
    summary: 'The price is PHP 19,900 per person with a minimum of 2 people; the safari page does not state the length, the home page lists it as 3 days / 2 nights. Guests choose.',
    optional_services: ['Kite surfing and winging in the lagoon (no kite school or rental named on the site)', 'Kayaking'] });
  assert.equal(e.set.hero_video_url.after, null);
  assert.equal(e.set.accommodation.after, '2 nights of accommodation included');
  assert.equal(e.set.summary.after, 'The price is PHP 19,900 per person with a minimum of 2 people; the safari runs 3 days / 2 nights. Guests choose.');
  assert.deepEqual(e.set.optional_services.after, ['Kite surfing and winging in the lagoon', 'Kayaking']);
  assert.deepEqual(planPackageFix({ id: 'q', title: 'Q', hero_video_url: 'https://x.example/hero.mp4', accommodation: null, summary: 'Fine.', optional_services: [] }).set, {});
});

test('revertPlan: swaps before and after', () => {
  const plan = [{ table: 'cruise_offers' as const, id: 'x', label: 'x', why: [], set: { price_pp_cabin: { before: 250, after: 1350 } } }];
  assert.deepEqual(revertPlan(plan)[0].set, { price_pp_cabin: { before: 1350, after: 250 } });
});

test('planCruiseFix: region parts repeating the first spot; Kite and Islands date-style season', () => {
  const e = planCruiseFix(row({ country: 'Fiji', region: 'Lau Group / Taveuni', itinerary_spots: [{ name: 'Taveuni' }, { name: 'Vanua Balavu' }] }), TODAY);
  assert.deepEqual(e.set.region, { before: 'Lau Group / Taveuni', after: 'Lau Group' });
  assert.equal(planCruiseFix(row({ country: 'Saint Vincent and the Grenadines', region: 'Caribbean / Grenadines', itinerary_spots: [{ name: 'Tobago Cays / Grenadines' }] }), TODAY).set.region.after, 'Caribbean');
  // a region that only repeats the spot stays (nothing left to show)
  assert.deepEqual(planCruiseFix(row({ country: 'Fiji', region: 'Taveuni', itinerary_spots: [{ name: 'Taveuni' }] }), TODAY).set, {});
  const k = planCruiseFix(row({ id: 'f02c2e45-0000-0000-0000-000000000000', season_text: 'Sa., 24. Okt. ab El Gouna' }), TODAY);
  assert.equal(k.set.season_text.after, 'Sat 24 Oct, from El Gouna');
});

test('planPackageFix: Spanish Kitesurfexperience promo lines -> English', () => {
  const e = planPackageFix({ id: 'k', title: 'K', hero_video_url: null, accommodation: null, summary: null, optional_services: [
    'Kite and wing rental (North)',
    'promo pre temporada enero-abril 2027: 10h lessons + 5 dias Hotel - COP 2,850,000 (10 h de clase kitesurf Instructor. Privado ...)',
  ] });
  assert.deepEqual(e.set.optional_services.after, ['Kite and wing rental (North)',
    'Pre-season promo January to April 2027: 10 h private IKO kite lessons with insurance + 4 nights / 5 days in a private bungalow (book by 30 October) - COP 2,850,000']);
});

test('no en or em dash in any text the plan writes (Aaron 2026-08-06)', () => {
  const written = [
    ...Object.values(TEXT_FIXES).flatMap(f => Object.values(f).map(x => x!.to)),
    ...SERVICE_FIXES.map(([, to]) => to),
  ];
  for (const t of written) assert.doesNotMatch(t, /[–—]/, t);
});

test('charter: quoted week price instead of the x7/days re-scale (Aaron 2026-10-28)', () => {
  assert.deepEqual([daysFromLabel('8 days / 7 nights (November – April)'), daysFromLabel('1 week'), daysFromLabel('Per day (up to 8 pax)'), daysFromLabel('Whole Boat (from)')], [8, 7, 1, null]);
  // Quest Sailing: "8 days / 7 nights: November-April $29,000" was stored as 25,375
  const quest = planCruiseFix(row({ duration_days: 8, price_charter_week: 25375, price_charter_week_currency: 'USD',
    price_basis_note: 'charter/wk: whole-boat option "8 days / 7 nights (November – April)" ×7/8d',
    pricing: { currency: 'USD', options: [
      { basis: 'whole_boat', label: '8 days / 7 nights (November – April)', price: 29000, currency: 'USD' },
      { basis: 'whole_boat', label: '8 days / 7 nights (July – August)', price: 39000, currency: 'USD' },
    ] } }), TODAY);
  assert.deepEqual(quest.set.price_charter_week, { before: 25375, after: 29000 });
  assert.equal(quest.set.price_basis_note.after, 'charter/wk: whole-boat option "8 days / 7 nights (November - April)" (quoted)');
  // Paradise Kite Cruise Bahamas: "from 12,500 $", 6 days, shown as 14,583
  assert.equal(planCruiseFix(row({ duration_days: 6, price_charter_week: 14583, price_charter_week_currency: 'USD',
    price_basis_note: 'charter/wk: whole-boat option "Whole Boat (from)" (no duration → taken as weekly)',
    pricing: { currency: 'USD', options: [{ basis: 'whole_boat', label: 'Whole Boat (from)', price: 12500, currency: 'USD' }] } }), TODAY).set.price_charter_week.after, 12500);
  // Caribbean Kite Cruise: the 7-day quote wins over the 10-day one re-scaled
  assert.deepEqual(deriveCharterWeek({ currency: 'USD', options: [
    { basis: 'whole_boat', label: 'Private Cruise DR – 6 guests (7 days)', price: 12500, currency: 'USD' },
    { basis: 'whole_boat', label: 'Private Cruise DR – 6 guests (10 days)', price: 15900, currency: 'USD' },
  ] }, 7), { price: 12500, currency: 'USD', source: 'whole-boat option "Private Cruise DR – 6 guests (7 days)"' });
  // a day rate x 7 stays; a correct quote is no change
  assert.deepEqual(planCruiseFix(row({ price_charter_week: 10948, price_charter_week_currency: 'EUR',
    pricing: { currency: 'EUR', options: [{ basis: 'whole_boat', label: 'Per day (up to 8 pax)', price: 1564, currency: 'EUR' }] } }), TODAY).set, {});
});

test('charter: a x7/7 row is left alone (its value may be a newer monitor read); CBCM override is guarded', () => {
  assert.deepEqual(planCruiseFix(row({ duration_days: 7, price_charter_week: 16000, price_charter_week_currency: 'EUR',
    price_basis_note: 'charter/wk: whole-boat option "Full Boat Charter (up to 8 guests)" ×7/7d',
    pricing: { currency: 'EUR', options: [{ basis: 'whole_boat', label: 'Full Boat Charter (up to 8 guests)', price: 15200, currency: 'EUR' }] } }), TODAY).set, {});
  const cbcm = planCruiseFix(row({ id: 'f030d504-0000-0000-0000-000000000000', price_pp_cabin: 2640, price_pp_cabin_currency: 'EUR',
    price_charter_week: 18944, price_charter_week_currency: 'EUR', price_basis_note: 'pp: pricing.per_person | charter/wk: pricing.whole_boat ×7/8d' }), TODAY);
  assert.deepEqual([cbcm.set.price_pp_cabin.after, cbcm.set.price_charter_week.after], [2200, 17520]);
  // the guard: once the stored values moved, the override stays out
  assert.equal(planCruiseFix(row({ id: 'f030d504-0000-0000-0000-000000000000', price_pp_cabin: 2200, price_charter_week: 17520 }), TODAY).set.price_pp_cabin, undefined);
});

test('isPerNightAmount: the extraction guard behind "on request" (Aaron 2026-10-28)', () => {
  assert.equal(isPerNightAmount({ raw: 'ab 249.- € pro Person pro Nacht' }, 249), true);
  assert.equal(isPerNightAmount({ raw: 'ab 129€ pPpN' }, 129), true);
  assert.equal(isPerNightAmount({ raw: 'x', options: [{ basis: 'per_person', label: 'Per person per night', price: 179 }] }, 179), true);
  assert.equal(isPerNightAmount({ raw: '179 € pro Person / Nacht ab, Preis für eine 14-tägige Reise' }, 2506), false); // the trip price stays
  assert.equal(isPerNightAmount({ raw: 'From €1750 /pers – 8 days / 7 nights' }, 1750), false);
  assert.equal(isPerNightAmount({ raw: 'ab 249.- € pro Person pro Nacht' }, null), false);
});

test('plain hyphens in shown text; plainDashes', async () => {
  const { plainDashes } = await import('../../src/lib/offer-text.js');
  assert.equal(plainDashes('Kite & Sail Caribbean – High Season'), 'Kite & Sail Caribbean - High Season');
  assert.equal(plainDashes('April–October'), 'April-October');
  assert.equal(plainDashes(null), null);
  const e = planCruiseFix(row({ title: 'Red Sea Kite Safari – 8 Days', season_text: 'April–October', optional_services: ['Gear – on request', 'SUP'] }), TODAY);
  assert.deepEqual([e.set.title.after, e.set.season_text.after, e.set.optional_services.after], ['Red Sea Kite Safari - 8 Days', 'April-October', ['Gear - on request', 'SUP']]);
  // a translation and the dash pass compose: the source title had a dash, the result has none
  const k = planCruiseFix(row({ id: '7bf8639b-0000-0000-0000-000000000000', title: 'Kitesafari nach Wunsch – Custom Red Sea Safari' }), TODAY);
  assert.deepEqual(k.set.title, { before: 'Kitesafari nach Wunsch – Custom Red Sea Safari', after: 'Custom Red Sea Kite Safari' });
  const p = planPackageFix({ id: 'p', title: 'Camp – Week', hero_video_url: null, accommodation: null, summary: null, optional_services: ['A – B'] });
  assert.deepEqual([p.set.title.after, p.set.optional_services.after], ['Camp - Week', ['A - B']]);
});
