// ---------------------------------------------------------------------------
// Floripa Yoga & Kitesurf House, Santa Maria del Focallo (Ispica, Ragusa, Sicily, Italy) - yoga and
// kitesurf guesthouse a few steps from the beach, own kite instruction with IKO-certified instructors
// at its beach bistro Zuma. Open late March to early November.
//
// Data path (checked 2026-10-12): Webflow site www.floripa.it (English; /it is Italian):
//   content  / (intro, FAQ: season, minimum stay, breakfast, airports), /rooms (room cards per house
//            tab: Surf House / Kite House / Beach House / Outside, name + type), /water-sports-kitesurf
//            (kite course + rental prices, SUP/surf, wing/windsurf), /packages (basic package + bundles).
//   slots    /packages: "Minimum stay 3 nights | From €62/night" for the Basic Package (room, two yoga
//            classes a day, breakfast buffet). No room or season price table on the site.
// Booking engine: Beddy (floripa.beddy.io, widget code 988dc1f65c033). The engine shell loads behind a
//   Cloudflare Turnstile challenge (meta turnstile-site-key, challenges.cloudflare.com script) - a bot
//   check we do not work around, so there is no live availability or per-room price.
// robots.txt (2026-10-12): www.floripa.it only lists the sitemap (allow all); floripa.beddy.io answers
//   /robots.txt with the SPA shell (no rules).
// Requests per run: content 4, slots 1.
// Parsed: 1 slot "basic-package" = EUR per night for one guest, no dates (the page gives none),
//   minNights 3, availability 'unknown' (bookable online, inventory unreadable).
// Known limits: "From" price = cheapest unit (inferred: a bed in a shared room for one guest; the FAQ
//   says the room rate includes one guest's yoga package). August minimum stays (7 nights private /
//   4 shared) are in the room features only. Season months have no year on the site; the evidence
//   for 2026/27 operation is the live price, the booking engine link and the site republished
//   2026-10-08 (Webflow "Last Published" comment).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, parse, parseAmount } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.floripa.it';
export const FLORIPA_HOME_URL = `${SITE}/`;
export const FLORIPA_ROOMS_URL = `${SITE}/rooms`;
export const FLORIPA_KITE_URL = `${SITE}/water-sports-kitesurf`;
export const FLORIPA_PACKAGES_URL = `${SITE}/packages`;
const BOOKING_URL = 'https://floripa.beddy.io/#/(beddy:home)?lang=en';
export const FLORIPA_UNIT = 'Basic Package (room, two yoga classes a day, breakfast)';

export interface FloripaBasic { nightly: number; currency: string; minNights: number | null }
export interface FloripaRoom { name: string; house: string; type: string; image: string | null; path: string }

/** Visible text blocks (p, li, h*) of a Webflow page, scripts and styles removed. */
function blocks(html: string): string[] {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, svg')) el.remove();
  return root.querySelectorAll('h1, h2, h3, h4, h5, h6, p, li').map(b => collapse(b.text)).filter(Boolean);
}

// --- pure parsers -----------------------------------------------------------------------------
/** /packages: "Minimum stay 3 nights | From €62/night". */
export function parseFloripaBasic(html: string): FloripaBasic | null {
  for (const t of blocks(html)) {
    const m = t.match(/From\s*(€\s?[\d.,]+|[\d.,]+\s?€|EUR\s?[\d.,]+)\s*\/\s*night/i);
    if (!m) continue;
    const nightly = parseAmount(m[1]);
    if (!nightly) continue;
    const min = t.match(/Minimum stay\s+(\d+)\s+nights?/i);
    return { nightly, currency: 'EUR', minNights: min ? Number(min[1]) : null };
  }
  return null;
}

export function buildFloripaSlots(basic: FloripaBasic): Slot[] {
  return [{
    key: 'basic-package',
    startDate: null,
    endDate: null,
    unit: FLORIPA_UNIT,
    price: basic.nightly,
    currency: basic.currency,
    priceUnit: 'per_night',
    priceBasis: 'person',
    occupancy: 1,
    availability: 'unknown',
    availabilityText: null,
    spotsLeft: null,
    minNights: basic.minNights,
  }];
}

/** /rooms: Webflow tab panes (house) with room cards (link, image, name, type). */
export function parseFloripaRooms(html: string): FloripaRoom[] {
  const out: FloripaRoom[] = [];
  const panes = [...html.matchAll(/<div data-w-tab="([^"]+)" class="w-tab-pane[^"]*">/g)];
  panes.forEach((p, i) => {
    const end = i + 1 < panes.length ? panes[i + 1].index! : html.length;
    const body = html.slice(p.index!, end);
    const house = collapse(p[1]) === 'Outside' ? 'Outside the centre' : collapse(p[1]);
    for (const c of body.matchAll(/<a href="(\/accomodations\/[^"]+)"[\s\S]*?<img[^>]*?src="([^"]+)"[\s\S]*?<h6[^>]*>([\s\S]*?)<\/h6>\s*<div class="div-block-19">([\s\S]*?)<\/div><\/div>/g)) {
      const type = [...c[4].matchAll(/<div class="class-team-card-role[^"]*">([\s\S]*?)<\/div>/g)]
        .map(r => collapse(parse(r[1]).text)).filter(Boolean).join(', ');
      out.push({ name: collapse(parse(c[3]).text), house, type: type.replace(/\(\s+/g, '('), image: c[2] || null, path: c[1] });
    }
  });
  return out;
}

export interface FloripaKite { courseHourly: number | null; courseHours: number | null; rentalDay: number | null; brands: string[] }
/** /water-sports-kitesurf: "Our 6-hour introductory course ... Price: €80/hr", "full-day rentals at €90". */
export function parseFloripaKite(html: string): FloripaKite {
  const t = blocks(html).join('\n');
  const course = t.match(/Beginner Kitesurf Course[^\n]*?(\d+)-hour[^\n]*?Price:\s*€\s?(\d+)\s*\/\s*hr/i);
  const rental = t.match(/Full-Day Kitesurf Equipment Rental[^\n]*?€\s?(\d+)/i);
  const brands = t.match(/latest-generation ([A-Z][\w-]+) and ([A-Z][\w-]+) gear/);
  return {
    courseHourly: course ? Number(course[2]) : null,
    courseHours: course ? Number(course[1]) : null,
    rentalDay: rental ? Number(rental[1]) : null,
    brands: brands ? [brands[1], brands[2]] : [],
  };
}

/** FAQ facts on the home page (same FAQ block on every page). */
export function parseFloripaFaq(html: string): { season: string | null; minStay: string | null; airports: string | null; included: string | null } {
  const t = blocks(html);
  const find = (re: RegExp) => t.find(x => re.test(x)) ?? null;
  const seasonLine = find(/is open from .+? to .+?\./i);
  return {
    season: seasonLine?.match(/open from (.+?) to (.+?)\./i)?.slice(1, 3).join(' to ') ?? null,
    minStay: find(/minimum booking length is/i),
    airports: find(/closest airports are/i),
    included: find(/^The room \(solo or shared\)/i),
  };
}

/** "the minimum booking length is 3 nights. In August, ... 7 nights in a private room and 4 nights in a shared room." */
export function compactMinStay(text: string | null): string | null {
  if (!text) return null;
  const base = text.match(/minimum booking length is (\d+) nights/i)?.[1];
  const aug = text.match(/In August,[^.]*?(\d+) nights in a private room and (\d+) nights in a shared room/i);
  if (!base) return null;
  return `Minimum stay ${base} nights${aug ? ` (August: ${aug[1]} nights in a private room, ${aug[2]} in a shared room)` : ''}`;
}

const IMG_SKIP = /\.(svg|png)(\?|$)|flag|logo|icon|banner|screenshot|food|cucina|team|crew|arrow|marque|package|Chiara|ruth-|Illo|GPTemp/i;
/** Webflow <img src> = original upload; the shared image helper scopes to <main>, which holds 1 image here. */
export function floripaImages(pages: string[], max = 30): string[] {
  const lists = pages.map(html => {
    // the instructor portraits follow "Meet Your Instructors" on the kite page
    const cut = html.indexOf('Meet Your Instructors');
    const body = cut > 0 ? html.slice(0, cut) : html;
    return [...body.matchAll(/<img[^>]*?\ssrc="(https:\/\/cdn\.prod\.website-files\.com\/[^"]+)"/g)].map(m => m[1])
      .filter(u => !IMG_SKIP.test(decodeURIComponent(u)));
  });
  // round-robin across the pages (rooms, kite, home) so the first picks mix rooms, kiting and the beach
  const out: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; out.length < max && lists.some(l => i < l.length); i++) {
    for (const l of lists) {
      const u = l[i];
      if (!u) continue;
      const k = u.replace(/^.*\/[0-9a-f]{24}_/, '');
      if (seen.has(k)) continue;
      seen.add(k); out.push(u);
    }
  }
  return out.slice(0, max);
}

export interface FloripaPages { home: string; rooms: string; kite: string; packages: string }

export function parseFloripaContent(p: FloripaPages): OfferContent {
  const basic = parseFloripaBasic(p.packages);
  const rooms = parseFloripaRooms(p.rooms);
  const kite = parseFloripaKite(p.kite);
  const faq = parseFloripaFaq(p.home);
  const intro = blocks(p.rooms).find(t => /three themed villas/i.test(t)) ?? null;
  const houses = [...new Set(rooms.map(r => r.house).filter(h => !/outside/i.test(h)))];

  const minStay = compactMinStay(faq.minStay);
  const contentRooms: ContentRoom[] = rooms.map(r => ({
    name: r.name,
    description: `${r.type || 'Room'}, ${/outside/i.test(r.house) ? 'outside the Floripa centre' : r.house}.`,
    features: ['Air conditioning', 'Wi-Fi', 'Fresh linens', ...(minStay ? [minStay] : [])],
  }));

  const kiteBits = [
    kite.courseHours && kite.courseHourly ? `a ${kite.courseHours}-hour beginner course at EUR ${kite.courseHourly} per hour` : null,
    kite.rentalDay ? `full-day equipment rental at EUR ${kite.rentalDay}${kite.brands.length ? ` (${kite.brands.join(' and ')})` : ''}` : null,
  ].filter(Boolean).join(' and ');
  const summary = [
    `Floripa Yoga & Kitesurf House is a guesthouse in Santa Maria del Focallo (Ispica) on the south-east coast of Sicily, a few steps from the beach and its own beach bistro Zuma${faq.season ? `, open from ${faq.season}` : ''}.`,
    `Guests stay in double rooms, suites or 4-bed shared rooms spread over ${houses.length ? houses.join(', ').replace(/, ([^,]*)$/, ' and $1') : 'three houses'}; the basic package${basic ? ` (from EUR ${basic.nightly} per night${basic.minNights ? `, minimum ${basic.minNights} nights` : ''})` : ''} includes the room, two yoga classes a day and a vegetarian breakfast buffet.`,
    `Kitesurf lessons for all levels are taught by IKO-certified instructors on the beach${kiteBits ? `, with ${kiteBits}` : ''}; SUP, surf, wingfoil and windsurf are also offered.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Floripa Yoga & Kitesurf House',
    summary,
    continent: 'Europe',
    country: 'Italy',
    region: 'Ragusa, Sicily',
    spot: 'Santa Maria del Focallo',
    itinerarySpots: [],
    durationDays: null,
    // FAQ: "We offer courses for all levels, from beginners to advanced riders, with certified IKO instructors."
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: kite.courseHourly !== null || /kitesurf course/i.test(p.kite),
    equipmentRental: kite.rentalDay !== null || /equipment rental/i.test(p.kite),
    beginnerFriendly: true,
    includedServices: ['Accommodation (shared or private room)', 'Two yoga classes a day (all levels)', 'Vegetarian breakfast buffet', 'Beach access with chair and umbrella at Zuma Beach', 'Wi-Fi'],
    optionalServices: [
      kite.courseHourly ? `Kitesurf lessons (EUR ${kite.courseHourly} per hour)` : 'Kitesurf lessons',
      kite.rentalDay ? `Kitesurf equipment rental (EUR ${kite.rentalDay} per day)` : 'Kitesurf equipment rental',
      'SUP and surf lessons and board rental', 'Wingfoil and windsurf lessons and rental',
      'Vegetarian dinners', 'Massages', 'Yoga workshops', 'Jacuzzi', 'Laundry (EUR 10)', 'Transfers from Catania and Comiso airports',
      'Bundles: Wellness & Yoga, Maestrale (daily SUP/surf/kite board use + dinners), SUP & Yoga, Carefree Full Board',
    ],
    accommodation: 'guesthouse rooms, suites and shared rooms in three themed houses',
    mealPlan: 'breakfast',
    languages: ['en', 'it'],
    rooms: contentRooms,
    imageUrls: floripaImages([p.rooms, p.kite, p.home]),
    heroVideoUrl: null,
    sourceUrl: FLORIPA_HOME_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      `rooms intro: ${intro ?? ''}`,
      `rooms: ${rooms.map(r => `${r.name} (${r.house}: ${r.type})`).join('; ')}`,
      `basic package: ${basic ? `from EUR ${basic.nightly}/night, minimum ${basic.minNights ?? '?'} nights` : 'not found'}; includes: ${faq.included ?? ''}`,
      `kite: course ${kite.courseHours ?? '?'} h at EUR ${kite.courseHourly ?? '?'}/hr; full-day rental EUR ${kite.rentalDay ?? '?'}; brands ${kite.brands.join(', ')}`,
      `season: ${faq.season ?? ''}`,
      `minimum stay: ${faq.minStay ?? ''}`,
      `airports: ${faq.airports ?? ''}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const floripaIspica: OfferAdapter = {
  key: 'floripa-ispica',
  name: 'Floripa Yoga & Kitesurf House Ispica',
  kind: 'accommodation',
  operator: {
    name: 'Floripa Yoga & Kitesurf House',
    websiteUrl: SITE,
    rootDomain: 'floripa.it',
    contactEmail: 'welcome@floripa.it',
  },
  url: FLORIPA_HOME_URL,
  slotMethod: 'price_table',
  instantBooking: true,
  fetchBudget: 6,
  confidence: 'medium',
  async fetchContent() {
    const [home, rooms, kite, packages] = [
      await fetchText(FLORIPA_HOME_URL, { accept: 'text/html' }),
      await fetchText(FLORIPA_ROOMS_URL, { accept: 'text/html' }),
      await fetchText(FLORIPA_KITE_URL, { accept: 'text/html' }),
      await fetchText(FLORIPA_PACKAGES_URL, { accept: 'text/html' }),
    ];
    return parseFloripaContent({ home, rooms, kite, packages });
  },
  async fetchSlots() {
    const basic = parseFloripaBasic(await fetchText(FLORIPA_PACKAGES_URL, { accept: 'text/html' }));
    if (!basic) throw new Error('floripa: "From €../night" for the basic package not found on /packages (layout changed?)');
    return buildFloripaSlots(basic);
  },
};
