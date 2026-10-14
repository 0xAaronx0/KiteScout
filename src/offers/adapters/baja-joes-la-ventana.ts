// ---------------------------------------------------------------------------
// Baja Joe's, La Ventana (Baja California Sur, Mexico) - beachfront hotel at the south end of La Ventana
// bay (one of the first resorts there, late 1990s) with a beach gear shed; Elevation Kiteboarding (IKO)
// runs its school on the beach in the resort.
//
// Data path (checked 2026-10-12): WordPress/Elementor site bajajoe.com, English only.
//   content  / (location, gear shed, school), /room-types/ (six room types: <h3>"— Name"</h3> + <p>),
//            /the-resort/ (bar with house beers, café, restaurant, gear shop), /kiting/ (Elevation
//            Kiteboarding: IKO, jet-ski assisted lessons, radios, rentals, EN/FR/ES), /events/ (Simple
//            Calendar month view: "Elevation Kite & Wing Center OPENS! October 1, 2026", "celebrate the
//            start of the 2026/2027 winter season") + the hotel's own SabeeApp booking engine page
//            ibe.sabeeapp.com/properties/Baja-Joes-Vacation-Paradise-booking/?p=... whose server-rendered
//            <script id="ng-state"> carries the property settings (lat/lng, currency MXN, allow_booking).
//   slots    none. The site prints no rates; they exist only in SabeeApp, whose API (api.sabeeapp.com/ibe/
//            room_types/lists, room_types/unavailable_dates) requires a per-request HMAC "Token" built with
//            a secret embedded in SabeeApp's client JS. Forging that signature would be impersonating
//            their browser client, so we do not call it -> fetchSlots returns [] ("price on request")
//            until the hotel or SabeeApp grants API access.
// robots.txt (2026-10-12): bajajoe.com disallows only admin/includes/config/logs/backup paths but sets
//   "Crawl-delay: 10" -> this adapter waits 10 s between its own bajajoe.com requests (local helper; the
//   shared throttle in http.ts is 1.5 s). ibe.sabeeapp.com robots.txt only blocks dotbot;
//   api.sabeeapp.com has no robots.txt (404) but is not used.
// Requests per run: content 5 (bajajoe.com, ~45 s with the crawl delay) + 1 (SabeeApp page), slots 0.
// Known limits: no prices, no availability (confidence 'low'); the events page shows only the current
//   month, so the season line comes and goes with the calendar.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, collapse, imageCandidates, parse } from '../parse.js';
import type { ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://bajajoe.com';
export const BJ_HOME_URL = `${SITE}/`;
export const BJ_ROOMS_URL = `${SITE}/room-types/`;
export const BJ_RESORT_URL = `${SITE}/the-resort/`;
export const BJ_KITING_URL = `${SITE}/kiting/`;
export const BJ_EVENTS_URL = `${SITE}/events/`;
export const BJ_IBE_URL = 'https://ibe.sabeeapp.com/properties/Baja-Joes-Vacation-Paradise-booking/?p=bSp539ecc4910b37d36';
const CRAWL_DELAY_MS = 10_000; // bajajoe.com robots.txt "Crawl-delay: 10"

export interface BjEvent { title: string; start: string | null; description: string }
export interface BjIbe { name: string | null; lat: number | null; lng: number | null; currency: string | null; allowBooking: boolean | null }

// --- local helpers ----------------------------------------------------------------
const memo = new Map<string, { at: number; p: Promise<string> }>();
let lastSiteFetch = 0;
let siteQueue: Promise<unknown> = Promise.resolve();
/** Memoised fetch; bajajoe.com requests are serialised with the robots.txt crawl delay (skipped on fixture replay). */
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const own = new URL(url).hostname.endsWith('bajajoe.com');
  const run = async () => {
    if (own && !process.env.OFFERS_FIXTURE_DIR) {
      const wait = lastSiteFetch + CRAWL_DELAY_MS - Date.now();
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
    }
    try { return await fetchText(url, { accept: 'text/html' }); } finally { if (own) lastSiteFetch = Date.now(); }
  };
  const p = own ? siteQueue.catch(() => undefined).then(run) : run();
  if (own) siteQueue = p;
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}
function pageText(html: string): string {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, header, footer, nav, svg')) el.remove();
  return collapse((root.querySelector('main') ?? root.querySelector('#content') ?? root.querySelector('body') ?? root).text)
    .replace(/\s*welcome home\.\s*Book Your Stay\s*Copyright ©.*$/i, '').trim();
}
const dashes = (s: string): string => s.replace(/\s*[—–]\s*/g, ' - ');

// --- pure parsers -----------------------------------------------------------------------------
/** Room types: Elementor headings "— Baja Joe's Beach House" followed by their text-editor paragraph. */
export function parseBjRooms(html: string): ContentRoom[] {
  const out: ContentRoom[] = [];
  for (const m of html.matchAll(/<h3[^>]*>\s*(?:—|&#8212;|&mdash;)\s*([\s\S]*?)<\/h3>([\s\S]*?)(?=<h3|$)/g)) {
    const name = clean(m[1]);
    const p = m[2].match(/<p[^>]*>([\s\S]*?)<\/p>/)?.[1];
    if (!name || !p) continue;
    const description = dashes(clean(p.replace(/<br\s*\/?>/gi, ' ')));
    const features: string[] = [];
    if (/private bathroom/i.test(description)) features.push('Private bathroom');
    if (/shared bathrooms?/i.test(description)) features.push('Shared bathrooms');
    if (/full kitchen/i.test(description)) features.push('Full kitchen');
    else if (/shared kitchens?/i.test(description)) features.push('Shared kitchen');
    if (/(?:2|two) bedroom/i.test(description)) features.push('2 bedrooms');
    else if (/one bedroom/i.test(description)) features.push('1 bedroom');
    const sleeps = description.match(/accommodating (\w+ to \w+) people/i)?.[1];
    if (sleeps) features.push(`Sleeps ${sleeps}`);
    if (/on the beach|beach front|beachfront/i.test(description)) features.push('On the beach');
    out.push({ name, description, features });
  }
  return out;
}

/** Simple Calendar events of the month shown on /events/ (title, ISO start date, description). */
export function parseBjEvents(html: string): BjEvent[] {
  const out: BjEvent[] = [];
  for (const li of parse(html).querySelectorAll('li.simcal-event')) {
    const title = collapse(li.querySelector('.simcal-event-title')?.text ?? '');
    const start = li.querySelector('[itemprop="startDate"]')?.getAttribute('content')?.slice(0, 10) ?? null;
    const description = collapse(li.querySelector('.simcal-event-description')?.text ?? '');
    if (title && !out.some(e => e.title === title && e.start === start)) out.push({ title, start, description });
  }
  return out;
}

/** "the start of the 2026/2027 winter season" in an event text, else null. */
export function bjSeason(events: BjEvent[]): string | null {
  for (const e of events) {
    const m = e.description.match(/(20\d{2})\s*\/\s*(20\d{2}) winter season/i);
    if (m) return `${m[1]}/${m[2]}`;
  }
  return null;
}

/** SabeeApp booking engine page: property settings from the Angular transfer state (<script id="ng-state">). */
export function parseBjIbe(html: string): BjIbe {
  const empty: BjIbe = { name: null, lat: null, lng: null, currency: null, allowBooking: null };
  const raw = html.match(/<script id="ng-state" type="application\/json">([\s\S]*?)<\/script>/)?.[1];
  if (!raw) return empty;
  let state: Record<string, unknown>;
  try { state = JSON.parse(raw) as Record<string, unknown>; } catch { return empty; }
  const key = Object.keys(state).find(k => k.startsWith('settings_get('));
  const s = (key ? state[key] : null) as { property?: Record<string, unknown>; configurations?: Record<string, unknown> } | null;
  const prop = s?.property ?? {};
  const lat = Number(prop.latitude); const lng = Number(prop.longitude);
  return {
    name: typeof prop.property_name === 'string' ? prop.property_name : null,
    lat: Number.isFinite(lat) && lat !== 0 ? lat : null,
    lng: Number.isFinite(lng) && lng !== 0 ? lng : null,
    currency: typeof prop.currency === 'string' ? prop.currency : null,
    allowBooking: typeof s?.configurations?.allow_booking === 'boolean' ? s.configurations.allow_booking : null,
  };
}

export interface BjPages { home: string; rooms: string; resort: string; kiting: string; events: string; ibe: string | null }

export function parseBajaJoesContent(p: BjPages): OfferContent {
  const home = pageText(p.home);
  const roomsText = pageText(p.rooms);
  const resort = pageText(p.resort);
  const kiting = pageText(p.kiting);
  const rooms = parseBjRooms(p.rooms);
  const events = parseBjEvents(p.events);
  const season = bjSeason(events);
  const opening = events.find(e => /kite[^!]*opens/i.test(e.title) && e.start) ?? null;
  const ibe = p.ibe ? parseBjIbe(p.ibe) : null;
  const wind = kiting.match(/best season is from (\w+ to \w+)/i)?.[1] ?? null;
  const lessonLangs = kiting.match(/lessons in ([A-Z][a-z]+(?:, [A-Z][a-z]+)* and [A-Z][a-z]+)/)?.[1] ?? null;
  const fmt = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

  const imgs: string[] = [];
  const seen = new Set<string>();
  for (const [html, base] of [[p.home, BJ_HOME_URL], [p.rooms, BJ_ROOMS_URL], [p.resort, BJ_RESORT_URL]] as const) {
    for (const u of imageCandidates(html, base, null, 60)) {
      if (/logo|icon|booklet|\.svg|\.gif/i.test(u)) continue;
      const k = u.replace(/-(?:scaled|e\d{10,}|\d+x\d+)+(?=\.[a-z]+$)/gi, '');
      if (seen.has(k)) continue;
      seen.add(k); imgs.push(u);
    }
  }

  const summary = [
    `Baja Joe's is a beachfront hotel at the south end of La Ventana bay in Baja California Sur, Mexico, one of the first resorts in La Ventana (late 1990s), with ${rooms.length || 'six'} types of private rooms, from budget rooms with shared bathrooms to a two-bedroom penthouse above the kite school.`,
    `Guests share community kitchens, paddle boards, snorkeling gear and a gear shed on the beach, and Elevation Kiteboarding, an IKO center with jet-ski assisted lessons, two-way radios and rentals, runs its school on the beach in the resort.`,
    `The resort has a café, a restaurant, a bar serving beer brewed on site and a kite shop${wind ? `; the best wind is from ${wind}` : ''}.`,
    season || opening
      ? `The hotel's event calendar announces the ${season ? `${season} winter season` : 'new season'}${opening?.start ? `, with the kite center opening on ${fmt(opening.start)}` : ''}; rates are only shown in the online booking engine.`
      : 'Rates are only shown in the online booking engine.',
  ].join(' ');

  return {
    kind: 'accommodation',
    title: "Baja Joe's",
    summary,
    continent: 'North America',
    country: 'Mexico',
    region: 'Baja California Sur',
    spot: 'La Ventana',
    // property coordinates from the hotel's own SabeeApp booking engine settings
    ...(ibe?.lat !== null && ibe?.lat !== undefined && ibe.lng !== null ? { spotCoords: { lat: ibe.lat, lng: ibe.lng } } : {}),
    itinerarySpots: [],
    durationDays: null,
    // home: "take some lessons, rent some gear, have a refresher or learn a new trick"; the-resort: "Not kiting yet? That's okay" (2026-10-12)
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: /lessons/i.test(kiting),
    equipmentRental: /rentals?/i.test(kiting),
    beginnerFriendly: /Not kiting yet/i.test(resort) || /ground lessons/i.test(kiting),
    includedServices: /access to our community kitchens/i.test(roomsText)
      ? ['Community kitchens', 'Paddle boards', 'Snorkeling gear', 'Wi-Fi', 'Beachfront gear shed']
      : ['Beachfront gear shed'],
    optionalServices: [
      `Kite lessons and rentals with Elevation Kiteboarding (IKO${lessonLangs ? `; ${lessonLangs}` : ''})`,
      'Café, Texana restaurant and bar with house-brewed beer',
      'Kite gear shop (Duotone, ION)',
      'Rooftop yoga',
      'Scuba diving, spearfishing, snorkeling trips and fishing',
    ],
    accommodation: 'beachfront hotel rooms and apartments',
    mealPlan: null, // community kitchens + café/restaurant on site; the site does not say a rate includes meals
    languages: ['en'],
    rooms,
    imageUrls: imgs.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: BJ_ROOMS_URL,
    bookingUrl: BJ_IBE_URL,
    sourceText: [
      `home: ${home}`,
      `room types: ${roomsText}`,
      `resort: ${resort}`,
      `kiting: ${kiting}`,
      `events: ${events.map(e => `${e.start ?? '?'} ${e.title}${e.description ? ` - ${e.description}` : ''}`).join(' | ')}`,
      `booking engine (SabeeApp): ${ibe ? JSON.stringify(ibe) : 'not read'}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
async function ibePage(ctx: FetchContext): Promise<string | null> {
  try { return await page(BJ_IBE_URL); } catch (e) { ctx.note(`SabeeApp booking page not read: ${(e as Error).message}`); return null; }
}

export const bajaJoesLaVentana: OfferAdapter = {
  key: 'baja-joes-la-ventana',
  name: "Baja Joe's, La Ventana",
  kind: 'accommodation',
  operator: {
    name: "Baja Joe's",
    websiteUrl: SITE,
    rootDomain: 'bajajoe.com',
    contactEmail: 'bajajoeshotel@gmail.com',
    phone: '+526122044450',
  },
  url: BJ_ROOMS_URL,
  slotMethod: 'booking_engine',
  instantBooking: true,
  fetchBudget: 6,
  // no rates readable (SabeeApp API needs a client-secret signature): the offer shows "price on request"
  confidence: 'low',
  async fetchContent(ctx) {
    const home = await page(BJ_HOME_URL);
    const rooms = await page(BJ_ROOMS_URL);
    const resort = await page(BJ_RESORT_URL);
    const kiting = await page(BJ_KITING_URL);
    const events = await page(BJ_EVENTS_URL);
    const ibe = await ibePage(ctx);
    return parseBajaJoesContent({ home, rooms, resort, kiting, events, ibe });
  },
  async fetchSlots(ctx): Promise<Slot[]> {
    ctx.note('no public rates: SabeeApp availability/rates API requires a signed client token (not used); price on request');
    return [];
  },
};
