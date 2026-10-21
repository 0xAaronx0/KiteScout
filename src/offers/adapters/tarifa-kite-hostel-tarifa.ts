// ---------------------------------------------------------------------------
// Tarifa Kite Hostel, Tarifa (Cadiz, Andalusia, Spain) - hostel in the old town (Calle Maria Coronel) with 7 mixed
// dorms of 4-10 beds, kitchen, garden bar, two terraces and space for kite gear; kite courses with the partner
// school MYSFIT (NORTH equipment) and kite rental booked through the hostel. Found via bstoked listing 7122 ("Kite
// Hostel", Tarifa) - bstoked is a hint only, nothing is read from it.
//
// Data path (checked 2026-10-12): WordPress (YOOtheme, WPML), English pages under /en/.
//   content  /en/ (hostel, activities, map link), /en/rooms/ (7 dorms + house rules, cancellation policy),
//            /en/services/ (facilities), /en/kitesurfing-courses-in-tarifa/ (MYSFIT course tables, EUR per person).
//   slots    none: the site prints no bed or room prices. Booking is by phone, WhatsApp, a contact form or an
//            online-booking pop-up whose script sits under robots-disallowed paths (/wp-, /*?) -> not read.
//            fetchSlots returns [] ("price on request") without a request.
// Liveness (rule 5b, Aaron 2026-10-12): sitemap index (sitemaps.xml) lists page-sitemap1.xml with lastmod
//   2026-07-23 (a 2026 site edit); kite course prices on the page.
// robots.txt (2026-10-12): disallows /wp-, /wp-content/ (except uploads), /*?, *.js, *.css - the /en/ pages are
//   allowed.
// Requests per run: content 4, slots 0.
// Map pin: the site's own Google Maps place link ("Tarifa Kite Hostel ... Maria Coronel, 9", !2d36.0150751
//   !1d-5.6036117).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, imageCandidates, parse } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.tarifakitehostel.com';
export const TKH_HOME_URL = `${SITE}/en/`;
export const TKH_ROOMS_URL = `${SITE}/en/rooms/`;
export const TKH_SERVICES_URL = `${SITE}/en/services/`;
export const TKH_KITE_URL = `${SITE}/en/kitesurfing-courses-in-tarifa/`;

export interface TkhDorm { name: string; beds: number | null; text: string }
export interface TkhCourse { name: string; options: string[] }

function mainText(html: string): string {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, svg, header, footer, nav')) el.remove();
  return collapse((root.querySelector('main') ?? root.querySelector('#tm-main') ?? root.querySelector('body') ?? root).text);
}

// --- pure parsers -------------------------------------------------------------------------------------
/** /en/rooms/: "01 Room 01 8 person shared mixed room. Spacious and sunny, south-facing. Book now Contact". */
export function parseTkhDorms(html: string): TkhDorm[] {
  const t = mainText(html);
  const out: TkhDorm[] = [];
  for (const m of t.matchAll(/\b0?(\d) Room 0?\1 (.+?) Book now Contact/g)) {
    const text = collapse(m[2]);
    const beds = text.match(/(\d+)\s*(?:person|people|bed|plazas)/i)?.[1];
    const name = `Room ${m[1].padStart(2, '0')}`;
    if (!out.some(d => d.name === name)) out.push({ name, beds: beds ? Number(beds) : null, text });
  }
  return out;
}

/** "Check IN/OUT ... No Show will be charged 100%." block under the rooms. */
export function parseTkhRules(html: string): string | null {
  return mainText(html).match(/Check IN\/OUT – .+?No Show will be charged 100%\./)?.[0] ?? null;
}

/** Kite course sections, separated by "Back to Menu": "<Name> 1 Kite / 1 Person / 2 hours ... 1 Day2 hours150€* ...".
 *  The DOM text joins table cells without spaces, hence the \s* between the cells. */
export function parseTkhCourses(html: string): TkhCourse[] {
  const out: TkhCourse[] = [];
  for (const part of mainText(html).split('Back to Menu')) {
    const head = part.match(/\b(Private|Semi-Private A|Semi-Private B|Group|Advance)\s+(\d+ Kites? \/ [\d/]+ (?:Person|People) \/ \d+ hours)/i);
    if (!head) continue;
    const options = [...part.matchAll(/(\d+)\s*(?:Days?|Días)\s*(\d+)\s*(?:hours|horas)\s*(\d+)€/gi)]
      .map(o => `${o[1]} day${o[1] === '1' ? '' : 's'} / ${o[2]} h: EUR ${o[3]}`);
    const name = head[1] === 'Advance' ? 'Advanced' : head[1];
    const basis = /calculated for 2 people/i.test(part) ? ' (for 2 people)' : ' per person';
    if (options.length && !out.some(c => c.name === name)) out.push({ name: `${name} (${head[2]})`, options: options.map(o => o + basis) });
  }
  return out;
}

/** The site's Google Maps place link: ...!1d<lng>!2d<lat> (destination of the directions link). */
export function parseTkhCoords(html: string): { lat: number; lng: number } | null {
  const m = html.match(/google\.com\/maps\/dir\/\/Tarifa\+Kite\+Hostel[^"]*?!1d(-?\d+\.\d+)!2d(-?\d+\.\d+)/);
  return m ? { lat: Number(m[2]), lng: Number(m[1]) } : null;
}

export interface TkhPages { home: string; rooms: string; services: string; kite: string }

export function parseTkhContent(p: TkhPages): OfferContent {
  const home = mainText(p.home);
  const services = mainText(p.services);
  const kite = mainText(p.kite);
  const dorms = parseTkhDorms(p.rooms);
  const rules = parseTkhRules(p.rooms);
  const courses = parseTkhCourses(p.kite);
  const beds = dorms.reduce((n, d) => n + (d.beds ?? 0), 0);
  const sizes = dorms.map(d => d.beds).filter((b): b is number => b !== null);

  const rooms: ContentRoom[] = dorms.map(d => ({
    name: d.name,
    description: d.text,
    features: ['Shared mixed dorm', ...(d.beds ? [`${d.beds} beds`] : []), 'Individual security locker', 'Bathrooms outside the room', 'Linen included'],
  }));

  const seen = new Set<string>();
  const imageUrls: string[] = [];
  for (const u of [...imageCandidates(p.home, TKH_HOME_URL, null, 40), ...imageCandidates(p.rooms, TKH_ROOMS_URL, null, 30), ...imageCandidates(p.services, TKH_SERVICES_URL, null, 30)]) {
    if (/logo|qr-|icon|flags?\/|tortuga|mapa-localizacion|\.svg|\.png$/i.test(u)) continue;
    const k = u.replace(/-\d+x\d+(?=\.[a-z]+$)|-[0-9a-f]{8}(?=\.[a-z]+$)/i, '').replace(/^https:\/\/[^/]+\/wp-content\/uploads\/(?:yootheme\/cache\/[0-9a-f]{2}\/)?/, '');
    if (seen.has(k)) continue;
    seen.add(k); imageUrls.push(u);
  }

  const summary = [
    `Tarifa Kite Hostel is a hostel in the old town of Tarifa, Spain, about a minute's walk from the centre and five minutes from the beach, with ${dorms.length || 7} shared mixed dorms of ${sizes.length ? `${Math.min(...sizes)} to ${Math.max(...sizes)}` : '4 to 10'} beds${beds ? ` (${beds} beds in total)` : ''}, individual lockers and shared bathrooms.`,
    `Guests share a full kitchen, a living room with fireplace, a garden with a bar and space for kite equipment, and two terraces looking over the Strait of Gibraltar; breakfast is not included.`,
    `Kite courses with the partner school MYSFIT (NORTH equipment) and kite rental are booked through the hostel; rooms are booked by phone, WhatsApp or the booking form.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Tarifa Kite Hostel',
    summary,
    continent: 'Europe',
    country: 'Spain',
    region: 'Andalusia',
    spot: 'Tarifa',
    spotCoords: parseTkhCoords(p.home),
    itinerarySpots: [],
    durationDays: null,
    skillLevels: ['beginner', 'intermediate', 'advanced'], // private / semi-private / group / advanced courses
    kiteLessons: courses.length > 0 || /kitesurfing course/i.test(kite),
    equipmentRental: /Kitesurfing Equipment Rental/i.test(home + services),
    beginnerFriendly: true,
    includedServices: ['Bed linen', 'Free Wi-Fi', 'Kitchen', 'Individual security locker', 'Space for kite equipment'],
    optionalServices: [
      ...courses.map(c => `Kite course (MYSFIT) ${c.name}: ${c.options.join('; ')}`),
      'Kitesurfing equipment rental',
      'Wing foil, windsurf, surf and paddle courses; scuba diving; whale watching',
      'Airport transportation',
      'Towel, hair dryer and bicycle rental',
    ],
    accommodation: 'hostel with shared mixed dorms',
    mealPlan: 'self_catering',
    languages: [],
    rooms,
    imageUrls: imageUrls.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: TKH_HOME_URL,
    bookingUrl: `${SITE}/en/contact/`,
    sourceText: [
      `home: ${home}`,
      `rooms: ${dorms.map(d => `${d.name}: ${d.text}`).join(' | ')}`,
      `rules: ${rules ?? '-'}`,
      `services: ${services}`,
      `kite courses: ${courses.map(c => `${c.name}: ${c.options.join(', ')}`).join(' | ')}`,
    ].join('\n'),
  };
}

export const tarifaKiteHostelTarifa: OfferAdapter = {
  key: 'tarifa-kite-hostel-tarifa',
  name: 'Tarifa Kite Hostel',
  kind: 'accommodation',
  disciplines: ['kitesurf', 'wingfoil'],
  operator: {
    name: 'Tarifa Kite Hostel',
    websiteUrl: SITE,
    rootDomain: 'tarifakitehostel.com',
    contactEmail: 'info@tarifakitehostel.com', // site footer, 2026-10-12
    whatsapp: '+34618959571',
    phone: '+34618959571',
  },
  url: TKH_HOME_URL,
  slotMethod: 'price_table', // the site prints no bed prices: always [] (price on request)
  fetchBudget: 4,
  confidence: 'medium',
  async fetchContent() {
    const home = await fetchText(TKH_HOME_URL, { accept: 'text/html' });
    const rooms = await fetchText(TKH_ROOMS_URL, { accept: 'text/html' });
    const services = await fetchText(TKH_SERVICES_URL, { accept: 'text/html' });
    const kite = await fetchText(TKH_KITE_URL, { accept: 'text/html' });
    return parseTkhContent({ home, rooms, services, kite });
  },
  async fetchSlots(ctx): Promise<Slot[]> {
    ctx.note('no bed or room prices on tarifakitehostel.com; the booking pop-up script is robots-disallowed: price on request');
    return [];
  },
};
