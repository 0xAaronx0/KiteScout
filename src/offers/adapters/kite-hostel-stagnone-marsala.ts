// ---------------------------------------------------------------------------
// Kite Hostel Stagnone, Contrada San Leonardo (Marsala, Lo Stagnone, Sicily, Italy) - kite house style hostel "created
// and managed by kiters for kiters": mixed dorm, female dorm and two private rooms, 10-20 min by bike from the kite
// schools on the Stagnone lagoon (it recommends schools, it does not teach or rent itself).
//
// Identity: research list #16 "The Kite Hostel Sicily" pointed at followthewind.eu/kitehostel/ (a 2017 page of the
//   Follow the Wind school: "our little Kite Hostel ... 2 rooms"). Follow the Wind's accommodation article (sitemap
//   lastmod 2026-02-12) now lists "Kite Hostel Stagnone" (hosts Carol and Matteo) with a link to kitehostelstagnone.
//   com, and that site lists Follow the Wind among its friend schools. Same hostel inferred (both started winter 2016/
//   17; kitehostelstagnone.com datePublished 2016-12-26), not confirmed. This adapter also covers list #42 "Kite
//   Hostel Stagnone" (skipped earlier as "no own website": it has one).
// Liveness (re-check 2026-10-12): home dateModified 2026-03-11, /rooms/ 2026-04-08, room pages 2026-04-11, FAQ pages
//   2026-07-23 (WordPress REST `modified`), page sitemap lastmod 2026-07-23, media uploads 2025-08-25; its Octorate
//   engine (codice 390941) is licensed and serves a calendar to 2028-09. Verdict LIVE.
// Data path (checked 2026-10-12): WordPress (WPBakery + trx_addons, WPML en/it/de/fr) at www.kitehostelstagnone.com:
//   content  / (intro, facilities, address), the 4 room pages (/mix-dorm/, /girls-dorm/, /private-double-room-pixel/,
//            /private-single-room-agrumi/: text + "What we offer" list), 3 FAQ pages (rooms & stay, kitesurf &
//            kiteschool, extra costs) and the public media listing /wp-json/wp/v2/media (the room galleries are a
//            JS-loaded grid, so the photos come from the hostel's own media library).
//   slots    /rooms/ price cards (trx_addons sc_price: title + "Per night from" + value), EUR per night: dorms per bed
//            (priceBasis person), private rooms per room. Undated "from" prices -> one slot per unit, no dates,
//            availability 'unknown'. GATE: used while /rooms/ was edited within the last 15 months (JSON-LD
//            dateModified 2026-04-08 on 2026-10-12 -> used); otherwise [] ("price on request").
//   Not used: the Octorate engine (book.octorate.com/octobook/site/reservation/index.xhtml?codice=390941) is a JSF app
//   bound to a session id; its public calendar script (api.octorate.com/connect/rest/v1/reservation/calendar/390941)
//   carries only 0/1 day flags without prices and with unverified meaning.
// robots.txt (2026-10-12): Yoast default, "Disallow:" (nothing).
// Requests per run: content 10 (incl. /rooms/ for the price sentence), slots 1.
// Known limits: prices are "from" prices (season and occupancy not stated); tourist tax EUR 2 per person per night
//   (up to 7 nights) comes on top (room features only); the map embed is an address query, no coordinates.
// ---------------------------------------------------------------------------
import { fetchJson, fetchText } from '../http.js';
import { collapse, ldOfType, parse, parseAmount, todayIso } from '../parse.js';
import type { ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot, SlotPriceBasis } from '../types.js';

const SITE = 'https://www.kitehostelstagnone.com';
export const KHS_HOME_URL = `${SITE}/`;
export const KHS_ROOMS_URL = `${SITE}/rooms/`;
export const KHS_ROOM_URLS = ['mix-dorm', 'girls-dorm', 'private-double-room-pixel', 'private-single-room-agrumi'].map(s => `${SITE}/${s}/`);
export const KHS_FAQ_URLS = ['faq-rooms-stay', 'faq-kitesurf-kiteschool', 'faq-extra-costs'].map(s => `${SITE}/${s}/`);
export const KHS_MEDIA_URL = `${SITE}/wp-json/wp/v2/media?per_page=100&_fields=source_url,date`;
const BOOKING_URL = 'https://book.octorate.com/octobook/site/reservation/index.xhtml?codice=390941';
const FRESH_MONTHS = 15;

export interface KhsPrice { title: string; amount: number; link: string | null }
export interface KhsRoomPage { name: string; text: string[]; offers: string[]; from: number | null }
export interface KhsMedia { source_url: string; date: string }

const keyPart = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// --- pure parsers -----------------------------------------------------------------------------
/** /rooms/ price cards: .sc_price_title + .sc_price_value ("€33"). */
export function parseKhsPrices(html: string): KhsPrice[] {
  return parse(html).querySelectorAll('.sc_price').map(el => ({
    title: collapse(el.querySelector('.sc_price_title')?.text ?? ''),
    amount: parseAmount(el.querySelector('.sc_price_value')?.text ?? '') ?? 0,
    link: el.querySelector('.sc_price_title a')?.getAttribute('href') ?? null,
  })).filter(p => p.title && p.amount > 0);
}

/** Yoast JSON-LD WebPage dateModified (YYYY-MM-DD) or null. */
export function khsModified(html: string): string | null {
  const page = ldOfType(html, 'WebPage')[0];
  const d = typeof page?.dateModified === 'string' ? page.dateModified : null;
  return d ? d.slice(0, 10) : null;
}

export function khsFresh(modified: string | null, today: string): boolean {
  if (!modified) return false;
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - FRESH_MONTHS);
  return modified >= d.toISOString().slice(0, 10);
}

/** Unit label, price basis and persons per card (dorm = per bed; Pixel = double bed; Agrumi = "for 1 person"). */
export function khsUnit(title: string): { unit: string; basis: SlotPriceBasis; occupancy: number | null } {
  if (/female|girls/i.test(title)) return { unit: 'Female dorm (bed)', basis: 'person', occupancy: 1 };
  if (/dorm/i.test(title)) return { unit: 'Mixed dorm (bed)', basis: 'person', occupancy: 1 };
  if (/pixel/i.test(title)) return { unit: 'Private double room (Pixel)', basis: 'room', occupancy: 2 };
  if (/agrumi/i.test(title)) return { unit: 'Private single room (Agrumi)', basis: 'room', occupancy: 1 };
  return { unit: title, basis: 'room', occupancy: null };
}

export function buildKhsSlots(roomsHtml: string, today: string): Slot[] {
  if (!khsFresh(khsModified(roomsHtml), today)) return [];
  return parseKhsPrices(roomsHtml).map(p => {
    const u = khsUnit(p.title);
    return {
      key: keyPart(u.unit),
      startDate: null,
      endDate: null,
      unit: u.unit,
      price: p.amount,
      currency: 'EUR',
      priceUnit: 'per_night' as const,
      priceBasis: u.basis,
      occupancy: u.occupancy,
      availability: 'unknown' as const,
      availabilityText: null,
      spotsLeft: null,
    };
  });
}

/** Room page: <h1> (+ <h4> name), the text <p>s, the "What we offer" list, "from €N,-". */
export function parseKhsRoomPage(html: string): KhsRoomPage {
  const root = parse(html);
  const main = root.querySelector('.post_content') ?? root;
  const h1 = collapse(main.querySelector('h1')?.text ?? '');
  const h4 = collapse(main.querySelector('h4')?.text ?? '');
  const ps = main.querySelectorAll('p').map(p => collapse(p.text)).filter(t => t.length > 30);
  const offers = main.querySelectorAll('ul li').map(li => collapse(li.text)).filter(Boolean);
  const from = parseAmount(main.querySelectorAll('h2').map(h => collapse(h.text)).find(t => /^from €\s?\d+/i.test(t)) ?? '') ?? null;
  return { name: h4 ? `${h1} (${h4})` : h1, text: ps, offers, from };
}

/** FAQ toggles: question (<h4>) -> answer text. */
export function parseKhsFaq(html: string): Array<{ q: string; a: string }> {
  return parse(html).querySelectorAll('.vc_toggle').map(t => ({
    q: collapse(t.querySelector('.vc_toggle_title')?.text ?? ''),
    a: collapse(t.querySelector('.vc_toggle_content')?.text ?? ''),
  })).filter(x => x.q && x.a);
}

/** Hostel photos from the media library, rooms first; logos, profiles, review cards, -w380 thumbs and sightseeing out. */
export function khsImages(media: KhsMedia[]): string[] {
  const urls = media.map(m => m.source_url).filter(u => /\.(jpe?g)$/i.test(u) && !/-w380\.|-\d+x\d+\./i.test(u));
  const groups: RegExp[] = [
    /\/Mixed_Dorm[^/]*$/i, /\/Girls_Dorm[^/]*$/i, /\/Pixel[^/]*$/i, /\/(Agrumi|Bathroom_Agrumi)[^/]*$/i,
    /\/(Livingroom|Kitchen|garden)[^/]*$/i,
    /\/(hostel-|yoga-kite-hostel)[^/]*$/i,
    /\/2025\/08\/\d{8}_\d{6}[^/]*$/,
    /\/(Kitesurf-stagnone-\d+|lagoon-lostagnone|stognone-lagoon)[^/]*$/i,
  ];
  const out: string[] = [];
  for (const g of groups) for (const u of urls.filter(x => g.test(x)).sort()) if (!out.includes(u)) out.push(u);
  return out;
}

export interface KhsPages { home: string; rooms: string[]; faqs: string[]; media: KhsMedia[]; roomsPage?: string | null }

export function parseKiteHostelContent(p: KhsPages, today = todayIso()): OfferContent {
  const homeRoot = parse(p.home);
  const intro = homeRoot.querySelectorAll('p').map(x => collapse(x.text)).find(t => /^Kite Hostel is the first and only kite house/i.test(t)) ?? null;
  const address = collapse(homeRoot.querySelector('.sc_form_info_item_address .sc_form_info_data')?.text ?? '') || null;
  const facilities = [...new Set(homeRoot.querySelectorAll('h4.sc_services_item_title').map(x => collapse(x.text)).filter(Boolean))];
  const rooms = p.rooms.map(parseKhsRoomPage);
  const faq = p.faqs.flatMap(parseKhsFaq);
  const answer = (re: RegExp) => faq.find(x => re.test(x.q))?.a ?? null;
  const distance = answer(/How far is the kitesurfing spot/i);
  const noLessons = answer(/Do you take kitesurfing lessons/i);
  const storage = answer(/store my kite equipment/i);
  const rinse = answer(/rinse wetsuits/i);
  const tax = answer(/tourist tax/i);
  const bikes = answer(/rent bikes/i);
  const activities = answer(/What other activities/i);
  const dinners = answer(/events or evening dinners/i);
  const breakfast = answer(/Is breakfast included/i);
  const prices = p.roomsPage ? buildKhsSlots(p.roomsPage, today) : [];
  const bedFrom = prices.filter(s => s.priceBasis === 'person').map(s => s.price!).sort((a, b) => a - b)[0] ?? null;
  const roomFrom = prices.filter(s => s.priceBasis === 'room').map(s => s.price!).sort((a, b) => a - b)[0] ?? null;

  const contentRooms: ContentRoom[] = rooms.map(r => ({
    name: r.name,
    description: r.text.filter(t => !/€/.test(t)).join(' ') || null,
    features: [...r.offers, ...(tax ? ['Tourist tax EUR 2 per person per night (up to 7 nights) on top'] : [])],
  }));

  const summary = [
    `Kite Hostel Stagnone is a kite house style hostel in Contrada San Leonardo near Marsala, Sicily, run by kiters for kiters, ${distance?.match(/(\d+\/\d+ min by bike)/)?.[1]?.replace('/', '-') ?? '10-20 min by bike'} from the kite schools on the Lo Stagnone lagoon.`,
    `It has a mixed dorm and a female dorm with curtained beds, lockers and two bathrooms each, and two private rooms (Pixel with a double bed, Agrumi for one guest), all air-conditioned, plus a shared kitchen, living room, veranda and garden, a gear storage room and outdoor showers for rinsing wetsuits.`,
    `The hostel does not teach or rent kite gear itself but recommends partner schools by language and level; it offers yoga, bike rental, shared pasta, pizza and BBQ dinners and boat or climbing trips on windless days.`,
    bedFrom || roomFrom
      ? `Prices start from EUR ${bedFrom ?? roomFrom} per bed${roomFrom ? ` and EUR ${roomFrom} per private room` : ''} per night, breakfast not included, tourist tax extra.`
      : 'The site shows no current prices, so stays are priced on request.',
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Kite Hostel Stagnone',
    summary,
    continent: 'Europe',
    country: 'Italy',
    region: 'Lo Stagnone, Sicily',
    spot: 'Lo Stagnone',
    itinerarySpots: [],
    durationDays: null,
    // /kitesurfing-marsala/: "From beginner to pro" - the lagoon suits every level; the hostel itself does not teach
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: noLessons && /^No\b/i.test(noLessons) ? false : null,
    equipmentRental: noLessons && /^No\b/i.test(noLessons) ? false : null,
    beginnerFriendly: true,
    includedServices: [...facilities, ...(storage ? ['Kite equipment storage room'] : []), ...(rinse ? ['Outdoor rinse area for wetsuits and harnesses'] : [])],
    optionalServices: [
      'Advice and contact to partner kite schools (lessons, rental) in your language',
      ...(bikes ? [`Bike rental (${bikes.match(/(\d+€ per day)/)?.[1] ?? 'per day'}, guests only)`] : []),
      ...(activities ? ['Yoga classes, climbing trips and boat trips to Favignana on windless days'] : []),
      ...(dinners ? ['Shared pasta, pizza and BBQ dinners'] : []),
      'Towel set (EUR 5, dorms)',
    ],
    accommodation: 'hostel with mixed and female dorms and two private rooms',
    mealPlan: breakfast && /^No/i.test(breakfast) ? 'self_catering' : null,
    languages: ['en', 'it', 'de', 'fr'],
    rooms: contentRooms,
    imageUrls: khsImages(p.media).slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: KHS_HOME_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      `home: ${intro ?? ''}`,
      `address: ${address ?? ''}`,
      `facilities: ${facilities.join('; ')}`,
      ...rooms.map(r => `room ${r.name}: from ${r.from ?? '-'} EUR | ${r.text.join(' ')} | ${r.offers.join('; ')}`),
      ...faq.map(x => `faq: ${x.q} -> ${x.a}`),
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const kiteHostelStagnoneMarsala: OfferAdapter = {
  key: 'kite-hostel-stagnone-marsala',
  name: 'Kite Hostel Stagnone Marsala',
  kind: 'accommodation',
  operator: {
    name: 'Kite Hostel Stagnone',
    websiteUrl: SITE,
    rootDomain: 'kitehostelstagnone.com',
    contactEmail: 'info@kitehostelstagnone.com',
    phone: '+393402450520',
  },
  url: KHS_HOME_URL,
  slotMethod: 'price_table',
  instantBooking: true,
  fetchBudget: 11,
  confidence: 'medium',
  async fetchContent() {
    const home = await fetchText(KHS_HOME_URL, { accept: 'text/html' });
    const rooms: string[] = [];
    for (const u of KHS_ROOM_URLS) rooms.push(await fetchText(u, { accept: 'text/html' }));
    const faqs: string[] = [];
    for (const u of KHS_FAQ_URLS) faqs.push(await fetchText(u, { accept: 'text/html' }));
    const media = await fetchJson<KhsMedia[]>(KHS_MEDIA_URL);
    const roomsPage = await fetchText(KHS_ROOMS_URL, { accept: 'text/html' });
    return parseKiteHostelContent({ home, rooms, faqs, media, roomsPage });
  },
  async fetchSlots(ctx: FetchContext): Promise<Slot[]> {
    const html = await fetchText(KHS_ROOMS_URL, { accept: 'text/html' });
    if (parseKhsPrices(html).length === 0) throw new Error('kite-hostel-stagnone: no price cards (.sc_price) on /rooms/ (layout changed?)');
    const slots = buildKhsSlots(html, todayIso());
    if (slots.length === 0) ctx.note(`/rooms/ prices are undated and the page was last edited ${khsModified(html) ?? '(no date)'}: offer stays "price on request"`);
    return slots;
  },
};
