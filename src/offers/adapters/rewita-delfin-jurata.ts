// ---------------------------------------------------------------------------
// Rewita Jurata "Delfin" (Jurata, Hel Peninsula, Poland) - holiday resort of the AMW Rewita group in a pine forest
// between Puck Bay and the open Baltic, 200+ beds in Superior double rooms and apartments, restaurant (breakfast,
// dinner buffet), sauna, fitness, tennis, bike rental. Kite link: the resort's own page "Szkółka Wind/Kite na
// terenie Ośrodka Rewity w Juracie" (kite and windsurf school on the Rewita grounds in Jurata, certified
// instructors, children and adults, shallow bay lagoon).
//
// Liveness (2026-10-12): live "od X zł /noc" room prices, room photos updated 2026-09-24, and special offers for
//   the 2026/27 winter on /oferty-specjalne (New Year's Eve, Christmas, autumn packages; checked once, not read
//   per run).
// Data path (checked 2026-10-12): Profitroom website builder, Polish.
//   slots    /obiekty/rewita-jurata/pokoje-do-wynajecia-jurata-rewita: one card per room type, <a aria-label=NAME
//            data-guests=N data-price=P href=...> with "od P zł /noc", area, beds, layout and equipment in its text.
//   content  /obiekty/rewita-jurata (resort, facilities, restaurant, contact), the rooms page, and the kite school
//            article /obiekty/rewita-jurata/rewita-jurata-delfin/atrakcje/szkolka-wind-kite-na-terenie-osrodka-
//            rewity-w-juracie.
// Booking engine: Profitroom (booking.profitroom.com) - robots.txt "Disallow: /" -> not called, availability
//   'unknown'.
// robots.txt (2026-10-12): www.rewita.pl has no Disallow rules (sitemap only).
// Requests per run: content 3, slots 1 (memoised).
// Parsed: slot = room type ("delfin-pokoj-2-os-superior"), price = the card's "od" (from) rate, PLN per room and
//   night, occupancy = data-guests (max guests), no dates (the site prints no season for the from-rate), board not
//   stated for the from-rate (the booking engine sells room-only, breakfast and half-board plans).
// Known limits: from-rates only, no dates; no map pin: the JSON-LD geo (52.2776, 21.0275) is in Warsaw, not Jurata,
//   and the map button is a maps.app.goo.gl short link without coordinates.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, imageCandidates, parse } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.rewita.pl';
export const RJ_HOME_URL = `${SITE}/obiekty/rewita-jurata`;
export const RJ_ROOMS_URL = `${SITE}/obiekty/rewita-jurata/pokoje-do-wynajecia-jurata-rewita`;
export const RJ_KITE_URL = `${SITE}/obiekty/rewita-jurata/rewita-jurata-delfin/atrakcje/szkolka-wind-kite-na-terenie-osrodka-rewity-w-juracie`;

const memo = new Map<string, { at: number; p: Promise<string> }>();
function get(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}
const flat = (s: string): string => clean(s).replace(/[​ ]/g, ' ').replace(/\s+/g, ' ').trim();
export function rjLines(html: string): string[] {
  return html
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .split(/<\/?(?:p|li|td|th|tr|h\d|div|br|ul|section|a|button|figure)\b[^>]*>/i)
    .map(s => flat(s.replace(/<[^>]+>/g, ' ')))
    .filter(Boolean);
}

// --- pure parsers -----------------------------------------------------------------------------
export interface RjRoom { key: string; raw: string; name: string; maxGuests: number | null; price: number | null; areaM2: number | null; text: string; url: string | null; images: string[] }

/** English name for the Profitroom room names ("DELFIN DUŻY APARTAMENT 2 OS. SUPERIOR"). */
export function rjName(raw: string): string {
  const prefix = /^DELFIN\b/i.test(raw) ? 'Delfin ' : '';
  if (/DUŻY APARTAMENT/i.test(raw)) return `${prefix}large Superior apartment`;
  if (/MAŁY APARTAMENT/i.test(raw)) return `${prefix}small Superior apartment`;
  if (/POKÓJ/i.test(raw)) return /\(Ł\+W\)/i.test(raw) ? `${prefix}Superior room with sofa bed` : `${prefix}Superior twin room`;
  return raw.toLowerCase().replace(/(^|\s)\S/g, m => m.toUpperCase());
}

export function parseRjRooms(html: string): RjRoom[] {
  const out: RjRoom[] = [];
  for (const a of parse(html).querySelectorAll('a[data-price]')) {
    const raw = flat(a.getAttribute('aria-label') ?? '');
    const href = a.getAttribute('href') ?? null;
    const key = href?.replace(/\/$/, '').split('/').pop() ?? '';
    if (!raw || !key || out.some(r => r.key === key)) continue;
    const text = flat(a.text);
    out.push({
      key,
      raw,
      name: rjName(raw),
      maxGuests: Number(a.getAttribute('data-guests')) || Number(text.match(/maks\.\s*(\d+)\s*os\./i)?.[1]) || null,
      price: Number(a.getAttribute('data-price')) || Number(text.match(/od\s*(\d[\d\s]*)\s*zł/i)?.[1]?.replace(/\s/g, '')) || null,
      areaM2: Number(text.match(/(\d+)\s*m\s*2/i)?.[1]) || null,
      text,
      url: href,
      images: a.querySelectorAll('img').map(i => i.getAttribute('data-src') ?? i.getAttribute('src') ?? '').filter(u => /^https?:/.test(u)),
    });
  }
  return out;
}

export function buildRjSlots(rooms: RjRoom[]): Slot[] {
  return rooms.filter(r => r.price !== null).map(r => ({
    key: r.key,
    startDate: null,
    endDate: null,
    unit: r.name,
    price: r.price,
    currency: 'PLN',
    priceUnit: 'per_night' as const,
    priceBasis: 'room' as const,
    occupancy: r.maxGuests,
    availability: 'unknown' as const,
    availabilityText: null,
    spotsLeft: null,
  }));
}

const FEATURES: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  [/(\d+)x Łóżko pojedyncze/i, m => `${m[1]} single bed${m[1] === '1' ? '' : 's'}`],
  [/Dodatkowe łóżko rozkładane|rozkładana wersalka/i, () => 'Sofa bed for a third guest'],
  [/Rozkładana sofa podwójna/i, () => 'Double sofa bed in the living area'],
  [/2 pokoje oddzielone przesuwanymi drzwiami/i, () => 'Two rooms separated by a sliding door'],
  [/2 pokoje oddzielone drzwiami/i, () => 'Two rooms separated by a door'],
  [/balkon/i, () => 'Balcony'],
  [/telewizor, czajnik/i, () => 'TV, kettle, cups, fridge'],
  [/Łazienka: prysznic/i, () => 'Bathroom with shower, hair dryer and towels'],
  [/leżaki i parawan|leżaki, parawan/i, () => 'Blanket, beach loungers and windbreak'],
];

export interface RjPages { home: string; rooms: string; kite: string }

export function parseRewitaContent(p: RjPages): OfferContent {
  const rooms = parseRjRooms(p.rooms);
  const h = rjLines(p.home).join('\n');
  const k = rjLines(p.kite).join('\n');
  const beds = h.match(/ponad (\d+) miejsc noclegowych/i)?.[1] ?? null;
  const breakfast = h.match(/śniadania zapraszamy od (\d{1,2}:\d{2}) do (\d{1,2}:\d{2})/i);
  const dinner = h.match(/Między (\d{1,2}:\d{2}) a (\d{1,2}:\d{2}) zapraszamy na obiadokolacje/i);
  const prices = rooms.map(r => r.price).filter((x): x is number => x !== null);
  const aptPrices = rooms.filter(r => /apartment/i.test(r.name)).map(r => r.price).filter((x): x is number => x !== null);
  const kiteSchool = /Szkółka Kite i Windsurfingu/i.test(k);

  const contentRooms: ContentRoom[] = rooms.map(r => ({
    name: r.name,
    description: `${/apartment/i.test(r.name) ? 'Apartment' : 'Room'} in the Delfin building${r.areaM2 ? `, ${r.areaM2} m²` : ''}${r.maxGuests ? `, up to ${r.maxGuests} guests` : ''} ("${r.raw}").`,
    features: [
      ...FEATURES.map(([re, f]) => { const m = r.text.match(re); return m ? f(m) : null; }).filter((x): x is string => !!x),
      ...(r.price ? [`From PLN ${r.price} per room and night`] : []),
    ],
  }));

  const imageUrls: string[] = [];
  const push = (u: string) => { const v = u.replace(/^http:/, 'https:'); if (!imageUrls.includes(v)) imageUrls.push(v); };
  for (const u of imageCandidates(p.home, RJ_HOME_URL, null, 80)) {
    if (/\/(300x300|280x360)\//.test(u) || /konferencj|fokarium|shutterstock|Kawiarnia|logo|\.svg|\.png/i.test(u)) continue;
    push(u);
  }
  for (const u of rooms.flatMap(r => r.images)) push(u);
  // the kite / water sports school photo of the article ("...Zał. 5 Szkoła sportów.jpg")
  const decoded = (u: string) => { try { return decodeURIComponent(u); } catch { return u; } };
  for (const u of imageCandidates(p.kite, RJ_KITE_URL, null, 20)) if (/Szkoła/i.test(decoded(u))) push(u);

  const summary = [
    `Rewita Jurata "Delfin" is a holiday resort of the AMW Rewita group in a pine forest in Jurata on the Hel Peninsula, between Puck Bay and the open Baltic Sea, with ${beds ? `more than ${beds}` : 'over 200'} beds in Superior double rooms and apartments, a restaurant serving a breakfast and dinner buffet, sauna, fitness room, tennis court and bike rental.`,
    kiteSchool ? 'A kite and windsurf school runs on the Rewita grounds in Jurata, with certified instructors teaching children and adults in the shallow lagoon of Puck Bay.' : null,
    prices.length
      ? `Room rates on the site start at PLN ${Math.min(...prices)} per room and night${aptPrices.length ? ` (apartments for up to 4 guests from PLN ${Math.min(...aptPrices)})` : ''}; bookings run through the resort's online booking engine.`
      : null,
  ].filter(Boolean).join(' ');

  return {
    kind: 'accommodation',
    title: 'Rewita Jurata "Delfin"',
    summary,
    continent: 'Europe',
    country: 'Poland',
    region: 'Jurata, Hel Peninsula',
    spot: 'Jurata',
    itinerarySpots: [],
    durationDays: null,
    skillLevels: /zarówno dla początkujących, jak i zaawansowanych/i.test(k) ? ['beginner', 'advanced'] : [],
    kiteLessons: kiteSchool ? true : null,
    equipmentRental: null,
    beginnerFriendly: /początkujących/i.test(k) ? true : null,
    includedServices: [
      ...(/Leżaki i parawany plażowe w każdym pokoju/i.test(h) ? ['Beach loungers and windbreak in every room'] : []),
      ...(/Parking dla Gości/i.test(h) ? ['Guest parking at the resort'] : []),
    ],
    optionalServices: [
      `Breakfast buffet${breakfast ? ` (${breakfast[1]}-${breakfast[2]})` : ''}`,
      `Dinner buffet${dinner ? ` (${dinner[1]}-${dinner[2]})` : ''}`,
      ...(kiteSchool ? ['Kite and windsurf lessons at the school on the Rewita grounds'] : []),
      'Finnish sauna, fitness room, tennis court, outdoor gym, bike rental, billiards',
      'Conference centre (520 m²)',
    ],
    accommodation: 'holiday resort with Superior double rooms and apartments',
    mealPlan: null,
    languages: ['pl'],
    rooms: contentRooms,
    imageUrls: imageUrls.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: RJ_HOME_URL,
    bookingUrl: RJ_ROOMS_URL,
    sourceText: [
      `resort: ${(h.match(/Nadmorski azyl[\s\S]*?Do góry/) ?? [h.slice(0, 6000)])[0]}`,
      `kite school: ${(k.match(/Szkółka Kite i Windsurfingu[\s\S]*?bezpieczeństwo[^\n]*/) ?? [''])[0]}`,
      `rooms: ${rooms.map(r => `${r.raw} | od ${r.price} zł/noc | max ${r.maxGuests} | ${r.text}`).join('\n')}`,
    ].join('\n'),
  };
}

export const rewitaDelfinJurata: OfferAdapter = {
  key: 'rewita-delfin-jurata',
  name: 'Rewita Jurata Delfin',
  kind: 'accommodation',
  operator: {
    name: 'AMW Rewita',
    websiteUrl: SITE,
    rootDomain: 'rewita.pl',
    contactEmail: 'rezerwacje-jurata@rewita.pl',
    phone: '+48 58 675 42 28',
  },
  url: RJ_HOME_URL,
  slotMethod: 'price_table',
  instantBooking: true,
  fetchBudget: 4,
  confidence: 'low',
  async fetchContent() {
    const [home, rooms, kite] = [await get(RJ_HOME_URL), await get(RJ_ROOMS_URL), await get(RJ_KITE_URL)];
    return parseRewitaContent({ home, rooms, kite });
  },
  async fetchSlots() {
    const rooms = parseRjRooms(await get(RJ_ROOMS_URL));
    if (rooms.length === 0) throw new Error('rewita-delfin-jurata: no room cards (a[data-price]) on the rooms page');
    return buildRjSlots(rooms);
  },
};
