// ---------------------------------------------------------------------------
// Hotel Arte Vida, Los Lances (Tarifa, Cadiz, Andalusia, Spain) - small beach hotel on the N-340 km 79.3 with direct
// access to Los Lances beach, restaurant, beach bar (chiringuito) and terrace. Kite link: the water-sports school
// Surf Center Tarifa sits in the hotel garden ("en el jardín del hotel se encuentra el Surf Center Tarifa, con cursos y
// alquiler de material durante todo el año"; its page on the hotel site offers kitesurf courses and kite rental).
//
// Data path (checked 2026-10-12): WordPress (Enfold), Spanish; the site was rebuilt in January/February 2026.
//   content  / (hotel, restaurant, chiringuito; Google Maps embed "Hotel Arte Vida Tarifa": !2d-5.6506 !3d36.0520 ->
//            spotCoords), /habitaciones/ (rooms, beach bar, Surf Center in the garden), /surf-center-tarifa/ (school).
//   slots    none. Rooms are requested through a form (/contacto-2/, "CONSULTA DE HABITACIONES", 1-3 double rooms),
//            e-mail or WhatsApp; there is no booking engine. An old year-less price page (/precios/, monthly double-room
//            rates, last edited 2025-03-29, "Semana Santa 22 al 30 de Marzo" = Holy Week 2024) is no longer linked from
//            the site -> not read. fetchSlots returns [] ("price on request") without a request.
// Liveness (rule 5b): sitemap lastmod 2026-02-11 (home), 2026-02-10 (/habitaciones/), 2026-03-27 (shop pages); the
//   photos are uploads of 2026/01.
// robots.txt (2026-10-12): WordPress/WooCommerce defaults (/wp-admin/, cart and upload log paths) - pages allowed.
// Requests per run: content 3, slots 0.
// Known limits: no prices, no room count or room types beyond "double room with private bathroom".
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, parse } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://hotelartevidatarifa.com';
export const AV_HOME_URL = `${SITE}/`;
export const AV_ROOMS_URL = `${SITE}/habitaciones/`;
export const AV_SCHOOL_URL = `${SITE}/surf-center-tarifa/`;
const REQUEST_URL = `${SITE}/contacto-2/`;

/** Visible text lines (scripts, styles, SVGs dropped), split at block tags. */
export function avLines(html: string): string[] {
  return html
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .split(/<\/?(?:p|li|td|th|tr|h\d|div|br|ul|section|a|button|figure|span)\b[^>]*>/i)
    .map(s => clean(s.replace(/<[^>]+>/g, ' ')))
    .filter(Boolean);
}

/** Site photos (<img src>, largest srcset entry), WordPress originals, JPEGs only, no logos / sponsors / review cards. */
export function avImages(html: string): string[] {
  const out: string[] = [];
  for (const img of parse(html).querySelectorAll('img')) {
    const set = (img.getAttribute('srcset') ?? '').split(/,\s*/).map(p => p.trim().split(/\s+/))
      .map(([u, w]) => ({ u, w: parseInt(w ?? '0', 10) || 0 })).filter(x => x.u).sort((a, b) => b.w - a.w)[0]?.u;
    const u = (set ?? img.getAttribute('src') ?? '').replace(/^http:/, 'https:').replace(/-\d{2,4}x\d{2,4}(?=\.jpe?g$)/i, '');
    if (!/^https:\/\/hotelartevidatarifa\.com\/wp-content\/uploads\/.+\.jpe?g$/i.test(u)) continue;
    if (/logo|icono|sponsor|opinion|artevida_high_res/i.test(u) || out.includes(u)) continue;
    out.push(u);
  }
  return out;
}

/** Google Maps embed of the footer: !2d<lng>!3d<lat>. */
export function avCoords(html: string): { lat: number; lng: number } | null {
  const m = html.match(/google\.com\/maps\/embed\?pb=[^"']*?!2d(-?\d+\.\d+)!3d(-?\d+\.\d+)[^"']*?Arte(?:%20|\s|\+)Vida/i);
  return m ? { lat: Number(m[2]), lng: Number(m[1]) } : null;
}

export interface AvPages { home: string; rooms: string; school: string }

export function parseArteVidaContent(p: AvPages): OfferContent {
  const home = avLines(p.home);
  const rooms = avLines(p.rooms);
  const school = avLines(p.school);
  const intro = home.find(l => /^Arte Vida es un lugar/i.test(l)) ?? '';
  const offer = home.find(l => /^Nuestro hotel reúne/i.test(l)) ?? '';
  const roomLines = rooms.filter(l => /^(Todas nuestras habitaciones|Cuentan con|Desde el hotel podrás|Además, en el jardín)/i.test(l));
  const garden = roomLines.find(l => /Surf Center Tarifa/i.test(l)) ?? '';
  const schoolText = school.find(l => /^En el mejor spot de Tarifa/i.test(l)) ?? '';
  const schoolDaily = school.find(l => /^Garantizan actividades/i.test(l)) ?? '';
  const schoolOffers = school.filter(l => /^(Cursos de Kitesurf|Alquiler de Kitesurf|Cursos de Windsurf|Alquiler de material de Windsurf)/i.test(l));
  const allLevels = school.some(l => /Spot fácil para todos los niveles|Clases para todos/i.test(l));
  const schoolPhone = school.join(' ').match(/Llámanos al (\+?[\d ]{9,})/)?.[1]?.trim() ?? null;

  const contentRooms: ContentRoom[] = [{
    name: 'Double room',
    description: 'Room with a double bed and private bathroom, a few steps from Los Lances beach; guests use the hotel terrace and beach bar.',
    features: ['Double bed', 'Private bathroom', 'Access to terrace and beach bar', 'Requested for 1 to 3 double rooms per enquiry'],
  }];

  const summary = [
    `Hotel Arte Vida is a beach hotel on the N-340 at Los Lances, Tarifa, with direct access to Los Lances beach, a restaurant, a beach bar facing the sea and a terrace.`,
    `Its rooms have a double bed and a private bathroom; stays are requested through the hotel's form, by e-mail or WhatsApp.`,
    `The Surf Center Tarifa school in the hotel garden runs kitesurf and windsurf courses for all levels all year, rents kite and windsurf equipment and keeps a rescue boat on the water.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Hotel Arte Vida',
    summary,
    continent: 'Europe',
    country: 'Spain',
    region: 'Los Lances, Tarifa',
    spot: 'Los Lances',
    spotCoords: avCoords(p.home) ?? avCoords(p.rooms),
    spotCoordsPrecise: true,
    itinerarySpots: [],
    durationDays: null,
    // school page: "Spot fácil para todos los niveles", "Clases para todos, todos los días!"
    skillLevels: allLevels ? ['beginner', 'intermediate', 'advanced'] : [],
    kiteLessons: schoolOffers.some(l => /Cursos de Kitesurf/i.test(l)),
    equipmentRental: schoolOffers.some(l => /Alquiler de Kitesurf/i.test(l)),
    beginnerFriendly: allLevels ? true : null,
    includedServices: ['Direct beach access', 'Terrace'],
    optionalServices: [
      'Kitesurf courses and kite rental (Surf Center Tarifa, in the hotel garden)',
      'Windsurf, SUP, surf and bodyboard courses and rental (Surf Center Tarifa)',
      'Restaurant',
      'Beach bar (Chiringuito Arte Vida)',
    ],
    accommodation: 'beach hotel rooms',
    mealPlan: null,
    languages: [],
    rooms: contentRooms,
    imageUrls: [...new Set([...avImages(p.home), ...avImages(p.rooms), ...avImages(p.school)])].slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: AV_HOME_URL,
    bookingUrl: REQUEST_URL,
    sourceText: [
      `home: ${intro} ${offer}`,
      `rooms: ${roomLines.join(' ')}`,
      `garden: ${garden}`,
      `school: ${schoolOffers.join(' | ')} | ${schoolText} ${schoolDaily}${schoolPhone ? ` | phone ${schoolPhone}` : ''}`,
    ].join('\n'),
  };
}

export const hotelArteVidaLosLances: OfferAdapter = {
  key: 'hotel-arte-vida-los-lances',
  name: 'Hotel Arte Vida',
  kind: 'accommodation',
  operator: {
    name: 'Hotel Arte Vida',
    websiteUrl: SITE,
    rootDomain: 'hotelartevidatarifa.com',
    contactEmail: 'reservas@hotelartevidatarifa.com',
    phone: '+34956685246',
    whatsapp: '+34659440926',
  },
  url: AV_HOME_URL,
  slotMethod: 'price_table', // no current prices on the site: always [] (price on request)
  fetchBudget: 3,
  confidence: 'medium',
  async fetchContent() {
    const home = await fetchText(AV_HOME_URL, { accept: 'text/html' });
    const rooms = await fetchText(AV_ROOMS_URL, { accept: 'text/html' });
    const school = await fetchText(AV_SCHOOL_URL, { accept: 'text/html' });
    return parseArteVidaContent({ home, rooms, school });
  },
  async fetchSlots(ctx): Promise<Slot[]> {
    ctx.note('no current prices on hotelartevidatarifa.com (rooms on request; the old /precios/ page is unlinked and dates from 2024/25): price on request');
    return [];
  },
};
