// ---------------------------------------------------------------------------
// Blue Dream Kiteboarding Resort, Bahía Salinas (Guanacaste, Costa Rica) - small hotel (suites, bungalows,
// standard rooms, dorm, apartment) 260 m from Papaturro beach with its own kite and wing foil school (since
// 2000, IKO instructors, shop, repair, rental) based at Copal kite beach.
//
// CONTENT ONLY, confidence 'low' (Aaron 2026-10-12: re-check with relaxed liveness, build if live).
// Liveness evidence (checked 2026-10-12, own site): WordPress dateModified 2026-09-23 on the home page,
//   /about-us/ and /kitesurfingcostarica/, 2026-07-15 on /kitesurfingcostarica/lessons/ (lesson + rental
//   prices) and /wing-foiling/, 2026-05-19 on /hotel/; page-sitemap lastmod up to 2026-09-24; photos
//   uploaded 2026/03 and 2026/05 (drone shots dated 2025-11-13 in the file names). Lessons page: "We are open
//   between the beginning of November and the end of July". Doubt: the business is listed FOR SALE by
//   brokers (iksurfmag / puravidaparadise / leadingre, USD 1.43 M, "fully operational"); the own site does
//   not mention the sale and shows no 2026/27 dates or room prices.
// Data path: WordPress (The7 theme), server-rendered:
//   content  / (intro, location, room summary, school, season, Google Maps embed, gallery),
//            /hotel/ (room list, photos), /kitesurfingcostarica/ (the spot), /kitesurfingcostarica/lessons/
//            (lesson and rental prices in USD, teaching languages).
//   slots    none: the site prints no room rates.
// Booking engine: Cloudbeds (hotels.cloudbeds.com/reservation/XG3P9p, the menu's "Reserve"). Not used:
//   Cloudbeds answers its /booking/* data calls with HTTP 403 to non-browser clients -> "price on request".
// robots.txt (2026-10-12): only /wp-admin/ disallowed.
// Requests per run: content 4, slots 0.
// spotCoords: centre of the home page's Google Maps embed of the place "Blue Dream Kiteboarding Resort"
//   (!2d-85.6728357!3d11.0328028).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, imageCandidates, parse, parseAmount, type HTMLElement } from '../parse.js';
import type { ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://bluedreamhotel.com';
export const BD_HOME_URL = `${SITE}/`;
export const BD_HOTEL_URL = `${SITE}/hotel/`;
export const BD_SPOT_URL = `${SITE}/kitesurfingcostarica/`;
export const BD_LESSONS_URL = `${SITE}/kitesurfingcostarica/lessons/`;
const FALLBACK_BOOKING_URL = 'https://hotels.cloudbeds.com/reservation/XG3P9p';

// --- local helpers ----------------------------------------------------------------------------
const txt = (el: HTMLElement | null | undefined): string => collapse(el?.text ?? '');
/** the page body without menus, header, footer, scripts */
function contentRoot(html: string): HTMLElement {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, svg, header, footer, nav, #footer, .masthead, .page-title')) el.remove();
  return root.querySelector('#content') ?? root.querySelector('#main') ?? root.querySelector('body') ?? root;
}

// --- pure parsers -----------------------------------------------------------------------------
/** /hotel/ room list: "<strong>1 Suite </strong>up to 3 people with ..." */
export function parseBdRooms(hotelHtml: string): ContentRoom[] {
  const out: Array<ContentRoom & { cap: string | null }> = [];
  for (const li of contentRoot(hotelHtml).querySelectorAll('ul li')) {
    const label = txt(li.querySelector('strong, b'));
    const m = label.match(/^(\d+)\s+(.+)$/) ?? (label ? [label, '', label] : null);
    if (!m) continue;
    const count = m[1] ? Number(m[1]) : null;
    let name = m[2].replace(/\s+up to \d+ people$/i, '').replace(/\bbungalows\b/i, 'bungalow').replace(/\brooms\b/i, 'room').trim();
    name = name.charAt(0).toUpperCase() + name.slice(1).toLowerCase().replace(/^house/, 'House');
    const full = txt(li);
    const cap = full.match(/up to (\d+) people/i)?.[1] ?? null;
    const description = collapse(full.replace(label, '')).replace(/^,\s*/, '');
    out.push({
      name,
      cap,
      description: description || null,
      features: [
        ...(count && count > 1 ? [`${count} units`] : []),
        ...(cap ? [`Up to ${cap} people`] : []),
        ...(/A\/C|air conditioning/i.test(full) ? ['Air conditioning'] : /\bfans?\b/i.test(full) ? ['Fan'] : []),
        ...(/kitchen/i.test(full) ? ['Kitchen'] : []),
        ...(/balcony|terrace/i.test(full) ? ['Balcony or terrace'] : []),
      ],
    });
  }
  // "1 wooden bungalows up to 4 people" + "3 wooden bungalows up to 2 people": tell them apart by capacity
  return out.map(({ cap, ...r }) => (cap && out.filter(o => o.name === r.name).length > 1 ? { ...r, name: `${r.name} for ${cap}` } : r));
}

export interface BdLessonPrices {
  groupHour: number | null; group3h: number | null; group9h: number | null;
  privateHour: number | null; private3h: number | null; private9h: number | null;
  rentalDay: number | null; rental3d: number | null; rental6d: number | null;
  languages: string[];
}

export function parseBdLessons(lessonsHtml: string): BdLessonPrices {
  const t = txt(contentRoot(lessonsHtml));
  const usd = (re: RegExp): number | null => { const m = t.match(re); return m ? parseAmount(m[1]) : null; };
  // the price blocks: "GROUP LESSONS: ... PRIVATE LESSONS: ..." (a "Private Lessons:" heading sits further up)
  const gStart = t.search(/GROUP LESSONS:/i);
  const pRel = gStart >= 0 ? t.slice(gStart).search(/PRIVATE LESSONS:/i) : -1;
  const pStart = pRel >= 0 ? gStart + pRel : -1;
  const group = gStart >= 0 ? t.slice(gStart, pStart >= 0 ? pStart : undefined) : '';
  const priv = pStart >= 0 ? t.slice(pStart) : '';
  const g = (re: RegExp): number | null => { const m = group.match(re); return m ? parseAmount(m[1]) : null; };
  const p = (re: RegExp): number | null => { const m = priv.match(re); return m ? parseAmount(m[1]) : null; };
  const langLine = t.match(/lessons in ([A-Za-z, ]+? and [A-Za-z]+)\./i)?.[1] ?? '';
  const iso: Record<string, string> = { english: 'en', spanish: 'es', french: 'fr', italian: 'it', german: 'de', portuguese: 'pt' };
  return {
    groupHour: g(/\$(\d+) per hour per person/i),
    group3h: g(/3 hours package is \$(\d+)/i),
    group9h: g(/9 hours package is \$(\d+)/i),
    privateHour: p(/private lessons: \$(\d+) per hour/i),
    private3h: p(/3 hours is \$(\d+)/i),
    private9h: p(/9 hours is \$(\d+)/i),
    rentalDay: usd(/Full gear is \$(\d+) per day/i),
    rental3d: usd(/3 day rental package is \$(\d+)/i),
    rental6d: usd(/6 days rental packages? is \$(\d+)/i),
    languages: langLine.split(/,|\band\b/).map(s => iso[s.trim().toLowerCase()]).filter((x): x is string => !!x),
  };
}

/** Centre of the Google Maps embed of the resort ("...!2d<lng>!3d<lat>...Blue Dream Kiteboarding Resort"). */
export function bdMapPin(homeHtml: string): { lat: number; lng: number } | null {
  const m = homeHtml.match(/google\.com\/maps\/embed\?pb=[^"']*?!2d(-?\d+\.\d+)!3d(-?\d+\.\d+)[^"']*?Blue%20Dream%20Kiteboarding%20Resort/i);
  return m ? { lat: Number(m[2]), lng: Number(m[1]) } : null;
}

/** Hotel photos first, then the home gallery; no logos, forecast screenshots or video thumbnails; prefer "-scaled". */
export function bdImages(hotelHtml: string, homeHtml: string): string[] {
  const all = [...imageCandidates(hotelHtml, BD_HOTEL_URL, null, 60), ...imageCandidates(homeHtml, BD_HOME_URL, null, 80)]
    .filter(u => u.startsWith(`${SITE}/wp-content/uploads/`) && !/logo|favi|icon|Captura-de-pantalla|yout\d|layerslider|\.svg/i.test(u));
  const byBase = new Map<string, string>();
  for (const u of all) {
    const base = u.replace(/-scaled(\.\w+)$/i, '$1');
    const prev = byBase.get(base);
    if (!prev || (/-scaled\./i.test(u) && !/-scaled\./i.test(prev))) byBase.set(base, u);
  }
  return [...byBase.values()];
}

export interface BdPages { home: string; hotel: string; spot: string; lessons: string }

export function parseBlueDreamContent(p: BdPages): OfferContent {
  const home = txt(contentRoot(p.home));
  const spot = txt(contentRoot(p.spot));
  const rooms = parseBdRooms(p.hotel);
  const lessons = parseBdLessons(p.lessons);
  const lessonsText = txt(contentRoot(p.lessons));
  const pin = bdMapPin(p.home);
  const season = /open between the beginning of November and the end of July/i.test(`${home} ${lessonsText}`);
  const booking = parse(p.home).querySelector('a[href*="cloudbeds.com/reservation/"]')?.getAttribute('href') ?? null;
  const location = home.match(/We are located on the north Pacific coast[^.]*\./i)?.[0] ?? null;
  const usd = (n: number | null): string => (n ? `USD ${n}` : '');

  const summary = [
    `Blue Dream Kiteboarding Resort is a small hotel with its own kite and wing foil school in Bahía Salinas, Guanacaste, on Costa Rica's north Pacific coast, 12 km from La Cruz and 260 m from Papaturro beach.`,
    `Guests stay in a suite, a junior suite, wooden bungalows, standard rooms with fans, a dorm or a three-bedroom apartment, all with private bathrooms, and there is a café-bar on site.`,
    `The school has taught kitesurfing at Copal kite beach since 2000 with IKO instructors, rents and repairs gear${lessons.groupHour ? ` and charges ${usd(lessons.groupHour)} per hour for group lessons` : ''}${season ? '; it is open from early November to the end of July' : ''}.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Blue Dream Kiteboarding Resort',
    summary,
    continent: 'North America',
    country: 'Costa Rica',
    region: 'Guanacaste',
    spot: 'Bahia Salinas',
    spotCoords: pin,
    itinerarySpots: [],
    durationDays: null,
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: /kiteboarding lessons?|kitesurfing lessons?/i.test(lessonsText),
    equipmentRental: lessons.rentalDay !== null || /KITE GEAR RENTAL/i.test(lessonsText),
    beginnerFriendly: /absolute beginner/i.test(lessonsText),
    includedServices: ['Wi-Fi', 'Private bathroom with hot water', 'Free shuttle to the kite school at Copal beach'].filter(s => !/shuttle/i.test(s) || /free shuttle/i.test(spot)),
    optionalServices: [
      ...(lessons.groupHour ? [`Group kite lessons (2-3 people): ${usd(lessons.groupHour)} per hour per person, 3 hours ${usd(lessons.group3h)}, 9 hours ${usd(lessons.group9h)}`] : []),
      ...(lessons.privateHour ? [`Private kite lessons: ${usd(lessons.privateHour)} per hour, 3 hours ${usd(lessons.private3h)}, 9 hours ${usd(lessons.private9h)}`] : []),
      ...(lessons.rentalDay ? [`Kite gear rental: full gear ${usd(lessons.rentalDay)} per day, 3 days ${usd(lessons.rental3d)}, 6 days ${usd(lessons.rental6d)}`] : []),
      'Wing foil lessons (high season)',
      'Kite repair and kite shop',
      'Yoga in the high season; transfers, diving, snorkelling, fishing, riding and quad tours through local operators',
    ],
    accommodation: 'small resort with suites, wooden bungalows, standard rooms, a dorm and an apartment',
    mealPlan: null,
    languages: lessons.languages,
    rooms,
    imageUrls: bdImages(p.hotel, p.home).slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: BD_HOME_URL,
    bookingUrl: booking ?? FALLBACK_BOOKING_URL,
    sourceText: [
      `location: ${location ?? '?'}`,
      `rooms: ${rooms.map(r => `${r.name}: ${r.description ?? ''}`).join(' | ')}`,
      `lessons: ${JSON.stringify(lessons)}`,
      `home: ${home}`,
      `spot: ${spot}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const blueDreamKiteboardingResortBahiaSalinas: OfferAdapter = {
  key: 'blue-dream-kiteboarding-resort-bahia-salinas',
  name: 'Blue Dream Kiteboarding Resort Bahia Salinas',
  kind: 'accommodation',
  operator: {
    name: 'Blue Dream Kiteboarding Resort',
    websiteUrl: SITE,
    rootDomain: 'bluedreamhotel.com',
    contactEmail: 'bluedreamcr@gmail.com',
    whatsapp: '+50688265221',
    phone: '+506 8826 5221',
  },
  url: BD_HOME_URL,
  slotMethod: 'price_table',
  instantBooking: true,
  fetchBudget: 4,
  confidence: 'low',
  async fetchContent() {
    const [home, hotel, spot, lessons] = [
      await fetchText(BD_HOME_URL), await fetchText(BD_HOTEL_URL), await fetchText(BD_SPOT_URL), await fetchText(BD_LESSONS_URL),
    ];
    return parseBlueDreamContent({ home, hotel, spot, lessons });
  },
  async fetchSlots(ctx: FetchContext): Promise<Slot[]> {
    ctx.note('no room rates on the site and Cloudbeds /booking/* answers 403: offer stays "price on request"');
    return [];
  },
};
