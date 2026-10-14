// ---------------------------------------------------------------------------
// Kite Crew caravans, Chałupy 6 campsite (Chałupy, Hel Peninsula, Poland) - the Kite Crew kite & surf school rents
// out 6 caravans with awnings right behind its school office on the Chałupy 6 campsite (Puck Bay side), "for our
// course participants first". Campsite rule: only the rental caravans are listed (no pitches). Kite link: the
// school's own base; beach access through the school base.
//
// Liveness (2026-10-12): "Cennik 2026" table, page dateModified 2026-04-15, caravan photos uploaded 2026-02/04.
//   The 2026 season is over; 2027 prices are not published yet.
// Data path (checked 2026-10-12): WordPress, Polish only, one page /przyczepy/:
//   slots    "Cennik 2026": "Wysoki sezon (obejmuje 1-4.05, 3-7.06, 19-21.06, 26.06-31.08)" with "800zł */ dobę za
//            przyczepy Standard: przyczepa nr 1-OCEAN (max 4 os); ..." and "850zł */ dobę za przyczepy typu Komfort:
//            ..."; "Niski sezon (okresy między 4 maja – 3 czerwca, 8-19 czerwca, 21-26.06, 31.08-13 września) : 50%
//            ceny* czyli 400zł lub 425zł/ dobę" (+ campsite fees 30 zł per person/day and 30 zł per car); weekly summer
//            terms (Sunday to Sunday, 7 nights) and "16-23.08 niedostępny".
//   content  the same page (caravan types, equipment, payment, campsite) + the gallery captions per caravan.
// No booking engine: bookings by e-mail (info@kitecrew.pl) or phone/WhatsApp -> 'on_request'.
// robots.txt (2026-10-12): only /wp-admin/ disallowed (admin-ajax allowed).
// Requests per run: 1 (memoised; content and slots share the page).
// Parsed: per caravan, every season day gets a price class (high wins where the printed high and low ranges share a
//   boundary day, inferred), runs of equal days become bands ("przyczepa-3|2026-06-26"), PLN per caravan and night,
//   occupancy = "max N os". Summer high band: minimum 7 nights (weekly terms). The week printed as "niedostępny" is
//   'sold_out' (read as Sunday arrival to Sunday departure, nights 16-22.08, inferred), everything else 'on_request'.
// Known limits: low-season prices exclude the per-person campsite fees (in the features, not in the price); the
//   climate fee (3.40 zł per person/day) is extra all season; every 2026 band ended by 2026-10-12 -> "price on
//   request" until the 2027 table appears. No map pin on the site.
// Uses the Polish date-range helpers exported by kite-pl-caravans-chalupy.
// ---------------------------------------------------------------------------
import { collapse, imageCandidates, iso, runsOf } from '../parse.js';
import type { Availability, ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';
import { eachDay, getPage, inRange, plLines, plRanges, type PlRange } from './kite-pl-caravans-chalupy.js';

const SITE = 'https://www.kitecrew.pl';
export const KCR_CARAVANS_URL = `${SITE}/przyczepy/`;
const COURSES_URL = `${SITE}/portfolio/obozy-kitesurfingowe-chalupy-6/`;

export interface KcrCaravan { no: number; name: string; cls: 'Standard' | 'Komfort'; maxGuests: number | null; description: string | null }
export interface KcrClass { cls: 'Standard' | 'Komfort'; high: number; low: number | null }
export interface KcrPage {
  year: number | null;
  high: PlRange[];
  low: PlRange[];
  unavailable: Array<PlRange & { nights: { start: string; end: string } }>;
  classes: KcrClass[];
  caravans: KcrCaravan[];
  campFeePerPerson: number | null;
  campFeePerCar: number | null;
  climateFee: number | null;
  deposit: number | null;
}

const titleCase = (s: string): string => (s.length <= 3 ? s : s[0] + s.slice(1).toLowerCase());
const num = (s: string | undefined): number | null => (s ? Number(s.replace(',', '.')) : NaN) || null;

export function parseKcrPage(html: string): KcrPage {
  const t = plLines(html).join(' ');
  const year = num(t.match(/Cennik (20\d{2})/i)?.[1]);
  const y = year ?? 0;
  const high = year ? plRanges(t.match(/Wysoki sezon \(obejmuje ([^)]*)\)/i)?.[1] ?? '', y) : [];
  const low = year ? plRanges(t.match(/Niski sezon \(okresy między\s*([^)]*)\)/i)?.[1] ?? '', y) : [];
  // weekly terms: "16-23.08 niedostępny" = Sunday arrival .. Sunday departure -> nights end-1 (inferred)
  const unavailable = year ? [...t.matchAll(/([\d.\s–-]+?\d{1,2}\.\d{1,2})\s*niedostępn/gi)].flatMap(m => plRanges(m[1], y)).map(r => ({
    ...r, nights: { start: r.start, end: new Date(Date.parse(r.end) - 86400000).toISOString().slice(0, 10) },
  })) : [];

  const classes: KcrClass[] = [];
  const caravans: KcrCaravan[] = [];
  for (const m of t.matchAll(/(\d+)\s*zł\s*\*?\s*\/\s*dobę\s*za przyczepy (?:typu )?(Standard|Komfort)\s*:\s*(.*?)(?=\d+\s*zł\s*\*?\s*\/\s*dobę|\*\s*[–-]|$)/gi)) {
    const cls = (m[2][0].toUpperCase() + m[2].slice(1).toLowerCase()) as KcrClass['cls'];
    classes.push({ cls, high: Number(m[1]), low: null });
    for (const c of m[3].matchAll(/przyczepa (?:nr )?(\d+)\s*[-–]?\s*([A-ZĄĆĘŁŃÓŚŹŻ]{2,})\s*\(\s*max (\d+) os\s*\)/g)) {
      caravans.push({ no: Number(c[1]), name: titleCase(c[2]), cls, maxGuests: Number(c[3]), description: null });
    }
  }
  // "50% ceny* czyli 400zł lub 425zł/ dobę": same order as the classes; kept only when it is the stated share
  const lows = t.match(/(\d+)%\s*ceny\*?\s*czyli\s*(\d+)\s*zł\s*lub\s*(\d+)\s*zł/i);
  if (lows && classes.length === 2) {
    const share = Number(lows[1]) / 100;
    [Number(lows[2]), Number(lows[3])].forEach((v, i) => { if (Math.abs(classes[i].high * share - v) <= 5) classes[i].low = v; });
  }
  // gallery captions: "Przyczepa 1 OCEAN – Standard 4-osobowa, ... Max ilość osób = 4."
  for (const m of t.matchAll(/Przyczepa (\d+) ([A-ZĄĆĘŁŃÓŚŹŻ]{2,}) [–-] (?:typu )?(?:Standard|Komfort)\s+(.*?Max ilość osób = \d+\.?)/g)) {
    const c = caravans.find(x => x.no === Number(m[1]));
    if (c) c.description = collapse(m[3]);
  }
  const fees = t.match(/opłaty kempingowe\s*dzienne:\s*(\d+)\s*zł\s*\/os\/dzień,\s*(\d+)\s*zł\s*\/auto/i);
  return {
    year, high, low, unavailable, classes, caravans,
    campFeePerPerson: num(fees?.[1]),
    campFeePerCar: num(fees?.[2]),
    climateFee: num(t.match(/opłata klimatyczna[^=]*=\s*([\d,]+)\s*zł\s*\/os\/dzień/i)?.[1]),
    deposit: num(t.match(/Kaucję (\d+)\s*zł/i)?.[1]),
  };
}

const unitName = (c: KcrCaravan): string => `Caravan ${c.no} ${c.name} (${c.cls === 'Komfort' ? 'Comfort' : 'Standard'})`;

export function buildKcrSlots(p: KcrPage): Slot[] {
  if (!p.year || (p.high.length === 0 && p.low.length === 0)) return [];
  const all = [...p.high, ...p.low];
  const start = all.map(r => r.start).sort()[0];
  const end = all.map(r => r.end).sort().reverse()[0];
  const weekly = p.high.filter(r => (Date.parse(r.end) - Date.parse(r.start)) / 86400000 > 7);
  const out: Slot[] = [];
  for (const c of p.caravans) {
    const cls = p.classes.find(k => k.cls === c.cls);
    if (!cls) continue;
    const days = eachDay(start, end).map(date => {
      const tier = p.high.some(r => inRange(date, r)) ? (weekly.some(r => inRange(date, r)) ? 'summer' : 'high')
        : p.low.some(r => inRange(date, r)) ? 'low' : 'none';
      const off = p.unavailable.find(r => inRange(date, r.nights));
      return { date, tier, off: off ? off.raw : null };
    }).filter(d => d.tier !== 'none');
    for (const run of runsOf(days, d => `${d.tier}|${d.off ?? ''}`)) {
      const price = run.first.tier === 'low' ? cls.low : cls.high;
      const availability: Availability = run.first.off ? 'sold_out' : 'on_request';
      out.push({
        key: `przyczepa-${c.no}|${run.start}`,
        startDate: run.start,
        endDate: run.end,
        unit: unitName(c),
        price,
        currency: price === null ? null : 'PLN',
        priceUnit: price === null ? null : 'per_night',
        priceBasis: price === null ? null : 'room',
        occupancy: c.maxGuests,
        availability,
        availabilityText: run.first.off ? `${run.first.off} niedostępny` : null,
        spotsLeft: null,
        minNights: run.first.tier === 'summer' ? 7 : null,
      });
    }
  }
  return out;
}

const DESC_FEATURES: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  [/(\d|dwa) podwójne łóżka/i, m => `${m[1] === 'dwa' ? 2 : m[1]} double beds`],
  [/łóżk[a-ząęóśł]* piętrow/i, () => 'Bunk bed'],
  [/łóżko (?:francuskie|małżeńskie|2-osobowe)/i, () => 'Double bed'],
  [/trzy kanapy rozkładane/i, () => 'Three sofas converting to double beds'],
  [/podkowa/i, () => 'U-shaped sofa converting to a bed'],
  [/łóżko pojedyncze|łóżko 1 os/i, () => 'Single bed'],
  [/aneks kuchenny/i, () => 'Kitchenette in the awning'],
  [/drewnianą podłogą/i, () => 'Awning with wooden floor'],
  [/Isabella/i, () => 'Isabella awning'],
];

export function parseKiteCrewContent(html: string): OfferContent {
  const p = parseKcrPage(html);
  const t = plLines(html).join(' ');
  const highs = p.classes.map(c => c.high);
  const lows = p.classes.map(c => c.low).filter((x): x is number => x !== null);
  const summer = p.high.find(r => (Date.parse(r.end) - Date.parse(r.start)) / 86400000 > 7);
  const fmt = (d: string) => `${Number(d.slice(8, 10))} ${['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][Number(d.slice(5, 7))]}`;
  const all = [...p.high, ...p.low];
  const seasonStart = all.map(r => r.start).sort()[0];
  const seasonEnd = all.map(r => r.end).sort().reverse()[0];

  const shared = [
    /nie posiadają podłączenia do wody/i.test(t) && 'No water connection or toilet inside: shared showers and toilets 20-30 m away',
    /kuchenka turystyczna elektryczna/i.test(t) && 'Electric camping hob, cordless kettle, crockery, cutlery, pan, pot, camping fridge',
    /farelka/i.test(t) && 'Fan heater',
    /wieszak na pianki/i.test(t) && 'Wetsuit rack in the awning',
    /Pościel we własnym zakresie/i.test(t) && 'Bring your own bedding (sleeping bag, sheet, pillows)',
  ].filter((x): x is string => !!x);
  const rooms: ContentRoom[] = p.caravans.map(c => {
    const cls = p.classes.find(k => k.cls === c.cls);
    return {
      name: unitName(c),
      description: `${c.cls === 'Komfort' ? 'Comfort' : 'Standard'} caravan with awning behind the Kite Crew school office on the Chałupy 6 campsite${c.maxGuests ? `, up to ${c.maxGuests} guests` : ''}.`,
      features: [
        ...DESC_FEATURES.map(([re, f]) => { const m = (c.description ?? '').match(re); return m ? f(m) : null; }).filter((x): x is string => !!x),
        ...(c.cls === 'Komfort' && /Przyczepy Komfort posiadają większe stoły/i.test(t) ? ['Larger table, coffee table and deckchairs in the awning'] : []),
        ...shared,
        ...(cls ? [`High season PLN ${cls.high} per night (campsite fees and one car included)`] : []),
        ...(cls?.low ? [`Low season PLN ${cls.low} per night plus campsite fees${p.campFeePerPerson ? ` (PLN ${p.campFeePerPerson} per person and day${p.campFeePerCar ? `, PLN ${p.campFeePerCar} per car` : ''})` : ''}`] : []),
      ],
    };
  });

  const imageUrls: string[] = [];
  for (const u of imageCandidates(html, KCR_CARAVANS_URL, null, 80)) {
    if (/mapa|logo|\.svg|icon/i.test(u)) continue;
    if (!imageUrls.includes(u)) imageUrls.push(u);
  }

  const summary = [
    `Kite Crew, a kite and surf school on the Chałupy 6 campsite on the Puck Bay side of the Hel Peninsula, rents out ${p.caravans.length} caravans with equipped awnings right behind its school office, with beach access through the school base and shared showers and toilets 20-30 m away; course participants get them first.`,
    p.year && highs.length
      ? `The ${p.year} price list ran from ${fmt(seasonStart)} to ${fmt(seasonEnd)}: PLN ${Math.min(...highs)} (Standard) or ${Math.max(...highs)} (Comfort) per caravan and night in high season including campsite fees and one car${summer ? `, rented by the week from Sunday to Sunday in summer (${fmt(summer.start)} to ${fmt(summer.end)})` : ''}${lows.length ? `, and half that (PLN ${Math.min(...lows)} or ${Math.max(...lows)}) plus per-person campsite fees in low season` : ''}.`
      : null,
    `Caravans sleep up to ${Math.max(...p.caravans.map(c => c.maxGuests ?? 0))} guests, have an electric hob, fridge and fan heater, and guests bring their own bedding${p.climateFee ? `; the local climate fee (PLN ${p.climateFee.toFixed(2)} per person and day) is extra` : ''}.`,
  ].filter(Boolean).join(' ');

  return {
    kind: 'accommodation',
    title: 'Kite Crew caravans, Chałupy 6',
    summary,
    continent: 'Europe',
    country: 'Poland',
    region: 'Chałupy, Hel Peninsula',
    spot: 'Chałupy',
    itinerarySpots: [],
    durationDays: null,
    skillLevels: [],
    kiteLessons: /kursy kitesurfingu|Kurs Kitesurfingu/i.test(t),
    equipmentRental: null,
    beginnerFriendly: /rozpocząć naukę kitesurfingu może każdy/i.test(t) ? true : null,
    includedServices: ['Campsite fees and one car parking in high season', 'Equipped awning with table and chairs'],
    optionalServices: [
      'Kitesurfing courses (PZKite levels 1-4) and private lessons at Kite Crew',
      'Kite camps (Kite & Yoga, Wake & Kite, Kite Active Camp)',
      ...(p.climateFee ? [`Climate fee PLN ${p.climateFee.toFixed(2)} per person and day (cash)`] : []),
    ],
    accommodation: 'caravans with awnings on a campsite',
    mealPlan: 'self_catering',
    languages: ['pl'],
    rooms,
    imageUrls: imageUrls.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: KCR_CARAVANS_URL,
    bookingUrl: KCR_CARAVANS_URL,
    sourceText: [
      `caravans: ${(t.match(/Cennik 20\d{2}[\s\S]*?Atrakcje kempingu/) ?? [t.slice(0, 8000)])[0]}`,
      `parsed: year ${p.year}; high ${p.high.map(r => `${r.start}..${r.end}`).join(', ')}; low ${p.low.map(r => `${r.start}..${r.end}`).join(', ')}; unavailable ${p.unavailable.map(r => r.raw).join(', ')}`,
      `classes: ${p.classes.map(c => `${c.cls} high ${c.high} low ${c.low}`).join('; ')}; fees ${p.campFeePerPerson}/person ${p.campFeePerCar}/car, climate ${p.climateFee}, deposit ${p.deposit}`,
      `more courses / camps: ${COURSES_URL}`,
    ].join('\n'),
  };
}

export const kiteCrewCaravansChalupy: OfferAdapter = {
  key: 'kite-crew-caravans-chalupy',
  name: 'Kite Crew caravans Chałupy 6',
  kind: 'accommodation',
  operator: {
    name: 'Kite Crew',
    websiteUrl: SITE,
    rootDomain: 'kitecrew.pl',
    contactEmail: 'info@kitecrew.pl',
    phone: '+48 789 424 210',
    whatsapp: '+48 789 424 210',
  },
  url: KCR_CARAVANS_URL,
  slotMethod: 'price_table',
  fetchBudget: 2,
  confidence: 'medium',
  async fetchContent() {
    return parseKiteCrewContent(await getPage(KCR_CARAVANS_URL));
  },
  async fetchSlots(ctx) {
    const p = parseKcrPage(await getPage(KCR_CARAVANS_URL));
    if (!p.year || p.high.length === 0) throw new Error('kite-crew-caravans-chalupy: "Cennik YYYY" / "Wysoki sezon (obejmuje ...)" not found');
    if (p.caravans.length === 0 || p.classes.length === 0) throw new Error('kite-crew-caravans-chalupy: caravan classes ("NNNzł */ dobę za przyczepy ...") not found');
    if (p.classes.some(c => c.low === null)) ctx.note('low-season prices ("50% ceny* czyli ...") not matched; low bands carry no price');
    if (iso(p.year, 12, 31) < new Date().toISOString().slice(0, 10)) ctx.note(`price list ${p.year} is in the past; waiting for the next one`);
    return buildKcrSlots(p);
  },
};
