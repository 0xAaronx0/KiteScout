// ---------------------------------------------------------------------------
// WattLodge, Norden / Norddeich (East Frisia, German North Sea) - bed & breakfast and hostel on a listed East Frisian
// farmstead (Gutshof) in Norden: Surfer-Suites, multi-bed hostel rooms and the "Hütten-Hostel" in the former barn. Kite
// link on its own site: "In unserem Wassersportzentrum, der Surfschule Norddeich, kannst du Kurse für Wingsurfen, Kiten,
// Windsurfen ... belegen ... Material zu mieten oder dein eigenes Material im Storage sicher einzulagern" (home) plus kite
// weekend / kite week packages incl. accommodation (/sportangebot/). The school's own site (surfschule-norddeich.de) names
// the WattLodge as its accommodation (/unterkunft/, /camps/kitecamp/).
//
// Data path (checked 2026-10-14), WordPress / Bricks builder:
//   content  / (intro, rooms, kite link), /zimmer/, /huetten-hostel/, /sportangebot/ (kite weekend / kite week prices).
//   slots    Easy-Booking (easy-booking.at, customer 10928, locale 2 = de), the engine /buchen/ embeds
//            (jquery.easybooking.frontend.js -> /bookingengine2/ app). Its step-two view asks
//            POST /easybooking/index.php/api/searchCatAvailability/10928/2 with a form body (customerId, numAdults,
//            numChildren, arrivalDate, departureDate yyyy-MM-dd, childrenDOB, localeId) and a random client-side
//            X-Session-Id (utils.getSessionId: two Math.random() strings, no server handshake); no login, cookie, CSRF
//            token or signature (the X-CSRF-Token header exists only on the booking / customer models, which we never call).
//            The answer lists the categories bookable for that stay (catName, min/maxPersons, roomCount = free rooms,
//            priceDetails with totalPrice, breakfast and Kurtaxe, room labels, photos) - no guest data. One stay of 7
//            nights for 2 adults from the first Saturday of each month, always all 12 within 12 months (on 2026-10-14 only
//            17.10. was bookable; Nov / Dec answered "FrontEndNoResult" = rates but nothing bookable, from Jan 2027
//            "FrontEndNoResultNoPrice" = rates not loaded).
//   fallback /preise/: Bricks pricing tables (li.pricing-table: title, subtitle, "€ 62 p.P", meta, features) with
//            "*alle Preise pro Person zzgl. Kurtaxe", used only when the engine prices no category (one slot per room
//            type without dates, EUR per person per night - "per night" INFERRED, availability 'unknown').
// Liveness: the WattLodge pages were last edited 2024-12 / 2025-03-27 (/preise/, WP REST `modified`); the 2026 evidence
//   is the working online booking and the school's own home page ("Wir sind noch bis Ende Oktober für euch in Norddeich.
//   Nächstes Jahr sind wir spätestens am 01.04.2027 wieder vorne für euch am Strand!", checked 2026-10-14).
// robots.txt (2026-10-14): wattlodge.de WordPress defaults (only /wp-admin/); www.easy-booking.at disallows only
//   /enquiryForm/ and /bookingManager/.
// Requests per run: content 5, slots 12 engine POSTs (+1 /preise/ only in the fallback, memoised with content) = max 18.
// Parsed (engine): slot = category x sample week ("doppelzimmer-superior|2026-11-07"), EUR per room for 7 nights and
//   2 adults incl. breakfast where the category includes it, WITHOUT the Kurtaxe (priceUnit 'package', packageNights 7,
//   priceBasis 'room', occupancy 2); available (>= 2 free rooms) / limited (1 free, spotsLeft) / sold_out (a category seen
//   in another sampled week is missing from an answer that lists other categories). Empty answers are skipped (closed or
//   not loaded). The "Womo Stellplatz" (camper pitch) category is left out.
// Parsed (fallback): one slot per room type without dates, EUR per person per night (priceBasis 'person'), occupancy 2 for
//   the suites, 1 for a hostel bed; availability 'unknown'.
// Known limits: no coordinates on the site (a maps.app.goo.gl short link only) -> no spotCoords.
// ---------------------------------------------------------------------------
import { BlockedByHost, fetchText } from '../http.js';
import { clean, collapse, imageCandidates, parse, parseAmount, todayIso } from '../parse.js';
import type { Availability, ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';
import { csobAddDays, csobSaturdaySamples } from './hvide-sande-camping.js';

const SITE = 'https://wattlodge.de';
export const WL_HOME_URL = `${SITE}/`;
export const WL_PRICES_URL = `${SITE}/preise/`;
export const WL_ROOMS_URL = `${SITE}/zimmer/`;
export const WL_HOSTEL_URL = `${SITE}/huetten-hostel/`;
export const WL_SPORT_URL = `${SITE}/sportangebot/`;
const BOOKING_URL = `${SITE}/buchen/`;

const memo = new Map<string, { at: number; p: Promise<string> }>();
/** one fetch per page per 10 minutes: fetchContent + fetchSlots in the same run share the pages */
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}
const keyPart = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Visible text of the page's <main> (header, footer, scripts dropped); block and span boundaries become spaces
 *  (Bricks puts "im Hütten-Hostel" and "ab 307€" into sibling elements). */
export function wlText(html: string): string {
  const root = parse(html.replace(/<(?=\/?(?:p|div|li|ul|ol|h[1-6]|br|section|figure|span|a|td|th|tr)\b)/gi, ' <'));
  for (const el of root.querySelectorAll('script, style, noscript, svg, header, footer, nav')) el.remove();
  return collapse((root.querySelector('main') ?? root.querySelector('body') ?? root).text);
}

export interface WlRate {
  name: string;
  subtitle: string;
  price: number;
  /** "p.P" printed next to the price (the page footnote says every price is per person anyway) */
  perPersonMark: boolean;
  meta: string | null;
  features: string[];
  occupancy: number;
  pitch: boolean;
}

/** /preise/: one Bricks pricing table per room type. */
export function parseWlRates(html: string): WlRate[] {
  const out: WlRate[] = [];
  for (const li of parse(html).querySelectorAll('li.pricing-table')) {
    const name = clean(li.querySelector('.pricing-table-title')?.text);
    const subtitleHtml = li.querySelector('.pricing-table-subtitle')?.innerHTML ?? '';
    const subtitle = clean(subtitleHtml.replace(/<br\s*\/?>/gi, ' '));
    const price = parseAmount(li.querySelector('.pricing-table-price')?.text ?? '');
    if (!name || !price) continue;
    const suffix = clean(li.querySelector('.pricing-table-price-suffix')?.text);
    const meta = clean(li.querySelector('.pricing-table-price-meta')?.text) || null;
    const features = li.querySelectorAll('.pricing-table-feature-title').map(f => clean(f.text)).filter(Boolean);
    const twoPersons = /doppelzimmer|zweib\w*zimmer|ab zwei personen/i.test(`${subtitle} ${meta ?? ''}`);
    out.push({
      name, subtitle, price, perPersonMark: /p\.?\s?P/i.test(suffix), meta, features,
      occupancy: twoPersons ? 2 : 1,
      pitch: /stellplatz/i.test(name),
    });
  }
  return out;
}

/** "*alle Preise pro Person zzgl. Kurtaxe – Kurtaxe in der Höhe von 3,50 Euro pro Nacht ..." */
export function parseWlNotes(html: string): { perPerson: boolean; kurtaxe: string | null; checkIn: string | null; cancel: string | null } {
  const t = wlText(html);
  return {
    perPerson: /alle Preise pro Person/i.test(t),
    kurtaxe: t.match(/Kurtaxe in der Höhe von ([\d,]+) Euro pro Nacht/i)?.[1] ?? null,
    checkIn: t.match(/Check-in Zeiten sind zwischen ([\d.:]+ Uhr und [\d.:]+ Uhr)/i)?.[1] ?? null,
    cancel: t.match(/kostenfrei bis (\d+) Tage vor Anreise/i)?.[1] ?? null,
  };
}

export function buildWlSlots(rates: WlRate[]): Slot[] {
  return rates.filter(r => !r.pitch).map(r => ({
    key: keyPart(r.name),
    startDate: null,
    endDate: null,
    unit: r.name,
    price: r.price,
    currency: 'EUR',
    priceUnit: 'per_night',
    priceBasis: 'person',
    occupancy: r.occupancy,
    availability: 'unknown',
    availabilityText: null,
    spotsLeft: null,
  }));
}

export interface WlPackages { kiteWeekend: number | null; kiteWeek: number | null }

/** /sportangebot/: "KITESURF WEEKEND ... im Hütten-Hostel ab 307€", "KITEWOCHE ... im Hütten-Hostel ab 755€". */
export function parseWlPackages(html: string): WlPackages {
  const t = wlText(html);
  const from = (re: RegExp) => { const m = t.match(re); return m ? parseAmount(m[1]) : null; };
  return {
    kiteWeekend: from(/KITESURF WEEKEND[\s\S]*?im Hütten-Hostel ab ([\d.,]+)\s?€/i),
    kiteWeek: from(/KITEWOCHE[\s\S]*?im Hütten-Hostel ab ([\d.,]+)\s?€/i),
  };
}

const ENGLISH: Record<string, string> = {
  'Surfer-Suite Basic': 'Twin room with bunk bed, own shower and WC, breakfast included',
  'Surfer-Suite Classic': 'Double room with own shower and WC, breakfast included',
  "Surfer's Hostel": 'Multi-bed room with shared shower on the floor, bed linen included, breakfast extra',
  'Hütten-Hostel': 'Multi-bed hut room (up to 4) in the former barn, shared bathroom, bed linen and breakfast extra',
  'Hütten-Suite': 'Alpine-style hut room for 2-3 with own bathroom, bed linen and breakfast included (from two persons)',
};

export interface WlPages { home: string; prices: string; rooms: string; hostel: string; sport: string }

export function parseWattlodgeContent(p: WlPages): OfferContent {
  const home = wlText(p.home);
  const rates = parseWlRates(p.prices);
  const notes = parseWlNotes(p.prices);
  const pk = parseWlPackages(p.sport);
  const kiteLine = home.match(/In unserem Wassersportzentrum[\s\S]*?einzulagern\./)?.[0] ?? null;
  const rooms: ContentRoom[] = rates.filter(r => !r.pitch).map(r => ({
    name: r.name,
    description: ENGLISH[r.name] ?? r.subtitle,
    features: [
      `EUR ${r.price} per person per night${r.meta ? ` (${r.meta})` : ''}`,
      r.subtitle,
      ...r.features,
    ],
  }));
  const breakfast = rates.flatMap(r => r.features).map(f => f.match(/^Frühstück ([\d,]+) Euro pro Person/i)?.[1]).find(Boolean) ?? null;
  const min = rates.filter(r => !r.pitch).reduce<number | null>((m, r) => (m === null || r.price < m ? r.price : m), null);

  const imgs: string[] = [];
  const seen = new Set<string>();
  for (const [html, base] of [[p.home, WL_HOME_URL], [p.rooms, WL_ROOMS_URL], [p.hostel, WL_HOSTEL_URL], [p.prices, WL_PRICES_URL]] as const) {
    for (const u of imageCandidates(html, base, null, 60)) {
      if (!/wattlodge\.de\/wp-content\/uploads\//.test(u) || /logo|favicon|watt-lodge-weiss|\.svg|\.png$/i.test(u)) continue;
      const k = u.replace(/-(?:\d+x\d+|scaled)(?=\.[a-z]+$)/i, '');
      if (seen.has(k)) continue;
      seen.add(k); imgs.push(u);
    }
  }

  const summary = [
    'WattLodge is a bed & breakfast and hostel on a listed East Frisian farmstead in Norden near Norddeich on the Wadden Sea coast, with a large garden, a lounge, a guest kitchen and a barbecue area.',
    `It offers Surfer-Suites (double and twin rooms with own bathroom and breakfast), multi-bed rooms in the Surfer's Hostel and the Hütten-Hostel in the former barn, and Hütten-Suites${min !== null ? `, from EUR ${min} per person per night` : ''}.`,
    `Its water sports centre, the Surfschule Norddeich, runs kitesurfing, wing and windsurf courses with equipment rental and storage${pk.kiteWeekend ? `; kite weekends (2 nights, 2 days of kitesurfing) start at EUR ${pk.kiteWeekend} per person including accommodation` : ''}.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'WattLodge',
    summary,
    continent: 'Europe',
    country: 'Germany',
    region: 'Norden, East Frisia',
    spot: 'Norddeich',
    itinerarySpots: [],
    durationDays: null,
    skillLevels: ['beginner', 'intermediate'],
    kiteLessons: kiteLine ? /Kiten/.test(kiteLine) : null,
    equipmentRental: kiteLine ? /Material zu mieten/.test(kiteLine) : null,
    beginnerFriendly: true,
    includedServices: ['Wi-Fi in all rooms', 'Garden with beach volleyball and barbecue area', 'Guest kitchen'],
    optionalServices: [
      ...(breakfast ? [`Breakfast EUR ${breakfast.replace(',', '.')} per person (hostel rooms)`] : []),
      'Kitesurfing, wing and windsurf courses at the Surfschule Norddeich',
      'Equipment rental and storage at the Surfschule Norddeich',
      ...(pk.kiteWeekend ? [`Kite weekend: 2 nights + 2 days of kitesurfing (2 h each), from EUR ${pk.kiteWeekend} per person in the Hütten-Hostel`] : []),
      ...(pk.kiteWeek ? [`Kite week Monday-Friday: 4 nights + 5 days of at least 4 h training incl. equipment, from EUR ${pk.kiteWeek} per person in the Hütten-Hostel`] : []),
      notes.kurtaxe ? `Plus Kurtaxe (visitor tax) EUR ${notes.kurtaxe.replace(',', '.')} per person per night from age 14` : 'Plus Kurtaxe (visitor tax)',
    ],
    accommodation: 'farmstead B&B rooms, multi-bed hostel rooms and hut rooms',
    mealPlan: 'breakfast',
    languages: ['de'],
    rooms,
    imageUrls: imgs.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: WL_HOME_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      `home: ${home}`,
      `prices: ${rates.map(r => `${r.name} (${r.subtitle}) EUR ${r.price}${r.perPersonMark ? ' p.P' : ''}${r.meta ? ` ${r.meta}` : ''} | ${r.features.join('; ')}`).join(' || ')}`,
      `price notes: all prices per person ${notes.perPerson}; Kurtaxe ${notes.kurtaxe ?? '-'} EUR per night; check-in ${notes.checkIn ?? '-'}; free cancellation until ${notes.cancel ?? '-'} days before arrival`,
      `kite packages: weekend from ${pk.kiteWeekend ?? '-'} EUR, kite week from ${pk.kiteWeek ?? '-'} EUR (per person incl. Hütten-Hostel)`,
      `rooms: ${wlText(p.rooms)}`,
      `hostel: ${wlText(p.hostel)}`,
    ].join('\n'),
  };
}

export async function fetchWlSlots(): Promise<Slot[]> {
  const rates = parseWlRates(await page(WL_PRICES_URL));
  if (rates.filter(r => !r.pitch).length < 3) throw new Error(`wattlodge-norden: price cards not found on /preise/ (${rates.length} parsed; layout changed?)`);
  return buildWlSlots(rates);
}

// --- Easy-Booking engine ------------------------------------------------------------------------------
export const WL_EB_CUSTOMER = 10928;
export const WL_EB_LOCALE = 2;
export const WL_EB_SEARCH_URL = `https://www.easy-booking.at/easybooking/index.php/api/searchCatAvailability/${WL_EB_CUSTOMER}/${WL_EB_LOCALE}`;
/** the widget's own anonymous id (utils.getSessionId: random, client-side, no handshake) - one per process */
const WL_EB_SESSION = Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);

/** Form body of the widget's category search for one stay (yyyy-MM-dd dates, no children). */
export function wlSearchBody(checkIn: string, nights = 7, adults = 2): string {
  return new URLSearchParams({
    customerId: String(WL_EB_CUSTOMER), numAdults: String(adults), numChildren: '0',
    arrivalDate: checkIn, departureDate: csobAddDays(checkIn, nights), childrenDOB: '', localeId: String(WL_EB_LOCALE),
  }).toString();
}

export interface WlCat { name: string; minPersons: number; maxPersons: number; free: number; total: number; tax: number; catering: string | null }
export interface WlSample { checkIn: string; nights: number; adults: number; cats: WlCat[]; error: string | null }

type Json = Record<string, unknown>;

/** searchCatAvailability answer -> bookable categories (camper pitches dropped); catArr is [] when nothing is bookable. */
export function parseWlSearch(json: string, checkIn: string, nights = 7, adults = 2): WlSample {
  const d = JSON.parse(json) as { catArr?: unknown; errorMsg?: string } | null;
  if (!d || typeof d !== 'object' || !('catArr' in d)) throw new Error('easy-booking: answer without catArr');
  const raw = (Array.isArray(d.catArr) ? d.catArr : Object.values((d.catArr ?? {}) as Json)) as Json[];
  const cats: WlCat[] = [];
  for (const c of raw) {
    const name = clean(String(c.catName ?? ''));
    const rooms = (Array.isArray(c.rooms) ? c.rooms : Object.values((c.rooms ?? {}) as Json)) as Json[];
    const pd = (c.priceDetails && typeof c.priceDetails === 'object' ? c.priceDetails : rooms[0]?.priceDetails) as Json | undefined;
    const total = Number(pd?.totalPrice);
    if (!name || /stellplatz/i.test(name) || !Number.isFinite(total) || total <= 0) continue;
    const catering = (c.catering as Array<{ stl_name?: string; isDefault?: boolean }> | undefined)?.find(x => x.isDefault)?.stl_name ?? null;
    cats.push({
      name, minPersons: Number(c.minPersons) || 1, maxPersons: Number(c.maxPersons) || adults,
      free: Number(c.roomCount) || rooms.length, total, tax: Number(pd?.totalPriceVisitorsTax) || 0, catering,
    });
  }
  return { checkIn, nights, adults, cats, error: d.errorMsg ? String(d.errorMsg) : null };
}

export async function fetchWlSample(checkIn: string, nights = 7, adults = 2): Promise<WlSample> {
  const text = await fetchText(WL_EB_SEARCH_URL, {
    method: 'POST', body: wlSearchBody(checkIn, nights, adults), contentType: 'application/x-www-form-urlencoded; charset=UTF-8',
    accept: 'application/json, text/javascript, */*; q=0.01', headers: { 'X-Session-Id': WL_EB_SESSION },
  });
  return parseWlSearch(text, checkIn, nights, adults);
}

/** First Saturday from tomorrow in each of the next 12 months. */
export function wlSampleCheckIns(today: string): string[] {
  return csobSaturdaySamples(today, [{ start: today, end: csobAddDays(today, 400) }], { max: 12, horizonMonths: 12 });
}

/** Samples -> slots; a category seen in another sample but missing from a non-empty answer is sold out for that stay. */
export function buildWlEngineSlots(samples: WlSample[]): Slot[] {
  const names: string[] = [];
  for (const s of samples) for (const c of s.cats) if (!names.includes(c.name)) names.push(c.name);
  const out: Slot[] = [];
  for (const s of samples) {
    if (s.cats.length === 0) continue;
    for (const name of names) {
      const c = s.cats.find(x => x.name === name);
      const availability: Availability = !c ? 'sold_out' : c.free <= 1 ? 'limited' : 'available';
      out.push({
        key: `${keyPart(name)}|${s.checkIn}`,
        startDate: s.checkIn,
        endDate: csobAddDays(s.checkIn, s.nights - 1),
        unit: name,
        price: c ? Math.round((c.total - c.tax) * 100) / 100 : null,
        currency: c ? 'EUR' : null,
        priceUnit: c ? 'package' : null,
        priceBasis: 'room',
        occupancy: s.adults,
        availability,
        availabilityText: c
          ? `${c.free} free for ${s.nights} nights from ${s.checkIn} (${s.adults} adults${c.catering ? `, ${c.catering}` : ''}; Kurtaxe EUR ${c.tax} extra)`
          : `not offered for ${s.nights} nights from ${s.checkIn} (${s.adults} adults)`,
        spotsLeft: c ? c.free : 0,
        packageNights: s.nights,
      });
    }
  }
  return out;
}

/** Engine first; the printed /preise/ cards only when the engine prices no category. */
export async function fetchWlLiveSlots(today: string, ctx: FetchContext): Promise<Slot[]> {
  // no early stop: a winter closure ("FrontEndNoResult") lies between two seasons
  const samples: WlSample[] = [];
  for (const d of wlSampleCheckIns(today)) {
    try {
      samples.push(await fetchWlSample(d));
    } catch (e) {
      if (e instanceof BlockedByHost) throw e;
      ctx.incomplete(`easy-booking sample ${d}: ${(e as Error).message}`);
    }
  }
  const empty = samples.filter(s => s.cats.length === 0).map(s => `${s.checkIn} ${s.error ?? 'empty'}`);
  if (empty.length) ctx.note(`wattlodge-norden: easy-booking had nothing bookable for ${empty.join(', ')}`);
  const engine = buildWlEngineSlots(samples);
  if (engine.some(s => s.price != null)) return engine;
  ctx.note('wattlodge-norden: easy-booking priced no category in any sample week - /preise/ cards used');
  return fetchWlSlots();
}

export const wattlodgeNorden: OfferAdapter = {
  key: 'wattlodge-norden',
  name: 'WattLodge Norden',
  kind: 'accommodation',
  operator: {
    name: 'WattLodge',
    websiteUrl: SITE,
    rootDomain: 'wattlodge.de',
    contactEmail: 'info@wattlodge.de',
    phone: '+4915129903392',
  },
  url: WL_HOME_URL,
  slotMethod: 'booking_engine',
  instantBooking: true,
  liveAvailability: true,
  fetchBudget: 18,
  async fetchContent() {
    const home = await page(WL_HOME_URL);
    const prices = await page(WL_PRICES_URL);
    const rooms = await page(WL_ROOMS_URL);
    const hostel = await page(WL_HOSTEL_URL);
    const sport = await page(WL_SPORT_URL);
    if (!/Surfschule Norddeich/.test(home)) throw new Error('wattlodge-norden: kite link (Surfschule Norddeich) missing on the home page');
    return parseWattlodgeContent({ home, prices, rooms, hostel, sport });
  },
  async fetchSlots(ctx) {
    return fetchWlLiveSlots(todayIso(), ctx);
  },
};
