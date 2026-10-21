// ---------------------------------------------------------------------------
// ExotiKite - Baja Wave Camps (Pacific coast of Baja California Sur, Mexico): spring wave-riding weeks run by the
// Los Barriles kite school ExotiKite at a gentle right-hand point break off a sandbar: surfing / tow-in foiling in
// the calm mornings, kiting in the 20-25 kn afternoon wind, daily clinics with video feedback, yoga, single
// accommodation, three meals a day, all gear, rescue boat, transfers from Loreto airport. Kind 'camp'.
//
// LOCATION: the page names no beach or town, only "the Baja Pacific coast", "a gentle right point break off a huge
//   sandbar" and transfers "to and from Loreto airport" -> region-level "Baja California Sur Pacific coast". Spot
//   "Pacific coast near San Juanico" + pin (2026-10-21, Aaron): APPROXIMATE at San Juanico, see spotCoords; replace once ExotiKite names the break.
//
// Data path (checked 2026-10-19), WordPress + Divi:
//   slots    "Baja Wave Camps 2026" heading followed by week boxes "April 4 – 11", "April 11 – 18", "April 18-25",
//            "April 25-May 2 FULL" (struck through), "May 2-9 FULL"; "Wave Camp Pricing $ 2,999" (one price for every
//            week; "Single accommodation" is included -> per person). Currency: the page prints only "$"; the
//            site never names it (US phone number, English-only site) -> USD INFERRED. One slot per future week,
//            package, person; "FULL" -> sold_out, else on_request (contact by phone / mail; no online booking ->
//            instantBooking false).
//   content  the same page (wind / wave text, inclusions, coach photos).
//   photos   (2026-10-21) the camp page only carries the 4 coach portraits (400x400, below the size floor). The site
//            has no gallery, blog or post sitemap (sitemap.xml lists only page-sitemap.xml), and no photo on it is
//            labelled or recognisable as the Pacific wave camp: all action shots are from the Los Barriles school on
//            the Sea of Cortez. So, per Aaron's brief, only a few ExotiKite kiting photos are added (EXO_KITE_PHOTOS):
//            the home page's "Wave Camps" tile (wave-camps-los-barriles-baja), a rider jumping in chop (lessons page),
//            the kiters on the wind page and the school's lesson photo (about page), read from the page sitemap's
//            <image:loc> list (1 request; robots allows /wp-content/uploads/, only /assets/ is disallowed). Lifestyle,
//            yoga, kids, rental-house, efoil and SUP photos are not used.
// robots.txt (2026-10-19): only /assets/ disallowed.
// State 2026-10-19: all five 2026 weeks are past -> 0 slots until the page shows the 2027 weeks; the parser reads
//   whatever year and weeks the heading block lists.
// Requests per run: slots 1, content 2 (camp page memoised + page-sitemap.xml for photos; a failing sitemap only
//   drops those photos).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { imageCandidates, iso, monthOf, parseAmount, todayIso } from '../parse.js';
import type { OfferAdapter, OfferContent, Slot } from '../types.js';
import { wixLines } from './kite-buen-hombre-eco-lodge.js';

const SITE = 'https://exotikite.com';
export const EXO_URL = `${SITE}/baja-wave-camps/`;
export const EXO_PAGE_SITEMAP_URL = `${SITE}/page-sitemap.xml`;
/** ExotiKite kiting photos used for the wave camps (Los Barriles, no Pacific wave-camp photo exists on the site). */
const EXO_KITE_PHOTOS = new Set([
  'wave-camps-los-barriles-baja.webp', 'advanced-kiteboarding-lessons.jpg',
  'kite-wind-conditions-los-barriles-baja-mexico.webp', 'exotikite-los-barriles-kite-boarding-school.webp',
]);

/** The chosen kiting photos from the page sitemap's <image:loc> entries (original uploads). */
export function parseExoSitePhotos(xml: string): string[] {
  const out: string[] = [];
  for (const m of xml.matchAll(/<image:loc>\s*(https?:\/\/exotikite\.com\/wp-content\/uploads\/[^<\s]+)\s*<\/image:loc>/g)) {
    const u = m[1].replace(/^http:/, 'https:');
    if (EXO_KITE_PHOTOS.has(u.split('/').pop() ?? '') && !out.includes(u)) out.push(u);
  }
  return out;
}
/** The site prints "$" only; USD inferred (see header). */
const CURRENCY = 'USD';

const memo = new Map<string, { at: number; p: Promise<string> }>();
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

/** Visible text lines (scripts / styles / SVG dropped); works for any HTML, not only Wix. */
const lines = (html: string): string[] => wixLines(html).map(s => s.replace(/[–—]/g, '-').trim()).filter(Boolean);

export interface ExoWeek { start: string; end: string; label: string; full: boolean }
export interface ExoCamps { year: number | null; weeks: ExoWeek[]; price: number | null }

export function parseExoCamps(html: string): ExoCamps {
  const ls = lines(html);
  const h = ls.findIndex(l => /^Baja Wave Camps (20\d{2})$/i.test(l));
  const year = h >= 0 ? Number(ls[h].match(/(20\d{2})/)![1]) : null;
  const weeks: ExoWeek[] = [];
  if (year !== null) {
    for (let i = h + 1; i < ls.length && i < h + 40; i++) {
      const m = ls[i].match(/^([A-Z][a-z]+)\.? (\d{1,2})\s*-\s*(?:([A-Z][a-z]+)\.? )?(\d{1,2})(?:\s+(FULL|SOLD OUT))?$/i);
      if (!m) {
        if (/^(FULL|SOLD OUT)$/i.test(ls[i])) continue;
        if (weeks.length) break;     // the block of week boxes ended
        continue;
      }
      const m1 = monthOf(m[1]);
      const m2 = m[3] ? monthOf(m[3]) : m1;
      if (!m1 || !m2) continue;
      const start = iso(year, m1, +m[2]);
      const end = iso(m2 < m1 ? year + 1 : year, m2, +m[4]);
      const full = !!m[5] || /^(FULL|SOLD OUT)$/i.test(ls[i + 1] ?? '');
      weeks.push({ start, end, label: `${m[1]} ${m[2]}-${m[3] ? `${m[3]} ` : ''}${m[4]}`, full });
    }
  }
  const p = ls.findIndex(l => /Wave Camp Pricing/i.test(l));
  const priceLine = p >= 0 ? ls.slice(p, p + 3).find(l => /\$\s?\d/.test(l)) : null;
  return { year, weeks, price: priceLine ? parseAmount(priceLine.replace(/^[^$]*\$/, '')) : null };
}

export function buildExoSlots(c: ExoCamps, today: string): Slot[] {
  return c.weeks.filter(w => w.start >= today).map(w => ({
    key: w.start,
    startDate: w.start,
    endDate: w.end,
    unit: 'Wave camp week, single accommodation',
    price: c.price,
    currency: c.price !== null ? CURRENCY : null,
    priceUnit: c.price !== null ? 'package' : null,
    priceBasis: c.price !== null ? 'person' : null,
    occupancy: 1,
    availability: w.full ? 'sold_out' : 'on_request',
    availabilityText: `${w.label}${w.full ? ' FULL' : ''}${c.price !== null ? ` · $ ${c.price.toLocaleString('en-US')} (USD inferred)` : ''}`,
    spotsLeft: null,
  }));
}

export function parseExoContent(html: string, today = todayIso(), sitePhotos: string[] = []): OfferContent {
  const c = parseExoCamps(html);
  const text = lines(html).join(' | ');
  const next = c.weeks.filter(w => w.start >= today);
  const nights = c.weeks[0] ? Math.round((Date.parse(c.weeks[0].end) - Date.parse(c.weeks[0].start)) / 86400000) : 7;
  const datesLine = next.length
    ? `Weeks ${c.year}: ${next.map(w => `${w.label}${w.full ? ' (full)' : ''}`).join(', ')}.`
    : `The ${c.year ? c.year + 1 : 'next'} weeks are not published yet${c.weeks.length ? ` (${c.year}: ${c.weeks.map(w => w.label).join(', ')})` : ''}.`;
  const imgs = imageCandidates(html, EXO_URL, null, 40).filter(u => !/logo|icon|favicon|cropped-/i.test(u));

  return {
    kind: 'camp',
    title: 'ExotiKite Baja Wave Camps',
    summary: [
      `Spring wave camps on the Pacific coast of Baja California Sur, Mexico, run by the Los Barriles kite school ExotiKite: ${nights} nights with single accommodation and three meals a day at a gentle right-hand point break off a sandbar (no reef), surfing and tow-in foiling in the calm mornings and kiting in the 20-25 knot afternoon wind.`,
      'Daily clinics with video feedback (wave riding, jibes, tacks, jumps), yoga, all ExotiKite kites, boards, foils and SUPs, a rescue boat and transfers from Loreto airport are included. The page does not name the beach; the map pin near San Juanico is approximate.',
      `${datesLine}${c.price ? ` Price: $${c.price.toLocaleString('en-US')} per person.` : ''}`,
    ].join(' '),
    continent: 'North America',
    country: 'Mexico',
    region: 'Baja California Sur Pacific coast',
    spot: 'Pacific coast near San Juanico',
    // APPROXIMATE (Aaron 2026-10-21: show it on the map): San Juanico town (OSM). Inferred from the page (Pacific
    // right point break off a sandbar, transfers from Loreto) + old ExotiKite forum posts ("remote little village"
    // ~4 h from Loreto, boat to the sandbar); Magdalena Bay is the other candidate. Asked ExotiKite (backlog).
    spotCoords: { lat: 26.2575, lng: -112.4785 },
    itinerarySpots: [],
    durationDays: nights + 1,
    skillLevels: ['intermediate', 'advanced'],
    kiteLessons: true,
    equipmentRental: true,
    beginnerFriendly: false,
    includedServices: [
      'Transportation to and from Loreto airport',
      `${nights} nights single accommodation, 3 meals daily`,
      "Use of ExotiKite's kites, kiteboards, SUPs, foil boards and surfboards",
      'Instruction and clinics (wave riding, jibes, tacks, jumps) with video / photo feedback',
      'Tow-in foilsurfing and wingfoiling, yoga, rescue boat',
    ],
    optionalServices: [],
    accommodation: 'single accommodation at the wave camp',
    mealPlan: 'full_board',
    languages: ['en'],
    rooms: [],
    imageUrls: [...new Set([...imgs, ...sitePhotos])].slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: EXO_URL,
    bookingUrl: EXO_URL,
    sourceText: [
      `page: ${text}`,
      `parsed: year ${c.year}; weeks ${c.weeks.map(w => `${w.start}..${w.end}${w.full ? ' FULL' : ''}`).join(', ')}; price $${c.price}`,
    ].join('\n'),
  };
}

export async function fetchExoSlots(today: string, ctx?: { note(t: string): void }): Promise<Slot[]> {
  const c = parseExoCamps(await page(EXO_URL));
  if (!c.year || c.weeks.length === 0) throw new Error('exotikite: "Baja Wave Camps <year>" week list not found (layout changed?)');
  if (c.price === null) ctx?.note('"Wave Camp Pricing" amount not found; slots without price');
  const slots = buildExoSlots(c, today);
  if (slots.length === 0) ctx?.note(`all ${c.year} weeks are past (${c.weeks.map(w => w.start).join(', ')}); next weeks not published yet`);
  return slots;
}

export const exotikiteBajaWaveCamps: OfferAdapter = {
  key: 'exotikite-baja-wave-camps',
  name: 'ExotiKite Baja Wave Camps',
  kind: 'camp',
  operator: {
    name: 'ExotiKite',
    websiteUrl: SITE,
    rootDomain: 'exotikite.com',
    contactEmail: 'info@exotikite.com',
    phone: '+15413800948',
  },
  url: EXO_URL,
  slotMethod: 'html_dates',
  liveAvailability: false,
  instantBooking: false,
  fetchBudget: 3,
  async fetchContent(ctx) {
    const html = await page(EXO_URL);
    let photos: string[] = [];
    try {
      photos = parseExoSitePhotos(await fetchText(EXO_PAGE_SITEMAP_URL, { accept: 'application/xml' }));
    } catch (e) {
      ctx.note(`page sitemap for photos unavailable: ${e instanceof Error ? e.message : String(e)}`);
    }
    return parseExoContent(html, todayIso(), photos);
  },
  fetchSlots: ctx => fetchExoSlots(todayIso(), ctx),
};
