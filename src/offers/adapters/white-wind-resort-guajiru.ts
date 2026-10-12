// ---------------------------------------------------------------------------
// White Wind Resort, Ilha do Guajiru (Praia da Barra, Itarema, Ceará, Brazil) - 8-room beachfront boutique
// hotel on the kite lagoon with its own kite school (Core gear), free kite storage, compressor, beach boys.
//
// Inclusion: Aaron's decision of 2026-10-12. The own site shows no explicit 2026/27 dates or prices (brief
//   rule 5(b) waived for this property); it is listed as "price on request". Kite link (rule 5(a)) on the own
//   site: /kiteschool.html ("Our kite school offers beginner courses ... kite rental", "Kite storage free for
//   resort guests"), room rates include kite storage, compressor and beach boy service (/booking.html).
//   Newest sign of life: the home page was modified 2026-06-14 (Last-Modified header), footer "2012-2026".
//
// Data path (checked 2026-10-12): static hand-written HTML (no CMS, no JSON-LD, no map):
//   content  / (8 rooms, pool, restaurant, location, contact footer, hero video videos/*.mp4),
//            /booking.html ("Included during your stay" .feature list, room cards #deluxe / #suite with chips
//            and photo galleries), /kiteschool.html (school, Core gear, languages, June-February wind).
//   slots    none: the site prints no price; "For bookings or questions please use the contact form, WhatsApp
//            or email" (/booking.html). fetchSlots re-reads /booking.html (memoised) and returns [] (offer =
//            "price on request"); it notes when an amount shows up there so the adapter can be extended.
//   Not used: bstoked / booksurfcamps / portals (hints only).
// robots.txt (2026-10-12): 404 (allow all).
// Requests per run: content 3, slots 1 (0 extra when content ran in the same process).
// Known limits: no prices, no room count per category, no coordinates on the site (the geocoder places
//   Ilha do Guajiru); the contact e-mail uses the domain whitewind-resort.com, the site whitewindresort.com.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, findPrices, imageCandidates, parse } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.whitewindresort.com';
export const WW_HOME_URL = `${SITE}/`;
export const WW_BOOKING_URL = `${SITE}/booking.html`;
export const WW_KITE_URL = `${SITE}/kiteschool.html`;
const CONTACT_URL = `${SITE}/contact.html`;

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

const textOf = (el: { text: string } | null | undefined): string => collapse(el?.text ?? '');

/** visible text of <main> + hero (drops header/footer chrome, styles, the WhatsApp button) */
function mainText(html: string): string {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, header, footer, .whatsapp')) el.remove();
  return collapse((root.querySelector('body') ?? root).structuredText);
}

/** `.feature` boxes: "<b>Title</b>Text" -> "Title: Text" */
function features(html: string, scope = ''): string[] {
  return parse(html).querySelectorAll(`${scope} .feature`.trim()).map(f => {
    const b = textOf(f.querySelector('b'));
    const rest = collapse(f.text.replace(f.querySelector('b')?.text ?? '', ''));
    return b ? `${b}: ${rest}` : rest;
  }).filter(Boolean);
}

/** findPrices misses a trailing euro sign ("90 €", "420,00 €": its `\b` after € never matches); catch those too */
function amounts(text: string): string[] {
  const out = findPrices(text).map(p => p.raw);
  for (const m of text.matchAll(/\d[\d.,]*\s?€/g)) if (!out.some(r => r.includes(m[0].trim()))) out.push(m[0]);
  return out;
}

// --- pure parsers -----------------------------------------------------------------------------
export interface WwRoom { name: string; text: string; chips: string[]; images: string[] }

/** Room cards on /booking.html (#deluxe, #suite): title, text, chips, the photo gallery below. */
export function parseWwRooms(bookingHtml: string): WwRoom[] {
  const root = parse(bookingHtml);
  return root.querySelectorAll('section[id]').map(sec => {
    const card = sec.querySelector('article.room-card');
    const name = textOf(card?.querySelector('h3'));
    const text = textOf(card?.querySelector('p'));
    const chips = (card?.querySelectorAll('.chip') ?? []).map(c => textOf(c)).filter(Boolean);
    const images = sec.querySelectorAll('img').map(i => i.getAttribute('src') ?? '').filter(Boolean)
      .map(src => new URL(src, WW_BOOKING_URL).toString());
    return { name, text, chips, images: [...new Set(images)] };
  }).filter(r => r.name);
}

/** "Included during your stay" list on /booking.html. */
export function parseWwIncluded(bookingHtml: string): string[] {
  return features(bookingHtml, '.grid.three');
}

export interface WwKite { lead: string; season: string | null; languages: string[]; features: string[] }

export function parseWwKite(kiteHtml: string): WwKite {
  const root = parse(kiteHtml);
  const lead = textOf(root.querySelector('main p.lead'));
  const hero = textOf(root.querySelector('.hero-content p'));
  const season = hero.match(/From ([A-Z][a-z]+ to [A-Z][a-z]+)/)?.[1] ?? null;
  const langNames: Record<string, string> = { English: 'en', Spanish: 'es', Portuguese: 'pt', German: 'de', Italian: 'it', French: 'fr' };
  const langSentence = lead.match(/Lessons are available in ([^.]+)\./)?.[1] ?? '';
  const languages = Object.entries(langNames).filter(([n]) => langSentence.includes(n)).map(([, c]) => c);
  return { lead, season, languages, features: features(kiteHtml) };
}

export interface WwHome { rooms: number | null; lead: string; address: string; email: string | null; video: string | null }

export function parseWwHome(homeHtml: string): WwHome {
  const root = parse(homeHtml);
  const text = mainText(homeHtml);
  const rooms = Number(text.match(/only (\d+) rooms/i)?.[1] ?? text.match(/(\d+)-room/i)?.[1]) || null;
  const lead = textOf(root.querySelector('main p.lead'));
  const contact = root.querySelectorAll('footer .footer-grid > div').find(d => /Contact/i.test(textOf(d.querySelector('h3'))));
  const address = contact ? (contact.querySelector('p')?.innerHTML ?? '').split(/<br\s*\/?>/i).map(s => collapse(parse(s).text)).filter(s => s && !s.includes('@')).join(', ') : '';
  const email = homeHtml.match(/mailto:([\w.+-]+@[\w.-]+\.[a-z]{2,})/i)?.[1] ?? null;
  const src = root.querySelector('video.hero-video source')?.getAttribute('src') ?? null;
  return { rooms, lead, address, email, video: src ? new URL(src, WW_HOME_URL).toString() : null };
}

export interface WwPages { home: string; booking: string; kite: string }

export function parseWhiteWindContent(p: WwPages): OfferContent {
  const home = parseWwHome(p.home);
  const roomCards = parseWwRooms(p.booking);
  const included = parseWwIncluded(p.booking);
  const kite = parseWwKite(p.kite);
  const bookingText = mainText(p.booking);

  const rooms: ContentRoom[] = roomCards.map(r => ({ name: r.name, description: r.text || null, features: r.chips }));

  const seen = new Set<string>();
  const imageUrls: string[] = [];
  const kitePhotos = imageCandidates(p.kite, WW_KITE_URL, null, 10);
  // home gallery first (pool, aerial, restaurant), then both rooms, then the kite photo
  const roomImgs = roomCards.flatMap(r => r.images);
  for (const u of [...imageCandidates(p.home, WW_HOME_URL, null, 30), ...roomImgs, ...kitePhotos]) {
    if (!u.startsWith(SITE) || /logo|favicon|\.svg|\.gif/i.test(u)) continue; // drops the beach-start.ch wind widget
    if (seen.has(u)) continue;
    seen.add(u); imageUrls.push(u);
  }

  const summary = [
    `White Wind Resort is a beachfront boutique hotel with ${home.rooms ?? 8} rooms at Praia da Barra on Ilha do Guajiru (Itarema, Ceará, north-east Brazil), with direct access to the kite lagoon.`,
    `It has deluxe rooms with a sea or garden view terrace and ocean front suites, all with air conditioning, private bathroom, minibar and Smart TV; rates include breakfast, the freshwater pool, Wi-Fi, kite storage, a compressor and beach boy service, and a restaurant and bar serve lunch.`,
    `The resort's kite school offers beginner and progression courses and Core kite rental${kite.languages.length ? ' in English, Spanish, Portuguese and German' : ''}${kite.season ? `; the site names ${kite.season} as the wind season` : ''}.`,
    'Stays are booked by request (contact form, WhatsApp or e-mail); the site publishes no prices.',
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'White Wind Resort',
    summary,
    continent: 'South America',
    country: 'Brazil',
    region: 'Ceará',
    spot: 'Ilha do Guajiru',
    itinerarySpots: [],
    durationDays: null,
    // "beginner courses, coaching to improve your level" (/kiteschool.html)
    skillLevels: ['beginner', 'intermediate'],
    kiteLessons: /beginner courses|Lessons/i.test(kite.lead),
    equipmentRental: /kite rental|available for rent/i.test(`${kite.lead} ${kite.features.join(' ')}`),
    beginnerFriendly: /beginner courses/i.test(kite.lead),
    includedServices: included,
    optionalServices: [
      'Kite lessons (beginner and progression courses)',
      'Core kite rental, test and purchase',
      'Private airport transfer (price on request)',
    ].filter((x): x is string => !!x),
    accommodation: 'beachfront boutique hotel with deluxe rooms and ocean front suites',
    mealPlan: 'breakfast',
    languages: kite.languages,
    rooms,
    imageUrls: imageUrls.slice(0, 30),
    heroVideoUrl: home.video,
    sourceUrl: WW_BOOKING_URL,
    bookingUrl: CONTACT_URL,
    sourceText: [
      `home: ${home.lead}`,
      `address: ${home.address}; e-mail ${home.email ?? '-'}`,
      `included: ${included.join(' | ')}`,
      `rooms: ${roomCards.map(r => `${r.name}: ${r.text} [${r.chips.join(', ')}]`).join(' | ')}`,
      `kite: ${kite.lead} ${kite.features.join(' | ')} season ${kite.season ?? '-'}`,
      `booking page: ${bookingText}`,
    ].join('\n'),
  };
}

/** No published price: [] (price on request). Returns the amounts if /booking.html starts printing some. */
export function wwVisiblePrices(bookingHtml: string): string[] {
  return amounts(mainText(bookingHtml));
}

// --- adapter ----------------------------------------------------------------------------------
export const whiteWindResortGuajiru: OfferAdapter = {
  key: 'white-wind-resort-guajiru',
  name: 'White Wind Resort Ilha do Guajiru',
  kind: 'accommodation',
  operator: {
    name: 'White Wind Resort',
    websiteUrl: SITE,
    rootDomain: 'whitewindresort.com',
    contactEmail: 'info@whitewind-resort.com',
    whatsapp: '+5588999843131',
    phone: '+5588999843131',
  },
  url: WW_BOOKING_URL,
  slotMethod: 'price_table',
  fetchBudget: 4,
  confidence: 'low', // Aaron 2026-10-12: listed without 2026/27 proof, no prices on the site, inquiry only
  async fetchContent() {
    const [home, booking, kite] = [await page(WW_HOME_URL), await page(WW_BOOKING_URL), await page(WW_KITE_URL)];
    return parseWhiteWindContent({ home, booking, kite });
  },
  async fetchSlots(ctx): Promise<Slot[]> {
    const html = await page(WW_BOOKING_URL);
    if (parseWwRooms(html).length === 0) throw new Error('white-wind: room cards missing on /booking.html (layout changed?)');
    const prices = wwVisiblePrices(html);
    if (prices.length) ctx.note(`prices appeared on /booking.html (${prices.slice(0, 5).join(', ')}): extend the adapter`);
    return [];
  },
};
