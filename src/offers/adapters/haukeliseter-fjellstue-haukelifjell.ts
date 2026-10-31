// ---------------------------------------------------------------------------
// Haukeliseter fjellstue (DNT Stavanger og omegn), Haukelifjell (Vinje, Telemark, southern Norway) - the largest
// staffed DNT mountain lodge, on the E134 at 1,000 m by the lake Ståvatn, a SNOWKITE base (kiting on snow, not
// water): "one of Norway's best places for kiting on snow", with weekend kite courses all winter in cooperation
// with Kiteskolen (beginners and kiters with some experience; advanced and group courses on request). 174 beds
// in 48 rooms, open every day of the year.
//
// Data path (checked 2026-10-28): DNT's EPiServer site, server-rendered (www.haukeliseter.no redirects here):
//   content  /hytter/betjente/haukeliseter/english/ (location, opening hours, restaurant),
//            .../kurs-og-aktiviteter/snokiting2/ (kite courses, Norwegian), .../bestilling2/ (174 beds / 48 rooms,
//            check-in), .../bestilling2/vare-rom/ (room types, Norwegian); the lodge home page and .../om-fjellstua/
//            only for photos (og:image + Haukeliseter photo folders; "related hut" cards of other huts are skipped).
//   slots    .../bestilling2/prisliste/ "Priser på Haukeliseter <year>": rows "label / member price / non-member
//            price" (NOK). We store the NON-member prices (public); the DNT member discount goes into the text.
// Booking: DNT's online hut booking (hyttebestilling.dnt.no/hytte/10660; its robots.txt answers 404) -> instant
//   booking; never read, so availability is 'unknown'. Kite courses: by mail/phone to the lodge.
// Liveness (2026-10-28): price list titled 2026, room page published 2026-01-01, kite page 2026-04-03, equipment
//   page 2026-01-04, English page shows the "fjellmeny vinter 2026_2027" menu.
// robots.txt (2026-10-28): www.dnt.no disallows only /EPiServer/CMS/ and /Util/ for "*".
// Requests per run: content 7, slots 1 (memoised: 0 extra when content ran in the same process).
// Parsed: one season band per price row for the whole price-list year (datePrecision 'season'):
//   mountain room 1 guest (room price incl. breakfast), mountain room 2 guests (= 1 guest + "per extra person";
//   our sum, the list prints the two parts), self-catering room bed and Stabbur/Kuskeloft bed (per person).
// Known limits:
//   - The kite course dates and prices are not on the page (DNT activity calendar, client-rendered; not read).
//   - No kite equipment rental at the lodge (its rental page lists snowshoes, avalanche kits, pulks, skis only).
//   - When the year in the price-list title ends without a new list, the slots expire -> "price on request".
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, parse } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.dnt.no';
const BASE = `${SITE}/hytter/betjente/haukeliseter`;
export const HK_MAIN_URL = `${BASE}/`;
export const HK_ABOUT_URL = `${BASE}/om-fjellstua/`;
export const HK_ENGLISH_URL = `${BASE}/english/`;
export const HK_KITE_URL = `${BASE}/kurs-og-aktiviteter/snokiting2/`;
export const HK_BOOKING_URL = `${BASE}/bestilling2/`;
export const HK_ROOMS_URL = `${BASE}/bestilling2/vare-rom/`;
export const HK_PRICES_URL = `${BASE}/bestilling2/prisliste/`;
const HK_ONLINE_BOOKING = 'https://hyttebestilling.dnt.no/hytte/10660';

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

/** visible text lines of the page body (menus, header, footer, scripts removed) */
export function hkLines(html: string): string[] {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, svg, header, footer, nav')) el.remove();
  const main = root.querySelector('main') ?? root.querySelector('body') ?? root;
  return main.structuredText.split('\n').map(s => collapse(s).replace(/[–—]/g, '-')).filter(Boolean);
}

const NOK_RE = /^(\d{1,3}(?:[  ]\d{3})*|\d+)\s*,-$/;
const nok = (s: string | undefined): number | null => {
  const m = s?.match(NOK_RE);
  return m ? Number(m[1].replace(/[  ]/g, '')) : null;
};

export interface HkPriceRow { label: string; member: number; nonMember: number }
/** price list: a label line followed by the member and the non-member price ("1 515 ,-" / "1 715 ,-") */
export function parseHkPrices(lines: string[]): { year: number | null; rows: HkPriceRow[] } {
  const year = Number(lines.map(l => l.match(/^Priser på Haukeliseter (20\d\d)$/)?.[1]).find(Boolean)) || null;
  const rows: HkPriceRow[] = [];
  for (let i = 0; i + 2 < lines.length; i++) {
    const member = nok(lines[i + 1]);
    const nonMember = nok(lines[i + 2]);
    if (member === null || nonMember === null || nok(lines[i]) !== null) continue;
    rows.push({ label: lines[i], member, nonMember });
    i += 2;
  }
  return { year, rows };
}

interface HkUnit { key: string; label: RegExp; unit: string; room: string; basis: 'room' | 'person'; occupancy: number }
const UNITS: HkUnit[] = [
  { key: 'mountain-room-1', label: /^Fjellrom - pris for én person/i, unit: 'Mountain room, 1 guest (breakfast included)', room: 'Mountain room', basis: 'room', occupancy: 1 },
  { key: 'self-catering-bed', label: /^Selvstellsrom - pris per person/i, unit: 'Self-catering room, bed per person', room: 'Self-catering room', basis: 'person', occupancy: 1 },
  { key: 'stabbur-bed', label: /^Stabbur og kuskeloft - pris per person/i, unit: 'Stabburet / Kuskeloftet, bed per person', room: 'Stabburet and Kuskeloftet', basis: 'person', occupancy: 1 },
];

export function buildHkSlots(lines: string[]): Slot[] {
  const { year, rows } = parseHkPrices(lines);
  if (!year) throw new Error('haukeliseter: price-list year missing ("Priser på Haukeliseter <year>")');
  const band = { startDate: `${year}-01-01`, endDate: `${year}-12-31`, datePrecision: 'season' as const };
  const slot = (key: string, unit: string, room: string, price: number, basis: 'room' | 'person', occupancy: number): Slot => ({
    key: `${key}|${year}`, ...band, unit, room, price, currency: 'NOK', priceUnit: 'per_night', priceBasis: basis,
    occupancy, availability: 'unknown', availabilityText: null, spotsLeft: null,
  });
  const out: Slot[] = [];
  for (const u of UNITS) {
    const r = rows.find(x => u.label.test(x.label));
    if (r) out.push(slot(u.key, u.unit, u.room, r.nonMember, u.basis, u.occupancy));
  }
  const single = rows.find(x => UNITS[0].label.test(x.label));
  const extra = rows.find(x => /^Fjellrom - pris per ekstra person/i.test(x.label));
  if (single && extra) out.push(slot('mountain-room-2', 'Mountain room, 2 guests (breakfast included)', 'Mountain room', single.nonMember + extra.nonMember, 'room', 2));
  return out;
}

/** room types from "Våre rom" (Norwegian headings), written in English */
export function parseHkRooms(lines: string[]): ContentRoom[] {
  const has = (h: string) => lines.includes(h);
  const out: ContentRoom[] = [];
  if (has('Fjellrom')) out.push({ name: 'Mountain room', description: 'Double and family rooms in the main building, the Nansen building and the Seter wing; private bathroom, beds made up, breakfast and cleaning included', features: ['Private bathroom with shower', 'Breakfast included', 'Dogs allowed in some rooms'] });
  if (has('Nansen rom 72')) out.push({ name: 'Nansen room 72', description: 'The best mountain room, in the tower loft with a view over the lake and the Kistenuten massif; two bedrooms and a private bathroom', features: ['Two bedrooms', 'Private bathroom', 'Lake view'] });
  if (has('Selvstellsrom')) out.push({ name: 'Self-catering room', description: 'Bunk-bed rooms with a sink and a mini kitchen in the Seter wing; shared shower and toilet; you rent a bed and may share the room', features: ['Mini kitchen', 'Shared bathroom', 'Bring or rent bed linen'] });
  if (has('Stabburet og Kuskeloftet')) out.push({ name: 'Stabburet and Kuskeloftet', description: 'Original 19th-century buildings with bunk beds and a mini kitchen; shower and toilet in the next building', features: ['Historic building', 'Mini kitchen', 'Bring or rent bed linen'] });
  return out;
}

/** Haukeliseter's own photo folders (DNT pages also show other huts in "related" cards) */
const HK_PHOTO_RE = /haukeliseter|dji_00|holmavatn|298e69211b98491887fb5be08d05b09f/i;
/** the lodge's own photos: og:image of each fetched page first, then every Haukeliseter photo path, at 2000 px */
export function hkImages(htmls: string[]): string[] {
  const out = new Set<string>();
  const add = (path: string) => {
    if (!/\.jpe?g$/i.test(path) || !HK_PHOTO_RE.test(path)) return;
    out.add(`${SITE}/${path.replace(/^\/+/, '')}?width=2000`);
  };
  for (const html of htmls) {
    for (const m of html.matchAll(/property="og:image" content="https:\/\/www\.dnt\.no\/([^"?#]+)/g)) add(m[1]);
  }
  for (const html of htmls) {
    for (const m of html.matchAll(/\/((?:contentassets|globalassets)\/[^"?#&\s]+?\.jpe?g)/gi)) add(m[1]);
  }
  return [...out];
}

export interface HkPages { english: string; kite: string; booking: string; rooms: string; prices: string; main: string; about: string }

export function parseHaukeliseterContent(p: HkPages): OfferContent {
  const en = hkLines(p.english).join('\n');
  const kite = hkLines(p.kite).join('\n');
  const booking = hkLines(p.booking).join('\n');
  const prices = hkLines(p.prices);
  if (!/et av Norges beste steder for kiting på snø/i.test(kite)) throw new Error('haukeliseter: snowkite claim missing on snokiting2 (layout changed?)');
  const school = /I samarbeid med Kiteskolen/i.test(kite) ? 'Kiteskolen' : null;
  const beds = booking.match(/(\d+) sengeplasser fordelt på (\d+) rom/);
  const alwaysOpen = /always open - every day, all year round/i.test(en);
  const { rows } = parseHkPrices(prices);
  const row = (re: RegExp) => rows.find(r => re.test(r.label));
  const breakfast = row(/^Frokost$/);
  const dinner = row(/^Treretters middag$/);
  const lunch = row(/^Niste/);
  const single = row(/^Fjellrom - pris for én person/);
  const memberOff = single ? single.nonMember - single.member : null;

  const summary = [
    `Haukeliseter fjellstue is the largest staffed lodge of the Norwegian Trekking Association (DNT), on the E134 at Haukelifjell in southern Norway, 1,000 m up by the lake Ståvatn, ${alwaysOpen ? 'open every day of the year' : 'open all year'}.`,
    `It is known as one of Norway's best places for snowkiting: the frozen lake right outside offers wide flat areas and often good wind${school ? `, and the lodge runs weekend kite courses all winter with ${school} for beginners and kiters with some experience (advanced and group courses on request)` : ''}.`,
    `${beds ? `${beds[1]} beds in ${beds[2]} rooms` : 'Rooms'} range from mountain rooms with private bathroom and breakfast to self-catering rooms and historic bunk-bed buildings; the restaurant serves traditional Norwegian food${memberOff ? `, and DNT members pay NOK ${memberOff} less per night` : ''}.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Haukeliseter fjellstue (snowkite lodge, Haukelifjell)',
    summary,
    continent: 'Europe',
    country: 'Norway',
    region: 'Haukelifjell',
    spot: 'Haukeliseter, Haukelifjell',
    spotCoords: { lat: 59.8239, lng: 7.1941 }, // OSM "Haukeliseter fjellstue" (way 117122360)
    spotCoordsPrecise: true,
    itinerarySpots: [],
    durationDays: null,
    skillLevels: ['beginner', 'intermediate'],
    kiteLessons: school !== null,
    equipmentRental: null,
    beginnerFriendly: true,
    includedServices: [
      'Breakfast and cleaning in the mountain rooms',
      'Wilderness spa (outdoor tub and wood-fired sauna) free for overnight guests on Saturdays from 16:00',
      'Sledges and "stumpeski" to borrow',
    ],
    optionalServices: [
      ...(school ? [`Weekend snowkite course with ${school} (dates and price on request)`] : []),
      'Advanced, private and group snowkite courses on request',
      ...(breakfast ? [`Breakfast NOK ${breakfast.nonMember} (DNT members NOK ${breakfast.member})`] : []),
      ...(lunch ? [`Packed lunch and thermos NOK ${lunch.nonMember}`] : []),
      ...(dinner ? [`Three-course dinner NOK ${dinner.nonMember}, Fridays and Saturdays, pre-order`] : []),
      'Snowshoe, avalanche kit, pulk and mountain ski rental',
      'Dog sledding with Haukeli Husky',
      'DNT member discount on rooms and meals',
    ],
    accommodation: 'mountain lodge with private rooms, self-catering rooms and bunk-bed buildings',
    mealPlan: 'breakfast',
    languages: ['no', 'en'],
    rooms: parseHkRooms(hkLines(p.rooms)),
    imageUrls: hkImages([p.kite, p.main, p.english, p.about, p.booking, p.rooms, p.prices]).slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: HK_KITE_URL,
    bookingUrl: HK_ONLINE_BOOKING,
    sourceText: [en, kite, booking, prices.join('\n')].join('\n\n'),
  };
}

export const haukeliseterFjellstueHaukelifjell: OfferAdapter = {
  key: 'haukeliseter-fjellstue-haukelifjell',
  name: 'Haukeliseter fjellstue (snowkite lodge, Haukelifjell)',
  kind: 'accommodation',
  disciplines: ['snowkite'],
  operator: {
    name: 'Haukeliseter fjellstue (DNT Stavanger og omegn)',
    websiteUrl: `${BASE}/`,
    rootDomain: 'haukeliseter.no',
    contactEmail: 'haukeliseter@dnt.no',
    phone: '+4735062777',
  },
  url: HK_KITE_URL,
  slotMethod: 'price_table',
  instantBooking: true,
  fetchBudget: 8,
  async fetchContent() {
    const [english, kite, booking, rooms, prices, main, about] = [
      await page(HK_ENGLISH_URL), await page(HK_KITE_URL), await page(HK_BOOKING_URL), await page(HK_ROOMS_URL),
      await page(HK_PRICES_URL), await page(HK_MAIN_URL), await page(HK_ABOUT_URL),
    ];
    return parseHaukeliseterContent({ english, kite, booking, rooms, prices, main, about });
  },
  async fetchSlots(): Promise<Slot[]> {
    const slots = buildHkSlots(hkLines(await page(HK_PRICES_URL)));
    if (slots.length < 4) throw new Error(`haukeliseter: only ${slots.length} of 4 price rows found on the price list (layout changed?)`);
    return slots;
  },
};
