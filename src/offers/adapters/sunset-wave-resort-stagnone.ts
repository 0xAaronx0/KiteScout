// ---------------------------------------------------------------------------
// Sunset Wave Resort, Contrada Birgi (Marsala, Lo Stagnone, Sicily, Italy) - small kite house with 5 themed
// rooms run with the Stagnone Kiteboarding school (IKO centre) at the Lo Stagnone lagoon.
//
// Data path (checked 2026-10-12): the school's WordPress site www.stagnonekiteboarding.com:
//   content  /en/sunset-wave-resort/ (English: room equipment list, 5 room names + texts, gallery of 16
//            resort photos), /kitesurf-stagnone-apertura-stagione-2026/ (Italian: "Stagnone Kiteboarding
//            apre la stagione 2026" incl. "ospitalità presso la struttura collegata al centro"),
//            /dove-alloggiare-stagnone-senza-macchina-kitesurf/ (Italian, April 2026: Sunset Wave as the
//            kiters' base: gear storage, rinse area).
//   slots    none: the site prints no room prices or dates. The booking page /booking-sunset-wave/
//            embeds the property's Octorate engine (book.octorate.com/octobook/site/reservation/
//            calendar.xhtml?codice=218291), which answers "Expired License!" (2026-10-12); the other
//            booking link is Booking.com (a portal, not read). fetchSlots checks the Octorate page once
//            per run and notes when it comes back, then returns [] ("price on request").
// robots.txt (2026-10-12): stagnonekiteboarding.com disallows only WooCommerce/wp-admin paths;
//   book.octorate.com/robots.txt is 404 (allow all).
// Requests per run: content 3, slots 1.
// Known limits: the resort's own pages are from 2021/2022 (Yoast dateModified 2022-02-01); the 2026
//   operation evidence is the school's 2026 season article and the April 2026 accommodation post.
//   No coordinates on the site (only a goo.gl maps short link).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, imageCandidates, parse } from '../parse.js';
import type { ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.stagnonekiteboarding.com';
export const SWR_PAGE_URL = `${SITE}/en/sunset-wave-resort/`;
export const SWR_SEASON_URL = `${SITE}/kitesurf-stagnone-apertura-stagione-2026/`;
export const SWR_STAY_URL = `${SITE}/dove-alloggiare-stagnone-senza-macchina-kitesurf/`;
export const SWR_OCTORATE_URL = 'https://book.octorate.com/octobook/site/reservation/calendar.xhtml?codice=218291';

export interface SwrRoom { name: string; text: string; maxGuests: number | null }

function paragraphs(html: string): string[] {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, header, footer, nav, svg')) el.remove();
  return root.querySelectorAll('h1, h2, h3, p, li').map(p => collapse(p.text)).filter(Boolean);
}

// --- pure parsers -----------------------------------------------------------------------------
const EQUIPMENT: Array<[RegExp, string]> = [
  [/bathroom/i, 'Private bathroom'], [/air conditioning/i, 'Air conditioning'], [/wi-?fi/i, 'Free Wi-Fi'],
  [/television|\btv\b/i, 'Full HD TV'], [/frigobar|minibar/i, 'Minibar'], [/safe/i, 'Laptop safe'], [/fan\b/i, 'Fan'],
  [/hair ?dryer/i, 'Hair dryer'], [/mountain bikes?/i, 'Mountain bikes (subject to availability)'],
];

/** "All rooms are equipped" + the "* ..." lines after it, as plain feature labels (unknown lines dropped). */
export function parseSwrEquipment(html: string): string[] {
  const ps = paragraphs(html);
  const i = ps.findIndex(p => /^All rooms are equipped/i.test(p));
  if (i < 0) return [];
  const out: string[] = [];
  for (const p of ps.slice(i + 1)) {
    if (!p.startsWith('*')) break;
    const label = EQUIPMENT.find(([re]) => re.test(p))?.[1];
    if (label && !out.includes(label)) out.push(label);
  }
  return out;
}

/** Room = <h3> name + the <p> after it, between the equipment list and "Find out more". */
export function parseSwrRooms(html: string): SwrRoom[] {
  const start = html.search(/All rooms are equipped/i);
  const end = html.search(/<h3[^>]*>(?:<strong>)?\s*Find out more/i);
  if (start < 0) return [];
  const block = html.slice(start, end > start ? end : undefined);
  const out: SwrRoom[] = [];
  for (const m of block.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>\s*<p[^>]*>([\s\S]*?)<\/p>/g)) {
    const name = collapse(parse(m[1]).text);
    const text = collapse(parse(m[2]).text);
    if (!name || !text) continue;
    const max = text.match(/(?:up to|maximum of)\s+(?:a maximum of\s+)?(\d+)\s+people/i);
    out.push({ name, text: text.replace(/^./, c => c.toUpperCase()), maxGuests: max ? Number(max[1]) : null });
  }
  return out;
}

/** The school's season article: "La stagione 2026 ... è ufficialmente aperta" + hospitality at the linked resort. */
export function parseSwrSeason(html: string): { year: number | null; hospitality: boolean; text: string | null } {
  const ps = paragraphs(html);
  const h1 = ps.find(p => /apre la stagione (20\d{2})/i.test(p)) ?? null;
  const year = Number(h1?.match(/stagione (20\d{2})/i)?.[1]) || null;
  const hospitality = ps.some(p => /ospitalità presso la struttura collegata al centro|soggiorno presso il resort collegato al centro/i.test(p));
  return { year, hospitality, text: h1 };
}

/** Octorate calendar page: the license state ("Expired License!" = engine off). */
export function octorateExpired(html: string): boolean {
  return /Expired License/i.test(html);
}

export interface SwrPages { page: string; season: string; stay: string }

export function parseSunsetWaveContent(p: SwrPages): OfferContent {
  const equipment = parseSwrEquipment(p.page);
  const rooms = parseSwrRooms(p.page);
  const season = parseSwrSeason(p.season);
  const stay = paragraphs(p.stay);
  const gear = stay.filter(x => /rimessaggio|sciacquo/i.test(x));
  const location = paragraphs(p.page).find(x => /Contrada Birgi/i.test(x)) ?? 'Sicilia - Marsala - Contrada Birgi';

  const contentRooms: ContentRoom[] = rooms.map(r => ({
    name: r.name,
    description: r.text,
    features: [...(r.maxGuests ? [`Up to ${r.maxGuests} guests`] : []), ...equipment],
  }));
  const largest = Math.max(0, ...rooms.map(r => r.maxGuests ?? 0));
  const imageUrls = imageCandidates(p.page, SWR_PAGE_URL, null, 60)
    .filter(u => /stagnonekiteboarding\.com\/wp-content\/uploads\/.*Sunset-Wave/i.test(u) && !/-\d+x\d+\./.test(u) && !/pinterest/i.test(u));

  const summary = [
    `Sunset Wave Resort is a small kite house with ${rooms.length || 5} themed rooms${largest ? ` (the largest sleeps ${largest})` : ''} in Contrada Birgi near Marsala, by the Lo Stagnone lagoon in western Sicily.`,
    `It is the accommodation linked to the Stagnone Kiteboarding school (IKO centre), which arranges lessons, rental and on-water assistance for guests${season.year && season.hospitality ? ` and opened its ${season.year} season including stays at the resort` : ''}.`,
    'Every room has a private bathroom, air conditioning, Wi-Fi, a minibar and a TV; guests share an outdoor lounge area and a gear storage and rinse area, and mountain bikes are available subject to availability.',
    'The site publishes no room prices; stays are requested through the school.',
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Sunset Wave Resort',
    summary,
    continent: 'Europe',
    country: 'Italy',
    region: 'Sicily',
    spot: 'Lo Stagnone',
    itinerarySpots: [],
    durationDays: null,
    // season article: "corsi per principianti", "lezioni individuali e di progressione" (2026)
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: true,
    equipmentRental: true,
    beginnerFriendly: true,
    includedServices: ['Private bathroom', 'Air conditioning', 'Wi-Fi', 'Minibar', 'TV', 'Outdoor lounge area', 'Gear storage and rinse area'],
    optionalServices: ['Kitesurf courses (Stagnone Kiteboarding, IKO centre)', 'Equipment rental', 'On-water assistance', 'Mountain bikes (subject to availability)'],
    accommodation: 'kite house with 5 themed double/twin rooms',
    mealPlan: null,
    languages: ['it', 'en'],
    rooms: contentRooms,
    imageUrls: imageUrls.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: SWR_PAGE_URL,
    bookingUrl: null, // /booking-sunset-wave/ only embeds the expired Octorate engine
    sourceText: [
      `location: ${location}`,
      `equipment: ${equipment.join('; ')}`,
      `rooms: ${rooms.map(r => `${r.name}${r.maxGuests ? ` (max ${r.maxGuests})` : ''}: ${r.text}`).join(' | ')}`,
      `season: ${season.text ?? ''} (hospitality at the linked resort: ${season.hospitality ? 'yes' : 'no'})`,
      `stay post: ${gear.join(' ')}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const sunsetWaveResortStagnone: OfferAdapter = {
  key: 'sunset-wave-resort-stagnone',
  name: 'Sunset Wave Resort Lo Stagnone',
  kind: 'accommodation',
  operator: {
    name: 'Stagnone Kiteboarding',
    websiteUrl: SITE,
    rootDomain: 'stagnonekiteboarding.com',
    contactEmail: 'corsi@kitesurfing.it',
    phone: '+390640049423',
  },
  url: SWR_PAGE_URL,
  slotMethod: 'booking_engine',
  fetchBudget: 5,
  confidence: 'low',
  async fetchContent() {
    const [page, season, stay] = [
      await fetchText(SWR_PAGE_URL, { accept: 'text/html' }),
      await fetchText(SWR_SEASON_URL, { accept: 'text/html' }),
      await fetchText(SWR_STAY_URL, { accept: 'text/html' }),
    ];
    return parseSunsetWaveContent({ page, season, stay });
  },
  async fetchSlots(ctx: FetchContext): Promise<Slot[]> {
    const html = await fetchText(SWR_OCTORATE_URL, { accept: 'text/html' });
    if (octorateExpired(html)) ctx.note('Octorate engine 218291 still answers "Expired License!": no prices or dates, offer stays "price on request"');
    else ctx.note('Octorate engine 218291 no longer says "Expired License!": check whether it now shows rates and build the slot parser');
    return [];
  },
};
