// ---------------------------------------------------------------------------
// Namotu Island Resort, Namotu island (Mamanuca group, Fiji) - boutique surf, kite and watersports resort with 12
// rooms next to Namotu Lefts, Swimming Pools and Wilkes Pass and close to Cloudbreak; kiters since it opened in
// 1994, Ben Wilson's "Unlimited Weeks" (formerly Kite Weeks) in June-September. Week stays only (Sunday-Sunday).
//
// Data path (checked 2026-10-12): WordPress site www.namotuislandfiji.com.
//   content  / (resort), /the-resort/accommodations/ (12 rooms, room names), /experience/kitesurfing/ (spot, history),
//            /signature-week/ben-wilson-kite-weeks/ (Unlimited Weeks: inclusions, dates, deposit terms),
//            /reservations/ (minimum 7 nights, Sunday check-in, enquiries answered by the agent WaterWays Travel).
//   slots    none: no prices on the site ("Please contact us for package pricing and availability. Prices vary
//            depending on room. All prices are quoted in US Dollars."). fetchSlots reads the Unlimited Weeks page
//            only to report its date list: on 2026-10-12 the heading says "2027 DATES" but every date reads 2026
//            ("06-13 June 2026" ... "22-29 Aug 2026"; those days are Sundays in 2027, Saturdays in 2026 - a year
//            typo is likely, not confirmed) -> no dated slots are derived from it.
// No booking engine: enquiry form -> price on request (confidence 'low').
// robots.txt (2026-10-12): Yoast default, nothing disallowed.
// Requests per run: content 5, slots 1.
// Known limits: rooms have names only on the overview (descriptions sit on per-room pages, not fetched); the phone
//   numbers on the site (310 584 9900 worldwide, 888 669 SURF US) are the reservations line of the agent.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, imageCandidates } from '../parse.js';
import type { ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.namotuislandfiji.com';
export const NI_HOME_URL = `${SITE}/`;
const NI_ROOMS_URL = `${SITE}/the-resort/accommodations/`;
const NI_KITE_URL = `${SITE}/experience/kitesurfing/`;
export const NI_WEEKS_URL = `${SITE}/signature-week/ben-wilson-kite-weeks/`;
const NI_RESERVATIONS_URL = `${SITE}/reservations/`;

/** Text of the article body (WordPress entry content), split at block tags. */
export function niLines(html: string): string[] {
  const body = html.match(/<article[\s\S]*?<\/article>/i)?.[0] ?? html;
  return body
    .replace(/<(script|style|noscript|svg|form)\b[\s\S]*?<\/\1>/gi, ' ')
    .split(/<\/?(?:p|li|td|th|tr|h\d|div|br|ul|section|header|footer|nav)\b[^>]*>/i)
    .map(s => clean(s.replace(/<[^>]+>/g, ' ')))
    .filter(Boolean);
}

// --- pure parsers -----------------------------------------------------------------------------
/** Room names from the accommodation overview cards (<a title="..."><h3>name</h3>). */
export function parseNiRooms(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/href="https:\/\/www\.namotuislandfiji\.com\/the-resort\/accommodation\/[^"]+"[^>]*>[\s\S]*?<h3>([\s\S]*?)<\/h3>/gi)) {
    const name = clean(m[1]);
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

/** The Unlimited Weeks date list: the heading above it and the date lines as printed. */
export function parseNiWeeks(html: string): { heading: string | null; dates: string[] } {
  const m = html.match(/<h2[^>]*>\s*((?:20\d{2}\s+)?DATES)\s*<\/h2>([\s\S]*?)<h2/i);
  if (!m) return { heading: null, dates: [] };
  const dates = [...m[2].matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)].map(x => clean(x[1])).filter(t => /\d{4}/.test(t));
  return { heading: clean(m[1]), dates };
}

export interface NiPages { home: string; rooms: string; kite: string; weeks: string; reservations: string }

export function parseNamotuContent(p: NiPages): OfferContent {
  const rooms = niLines(p.rooms);
  const kite = niLines(p.kite);
  const weeks = niLines(p.weeks);
  const res = niLines(p.reservations);
  const home = niLines(p.home);
  const roomsText = rooms.join(' ');
  const kiteText = kite.join(' ');
  const weeksText = weeks.join(' ');
  const resText = res.join(' ');
  const roomNames = parseNiRooms(p.rooms);
  const nRooms = roomsText.match(/boutique resort with (\d+) rooms/)?.[1] ?? null;
  const roomFacts = roomsText.match(/All rooms have ([^.]+)\./)?.[1] ?? null;
  const opened = kiteText.match(/opened our doors in (\d{4})/)?.[1] ?? null;
  const minStay = resText.match(/minimum (\d+) night stay with check-in day on (\w+)/i);
  const standard = (() => {
    const i = weeks.findIndex(l => /Standard Week Package Inclusions/i.test(l));
    const out: string[] = [];
    for (const l of weeks.slice(i + 1)) { if (/^Not Included/i.test(l) || out.length > 12) break; out.push(l); }
    return i >= 0 ? out : [];
  })();
  const unlimited = (() => {
    const i = weeks.findIndex(l => /UNLIMITED Weeks Include/i.test(l));
    const j = weeks.findIndex(l => /Standard Week Package Inclusions/i.test(l));
    return i >= 0 && j > i ? weeks.slice(i + 1, j) : [];
  })();
  const deposit = weeksText.match(/Bookings are secured with a (USD\$[\d,]+ per person deposit)/)?.[1] ?? null;

  const contentRooms: ContentRoom[] = roomNames.map(n => ({
    name: n,
    description: null,
    features: roomFacts ? [`All rooms: ${roomFacts}`] : [],
  }));

  const imgs: string[] = [];
  const seen = new Set<string>();
  for (const [html, base] of [[p.rooms, NI_ROOMS_URL], [p.kite, NI_KITE_URL], [p.weeks, NI_WEEKS_URL], [p.home, NI_HOME_URL]] as const) {
    for (const u of imageCandidates(html, base, null, 80)) {
      if (!/namotuislandfiji\.com\/wp-content\/uploads\//.test(u) || /logo|icon|favicon|cropped-|map|\.png$|\.svg$/i.test(u)) continue;
      const k = u.replace(/-\d+x\d+(?=\.[a-z]+$)/i, '');
      if (seen.has(k)) continue;
      seen.add(k); imgs.push(k);
    }
  }

  const summary = [
    `Namotu Island Resort is a boutique surf, kite and watersports resort on Namotu, a small island in Fiji's Mamanuca group, with ${nRooms ?? '12'} air-conditioned rooms and bures with private bathroom, balcony and ocean view, next to the breaks Namotu Lefts, Swimming Pools and Wilkes Pass and a short boat ride from Cloudbreak.`,
    `Stays are full weeks only (minimum ${minStay?.[1] ?? '7'} nights, check-in on ${minStay?.[2] ?? 'Sunday'}) with three meals a day, unlimited surf-boat use, daily yoga, Wi-Fi and car-and-boat airport transfers; prices are on request in US dollars.`,
    `Kiters have come since the resort opened in ${opened ?? '1994'}: Namotu Lefts suits wave kiting, open flat water suits learners and freestyle, and Ben Wilson's Unlimited Weeks (formerly Kite Weeks) run on set dates from June to September with coaching, shared kite and foil gear, jet-ski support and a photographer.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Namotu Island Resort',
    summary,
    continent: 'Oceania',
    country: 'Fiji',
    region: 'Mamanuca Islands',
    spot: 'Namotu Island',
    itinerarySpots: [],
    durationDays: null,
    // kitesurfing page: "Whether you are a beginner or a pro"
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: /learn to kite|lessons/i.test(`${kiteText} ${weeksText}`),
    equipmentRental: /weekly hire|gear hire|Equipment hire/i.test(`${weeksText} ${home.join(' ')}`),
    beginnerFriendly: /still learning|No experience necessary/i.test(`${kiteText} ${weeksText}`),
    includedServices: standard.length ? standard : ['7 nights accommodation', '3 meals daily', 'Unlimited use of surf boats', 'Airport transfers'],
    optionalServices: [
      ...(unlimited.length ? [`Unlimited Weeks (June-September, set dates): ${unlimited.join('; ')}`] : []),
      ...(deposit ? [`Unlimited Week booking deposit: ${deposit}`] : []),
      'Private surf, SUP, wing, foil and kite coaching',
      'Kite, board and harness weekly hire',
      'Massage, scuba diving, fishing charters',
    ],
    accommodation: `${nRooms ?? '12'} rooms and bures (standard and premium studios)`,
    mealPlan: 'full_board',
    languages: ['en'],
    rooms: contentRooms,
    imageUrls: imgs.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: NI_HOME_URL,
    bookingUrl: NI_RESERVATIONS_URL,
    sourceText: [
      `home: ${home.join(' | ')}`,
      `accommodations: ${roomsText}`,
      `kitesurfing: ${kiteText}`,
      `unlimited weeks: ${weeksText}`,
      `reservations: ${resText}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const namotuIslandResortMamanuca: OfferAdapter = {
  key: 'namotu-island-resort-mamanuca',
  name: 'Namotu Island Resort',
  kind: 'accommodation',
  disciplines: ['kitesurf', 'wingfoil'],
  operator: {
    name: 'Namotu Island Resort',
    websiteUrl: SITE,
    rootDomain: 'namotuislandfiji.com',
    phone: '+13105849900',
  },
  url: NI_HOME_URL,
  slotMethod: 'html_dates',
  fetchBudget: 6,
  confidence: 'low', // no prices on the site; dated kite weeks only, with an inconsistent year (see header)
  async fetchContent() {
    const home = await fetchText(NI_HOME_URL, { accept: 'text/html' });
    const rooms = await fetchText(NI_ROOMS_URL, { accept: 'text/html' });
    const kite = await fetchText(NI_KITE_URL, { accept: 'text/html' });
    const weeks = await fetchText(NI_WEEKS_URL, { accept: 'text/html' });
    const reservations = await fetchText(NI_RESERVATIONS_URL, { accept: 'text/html' });
    return parseNamotuContent({ home, rooms, kite, weeks, reservations });
  },
  async fetchSlots(ctx: FetchContext): Promise<Slot[]> {
    const w = parseNiWeeks(await fetchText(NI_WEEKS_URL, { accept: 'text/html' }));
    ctx.note(`no prices on the site (price on request); Unlimited Weeks heading "${w.heading ?? '-'}" lists ${w.dates.length} dates (${w.dates.slice(0, 2).join(', ')}${w.dates.length > 2 ? ', ...' : ''}) - not turned into slots`);
    return [];
  },
};
