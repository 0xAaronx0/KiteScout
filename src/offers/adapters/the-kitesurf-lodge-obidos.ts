// ---------------------------------------------------------------------------
// The Kitesurf Lodge, Lagoa de Óbidos (Silver Coast, Portugal) - kite & wing foil lodge with its own
// IKO school, private double/twin rooms + a shared dorm (shared bathrooms), pool, breakfast included.
//
// Data path (checked 2026-10-12): custom WordPress theme, server-rendered, English pages:
//   content  / (home: school, camps, "Winter at the Lodge" notice), /accommodation/ (at-a-glance list,
//            room cards .room-detail-card, amenities .amenity-item__text, JSON-LD SportsActivityLocation
//            with address + geo 39.4125,-9.2258), /faq/ (check-in, shared bathrooms, booking + deposit).
//   slots    none: the site prints no room price. Stays and camps are booked by inquiry (quote form,
//            e-mail, WhatsApp; FAQ "You can book via email or through our contact form. A 30% deposit is
//            required"). fetchSlots re-reads /accommodation/ and returns [] (offer = "price on request");
//            it notes when a EUR amount shows up there so the adapter can be extended.
// 2026/27 operation: pages edited 2026 (home dateModified 2026-07-08, 2026/03 photo uploads) and the
//   site-wide notice "From November the house stays open: stays from 2 nights or for 1 to 4 months, room
//   only with a shared kitchen ... get the winter rates first" (winter 2026/27, rates not published).
// robots.txt (2026-10-12): disallows /wp-admin/, /login/, /test/, /home-2/, /home-3/ and a preview path
//   only -> the three pages are allowed.
// Requests per run: content 3, slots 1 (memoised: 0 extra when content ran in the same process).
// Known limits: no prices and no room count on the site; camps (5/7 nights incl. lessons) are packages,
//   not modelled here.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, findPrices, imageCandidates, ldOfType, parse } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://thekitesurflodge.com';
export const TKL_HOME_URL = `${SITE}/`;
export const TKL_ACCOMMODATION_URL = `${SITE}/accommodation/`;
export const TKL_FAQ_URL = `${SITE}/faq/`;
const CONTACT_URL = `${SITE}/contact/`;

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

/** visible text: drops script/style/svg, the cookie/popup overlay and the site chrome */
function pageText(html: string): string {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, svg, header, footer, nav, #lpOverlay')) el.remove();
  return collapse((root.querySelector('main') ?? root.querySelector('body') ?? root).text);
}
const texts = (html: string, sel: string): string[] => parse(html).querySelectorAll(sel).map(e => collapse(e.text)).filter(Boolean);

// --- pure parsers -----------------------------------------------------------------------------
export function parseTklRooms(accommodationHtml: string): ContentRoom[] {
  const root = parse(accommodationHtml);
  return root.querySelectorAll('.room-detail-card').map(card => {
    const name = collapse(card.querySelector('.room-detail-card__title')?.text ?? '');
    const description = collapse(card.querySelector('.room-detail-card__text')?.text ?? '') || null;
    const features: string[] = [];
    if (/double or twin/i.test(description ?? '')) features.push('Double or twin beds');
    if (/bathrooms are shared/i.test(description ?? '') || /dorm/i.test(name)) features.push('Shared bathrooms');
    return { name, description, features };
  }).filter(r => r.name);
}

/** "Winter at the Lodge" notice (site-wide popup): the off-season offer, without rates. */
export function parseTklWinter(html: string): string | null {
  const t = collapse(parse(html).querySelector('#lpContent .lp-sub')?.text ?? '');
  return /from november/i.test(t) ? t : null;
}

/** FAQ question + answer pairs as plain text lines (the accordion is <h3>/<p>-free markup). */
export function parseTklFaq(faqHtml: string): string {
  const t = pageText(faqHtml);
  const s = t.search(/Check-in & Check-out/);
  const e = t.search(/Still have questions\?/);
  return s >= 0 ? t.slice(s, e > s ? e : undefined).trim() : t;
}

export interface TklPages { home: string; accommodation: string; faq: string }

export function parseTheKitesurfLodgeContent(p: TklPages): OfferContent {
  const home = pageText(p.home);
  const accText = pageText(p.accommodation);
  const faq = parseTklFaq(p.faq);
  const rooms = parseTklRooms(p.accommodation);
  const glance = texts(p.accommodation, '.at-glance__list li');
  const amenities = texts(p.accommodation, '.amenity-item__text');
  const winter = parseTklWinter(p.accommodation) ?? parseTklWinter(p.home);
  const place = ldOfType(p.accommodation, 'SportsActivityLocation')[0] ?? ldOfType(p.home, 'SportsActivityLocation')[0];
  const geo = (place?.geo ?? {}) as Record<string, unknown>;
  const lat = Number(geo.latitude);
  const lng = Number(geo.longitude);
  const address = (place?.address ?? {}) as Record<string, unknown>;
  const transfer = accText.match(/Approx\. (€\s?\d+) total per vehicle \(same price for 1[–-]8 guests\)/)?.[1] ?? null;

  const seen = new Set<string>();
  const imageUrls: string[] = [];
  for (const u of [...imageCandidates(p.accommodation, TKL_ACCOMMODATION_URL, null, 60), ...imageCandidates(p.home, TKL_HOME_URL, null, 60)]) {
    if (/\.svg|logo|icon|mega-menu|team_|Trip-|Maroc|Vietnam/i.test(u)) continue;
    const k = u.replace(/-(?:\d+x\d+|scaled)(?=\.[a-z]+$)/i, '');
    if (seen.has(k)) continue;
    seen.add(k); imageUrls.push(u);
  }

  const summary = [
    "The Kitesurf Lodge is a kite and wing foil lodge a few minutes' walk from the flat, waist-deep water of Lagoa de Óbidos on Portugal's Silver Coast, about 90 km north of Lisbon, with its own IKO-certified school (at most 2 students per instructor).",
    `The house has private double or twin rooms and a shared dorm, all with shared bathrooms, plus a pool, garden, bar, BBQ and communal dining; breakfast is included, and stays or 5- and 7-night camps are booked by inquiry with a 30% deposit.`,
    winter ? 'From November the lodge stays open for room-only stays from 2 nights or for 1 to 4 months with a shared kitchen; winter rates are sent on request.' : null,
  ].filter(Boolean).join(' ');

  return {
    kind: 'accommodation',
    title: 'The Kitesurf Lodge',
    summary,
    continent: 'Europe',
    country: 'Portugal',
    region: typeof address.addressRegion === 'string' ? address.addressRegion : 'Leiria',
    spot: 'Lagoa de Óbidos',
    // JSON-LD SportsActivityLocation.geo on the site (checked 2026-10-12)
    spotCoords: Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 ? { lat, lng } : null,
    itinerarySpots: [],
    durationDays: null,
    // home: "beginners find confidence, intermediates level up, experienced riders refine the details"
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: /IKO certified/i.test(home),
    // home offers "lessons or equipment rental", the FAQ says no rental without lessons -> unclear
    equipmentRental: null,
    beginnerFriendly: /beginners/i.test(home),
    includedServices: [
      'Breakfast (homemade; vegetarian, vegan and gluten-free options)',
      'Bed linen (no beach towels)',
      ...amenities.filter(a => /pool|garden|bbq|dining|parking|wifi|wi-fi/i.test(a)),
      'Storage for your own kite gear',
    ],
    optionalServices: [
      'IKO kitesurf lessons (private 3 x 2 h or semi-private 4 x 3 h for two booking together)',
      'Wing foil lessons',
      'Kite and wing foil camps of 5 or 7 nights (lessons, gear, room, breakfast)',
      'Surf, SUP, yoga and e-bike tours',
      transfer ? `Private transfer from Lisbon Airport (approx. ${transfer} per vehicle, 1-8 guests)` : 'Private transfer from Lisbon Airport',
    ],
    accommodation: 'lodge with private double/twin rooms and a shared dorm (shared bathrooms)',
    mealPlan: 'breakfast',
    languages: ['en', 'de', 'nl', 'fr', 'pt', 'es'],
    rooms,
    imageUrls: imageUrls.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: TKL_ACCOMMODATION_URL,
    bookingUrl: CONTACT_URL,
    sourceText: [
      `at a glance: ${glance.join(' | ')}`,
      `rooms: ${rooms.map(r => `${r.name}: ${r.description ?? ''}`).join(' | ')}`,
      `amenities: ${amenities.join(' | ')}`,
      `winter: ${winter ?? '-'}`,
      `address: ${[address.streetAddress, address.postalCode, address.addressLocality, address.addressRegion].filter(Boolean).join(', ')}; geo ${geo.latitude ?? ''},${geo.longitude ?? ''}`,
      `home: ${home}`,
      `accommodation: ${accText}`,
      `faq: ${faq}`,
    ].join('\n'),
  };
}

/** No published room price: [] (price on request). Returns the EUR amounts if the page starts printing some. */
export function tklVisiblePrices(accommodationHtml: string): string[] {
  // the travel section quotes rental-car and transfer prices: not room rates
  const t = pageText(accommodationHtml).replace(/How to Reach The Lodge[\s\S]*?(?=Book Your Room|$)/, '');
  return findPrices(t).map(p => p.raw);
}

// --- adapter ----------------------------------------------------------------------------------
export const theKitesurfLodgeObidos: OfferAdapter = {
  key: 'the-kitesurf-lodge-obidos',
  name: 'The Kitesurf Lodge Lagoa de Óbidos',
  kind: 'accommodation',
  operator: {
    name: 'The Kitesurf Lodge',
    websiteUrl: SITE,
    rootDomain: 'thekitesurflodge.com',
    contactEmail: 'info@thekitesurflodge.com',
    whatsapp: '+351936938802',
    phone: '+351936938802',
  },
  url: TKL_ACCOMMODATION_URL,
  slotMethod: 'price_table',
  fetchBudget: 4,
  confidence: 'low', // no prices or dates on the site; inquiry only
  async fetchContent() {
    const [home, accommodation, faq] = [await page(TKL_HOME_URL), await page(TKL_ACCOMMODATION_URL), await page(TKL_FAQ_URL)];
    return parseTheKitesurfLodgeContent({ home, accommodation, faq });
  },
  async fetchSlots(ctx): Promise<Slot[]> {
    const html = await page(TKL_ACCOMMODATION_URL);
    if (!/room-detail-card/.test(html)) throw new Error('the-kitesurf-lodge: room cards missing on /accommodation/ (layout changed?)');
    const prices = tklVisiblePrices(html);
    if (prices.length) ctx.note(`prices appeared on /accommodation/ (${prices.slice(0, 5).join(', ')}): extend the adapter`);
    return [];
  },
};
