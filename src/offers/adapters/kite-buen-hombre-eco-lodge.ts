// ---------------------------------------------------------------------------
// Buen Hombre Eco-Lodge Hotel of Kite Buen Hombre (Playa Buen Hombre, Monte Cristi, Dominican Republic) -
// beach bungalows, beach lofts and two rooms above the school's own IKO kite center on the flat-water
// lagoon (established 2013), three meals a day included.
//
// Data path (checked 2026-10-12): Wix site (server-rendered text + JSON-LD), English pages.
//   slots    /flexible-kitesurfing-stay-dominican-republic - JSON-LD Product "Flexible Stay" with
//            offers {price 85, priceCurrency USD, unitText "per night", eligibleQuantity.minValue 4 NIGHT}
//            (visible: "From $85/night", "Minimum 4 nights"). This is the only nightly accommodation price
//            the site prints; the Buen Hombre hotel page itself has no prices.
//   content  /buen-hombre-hotel (room cards between "CHOOSE YOUR Stay" and "Check Rates & Book", FAQ,
//            JSON-LD LodgingBusiness with geo + amenities), /kite-stay-packages-dominican-republic
//            (JSON-LD Product offers: Weekend / 7-Day / 10-Day / 14-Day Special, per person),
//            /product-page/season-special-6-nights-free (Wix Stores product: course + 6 free nights,
//            stays 1 Nov - 15 Dec 2026; optional, a 404 just drops it).
//   Packages bundle lessons and gear, so they stay in the content (optionalServices / summary), not slots.
// Booking: /book is a client-rendered page (rooms + Flexible Stay via contact / WhatsApp); the Wix Stores
//   checkout only sells the lesson products and specials. -> 'on_request'.
// robots.txt (2026-10-12): Wix default (only "*?lightbox=" disallowed for all agents).
// Requests per run: content 4, slots 1 (pages memoised for 10 min, so a full run makes 4). Pages are
//   2.5-3 MB each (Wix); fixtures are trimmed to text + JSON-LD.
// Parsed: 1 slot "flexible-stay" = USD 85 per night, minNights 4, availability 'on_request'.
// Known limits: "from" price for a stay that may be split between Buen Hombre and the Cabarete hotel
//   (both from $85); priceBasis 'room' is inferred (the site says "accommodation from $85 per night", the
//   per-person note on the packages page does not cover it). Rooms carry no individual prices.
// ---------------------------------------------------------------------------
import { fetchText, HttpStatusError } from '../http.js';
import { clean, collapse, imageCandidates, ldOfType, meta, parseAmount, parseDate } from '../parse.js';
import type { ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.kitebuenhombre.com';
export const KBH_HOTEL_URL = `${SITE}/buen-hombre-hotel`;
export const KBH_PACKAGES_URL = `${SITE}/kite-stay-packages-dominican-republic`;
export const KBH_FLEX_URL = `${SITE}/flexible-kitesurfing-stay-dominican-republic`;
export const KBH_SPECIAL_URL = `${SITE}/product-page/season-special-6-nights-free`;
const BOOKING_URL = `${SITE}/book#book-buen-hombre`;
export const KBH_FLEX_UNIT = 'Flexible Stay (Buen Hombre and/or Cabarete)';

export interface KbhFlex { price: number; currency: string; minNights: number | null }
export interface KbhPackage { name: string; nights: number | null; price: number; currency: string; description: string }
export interface KbhSpecial { name: string; total: number | null; currency: string; start: string | null; end: string | null; depositBy: string | null; placesPerWeek: number | null }

// --- local helpers ----------------------------------------------------------------
const memo = new Map<string, { at: number; p: Promise<string> }>();
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}
/** Visible text lines of a Wix page (scripts, styles and inline SVG dropped; zero-width spaces removed). */
export function wixLines(html: string): string[] {
  const body = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<svg[\s\S]*?<\/svg>/gi, '');
  return body.split(/<[^>]+>/).map(s => clean(s).replace(/​/g, '').trim()).filter(Boolean);
}
const dashes = (s: string): string => s.replace(/\s*[—–]\s*/g, ' - ');
const num = (v: unknown): number | null => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };

// --- pure parsers -----------------------------------------------------------------------------
/** "Flexible Stay" nightly offer from the JSON-LD Product; falls back to "From $85/night" + "Minimum 4 nights". */
export function parseKbhFlex(html: string): KbhFlex | null {
  for (const p of ldOfType(html, 'Product')) {
    const offers = (Array.isArray(p.offers) ? p.offers : [p.offers]) as Array<Record<string, unknown> | undefined>;
    for (const o of offers) {
      if (!o || !/night/i.test(String(o.unitText ?? ''))) continue;
      const price = num(o.price);
      const currency = typeof o.priceCurrency === 'string' ? o.priceCurrency : null;
      const minNights = num((o.eligibleQuantity as Record<string, unknown> | undefined)?.minValue);
      if (price && currency) return { price, currency, minNights };
    }
  }
  const t = wixLines(html).join(' ');
  const m = t.match(/From\s*\$\s?(\d[\d,.]*)\s*\/\s*night/i);
  if (!m) return null;
  const min = t.match(/Minimum\s*(\d+)\s*nights/i)?.[1];
  return { price: parseAmount(m[1])!, currency: 'USD', minNights: min ? Number(min) : null };
}

export function buildKbhSlots(flex: KbhFlex): Slot[] {
  return [{
    key: 'flexible-stay',
    startDate: null,
    endDate: null,
    unit: KBH_FLEX_UNIT,
    price: flex.price,
    currency: flex.currency,
    priceUnit: 'per_night',
    priceBasis: 'room', // inferred: "accommodation from $85 per night" (the per-person note is for packages only)
    occupancy: null,
    availability: 'on_request',
    availabilityText: null,
    spotsLeft: null,
    minNights: flex.minNights,
  }];
}

/** Kite stay packages (per person) from the JSON-LD Product offers of the packages page. */
export function parseKbhPackages(html: string): KbhPackage[] {
  const out: KbhPackage[] = [];
  for (const p of ldOfType(html, 'Product')) {
    const offers = (Array.isArray(p.offers) ? p.offers : [p.offers]) as Array<Record<string, unknown> | undefined>;
    for (const o of offers) {
      const price = num(o?.price);
      const name = typeof o?.name === 'string' ? collapse(o.name) : '';
      if (!o || !price || !name || typeof o.priceCurrency !== 'string') continue;
      const description = collapse(String(o.description ?? ''));
      const nights = description.match(/^(\d+)\s+nights?/i)?.[1];
      out.push({ name, nights: nights ? Number(nights) : null, price, currency: o.priceCurrency, description });
    }
  }
  return out;
}

/** Season special product: total per person, stay window, deposit deadline, places per week. */
export function parseKbhSpecial(html: string): KbhSpecial | null {
  const name = (ldOfType(html, 'Product')[0]?.name as string | undefined) ?? meta(html, 'og:title');
  if (!name) return null;
  const desc = clean(meta(html, 'og:description') ?? '');
  const text = `${desc} ${clean(meta(html, 'description') ?? '')} ${wixLines(html).join(' ')}`;
  const total = text.match(/Total:\s*\$\s?(\d[\d,.]*)\s*per person/i)?.[1];
  const win = text.match(/between (\d{1,2} [A-Za-z]+)(?: (\d{4}))? and (\d{1,2} [A-Za-z]+) (\d{4})/i);
  const deposit = text.match(/deposit by (\d{1,2} [A-Za-z]+ \d{4})/i)?.[1];
  const places = text.match(/only (\d+) places a week/i)?.[1];
  return {
    name: collapse(name),
    total: total ? parseAmount(total) : null,
    currency: 'USD',
    start: win ? parseDate(`${win[1]} ${win[2] ?? win[4]}`) : null,
    end: win ? parseDate(`${win[3]} ${win[4]}`) : null,
    depositBy: deposit ? parseDate(deposit) : null,
    placesPerWeek: places ? Number(places) : null,
  };
}

/** Room cards: a name line followed by "✔ ..." lines; the line before the name is its tagline. */
export function parseKbhRooms(hotelHtml: string): ContentRoom[] {
  const ls = wixLines(hotelHtml);
  const a = ls.findIndex(l => /^CHOOSE YOUR\b/i.test(l));
  const b = ls.findIndex((l, i) => i > a && /^Check Rates/i.test(l));
  if (a < 0 || b < 0) return [];
  const block = ls.slice(a + 1, b);
  const tick = (l: string | undefined) => !!l && /^✔/.test(l);
  const rooms: ContentRoom[] = [];
  for (let i = 0; i < block.length; i++) {
    if (tick(block[i]) || !tick(block[i + 1])) continue;
    const prev = block[i - 1];
    const features: string[] = [];
    for (let j = i + 1; tick(block[j]); j++) {
      const f = dashes(block[j].replace(/^✔\s*/, '')).replace(/\bAC\.,?\s*&\s*fans/i, 'AC & fans').replace(/\s{2,}/g, ' ').trim();
      if (f) features.push(f[0].toUpperCase() + f.slice(1));
    }
    rooms.push({
      name: block[i],
      description: prev && !tick(prev) && !/View Rooms|Find the perfect/i.test(prev) ? dashes(prev) : null,
      features,
    });
  }
  return rooms;
}

export interface KbhPages { hotel: string; packages: string; flex: string; special: string | null }

export function parseKiteBuenHombreContent(p: KbhPages): OfferContent {
  const hotelLines = wixLines(p.hotel);
  const hotel = hotelLines.join(' ');
  const pk = wixLines(p.packages).join(' ');
  const flexText = wixLines(p.flex).join(' ');
  const lodging = ldOfType(p.hotel, 'LodgingBusiness')[0] ?? {};
  const geo = (lodging.geo ?? {}) as Record<string, unknown>;
  const lat = geo.latitude !== undefined ? Number(geo.latitude) : NaN;
  const lng = geo.longitude !== undefined ? Number(geo.longitude) : NaN;
  const amenities = ((lodging.amenityFeature ?? []) as Array<Record<string, unknown>>).map(a => String(a.name ?? '')).filter(Boolean);
  const rooms = parseKbhRooms(p.hotel);
  const packages = parseKbhPackages(p.packages);
  const flex = parseKbhFlex(p.flex);
  const special = p.special ? parseKbhSpecial(p.special) : null;
  const since = String(lodging.description ?? '').match(/established (\d{4})/i)?.[1] ?? hotel.match(/Since (\d{4})/)?.[1] ?? null;
  const usd = (n: number) => `USD ${n.toLocaleString('en-US')}`;
  const seasonOff = pk.match(/May 1\s*[–-]\s*June 15 and October 1\s*[–-]\s*November 15/i) ? 'May 1 to June 15 and October 1 to November 15' : null;

  const roomNames = rooms.map(r => r.name);
  const pkSorted = [...packages].sort((x, y) => x.price - y.price);
  const summary = [
    `The Buen Hombre Eco-Lodge Hotel is the beachfront lodge of Kite Buen Hombre at Playa Buen Hombre (Monte Cristi, north-west Dominican Republic)${since ? `, established in ${since}` : ''} next to the school's own IKO kite center on a shallow flat-water lagoon.`,
    `Guests stay in ${roomNames.length ? roomNames.map(n => (/^The /.test(n) ? n : n.toLowerCase())).join(', ').replace(/, ([^,]*)$/, ' or $1') : 'beach bungalows and lofts'}; three meals a day, Starlink Wi-Fi and kite storage are included.`,
    [
      flex ? `Nights can be booked as a Flexible Stay from ${usd(flex.price)} per night${flex.minNights ? ` (minimum ${flex.minNights} nights, also combinable with the school's Cabarete hotel)` : ''}` : 'Nights are booked on request',
      pkSorted.length >= 2 ? ` or within per-person kite stay packages with gear and lessons from ${usd(pkSorted[0].price)}${pkSorted[0].nights ? ` (${pkSorted[0].nights} night${pkSorted[0].nights > 1 ? 's' : ''})` : ''} to ${usd(pkSorted[pkSorted.length - 1].price)}${pkSorted[pkSorted.length - 1].nights ? ` (${pkSorted[pkSorted.length - 1].nights} nights)` : ''}.` : '.',
    ].join(''),
    `The lodge is open year-round${seasonOff ? `, with 50% off accommodation in packages that include a full course from ${seasonOff}` : ''}.`,
  ].join(' ');

  const optional = [
    ...packages.map(x => `${x.name}: ${usd(x.price)} per person (${dashes(x.description).replace(/\.$/, '')})`),
    ...(special && special.total && special.start && special.end
      ? [`${dashes(special.name)}: ${usd(special.total)} per person, stays ${special.start} to ${special.end}${special.depositBy ? `, deposit by ${special.depositBy}` : ''}${special.placesPerWeek ? `, ${special.placesPerWeek} places a week` : ''}`]
      : []),
    'Private kite lessons and advanced coaching (IKO instructors)',
    'Kite, wing and foil gear rental',
    'Boat trips and downwinders (Cayo Arena, Seven Islands, Punta Rucia)',
    'Private transfer from Puerto Plata airport (POP), about 3 hours',
    'Massage, yoga and personal training',
  ];

  // images: hotel page first, then the packages and flexible-stay hero; Wix originals, logos dropped
  const logoIds = new Set([p.hotel, p.packages].flatMap(h => [...h.matchAll(/"logo":\{[^}]*"url":"[^"]*\/media\/([^"/~.]+)/g)].map(m => m[1])));
  const imgs: string[] = [];
  const seen = new Set<string>();
  for (const [html, base] of [[p.hotel, KBH_HOTEL_URL], [p.packages, KBH_PACKAGES_URL], [p.flex, KBH_FLEX_URL]] as const) {
    for (const u of imageCandidates(html, base, null, 60)) {
      const id = u.match(/static\.wixstatic\.com\/media\/([^/~.]+)/)?.[1];
      if (!id || logoIds.has(id) || /logo|icon|\.svg/i.test(u) || seen.has(id)) continue;
      seen.add(id);
      imgs.push(u.replace(/(\/media\/[^/]+)\/v1\/.*$/, '$1'));
    }
  }

  return {
    kind: 'accommodation',
    title: 'Buen Hombre Eco-Lodge Hotel (Kite Buen Hombre)',
    summary,
    continent: 'North America',
    country: 'Dominican Republic',
    region: 'Monte Cristi',
    spot: 'Playa Buen Hombre',
    // JSON-LD LodgingBusiness.geo on the hotel page
    ...(Number.isFinite(lat) && Number.isFinite(lng) ? { spotCoords: { lat, lng } } : {}),
    itinerarySpots: [],
    durationDays: null,
    // packages page: 11-hour beginner course, 10-hour advanced course, second-level course (2026-10-12)
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: /IKO/i.test(hotel),
    equipmentRental: /kite equipment rental|rentals?/i.test(pk),
    beginnerFriendly: /Beginner-Friendly Lagoon|beginner/i.test(hotel),
    includedServices: [
      /three meals a day|Three Meals Together/i.test(hotel) ? 'Three meals a day (breakfast, lunch, dinner)' : null,
      /Starlink/i.test(hotel) ? 'Starlink Wi-Fi' : null,
      amenities.some(a => /air conditioning/i.test(a)) ? 'Air conditioning' : null,
      /daily housekeeping/i.test(flexText) ? 'Daily housekeeping' : null,
      /kite and equipment storage is included|Kite Storage/i.test(hotel) ? 'Secure kite and equipment storage' : null,
    ].filter((x): x is string => !!x),
    optionalServices: optional,
    accommodation: 'beachfront bungalows, lofts and rooms above the kite school',
    mealPlan: 'full_board',
    languages: ['en', 'es'],
    rooms,
    imageUrls: imgs.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: KBH_HOTEL_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      `hotel: ${hotel}`,
      `lodging json-ld: geo ${lat},${lng}; amenities ${amenities.join(' | ')}`,
      `flexible stay: ${flex ? `${flex.currency} ${flex.price}/night, min ${flex.minNights} nights` : 'not found'}`,
      `packages: ${packages.map(x => `${x.name} ${x.currency} ${x.price} (${x.nights} nights)`).join('; ')}`,
      `packages page: ${pk}`,
      `season special: ${special ? JSON.stringify(special) : 'not found'}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
async function specialPage(ctx: FetchContext): Promise<string | null> {
  try {
    return await page(KBH_SPECIAL_URL);
  } catch (e) {
    if (e instanceof HttpStatusError && e.status === 404) { ctx.note('season special product page gone (404)'); return null; }
    throw e;
  }
}

export const kiteBuenHombreEcoLodge: OfferAdapter = {
  key: 'kite-buen-hombre-eco-lodge',
  name: 'Kite Buen Hombre Eco-Lodge, Buen Hombre',
  kind: 'accommodation',
  operator: {
    name: 'Kite Buen Hombre',
    websiteUrl: SITE,
    rootDomain: 'kitebuenhombre.com',
    contactEmail: 'kitebuen@gmail.com',
    whatsapp: '+18295212367',
    phone: '+18295212367',
  },
  url: KBH_HOTEL_URL,
  slotMethod: 'jsonld',
  fetchBudget: 5,
  confidence: 'medium',
  async fetchContent(ctx) {
    const hotel = await page(KBH_HOTEL_URL);
    const packages = await page(KBH_PACKAGES_URL);
    const flex = await page(KBH_FLEX_URL);
    const special = await specialPage(ctx);
    return parseKiteBuenHombreContent({ hotel, packages, flex, special });
  },
  async fetchSlots() {
    const flex = parseKbhFlex(await page(KBH_FLEX_URL));
    if (!flex) throw new Error('kite-buen-hombre: Flexible Stay nightly price (JSON-LD offer / "From $X/night") not found');
    return buildKbhSlots(flex);
  },
};
