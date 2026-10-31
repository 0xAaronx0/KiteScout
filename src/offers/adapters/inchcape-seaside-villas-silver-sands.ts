// ---------------------------------------------------------------------------
// Inchcape Seaside Villas, Silver Sands (Christ Church, Barbados) - private beachfront estate of 17 self-catering
// studios, apartments, cottages and houses (2-5 guests) on the western end of Silver Sands Beach, the south-coast
// kite beach. Kite link (own page /en/1714087/kitesurfing): "the beaches around Inchcape, like Silver Sands and
// Silver Rock, which attract most of the kitesurfers. Brian Talma's Action Shop at Silver Rock is available for
// kitesurfing lessons" - a NEARBY independent school, not on site and not a partner; the estate has storage areas
// for sports equipment (how-to-book page). Found via a former bstoked.net listing - a hint only, nothing read.
//
// Data path (checked 2026-10-12): Lodgify website (server-rendered React). Each page embeds the site's own data as
//   <script type="application/json" id="lodgify-model-json"> (propertyData: room types with guests, area, features,
//   amenities, description, image ids; imageData: image id -> CDN url) and id="lodgify-swr-fallback-json" (the
//   server-side responses the page was rendered from, keyed by Lodgify API url).
//   content  / (intro, "Direct Booking VIP" + "Super Summer 2026 Offers"), /en/1714087/kitesurfing, /en/1725230/rates
//            (room types from the model JSON), /en/1725232/map (propertyData.location lat/lng = map pin),
//            /en/1714085/how-to-book (booking conditions, fees, equipment storage).
//   slots    /en/1725230/rates: swr key ".../v3/websites/rates/website/236753/language/en/property/261766" ->
//            roomTypes[id] = { name, defaultRate {dailyPrice, currency}, rates [{name, dailyPrice, currency,
//            periods [{startDate, endDate}]}] }. We never call the Lodgify API ourselves: websiteserver.lodgify.com
//            answers 403 to our UA (even /robots.txt) - only the inchcape.net pages are read.
// Currency (ORIGINAL = USD): every rate in the embedded rate data carries "currency":"USD", the v2 rate summary
//   says "currencyCode":"USD", and the rates page notes "All rates are per apartment per night in $ US". The EUR
//   figures the pages print ("from €206 per night") are Lodgify's display conversion (searchApp.selectedCurrency
//   USD, conversion 1.1646: EUR 206 x 1.1646 = USD 240 = House Seaside's lowest rate). A rate without a currency
//   in the data -> no slots (note), never a guessed currency.
// Liveness (rule 5b, Aaron 2026-10-12): season periods published 2026-09-01 .. 2028-01-05 ("High Season 2025 -
//   2027", "Christmas 2025 - 2028"); home page "Super Summer 2026 Offers ... Valid for stays from May 01 - October
//   31", booking codes "SS26" and "DIRECT VIP 26". (The site also has investment-opportunity pages; bookings for
//   2026/27 are visibly open, so it is included.)
// robots.txt (2026-10-12): "User-Agent: * Allow: /".
// Requests per run: content 5, slots 1 (pages memoised, so a full run makes 5).
// Parsed: slot = room type x season period ("house-seaside|2026-12-15"), USD per unit per night (room basis,
//   occupancy = the unit's max guests), real period limits; periods that ended before today are dropped; days
//   between two periods that no season covers get the room's "Default Rate" (none in the 2026-10-12 data).
//   availability 'unknown' (the availability calendar loads from the blocked Lodgify API; booking by e-mail,
//   phone or the Lodgify checkout).
// Known limits: rates exclude 10% VAT/service charge, a one-time cleaning fee (USD 50 / 80-100) and the tourism
//   levy (USD 4.40 per bedroom per night); minimum stay "varies depending on the season" (not printed per season).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, parse, todayIso } from '../parse.js';
import type { ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://inchcape.net';
export const IC_HOME_URL = `${SITE}/`;
export const IC_KITE_URL = `${SITE}/en/1714087/kitesurfing`;
export const IC_RATES_URL = `${SITE}/en/1725230/rates`;
export const IC_MAP_URL = `${SITE}/en/1725232/map`;
export const IC_BOOK_URL = `${SITE}/en/1714085/how-to-book`;

export interface IcPeriod { name: string; start: string; end: string; price: number; currency: string | null; isDefault: boolean }
export interface IcRoomRates { id: string; name: string; defaultPrice: number | null; defaultCurrency: string | null; periods: IcPeriod[] }
export interface IcRoom {
  id: string; name: string; maxGuests: number | null; areaM2: number | null; description: string | null;
  features: string[]; amenities: string[]; images: string[];
}

const keyPart = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const dec = (s: unknown): string => {
  if (typeof s !== 'string') return '';
  try { return decodeURIComponent(s); } catch { return s; }
};
const addDays = (d: string, n: number): string => new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10);

// --- memoised page fetch (content and slots share the rates page) ----------------------------------------
const pageCache = new Map<string, Promise<string>>();
function page(url: string): Promise<string> {
  if (!pageCache.has(url)) {
    const p = fetchText(url, { accept: 'text/html' });
    p.catch(() => pageCache.delete(url));
    pageCache.set(url, p);
  }
  return pageCache.get(url)!;
}

// --- Lodgify embedded JSON -------------------------------------------------------------------------------
function scriptJson(html: string, id: string): Record<string, unknown> | null {
  const m = html.match(new RegExp(`<script[^>]*id="${id}"[^>]*>([\\s\\S]*?)</script>`));
  if (!m) return null;
  try { return JSON.parse(m[1]) as Record<string, unknown>; } catch { return null; }
}
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Visible text of <main> as lines. */
function mainLines(html: string): string[] {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, svg, header, footer, nav')) el.remove();
  return (root.querySelector('main') ?? root.querySelector('body') ?? root).structuredText.split('\n').map(l => collapse(l)).filter(Boolean);
}
const mainText = (html: string): string => collapse(mainLines(html).join(' '));

// --- pure parsers -------------------------------------------------------------------------------------
/** Seasonal rates per room type from the rates page's embedded v3 rate response. */
export function parseIcRates(html: string): { rooms: IcRoomRates[]; summaryCurrency: string | null } {
  const swr = scriptJson(html, 'lodgify-swr-fallback-json') ?? {};
  const v3Key = Object.keys(swr).find(k => /\/v3\/websites\/rates\/website\/\d+\/language\/[a-z]+\/property\/\d+/.test(k));
  const v2Key = Object.keys(swr).find(k => /\/v2\/websites\/rates\/website\/\d+\//.test(k));
  const summaryCurrency = v2Key ? (Object.values(obj(swr[v2Key])).map(p => obj(p).currencyCode).find(c => typeof c === 'string') as string | undefined) ?? null : null;
  const rooms: IcRoomRates[] = [];
  for (const [id, raw] of Object.entries(obj(obj(v3Key ? swr[v3Key] : null).roomTypes))) {
    const rt = obj(raw);
    const def = obj(rt.defaultRate);
    const defaultCurrency = typeof def.currency === 'string' ? def.currency : null;
    const periods: IcPeriod[] = [];
    for (const r of arr(rt.rates).map(obj)) {
      const price = typeof r.dailyPrice === 'number' ? r.dailyPrice : null;
      if (price === null || price <= 0) continue;
      for (const p of arr(r.periods).map(obj)) {
        const start = String(p.startDate ?? '').slice(0, 10);
        const end = String(p.endDate ?? '').slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end < start) continue;
        periods.push({ name: dec(r.name), start, end, price, currency: typeof r.currency === 'string' ? r.currency : defaultCurrency, isDefault: false });
      }
    }
    periods.sort((a, b) => a.start.localeCompare(b.start));
    rooms.push({ id, name: collapse(dec(rt.name)), defaultPrice: typeof def.dailyPrice === 'number' ? def.dailyPrice : null, defaultCurrency, periods });
  }
  return { rooms, summaryCurrency };
}

/** Room types from the page model (propertyData[*].roomTypes) with image urls from imageData. */
export function parseIcRooms(html: string): IcRoom[] {
  const model = scriptJson(html, 'lodgify-model-json') ?? {};
  const images = obj(model.imageData);
  const imageUrl = (id: unknown): string | null => {
    const u = obj(images[String(id)]).url;
    return typeof u === 'string' ? u : null;
  };
  const out: IcRoom[] = [];
  for (const prop of Object.values(obj(model.propertyData)).map(obj)) {
    for (const rt of arr(prop.roomTypes).map(obj)) {
      const name = collapse(dec(rt.name));
      if (!name) continue;
      const desc = dec(rt.htmlCleanDescription).split('\n').map(l => collapse(l)).filter(Boolean);
      const body = desc.find((l, i) => i > 0 && l.length > 60) ?? desc[1] ?? null;
      const sentences = body?.match(/[^.!?]+[.!?]+/g) ?? (body ? [body] : []);
      const description = sentences.length ? collapse(sentences.slice(0, 2).join(' ')) : null;
      const feat = [...arr(rt.roomTypeFeatures), ...arr(rt.extraRoomTypeFeatures)].map(f => collapse(dec(obj(f).text))).filter(Boolean);
      const amenities = arr(rt.amenities).flatMap(a => arr(obj(a).items).map(i => collapse(dec(obj(i).text)))).filter(Boolean);
      const imgs = [rt.mainImage, ...arr(rt.images).map(i => obj(i).imageId)].map(imageUrl).filter((u): u is string => !!u);
      out.push({
        id: String(rt.id ?? ''),
        name,
        maxGuests: typeof rt.maxGuests === 'number' ? rt.maxGuests : null,
        areaM2: typeof rt.maxArea === 'number' && rt.areaIsSquareMeters === true ? rt.maxArea : null,
        description,
        features: feat,
        amenities,
        images: [...new Set(imgs)],
      });
    }
  }
  return out;
}

/** Property main image + location from the page model. */
export function parseIcProperty(html: string): { name: string | null; mainImage: string | null; lat: number | null; lng: number | null } {
  const model = scriptJson(html, 'lodgify-model-json') ?? {};
  const prop = Object.values(obj(model.propertyData)).map(obj)[0] ?? {};
  const loc = obj(prop.location);
  const img = obj(obj(model.imageData)[String(prop.mainImage)]).url;
  return {
    name: collapse(dec(prop.name)) || null,
    mainImage: typeof img === 'string' ? img : null,
    lat: typeof loc.latitude === 'number' ? loc.latitude : null,
    lng: typeof loc.longitude === 'number' ? loc.longitude : null,
  };
}

/** Season bands per room from today on; gaps between seasons get the room's default rate. */
export function buildIcSlots(rates: IcRoomRates[], guests: Map<string, number | null>, today: string, ctx?: FetchContext): Slot[] {
  const out: Slot[] = [];
  for (const r of rates) {
    const bands: IcPeriod[] = [...r.periods];
    if (r.defaultPrice && r.periods.length) {
      const sorted = [...r.periods].sort((a, b) => a.start.localeCompare(b.start));
      for (let i = 1; i < sorted.length; i++) {
        const coveredTo = sorted.slice(0, i).reduce((m, p) => (p.end > m ? p.end : m), sorted[0].end);
        const gapStart = addDays(coveredTo, 1);
        const gapEnd = addDays(sorted[i].start, -1);
        if (gapStart <= gapEnd) bands.push({ name: 'Default Rate', start: gapStart, end: gapEnd, price: r.defaultPrice, currency: r.defaultCurrency, isDefault: true });
      }
    }
    for (const b of bands.sort((x, y) => x.start.localeCompare(y.start))) {
      if (b.end < today) continue;
      if (!b.currency || !/^[A-Z]{3}$/.test(b.currency)) {
        ctx?.note(`${r.name} ${b.name} ${b.start}: no currency in the rate data, slot skipped`);
        continue;
      }
      out.push({
        key: `${keyPart(r.name)}|${b.start}`,
        startDate: b.start,
        endDate: b.end,
        unit: r.name,
        price: b.price,
        currency: b.currency,
        priceUnit: 'per_night',
        priceBasis: 'room',
        occupancy: guests.get(r.id) ?? null,
        availability: 'unknown',
        availabilityText: null,
        spotsLeft: null,
      });
    }
  }
  return out;
}

/** Fees and rules printed on the how-to-book / rates pages. */
export function parseIcNotes(bookHtml: string, ratesHtml: string): string[] {
  const t = `${mainText(ratesHtml)} ${mainText(bookHtml)}`;
  const pick = (re: RegExp) => t.match(re)?.[0]?.trim() ?? null;
  return [
    pick(/All rates are per apartment per night in \$ US, 10% Gov\. tax is to be added/i),
    pick(/A 10 % VAT or a service charge is to be added to all bills\./i),
    pick(/A one time cleaning fee will be charged for each rental unit\. \$ US 50 for our one bedroom units[\s\S]*?for our larger units\./i),
    pick(/a Tourism Levy of \$ Bds\. [\d.]+ \/ \/ US [\d.]+ is to be paid p\. bedroom p\. night\./i),
    pick(/A minimum number of nights is required for a reservation and the no\. of nights varies depending on the season\./i),
    pick(/We do have designated storage areas where equipment can be stored[^.]*\./i),
  ].filter((x): x is string => !!x);
}

export interface IcPages { home: string; kite: string; rates: string; map: string; book: string }

export function parseInchcapeContent(p: IcPages, today = todayIso()): OfferContent {
  const home = mainText(p.home);
  const kite = mainText(p.kite);
  const rooms = parseIcRooms(p.rates);
  const { rooms: rates, summaryCurrency } = parseIcRates(p.rates);
  const prop = parseIcProperty(p.map);
  const propRates = parseIcProperty(p.rates);
  const notes = parseIcNotes(p.book, p.rates);
  const future = rates.flatMap(r => r.periods.filter(x => x.end >= today));
  const prices = future.map(x => x.price);
  const currency = future.find(x => x.currency)?.currency ?? summaryCurrency;
  const guests = rooms.map(r => r.maxGuests).filter((g): g is number => g !== null);
  const lessons = kite.match(/Brian Talma's Action Shop at Silver Rock is available for kitesu?r?fing lessons/i)?.[0] ?? null;
  const summer = home.match(/Super Summer 20\d\d Offers[\s\S]*?Valid for stays from [A-Za-z]+ \d+ – [A-Za-z]+ \d+/)?.[0] ?? null;

  const contentRooms: ContentRoom[] = rooms.map(r => {
    const rr = rates.find(x => x.id === r.id);
    const own = (rr?.periods ?? []).filter(x => x.end >= today);
    return {
      name: r.name,
      description: r.description,
      features: [
        ...(r.maxGuests ? [`Up to ${r.maxGuests} guests`] : []),
        ...(r.areaM2 ? [`${r.areaM2} m²`] : []),
        ...r.features.filter(f => !/guests$/i.test(f)),
        ...[...new Set(r.amenities.map(a => (/wireless|internet/i.test(a) ? 'Wi-Fi' : a)).filter(a => /^(Wi-Fi|Ceiling fans|Air conditioning|A\/C|Kitchen stove|Oven|Refrigerator|Washing machine|Dishwasher)$/i.test(a)))],
        ...[...new Map(own.map(x => [`${x.name}|${x.price}`, x])).values()].map(x => `${x.name}: ${x.currency ?? '?'} ${x.price} per night`),
      ],
    };
  });

  const imageUrls: string[] = [];
  const pool = rooms.map(r => r.images);
  for (const u of [prop.mainImage ?? propRates.mainImage, ...pool.map(l => l[0])]) if (u && !imageUrls.includes(u)) imageUrls.push(u);
  for (let i = 1; imageUrls.length < 40 && pool.some(l => l.length > i); i++) {
    for (const l of pool) if (l[i] && !imageUrls.includes(l[i]) && imageUrls.length < 40) imageUrls.push(l[i]);
  }

  const summary = [
    `Inchcape Seaside Villas is a private estate of ${rooms.length || 17} self-catering studios, apartments, cottages and houses${guests.length ? ` for ${Math.min(...guests)} to ${Math.max(...guests)} guests` : ''} on the western end of Silver Sands Beach in Christ Church, on the south coast of Barbados.`,
    `Silver Sands and Silver Rock, the beaches around the estate, attract most of the island's kitesurfers; lessons are given by Brian Talma's Action Shop at Silver Rock and other schools between Silver Sands and Long Beach (not on the estate), and the estate has storage areas for sports equipment.`,
    prices.length && currency
      ? `Rates run from ${currency} ${Math.min(...prices)} to ${Math.max(...prices)} per unit per night by unit and season, plus 10% VAT, a one-time cleaning fee and a tourism levy; bookings are made by e-mail, phone or online checkout.`
      : 'Bookings are made by e-mail, phone or online checkout.',
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Inchcape Seaside Villas',
    summary,
    continent: 'North America',
    country: 'Barbados',
    region: 'Christ Church',
    spot: 'Silver Sands',
    spotCoords: prop.lat !== null && prop.lng !== null ? { lat: prop.lat, lng: prop.lng } : null,
    spotCoordsPrecise: true,
    itinerarySpots: [],
    durationDays: null,
    // kite page: Long Beach "ideal spot to teach and learn"; waves on the outside reef "for the more experienced"
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: null,   // only at independent schools nearby (Brian Talma's Action Shop, Silver Rock)
    equipmentRental: null,
    beginnerFriendly: /ideal spot to teach and learn kitesurfing/i.test(kite) ? true : null,
    includedServices: ['Limited maid service (towels and sheets changed every three days, on request)', 'Storage areas for sports equipment', 'Parking'],
    optionalServices: [
      'Airport pick-up',
      'Rental car delivered to the property',
      'Extended maid or cook service',
      ...(lessons ? ['Kite lessons nearby at Brian Talma\'s Action Shop (Silver Rock), not run by the estate'] : []),
    ],
    accommodation: 'self-catering beachfront studios, apartments, cottages and houses',
    mealPlan: 'self_catering',
    languages: [],
    rooms: contentRooms,
    imageUrls,
    heroVideoUrl: null,
    sourceUrl: IC_HOME_URL,
    bookingUrl: IC_BOOK_URL,
    sourceText: [
      `home: ${home}`,
      `kitesurfing: ${kite}`,
      `rates (currency ${currency ?? '?'}): ${rates.map(r => `${r.name}: default ${r.defaultPrice ?? '-'} ${r.defaultCurrency ?? ''}; ${r.periods.map(x => `${x.name} ${x.start}..${x.end} ${x.price} ${x.currency ?? '?'}`).join('; ')}`).join(' | ')}`,
      `rooms: ${rooms.map(r => `${r.name} (max ${r.maxGuests ?? '?'}, ${r.areaM2 ?? '?'} m²): ${r.features.join(', ')}`).join(' | ')}`,
      `notes: ${notes.join(' | ')}`,
      `liveness: ${summer ? collapse(summer.replace(/–/g, '-')) : 'no summer offer'}; season periods up to ${rates.flatMap(r => r.periods.map(x => x.end)).sort().pop() ?? '?'}`,
      `location: ${prop.lat ?? '?'}, ${prop.lng ?? '?'} (Lodgify property location on /en/1725232/map)`,
    ].join('\n'),
  };
}

export const inchcapeSeasideVillasSilverSands: OfferAdapter = {
  key: 'inchcape-seaside-villas-silver-sands',
  name: 'Inchcape Seaside Villas (Silver Sands, Barbados)',
  kind: 'accommodation',
  operator: {
    name: 'Inchcape Seaside Villas',
    websiteUrl: SITE,
    rootDomain: 'inchcape.net',
    contactEmail: 'rentals@inchcape.net', // site footer + how-to-book page, 2026-10-12
    phone: '+12464287006',
  },
  url: IC_HOME_URL,
  slotMethod: 'price_table',
  fetchBudget: 6,
  async fetchContent() {
    const home = await page(IC_HOME_URL);
    const kite = await page(IC_KITE_URL);
    const rates = await page(IC_RATES_URL);
    const map = await page(IC_MAP_URL);
    const book = await page(IC_BOOK_URL);
    return parseInchcapeContent({ home, kite, rates, map, book });
  },
  async fetchSlots(ctx) {
    const html = await page(IC_RATES_URL);
    const { rooms: rates } = parseIcRates(html);
    if (rates.length < 5) throw new Error(`inchcape: embedded rate data not found or changed (${rates.length} room types)`);
    const guests = new Map(parseIcRooms(html).map(r => [r.id, r.maxGuests] as const));
    const slots = buildIcSlots(rates, guests, todayIso(), ctx);
    if (slots.length === 0) ctx.note('no current or future season period in the rate data: price on request until new seasons are published');
    return slots;
  },
};
