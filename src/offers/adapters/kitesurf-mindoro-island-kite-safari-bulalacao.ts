// ---------------------------------------------------------------------------
// Kitesurf Mindoro "Island kite safari" ("Imagine Robinson Crusoe would have had a Kite"), Bulalacao (Oriental Mindoro,
// Philippines): a private island-hopping kite or wing safari from the Makani Resort on Bislig Beach with the resort's
// local islander crew - boat support, nights in tents or bamboo huts on the beaches, food and drinks, snorkelling. For
// experienced riders with their own gear (upwind, downwind and deep-water self-rescue required); beginners are sent on
// the day trips instead. A separate product from the resort stay (kitesurf-mindoro-bulalacao.ts, whose Jimdo helpers
// mdLines / mdImages this adapter imports; that file is not edited).
//
// Kind 'tour' (moves island to island). itinerarySpots = the islands the safari page names ("Islands we go to on the
//   safari: Buyayao, Suguicay, Libagao, Nagubat, Semirara, Aslom, Target, Sibolo"), in the page's order; the page gives
//   no fixed route, the crew picks the islands by wind. "Libagao" is written "Liwagao" on the operator's home and
//   day-trip pages; the stop is named Liwagao Island. Regions are inferred (not on the site): Semirara, Liwagao and
//   Sibolo belong to Caluya, Antique; the others lie off Bulalacao / Mansalay, Oriental Mindoro.
//
// Data path (checked 2026-10-21): Jimdo Creator site, server-rendered text.
//   slots    /watersports/safari/ prints "Price per person: 19900 PHP minimum 2 people" and "You choose the date"
//            (season "November - End of April") -> one undated slot, PHP, priceUnit 'package', priceBasis 'person',
//            occupancy 2 (the minimum group), availability 'on_request' (inquiry form "Date + number of people").
//   content  the safari page + the home page (its teaser "Kite & Wingsafari 3days / 3D/2 nights") + the day-trip page
//            (photos of the same islands).
// Duration: the safari page itself does NOT state the length; the home page teaser says 3 days / 2 nights, so
//   durationDays = 3 comes from the home page (null if the teaser disappears; the ingest then rejects the content,
//   which is the right signal). Whether PHP 19,900 covers exactly those 3 days is not printed (inferred).
// Photos: the safari page only embeds a YouTube video; candidates are the home teaser photo of the safari, the
//   day-trip page photos (Suguicay, Liwagao / Nagubat, Aslom, Maasin, Buktot downwinders: same islands, same crew);
//   checked by eye 2026-10-21 (boat crew, island aerials, sandbar with kites, a kiter on the reef). The other home
//   teasers are a SUP photo and a near-duplicate sandbar aerial, so they are not used. 6 candidates.
// robots.txt (2026-10-21): disallows /app/ and /j/ only; "Crawl-Delay: 5" -> this adapter waits 5 s between its own
//   live requests (no wait when replaying fixtures).
// Requests per run: content 3 (safari, home, day trip), slots 1 (safari; memoised within a run).
// Flags: liveAvailability no (page text), instantBooking no (inquiry form).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { todayIso } from '../parse.js';
import type { FetchContext, ItinerarySpot, OfferAdapter, OfferContent, Slot } from '../types.js';
import { mdImages, mdLines } from './kitesurf-mindoro-bulalacao.js';

const SITE = 'https://www.kitesurf-mindoro.com';
export const MDS_SAFARI_URL = `${SITE}/watersports/safari/`;
export const MDS_HOME_URL = `${SITE}/`;
export const MDS_DAYTRIP_URL = `${SITE}/watersports/daytrip/`;
const CRAWL_DELAY_MS = 5_000;

// --- local helpers ----------------------------------------------------------------------------
let lastLive = 0;
const memo = new Map<string, { at: number; p: Promise<string> }>();
/** robots.txt asks for Crawl-delay: 5 - waits between live requests (no wait when replaying fixtures); memoised 10 min. */
function mdsGet(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = (async () => {
    if (!process.env.OFFERS_FIXTURE_DIR) {
      const wait = lastLive + CRAWL_DELAY_MS - Date.now();
      if (lastLive > 0 && wait > 0) await new Promise(r => setTimeout(r, wait));
      lastLive = Date.now();
    }
    return fetchText(url, { accept: 'text/html' });
  })();
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

// --- pure parsers -----------------------------------------------------------------------------
export interface MdsSafari {
  price: number | null;
  currency: string | null;
  minPeople: number | null;
  priceLine: string | null;
  islands: string[];
  included: string[];
  season: string | null;
  requirements: string | null;
  intro: string | null;
}

/** The safari page: price line, island list, inclusions, season. */
export function parseMdsSafari(html: string): MdsSafari {
  const lines = mdLines(html);
  const priceLine = lines.find(l => /^Price per person/i.test(l)) ?? null;
  const pm = priceLine?.match(/(\d[\d.,]*)\s*(PHP|₱|EUR|€|USD)/i) ?? null;
  const cur = pm ? ({ php: 'PHP', '₱': 'PHP', eur: 'EUR', '€': 'EUR', usd: 'USD' } as Record<string, string>)[pm[2].toLowerCase()] ?? null : null;
  const islandsLine = lines.find(l => /^Islands we go to/i.test(l)) ?? '';
  const islands = islandsLine.replace(/^[^:]*:\s*/, '').replace(/\.$/, '').split(/\s*,\s*|\s+and\s+/).map(s => s.trim()).filter(Boolean);
  const incLine = lines.find(l => /^Included in the trip/i.test(l)) ?? '';
  const included = incLine.replace(/^[^:]*:\s*/, '').split(/\s*,\s*/).map(s => s.trim()).filter(Boolean)
    .map(s => s.replace(/accomodation/i, 'accommodation')).map(s => s.charAt(0).toUpperCase() + s.slice(1));
  return {
    price: pm ? Number(pm[1].replace(/[.,]/g, '')) : null,
    currency: cur,
    minPeople: Number(priceLine?.match(/minimum\s+(\d+)/i)?.[1] ?? 0) || null,
    priceLine,
    islands,
    included,
    season: lines.find(l => /Kiteseason is on from/i.test(l)) ?? null,
    requirements: lines.find(l => /own gear for this trip/i.test(l)) ?? null,
    intro: lines.find(l => /You choose the date/i.test(l)) ?? null,
  };
}

/** The home page teaser "Kite & Wingsafari 3days" / "3D/2 nights. Book your private safari ..." -> days, nights. */
export function parseMdsDuration(homeHtml: string): { days: number; nights: number | null; line: string } | null {
  const lines = mdLines(homeHtml);
  const line = lines.find(l => /^\d+\s*D\s*\/\s*\d+\s*nights?/i.test(l)) ?? lines.find(l => /safari\s*\d+\s*days/i.test(l));
  if (!line) return null;
  const dn = line.match(/^(\d+)\s*D\s*\/\s*(\d+)\s*nights?/i);
  if (dn) return { days: Number(dn[1]), nights: Number(dn[2]), line };
  const d = line.match(/(\d+)\s*days/i);
  return d ? { days: Number(d[1]), nights: null, line } : null;
}

/** The photo next to the safari teaser on the home page (the image right after the "/watersports/safari/" link). */
export function mdsHomeSafariImage(homeHtml: string): string | null {
  const at = homeHtml.search(/Wingsafari/i);
  if (at < 0) return null;
  return mdImages(homeHtml.slice(at, at + 4000))[0] ?? null;
}

const SPELLING: Record<string, string> = { libagao: 'Liwagao' };
// inferred, see header (Caluya islands belong to Antique, Western Visayas)
const ANTIQUE = new Set(['semirara', 'liwagao', 'sibolo']);

export function mdsStops(islands: string[]): ItinerarySpot[] {
  return islands.map((raw, i) => {
    const name = SPELLING[raw.toLowerCase()] ?? raw;
    return {
      name: /island$/i.test(name) ? name : `${name} Island`,
      country: 'Philippines',
      region: ANTIQUE.has(name.toLowerCase()) ? 'Antique' : 'Oriental Mindoro',
      order: i + 1,
    };
  });
}

export function buildMdsSlots(s: MdsSafari): Slot[] {
  if (s.price === null || !s.currency) return [];
  return [{
    key: 'per-person',
    startDate: null,
    endDate: null,
    unit: 'Island kite or wing safari',
    price: s.price,
    currency: s.currency,
    priceUnit: 'package',
    priceBasis: 'person',
    occupancy: s.minPeople,
    availability: 'on_request',
    availabilityText: `${s.priceLine}; date of your choice in the kite season (November to end of April) by inquiry form; the trip length is not printed with the price`,
    spotsLeft: null,
  }];
}

export interface MdsPages { safari: string; home: string; daytrip: string }

export function parseMdsContent(p: MdsPages): OfferContent {
  const s = parseMdsSafari(p.safari);
  if (!s.islands.length) throw new Error('kitesurf-mindoro-safari: island list not found on the safari page (layout changed?)');
  const dur = parseMdsDuration(p.home);
  const stops = mdsStops(s.islands);
  const imageUrls: string[] = [];
  for (const u of [mdsHomeSafariImage(p.home), ...mdImages(p.daytrip)]) if (u && !imageUrls.includes(u)) imageUrls.push(u);
  const fmt = (n: number) => n.toLocaleString('en-US');

  const summary = [
    'Kitesurf Mindoro, the kite station of the Makani Resort on Bislig Beach near Bulalacao in Oriental Mindoro, runs private island-hopping kite and wing safaris with its local islander crew: a support boat, a different spot every day, and nights in tents or bamboo huts on remote beaches.',
    `The islands on the safari are ${stops.map(x => x.name.replace(/ Island$/, '')).join(', ')}; guide, boat, accommodation, food and drinks and snorkelling are included, and riders bring their own gear and must ride upwind, downwind and rescue themselves in deep water.`,
    `${s.price && s.currency ? `The price is ${s.currency} ${fmt(s.price)} per person with a minimum of ${s.minPeople ?? 2} people` : 'The price is on request'}; the safari page does not state the length, ${dur ? `the home page lists it as ${dur.days} days${dur.nights ? ` / ${dur.nights} nights` : ''}` : 'and no length is printed elsewhere'}. Guests choose their dates in the kite season (November to end of April) and book by inquiry.`,
  ].join(' ');

  return {
    kind: 'tour',
    title: 'Kitesurf Mindoro Island Kite Safari, Bulalacao',
    summary,
    continent: 'Asia',
    country: 'Philippines',
    region: 'MIMAROPA (Oriental Mindoro)',
    spot: 'Bislig Beach, Bulalacao',
    itinerarySpots: stops,
    durationDays: dur?.days ?? null,
    skillLevels: ['advanced'],
    kiteLessons: false,
    equipmentRental: false, // "You need to have your own gear for this trip"
    beginnerFriendly: false, // beginners are pointed to the day trips
    includedServices: s.included,
    optionalServices: ['Wing foil instead of kite (state it in the inquiry)'],
    accommodation: 'tents or bamboo huts on the beach, varying night to night',
    mealPlan: 'full_board',
    languages: ['en'],
    rooms: [],
    imageUrls,
    heroVideoUrl: null, // YouTube embed only
    sourceUrl: MDS_SAFARI_URL,
    bookingUrl: MDS_SAFARI_URL, // the inquiry form sits on the safari page
    sourceText: [
      `safari: ${mdLines(p.safari).filter(l => l.length > 40 && !/cookie|YouTube/i.test(l)).join(' ')}`,
      `home teaser: ${dur?.line ?? '(none)'}`,
      `season: ${s.season ?? ''}`,
    ].join('\n'),
  };
}

export async function fetchMdsSlots(ctx?: Pick<FetchContext, 'note'>): Promise<Slot[]> {
  const s = parseMdsSafari(await mdsGet(MDS_SAFARI_URL));
  if (!s.priceLine) throw new Error('kitesurf-mindoro-safari: "Price per person" line not found (layout changed?)');
  const slots = buildMdsSlots(s);
  if (!slots.length) ctx?.note(`price line not parsed: ${s.priceLine}`);
  return slots;
}

export const kitesurfMindoroIslandKiteSafariBulalacao: OfferAdapter = {
  key: 'kitesurf-mindoro-island-kite-safari-bulalacao',
  name: 'Kitesurf Mindoro - Island Kite Safari (Bulalacao)',
  kind: 'tour',
  operator: {
    name: 'Kitesurf Mindoro',
    websiteUrl: SITE,
    rootDomain: 'kitesurf-mindoro.com',
    contactEmail: 'info@kitesurf-mindoro.com', // as in kitesurf-mindoro-bulalacao.ts (page footer, Cloudflare e-mail protection)
  },
  url: MDS_SAFARI_URL,
  slotMethod: 'price_table',
  instantBooking: false, // inquiry form on the safari page
  fetchBudget: 4,
  confidence: 'medium', // undated price; duration only from the home teaser
  async fetchContent() {
    const safari = await mdsGet(MDS_SAFARI_URL);
    const home = await mdsGet(MDS_HOME_URL);
    const daytrip = await mdsGet(MDS_DAYTRIP_URL);
    return parseMdsContent({ safari, home, daytrip });
  },
  fetchSlots: ctx => fetchMdsSlots(ctx),
};
