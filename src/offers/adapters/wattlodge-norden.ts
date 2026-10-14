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
//   slots    /preise/: Bricks pricing tables (li.pricing-table: title, subtitle, "€ 62 p.P", meta, features) with
//            "*alle Preise pro Person zzgl. Kurtaxe". The Bulli-Stellplatz card is a pitch and is left out.
// Booking engine: /buchen/ embeds Easy-Booking (easy-booking.at, customer 10928; the widget's API calls send a random
//   client-side X-Session-Id). Not used: the room search is a Backbone app whose request shape we did not establish
//   (views load dynamically); robots.txt there only disallows /enquiryForm/ and /bookingManager/. Candidate for later.
// Liveness: the WattLodge pages were last edited 2024-12 / 2025-03-27 (/preise/, WP REST `modified`); the 2026 evidence
//   is the working online booking and the school's own home page ("Wir sind noch bis Ende Oktober für euch in Norddeich.
//   Nächstes Jahr sind wir spätestens am 01.04.2027 wieder vorne für euch am Strand!", checked 2026-10-14).
// robots.txt (2026-10-14): WordPress defaults (only /wp-admin/).
// Requests per run: content 5, slots 1 (memoised with content).
// Parsed: slots = one per room type without dates (the table has no season or year), EUR per person per night
//   (priceBasis 'person'; "per night" is INFERRED: the cards print "€ 62 p.P" plus "Zuschlag für eine Nacht 20 Euro" and a
//   Kurtaxe "pro Nacht"), occupancy 2 for the suites, 1 for a hostel bed; availability 'unknown' (online booking exists,
//   we do not read it).
// Known limits: no coordinates on the site (a maps.app.goo.gl short link only) -> no spotCoords.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, collapse, imageCandidates, parse, parseAmount } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

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
  slotMethod: 'price_table',
  fetchBudget: 6,
  confidence: 'medium', // year-less table, per-night unit inferred
  async fetchContent() {
    const home = await page(WL_HOME_URL);
    const prices = await page(WL_PRICES_URL);
    const rooms = await page(WL_ROOMS_URL);
    const hostel = await page(WL_HOSTEL_URL);
    const sport = await page(WL_SPORT_URL);
    if (!/Surfschule Norddeich/.test(home)) throw new Error('wattlodge-norden: kite link (Surfschule Norddeich) missing on the home page');
    return parseWattlodgeContent({ home, prices, rooms, hostel, sport });
  },
  async fetchSlots() {
    return fetchWlSlots();
  },
};
