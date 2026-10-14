// ---------------------------------------------------------------------------
// Casa Nomade (Nomade do Kite), Ilha do Guajiru (Itarema, Ceara, Brazil) - beachfront kite camp on the Guajiru
// flat-water lagoon with its own kite & wing school, beach service and launch assistance (Nomade Praia), pool,
// La Barca restaurant, yoga; rooms Mirante, Jardim, Por do sol and Familiar (up to 6), breakfast included.
// Found via bstoked listing 6816 (hint only: YouTube "Nomade Kite Camp - Ilha do Guajiru" by the channel
// "Nomade do Kite"); nothing is read from bstoked.
//
// Data path (checked 2026-10-12): WordPress (Yoast JSON-LD), English pages.
//   content  / (camp, school, downwinds, restaurants) and /casa-nomade-ilha-do-guajiru/ (rooms, inclusions).
//   slots    none: the site prints no prices. "Book now" opens the HBook engine (hbook.hsystem.com.br/Booking
//            ?companyId=6628ff64144d98c2f8a66784), whose robots.txt disallows /Booking -> not read.
//            fetchSlots returns [] ("price on request") without a request.
// Liveness (rule 5b, Aaron 2026-10-12): Yoast WebPage dateModified 2026-09-01 (home) and 2026-04-23 (Casa Nomade
//   page); restaurant opening hours on the home page.
// robots.txt (2026-10-12): disallows only /wp-content/plugins/ and /wp-content/themes/.
// Requests per run: content 2, slots 0.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, imageCandidates, ldOfType, parse } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://nomadedokite.com';
export const NOMADE_HOME_URL = `${SITE}/`;
export const NOMADE_CASA_URL = `${SITE}/casa-nomade-ilha-do-guajiru/`;
const BOOKING_URL = 'https://hbook.hsystem.com.br/Booking?companyId=6628ff64144d98c2f8a66784';
const ROOM_NAMES = ['Mirante', 'Jardim', 'Por do sol', 'Familiar'];

function mainText(html: string): string {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, svg, header, footer, nav')) el.remove();
  return collapse((root.querySelector('main') ?? root.querySelector('body') ?? root).text);
}

// --- pure parsers -------------------------------------------------------------------------------------
/** Room cards: "<Name> <one-line description> Book now!" (the slider repeats them; first occurrence wins). */
export function parseNomadeRooms(html: string): ContentRoom[] {
  const t = mainText(html);
  const out: ContentRoom[] = [];
  for (const name of ROOM_NAMES) {
    const m = t.match(new RegExp(`\\b${name} ([A-Z][^!]*?\\.)\\s*Book now!`));
    if (!m) continue;
    const description = collapse(m[1]);
    const guests = description.match(/up to (\d+)/i)?.[1];
    out.push({ name, description, features: [...(guests ? [`Up to ${guests} guests`] : []), 'Breakfast', 'Air conditioning', 'Hot water', 'Kite equipment storage'] });
  }
  return out;
}

/** "Your stay includes: Daily breakfast ... Organized transfers to the best kite spots" */
export function parseNomadeIncludes(html: string): string[] {
  const block = mainText(html).match(/Your stay includes: (.+?) Mirante /)?.[1] ?? '';
  const known = ['Daily breakfast', 'Air conditioning and hot water', 'Storage space for your kite equipment', 'Stable Wi-Fi in common areas', 'Accommodation options for couples, families, or groups', 'Organized transfers to the best kite spots'];
  return known.filter(k => block.includes(k));
}

export interface NomadePages { home: string; casa: string }

export function parseNomadeContent(p: NomadePages): OfferContent {
  const home = mainText(p.home);
  const casa = mainText(p.casa);
  const rooms = parseNomadeRooms(p.casa);
  const includes = parseNomadeIncludes(p.casa);
  const modified = [p.home, p.casa].map(h => (ldOfType(h, 'WebPage')[0]?.dateModified as string | undefined) ?? '?');

  const seen = new Set<string>();
  const imageUrls: string[] = [];
  for (const u of [...imageCandidates(p.casa, NOMADE_CASA_URL, null, 40), ...imageCandidates(p.home, NOMADE_HOME_URL, null, 40)]) {
    if (/favicon|logo|icon|\.svg|flag|cropped-/i.test(u)) continue;
    const k = u.replace(/-\d+x\d+(?=\.[a-z]+$)|-scaled(?=\.[a-z]+$)/i, '');
    if (seen.has(k)) continue;
    seen.add(k); imageUrls.push(u);
  }

  const summary = [
    'Casa Nomade is the beachfront kite camp of Nomade do Kite on the flat-water lagoon of Ilha do Guajiru in Ceara, Brazil, with its own kite and wing school, beach service and launch assistance at Nomade Praia, and transfers to other kite spots nearby.',
    `Guests stay in ${rooms.length || 4} room types (Mirante, Jardim, Por do sol and a family room for up to 6) with breakfast, air conditioning and kite storage; there is a pool, a restaurant (La Barca), yoga and functional training.`,
    'Nomade do Kite also runs downwinders of up to 500 km along the north-east coast; prices are given on request through the booking engine.',
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Casa Nomade (Nomade do Kite)',
    summary,
    continent: 'South America',
    country: 'Brazil',
    region: 'Ceara',
    spot: 'Ilha do Guajiru',
    spotCoords: null,
    itinerarySpots: [],
    durationDays: null,
    skillLevels: ['beginner', 'intermediate', 'advanced'], // "guide beginners, intermediates and advanced riders"
    kiteLessons: /Kitesurf lessons/i.test(home),
    equipmentRental: null,
    beginnerFriendly: true,
    includedServices: includes.length ? includes : ['Daily breakfast', 'Storage space for your kite equipment'],
    optionalServices: ['Kite and wing foil lessons (beginner to advanced)', 'Downwinders and kite trips in north-east Brazil', 'Yoga, functional training, massage', 'Restaurants La Barca and Nomade Praia'],
    accommodation: 'kite camp rooms by the lagoon',
    mealPlan: 'breakfast',
    languages: [],
    rooms,
    imageUrls: imageUrls.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: NOMADE_CASA_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [`home (dateModified ${modified[0]}): ${home}`, `casa nomade (dateModified ${modified[1]}): ${casa}`].join('\n'),
  };
}

export const casaNomadeIlhaDoGuajiru: OfferAdapter = {
  key: 'casa-nomade-ilha-do-guajiru',
  name: 'Casa Nomade (Ilha do Guajiru)',
  kind: 'accommodation',
  operator: {
    name: 'Nomade do Kite',
    websiteUrl: SITE,
    rootDomain: 'nomadedokite.com',
  },
  url: NOMADE_CASA_URL,
  slotMethod: 'price_table', // no prices on the site, engine robots-disallowed: always [] (price on request)
  instantBooking: true,
  fetchBudget: 2,
  confidence: 'medium',
  async fetchContent() {
    const home = await fetchText(NOMADE_HOME_URL, { accept: 'text/html' });
    const casa = await fetchText(NOMADE_CASA_URL, { accept: 'text/html' });
    return parseNomadeContent({ home, casa });
  },
  async fetchSlots(ctx): Promise<Slot[]> {
    ctx.note('no prices on nomadedokite.com; the HBook engine path /Booking is robots-disallowed: price on request');
    return [];
  },
};
