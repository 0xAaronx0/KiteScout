// ---------------------------------------------------------------------------
// Masirah Beach Camp, Sur Masirah (Masirah Island, Oman) - the beach camp that hosts GET Kitesurf Oman's
// summer kite centre (IKO Pro centre) from May to September. Accommodation on site, booked through GET.
// The camp has no website of its own; all data comes from the kite school's own site kitesurfoman.com.
//
// Who runs what on Masirah (checked 2026-10-12):
//   - The camp: "Masirah Beach Camp" at Sur Masirah. Kiteboarding Oman (kiteboarding-oman.com) ran its kite
//     camp here for years ("Masirah Beach Camp by Mansoor Majali", wooden huts at the spot) and now states
//     "The kitecamp is not operated by us anymore"; that site was last edited 2023-11 (WP REST), so it is not
//     used as a data source.
//   - GET Kitesurf Oman (Global Edventure Travel) moved its summer centre there: /locations/ "Masirah Island -
//     Main Kite Centre ... Location: Sur Masirah / Base: Masirah Beach Camp / Accommodation available on-site";
//     /masirah-island/ "Our kite centre operates out of the Masirah Beach Camp from May to September offering
//     several accommodation options for every budget. Bookings can be made through our contact page."
// Liveness evidence (rule 5b relaxed, Aaron 2026-10-12): kitesurfoman.com WP REST /wp/v2/pages - /masirah-iko/
//   created and modified 2026-09-04 ("GET is the island's main kite operator", "Full packages - GET can arrange
//   accommodation, transfers and the whole Masirah trip"), /locations/ modified 2026-09-04, /iko-pro-centre/
//   2026-05-02, uploads under /2026/03 and /2026/04. /masirah-island/ itself was last edited 2022-01-25 but is
//   still linked in the live site menu. Oman Observer reported the 2026 Masirah kite season on 2026-06-03,
//   2026-07-01 and 2026-09-17 (no operator named).
//
// Data path (checked 2026-10-12), WordPress (Jetpack Photon images):
//   content  /masirah-island/ (camp, accommodation, travel, photos), /masirah-iko/ (2026 page: spot, season,
//            IKO centre services), /locations/ (base, "Accommodation available on-site"), /iko-pro-centre/
//            (IKO course prices in OMR).
//   slots    none: no page prints a price, room type or date for the camp accommodation -> [] ("price on
//            request"). Bookings by WhatsApp (+968 7733 3579) or contact@globaledventuretravel.com.
// robots.txt (2026-10-12): only /wp-admin/ disallowed.
// Requests per run: content 4, slots 0.
// Known limits: no room/hut descriptions on GET's site (Kiteboarding Oman's older pages describe wooden huts
//   and "Deluxe Rooms", not used); the /locations/ map embed is a place-name query ("masirah beach camp"), not
//   coordinates, so no spotCoords. Season wording differs per page (May-August on /locations/, May-September on
//   /masirah-island/ and /masirah-iko/).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, imageCandidates, parse } from '../parse.js';
import type { FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://kitesurfoman.com';
export const MBC_MASIRAH_URL = `${SITE}/masirah-island/`;
export const MBC_IKO_URL = `${SITE}/masirah-iko/`;
export const MBC_LOCATIONS_URL = `${SITE}/locations/`;
export const MBC_COURSES_URL = `${SITE}/iko-pro-centre/`;
const CONTACT_URL = `${SITE}/contact-us/`;

// --- local helpers ----------------------------------------------------------------------------
/** Visible text split at block tags, one entry per heading / paragraph / list item / cell. */
export function mbcLines(html: string): string[] {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, svg, header, footer, nav')) el.remove();
  return root.innerHTML
    .split(/<\/?(?:p|li|td|th|tr|h\d|div|br|ul|ol|section|article)\b[^>]*>/i)
    .map(s => clean(s.replace(/<[^>]+>/g, ' ')).replace(/[–—]/g, '-'))
    .filter(Boolean);
}
const uniq = (xs: string[]): string[] => [...new Set(xs)];
const sentence = (text: string, re: RegExp): string | null => text.match(re)?.[0]?.trim() ?? null;

// --- pure parsers -----------------------------------------------------------------------------
export interface MbcBase { season: string | null; location: string | null; base: string | null; facts: string[] }

/** /locations/: the "Masirah Island - Main Kite Centre" block (season, location, base, facts). */
export function parseMbcBase(html: string): MbcBase {
  const lines = mbcLines(html);
  const i = lines.findIndex(l => /^Masirah Island - Main Kite Centre/i.test(l));
  if (i < 0) return { season: null, location: null, base: null, facts: [] };
  const seasonLine = [...lines.slice(0, i)].reverse().find(l => /Season\s*\(/i.test(l)) ?? null;
  const block: string[] = [];
  for (const l of lines.slice(i + 1)) {
    if (/Season\s*\(|Main Muscat Centre/i.test(l)) break;
    if (!block.includes(l)) block.push(l);
  }
  const val = (re: RegExp): string | null => block.map(l => l.match(re)?.[1]?.trim()).find(Boolean) ?? null;
  return {
    season: seasonLine,
    location: val(/^Location:\s*(.+)$/i),
    base: val(/^Base:\s*(.+)$/i),
    facts: block.filter(l => !/^(Location|Base|Ideal for):/i.test(l) && !/^(Location|Base|Ideal for):?$/i.test(l)),
  };
}

export interface MbcCamp { operates: string | null; travel: string | null; activities: string | null; access: string | null; lagoon: string | null }

/** /masirah-island/: the camp and accommodation sentences. */
export function parseMbcCamp(html: string): MbcCamp {
  const t = mbcLines(html).join(' ');
  return {
    operates: sentence(t, /Our kite centre operates out of the Masirah Beach Camp[^.]*\.(?:\s*Bookings can be made[^.]*\.)?/i),
    travel: sentence(t, /The travel time to the furthest kite-spots[^.]*\./i),
    activities: sentence(t, /we offer a range of accommodation packages and other activities[^.]*\./i),
    access: sentence(t, /The journey to Masirah[^.]*\./i),
    lagoon: sentence(t, /With its flat water lagoons[^.]*\./i),
  };
}

export interface MbcIko { stats: string[]; services: string[]; spot: string[] }

/** /masirah-iko/ (2026): season stats (.stat .k/.v), the "✓" service list (ul.list li) and the spot facts. */
export function parseMbcIko(html: string): MbcIko {
  const root = parse(html);
  const txt = (el: { text: string } | null): string => (el ? clean(el.text).replace(/[–—]/g, '-') : '');
  const stats = root.querySelectorAll('.stat').map(s => `${txt(s.querySelector('.k'))}: ${txt(s.querySelector('.v'))}`).filter(s => !/^:|: $/.test(s));
  const services = uniq(root.querySelectorAll('ul.list li').map(li => txt(li).replace(/^✓\s*/, '')).filter(Boolean));
  const spot = uniq(mbcLines(html).filter(l => /^(A vast, shallow lagoon|The Arabian Sea side|From roughly mid-June|No packed line-ups)/i.test(l)));
  return { stats, services, spot };
}

export interface MbcCourse { name: string; duration: string | null; level: string | null; privatePrice: number | null; groupPrice: number | null }

/** /iko-pro-centre/: IKO courses with private and 2-person prices (OMR). */
export function parseMbcCourses(html: string): MbcCourse[] {
  const lines = mbcLines(html);
  const out: MbcCourse[] = [];
  let cur: MbcCourse | null = null;
  for (const l of lines) {
    const head = l.match(/^(Discovery|Intermediate|Independent|Advanced) Course$/i);
    if (head) { cur = { name: `${head[1]} course`, duration: null, level: null, privatePrice: null, groupPrice: null }; out.push(cur); continue; }
    if (!cur) continue;
    const dur = l.match(/^Approx\. duration:\s*(.+)$/i);
    if (dur && !cur.duration) cur.duration = dur[1].trim();
    const lvl = l.match(/IKO Level (\d)/i);
    if (lvl && /certification/i.test(l) && !cur.level) cur.level = `IKO Level ${lvl[1]}`;
    const priv = l.match(/^Private session[^:]*:\s*OMR\s*([\d.,]+)/i);
    if (priv && cur.privatePrice === null) cur.privatePrice = Number(priv[1].replace(/,/g, ''));
    const grp = l.match(/^Group session \(2 persons\):\s*OMR\s*([\d.,]+)/i);
    if (grp && cur.groupPrice === null) cur.groupPrice = Number(grp[1].replace(/,/g, ''));
  }
  return out.filter(c => c.privatePrice !== null);
}

export interface MbcPages { masirah: string; iko: string; locations: string; courses: string }

export function parseMasirahBeachCampContent(p: MbcPages): OfferContent {
  const base = parseMbcBase(p.locations);
  const camp = parseMbcCamp(p.masirah);
  const iko = parseMbcIko(p.iko);
  const courses = parseMbcCourses(p.courses);
  if (!/Masirah Beach Camp/i.test(base.base ?? '') || !base.facts.some(f => /Accommodation available on-site/i.test(f))) {
    throw new Error(`masirah-beach-camp: /locations/ no longer names Masirah Beach Camp with on-site accommodation (base "${base.base}")`);
  }

  const courseLines = courses.map(c => `IKO ${c.name}${c.duration ? ` (approx. ${c.duration}` : ''}${c.level ? `${c.duration ? ', ' : ' ('}${c.level})` : c.duration ? ')' : ''}: OMR ${c.privatePrice} private${c.groupPrice ? ` / OMR ${c.groupPrice} for 2 persons` : ''}`);
  const imageUrls = imageCandidates(p.masirah, MBC_MASIRAH_URL, null, 30)
    .filter(u => !/kite-surf-oman-2\.png|Untitled-design|logo|icon|\.svg/i.test(u));

  const summary = [
    `Masirah Beach Camp at Sur Masirah on Masirah Island is the summer base of GET Kitesurf Oman, an IKO Pro kite centre that teaches here from May to September; the kite school's site says accommodation is available on-site at the camp, with options for different budgets, booked through GET.`,
    camp.travel ? `The nearest beach is a 2-minute walk from the camp and the furthest kite spots about twenty minutes away.` : '',
    `Masirah has a shallow flat-water lagoon on the west side and ocean waves on the east side; the monsoon wind blows almost daily from about mid-June to August, with lighter wind in May and September.`,
    `GET offers IKO lessons from beginner to advanced, gear rental and rescue cover, and can arrange transfers and the ferry trip; the site prints no accommodation prices, so stays are on request.`,
  ].filter(Boolean).join(' ');

  return {
    kind: 'accommodation',
    title: 'Masirah Beach Camp',
    summary,
    continent: 'Asia',
    country: 'Oman',
    region: 'Al Sharqiyah South',
    spot: `${base.location ?? 'Sur Masirah'}, Masirah Island`,
    itinerarySpots: [],
    durationDays: null,
    // /masirah-iko/: "Beginner to advanced lessons"; /locations/: "Ideal for: All levels"
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: iko.services.some(s => /IKO-certified instruction|lessons/i.test(s)) || courses.length > 0,
    equipmentRental: iko.services.some(s => /Gear rental/i.test(s)) || base.facts.some(f => /Equipment rental/i.test(f)),
    beginnerFriendly: true,
    includedServices: [],
    optionalServices: uniq([
      ...courseLines,
      'Kite gear rental on site (kites and boards)',
      'Rescue support on the water',
      'Transfers and full Masirah trip packages arranged by GET',
      ...(camp.activities ? ['Biking, hiking, yoga, kayaking and boat trips'] : []),
    ]),
    accommodation: 'beach camp accommodation at the kite centre (several options for every budget)',
    mealPlan: null,
    languages: [],
    rooms: [],
    imageUrls,
    heroVideoUrl: null,
    sourceUrl: MBC_MASIRAH_URL,
    bookingUrl: CONTACT_URL,
    sourceText: [
      `locations: ${[base.season, `Location: ${base.location}`, `Base: ${base.base}`, ...base.facts].join(' | ')}`,
      `masirah-island: ${[camp.activities, camp.operates, camp.travel, camp.lagoon, camp.access].filter(Boolean).join(' | ')}`,
      `masirah-iko: ${[...iko.stats, ...iko.spot, ...iko.services].join(' | ')}`,
      `courses: ${courseLines.join(' | ')}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const masirahBeachCampSurMasirah: OfferAdapter = {
  key: 'masirah-beach-camp-sur-masirah',
  name: 'Masirah Beach Camp (GET Kitesurf Oman)',
  kind: 'accommodation',
  operator: {
    name: 'GET Kitesurf Oman (Global Edventure Travel)',
    websiteUrl: SITE,
    rootDomain: 'kitesurfoman.com',
    contactEmail: 'contact@globaledventuretravel.com',
    whatsapp: '+96877333579',
    phone: '+968 7733 3579',
  },
  url: MBC_MASIRAH_URL,
  slotMethod: 'price_table', // no prices on the site: always [] (price on request)
  fetchBudget: 4,
  confidence: 'low',
  async fetchContent() {
    const masirah = await fetchText(MBC_MASIRAH_URL, { accept: 'text/html' });
    const iko = await fetchText(MBC_IKO_URL, { accept: 'text/html' });
    const locations = await fetchText(MBC_LOCATIONS_URL, { accept: 'text/html' });
    const courses = await fetchText(MBC_COURSES_URL, { accept: 'text/html' });
    return parseMasirahBeachCampContent({ masirah, iko, locations, courses });
  },
  async fetchSlots(ctx: FetchContext): Promise<Slot[]> {
    ctx.note('kitesurfoman.com prints no accommodation prices or dates for Masirah Beach Camp: price on request');
    return [];
  },
};
