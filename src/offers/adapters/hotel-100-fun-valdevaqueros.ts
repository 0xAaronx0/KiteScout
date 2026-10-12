// ---------------------------------------------------------------------------
// Hotel 100% Fun, Valdevaqueros (Tarifa, Cadiz, Andalusia, Spain) - hotel with tropical gardens, pool, restaurant and
// chill-out bar on the N-340 km 76, a few metres from Valdevaqueros beach; seven room types, breakfast included.
// Kite link: the FAQ (edited 2026-06-09) calls the hotel "highly recommended if you're looking for accommodation for
// kitesurfing in Tarifa ... very close to the beach and specialist kitesurf schools" and says it has no kite school of
// its own but recommends one near the hotel; the older /en/kitesurf/ page (2025-04-29) still presents a "Kite School
// 100% Fun" as part of the hotel. The summary follows the newer FAQ.
//
// Data path (checked 2026-10-12): WordPress (WPML, theme "luxe", WP Hotel Booking plugin), English pages under /en/.
//   content  /en/ (hotel, rooms, restaurant, chill-out), /en/kitesurf/, /en/faqs/, /en/contact/ (Google Maps embed of
//            "100% Fun Hotel en Tarifa": !2d-5.6800 !3d36.0668 -> spotCoords) and the 7 room pages /en/room/<slug>/
//            (description, "Features" list, gallery).
//   slots    none. The site prints no room prices (its CSS hides the plugin's price and availability elements). The WP
//            Hotel Booking REST endpoints are anonymous and robots-allowed (GET /wp-json/wphb/v1/rooms/room-pricing
//            ?roomId=2855 answered 2026-10-12), but every day is priced 0: the plugin is only the room catalogue. Real
//            bookings run through a SiteMinder direct-book iframe (/en/bookings/: direct-book.com/properties/
//            100por100fundirect), whose AWS WAF bot challenge we do not get around -> not called. fetchSlots returns []
//            ("price on request") without a request.
// robots.txt (2026-10-12): Yoast default "Disallow:" (allow all).
// Requests per run: content 11, slots 0.
// Known limits: no prices or availability; the room pages' "Capacity" lines are partly inconsistent with their texts
//   (e.g. the sea-view suite "accommodating up to four people" vs "Maximum 2 adults") - kept as printed.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, collapse, meta, parse } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://100x100fun.com';
export const FUN_HOME_URL = `${SITE}/en/`;
export const FUN_KITE_URL = `${SITE}/en/kitesurf/`;
export const FUN_FAQ_URL = `${SITE}/en/faqs/`;
export const FUN_CONTACT_URL = `${SITE}/en/contact/`;
const BOOKING_URL = `${SITE}/en/bookings/`;
export const FUN_ROOM_URLS = [
  'garden-view-suite', 'balinese-suite', 'quadruple-room', 'suite-with-sea-view', 'junior-suite-with-sea-view',
  'superior-double-room', 'standard-double-room',
].map(s => `${SITE}/en/room/${s}/`);

export interface FunRoom { name: string; description: string | null; features: Array<[string, string]>; images: string[]; url: string }
export interface FunFaq { q: string; a: string }

/** Visible text lines (scripts, styles, SVGs dropped), split at block tags. */
export function funLines(html: string): string[] {
  return html
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .split(/<\/?(?:p|li|td|th|tr|h\d|div|br|ul|section|a|button|figure)\b[^>]*>/i)
    .map(s => clean(s.replace(/<[^>]+>/g, ' ')))
    .filter(Boolean);
}
const original = (u: string): string => u.replace(/-\d+x\d+(?=\.(?:jpe?g|png|webp)$)/i, '');

// --- pure parsers -----------------------------------------------------------------------------
/** /en/room/<slug>/: title, first description paragraph, "Features" list, gallery (original files). */
export function parseFunRoom(html: string, url: string): FunRoom | null {
  const root = parse(html);
  const room = root.querySelector('.hb_single_room');
  if (!room) return null;
  const name = clean(room.querySelector('.title h1')?.text ?? root.querySelector('h1.page-title')?.text);
  const desc = room.querySelectorAll('.block').find(b => /^Description$/i.test(clean(b.querySelector('.block__title')?.text)));
  const paras = (desc?.querySelectorAll('.block__content p') ?? []).map(p => collapse(p.text)).filter(Boolean);
  const features = room.querySelectorAll('.tab__pane li').map(li => {
    const k = clean(li.querySelector('strong')?.text).replace(/:$/, '');
    const v = clean(li.text).replace(/^[^:]+:\s*/, '');
    return [k, v] as [string, string];
  }).filter(([k, v]) => k && v);
  const images = [...new Set(room.querySelectorAll('.image-gallery__main img').map(i => original(i.getAttribute('src') ?? '')).filter(u => /\/wp-content\/uploads\/.+\.(jpe?g|webp)$/i.test(u)))];
  return name ? { name, description: paras[0] ?? null, features, images, url } : null;
}

/** Photos of a page: <img src / data-src>, data-image-src and background-image styles (originals, JPEGs only). */
export function funPageImages(html: string): string[] {
  const out: string[] = [];
  const push = (u: string | undefined | null) => {
    const v = u && original(u.trim());
    if (v && /^https:\/\/100x100fun\.com\/wp-content\/uploads\/.+\.jpe?g$/i.test(v) && !out.includes(v)) out.push(v);
  };
  for (const el of parse(html).querySelectorAll('img, [data-image-src], [style]')) {
    push(el.getAttribute('src')); push(el.getAttribute('data-src')); push(el.getAttribute('data-image-src'));
    push(el.getAttribute('style')?.match(/background-image:\s*url\((['"]?)(.*?)\1\)/i)?.[2]);
  }
  return out;
}

/** FAQ page: WPBakery toggles (.vc_toggle: .vc_toggle_title h4 = question, .vc_toggle_content = answer). */
export function parseFunFaq(html: string): FunFaq[] {
  return parse(html).querySelectorAll('.vc_toggle').map(t => ({
    q: clean(t.querySelector('.vc_toggle_title')?.text),
    a: clean(t.querySelector('.vc_toggle_content')?.text),
  })).filter(f => f.q && f.a);
}

/** Google Maps embed of the contact page: !2d<lng>!3d<lat>. */
export function parseFunCoords(html: string): { lat: number; lng: number } | null {
  const m = html.match(/google\.com\/maps\/embed\?pb=[^"']*?!2d(-?\d+\.\d+)!3d(-?\d+\.\d+)[^"']*?100%25?\s?Fun/i)
    ?? html.match(/google\.com\/maps\/embed\?pb=[^"']*?!2d(-?\d+\.\d+)!3d(-?\d+\.\d+)/);
  return m ? { lat: Number(m[2]), lng: Number(m[1]) } : null;
}

export interface FunPages { home: string; kite: string; faq: string; contact: string; rooms: Array<{ html: string; url: string }> }

export function parseHotel100FunContent(p: FunPages): OfferContent {
  const home = funLines(p.home);
  const kite = funLines(p.kite);
  const faqs = parseFunFaq(p.faq);
  const faq = (re: RegExp) => faqs.find(f => re.test(f.q))?.a ?? '';
  const rooms = p.rooms.map(r => parseFunRoom(r.html, r.url)).filter((r): r is FunRoom => !!r);
  const kiteFaq = faq(/good option for kitesurfing/i);
  const schoolFaq = faq(/own kitesurf school/i);
  const breakfast = faq(/breakfast included/i);
  const pets = faq(/allow pets/i);
  const parking = faq(/parking/i);
  const schoolPage = kite.find(l => /Kite School 100% Fun is part of Hotel 100% Fun/i.test(l)) ?? '';
  const welcome = home.find(l => /^Welcome to 100% Fun/i.test(l)) ?? '';

  const contentRooms: ContentRoom[] = rooms.map(r => ({
    name: r.name,
    description: r.description,
    features: r.features.map(([k, v]) => `${k}: ${v}`),
  }));

  const seen = new Set<string>();
  const imageUrls: string[] = [];
  const homeImgs = funPageImages(p.home).filter(u => !/OFERTAS|PROMOCION|NOMADAS|CEREMONIAS|TIENDA|icons8|logo|tripadvisor/i.test(u));
  const og = meta(p.home, 'og:image');
  for (const u of [...(og ? [original(og)] : []), ...rooms.flatMap(r => r.images.slice(0, 2)), ...homeImgs, ...rooms.flatMap(r => r.images.slice(2))]) {
    if (seen.has(u)) continue;
    seen.add(u); imageUrls.push(u);
  }

  const noOwnSchool = /^No\b/i.test(schoolFaq);
  const summary = [
    `Hotel 100% Fun is a hotel with tropical gardens, a pool, restaurant and chill-out bar on the N-340 at Valdevaqueros, Tarifa, a few metres from Valdevaqueros beach, which it describes as over 4 km of fine sand with conditions for kitesurfing, windsurfing and wing foiling.`,
    `It has ${rooms.length || 7} room types from standard doubles to suites with garden or sea view and a quadruple family room; breakfast is included${/not allow pets/i.test(pets) ? ' and pets are not allowed' : ''}.`,
    noOwnSchool
      ? `The hotel runs no kite school of its own but recommends a school near the hotel for lessons at all levels; rooms are booked online through the hotel's website.`
      : `Kite lessons are offered with the hotel's kite school on Valdevaqueros beach; rooms are booked online through the hotel's website.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Hotel 100% Fun',
    summary,
    continent: 'Europe',
    country: 'Spain',
    region: 'Valdevaqueros, Tarifa',
    spot: 'Valdevaqueros',
    spotCoords: parseFunCoords(p.contact),
    itinerarySpots: [],
    durationDays: null,
    skillLevels: [],
    // FAQ: lessons through a recommended school near the hotel ("ideal both for beginners and for those looking to improve")
    kiteLessons: /recommend the best school|kitesurfing course/i.test(`${schoolFaq} ${kite.join(' ')}`) ? true : null,
    equipmentRental: null,
    beginnerFriendly: /ideal both for beginners/i.test(schoolFaq) ? true : null,
    includedServices: [
      ...(/Breakfast is included/i.test(breakfast) ? ['Breakfast'] : []),
      'Swimming pool', 'Free Wi-Fi',
      ...(/parking/i.test(parking) ? ['Parking', 'Electric vehicle charger'] : []),
    ],
    optionalServices: ['Restaurant 100% Fun (dinner)', 'Chill-out bar with live music', 'Kitesurf lessons at a school near the hotel (recommended by the hotel)', 'Shop'],
    accommodation: 'hotel rooms and suites in tropical gardens',
    mealPlan: /Breakfast is included/i.test(breakfast) ? 'breakfast' : null,
    languages: [],
    rooms: contentRooms,
    imageUrls: imageUrls.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: FUN_HOME_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      `home: ${welcome}`,
      `kitesurf page: ${schoolPage}`,
      `faq kitesurfing: ${kiteFaq}`,
      `faq school: ${schoolFaq}`,
      `faq breakfast: ${breakfast}`,
      `faq pets: ${pets}`,
      `faq parking: ${parking}`,
      `rooms: ${rooms.map(r => `${r.name}: ${r.features.map(([k, v]) => `${k} ${v}`).join(', ')}`).join(' | ')}`,
    ].join('\n'),
  };
}

export const hotel100FunValdevaqueros: OfferAdapter = {
  key: 'hotel-100-fun-valdevaqueros',
  name: 'Hotel 100% Fun',
  kind: 'accommodation',
  operator: {
    name: 'Hotel 100% Fun',
    websiteUrl: SITE,
    rootDomain: '100x100fun.com',
    contactEmail: 'tarifa@100x100fun.com',
    phone: '+34956680330',
  },
  url: FUN_HOME_URL,
  slotMethod: 'price_table', // the site prints no prices: always [] (price on request)
  fetchBudget: 12,
  confidence: 'medium',
  async fetchContent() {
    const home = await fetchText(FUN_HOME_URL, { accept: 'text/html' });
    const kite = await fetchText(FUN_KITE_URL, { accept: 'text/html' });
    const faq = await fetchText(FUN_FAQ_URL, { accept: 'text/html' });
    const contact = await fetchText(FUN_CONTACT_URL, { accept: 'text/html' });
    const rooms: Array<{ html: string; url: string }> = [];
    for (const url of FUN_ROOM_URLS) rooms.push({ html: await fetchText(url, { accept: 'text/html' }), url });
    return parseHotel100FunContent({ home, kite, faq, contact, rooms });
  },
  async fetchSlots(ctx): Promise<Slot[]> {
    ctx.note('no room prices on 100x100fun.com (WP Hotel Booking prices every day at 0; bookings via SiteMinder direct-book, AWS WAF): price on request');
    return [];
  },
};
