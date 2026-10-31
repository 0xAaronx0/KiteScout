// ---------------------------------------------------------------------------
// Ventana Bay Resort, El Sargento (La Ventana bay, Baja California Sur, Mexico) - beach hotel with 11 room
// types (rooms, bungalows, beachfront suites, casita, studio, villa, palapa suite) and a restaurant; the
// on-site kite school is Strong Kiteboarding Baja (private watercraft-assisted kite and wing lessons, IKO/IWO).
//
// Data path (checked 2026-10-12): SiteMinder "Canvas" website www.ventanabay.com (English; /es/ Spanish).
//   content  / (intro, location, Google Maps link "ll=24.09845496,-109.99335770" -> spotCoords), /rooms.html
//            (11 room cards: <h2> name + <p> text), /kite-school.html (school text, lesson and rental rates in
//            USD), /gallery.html (photos; webbox.imgix.net originals without the crop parameters).
//   slots    none. The site prints no room rates; its "Book Now" form goes to app.thebookingbutton.com/
//            properties/ventanabayresortdirect -> direct-book.com (SiteMinder), whose app files answer with an
//            AWS WAF bot challenge to our UA (2026-10-12) -> not used. A public, robots-allowed SiteMinder
//            rates API exists (app.thebookingbutton.com/api/v1/properties/<code>/rates.json: per room-rate id
//            and day rate/available/min_stay; one manual check 2026-10-12 showed Jan 2027 rates), but the
//            site's own widget does not call it and it carries neither room names nor a currency -> not used
//            (lead decision). fetchSlots returns [] ("price on request").
// robots.txt (2026-10-12): www.ventanabay.com "Allow: /".
// Requests per run: content 4, slots 0.
// Known limits: no prices, no availability (confidence 'low'). Kite lesson / rental prices are content.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, imageCandidates, parse } from '../parse.js';
import type { ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.ventanabay.com';
export const VB_HOME_URL = `${SITE}/`;
export const VB_ROOMS_URL = `${SITE}/rooms.html`;
export const VB_KITE_URL = `${SITE}/kite-school.html`;
export const VB_GALLERY_URL = `${SITE}/gallery.html`;
const BOOKING_URL = 'https://app.thebookingbutton.com/properties/ventanabayresortdirect';

export interface VbRoom { name: string; text: string; notes: string[] }

const titleCase = (s: string): string => (/^[A-Z\s]+$/.test(s) ? s.toLowerCase().replace(/(^|\s)\S/g, c => c.toUpperCase()) : s);

/** Tagged text blocks in document order, without scripts/styles/chrome. */
function tagged(html: string): Array<{ tag: string; text: string }> {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, svg, header, footer, nav, form')) el.remove();
  const out: Array<{ tag: string; text: string }> = [];
  for (const el of root.querySelectorAll('h1, h2, h3, h4, h5, p, li')) {
    const t = collapse(el.text);
    if (t && out[out.length - 1]?.text !== t) out.push({ tag: el.tagName.toLowerCase(), text: t });
  }
  return out;
}

// --- pure parsers -----------------------------------------------------------------------------
/** /rooms.html: every <h2> room name followed by its <p> blocks (until the next heading / footer). */
export function parseVbRooms(html: string): VbRoom[] {
  const out: VbRoom[] = [];
  let cur: VbRoom | null = null;
  for (const b of tagged(html)) {
    if (b.tag === 'h2') { cur = { name: titleCase(b.text), text: '', notes: [] }; out.push(cur); continue; }
    if (b.tag !== 'p' || !cur) { if (b.tag !== 'p') cur = null; continue; }
    if (!cur.text) cur.text = b.text;
    else if (b.text.length > 120) cur.text += ` ${b.text}`;
    else cur.notes.push(b.text);
  }
  return out.filter(r => r.text);
}

/** Map pin of the "Find us" link: maps.google.com/?q=...&ll=<lat>,<lng>. */
export function parseVbCoords(homeHtml: string): { lat: number; lng: number } | null {
  const m = homeHtml.match(/maps\.google\.com\/\?q=[^"']*?ll=(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (!m) return null;
  const lat = Number(m[1]); const lng = Number(m[2]);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

/** Kite school rates: lesson lines ("$160 per hour", "$435 for 3 hour package") and rental lines. */
export function parseVbKiteRates(html: string): { lessons: string[]; rental: string[]; vat: string | null } {
  const bs = tagged(html).map(b => b.text);
  const lessons = bs.filter(b => /^\$\s?[\d,]+ (per hour|for \d+ hour package)$/i.test(b));
  const rental = bs.filter(b => /\$\s?[\d,]+ per day$/i.test(b));
  const vat = bs.find(b => /Rates are in USD/i.test(b)) ?? null;
  return { lessons, rental, vat };
}

/** Gallery / page photos: imgix originals (crop + size parameters dropped), deduplicated. */
export function vbPhotos(htmls: Array<[string, string]>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const [html, base] of htmls) {
    for (const u of imageCandidates(html, base, null, 120)) {
      if (!/^https:\/\/webbox\.imgix\.net\/images\//.test(u) || /\.png(\?|$)|\.svg/i.test(u)) continue;
      const clean = u.replace(/\?.*$/, '');
      if (seen.has(clean)) continue;
      seen.add(clean); out.push(clean);
    }
  }
  return out;
}

export interface VbPages { home: string; rooms: string; kite: string; gallery: string }

export function parseVentanaBayContent(p: VbPages): OfferContent {
  const home = tagged(p.home).map(b => b.text);
  const kite = tagged(p.kite).map(b => b.text);
  const rooms = parseVbRooms(p.rooms);
  const coords = parseVbCoords(p.home);
  const rates = parseVbKiteRates(p.kite);
  const intro = home.find(b => /Discover our oasis in El Sargento/i.test(b)) ?? '';
  const restaurant = home.find(b => /restaurant and a terrace/i.test(b)) ?? '';
  const school = kite.find(b => /watercraft assisted kiteboarding/i.test(b)) ?? '';
  const hourly = rates.lessons.find(l => /per hour/i.test(l))?.match(/\$\s?([\d,]+)/)?.[1] ?? null;
  const setup = rates.rental.find(r => /^Kite setup/i.test(r))?.match(/\$\s?([\d,]+) per day/)?.[1] ?? null;

  const contentRooms: ContentRoom[] = rooms.map(r => ({ name: r.name, description: r.text, features: r.notes }));

  const summary = [
    'Ventana Bay Resort is a beach hotel in El Sargento, next to the La Ventana kite and outdoor hub in Baja California Sur, Mexico, about 45 minutes from La Paz, with a restaurant and a terrace facing Cerralvo Island.',
    `It has ${rooms.length || 11} room types, from garden-view rooms and ocean-view bungalows to beachfront suites, a casita, a studio, the Casa Jazmin villa and the Palapa Sky Suite, most with air conditioning, mini-fridge and coffee maker.`,
    `The resort's kite school, Strong Kiteboarding Baja, gives private watercraft-assisted kite and wing lessons with IKO and IWO certified instructors${hourly ? ` (USD ${hourly} per hour, cheaper in 3-, 6- and 9-hour packages)` : ''}, tow-behind foil lessons and gear rental${setup ? ` (full kite set-up USD ${setup} per day)` : ''}.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Ventana Bay Resort',
    summary,
    continent: 'North America',
    country: 'Mexico',
    region: 'Baja California Sur',
    spot: 'La Ventana',
    ...(coords ? { spotCoords: coords } : {}),
    spotCoordsPrecise: true,
    itinerarySpots: [],
    durationDays: null,
    skillLevels: [],
    kiteLessons: /kiteboarding and winging lessons/i.test(school) ? true : null,
    equipmentRental: rates.rental.length > 0 ? true : null,
    beginnerFriendly: /Just show up and we have you covered/i.test(school) ? true : null,
    includedServices: ['Wi-Fi', 'Air conditioning (most rooms)', 'Linen and towels'],
    optionalServices: [
      ...rates.lessons.map(l => `Private kite or wing lesson (Strong Kiteboarding Baja): ${l.replace(/^\$\s?/, 'USD ')}`),
      ...rates.rental.map(r => `Rental: ${r.replace(/\$\s?/, 'USD ')}`),
      'Tow-behind foil and wakeboard lessons',
      'Restaurant',
      'Excursions: Cerralvo Island, Espíritu Santo Island, La Paz, El Triunfo, Todos Santos',
      ...(rates.vat ? [rates.vat] : []),
    ],
    accommodation: 'beach hotel rooms, bungalows, suites, casita and villa',
    mealPlan: null, // the site does not say what a rate includes
    languages: ['en', 'es'],
    rooms: contentRooms,
    imageUrls: vbPhotos([[p.gallery, VB_GALLERY_URL], [p.rooms, VB_ROOMS_URL], [p.home, VB_HOME_URL], [p.kite, VB_KITE_URL]]).slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: VB_HOME_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      `home: ${[intro, restaurant].filter(Boolean).join(' | ')}`,
      `rooms: ${rooms.map(r => `${r.name}: ${r.text}${r.notes.length ? ` (${r.notes.join('; ')})` : ''}`).join(' || ')}`,
      `kite school: ${kite.filter(b => b.length > 40 || /^\$/.test(b) || /per day$/.test(b)).join(' | ')}`,
      `map: ${coords ? `${coords.lat},${coords.lng}` : '-'}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const ventanaBayResortElSargento: OfferAdapter = {
  key: 'ventana-bay-resort-el-sargento',
  name: 'Ventana Bay Resort El Sargento',
  kind: 'accommodation',
  disciplines: ['kitesurf', 'wingfoil'],
  operator: {
    name: 'Ventana Bay Resort',
    websiteUrl: SITE,
    rootDomain: 'ventanabay.com',
    contactEmail: 'info@ventanabay.com',
    phone: '+526121140222',
  },
  url: VB_HOME_URL,
  slotMethod: 'booking_engine',
  instantBooking: true,
  fetchBudget: 4,
  confidence: 'low',
  async fetchContent() {
    const home = await fetchText(VB_HOME_URL, { accept: 'text/html' });
    const rooms = await fetchText(VB_ROOMS_URL, { accept: 'text/html' });
    const kite = await fetchText(VB_KITE_URL, { accept: 'text/html' });
    const gallery = await fetchText(VB_GALLERY_URL, { accept: 'text/html' });
    return parseVentanaBayContent({ home, rooms, kite, gallery });
  },
  async fetchSlots(ctx: FetchContext): Promise<Slot[]> {
    ctx.note('no slot source: the site prints no room rates and its SiteMinder engine (direct-book.com) answers our UA with an AWS WAF bot challenge (checked 2026-10-12)');
    return [];
  },
};
