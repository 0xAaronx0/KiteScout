// ---------------------------------------------------------------------------
// Windtown Lagoon Hotel, Langebaan (Western Cape, South Africa) - boutique hotel with its own IKO kite & wing centre
// (since 2001), Breeze restaurant, spa and yoga, about 100 m from a launch area on the Langebaan lagoon. The site's
// footer also shows a sister hotel, Windtown Beach Hotel in Cumbuco (Brazil); this adapter covers Langebaan only.
//
// Data path (checked 2026-10-12): www.windtown-sa.com is a one-page WordPress/Elementor site.
//   content  / : about, Langebaan, room cards (<h2> name + "2 persons 1 double bed 1 bathroom Ground floor",
//            "breakfast included"), kite & wing centre, restaurant, spa, events ("KITE YOGA CAMP 13-20 Dec 2026"),
//            contact block; the kite & wing price list is a PDF ("Final-Kite-Pricing-RACK-RATE-2026-27-Season.pdf").
//   slots    none. Room rates exist only in the booking engine behind "BOOK NOW": www.mybookingsite.io/inst/
//            #home?propertyId=... (STAAH). That host answered HTTP 403 to our UA for /robots.txt (2026-10-12)
//            -> treated as blocked; its React app loads further component bundles before any rate call, which
//            we did not follow. The site's promo banners link book-directonline.com/properties/windtownbeachdirect
//            = the Brazilian sister hotel (BRL), not this property -> ignored.
// robots.txt (2026-10-12): www.windtown-sa.com WooCommerce/Yoast defaults (/wp-admin/, ?add-to-cart=), pages allowed.
// Requests per run: content 1, slots 0.
// Parsed: content only; fetchSlots returns [] (price on request, confidence 'low').
// Known limits: no prices or availability; the map embed is a place-name query (no coordinates); the room count
//   per type is not stated.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, imageCandidates } from '../parse.js';
import type { ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.windtown-sa.com';
export const WT_HOME_URL = `${SITE}/`;

/** Visible text split at block tags. */
export function wtLines(html: string): string[] {
  return html
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .split(/<\/?(?:p|li|td|th|tr|h\d|div|br|ul|section|article|header|footer|nav)\b[^>]*>/i)
    .map(s => clean(s.replace(/<[^>]+>/g, ' ')))
    .filter(Boolean);
}

// --- pure parsers -----------------------------------------------------------------------------
export interface WtRoom { name: string; persons: number | null; beds: string | null; bathroom: string | null; floor: string | null }

/** Room cards between "Boutique hotel rooms" and the kite & wing section: <h2> name, then the facts paragraph. */
export function parseWtRooms(html: string): WtRoom[] {
  const s = html.replace(/<(script|style|svg|noscript)\b[\s\S]*?<\/\1>/gi, ' ');
  const from = s.indexOf('Boutique hotel rooms');
  const to = s.search(/Your Kite (?:&amp;|&) Wing Center/);
  if (from < 0) return [];
  const seg = s.slice(from, to > from ? to : undefined);
  const out: WtRoom[] = [];
  let name: string | null = null;
  for (const m of seg.matchAll(/<(h2|p)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const t = clean(m[2].replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' '));
    if (m[1].toLowerCase() === 'h2') { name = /breakfast included/i.test(t) ? null : t; continue; }
    if (!name || !/\bpersons?\b/i.test(t)) continue;
    out.push({
      name,
      persons: Number(t.match(/(\d+)\s+persons?/i)?.[1]) || null,
      beds: t.match(/persons?\s+(.+?)\s+\d+\s+bathroom/i)?.[1] ?? null,
      bathroom: t.match(/(\d+\s+bathroom)/i)?.[1] ?? null,
      floor: t.match(/(Ground floor|First floor|Second floor)/i)?.[1] ?? null,
    });
    name = null;
  }
  return out;
}

export function parseWindtownContent(html: string): OfferContent {
  const lines = wtLines(html);
  const text = lines.join(' ');
  const rooms = parseWtRooms(html);
  const iko = text.match(/IKO certified since (\d{4})/)?.[1] ?? null;
  const launch = text.match(/Just (\d+) metres from Windtown, a quiet and uncrowded launch area/)?.[1] ?? null;
  const camp = text.match(/KITE YOGA CAMP\s+([\d-]+ [A-Z][a-z]{2} \d{4})/)?.[1] ?? null;
  const pricePdf = html.match(/https:\/\/www\.windtown-sa\.com\/wp-content\/uploads\/[^"']*Kite-Pricing[^"']*\.pdf/)?.[0] ?? null;
  const hours = text.match(/Open daily:\s*(Breakfast: [\d.]+-[\d.]+ Lunch: [\d-]+ Dinner: [\d-]+)/)?.[1] ?? null;

  const contentRooms: ContentRoom[] = rooms.map(r => ({
    name: r.name,
    description: null,
    features: [
      r.persons ? `${r.persons} persons` : null,
      r.beds, r.bathroom, r.floor, 'Breakfast included',
    ].filter((x): x is string => !!x),
  }));

  const imgs: string[] = [];
  const seen = new Set<string>();
  for (const u of imageCandidates(html, WT_HOME_URL, null, 120)) {
    if (!/windtown-sa\.com\/wp-content\/uploads\//.test(u) || /logo|icon|favicon|cropped-|\.png$|\.svg$|menu|privacy/i.test(u)) continue;
    const k = u.replace(/-\d+x\d+(?=\.[a-z]+$)/i, '').replace(/-scaled(?=\.[a-z]+$)/i, '');
    if (seen.has(k)) continue;
    seen.add(k); imgs.push(u.replace(/-\d+x\d+(?=\.[a-z]+$)/i, ''));
  }

  const summary = [
    'Windtown Lagoon Hotel is a boutique hotel on Bree Street in Langebaan, about an hour from Cape Town on South Africa\'s West Coast, with a restaurant (Breeze) with rooftop terrace, a spa with sauna and yoga, and its own kite and wing centre.',
    `The centre has been IKO certified since ${iko ?? '2001'} and offers courses, rentals (Duotone), private lockers, rescue boat support and a shop; a quiet launch area on the lagoon is ${launch ?? '100'} m from the hotel, with conditions for beginners and freestyle riders.`,
    `Rooms range from basic and standard doubles and twins to deluxe doubles and triples, all with breakfast${camp ? `; the site lists upcoming events such as a kite yoga camp (${camp})` : ''}.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Windtown Lagoon Hotel',
    summary,
    continent: 'Africa',
    country: 'South Africa',
    region: 'Western Cape',
    spot: 'Langebaan',
    itinerarySpots: [],
    durationDays: null,
    // "ideal conditions for both beginners and experienced riders" / "excellent conditions for freestyle"
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: /courses/i.test(text) && /IKO/i.test(text),
    equipmentRental: /rentals/i.test(text),
    beginnerFriendly: /ideal conditions for both beginners/i.test(text),
    includedServices: ['Breakfast', /High speed WIFI/i.test(text) ? 'Free high-speed Wi-Fi' : null, /Back up power/i.test(text) ? 'Back-up power' : null]
      .filter((x): x is string => !!x),
    optionalServices: [
      `Kite and wing courses, rentals and shop${pricePdf ? ` (2026-27 rack rates: ${pricePdf})` : ''}`,
      'Private lockers and rescue boat support at the kite centre',
      'Stand-up paddleboard hire',
      `Breeze restaurant and rooftop bar${hours ? ` (${hours})` : ''}`,
      'Spa treatments, massages, sauna and yoga classes',
      ...(camp ? [`Kite yoga camp ${camp}`] : []),
    ],
    accommodation: 'boutique hotel rooms (doubles, twins, deluxe doubles, triples)',
    mealPlan: 'breakfast',
    languages: ['en', 'nl', 'de'],
    rooms: contentRooms,
    imageUrls: imgs.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: WT_HOME_URL,
    bookingUrl: html.match(/https:\/\/www\.mybookingsite\.io\/inst\/#home\?propertyId=[A-Za-z0-9]+/)?.[0] ?? WT_HOME_URL,
    sourceText: [
      `page: ${lines.filter(l => l.length > 25 && !/^(Facebook|Youtube|Instagram)$/.test(l)).join(' | ')}`,
      `rooms: ${rooms.map(r => `${r.name}: ${r.persons ?? '?'} persons, ${r.beds ?? '?'}, ${r.floor ?? '?'}`).join('; ')}`,
      `kite price list: ${pricePdf ?? '-'}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const windtownLagoonHotelLangebaan: OfferAdapter = {
  key: 'windtown-lagoon-hotel-langebaan',
  name: 'Windtown Lagoon Hotel',
  kind: 'accommodation',
  operator: {
    name: 'Windtown Lagoon Hotel',
    websiteUrl: SITE,
    rootDomain: 'windtown-sa.com',
    contactEmail: 'reservations@windtown-sa.com', // printed as "reservations [at] windtown-sa.com"
    phone: '+27227721064',
  },
  url: WT_HOME_URL,
  slotMethod: 'booking_engine',
  fetchBudget: 1,
  confidence: 'low', // no prices on the site; the STAAH booking engine host refuses us (403 on robots.txt)
  async fetchContent() {
    return parseWindtownContent(await fetchText(WT_HOME_URL, { accept: 'text/html' }));
  },
  async fetchSlots(ctx: FetchContext): Promise<Slot[]> {
    ctx.note('no public rates: the STAAH engine host www.mybookingsite.io answered 403 to our UA (robots.txt, 2026-10-12); price on request');
    return [];
  },
};
