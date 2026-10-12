// ---------------------------------------------------------------------------
// Habagat Kiteboarding Center & Aissatou Beach Resort, Bulabog Beach (Boracay, Philippines) - German-managed IKO kite
// centre on Boracay's kite beach whose sister company, Aissatou Beach Resort, rents 2 penthouse apartments plus
// premium (deluxe) and superior rooms right behind the launch ("home to kitesurfers since 2006").
//
// Kite link (own site, 2026-10-12): /kite-center/ "IKO Kite Center ... equipment rental, storage, and accommodation
//   right on kite beach"; /accommodation/ "Habagat Kiteborading Center offers accommodation through its sister company,
//   Aissatou Beach Resort".
// Liveness (2026-10-12): Yoast sitemap index lastmod 2026-08-17 for the page and room sitemaps (nd_booking_cpt_1),
//   2026-06-06 for courses and attachments; the IKO centre listing shows reviews dated March 2026 (search snippet of
//   ikointl.com, a hint, not data). The footer still says "© Copyright 2022". Verdict LIVE.
// Data path (checked 2026-10-12): WordPress + nd-booking (Nicdark Booking) plugin on www.kiteboracay.com:
//   content  / (intro, season), /accommodation/ (Aissatou), /kite-center/ (school, rental + storage rates in PHP),
//            /kiteboarding-courses/ (course prices in PHP), /rooms/<slug>/ x3 (description, room services, photos).
//   slots    the room pages' nd-booking price block (#nd_booking_single_cpt_1_header_image_price h1 + h5 currency).
//            On 2026-10-12 all three are EMPTY (no rate stored in the plugin; the week price table is blank) and the
//            only booking path is the "Booking Inquiry" form -> fetchSlots returns [] (price on request). If the owner
//            fills the plugin's price, the same parser yields one undated per-night slot per room type.
//   No external booking engine.
// robots.txt (2026-10-12): Yoast default (only /wp-admin/ disallowed).
// Requests per run: content 7, slots 3.
// Known limits: no coordinates on the site (no map embed); the room count per type is not stated (2 penthouses).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, detectCurrency, imageCandidates, parse, parseAmount } from '../parse.js';
import type { ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.kiteboracay.com';
export const HKC_HOME_URL = `${SITE}/`;
export const HKC_ACCOMMODATION_URL = `${SITE}/accommodation/`;
export const HKC_KITE_URL = `${SITE}/kite-center/`;
export const HKC_COURSES_URL = `${SITE}/kiteboarding-courses/`;
export const HKC_ROOM_URLS = ['penthouse-apartment', 'premium', 'superior'].map(s => `${SITE}/rooms/${s}/`);

const keyPart = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Visible text blocks (headings, paragraphs, list items, cells) in document order, de-duplicated. */
export function hkcLines(html: string): string[] {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, svg')) el.remove();
  const out: string[] = [];
  for (const el of root.querySelectorAll('h1, h2, h3, h4, h5, h6, p, li, td')) {
    const t = collapse(el.text);
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

// --- pure parsers -----------------------------------------------------------------------------
export interface HkcRoom {
  name: string;
  url: string;
  description: string | null;
  services: string[];
  /** nd-booking nightly price as stored in the plugin (empty on 2026-10-12) */
  price: number | null;
  currency: string | null;
  priceText: string | null;
  images: string[];
}

/** One /rooms/<slug>/ page of the nd-booking plugin. */
export function parseHkcRoom(html: string, url: string): HkcRoom {
  const root = parse(html);
  const title = collapse(root.querySelector('title')?.text ?? '').replace(/\s*\|.*$/, '');
  const name = title || collapse(root.querySelector('#nd_booking_single_cpt_1_title h1, h1')?.text ?? '');
  const priceBox = root.querySelector('#nd_booking_single_cpt_1_header_image_price');
  const amountText = collapse(priceBox?.querySelector('h1')?.text ?? '');
  const curText = collapse(priceBox?.querySelector('h5')?.text ?? '');
  const price = amountText ? parseAmount(amountText) : null;
  const currency = price !== null ? detectCurrency(`${curText} ${amountText}`) : null;
  const services = (root.querySelector('#nd_booking_single_cpt_1_services_content')?.querySelectorAll('p') ?? [])
    .map(p => collapse(p.text)).filter(Boolean);
  // the room text is the one long paragraph of the page (everything else is labels, dates or the footer address)
  const description = hkcLines(html)
    .filter(t => t.length > 80 && !/Bolabog Beach, Boracay Island, Malay/i.test(t) && !/^(By webdev|Also owned)/.test(t))
    .sort((a, b) => b.length - a.length)[0] ?? null;
  const images = imageCandidates(html, url, null, 60)
    .filter(u => /kiteboracay\.com\/wp-content\/uploads\/\d{4}\/\d{2}\/20\d{6}_\d+/.test(u))
    .map(u => u.replace(/-(?:\d+x\d+)(?=\.[a-z]+$)/i, ''));
  return { name, url, description, services, price, currency, priceText: amountText ? `${amountText} ${curText}`.trim() : null, images: [...new Set(images)] };
}

/** Slots only for rooms whose plugin price is filled AND names its currency; never a guessed currency. */
export function buildHkcSlots(rooms: HkcRoom[]): Slot[] {
  return rooms.filter(r => r.price !== null && r.currency).map(r => ({
    key: keyPart(r.name),
    startDate: null,
    endDate: null,
    unit: r.name,
    price: r.price,
    currency: r.currency,
    priceUnit: 'per_night' as const,
    priceBasis: 'room' as const,
    occupancy: null,
    availability: 'on_request' as const,
    availabilityText: 'booking inquiry form',
    spotsLeft: null,
  }));
}

/** "Kite and Bar php 2,200 php 3,200 php 12,000" style rows of the rental/storage tables on /kite-center/. */
export function parseHkcRates(kiteHtml: string): string[] {
  const out: string[] = [];
  for (const row of parse(kiteHtml).querySelectorAll('tr')) {
    const cells = row.querySelectorAll('td, th').map(c => collapse(c.text)).filter(Boolean);
    if (cells.length >= 2 && /php/i.test(cells.slice(1).join(' '))) out.push(`${cells[0]}: ${cells.slice(1).join(' / ')}`);
  }
  return out;
}

/** Course name + price lines from /kiteboarding-courses/ ("FULL KITE COURSE ... PHP 36,000"). */
export function parseHkcCourses(coursesHtml: string): string[] {
  const lines = hkcLines(coursesHtml);
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^(INTRODUCTION TO KITEBOARDING|DISCOVERY COURSE|FULL KITE COURSE|ADVANCED COURSE|ONE-ON-ONE PRIVATE LESSONS|KITE FOILING LESSONS)$/.test(lines[i])) continue;
    const priced = lines.slice(i + 1, i + 6).filter(t => /PHP\s?[\d,]+/.test(t));
    const dur = lines.slice(i + 1, i + 4).filter(t => /HOURS?\b/.test(t) && !/PHP/.test(t));
    if (priced.length) out.push(`${lines[i].replace(/^(.)(.*)$/, (_, a: string, b: string) => a + b.toLowerCase())}: ${[...dur, ...priced].join(', ')}`);
  }
  return out;
}

export interface HkcPages { home: string; accommodation: string; kite: string; courses: string; rooms: Array<{ url: string; html: string }> }

export function parseHabagatContent(p: HkcPages): OfferContent {
  const home = hkcLines(p.home);
  const acc = hkcLines(p.accommodation);
  const kite = hkcLines(p.kite);
  const rooms = p.rooms.map(r => parseHkcRoom(r.html, r.url));
  const rates = parseHkcRates(p.kite);
  const courses = parseHkcCourses(p.courses);
  const intro = home.find(t => /^Jump out of your bed/.test(t)) ?? null;
  const season = home.find(t => /main kiteboarding season in Boracay/i.test(t)) ?? null;
  const aissatou = acc.find(t => /sister company, Aissatou Beach Resort/i.test(t)) ?? null;
  const since = acc.join(' ').match(/home to kitesurfers since (\d{4})/)?.[1] ?? null;
  const accMore = acc.filter(t => /^(Aissatou Beach Resort stands|The fact that Aissatou|Equipped with \d)/.test(t));
  const school = kite.find(t => /^One of the first kiteboarding schools on Boracay/.test(t)) ?? null;
  const rental = kite.find(t => /^For certified kiteboarders looking to pack light/.test(t)) ?? null;
  const brands = rental?.match(/selection of ([A-Z]+ and [A-Z]+) kiteboarding equipment/)?.[1] ?? null;

  const contentRooms: ContentRoom[] = rooms.map(r => ({
    name: r.name,
    description: r.description,
    features: [...r.services, ...(/penthouse/i.test(r.name) ? ['Bedroom, living room and fully equipped kitchen', 'Top floor'] : [])],
  }));

  const imgs: string[] = [];
  for (const u of [...rooms.flatMap(r => r.images), ...imageCandidates(p.accommodation, HKC_ACCOMMODATION_URL, null, 40), ...imageCandidates(p.home, HKC_HOME_URL, null, 40)]) {
    if (!/kiteboracay\.com\/wp-content\/uploads\//.test(u) || /logo|icon|ig-png|para0|parallax|cropped-|\.png$|\.svg$/i.test(u)) continue;
    const big = u.replace(/-(?:\d+x\d+)(?=\.[a-z]+$)/i, '');
    if (!imgs.some(x => x.replace(/-scaled(?=\.[a-z]+$)/, '') === big.replace(/-scaled(?=\.[a-z]+$)/, ''))) imgs.push(big);
  }

  const summary = [
    'Habagat Kiteboarding Center is a German-managed IKO kite centre on Bulabog Beach, the 1.5 km kite beach on the east side of Boracay in the Philippines, where an outer reef shelters a shallow flat-water lagoon.',
    `Guests stay at its sister company Aissatou Beach Resort${since ? `, home to kitesurfers since ${since},` : ''} in two top-floor penthouse apartments with kitchen, premium rooms with balconies or ground-floor superior rooms, all air-conditioned with private bathrooms and a short walk from White Beach.`,
    `The centre runs IKO courses from a 90-minute introduction to the full Level 1-3 course, rents ${brands ? brands.split(' and ').map(b => b.charAt(0) + b.slice(1).toLowerCase()).join(' and ') : 'kite'} equipment and stores gear with caddie service; the main season is November to March, and from June to October kiting moves to White Beach.`,
    'Stays are booked by inquiry, so prices are on request.',
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Habagat Kiteboarding Center & Aissatou Beach Resort',
    summary,
    continent: 'Asia',
    country: 'Philippines',
    region: 'Western Visayas (Aklan)',
    spot: 'Bulabog Beach, Boracay',
    itinerarySpots: [],
    durationDays: null,
    // /kiteboarding-courses/: introduction, Level 1-3 beginner/intermediate/independent, Level 4 advanced, foiling
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: courses.length > 0 || /IKO/.test(school ?? ''),
    equipmentRental: !!rental,
    beginnerFriendly: kite.some(t => /ideal for beginners learning the sport/i.test(t)),
    includedServices: ['Air-conditioning', 'Private bathroom', 'Wi-Fi (premium room and penthouse)', 'Beachfront location on the kite beach'],
    optionalServices: [
      ...courses.map(c => `Kite course: ${c}`),
      ...rates.map(r => `Rental / storage (PHP): ${r}`),
      'Equipment storage with caddie for set-up, launching and landing',
      'Wing foiling lessons and rental',
    ],
    accommodation: 'beach resort rooms and penthouse apartments on the kite beach',
    mealPlan: null,
    languages: ['en', 'de'],
    rooms: contentRooms,
    imageUrls: imgs.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: HKC_ACCOMMODATION_URL,
    bookingUrl: HKC_ROOM_URLS[1],
    sourceText: [
      `home: ${intro ?? ''} ${season ?? ''}`,
      `accommodation: ${[aissatou, ...accMore].filter(Boolean).join(' ')}`,
      `kite centre: ${school ?? ''} ${rental ?? ''}`,
      `rates: ${rates.join('; ')}`,
      `courses: ${courses.join('; ')}`,
      ...rooms.map(r => `room ${r.name}: ${r.description ?? ''} | services ${r.services.join(', ')} | plugin price: ${r.priceText ?? 'empty'}`),
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
async function fetchRooms(): Promise<Array<{ url: string; html: string }>> {
  const out: Array<{ url: string; html: string }> = [];
  for (const url of HKC_ROOM_URLS) out.push({ url, html: await fetchText(url, { accept: 'text/html' }) });
  return out;
}

export const habagatAissatouBoracay: OfferAdapter = {
  key: 'habagat-aissatou-boracay',
  name: 'Habagat Kiteboarding Center & Aissatou Beach Resort (Boracay)',
  kind: 'accommodation',
  operator: {
    name: 'Habagat Kiteboarding Center',
    websiteUrl: SITE,
    rootDomain: 'kiteboracay.com',
    contactEmail: 'info@kiteboracay.com', // /accommodation/, 2026-10-12
    whatsapp: '+639173286684',
    phone: '+639173286684',
  },
  url: HKC_ACCOMMODATION_URL,
  slotMethod: 'booking_engine', // nd-booking plugin price fields (empty -> price on request)
  fetchBudget: 10,
  confidence: 'low', // no rates published; inquiry only
  async fetchContent() {
    const home = await fetchText(HKC_HOME_URL, { accept: 'text/html' });
    const accommodation = await fetchText(HKC_ACCOMMODATION_URL, { accept: 'text/html' });
    const kite = await fetchText(HKC_KITE_URL, { accept: 'text/html' });
    const courses = await fetchText(HKC_COURSES_URL, { accept: 'text/html' });
    return parseHabagatContent({ home, accommodation, kite, courses, rooms: await fetchRooms() });
  },
  async fetchSlots(ctx: FetchContext): Promise<Slot[]> {
    const rooms = (await fetchRooms()).map(r => parseHkcRoom(r.html, r.url));
    if (rooms.length === 0 || rooms.some(r => !r.name)) throw new Error('habagat-aissatou: room pages without a title (layout changed?)');
    const slots = buildHkcSlots(rooms);
    if (slots.length === 0) ctx.note('nd-booking price fields are empty on all room pages (booking inquiry only): price on request');
    return slots;
  },
};
