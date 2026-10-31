// ---------------------------------------------------------------------------
// Feddet Strand Resort, Feddet peninsula near Faxe (South Zealand, Denmark) - five-star camping and holiday resort between
// Faxe Bay and Præstø Fjord, about an hour from Copenhagen, open all year: lodges, mobile homes, glamping tents, rental
// caravans, holiday houses and villas. The resort works with the kite school Kitekollektivet; the kite spot is the small
// beach at Fed harbour (Præstø Fjord, westerly winds) or the beach on Faxe Bay (easterly winds), shallow and fit for
// beginners.
//
// Data path (checked 2026-10-14), WordPress / Elementor site, English pages:
//   content  /en/ (intro, JSON-LD Place geo), /en/activities/kitesurfing/ (spot, day / annual pass, Kitekollektivet course
//            prices), /en/accomodation/ (overview cards: <h3> link to the unit page, icon-list facts, text-editor <p>).
//   slots    Compusoft online booking (/en/book/, csobPortalKey 6240e319-…) via the shared helpers of hvide-sande-camping.ts:
//            per sample week the widget's anonymous profile list + one price call. "We use variable pricing … you will
//            always find the current daily price in our online booking" (/en/prices/) - no printed price table. Open all
//            year, so one Saturday-to-Saturday week per month for 12 months, stopping after 2 sample weeks in a row in
//            which nothing at all is bookable (on 2026-10-12 the engine had no rental unit loaded for June 2027).
// robots.txt (2026-10-12): feddet.dk disallows /wp-admin/ only; v3.onlinebooking.dk "Allow: /".
// Requests per run: content 3, slots up to 2 per sample week (max 12 weeks) - about 8-10 while the engine is loaded only a
//   few months ahead. The profile list of this portal is large (~0.5 MB, 80 profiles incl. pitches and add-ons).
// Parsed: slot = rental unit type x sample week ("spa-lodge|2026-11-07"), DKK per unit for 7 nights as quoted by the engine
//   (priceUnit 'package', packageNights 7, priceBasis 'room'), available / limited (1-2 free) / sold_out. Pitches, offer
//   profiles (weekend / last-minute / "Tilbud" / "Ferietilbud"), business rental rooms and add-on products are left out.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, imageCandidates, ldOfType, todayIso } from '../parse.js';
import type { ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';
import { csobAddDays, csobRooms, csobSaturdaySamples, csobSlots, fetchCsobSamples, type CsobPortal } from './hvide-sande-camping.js';

const SITE = 'https://feddet.dk';
export const FSR_HOME_URL = `${SITE}/en/`;
export const FSR_KITE_URL = `${SITE}/en/activities/kitesurfing/`;
export const FSR_UNITS_URL = `${SITE}/en/accomodation/`;
const BOOKING_URL = `${SITE}/en/book-online/`;
export const FSR_PORTAL: CsobPortal = {
  portalKey: '6240e319-d8ac-49a1-a8d4-b32f84974a0f',
  language: 'en',
  currency: 'DKK',
  // subTitle "(Feddet Strand Camping & Feriepark, Rental units, …)"; offers, rental rooms (business) and add-ons out
  isUnit: p => /rental units/i.test(p.subTitle) && !/offer|tilbud|last minute|weekend|rental rooms/i.test(p.title),
};
const SAMPLE_MONTHS = 12;
const STOP_AFTER_CLOSED = 2;

const text = (h: string): string => clean(h.replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' '));

/** Visible paragraphs of the page's <main>. */
export function fsrParagraphs(html: string): string[] {
  const a = html.indexOf('<main');
  const b = html.indexOf('</main>');
  const main = a >= 0 && b > a ? html.slice(a, b) : html;
  return [...main.matchAll(/<(p|h[1-4]|li)\b[^>]*>([\s\S]*?)<\/\1>/g)].map(m => text(m[2])).filter(Boolean);
}

/** JSON-LD Place geo ("latitude":"55.174466","longitude":" 12.101196"). */
export function parseFsrGeo(html: string): { lat: number; lng: number } | null {
  for (const p of ldOfType(html, 'Place')) {
    const g = p.geo as Record<string, unknown> | undefined;
    const lat = Number(String(g?.latitude ?? '').trim());
    const lng = Number(String(g?.longitude ?? '').trim());
    if (Number.isFinite(lat) && Number.isFinite(lng) && lat && lng) return { lat, lng };
  }
  return null;
}

export interface FsrUnit { name: string; url: string; facts: string[]; description: string | null }

/** Rental unit cards of /en/accomodation/ (cabins, glamping, rental caravans, holiday houses); pitches and other sections skipped. */
export function parseFsrUnits(html: string): FsrUnit[] {
  const heads = [...html.matchAll(/<h3[^>]*class="elementor-heading-title[^"]*"[^>]*>\s*<a href="([^"]+)">([\s\S]*?)<\/a>\s*<\/h3>/g)];
  const out: FsrUnit[] = [];
  heads.forEach((h, i) => {
    const url = h[1];
    if (!/\/accommodation\/(?:cabins\/|concept-holiday-houses\/|spa-glamping|glamping|spa-rental|camp-let)/.test(url)) return;
    const seg = html.slice(h.index!, heads[i + 1]?.index ?? html.length);
    const facts = [...seg.matchAll(/<span class="elementor-icon-list-text">([\s\S]*?)<\/span>/g)].map(m => text(m[1])).filter(Boolean);
    const p = seg.match(/elementor-widget-text-editor[\s\S]*?<p>([\s\S]*?)<\/p>/)?.[1];
    const name = text(h[2]);
    if (out.some(u => u.name === name)) return;
    out.push({ name, url, facts, description: p ? text(p) : null });
  });
  return out;
}

export interface FsrKite { spot: string | null; ownGear: boolean; annualPass: string | null; school: string | null; courses: string[] }

export function parseFsrKite(html: string): FsrKite {
  const ps = fsrParagraphs(html);
  const courses: string[] = [];
  const head = (re: RegExp) => ps.findIndex(x => re.test(x));
  for (const [re, label] of [[/^Private course 1: ?1/i, 'Private course 1:1'], [/course 2 people/i, 'Course for 2 people']] as const) {
    const i = head(re);
    if (i >= 0 && /hours/.test(ps[i + 1] ?? '')) courses.push(`${label}: ${ps[i + 1].replace(/ (\d+ hours)/g, ', $1')}`);
  }
  return {
    spot: ps.find(x => /^In westerly winds/i.test(x)) ?? null,
    ownGear: ps.some(x => /must bring your own equipment/i.test(x)),
    annualPass: ps.find(x => /^Annual pass/i.test(x))?.match(/Annual pass: (\d[\d.]*)/)?.[1] ?? null,
    school: ps.find(x => /collaborates with Kitekollektivet/i.test(x)) ?? null,
    courses,
  };
}

export interface FsrPages { home: string; kite: string; units: string }

export function parseFeddetContent(p: FsrPages): OfferContent {
  const units = parseFsrUnits(p.units);
  const kite = parseFsrKite(p.kite);
  const geo = parseFsrGeo(p.home);
  const home = fsrParagraphs(p.home);
  const intro = home.find(x => /Denmark’s most cozy|close to Copenhagen/i.test(x)) ?? null;
  const rooms: ContentRoom[] = units.map(u => ({ name: u.name, description: u.description, features: u.facts }));

  const imgs: string[] = [];
  const kiteImgs = imageCandidates(p.kite, FSR_KITE_URL, null, 80).filter(u => /kite-surfing-feddet-\d+\.jpg$/.test(u) && /\/uploads\/20\d\d\//.test(u));
  const unitImgs = imageCandidates(p.units, FSR_UNITS_URL, null, 120).filter(u => /\/wp-content\/uploads\//.test(u) && !/flags|logo|icon|\.svg|\.png$/i.test(u));
  // interleave: kite photos first, then up to two photos per unit type (Elementor thumbs are grouped per unit slider)
  const perUnit = new Map<string, number>();
  for (const u of kiteImgs.slice(0, 8)) if (!imgs.includes(u)) imgs.push(u);
  for (const u of unitImgs) {
    const k = (u.split('/').pop() ?? '').replace(/-\d+(?:-\d+)?-[a-z0-9]{20,}\.jpg$|-\d+\.jpg$/i, '');
    const n = perUnit.get(k) ?? 0;
    if (n >= 2 || imgs.includes(u)) continue;
    perUnit.set(k, n + 1);
    imgs.push(u);
  }

  const summary = [
    'Feddet Strand Resort is a five-star camping and holiday resort on the Feddet peninsula near Faxe in South Zealand, Denmark, between Faxe Bay and Præstø Fjord and about an hour from Copenhagen; cabins and holiday houses are rented all year.',
    `Its ${units.length || 15} rental unit types range from Comfort and Spa Lodges, spa mobile homes and glamping tents to rental caravans, beach houses and a 120 m² spa villa; prices are set day by day in the online booking.`,
    `Kitesurfers ride from the small beach at Fed harbour on the shallow Præstø Fjord in westerly winds or from the beach on Faxe Bay in easterly winds, with their own gear and a day or annual pass${kite.school ? ', and the resort works with the kite school Kitekollektivet for private and group courses' : ''}.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Feddet Strand Resort',
    summary,
    continent: 'Europe',
    country: 'Denmark',
    region: 'Feddet, South Zealand',
    spot: 'Feddet',
    ...(geo ? { spotCoords: geo } : {}),
    spotCoordsPrecise: true,
    itinerarySpots: [],
    durationDays: null,
    // kite page: "The fjord around Feddet is very shallow – so the place is good for beginners."
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: kite.school ? true : null,
    equipmentRental: null,
    beginnerFriendly: true,
    includedServices: ['Pool & Spa, play area and fitness centre', 'Showers, hot water and Wi-Fi'],
    optionalServices: [
      ...kite.courses.map(c => `Kitekollektivet ${c}`),
      'Kite spot day pass (charged per hour, max 4 hours)',
      ...(kite.annualPass ? [`Kite spot annual pass DKK ${kite.annualPass}`] : []),
      'Restaurants, bistro, pizza and burger bar', 'Kayak, bike and SUP activities',
    ],
    accommodation: 'lodges, mobile homes, glamping tents, rental caravans and holiday houses on a holiday resort',
    mealPlan: 'self_catering',
    languages: ['da', 'en', 'de'],
    rooms,
    imageUrls: imgs.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: FSR_KITE_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      `home: ${intro ?? ''}`,
      `kite spot: ${kite.spot ?? ''}${kite.ownGear ? ' | To Kitesurf, you must bring your own equipment.' : ''}${kite.annualPass ? ` | Annual pass: ${kite.annualPass} DKK` : ''}`,
      `kite school: ${kite.school ?? ''} | ${kite.courses.join(' | ')}`,
      `units: ${units.map(u => `${u.name} (${u.facts.join(', ')})`).join('; ')}`,
    ].join('\n'),
  };
}

/**
 * Engine unit -> content room (unit card of /en/accomodation/) where the names differ; each engine price is for that one
 * unit. "Vacation Home Elvira" has no card and stays unlinked; "Spa Glamping Tent" and "Spa villa" match by name.
 */
export const FSR_ROOMS: Record<string, string> = {
  "Lark's cabin": 'Larchcabin',
  'Spa mobile home': 'Spa Mobilehome',
  'Comfort Lodge without pets': 'Pet-free Comfort Lodge',
  'Rental Camp-Let tent trailer': 'Camp-Let tent rental trailer',
  'Luxury Glamping Tent': 'Glamping tent', // the only glamping tent without spa on both sides
  'The holiday home Paradiso': 'The Beach House Paradiso',
  'Caroline Holiday House': 'The Beach House Caroline',
  'Amalie Holiday House': 'The Beach House Amalie',
  'Vacation rentals Thalia': 'Holiday house Thalia',
  'Olivia Ocean Suite': 'The Olivia Ocean Suite',
};

export async function fetchFsrSlots(today: string, ctx: FetchContext): Promise<Slot[]> {
  // open all year: one season window covering the sampling horizon
  const checkIns = csobSaturdaySamples(today, [{ start: today, end: csobAddDays(today, 400) }], { horizonMonths: SAMPLE_MONTHS, max: SAMPLE_MONTHS });
  return csobRooms(csobSlots(await fetchCsobSamples(FSR_PORTAL, checkIns, ctx, 7, STOP_AFTER_CLOSED), ctx), FSR_ROOMS);
}

export const feddetStrandResort: OfferAdapter = {
  key: 'feddet-strand-resort',
  name: 'Feddet Strand Resort',
  kind: 'accommodation',
  operator: {
    name: 'Feddet Strand Resort',
    websiteUrl: SITE,
    rootDomain: 'feddet.dk',
    contactEmail: 'info@feddet.dk',
    phone: '+4556725206',
  },
  url: FSR_KITE_URL,
  slotMethod: 'booking_engine',
  instantBooking: true,
  liveAvailability: true,
  fetchBudget: 27,
  async fetchContent() {
    const home = await fetchText(FSR_HOME_URL, { accept: 'text/html' });
    const kite = await fetchText(FSR_KITE_URL, { accept: 'text/html' });
    const units = await fetchText(FSR_UNITS_URL, { accept: 'text/html' });
    if (!/Kitekollektivet|kitesurf/i.test(kite)) throw new Error('feddet: kitesurfing page without kite text (moved?)');
    return parseFeddetContent({ home, kite, units });
  },
  async fetchSlots(ctx) {
    return fetchFsrSlots(todayIso(), ctx);
  },
};
