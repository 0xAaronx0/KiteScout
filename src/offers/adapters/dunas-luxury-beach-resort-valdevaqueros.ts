// ---------------------------------------------------------------------------
// Dunas Luxury Beach Resort, Valdevaqueros (Tarifa, Cadiz, Andalusia, Spain) - glamping resort ("a village of lodges,
// bungalows and whitewashed houses") behind the dune of Valdevaqueros beach, thirty seconds on foot from the sand;
// three restaurants, yoga, wellbeing centre. Kite link: the activities page ("Kitesurfing at Valdevaqueros - The bay
// the sport chose. Thirty seconds' walk from the gate ... Ask at reception which one suits your level") and "Reception
// books it for you: ... kite schools and trips".
//
// Data path (checked 2026-10-12): Next.js site, English (also /es, /de).
//   content  / (intro, JSON-LD Resort with geo 36.0704889,-5.692933 -> spotCoords, VAT note), /stay (seven unit cards:
//            name, tagline, sleeps / bedrooms / bathrooms / m², chips, "From €160 per night" or "Booked by enquiry";
//            "In every one", arrival, cancellation), /activities (kite, yoga, reception), /gallery (photos; the Next.js
//            image proxy URLs are unwrapped to the original /images/... files).
//   slots    the printed "From €X per night" per unit, no dates (like Michael's): one slot per unit, EUR per unit and
//            night (IVA 10% included), availability 'unknown'; the enquiry-only farmhouse gets a price-on-request slot.
// Booking engine: SiteMinder direct-book (direct-book.com/properties/DunasLuxuryBeachResortTarifaDIRECT). It showed an
//   AWS WAF bot challenge to us at another property; we do not get around it -> not called. The site's own /api is
//   robots-disallowed.
// robots.txt (2026-10-12): disallows /admin, /api, /account, /booking/confirmed - the pages and /images/ are allowed.
// Requests per run: content 4, slots 1 (the /stay page, memoised).
// Known limits: from-prices only, no season dates or live availability.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, jsonLd, parse, parseAmount } from '../parse.js';
import type { ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://dunastarifa.com';
export const DUN_HOME_URL = `${SITE}/`;
export const DUN_STAY_URL = `${SITE}/stay`;
export const DUN_ACTIVITIES_URL = `${SITE}/activities`;
export const DUN_GALLERY_URL = `${SITE}/gallery`;
const BOOKING_URL = 'https://direct-book.com/properties/DunasLuxuryBeachResortTarifaDIRECT';

const memo = new Map<string, { at: number; p: Promise<string> }>();
/** one fetch per page per 10 minutes: fetchContent + fetchSlots share /stay */
function get(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}
const keyPart = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Visible text lines (scripts, styles, SVGs dropped), split at block tags. */
export function dunLines(html: string): string[] {
  return html
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .split(/<\/?(?:p|li|td|th|tr|h\d|div|br|ul|section|a|button|figure|article)\b[^>]*>/i)
    .map(s => clean(s.replace(/<[^>]+>/g, ' ')))
    .filter(Boolean);
}

// --- pure parsers -----------------------------------------------------------------------------
export interface DunUnit {
  name: string; slug: string | null; tagline: string | null; sleeps: number | null; bedrooms: number | null; bathrooms: number | null;
  size: string | null; chips: string[]; fromPrice: number | null; currency: string | null; enquiry: boolean; image: string | null;
}

/** Next.js image proxy "/_next/image?url=%2Fimages%2F...&w=..." -> "https://dunastarifa.com/images/..." */
export function dunOriginal(src: string): string | null {
  const m = src.match(/[?&]url=([^&]+)/);
  const path = m ? decodeURIComponent(m[1]) : src;
  if (/^\/images\//.test(path)) return `${SITE}${path}`;
  if (/^https:\/\/dunastarifa\.com\/images\//.test(path)) return path;
  return null;
}

/** /stay unit cards (article.card). */
export function parseDunUnits(html: string): DunUnit[] {
  const out: DunUnit[] = [];
  for (const card of parse(html).querySelectorAll('article')) {
    const a = card.querySelector('h3 a');
    const name = clean(a?.text);
    if (!name || out.some(u => u.name === name)) continue;
    const facts = card.querySelectorAll('ul li').map(li => clean(li.text));
    const num = (re: RegExp) => Number(facts.find(f => re.test(f))?.match(/(\d+)/)?.[1]) || null;
    const priceEl = card.querySelectorAll('span').find(s => /^€\s?[\d.,]+$/.test(clean(s.text)));
    const enquiry = /Booked by enquiry/i.test(card.text);
    out.push({
      name,
      slug: a?.getAttribute('href')?.match(/^\/stay\/([\w-]+)/)?.[1] ?? null,
      tagline: clean(card.querySelector('h3 + p')?.text ?? card.querySelector('p')?.text) || null,
      sleeps: num(/^Sleeps/i),
      bedrooms: num(/bedrooms?$/i),
      bathrooms: num(/bathrooms?$/i),
      size: facts.find(f => /m²$/.test(f)) ?? null,
      chips: card.querySelectorAll('.chip').map(c => clean(c.text)).filter(Boolean),
      fromPrice: priceEl ? parseAmount(clean(priceEl.text)) : null,
      currency: priceEl ? 'EUR' : null,
      enquiry,
      image: dunOriginal(card.querySelector('img')?.getAttribute('src') ?? ''),
    });
  }
  return out;
}

export function buildDunSlots(units: DunUnit[]): Slot[] {
  return units.filter(u => u.fromPrice !== null || u.enquiry).map(u => ({
    key: keyPart(u.name),
    startDate: null,
    endDate: null,
    unit: u.name,
    price: u.fromPrice,
    currency: u.fromPrice !== null ? u.currency : null,
    priceUnit: u.fromPrice !== null ? 'per_night' as const : null,
    priceBasis: 'room' as const,
    occupancy: null,
    availability: u.fromPrice !== null ? 'unknown' as const : 'on_request' as const,
    availabilityText: u.fromPrice !== null ? `From €${u.fromPrice} per night (VAT included)` : 'Booked by enquiry',
    spotsLeft: null,
  }));
}

export async function fetchDunSlots(_ctx: FetchContext): Promise<Slot[]> {
  const units = parseDunUnits(await get(DUN_STAY_URL));
  if (units.filter(u => u.fromPrice !== null).length < 3) throw new Error(`dunas: unit cards with "From €" prices not found on /stay (${units.length} cards)`);
  return buildDunSlots(units);
}

/** Resort JSON-LD geo of the home page. */
export function parseDunGeo(html: string): { lat: number; lng: number } | null {
  const r = jsonLd(html).find(o => o['@type'] === 'Resort' && o.geo);
  const g = (r?.geo ?? {}) as Record<string, unknown>;
  const lat = Number(g.latitude);
  const lng = Number(g.longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 ? { lat, lng } : null;
}

// --- content ----------------------------------------------------------------------------------
export interface DunPages { home: string; stay: string; activities: string; gallery: string }

const section = (lines: string[], head: string): string => {
  const i = lines.indexOf(head);
  return i >= 0 ? lines[i + 1] ?? '' : '';
};

export function parseDunasContent(p: DunPages): OfferContent {
  const home = dunLines(p.home);
  const stay = dunLines(p.stay);
  const act = dunLines(p.activities);
  const units = parseDunUnits(p.stay);
  const intro = home.find(l => /^Luxury glamping in a village/i.test(l)) ?? '';
  const village = home.find(l => /^Immerse yourself in eco-friendly surroundings/i.test(l)) ?? '';
  const every = section(stay, 'In every one');
  const arrival = section(stay, 'Arrival and departure');
  const cancel = section(stay, 'Cancellation');
  const kiteIdx = act.indexOf('Kitesurfing at Valdevaqueros');
  const kite = kiteIdx >= 0 ? act.slice(kiteIdx, kiteIdx + 3).join(' ') : '';
  const reception = section(act, 'Reception books it for you');
  const yoga = act.find(l => /^Wednesdays, Saturdays and Sundays at 10:00/i.test(l)) ?? '';
  const vat = home.join(' ').match(/IVA \((\d+)%\) included/i)?.[1] ?? null;
  const priced = units.filter(u => u.fromPrice !== null);
  const min = priced.length ? Math.min(...priced.map(u => u.fromPrice!)) : null;
  const max = priced.length ? Math.max(...priced.map(u => u.fromPrice!)) : null;

  const rooms: ContentRoom[] = units.map(u => ({
    name: u.name,
    description: u.tagline,
    features: [
      u.sleeps ? `Sleeps ${u.sleeps}` : null,
      u.bedrooms ? `${u.bedrooms} bedroom${u.bedrooms > 1 ? 's' : ''}` : null,
      u.bathrooms ? `${u.bathrooms} bathroom${u.bathrooms > 1 ? 's' : ''}` : null,
      u.size, ...u.chips,
      u.fromPrice !== null ? `From EUR ${u.fromPrice} per night` : u.enquiry ? 'Booked by enquiry' : null,
    ].filter((x): x is string => !!x),
  }));

  const gallery = parse(p.gallery).querySelectorAll('img').map(i => dunOriginal(i.getAttribute('src') ?? ''))
    .filter((u): u is string => !!u && !/\/brand\/|logo/i.test(u));
  const imageUrls = [...new Set([...units.map(u => u.image).filter((u): u is string => !!u), ...gallery])].slice(0, 30);

  const summary = [
    `Dunas Luxury Beach Resort is a glamping resort of lodges, bungalows and whitewashed houses behind the dune of Valdevaqueros beach in Tarifa, thirty seconds on foot from the sand.`,
    `It rents ${units.length} unit types, from safari lodges for two to a villa for four and a farmhouse for six above the Bolonia coast, each with a private bathroom, kitchenette, air conditioning and a private deck${min !== null ? `; the website's from-prices run from EUR ${min} to ${max} per night${vat ? ` including ${vat}% VAT` : ''}` : ''}.`,
    `Kite schools and rental huts work along Valdevaqueros beach in season and reception books a school to suit your level; yoga three mornings a week is included, and the resort has three restaurants and a mini market.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Dunas Luxury Beach Resort',
    summary,
    continent: 'Europe',
    country: 'Spain',
    region: 'Valdevaqueros, Tarifa',
    spot: 'Valdevaqueros',
    spotCoords: parseDunGeo(p.home),
    itinerarySpots: [],
    durationDays: null,
    skillLevels: [],
    kiteLessons: /kite schools/i.test(`${kite} ${reception}`) ? true : null,
    equipmentRental: /rental huts/i.test(kite) ? true : null,
    beginnerFriendly: null,
    includedServices: ['Yoga on the sun deck (Wednesday, Saturday, Sunday 10:00)', 'Housekeeping every 48 hours', 'Free parking', 'Beach access'],
    optionalServices: [
      'Kite school booking through reception',
      'Massage at the wellbeing centre',
      'Restaurante Jardín Dorado (breakfast buffet, dinner), Pizza a la Piazza, Azure Bistro',
      'Mini market',
    ],
    accommodation: 'glamping lodges, bungalows and whitewashed houses',
    mealPlan: null,
    languages: [],
    rooms,
    imageUrls,
    heroVideoUrl: null,
    sourceUrl: DUN_STAY_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      `home: ${intro} ${village}`,
      `in every one: ${every}`,
      `arrival: ${arrival} | cancellation: ${cancel} | VAT ${vat ?? '-'}%`,
      `kite: ${kite} | reception: ${reception} | yoga: ${yoga}`,
      `units: ${units.map(u => `${u.name} (${u.sleeps ?? '-'} guests, ${u.bedrooms ?? '-'} bedrooms${u.size ? `, ${u.size}` : ''}${u.chips.length ? `, ${u.chips.join(', ')}` : ''}): ${u.fromPrice !== null ? `from EUR ${u.fromPrice}/night` : 'booked by enquiry'}`).join(' | ')}`,
    ].join('\n'),
  };
}

export const dunasLuxuryBeachResortValdevaqueros: OfferAdapter = {
  key: 'dunas-luxury-beach-resort-valdevaqueros',
  name: 'Dunas Luxury Beach Resort',
  kind: 'accommodation',
  operator: {
    name: 'Dunas Luxury Beach Resort',
    websiteUrl: SITE,
    rootDomain: 'dunastarifa.com',
    contactEmail: 'hola@dunastarifa.com',
    phone: '+34661313655',
  },
  url: DUN_STAY_URL,
  slotMethod: 'price_table',
  fetchBudget: 5,
  confidence: 'medium', // undated from-prices, no live availability
  async fetchContent() {
    const home = await get(DUN_HOME_URL);
    const stay = await get(DUN_STAY_URL);
    const activities = await get(DUN_ACTIVITIES_URL);
    const gallery = await get(DUN_GALLERY_URL);
    return parseDunasContent({ home, stay, activities, gallery });
  },
  async fetchSlots(ctx) {
    return fetchDunSlots(ctx);
  },
};
