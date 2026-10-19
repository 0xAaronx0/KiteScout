// ---------------------------------------------------------------------------
// Kiteriders Montenegro (Kite & Travel Montenegro d.o.o., Austrian/Swiss VDWS school) - kite camp packages with
// accommodation in the Kiteriders Garden Villas, Ulcinj: apartments a few minutes from the school's station on Velika
// Plaza (Long Beach), shuttle to the kite center included, combined with a kite course or rental as the guest chooses.
//
// Data path (checked 2026-10-19): ONE page, the WordPress (Enfold) one-pager https://www.kitesurfing-montenegro.com/,
//   section #packages "YOUR KITE CAMP: PACKAGES WITH ACCOMMODATION":
//     "ROOM RATES 2026:" -> "Low Season*:" / "High Season*:" lists ("2-persons apartment only 50 Euro p.P./night",
//     "Single use only 61 Euro p.P./night", "3-persons apartment only 39 Euro p.P./night") and the season limits
//     ("*Low Season: May 16th to July 5th", "*High Season: July 6th to September 6th"), + EUR 1 local tax p.P./night.
//   The course prices are "from" prices on the same page (#kurse: basic beginner's course from EUR 259, intensive
//   from EUR 379, combos from EUR 395); the detailed course / rental price lists are PDFs we do not read.
//   The map block's Google Maps link (query=41.8797...,19.3220...) gives the kite center's coordinates (spotCoords).
// Modular package: nightly accommodation rate per person + a course of the guest's choice; no fixed length. Slots are
//   the accommodation bands (season x apartment type), priceUnit 'per_night', priceBasis 'person'; the course is listed
//   in optionalServices. durationDays 8 (= a one-week stay) is our default for the listing, not a printed package
//   length (inferred; the camp kind needs a duration).
// Booking: "BOOK NOW" -> /enquiry/ (inquiry form) -> 'on_request'; flags unset.
// robots.txt (2026-10-19): "User-agent: * / Disallow:" (everything allowed).
// Requests per run: 1 (content and slots share one memoised page fetch).
// State 2026-10-19: the page shows only the 2026 rates; the season ended on 6 September 2026 -> 0 slots ("price on
//   request") until the page prints the next season's rates. Bands that end today or later are kept.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, imageCandidates, iso, monthOf, parse, todayIso, type HTMLElement } from '../parse.js';
import { upscaleCdnUrl } from '../../lib/images.js';
import type { FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

export const KRM_URL = 'https://www.kitesurfing-montenegro.com/';
const ENQUIRY_URL = 'https://www.kitesurfing-montenegro.com/enquiry/';
/** kite center on Velika Plaza from the page's map marker (2026-10-19); used when the marker is missing */
const FALLBACK_COORDS = { lat: 41.8797, lng: 19.322 };

const memo = new Map<string, { at: number; p: Promise<string> }>();
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url);
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}
const txt = (el: HTMLElement | null | undefined): string => collapse(el?.text ?? '');

function packagesSection(html: string): HTMLElement | null {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript')) el.remove();
  // the heading sits in its own section (#packages); villas text, rates and gallery follow in the next section
  const head = root.querySelector('#packages');
  if (!head) return null;
  const next = head.nextElementSibling;
  return next ?? head;
}

// --- rates ------------------------------------------------------------------------------------------------------------
export interface KrmRate { season: 'low' | 'high'; unit: string; key: string; occupancy: number; price: number }
export interface KrmSeason { season: 'low' | 'high'; start: string; end: string }
export interface KrmRates { year: number | null; rates: KrmRate[]; seasons: KrmSeason[]; localTax: number | null }

const day = (s: string) => Number(s.replace(/\D/g, ''));

export function parseKrmRates(html: string): KrmRates {
  const sec = packagesSection(html);
  const out: KrmRates = { year: null, rates: [], seasons: [], localTax: null };
  if (!sec) return out;
  const t = txt(sec);
  const y = t.match(/ROOM RATES\s+(20\d{2})/i);
  out.year = y ? +y[1] : null;
  // lists: walk the textblock in document order, remembering the current "Low/High Season*:" heading
  let season: 'low' | 'high' | null = null;
  for (const el of sec.querySelectorAll('p, li')) {
    const line = txt(el);
    if (el.tagName === 'P') {
      if (/^low season\*?:?$/i.test(line)) season = 'low';
      else if (/^high season\*?:?$/i.test(line)) season = 'high';
      const lim = line.match(/\*\s*(Low|High) Season:\s*([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?\s+to\s+([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?/i);
      if (lim && out.year && monthOf(lim[2]) && monthOf(lim[4])) {
        out.seasons.push({ season: lim[1].toLowerCase() as 'low' | 'high', start: iso(out.year, monthOf(lim[2])!, day(lim[3])), end: iso(out.year, monthOf(lim[4])!, day(lim[5])) });
      }
      const tax = line.match(/fee of (\d+(?:[.,]\d+)?) Euro per person\/night for local tax/i);
      if (tax) out.localTax = Number(tax[1].replace(',', '.'));
      continue;
    }
    if (!season) continue;
    const m = line.match(/^(.*?)\s+only\s+(\d+(?:[.,]\d+)?)\s*(?:Euro|EUR|€)\s*p\.?\s*P\.?\s*\/\s*night/i);
    if (!m) continue;
    const label = m[1].trim();
    const occ = /single/i.test(label) ? 1 : Number(label.match(/(\d)-persons?/i)?.[1] ?? 2);
    const unit = /single/i.test(label) ? 'Apartment, single use' : `${occ}-person apartment`;
    out.rates.push({ season, unit, key: /single/i.test(label) ? 'single' : `apt${occ}`, occupancy: occ, price: Number(m[2].replace(',', '.')) });
  }
  return out;
}

export function buildKrmSlots(r: KrmRates, today: string): Slot[] {
  const slots: Slot[] = [];
  for (const s of r.seasons) {
    if (s.end < today) continue;
    for (const rate of r.rates.filter(x => x.season === s.season)) {
      slots.push({
        key: `${rate.key}|${s.start}`,
        startDate: s.start,
        endDate: s.end,
        unit: `${rate.unit} (Kiteriders Garden Villas; course or rental booked separately)`,
        price: rate.price,
        currency: 'EUR',
        priceUnit: 'per_night',
        priceBasis: 'person',
        occupancy: rate.occupancy,
        availability: 'on_request',
        availabilityText: `${s.season === 'low' ? 'Low' : 'High'} season rate EUR ${rate.price} p.P./night${r.localTax ? ` + EUR ${r.localTax} local tax` : ''}; booking by enquiry`,
        spotsLeft: null,
      });
    }
  }
  return slots;
}

export async function fetchKrmSlots(ctx: FetchContext, today = todayIso()): Promise<Slot[]> {
  const r = parseKrmRates(await page(KRM_URL));
  if (!r.year || r.rates.length === 0 || r.seasons.length === 0) {
    throw new Error(`kiteriders-montenegro: room rates not found (year ${r.year}, ${r.rates.length} rates, ${r.seasons.length} seasons; layout changed?)`);
  }
  const slots = buildKrmSlots(r, today);
  if (slots.length === 0) ctx.note(`all ${r.year} season bands are past (${r.seasons.map(s => `${s.start}..${s.end}`).join(', ')}); next rates not printed yet`);
  return slots;
}

// --- content ----------------------------------------------------------------------------------------------------------
/** "from € 259" prices of the course cards (#kurse). */
export function parseKrmCourses(html: string): Array<{ name: string; from: number }> {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript')) el.remove();
  const lines = root.structuredText.split('\n').map(l => collapse(l)).filter(Boolean);
  const out: Array<{ name: string; from: number }> = [];
  for (let i = 1; i < lines.length; i++) {
    const m = lines[i].match(/^from\s*€\s*(\d+)$/i);
    const name = lines[i - 1].replace(/^privatecourse$/i, 'Private course').replace(/^./, c => c.toUpperCase());
    if (m && /course|combo|refresher/i.test(name) && !/wingfoil/i.test(name) && !out.some(o => o.name === name)) out.push({ name, from: +m[1] });
  }
  return out;
}

export function krmCoords(html: string): { lat: number; lng: number } {
  // the map's "open in a new window" link (google.com/maps/search/?api=1&query=<lat>,<lng>), else the map script's marker
  const q = html.match(/google\.com\/maps\/search\/\?api=1&(?:#038;|amp;)?query=(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (q) return { lat: Math.round(+q[1] * 1e4) / 1e4, lng: Math.round(+q[2] * 1e4) / 1e4 };
  const lat = html.match(/\['marker'\]\['0'\]\['lat'\]\s*=\s*(-?\d+\.\d+)/);
  const lng = html.match(/\['marker'\]\['0'\]\['long'\]\s*=\s*(-?\d+\.\d+)/);
  if (lat && lng) return { lat: Math.round(+lat[1] * 1e4) / 1e4, lng: Math.round(+lng[1] * 1e4) / 1e4 };
  return FALLBACK_COORDS;
}

export function parseKrmContent(html: string, today = todayIso()): OfferContent {
  const sec = packagesSection(html);
  const secText = txt(sec);
  const r = parseKrmRates(html);
  const courses = parseKrmCourses(html);
  const features = sec ? sec.querySelectorAll('ul li').map(li => txt(li)).filter(l => !/p\.?P\.?\/night/i.test(l)) : [];
  const min = r.rates.length ? Math.min(...r.rates.map(x => x.price)) : null;
  const max = r.rates.length ? Math.max(...r.rates.map(x => x.price)) : null;
  const beginner = courses.find(c => /basic-beginner/i.test(c.name));
  const future = r.seasons.some(s => s.end >= today);
  const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });
  const seasonSpan = r.seasons.length ? `${fmt(r.seasons.map(s => s.start).sort()[0])} - ${fmt(r.seasons.map(s => s.end).sort().reverse()[0])}` : 'May - September';
  const summary = [
    `Kiteriders Montenegro, a VDWS kite school from Lake Neusiedl, runs its station on Velika Plaza, the 14 km sandy beach at Ulcinj with shallow standing water and thermal side-onshore wind from May to September.`,
    `Its kite camp packages combine an apartment in the Kiteriders Garden Villas (pool, garden, rooftop terrace, kitchen in every apartment, shuttle to the kite center) with a course or rental of your choice, put together per stay.`,
    min !== null ? `Accommodation ${r.year}: EUR ${min}-${max} per person per night by apartment type and season${beginner ? `, beginner courses from EUR ${beginner.from}` : ''}; booking is by enquiry.` : 'Booking is by enquiry.',
    future ? `Season ${r.year}: ${seasonSpan}.` : `Runs every summer; ${r.year ? r.year + 1 : 'next'} rates are not published yet (${r.year ?? ''} season: ${seasonSpan}).`,
  ].join(' ');

  const gallery = sec ? sec.querySelectorAll('.avia-gallery a[href]').map(a => upscaleCdnUrl(new URL(a.getAttribute('href')!, KRM_URL).toString())) : [];
  const imageUrls = [...new Set([...gallery, ...imageCandidates(html, KRM_URL, null, 40)])]
    .filter(u => !/logo|icon|_button|-\d{2,3}x\d{2,3}\.(jpe?g|png|webp)$/i.test(u))
    .slice(0, 40);

  return {
    kind: 'camp',
    title: 'Kiteriders Montenegro Kite Camp, Garden Villas Ulcinj',
    summary,
    continent: 'Europe',
    country: 'Montenegro',
    region: 'Velika Plaza, Ulcinj',
    spot: 'Velika Plaza',
    spotCoords: krmCoords(html),
    itinerarySpots: [],
    durationDays: 8,
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: true,
    equipmentRental: true,
    beginnerFriendly: true,
    includedServices: features.length ? features : ['Apartment in the Kiteriders Garden Villas', 'Shuttle service to the kite center'],
    optionalServices: [
      ...courses.map(c => `${c.name}: from EUR ${c.from}`),
      ...(r.localTax ? [`Local tax EUR ${r.localTax} per person per night`] : []),
    ],
    accommodation: 'Kiteriders Garden Villas: apartments for 1-3 persons with kitchen, balcony and air-conditioning, pool and garden, a few minutes by car from the beach',
    mealPlan: 'self_catering',
    languages: ['de', 'en'],
    rooms: [
      { name: '2-person apartment', description: 'Full-sized bed for two, extendible couch, two separate rooms, kitchen, bathroom, balcony', features: [] },
      { name: '3-person apartment', description: 'Same apartment with the couch in use', features: [] },
      { name: 'Apartment, single use', description: null, features: [] },
    ],
    imageUrls,
    heroVideoUrl: null,
    sourceUrl: `${KRM_URL}#packages`,
    bookingUrl: ENQUIRY_URL,
    sourceText: [
      `packages: ${secText}`,
      `courses: ${courses.map(c => `${c.name} from EUR ${c.from}`).join('; ')}`,
      `parsed: year ${r.year}; seasons ${r.seasons.map(s => `${s.season} ${s.start}..${s.end}`).join(', ')}; rates ${r.rates.map(x => `${x.season} ${x.unit} ${x.price}`).join(', ')}`,
    ].join('\n'),
  };
}

export const kiteridersMontenegroCampUlcinj: OfferAdapter = {
  key: 'kiteriders-montenegro-camp-ulcinj',
  name: 'Kiteriders Montenegro Kite Camp, Garden Villas Ulcinj',
  kind: 'camp',
  operator: {
    name: 'Kiteriders Montenegro',
    websiteUrl: KRM_URL,
    rootDomain: 'kitesurfing-montenegro.com',
    contactEmail: 'montenegro@kiteriders-surfreisen.at',
    phone: '+38269243707',
  },
  url: `${KRM_URL}#packages`,
  slotMethod: 'price_table',
  fetchBudget: 2,
  async fetchContent() {
    return parseKrmContent(await page(KRM_URL));
  },
  fetchSlots: ctx => fetchKrmSlots(ctx),
};
