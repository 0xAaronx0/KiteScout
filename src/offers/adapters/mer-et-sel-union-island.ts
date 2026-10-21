// ---------------------------------------------------------------------------
// Mer & Sel Villa & Suites, Union Island (St Vincent and the Grenadines) - the accommodation of JT Pro Center,
// the kitesurf and wing foil school of pro rider Jeremie Tronet: a two-bedroom villa above the bay with two
// ocean-view suites and a cozy room below, about 7 minutes by golf cart from the school's kite spot.
//
// Data path (checked 2026-10-12): WordPress (block theme), server-rendered, English:
//   content  /hotel-union-island/ (villa / suites / cozy room / golf carts sections, rate table, tax note)
//            + /jtprocenter/ (the school: lessons, rental, kite cruises, "Mid Nov to Jul" wind season,
//            "Season update" naming the upcoming 2026-2027 season).
//   slots    <figure class="wp-block-table ratetable"> on /hotel-union-island/: rows = season ("November 20th
//            to April 14th"), columns = 2 Bedroom Villa / Private Mayreau View Suite / Cozy Room, cells
//            "990 USD/night", "295 USD/night per suite". The table has no year: the bands are anchored on the
//            page's JSON-LD WebPage dateModified (2026-08-11 on 2026-10-12) - the band that contains the edit
//            date plus the following bands, one full 12-month cycle (inferred), so 2026-08-01 .. 2027-07-31.
//            Bands that ended before today are dropped.
// Booking: "Contact us to reserve" / "Ask for Availability" (contact form, e-mail, WhatsApp) -> 'on_request'.
// robots.txt (2026-10-12): only /wp-admin/ disallowed.
// Requests per run: content 2, slots 1 (pages memoised for 10 minutes, so a full run makes 2).
// Parsed: slot = unit x season band ("2-bedroom-villa|2026-11-20"), USD per unit per night (the villa as a
//   whole, a suite each, the cozy room), plus 11% government tax and US$3 environment fee per room and night.
// Known limits: year inferred from the page edit (see above); after the last band the offer falls back to
//   "price on request" until the page is edited again. Occupancy is not stated per unit.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, imageCandidates, iso, ldOfType, monthOf, parse, parseAmount, todayIso } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.kitesurfgrenadines.com';
export const MES_HOTEL_URL = `${SITE}/hotel-union-island/`;
export const MES_SCHOOL_URL = `${SITE}/jtprocenter/`;
const CONTACT_URL = `${SITE}/contact/`;

export interface MesRate { unit: string; season: string; from: { m: number; d: number }; to: { m: number; d: number }; amount: number; currency: string }

// --- local helpers ----------------------------------------------------------------------------
const memo = new Map<string, { at: number; p: Promise<string> }>();
/** one fetch per page per 10 minutes: fetchContent + fetchSlots in the same run share it */
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}
const keyPart = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
function addDays(isoDate: string, n: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** "November 20th" -> { m: 11, d: 20 } */
function monthDay(s: string): { m: number; d: number } | null {
  const m = s.trim().match(/^([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?$/);
  const mo = m ? monthOf(m[1]) : null;
  return m && mo ? { m: mo, d: Number(m[2]) } : null;
}
function pageText(html: string): string {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, header, footer, nav')) el.remove();
  return collapse((root.querySelector('main') ?? root.querySelector('body') ?? root).text);
}

// --- pure parsers -----------------------------------------------------------------------------
/** The season x unit rate table (thead = units, tbody rows = "<Month> <day> to <Month> <day>"). */
export function parseMesRates(html: string): MesRate[] {
  const table = parse(html).querySelectorAll('table').find(t => /season/i.test(t.querySelector('thead')?.text ?? ''));
  if (!table) return [];
  const units = table.querySelectorAll('thead th').map(th => collapse(th.text)).slice(1);
  const out: MesRate[] = [];
  for (const tr of table.querySelectorAll('tbody tr')) {
    const label = collapse(tr.querySelector('th')?.text ?? '');
    const [a, b] = label.split(/\s+to\s+/i);
    const from = a ? monthDay(a) : null;
    const to = b ? monthDay(b) : null;
    if (!from || !to) continue;
    tr.querySelectorAll('td').forEach((td, i) => {
      const t = collapse(td.text);
      const amount = parseAmount(t);
      const currency = /\bUSD\b|US\$|\$/.test(t) ? 'USD' : null;
      if (units[i] && amount && currency) out.push({ unit: units[i], season: label, from, to, amount, currency });
    });
  }
  return out;
}

/** Last edit of the page (JSON-LD WebPage dateModified), YYYY-MM-DD. */
export function mesEditDate(html: string): string | null {
  const wp = ldOfType(html, 'WebPage').find(o => typeof o.dateModified === 'string');
  return (wp?.dateModified as string | undefined)?.slice(0, 10) ?? null;
}

/** Tick lists (<ul class="room__list">) with the room title (<h2 class="room__title">) before each. */
export function mesRoomLists(html: string): Array<{ title: string; items: string[] }> {
  const marks: Array<{ at: number; title?: string; list?: string }> = [];
  for (const m of html.matchAll(/<h2[^>]*room__title[^>]*>([\s\S]*?)<\/h2>/g)) marks.push({ at: m.index!, title: collapse(parse(m[1]).text) });
  for (const m of html.matchAll(/<ul[^>]*room__list[^>]*>[\s\S]*?<\/ul>/g)) marks.push({ at: m.index!, list: m[0] });
  marks.sort((a, b) => a.at - b.at);
  const out: Array<{ title: string; items: string[] }> = [];
  let title: string | null = null;
  for (const mk of marks) {
    if (mk.title) { title = mk.title; continue; }
    if (!title || !mk.list) continue;
    const items = parse(mk.list).querySelectorAll('li').map(li => collapse(li.text).replace(/^✓\s*/, '').replace(/\.$/, '')).filter(Boolean);
    out.push({ title, items });
    title = null;
  }
  return out;
}

/** Seasons as dated bands: one 12-month cycle starting with the band that contains `anchor`. */
export function mesBands(rates: MesRate[], anchor: string): Array<{ season: string; start: string; end: string }> {
  const seasons: Array<{ season: string; from: { m: number; d: number }; to: { m: number; d: number } }> = [];
  for (const r of rates) if (!seasons.some(s => s.season === r.season)) seasons.push({ season: r.season, from: r.from, to: r.to });
  if (!seasons.length) return [];
  const y = Number(anchor.slice(0, 4));
  // the occurrence of each season that contains the anchor (start in y-1 or y)
  const occurrence = (s: (typeof seasons)[number], startYear: number) => {
    const start = iso(startYear, s.from.m, s.from.d);
    const endYear = s.to.m < s.from.m || (s.to.m === s.from.m && s.to.d < s.from.d) ? startYear + 1 : startYear;
    return { season: s.season, start, end: iso(endYear, s.to.m, s.to.d) };
  };
  const hits: Array<{ i: number; band: { season: string; start: string; end: string } }> = [];
  seasons.forEach((s, i) => {
    for (const sy of [y - 1, y]) {
      const o = occurrence(s, sy);
      if (o.start <= anchor && anchor <= o.end) hits.push({ i, band: o });
    }
  });
  if (!hits.length) return [];
  const idx = hits[0].i;
  const out = [hits[0].band];
  for (let k = 1; k < seasons.length; k++) {
    const s = seasons[(idx + k) % seasons.length];
    const prevEnd = out[out.length - 1].end;
    const next = addDays(prevEnd, 1);
    // the season must start the day after the previous one ends (contiguous table); otherwise stop
    if (Number(next.slice(5, 7)) !== s.from.m || Number(next.slice(8, 10)) !== s.from.d) break;
    out.push(occurrence(s, Number(next.slice(0, 4))));
  }
  return out;
}

export function buildMesSlots(rates: MesRate[], anchor: string, today: string): Slot[] {
  const out: Slot[] = [];
  for (const band of mesBands(rates, anchor)) {
    if (band.end < today) continue;
    for (const r of rates.filter(x => x.season === band.season)) {
      out.push({
        key: `${keyPart(r.unit)}|${band.start}`,
        startDate: band.start,
        endDate: band.end,
        unit: r.unit,
        price: r.amount,
        currency: r.currency,
        priceUnit: 'per_night',
        priceBasis: 'room',
        occupancy: null,
        availability: 'on_request',
        availabilityText: null,
        spotsLeft: null,
      });
    }
  }
  return out;
}

export interface MesPages { hotel: string; school: string }

export function parseMerEtSelContent(p: MesPages): OfferContent {
  const hotel = pageText(p.hotel);
  const school = pageText(p.school);
  const rates = parseMesRates(p.hotel);
  const lists = mesRoomLists(p.hotel);
  const villaFeatures = lists.find(l => /villa/i.test(l.title))?.items ?? [];
  const suiteFeatures = lists.find(l => /suites?/i.test(l.title))?.items ?? [];
  const cozy = hotel.match(/(The Cozy Room is the smallest[^.]*\.[^.]*\.[^.]*\.)/)?.[1] ?? null;
  const priceOf = (unit: RegExp) => {
    const xs = rates.filter(r => unit.test(r.unit)).map(r => r.amount);
    return xs.length ? { min: Math.min(...xs), max: Math.max(...xs) } : null;
  };
  const villa = priceOf(/villa/i);
  const suite = priceOf(/suite/i);
  const room = priceOf(/cozy/i);
  const band = (x: { min: number; max: number } | null, label: string) => (x ? `${label} USD ${x.min}-${x.max}` : null);
  const tax = hotel.match(/Room rates are subject to [^.]*\./)?.[0] ?? null;
  const launchFee = /Kitebeach launch fee is included/i.test(hotel);
  const season = school.match(/Mid Nov to Jul/i) ? 'mid November to July' : null;
  const cart = hotel.match(/Golf cart, 2 or 4-seater: US\$(\d+) per day\. Scooter\/Moped: US\$(\d+) per day/);

  const rooms: ContentRoom[] = [
    {
      name: '2 Bedroom Villa',
      description: 'Private two-bedroom villa on the upper level with direct views over Mayreau, the Tobago Cays and the JT Pro Center kite spot.',
      features: villaFeatures.length ? villaFeatures : ['Two king bedrooms with private bathrooms and balconies'],
    },
    {
      name: 'Private Mayreau View Suite',
      description: 'Two suites below the villa, each with its own entrance, patio and bathroom; bookable alone, together or with the villa.',
      features: suiteFeatures.length ? suiteFeatures : ['305 sq ft (28 m²)', 'King-size bed'],
    },
    {
      name: 'Cozy Room',
      description: cozy,
      features: ['176 sq ft (16 m²)', 'Queen-size bed', 'Private entrance', 'Shared kitchen on the same level'],
    },
  ];

  const seen = new Set<string>();
  const imageUrls: string[] = [];
  for (const u of imageCandidates(p.hotel, MES_HOTEL_URL, null, 60)) {
    if (!/\/wp-content\/uploads\//.test(u) || /logo|mark|icon|\.svg|\.png$/i.test(u)) continue;
    const k = u.replace(/-(?:\d+x\d+|scaled)(?=\.[a-z]+$)/i, '').replace(/\.(?:jpe?g|webp)$/i, '');
    if (seen.has(k)) continue;
    seen.add(k); imageUrls.push(u);
  }

  const summary = [
    'Mer & Sel Villa & Suites is the accommodation of JT Pro Center, the kitesurf and wing foil school of pro rider Jeremie Tronet on Union Island in the Grenadines (St Vincent and the Grenadines), about 7 minutes by golf cart or 15 minutes on foot from the school\'s kite spot.',
    'It has a two-bedroom villa with a full kitchen and views over Mayreau and the Tobago Cays, two 28 m² ocean-view suites with private entrances and a smaller cozy room, all with Starlink internet and daily housekeeping.',
    [band(villa, 'Nightly rates: villa'), band(suite, 'suite'), band(room, 'cozy room')].filter(Boolean).join(', ') + (villa || suite || room ? ' depending on season, plus 11% tax.' : ''),
    `The school offers private kite and wing foil lessons, gear rental, boat support and kite cruises in the Grenadines${season ? `; the wind season runs ${season}` : ''}.`,
  ].filter(s => s && s !== '.').join(' ');

  return {
    kind: 'accommodation',
    title: 'Mer & Sel Villa & Suites (JT Pro Center)',
    summary,
    continent: 'North America',
    country: 'Saint Vincent and the Grenadines',
    region: 'Grenadines',
    spot: 'Union Island',
    itinerarySpots: [],
    durationDays: null,
    // school page: "We don't only teach beginners. We also welcome experienced kitesurfers" (2026-10-12)
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: /kitesurf lessons|kite lessons/i.test(school),
    equipmentRental: /gear rental/i.test(school),
    beginnerFriendly: /Beginner kitesurf lessons|teach beginners/i.test(school) ? true : null,
    includedServices: [
      'Starlink internet',
      'Daily housekeeping',
      ...(launchFee ? ['Kitebeach launch fee (when the stay is booked through JT Pro Center)'] : []),
    ],
    optionalServices: [
      'Private kitesurf and wing foil lessons (JT Pro Center)',
      'Kite and wing gear rental',
      'Kite cruises and boat-supported day trips in the Grenadines',
      'Efoil lessons',
      cart ? `Golf cart rental US$${cart[1]} per day, scooter/moped US$${cart[2]} per day (villa and suite guests)` : 'Golf cart and scooter rental',
    ],
    accommodation: 'private villa, ocean-view suites and a cozy room',
    mealPlan: 'self_catering',
    languages: ['en'],
    rooms,
    imageUrls: imageUrls.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: MES_HOTEL_URL,
    bookingUrl: CONTACT_URL,
    sourceText: [
      `hotel: ${hotel}`,
      `school: ${school}`,
      `rates: ${rates.map(r => `${r.season} | ${r.unit} ${r.currency} ${r.amount}`).join('; ')}`,
      `tax: ${tax ?? '-'}`,
      `page edited: ${mesEditDate(p.hotel) ?? '-'}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const merEtSelUnionIsland: OfferAdapter = {
  key: 'mer-et-sel-union-island',
  name: 'Mer & Sel Villa & Suites, Union Island',
  kind: 'accommodation',
  disciplines: ['kitesurf', 'wingfoil'],
  operator: {
    name: 'JT Pro Center',
    websiteUrl: SITE,
    rootDomain: 'kitesurfgrenadines.com',
    contactEmail: 'info@kitesurfgrenadines.com',
    phone: '+17845292326',
  },
  url: MES_HOTEL_URL,
  slotMethod: 'price_table',
  fetchBudget: 3,
  confidence: 'medium', // the table year is inferred from the page's last edit
  async fetchContent() {
    const hotel = await page(MES_HOTEL_URL);
    const school = await page(MES_SCHOOL_URL);
    return parseMerEtSelContent({ hotel, school });
  },
  async fetchSlots(ctx) {
    const html = await page(MES_HOTEL_URL);
    const rates = parseMesRates(html);
    if (rates.length < 6) throw new Error(`mer-et-sel: rate table not found or changed (${rates.length} rates parsed)`);
    const anchor = mesEditDate(html);
    if (!anchor) throw new Error('mer-et-sel: page dateModified (table year) not found');
    const slots = buildMesSlots(rates, anchor, todayIso());
    if (slots.length === 0) ctx.note(`rate table last edited ${anchor}: every band is in the past (waiting for new rates)`);
    return slots;
  },
};
