// ---------------------------------------------------------------------------
// Bretterbude Heiligenhafen (Baltic coast, Schleswig-Holstein, Germany) - surfer hotel of the Heimathafen Hotels on the
// Seebrückenpromenade; the official kite beach of Heiligenhafen is right in front of the house, and the hotel's own
// "Plankenverleih" rents kite gear and SUPs and gives beginner and private kite lessons from containers at the spot.
//
// Data path (checked 2026-10-14), German pages of www.bretterbude-hhf.de (own CMS; the English pages are machine
// translated - "Butzen" becomes "slugs"):
//   content  / (intro: "Zum Abhängen nach dem Kiten"), /butzen-zimmer (room cards: <a title> + <h3>, teaser text, fact
//            list, teaser photo), /heiligenhafen/sport/kitesurfen ("Der offizielle Kitestrand liegt direkt vor der
//            Bretterbude"), /hotel-und-wir/plankenverleih (kite rental + "Einstiegskurse sowie Privatstunden"),
//            /hotel-und-wir/preisliste (extras: breakfast, extra bed, parking, dog, room cleaning).
//   slots    /hotel-und-wir/knueller-angebote/winterschnapper - the only room price the site prints: "ausgewählte Butzen
//            ab 55 € pro Nacht", "Reisezeitraum 01.11.2026 bis 18.03.2027", bookable up to 7 days before arrival, subject
//            to availability, holidays excluded, minimum stay on single days possible.
// Booking engine: OnePageBooking (HotelNetSolutions, onepagebooking.com/bretterbude). Its API (v5.onepagebooking.com/api)
//   first needs a session token that the Angular app requests with an AES-encrypted timestamp (client key in the
//   bundle) and then sends as a Bearer token - a token built in the browser, so we do not use it (no live prices).
// robots.txt (2026-10-14): www.bretterbude-hhf.de "Allow: /"; onepagebooking.com/robots.txt is 404.
// Requests per run: content 6, slots 1 (the Schnapper page is memoised, so a full run makes 6).
// Parsed: 1 slot = the Schnapper winter rate with its real travel period ("schnapper|2026-11-01"), EUR per night for a
//   room ("Butzen ab 55 € pro Nacht": per room is inferred from that wording), availability 'unknown'; the slot is
//   dropped once the travel period has ended (then the offer shows "price on request").
// Known limits: "Schnapper 2.0" (same period, with breakfast and dinner, also "ab 55 €" but without a printed basis) is
//   not used. No regular room rates are printed outside the booking engine. The "Bulliparkplatz" (van pitches) are not
//   listed (campsite rule). Map pin = the marker of the map on /hotel-und-wir/anfahrt (constant below).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, iso, parseAmount, todayIso } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.bretterbude-hhf.de';
export const BBH_HOME_URL = `${SITE}/`;
export const BBH_ROOMS_URL = `${SITE}/butzen-zimmer`;
export const BBH_KITE_URL = `${SITE}/heiligenhafen/sport/kitesurfen`;
export const BBH_RENTAL_URL = `${SITE}/hotel-und-wir/plankenverleih`;
export const BBH_PRICES_URL = `${SITE}/hotel-und-wir/preisliste`;
export const BBH_OFFER_URL = `${SITE}/hotel-und-wir/knueller-angebote/winterschnapper`;
const BOOKING_URL = 'https://onepagebooking.com/bretterbude?id=bretterbude&module=public&lang=de';
/** Map marker on /hotel-und-wir/anfahrt ("lat: pi.Num.float('54.3798742'), lng: pi.Num.float('10.9795991')", 2026-10-14). */
export const BBH_COORDS = { lat: 54.3798742, lng: 10.9795991 };

const memo = new Map<string, { at: number; p: Promise<string> }>();
/** one fetch per page per 10 minutes: fetchContent + fetchSlots in the same run share the Schnapper page */
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

/** Visible text lines (scripts, styles, SVGs dropped), split at block tags. */
export function bbhLines(html: string): string[] {
  return html
    .replace(/<(script|style|noscript|svg|head)\b[\s\S]*?<\/\1>/gi, ' ')
    .split(/<\/?(?:p|li|td|th|tr|h\d|div|br|ul|section|figure|header|footer|article|span)\b[^>]*>/i)
    .map(s => clean(s.replace(/<[^>]+>/g, ' ')))
    .filter(Boolean);
}

/** Large version of a CMS media URL: /media/w-{width}/bb/<crop>/<file>.jpg -> /media/w-1920/bb/xl/<file>.jpg (uncropped). */
export function bbhLarge(u: string): string | null {
  const m = u.match(/\/media\/w-(?:\{width\}|\d+)\/bb\/[^/]+\/([^/"?#\s]+?)\.(jpe?g|png|webp)/i);
  return m ? `${SITE}/media/w-1920/bb/xl/${m[1]}.jpg` : null;
}

export function bbhImages(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/https:\/\/www\.bretterbude-hhf\.de\/media\/w-(?:\{width\}|\d+)\/bb\/[^"'\s,]+/g)) {
    const u = bbhLarge(m[0]);
    if (!u || /logo|icon|award|10-jahre|pexels|variety-desserts|people-enjoying|teenager-having/i.test(u)) continue;
    if (!out.includes(u)) out.push(u);
  }
  return out;
}

export interface BbhRoom { name: string; group: string; facts: string[]; image: string | null; url: string }

const GROUPS: Record<string, string> = {
  'kleine-butzen': 'Small room',
  etagenbutzen: 'Two-level room (bed on a gallery)',
  'grosse-butzen': 'Large room',
  spezialbutzen: 'Special themed room',
  'xl-butzen': 'Apartment with own kitchen',
};

/** Room cards of /butzen-zimmer; the van pitches ("Bulliparkplatz") are left out. */
export function parseBbhRooms(html: string): BbhRoom[] {
  const out: BbhRoom[] = [];
  for (const card of html.split('class="teaser__item--container').slice(1)) {
    const url = card.match(/<a href="([^"]+)"/)?.[1] ?? '';
    const h3 = card.match(/<h3[^>]*>([\s\S]*?)<\/h3>/)?.[1];
    if (!h3 || !url.includes('/butzen-zimmer/')) continue;
    const name = clean(h3.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' '));
    if (/bulliparkplatz/i.test(name)) continue;
    const list = card.match(/<ul class="facts[\s\S]*?<\/ul>/)?.[0] ?? '';
    const facts = [...list.matchAll(/<li>([\s\S]*?)<\/li>/g)].map(m => clean(m[1].replace(/<[^>]+>/g, ' '))).filter(Boolean);
    const img = card.match(/https:\/\/www\.bretterbude-hhf\.de\/media\/w-(?:\{width\}|\d+)\/bb\/[^"'\s,]+/)?.[0];
    const seg = url.match(/\/butzen-zimmer\/([^/#]+)/)?.[1] ?? '';
    const group = /bauwagen/.test(seg) ? 'Construction trailer for 2 (outdoor stay)' : GROUPS[seg] ?? 'Room';
    if (!out.some(r => r.name === name)) out.push({ name, group, facts, image: img ? bbhLarge(img) : null, url });
  }
  return out;
}

export interface BbhOffer { price: number; start: string; end: string; text: string; terms: string | null }

/** Schnapper page: "ab 55 € pro Nacht" + "Reisezeitraum (läuft) vom DD.MM.YYYY bis (einschließlich) DD.MM.YYYY". */
export function parseBbhOffer(html: string): BbhOffer | null {
  const text = bbhLines(html).join('\n');
  const price = text.match(/Butzen ab (\d+(?:,\d+)?)\s*€ pro Nacht/) ?? text.match(/ab (\d+(?:,\d+)?)\s*€ pro Nacht/);
  const period = text.match(/Reisezeitraum[^\n]*?(\d{1,2})\.(\d{1,2})\.(20\d{2}) bis (?:einschließlich )?(\d{1,2})\.(\d{1,2})\.(20\d{2})/);
  if (!price || !period) return null;
  const terms = text.match(/Buchbar ist der SCHNAPPER[^\n]*/)?.[0] ?? null;
  return {
    price: Number(price[1].replace(',', '.')),
    start: iso(+period[3], +period[2], +period[1]),
    end: iso(+period[6], +period[5], +period[4]),
    text: `${price[0]} | ${period[0]}`,
    terms,
  };
}

export function buildBbhSlots(o: BbhOffer, today: string): Slot[] {
  if (o.end < today) return [];
  return [{
    key: `schnapper|${o.start}`,
    startDate: o.start,
    endDate: o.end,
    unit: 'Selected rooms (Schnapper winter rate)',
    price: o.price,
    currency: 'EUR',
    priceUnit: 'per_night',
    priceBasis: 'room',
    occupancy: null,
    availability: 'unknown',
    availabilityText: 'nur nach Verfügbarkeit, buchbar bis 7 Tage vor Anreise, Feiertage ausgeschlossen',
    spotsLeft: null,
  }];
}

/** Price list extras ("Frühstück für Hotelgäste … 21,90 € pro Person und Tag"). */
export function parseBbhExtras(html: string): string[] {
  const l = bbhLines(html);
  const after = (label: RegExp) => {
    const i = l.findIndex(x => label.test(x));
    if (i < 0) return null;
    const a = parseAmount(l.slice(i + 1, i + 6).find(x => /€/.test(x) && !/^- /.test(x)) ?? '');
    return a ? `EUR ${a.toFixed(2)}` : null;
  };
  const out: string[] = [];
  const breakfast = after(/^Frühstück für Hotelgäste$/);
  if (breakfast) out.push(`Breakfast for hotel guests: ${breakfast} per person and day`);
  const extraBed = after(/^Zustellbett/);
  if (extraBed) out.push(`Extra bed: ${extraBed} per day`);
  const parking = after(/^Parkplatz/);
  if (parking) out.push(`Parking: ${parking} per day`);
  const dog = after(/^Hund$/);
  if (dog) out.push(`Dog: ${dog} per night`);
  return out;
}

export interface BbhPages { home: string; rooms: string; kite: string; rental: string; prices: string; offer: string }

export function parseBretterbudeContent(p: BbhPages): OfferContent {
  const home = bbhLines(p.home);
  const kite = bbhLines(p.kite);
  const rental = bbhLines(p.rental);
  const rooms = parseBbhRooms(p.rooms);
  const extras = parseBbhExtras(p.prices);
  const offer = parseBbhOffer(p.offer);
  const kiteBeach = kite.find(l => /offizielle Kitestrand liegt direkt vor der Bretterbude/.test(l)) ?? null;
  const rentalIntro = rental.find(l => /Plankenverleih/.test(l) && /Kite-Material/.test(l)) ?? null;
  const lessons = rental.find(l => /Einstiegskurse sowie Privatstunden/.test(l)) ?? null;
  const licence = rental.find(l => /Vorausgesetzt für den Verleih von Kites/.test(l)) ?? null;
  const intro = home.find(l => /nach dem Kiten/.test(l)) ?? null;
  const fmt = (d: string) => `${Number(d.slice(8, 10))}.${Number(d.slice(5, 7))}.${d.slice(0, 4)}`;

  const contentRooms: ContentRoom[] = rooms.map(r => ({ name: r.name, description: r.group, features: r.facts }));
  const imgs: string[] = [];
  for (const u of [...bbhImages(p.kite), ...bbhImages(p.rental), ...rooms.map(r => r.image), ...bbhImages(p.home)]) {
    if (u && !imgs.includes(u)) imgs.push(u);
  }

  const summary = [
    'Bretterbude Heiligenhafen is a casual surfer hotel on the Seebrückenpromenade of Heiligenhafen on the Baltic coast of Schleswig-Holstein, Germany; the official kite beach of the town is right in front of the house.',
    `It has about ${rooms.length || 15} room types, from small sea-view rooms and two-level rooms to themed special rooms, apartments with their own kitchen and a construction trailer for two; breakfast, sauna, restaurants and bars are in the house.`,
    'The hotel\'s own rental on the spot hires out kite gear and SUPs and gives beginner and private kite lessons (renting a kite needs a VDWS level 3 or IKO level 2i licence).',
    offer ? `The site prints one room price: the Schnapper winter rate, selected rooms from EUR ${offer.price} per night for stays from ${fmt(offer.start)} to ${fmt(offer.end)}.` : '',
  ].filter(Boolean).join(' ');

  return {
    kind: 'accommodation',
    title: 'Bretterbude Heiligenhafen',
    summary,
    continent: 'Europe',
    country: 'Germany',
    region: 'Heiligenhafen, Baltic Coast',
    spot: 'Heiligenhafen',
    spotCoords: BBH_COORDS,
    itinerarySpots: [],
    durationDays: null,
    // plankenverleih: "Einstiegskurse sowie Privatstunden", "ein relativ großer Stehbereich hilft Aufsteiger:innen"
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: lessons ? true : null,
    equipmentRental: rentalIntro ? true : null,
    beginnerFriendly: true,
    includedServices: ['Sauna (Schwitzkammer)', 'Final cleaning'],
    optionalServices: [
      ...extras,
      'Room cleaning during the stay (EUR 15 or 30 per cleaning, book ahead)',
      'Kite and SUP rental and kite lessons at the Plankenverleih',
      'Massages',
    ],
    accommodation: 'surfer hotel rooms and apartments at the kite beach',
    mealPlan: 'breakfast optional',
    languages: ['de', 'en', 'da'],
    rooms: contentRooms,
    imageUrls: imgs.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: BBH_KITE_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      `home: ${intro ?? ''}`,
      `kite beach: ${kiteBeach ?? ''}`,
      `rental: ${rentalIntro ?? ''} | ${lessons ?? ''} | ${licence ?? ''}`,
      `rooms: ${rooms.map(r => `${r.name} (${r.facts.join(', ')})`).join('; ')}`,
      `extras: ${extras.join('; ')}`,
      `offer: ${offer ? `${offer.text}${offer.terms ? ` | ${offer.terms}` : ''}` : 'not found'}`,
    ].join('\n'),
  };
}

export async function fetchBbhSlots(today: string): Promise<Slot[]> {
  const offer = parseBbhOffer(await page(BBH_OFFER_URL));
  if (!offer) throw new Error('bretterbude-heiligenhafen: "ab … € pro Nacht" / "Reisezeitraum … bis …" not found on the Schnapper page');
  return buildBbhSlots(offer, today);
}

export const bretterbudeHeiligenhafen: OfferAdapter = {
  key: 'bretterbude-heiligenhafen',
  name: 'Bretterbude Heiligenhafen',
  kind: 'accommodation',
  operator: {
    name: 'Bretterbude Heiligenhafen',
    websiteUrl: SITE,
    rootDomain: 'bretterbude-hhf.de',
    contactEmail: 'heiligenhafen@bretterbude.de',
    phone: '+49436250040',
  },
  url: BBH_KITE_URL,
  slotMethod: 'price_table',
  instantBooking: true,
  fetchBudget: 6,
  async fetchContent() {
    const home = await page(BBH_HOME_URL);
    const rooms = await page(BBH_ROOMS_URL);
    const kite = await page(BBH_KITE_URL);
    const rental = await page(BBH_RENTAL_URL);
    const prices = await page(BBH_PRICES_URL);
    const offer = await page(BBH_OFFER_URL);
    if (!/Kitestrand/.test(kite)) throw new Error('bretterbude-heiligenhafen: kite beach sentence missing on the kitesurfing page (kite link gone?)');
    if (parseBbhRooms(rooms).length === 0) throw new Error('bretterbude-heiligenhafen: no room cards on /butzen-zimmer (layout changed?)');
    return parseBretterbudeContent({ home, rooms, kite, rental, prices, offer });
  },
  async fetchSlots() {
    return fetchBbhSlots(todayIso());
  },
};
