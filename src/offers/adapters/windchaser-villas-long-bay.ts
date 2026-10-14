// ---------------------------------------------------------------------------
// Windchaser Villas, Long Bay Beach (Providenciales, Turks and Caicos Islands) - Alize and Bora, two four-bedroom
// villas with private pools in the gated Windchaser Villas development on the Long Bay kite beach, rented by TKCA
// Vacation Rentals. Found via bstoked listing 6807 ("Beach Side Villa", host "TKCA Vacation Rentals", active).
//
// Data (checked 2026-10-12): the operator has its own, current website, so villas, photos, map pin and prices come
// from there; the kite facts come from TKCA's own texts on bstoked (Aaron's bstoked exception 2026-10-12 for this
// listing), because the villa pages only say Long Bay is "one of the world's premier kiteboarding destinations".
//   own site  tkcavacationrentals.com (WordPress + Guesty plugin): /property/alize-villa/ and
//             /property/bora-villa-4-br/ -> guests / bedrooms / beds / bathrooms, description, amenities, gallery,
//             map (data-latitude/-longitude, "data-privacy=exact"), base price "From $ 1000 per night".
//   bstoked   GET https://bstoked.net/listings/6807/ (kite conditions + "The Experience": lockable gear storage by
//             the pool, rinse stations, private path to the beach) and /listings/services/?id=6807 ("Kite Lessons
//             with KiteSurf TCI"). The bstoked room split (studios, 2-bedroom suites) is not used: the own site
//             now rents whole villas only.
//   slots     one slot per villa, the site's base price, USD per villa per night, no dates, availability
//             'unknown' (the Guesty booking engine needs a browser token - not read).
// Liveness: both villa pages dateModified 2026-09-30, gallery photos uploaded 2026/07.
// robots.txt (2026-10-12): tkcavacationrentals.com "Disallow:" (nothing) + "Crawl-delay: 10" -> this adapter
//   waits 10 s between its own live requests to that host (local helper tkGet; http.ts does not read
//   Crawl-delay); bstoked.net disallows only /error/.
// Requests per run: content 4 (2 own site + 2 bstoked), slots 2 (own site).
// Known limits: "From $" is Guesty's base nightly rate (the pages add a USD 210 damage waiver and charge electricity
//   above USD 60/day; taxes are not mentioned); the third villa of the rental programme is not on the site; the
//   bstoked kite texts (gear storage, rinse stations, KiteSurf TCI) are older than the villa pages.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, parse, parseAmount, type HTMLElement } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://tkcavacationrentals.com';
export const WC_VILLA_URLS = [`${SITE}/property/alize-villa/`, `${SITE}/property/bora-villa-4-br/`];
export const WC_BSTOKED_URL = 'https://bstoked.net/listings/6807/';
export const WC_BSTOKED_SERVICES_URL = 'https://bstoked.net/listings/services/?id=6807';
const CRAWL_DELAY_MS = 10_000;

/** robots.txt asks for Crawl-delay: 10 - waits between live requests to the TKCA host (no wait when replaying). */
let lastLive = 0;
async function tkGet(url: string): Promise<string> {
  if (!process.env.OFFERS_FIXTURE_DIR) {
    const wait = lastLive + CRAWL_DELAY_MS - Date.now();
    if (lastLive > 0 && wait > 0) await new Promise(r => setTimeout(r, wait));
    lastLive = Date.now();
  }
  return fetchText(url, { accept: 'text/html' });
}

export interface WcVilla {
  name: string; url: string; guests: number | null; bedrooms: number | null; beds: number | null; bathrooms: number | null;
  size: string | null; fromPrice: number | null; currency: string | null; description: string; space: string;
  amenities: string[]; upgrades: string; photos: string[]; lat: number | null; lng: number | null;
}
export interface WcKite { conditions: string | null; experience: string | null; kiteServices: string[]; lessons: string[]; optional: string[] }

const field = (root: HTMLElement, cls: string): string => collapse(root.querySelector(`.post_custom_field.${cls} .w-post-elm-value`)?.text ?? '');
const num = (s: string): number | null => { const n = Number(s.replace(/,/g, '')); return s && Number.isFinite(n) ? n : null; };

// --- pure parsers -----------------------------------------------------------------------------------
export function parseWcVilla(html: string, url: string): WcVilla {
  const root = parse(html);
  const name = collapse(root.querySelector('.post_custom_field.display_title .w-post-elm-value')?.text ?? '')
    || collapse(root.querySelector('h1')?.text ?? '');
  const priceText = collapse(root.querySelector('.post_custom_field.base_price')?.text ?? '');
  const map = root.querySelector('.guesty-map');
  const text = collapse(root.querySelector('.post_custom_field.summary')?.parentNode?.text ?? '');
  // gallery: largest srcset candidate per image (Guesty uploads)
  const photos: string[] = [];
  for (const img of root.querySelectorAll('img.guesty-gallery__image')) {
    const cands = [...(img.getAttribute('srcset') ?? '').matchAll(/(\S+)\s+(\d+)w/g)].map(m => ({ u: m[1], w: Number(m[2]) }));
    const best = cands.sort((a, b) => b.w - a.w)[0]?.u ?? img.getAttribute('src');
    if (best && !photos.includes(best)) photos.push(best);
  }
  const lat = Number(map?.getAttribute('data-latitude'));
  const lng = Number(map?.getAttribute('data-longitude'));
  return {
    name: name.replace(/\s+4 BR$/, ''),
    url,
    guests: num(field(root, 'accommodates')),
    bedrooms: num(field(root, 'bedrooms')),
    beds: num(field(root, 'beds')),
    bathrooms: num(field(root, 'bathrooms')),
    size: field(root, 'property_size') || null,
    fromPrice: /From/i.test(priceText) ? parseAmount(priceText) : null,
    currency: /\$/.test(priceText) ? 'USD' : null,
    description: field(root, 'summary'),
    space: text.match(/The Space\s*The Space\s*(.+?)(?:\s*UPGRADE YOUR STAY|$)/)?.[1] ?? '',
    amenities: root.querySelectorAll('.guesty-amenities__item span').map(s => collapse(s.text)).filter(Boolean),
    upgrades: text.match(/arrangements such as:\s*(.+?)\s*Please contact us/)?.[1] ?? '',
    photos,
    lat: Number.isFinite(lat) && lat !== 0 ? lat : null,
    lng: Number.isFinite(lng) && lng !== 0 ? lng : null,
  };
}

/** TKCA's own texts on bstoked: kite conditions, "The Experience", kite service icons, lessons partner. */
export function parseWcKite(listingHtml: string, servicesHtml: string): WcKite {
  const root = parse(listingHtml);
  const main = root.querySelector('main') ?? root;
  const cond = main.querySelectorAll('div.b-b.block').find(b => /conditions/i.test(collapse(b.querySelector('.col-md-3')?.text ?? '')));
  const lb = (el: HTMLElement | null | undefined) => collapse((el?.text ?? '').replace(/&#xD;&#xA;|\r?\n/g, ' ')) || null;
  const exp = main.querySelectorAll('h4').find(h => collapse(h.text) === 'The Experience');
  const svc = parse(servicesHtml);
  const optional: string[] = [];
  const lessons: string[] = [];
  let group = '';
  for (const el of svc.querySelector('#Optional-services')?.querySelectorAll('h6, .py-05') ?? []) {
    if (el.tagName === 'H6') { group = collapse(el.text); continue; }
    const item = collapse(el.text);
    if (!item) continue;
    if (/lessons|coaching/i.test(group)) lessons.push(item); else optional.push(item);
  }
  return {
    conditions: lb(cond?.querySelector('.line-break')),
    experience: lb(exp?.parentNode?.querySelector('.line-break')),
    kiteServices: (cond?.querySelectorAll('.listing-structured i') ?? []).map(i => (i.getAttribute('title') ?? '').toLowerCase())
      .filter(t => /gear rental|gear storage|lessons or coaching|spot guidance|rescue service/.test(t)),
    lessons,
    optional,
  };
}

export function buildWcSlots(villas: WcVilla[]): Slot[] {
  return villas.filter(v => v.fromPrice !== null).map(v => ({
    key: v.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    startDate: null,
    endDate: null,
    unit: v.name,
    price: v.fromPrice,
    currency: v.currency,
    priceUnit: 'per_night' as const,
    priceBasis: 'room' as const,
    occupancy: null,
    availability: 'unknown' as const,
    availabilityText: `From $${v.fromPrice} per night (base rate for the whole villa, up to ${v.guests ?? '?'} guests; dates and availability not read)`,
    spotsLeft: null,
  }));
}

export interface WcPages { villas: Array<{ html: string; url: string }>; bstoked: string; bstokedServices: string }

export function parseWindchaserContent(p: WcPages): OfferContent {
  const villas = p.villas.map(v => parseWcVilla(v.html, v.url));
  const kite = parseWcKite(p.bstoked, p.bstokedServices);
  const k = `${kite.conditions ?? ''} ${kite.experience ?? ''}`;
  const storage = /lockable storage for your gear/i.test(k);
  const rinse = /rinse stations/i.test(k);
  const path = k.match(/private path from the villa to beach \(about (\d+) ft\)/)?.[1] ?? null;
  const windKn = k.match(/mostly (\d+-\d+) knots/)?.[1] ?? null;
  const depth = /one meter deep/i.test(k);
  const partner = kite.lessons.map(l => l.match(/with (.+)$/)?.[1]).find(Boolean) ?? null;

  const rooms: ContentRoom[] = villas.map(v => ({
    name: v.name,
    description: `${v.bedrooms ?? '?'} bedrooms, ${v.beds ?? '?'} beds, ${v.bathrooms ?? '?'} bathrooms, up to ${v.guests ?? '?'} guests${v.size ? `, ${v.size.replace(/^Property Size:\s*/, '')}` : ''}; private pool`,
    features: [
      ...(v.fromPrice ? [`From USD ${v.fromPrice} per night (base rate)`] : []),
      ...v.amenities.filter(a => /pool|air conditioning|kitchen|washer|dryer|bbq|tennis|beach/i.test(a)),
    ],
  }));
  const pin = villas.find(v => v.lat !== null && v.lng !== null);
  const sharedAmenities = villas.length ? villas[0].amenities.filter(a => villas.every(v => v.amenities.includes(a))) : [];

  const summary = [
    `${villas.map(v => v.name.replace(/ Villa$/, '')).join(' and ')} are ${new Set(villas.map(v => v.bedrooms)).size === 1 && villas[0]?.bedrooms ? `${villas[0].bedrooms}-bedroom` : ''} villas for ${villas.map(v => v.guests).filter(Boolean).join(' and ')} guests with private pools in the gated Windchaser Villas development on Long Bay Beach, Providenciales, rented by TKCA Vacation Rentals${path ? `; a private path leads about ${path} ft to the beach` : ''}.`,
    `Long Bay is a sandy bay${depth ? ' about one metre deep' : ''} with on- to side-shore east-southeast trade winds${windKn ? ` of mostly ${windKn} knots` : ''}${/preferred spot for all riders/i.test(k) ? ", the preferred kite spot on Providenciales for beginners and advanced riders" : ''}.`,
    `${storage ? `The villas have lockable kite gear storage by the pool${rinse ? ' and rinse stations' : ''}` : 'The villas are on the kite beach'}${partner ? `, and lessons are arranged with ${partner}` : ''}.`,
  ].join(' ');

  const photos: string[] = [];
  const perVilla = Math.max(...villas.map(v => v.photos.length), 0);
  for (let i = 0; i < perVilla && photos.length < 40; i++) for (const v of villas) if (v.photos[i] && !photos.includes(v.photos[i])) photos.push(v.photos[i]);

  return {
    kind: 'accommodation',
    title: 'Windchaser Villas',
    summary,
    continent: 'North America',
    country: 'Turks and Caicos Islands',
    region: 'Providenciales',
    spot: 'Long Bay Beach',
    spotCoords: pin ? { lat: pin.lat!, lng: pin.lng! } : null,
    itinerarySpots: [],
    durationDays: null,
    // TKCA on bstoked: "a favorite for all levels"
    skillLevels: /favorite for all levels/i.test(k) ? ['beginner', 'intermediate', 'advanced'] : [],
    kiteLessons: partner ? true : null,
    equipmentRental: null, // neither the own site nor the bstoked texts name kite rental
    beginnerFriendly: /favorite for all levels|no current, no coral, no breaking waves/i.test(k) ? true : null,
    includedServices: [
      ...(storage ? ['Lockable kite gear storage by the pool'] : []),
      ...(rinse ? ['Rinse stations'] : []),
      ...sharedAmenities.filter(a => /pool|wifi|wi-fi|internet|air conditioning|parking|tennis|beach essentials/i.test(a)),
    ],
    optionalServices: [
      ...kite.lessons.map(l => (/lesson/i.test(l) ? l : `Kite lessons: ${l}`)),
      ...['Pre-stocking grocery service', 'Transportation', 'Private chef', 'Butler services', 'Housekeeping'].filter(s => villas.some(v => v.space.includes(s) || v.upgrades.includes(s))),
    ],
    accommodation: 'four-bedroom villas with private pools on the beach',
    mealPlan: 'self_catering',
    languages: ['en'],
    rooms,
    imageUrls: photos,
    heroVideoUrl: null,
    sourceUrl: WC_VILLA_URLS[0],
    bookingUrl: WC_VILLA_URLS[0],
    sourceText: [
      ...villas.map(v => `${v.name} (${v.url}): ${v.guests} guests, ${v.bedrooms} bedrooms, ${v.beds} beds, ${v.bathrooms} bathrooms, ${v.size ?? ''}; from ${v.currency} ${v.fromPrice} per night; map ${v.lat},${v.lng}; ${v.description} ${v.space}; amenities: ${v.amenities.join(', ')}`),
      `bstoked 6807 (TKCA's own texts, Aaron's exception 2026-10-12) conditions: ${kite.conditions ?? ''}`,
      `bstoked experience: ${kite.experience ?? ''}`,
      `bstoked kite services: ${kite.kiteServices.join(', ')}; lessons: ${kite.lessons.join('; ')}; other: ${kite.optional.join('; ')}`,
    ].join('\n'),
  };
}

// --- adapter ------------------------------------------------------------------------------------------
export const windchaserVillasLongBay: OfferAdapter = {
  key: 'windchaser-villas-long-bay',
  name: 'Windchaser Villas (Long Bay, Providenciales)',
  kind: 'accommodation',
  operator: {
    name: 'TKCA Vacation Rentals',
    websiteUrl: SITE,
    rootDomain: 'tkcavacationrentals.com',
    contactEmail: 'info@tkcavacationrentals.com', // own site footer, 2026-10-12
    phone: '+16494311234',                       // own site, 2026-10-12
  },
  url: WC_VILLA_URLS[0],
  slotMethod: 'price_table',
  instantBooking: true,
  fetchBudget: 6,
  confidence: 'medium', // base price without dates or availability
  async fetchContent() {
    const villas: Array<{ html: string; url: string }> = [];
    for (const url of WC_VILLA_URLS) villas.push({ html: await tkGet(url), url });
    const bstoked = await fetchText(WC_BSTOKED_URL, { accept: 'text/html' });
    const bstokedServices = await fetchText(WC_BSTOKED_SERVICES_URL, { accept: 'text/html', headers: { 'X-Requested-With': 'XMLHttpRequest' } });
    return parseWindchaserContent({ villas, bstoked, bstokedServices });
  },
  async fetchSlots(ctx) {
    const villas: WcVilla[] = [];
    for (const url of WC_VILLA_URLS) villas.push(parseWcVilla(await tkGet(url), url));
    const missing = villas.filter(v => v.fromPrice === null).map(v => v.name);
    if (missing.length === villas.length) throw new Error('windchaser: no "From $ ... per night" on any villa page');
    if (missing.length) ctx.incomplete(`no base price on ${missing.join(', ')}`);
    return buildWcSlots(villas);
  },
};
