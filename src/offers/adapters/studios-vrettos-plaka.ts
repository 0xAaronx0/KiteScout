// ---------------------------------------------------------------------------
// Studios Vrettos, Plaka beach (Naxos, Greece) - family-run beachfront hotel with studios and apartments
// (breakfast included) and its own IKO kite center; guests booking a stay get a lesson discount.
//
// Data path (checked 2026-10-12): WordPress/Elementor, server-rendered.
//   content  / (hotel, family, beach, rooftop bar, room types summary), /accommodation/ (5 unit types:
//            "Max 2 persons / ground floor / 30 sq.m" + beds and equipment, room photos),
//            /kitesurfing/ (IKO courses, rescue boat, private / semi-private / advanced hourly prices).
//   slots    none. "BOOK ONLINE" / "Check Availability" open go.resrv.direct/booking.php?propid=98762
//            (robots.txt: "User-agent: *" only Crawl-delay 5), which answered "service unavailable,
//            please try again later" (HTTP 200, 43 bytes) to our UA twice on 2026-10-12 -> treated as
//            unavailable to us; the own site prints no room prices -> fetchSlots returns [] ("price on
//            request"). Lesson prices (EUR per hour) go into the content, not slots.
// 2026 signal: "© 2026 Studios Vrettos"; pages modified 2026-01-10 (accommodation) and 2026-02-28 (home)
//   per the site's WP REST API; no dated season or room rate.
// robots.txt (2026-10-12): studiosvrettos.com Yoast default (www. redirects to the bare domain).
// Requests per run: content 3, slots 0.
// Known limits: no prices or availability until the booking engine answers or the hotel shares a feed.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, imageCandidates, parse } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://studiosvrettos.com';
export const VRETTOS_HOME_URL = `${SITE}/`;
const ROOMS_URL = `${SITE}/accommodation/`;
const KITE_URL = `${SITE}/kitesurfing/`;
const BOOKING_URL = 'https://go.resrv.direct/booking.php?propid=98762';

export interface VrettosUnit { name: string; maxGuests: number; floor: string; sqm: number; features: string[] }
export interface VrettosLesson { name: string; detail: string; pricePerHour: number }

function blocks(html: string): string[] {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, svg, header, footer, nav')) el.remove();
  const out: string[] = [];
  for (const el of root.querySelectorAll('h1, h2, h3, h4, p, li')) {
    const t = collapse(el.text);
    if (t && out[out.length - 1] !== t && !/This site uses cookies/i.test(t)) out.push(t);
  }
  return out;
}

/** Unit cards: name, then "Max N persons / <floor> / NN sq.m", then short feature lines. */
export function parseVrettosUnits(html: string): VrettosUnit[] {
  const bs = blocks(html);
  const out: VrettosUnit[] = [];
  bs.forEach((b, i) => {
    const m = b.match(/^Max (\d+) persons? \/ (.+?) \/ (\d+) ?sq\.? ?m\.?$/i);
    if (!m || i === 0) return;
    const features: string[] = [];
    for (let j = i + 1; j < bs.length; j++) {
      if (bs[j].length > 60 || /^Max \d+ persons?/i.test(bs[j + 1] ?? '')) break;
      features.push(bs[j]);
    }
    out.push({ name: bs[i - 1], maxGuests: Number(m[1]), floor: m[2].replace(/ floor floor$/i, ' floor'), sqm: Number(m[3]), features });
  });
  return out;
}

/** Hourly lesson prices on /kitesurfing/: blocks "Private Course", "*1 person with 1 instructor, ...", "80€/h". */
export function parseVrettosLessons(html: string): VrettosLesson[] {
  const bs = blocks(html);
  const out: VrettosLesson[] = [];
  bs.forEach((b, i) => {
    const m = b.match(/^(\d+)\s*€\s*\/\s*h$/);
    if (!m) return;
    let name: string | null = null;
    let detail = '';
    for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
      if (bs[j].startsWith('*')) detail = bs[j].replace(/^\*\s*/, '');
      else if (/(Course|Lessons?)$/i.test(bs[j])) { name = bs[j]; break; }
    }
    if (name) out.push({ name, detail, pricePerHour: Number(m[1]) });
  });
  return out;
}

export interface VrettosPages { home: string; rooms: string; kite: string }

export function parseVrettosContent(p: VrettosPages): OfferContent {
  const home = blocks(p.home);
  const kite = blocks(p.kite);
  const units = parseVrettosUnits(p.rooms);
  const lessons = parseVrettosLessons(p.kite);
  const homeText = home.join(' ');
  const years = homeText.match(/over (\d+) years of expertise/)?.[1] ?? null;
  const rooftop = home.find(b => /opens for sunset/i.test(b)) ?? null;
  const iko = kite.find(b => /certified by IKO/i.test(b)) ?? '';
  const sizes = units.map(u => u.sqm);

  const contentRooms: ContentRoom[] = units.map(u => ({
    name: u.name,
    description: `Up to ${u.maxGuests} guests, ${u.floor}, ${u.sqm} m2.`,
    features: u.features,
  }));

  const seen = new Set<string>();
  const imageUrls: string[] = [];
  for (const [html, base] of [[p.rooms, ROOMS_URL], [p.home, VRETTOS_HOME_URL], [p.kite, KITE_URL]] as const) {
    for (const u of imageCandidates(html, base, null, 80)) {
      if (!/\/wp-content\/uploads\//.test(u) || /logo|icon|\.svg|\.png$/i.test(u)) continue;
      const k = u.replace(/-(?:\d+x\d+|scaled)(?=\.[a-z]+$)/i, '');
      if (seen.has(k)) continue;
      seen.add(k); imageUrls.push(u);
    }
  }

  const summary = [
    `Studios Vrettos is a beachfront hotel at Plaka beach on Naxos, Greece, run by a local family${years ? ` with over ${years} years in hospitality` : ''}, with a private path to the beach and a rooftop bar.`,
    `It offers ${units.length || 5} types of studios and apartments (${sizes.length ? `${Math.min(...sizes)}-${Math.max(...sizes)} m2, ` : ''}for 2 to ${units.length ? Math.max(...units.map(u => u.maxGuests)) : 5} guests) with a kitchen, air conditioning and a private balcony, breakfast included.`,
    `Its own kite center teaches IKO-certified courses, from beach kite control to riding, with a rescue boat on standby${lessons.length ? ` (private lessons EUR ${lessons.find(l => /private course/i.test(l.name) && !/semi/i.test(l.name))?.pricePerHour ?? lessons[0].pricePerHour} per hour)` : ''}, and gives a discount to guests who book their accommodation with the hotel.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Studios Vrettos',
    summary,
    continent: 'Europe',
    country: 'Greece',
    region: 'Cyclades',
    spot: 'Plaka, Naxos',
    itinerarySpots: [],
    durationDays: null,
    // /kitesurfing/: "Beginner to advanced we got you covered" (2026-10-12)
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: lessons.length > 0 || /kitesurfing plans/i.test(kite.join(' ')),
    equipmentRental: null, // lessons include gear; the site lists no separate rental
    beginnerFriendly: /At the beginning, you will learn flying the kite/i.test(kite.join(' ')),
    includedServices: ['Breakfast with local products', 'Air conditioning', 'Kitchen in every unit'],
    optionalServices: [
      ...lessons.map(l => `${l.name} (${l.detail}): EUR ${l.pricePerHour} per hour per person`),
      'Rooftop bar (sunset to 11 pm)',
    ],
    accommodation: 'beachfront studios and apartments',
    mealPlan: 'breakfast',
    languages: ['en'],
    rooms: contentRooms,
    imageUrls: imageUrls.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: ROOMS_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      `home: ${home.filter(b => b.length > 80).slice(0, 8).join(' | ')}`,
      `rooms: ${units.map(u => `${u.name}: max ${u.maxGuests}, ${u.floor}, ${u.sqm} sq.m; ${u.features.join(', ')}`).join(' || ')}`,
      `kite center: ${kite.filter(b => b.length > 60).slice(0, 8).join(' | ')}`,
      `lessons: ${lessons.map(l => `${l.name} ${l.detail} ${l.pricePerHour} EUR/h`).join('; ')}`,
      rooftop ? `rooftop bar: ${rooftop}` : '',
      iko ? `IKO: ${iko}` : '',
    ].filter(Boolean).join('\n'),
  };
}

export const studiosVrettosPlaka: OfferAdapter = {
  key: 'studios-vrettos-plaka',
  name: 'Studios Vrettos Plaka Naxos',
  kind: 'accommodation',
  operator: {
    name: 'Studios Vrettos',
    websiteUrl: SITE,
    rootDomain: 'studiosvrettos.com',
    contactEmail: 'info@studiosvrettos.com',
    phone: '+306976437007',
  },
  url: VRETTOS_HOME_URL,
  slotMethod: 'booking_engine',
  instantBooking: true,
  fetchBudget: 3,
  confidence: 'low',
  async fetchContent() {
    const home = await fetchText(VRETTOS_HOME_URL, { accept: 'text/html' });
    const rooms = await fetchText(ROOMS_URL, { accept: 'text/html' });
    const kite = await fetchText(KITE_URL, { accept: 'text/html' });
    return parseVrettosContent({ home, rooms, kite });
  },
  async fetchSlots(ctx): Promise<Slot[]> {
    ctx.note('no slot source: the booking engine (go.resrv.direct, propid 98762) answered "service unavailable" to our UA on 2026-10-12 and the site prints no room prices');
    return [];
  },
};
