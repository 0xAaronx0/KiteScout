// ---------------------------------------------------------------------------
// BEACHES ocean view apartments, Kralendijk (Bonaire, Caribbean Netherlands) - 10 studio apartments for 2
// persons each with pool and rooftop terrace on the coastal road south of Kralendijk; the Atlantis kite beach
// is further south on the same road, and the site sells a "Kite trip" stay (7 nights, 10% off kite courses).
//
// Data path (checked 2026-10-12): WordPress (Yoast), server-rendered, English pages under /en/:
//   slots    /en/rates/ - "Low season $115,00 per night" / "High season $125,00 per night" and the dated
//            season list under "*Low season" / "**High season" ("2026 4 May – 31 October",
//            "2026 1 November – 2027 3 May"); "Nightly rates are per studio apartment (2 persons)",
//            "All prices are in U.S. dollars". Bands that ended before today are dropped.
//   content  /en/ (10 studios, location, services), /en/apartments/ (equipment lists), /en/kite-or-dive-trip/
//            (kite spot on the same road, kite trip package $525 pp based on 4 persons; page last edited
//            2020-06-09, so it stays in the content only), /en/rates/.
// Booking engine: Beds24 (booking2.php?propid=25562) answers "service unavailable" to our UA (checked
//   2026-10-12, as for Kite da Mary) -> BLOCKED, not retried; availability stays 'unknown'.
// robots.txt (2026-10-12): Yoast default, nothing disallowed. The home page embeds a Google Maps API key
//   (redacted in the fixtures); no coordinates are printed, so no spotCoords.
// Requests per run: content 4, slots 1 (pages memoised for 10 minutes, so a full run makes 4).
// Parsed: slot = season band ("studio|2026-11-01"), USD per studio per night for 2 persons, availability
//   'unknown'. Last-minute rate ("from $103,50" within 14 days) and the kite trip package go into the content.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, imageCandidates, iso, ldOfType, monthOf, parse, parseAmount, todayIso } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.beaches-bonaire.com';
export const BCH_HOME_URL = `${SITE}/en/`;
export const BCH_RATES_URL = `${SITE}/en/rates/`;
export const BCH_APARTMENTS_URL = `${SITE}/en/apartments/`;
export const BCH_KITE_URL = `${SITE}/en/kite-or-dive-trip/`;
const BOOK_URL = `${SITE}/en/book-now/`;
export const BCH_UNIT = 'Studio apartment (2 persons)';

export interface BchRates { low: number | null; high: number | null; lastMinute: number | null; currency: string }
export interface BchSeason { season: 'low' | 'high'; start: string; end: string }

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
/** Visible text blocks of the content area (paragraphs, headings, list items), one per line. */
export function bchLines(html: string): string[] {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, header, footer, nav')) el.remove();
  const scope = root.querySelector('main') ?? root.querySelector('#main') ?? root.querySelector('body') ?? root;
  const out: string[] = [];
  for (const el of scope.querySelectorAll('h1, h2, h3, h4, h5, h6, p, li')) {
    for (const part of el.innerHTML.split(/<br\s*\/?>/i)) {
      const t = collapse(parse(part).text).replace(/[–—]/g, '-');
      if (t && !out.includes(t)) out.push(t);
    }
  }
  return out;
}

// --- pure parsers -----------------------------------------------------------------------------
export function parseBchRates(html: string): BchRates {
  const t = bchLines(html).join('\n');
  const amt = (re: RegExp) => { const m = t.match(re); return m ? parseAmount(m[1]) : null; };
  return {
    low: amt(/Low season\s*\$\s?([\d.,]+)\s*per night/i),
    high: amt(/High season\s*\$\s?([\d.,]+)\s*per night/i),
    lastMinute: amt(/Last minute booking from\s*\$\s?([\d.,]+)/i),
    currency: /U\.S\. dollars|\$/.test(t) ? 'USD' : 'USD',
  };
}

/** "2026 4 May - 31 October" / "2026 1 November - 2027 3 May" under "*Low season" / "**High season". */
export function parseBchSeasons(html: string): BchSeason[] {
  const out: BchSeason[] = [];
  let season: 'low' | 'high' | null = null;
  for (const l of bchLines(html)) {
    if (/^\*+\s*Low season$/i.test(l)) { season = 'low'; continue; }
    if (/^\*+\s*High season$/i.test(l)) { season = 'high'; continue; }
    const m = l.match(/^(\d{4})\s+(\d{1,2})\s+([A-Za-z]+)\s*-\s*(?:(\d{4})\s+)?(\d{1,2})\s+([A-Za-z]+)$/);
    if (!m) { if (season && !/^\d{4}\b/.test(l)) season = null; continue; }
    const m1 = monthOf(m[3]); const m2 = monthOf(m[6]);
    if (!season || !m1 || !m2) continue;
    out.push({ season, start: iso(+m[1], m1, +m[2]), end: iso(m[4] ? +m[4] : +m[1], m2, +m[5]) });
  }
  return out;
}

export function buildBchSlots(rates: BchRates, seasons: BchSeason[], today: string): Slot[] {
  const out: Slot[] = [];
  for (const s of seasons) {
    const price = s.season === 'low' ? rates.low : rates.high;
    if (s.end < today || price === null) continue;
    out.push({
      key: `studio|${s.start}`,
      startDate: s.start,
      endDate: s.end,
      unit: BCH_UNIT,
      price,
      currency: rates.currency,
      priceUnit: 'per_night',
      priceBasis: 'room',
      occupancy: 2,
      availability: 'unknown',
      availabilityText: null,
      spotsLeft: null,
    });
  }
  return out;
}

/** "Kite trip" package on /en/kite-or-dive-trip/: price per person, basis, inclusions, months. */
export function parseBchKiteTrip(html: string): { price: number | null; basis: string | null; includes: string[]; season: string | null; text: string } {
  const ls = bchLines(html);
  const a = ls.findIndex(l => /^Kite trip$/i.test(l));
  const b = ls.findIndex((l, i) => i > a && /^Dive trip$/i.test(l));
  const block = a >= 0 ? ls.slice(a, b > a ? b : undefined) : [];
  const priceLine = block.find(l => /\$\s?\d+ per person/i.test(l)) ?? '';
  const inc = block.indexOf('Including:');
  const exc = block.indexOf('Excluding:');
  return {
    price: parseAmount(priceLine.match(/\$\s?([\d.,]+)/)?.[1] ?? ''),
    basis: priceLine.match(/\(([^)]+)\)/)?.[1] ?? null,
    includes: inc >= 0 ? block.slice(inc + 1, exc > inc ? exc : undefined) : [],
    season: block.find(l => /^Kite trip:/i.test(l))?.replace(/^Kite trip:\s*/i, '') ?? null,
    text: block.join(' | '),
  };
}

export interface BchPages { home: string; apartments: string; kite: string; rates: string }

export function parseBeachesContent(p: BchPages): OfferContent {
  const home = bchLines(p.home);
  const apt = bchLines(p.apartments);
  const kiteLines = bchLines(p.kite);
  const rates = parseBchRates(p.rates);
  const seasons = parseBchSeasons(p.rates);
  const trip = parseBchKiteTrip(p.kite);
  const homeText = home.join(' ');
  const nStudios = homeText.match(/offers (\d+) studio apartments/i)?.[1] ?? null;
  const kiteSpot = kiteLines.find(l => /Kite spot Atlantis/i.test(l)) ?? null;
  const section = (from: RegExp, to: RegExp): string[] => {
    const a = apt.findIndex(l => from.test(l));
    if (a < 0) return [];
    const b = apt.findIndex((l, i) => i > a && to.test(l));
    return apt.slice(a + 1, b > a ? b : a + 25).filter(l => l.length < 90);
  };
  const studioFeatures = section(/^Suitable for 2 persons/i, /^Outside area$/i).filter(l => !/^Apartments$/i.test(l));
  const outside = section(/^Outside area$/i, /^Our services$/i);
  const services = section(/^Our services$/i, /^Check out our Rates/i);
  const curSeasons = seasons.filter(s => s.start.startsWith('2026') || s.end.startsWith('2027'));

  const rooms: ContentRoom[] = [{
    name: BCH_UNIT,
    description: apt.find(l => /^BEACHES offers well-equipped studio apartments/i.test(l)) ?? null,
    features: [
      ...(apt.some(l => /^Suitable for 2 persons/i.test(l)) ? ['Suitable for 2 persons (12 years and older)'] : []),
      ...studioFeatures,
      ...(rates.low && rates.high ? [`Low season USD ${rates.low} / high season USD ${rates.high} per night`] : []),
    ],
  }];

  const seen = new Set<string>();
  const imageUrls: string[] = [];
  for (const [html, base] of [[p.home, BCH_HOME_URL], [p.apartments, BCH_APARTMENTS_URL], [p.kite, BCH_KITE_URL]] as const) {
    for (const u of imageCandidates(html, base, null, 60)) {
      if (!/beaches-bonaire\.com\/wp-content\/uploads\//.test(u) || /logo|icon|\.svg|\.png$|award|review|flag/i.test(u)) continue;
      const k = u.replace(/-(?:\d+x\d+|scaled)(?=\.[a-z]+$)/i, '');
      if (seen.has(k)) continue;
      seen.add(k); imageUrls.push(u);
    }
  }

  const summary = [
    `BEACHES ocean view apartments rents ${nStudios ?? '10'} studio apartments for 2 persons each on the coastal road south of Kralendijk, Bonaire, with a magnesium pool, BBQ and a rooftop terrace with sea views; the Atlantis kite beach lies further south on the same road.`,
    rates.low && rates.high ? `Nightly rates per studio are USD ${rates.low} in the low season and USD ${rates.high} in the high season${curSeasons.length ? ` (2026/27: ${curSeasons.map(s => `${s.season} ${s.start} to ${s.end}`).join(', ')})` : ''}, including Wi-Fi, weekly cleaning, linen, beach towels and airport transport.` : 'Stays include Wi-Fi, weekly cleaning, linen, beach towels and airport transport.',
    trip.price ? `A kite trip package (7 nights in a studio, breakfast, pick-up truck, airport transfers, 10% off kite courses) costs USD ${trip.price} per person${trip.basis ? ` (${trip.basis})` : ''}.` : '',
  ].filter(Boolean).join(' ');

  return {
    kind: 'accommodation',
    title: 'BEACHES ocean view apartments',
    summary,
    continent: 'North America',
    country: 'Bonaire',
    region: 'Caribbean Netherlands',
    spot: 'Kralendijk',
    itinerarySpots: [],
    durationDays: null,
    skillLevels: [],
    kiteLessons: null,
    equipmentRental: null,
    beginnerFriendly: null,
    includedServices: services.length ? services : ['Wi-Fi', 'Weekly cleaning', 'Linen', 'Beach towels', 'Airport transportation'],
    optionalServices: [
      ...(trip.price ? [`Kite trip: 7 nights + breakfast + pick-up truck + airport transfers + 10% off kite and dive courses, USD ${trip.price} per person${trip.basis ? ` (${trip.basis})` : ''}${trip.season ? `, ${trip.season}` : ''}`] : []),
      ...(rates.lastMinute ? [`Last-minute rate from USD ${rates.lastMinute} per night (bookings within 14 days of arrival)`] : []),
      'On-site SUV rental',
    ],
    accommodation: 'studio apartments with kitchenette and private porch',
    mealPlan: 'self_catering',
    languages: ['en', 'nl', 'de'],
    rooms,
    imageUrls: imageUrls.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: BCH_HOME_URL,
    bookingUrl: BOOK_URL,
    sourceText: [
      `home: ${homeText}`,
      `apartments: ${apt.join(' | ')}`,
      `outside: ${outside.join(' | ')}`,
      `kite: ${kiteSpot ?? '-'} | ${trip.text}`,
      `rates: low ${rates.low} high ${rates.high} last-minute ${rates.lastMinute} ${rates.currency}; seasons ${seasons.map(s => `${s.season} ${s.start}..${s.end}`).join(', ')}`,
      `rates page edited: ${String(ldOfType(p.rates, 'WebPage')[0]?.dateModified ?? '-')}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const beachesBonaireKralendijk: OfferAdapter = {
  key: 'beaches-bonaire-kralendijk',
  name: 'BEACHES ocean view apartments, Bonaire',
  kind: 'accommodation',
  operator: {
    name: 'BEACHES Bonaire',
    websiteUrl: SITE,
    rootDomain: 'beaches-bonaire.com',
    contactEmail: 'info@beaches-bonaire.com',
    phone: '+5997953815',
  },
  url: BCH_HOME_URL,
  slotMethod: 'price_table',
  instantBooking: true,
  fetchBudget: 5,
  async fetchContent() {
    const home = await page(BCH_HOME_URL);
    const apartments = await page(BCH_APARTMENTS_URL);
    const kite = await page(BCH_KITE_URL);
    const rates = await page(BCH_RATES_URL);
    return parseBeachesContent({ home, apartments, kite, rates });
  },
  async fetchSlots(ctx) {
    const html = await page(BCH_RATES_URL);
    const rates = parseBchRates(html);
    const seasons = parseBchSeasons(html);
    if (!rates.low || !rates.high || seasons.length === 0) {
      throw new Error(`beaches-bonaire: rates page changed (low ${rates.low}, high ${rates.high}, ${seasons.length} seasons)`);
    }
    const slots = buildBchSlots(rates, seasons, todayIso());
    if (slots.length === 0) ctx.note('every season band on /en/rates/ is in the past (waiting for new dates)');
    return slots;
  },
};
