// ---------------------------------------------------------------------------
// No 22 Riders' Inn, Akyaka (Gökova Bay, Muğla, Turkey) - 14-room inn with restaurant, bar and summer stage in the
// centre of Akyaka, built as a meeting point for kitesurfers; kite lessons and rental through "our school".
//
// Liveness (re-check 2026-10-12): guest reviews dated late May and mid-June 2026 on Trip.com (seen only as a
//   web-search summary - hint, not data); own site: pages edited 2025-07-17..2025-09-01 (WordPress REST
//   `modified`), 67 accommodation photos uploaded 2025-07, footer "2025". Verdict LIVE (summer 2026 with guests;
//   the strongest dated signal is a search snippet, the own site was last edited 2025-09).
// Data path (checked 2026-10-12): WordPress (Themify builder), English pages at no22ridersinn.com:
//   content  / (concept: hotel, restaurant, bar, stage), /accommodation/ (14 rooms, ROOMS + FACILITIES icon lists,
//            28 photos 2025-07), /activities/ (kiteboarding: 9-hour beginner course, advanced lessons, gear rental;
//            kayak/SUP, bikes, crossfit/yoga; #ridersinnstage summer programme), /contact/ (address + Google Maps
//            embed with the inn's coordinates).
//   slots    none: the site prints no prices ("To learn about our current seasonal prices ... please fill out our
//            contact form") and has no booking engine (contact form only). fetchSlots returns [] ("price on
//            request") without a request.
// robots.txt (2026-10-12): disallows only /wp-admin/.
// Requests per run: content 4, slots 0.
// Known limits: no room types on the site (one "Room" unit with the icon features); /sitemap.xml is a 2015-16
//   static sitemap of the old site (the live index is /wp-sitemap.xml).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, imageCandidates, parse } from '../parse.js';
import type { ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://no22ridersinn.com';
export const N22_HOME_URL = `${SITE}/`;
export const N22_ACCOMMODATION_URL = `${SITE}/accommodation/`;
export const N22_ACTIVITIES_URL = `${SITE}/activities/`;
export const N22_CONTACT_URL = `${SITE}/contact/`;

const LABELS: Record<string, string> = {
  'AIR CONDITION': 'Air conditioning', WIFI: 'Wi-Fi', 'HOT WATER': 'Hot water', 'HAIR DRYER': 'Hair dryer',
  PARKING: 'Parking', GARDEN: 'Garden', POOL: 'Pool', LAUNDRY: 'Laundry', RESTAURANT: 'Restaurant', BAR: 'Bar',
  SECURITY: 'Security', STORAGE: 'Storage', 'AIRPORT TRANSFER': 'Airport transfer',
};
const label = (s: string): string => LABELS[s] ?? s.toLowerCase().replace(/^./, c => c.toUpperCase());

// --- pure parsers -----------------------------------------------------------------------------
/** Icon lists under the <h1> ROOMS / FACILITIES headings (h3.image-title in document order). */
export function parseN22Icons(html: string): { rooms: string[]; facilities: string[] } {
  const out = { rooms: [] as string[], facilities: [] as string[] };
  let cur: 'rooms' | 'facilities' | null = null;
  for (const el of parse(html).querySelectorAll('h1, h3.image-title')) {
    const t = collapse(el.text).toUpperCase();
    if (el.tagName === 'H1') { cur = t === 'ROOMS' ? 'rooms' : t === 'FACILITIES' ? 'facilities' : null; continue; }
    if (cur && t && !out[cur].includes(label(t))) out[cur].push(label(t));
  }
  return out;
}

/** Google Maps embed "!2d<lng>!3d<lat>" on the contact page (the embed names "No22 Hotel Riders' Inn"). */
export function parseN22Coords(html: string): { lat: number; lng: number } | null {
  const m = html.match(/google\.com\/maps\/embed\?pb=[^"']*?!2d(-?\d+\.\d+)!3d(-?\d+\.\d+)[^"']*?No22/i);
  if (!m) return null;
  return { lat: Math.round(Number(m[2]) * 1e5) / 1e5, lng: Math.round(Number(m[1]) * 1e5) / 1e5 };
}

function paragraphs(html: string): string[] {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, svg, header, footer, form')) el.remove();
  const out: string[] = [];
  for (const el of root.querySelectorAll('h1, h2, h3, h4, p, li')) {
    const t = collapse(el.text);
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

export interface N22Pages { home: string; accommodation: string; activities: string; contact: string }

export function parseNo22Content(p: N22Pages): OfferContent {
  const home = paragraphs(p.home);
  const acc = paragraphs(p.accommodation);
  const act = paragraphs(p.activities);
  const icons = parseN22Icons(p.accommodation);
  const coords = parseN22Coords(p.contact);
  const address = paragraphs(p.contact).find(t => /SEFA SOKAK/i.test(t)) ?? null;
  const housing = acc.find(t => /^Located just .* Dalaman Airport/i.test(t)) ?? null;
  const pricesLine = acc.find(t => /current seasonal prices/i.test(t)) ?? null;
  const kite = act.find(t => /kiteboarding with \d+ hours beginner course/i.test(t)) ?? null;
  const focal = act.find(t => /KITEBOARD IS THE FOCAL POINT/i.test(t)) ?? null;
  const stage = act.find(t => /#ridersinnstage, performances/i.test(t)) ?? null;
  const concept = home.find(t => /^Akyaka has recently become/i.test(t)) ?? null;
  const nRooms = housing?.match(/offers (\d+) rooms/i)?.[1] ?? null;
  const airportMin = housing?.match(/(\d+) minutes from Dalaman Airport/i)?.[1] ?? null;
  const courseHours = kite?.match(/(\d+) hours beginner course/i)?.[1] ?? null;

  const rooms: ContentRoom[] = [{
    name: 'Room',
    description: `${nRooms ?? '14'} rooms at the inn in the centre of Akyaka, within walking distance of the Azmak river and the sea.`,
    features: icons.rooms,
  }];

  const seen = new Set<string>();
  const imageUrls: string[] = [];
  for (const u of imageCandidates(p.accommodation, N22_ACCOMMODATION_URL, null, 80)) {
    if (!/\/uploads\/.*\.jpe?g$/i.test(u)) continue;
    const full = u.replace(/-\d+x\d+(?=\.jpe?g$)/i, ''); // WordPress keeps the original next to the -WxH sizes
    if (seen.has(full)) continue;
    seen.add(full); imageUrls.push(full);
  }

  const summary = [
    `No 22 Riders' Inn is a ${nRooms ?? '14'}-room inn in the centre of Akyaka on Gökova Bay, Turkey, ${airportMin ?? '45'} minutes from Dalaman Airport and within walking distance of the Azmak river, the sea and the kite beach, built as a meeting point for kitesurfers and outdoor-sports guests.`,
    `Rooms have air conditioning, Wi-Fi and hot water; the inn has a garden, pool, restaurant, bar, laundry, storage, parking and airport transfers, and a stage with live music and DJ sets through the summer season.`,
    `Kiteboarding on the Gökova wind is its main sport: guests can take a ${courseHours ?? '9'}-hour beginner course or advanced lessons and rent kite gear, and rent kayaks and SUPs.`,
    'The site publishes no prices; current seasonal rates are given on request.',
  ].join(' ');

  return {
    kind: 'accommodation',
    title: "No 22 Riders' Inn",
    summary,
    continent: 'Asia', // Muğla province, Anatolia
    country: 'Turkey',
    region: 'Muğla',
    spot: 'Akyaka',
    ...(coords ? { spotCoords: coords } : {}),
    spotCoordsPrecise: true,
    itinerarySpots: [],
    durationDays: null,
    // /activities/: "9 hours beginner course, take advance lessons to improve your technique or rent kiteboard gears"
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: !!kite,
    equipmentRental: /rent kiteboard gears?/i.test(kite ?? ''),
    beginnerFriendly: !!courseHours,
    includedServices: [...icons.rooms, ...icons.facilities.filter(f => !icons.rooms.includes(f) && !/airport transfer|laundry|restaurant|^bar$/i.test(f))],
    optionalServices: [
      `Kiteboarding lessons (${courseHours ?? '9'}-hour beginner course, advanced lessons)`,
      'Kiteboard equipment rental',
      'Kayak and SUP rental',
      'Road and mountain bike tours (Dalyan-Gökova)',
      'Crossfit and yoga sessions in the garden',
      ...icons.facilities.filter(f => /airport transfer|laundry/i.test(f)),
      'Restaurant (#Momomeets22 kitchen) and bar with live music / DJ stage in summer',
    ],
    accommodation: `${nRooms ?? '14'}-room inn with restaurant and bar`,
    mealPlan: null,
    languages: ['en', 'tr'],
    rooms,
    imageUrls: imageUrls.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: N22_ACCOMMODATION_URL,
    bookingUrl: N22_CONTACT_URL,
    sourceText: [
      `home: ${concept ?? ''}`,
      `accommodation: ${housing ?? ''}`,
      `prices: ${pricesLine ?? ''}`,
      `rooms: ${icons.rooms.join('; ')}`,
      `facilities: ${icons.facilities.join('; ')}`,
      `activities: ${focal ?? ''} ${kite ?? ''}`,
      `stage: ${stage ?? ''}`,
      `address: ${address ?? ''}`,
      `map embed: ${coords ? `${coords.lat},${coords.lng}` : ''}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const no22RidersInnAkyaka: OfferAdapter = {
  key: 'no22-riders-inn-akyaka',
  name: "No 22 Riders' Inn Akyaka",
  kind: 'accommodation',
  operator: {
    name: "No 22 Riders' Inn",
    websiteUrl: SITE,
    rootDomain: 'no22ridersinn.com',
    contactEmail: 'hello@no22ridersinn.com',
    phone: '+905324200822',
  },
  url: N22_ACCOMMODATION_URL,
  slotMethod: 'price_table',
  fetchBudget: 4,
  confidence: 'low',
  async fetchContent() {
    const [home, accommodation, activities, contact] = [
      await fetchText(N22_HOME_URL, { accept: 'text/html' }),
      await fetchText(N22_ACCOMMODATION_URL, { accept: 'text/html' }),
      await fetchText(N22_ACTIVITIES_URL, { accept: 'text/html' }),
      await fetchText(N22_CONTACT_URL, { accept: 'text/html' }),
    ];
    return parseNo22Content({ home, accommodation, activities, contact });
  },
  async fetchSlots(ctx: FetchContext): Promise<Slot[]> {
    ctx.note('the site prints no prices ("contact us for current seasonal prices") and has no booking engine: offer stays "price on request"');
    return [];
  },
};
