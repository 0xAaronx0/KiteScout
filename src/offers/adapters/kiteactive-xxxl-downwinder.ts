// ---------------------------------------------------------------------------
// KiteActive - XXXL Adventure Downwinder Brazil (guided 4x4-supported downwinder, Ceará coast)
//
// Data path (checked 2026-10-09):
//   content  WP page https://www.kiteactive.com/en/destinations/xxxl-adventure-downwinder-in-brazilie/
//            (title, included / not-included lists, page variants) + the trip JSON below.
//   slots    "Book" on the WP page links to KiteActive's own booking app (app.kiteactive.com/trip/<slug>).
//            The app loads GET https://vfrzgbipxdtlkprfgigj.supabase.co/functions/v1/trip-public-data?slug=<slug>
//            (no key; seen in the app's own network requests). It returns products (packages with price and
//            duration), productRuns (departures with seats_taken) and capacity {total, booked, remaining};
//            the app shows capacity.remaining as "6 SPOTS LEFT" (trip-wide, not per package).
//            This is an UNDOCUMENTED public endpoint: ask KiteActive for permission before production use.
// robots.txt (2026-10-09): www.kiteactive.com allows the destination page; app.kiteactive.com "Allow: /";
//   the supabase.co host has no robots.txt (404 = allow).
// Requests per run: slots 2 (page for the current trip slug + JSON), content 2 (page + JSON).
// Parsed: one slot per bookable product run (unit = package tier: XXXL / Xplore / Adventure), price from
//   the product (EUR), end = start + advertised nights, availability from capacity.remaining.
// Known limits:
//   - the WP page text is stale against the app (page: XXXL 23 days to São Luís, "22 nights";
//     app: XXXL 19 days, 26 Oct-13 Nov, EUR 3,599). Slots follow the app; a note flags the mismatch.
//   - run.nights in the app is one more than the product's duration_nights for XXXL/Xplore; we use the
//     advertised duration (matches the page's "On November 13 we leave" for the Adventure leg).
//   - spotsLeft is trip-wide (shared by all packages), currency is not in the JSON (the app shows EUR).
// ---------------------------------------------------------------------------
import { fetchJson, fetchText } from '../http.js';
import { collapse, imageCandidates, monthOf, iso, parse } from '../parse.js';
import type { ItinerarySpot, OfferAdapter, OfferContent, Slot } from '../types.js';

export const KITEACTIVE_PAGE_URL = 'https://www.kiteactive.com/en/destinations/xxxl-adventure-downwinder-in-brazilie/';
const TRIP_DATA_BASE = 'https://vfrzgbipxdtlkprfgigj.supabase.co/functions/v1/trip-public-data?slug=';
/** The app's prices are EUR (WooCommerce shop in EUR, app shows "€ 3.599,00"; checked 2026-10-09). */
const CURRENCY = 'EUR';

// --- JSON shape (only the fields we read) --------------------------------------------
interface KaStay { date: string; label: string | null; accommodation: { title: string | null; image_url: string | null } | null }
interface KaProduct {
  id: string; name: string; price: number | null; is_booking_enabled: boolean | null;
  duration_nights: number | null; tier_label: string | null; image_url: string | null;
  images?: Array<{ url: string }> | null;
  availability_rules?: Array<{ from?: string; to?: string; type?: string; bookable?: string }> | null;
}
interface KaRun { product_id: string; start_date: string; nights: number; price: number | null; seats_taken: number | null; nightly_stays?: KaStay[] | null }
export interface KaTripData {
  trip: { name: string; slug: string; hero_image_url: string | null; hero_video_url: string | null; status?: string | null };
  products: KaProduct[];
  productRuns: KaRun[];
  capacity: { total: number; booked: number; remaining: number } | null;
  addons?: Array<{ name: string; description: string | null; price: number | null }> | null;
  destinationGalleryImages?: string[] | null;
  accommodations?: Array<{ title: string; image_url: string | null }> | null;
}

// --- small local helpers ------------------------------------------------------------------
function addDays(isoDate: string, n: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function slugKey(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
/** Visible text of a page as trimmed lines (scripts/styles removed, entities decoded). */
function textLines(html: string): string[] {
  const root = parse(html);
  for (const el of root.querySelectorAll('script,style,noscript,svg')) el.remove();
  return (root.querySelector('body') ?? root).structuredText
    .split('\n').map(s => collapse(s.replace(/​/g, ''))).filter(Boolean);
}

// --- pure parsers ---------------------------------------------------------------------------
/** The booking-app trip slug linked from the WP page (e.g. "brazil-downwind-2026"). */
export function kiteactiveTripSlug(html: string): string | null {
  const slugs = [...html.matchAll(/app\.kiteactive\.com\/trip\/([a-z0-9-]+)/g)].map(m => m[1]);
  return slugs.find(s => s.startsWith('brazil-downwind')) ?? null;
}

/** One slot per bookable product run of the trip JSON. */
export function parseKiteactiveSlots(data: KaTripData): Slot[] {
  const out: Slot[] = [];
  const remaining = data.capacity ? Math.max(0, data.capacity.remaining) : null;
  for (const run of data.productRuns ?? []) {
    const p = data.products.find(x => x.id === run.product_id);
    if (!p || p.is_booking_enabled === false) continue; // runs of hidden products are not bookable
    const unit = p.tier_label ?? p.name;
    const nights = p.duration_nights ?? run.nights;
    const closedRule = (p.availability_rules ?? []).some(r => r.type === 'custom' && r.bookable === 'no' && r.from === run.start_date);
    let availability: Slot['availability'] = 'unknown';
    let availabilityText: string | null = null;
    if (closedRule) { availability = 'closed'; availabilityText = 'not bookable on this date'; }
    else if (remaining !== null) {
      availabilityText = remaining === 0 ? 'Sold out' : `${remaining} spots left`;
      availability = remaining === 0 ? 'sold_out' : remaining <= 3 ? 'limited' : 'available';
    }
    const price = run.price ?? p.price;
    out.push({
      key: `${slugKey(unit)}|${run.start_date}`,
      startDate: run.start_date,
      endDate: addDays(run.start_date, nights),
      unit,
      price: price && price > 0 ? price : null,
      currency: price && price > 0 ? CURRENCY : null,
      priceUnit: 'package',
      priceBasis: 'person',
      occupancy: null,
      availability,
      availabilityText,
      spotsLeft: remaining,
    });
  }
  return out;
}

/** Variant blocks on the WP page: "THE XXXL Downwinder in Brazil — 23 days" + "Start dates 2026: 26 October". */
export function parseKiteactivePageVariants(html: string): Array<{ name: string; days: number; starts: string[] }> {
  const lines = textLines(html);
  const out: Array<{ name: string; days: number; starts: string[] }> = [];
  for (let i = 0; i < lines.length - 1; i++) {
    const h = lines[i].match(/^(.+?)\s+[—–-]\s+(\d{1,2})\s+days$/i);
    const d = lines[i + 1].match(/^Start dates (20\d{2}):\s*(.+)$/i);
    if (!h || !d) continue;
    const year = Number(d[1]);
    const starts = d[2].split(/,|&|\band\b/).map(s => s.trim().match(/^(\d{1,2})\s+([A-Za-z]+)/))
      .filter((m): m is RegExpMatchArray => !!m && !!monthOf(m[2]))
      .map(m => iso(year, monthOf(m[2])!, Number(m[1])));
    out.push({ name: h[1].replace(/^THE\s+/i, ''), days: Number(h[2]), starts });
  }
  return out;
}

/** Included (✅) and not included (❌) lines of the WP page. */
export function parseKiteactiveInclusions(html: string): { included: string[]; excluded: string[] } {
  const lines = textLines(html);
  const headers = /^(KiteActive for life|Everything arranged|Not included|What makes this downwinder unique\??)$/i;
  const included: string[] = [];
  const excluded: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith('✅')) {
      const t = l.replace(/^✅\s*/, '');
      if (!headers.test(t)) included.push(t);
      // "✅ Professional kite coaches and guides" is followed by its plain-text bullet lines
      if (/coaches and guides/i.test(t)) {
        for (let j = i + 1; j < lines.length && !/^[✅📈❌❓🚗🧳]/u.test(lines[j]) && j < i + 8; j++) included.push(lines[j]);
      }
    } else if (l.startsWith('❌')) {
      const t = l.replace(/^❌\s*/, '');
      if (!headers.test(t)) excluded.push(t);
    }
  }
  return { included, excluded };
}

/** Route of the longest run (XXXL): accommodation stops in order; unlabeled nights = the off-grid Delta leg. */
export function kiteactiveItinerary(data: KaTripData, pageText: string): ItinerarySpot[] {
  const run = [...(data.productRuns ?? [])].sort((a, b) => b.nights - a.nights)[0];
  const names: string[] = [];
  let offGrid = false;
  for (const s of run?.nightly_stays ?? []) {
    const n = s.accommodation?.title ?? s.label;
    if (!n) { offGrid = true; continue; }
    if (names[names.length - 1] !== n) names.push(n);
  }
  // The Delta leg sleeps off-grid (no accommodation in the JSON). The page names it:
  // "off-grid kiting through ... the Parnaíba Delta ... The finish? Arpoador" (WP page, 2026-10-09).
  if (offGrid) for (const n of ['Parnaíba Delta', 'Arpoador']) if (pageText.includes(n.split(' ')[0])) names.push(n);
  return names.map((name, i) => ({ name, country: 'Brazil', region: regionOf(name), order: i + 1 }));
}

const REGIONS: Array<[RegExp, string]> = [
  [/cumbuco|ta[ií]ba|flecheiras|baleia|patos|guajiru|jericoacoara|tatajuba|macei[oó]|icara[ií]|guri[uú]/i, 'Ceará'],
  [/barra grande|parna[ií]ba|delta/i, 'Piauí'],
  [/arpoador|tut[oó]ia|atins|canarias|s[aã]o lu[ií]s/i, 'Maranhão'],
];
function regionOf(name: string): string | null {
  return REGIONS.find(([re]) => re.test(name))?.[1] ?? null;
}

const IMAGE_JUNK = /payment|certified|logo|greviews|review_img|Schermafbeelding|Screenshot|WhatsApp|-\d{2,3}x\d{2,3}\.(?:jpe?g|png|webp)$/i;

export function parseKiteactiveContent(html: string, data: KaTripData): OfferContent {
  const root = parse(html);
  const title = collapse(root.querySelector('h1')?.text ?? '') || 'XXXL Adventure Downwinder Brazil';
  const lines = textLines(html);
  const pageText = lines.join('\n');
  const { included, excluded } = parseKiteactiveInclusions(html);
  const byTier = (t: string) => data.products.find(p => p.tier_label?.toLowerCase() === t.toLowerCase());
  const xxxl = byTier('XXXL');
  const xplore = byTier('Xplore');
  const adventure = byTier('Adventure');
  const days = (p?: KaProduct) => (p?.duration_nights != null ? p.duration_nights + 1 : null);
  const itinerary = kiteactiveItinerary(data, pageText);
  const first = itinerary[0]?.name ?? 'Cumbuco';
  const xxxlRun = data.productRuns.find(r => r.product_id === xxxl?.id);

  const summary = [
    `A guided kitesurf downwinder along the northeast coast of Brazil from ${first}, with KiteActive coaches and a 4x4 jeep following the group along the beach, sleeping in hotels at the kite spots.`,
    xxxl && xxxlRun
      ? `The full XXXL route takes ${days(xxxl)} days from ${xxxlRun.start_date}${xplore && adventure ? `; it can also be booked as the ${days(xplore)}-day Xplore leg to Jericoacoara or the ${days(adventure)}-day Adventure leg through the Parnaíba Delta` : ''}.`
      : null,
    'Breakfast, snacks and drinks on the road and daily coaching are included; flights, lunch, dinner and gear rental are not.',
    'Riders must already kite independently at sea; the Delta leg is for experienced downwinder riders.',
  ].filter(Boolean).join(' ');

  const optional = [
    ...(data.addons ?? []).filter(a => a.price).map(a => `${a.name}: EUR ${a.price}${a.description ? ` (${a.description})` : ''}`),
    'Airport transfer from Fortaleza (paid to the driver directly)',
  ];

  // images: page gallery (og first) + the app's gallery and product photos, junk filtered, best first
  const pageImgs = imageCandidates(html, KITEACTIVE_PAGE_URL, null, 80);
  const appImgs = [
    data.trip.hero_image_url,
    ...(data.destinationGalleryImages ?? []),
    ...data.products.flatMap(p => [p.image_url, ...(p.images ?? []).map(i => i.url)]),
    ...(data.accommodations ?? []).map(a => a.image_url),
  ];
  const seen = new Set<string>();
  const imageUrls: string[] = [];
  for (const u of [...pageImgs, ...appImgs]) {
    if (!u || IMAGE_JUNK.test(u)) continue;
    const k = u.replace(/^https?:\/\/(www\.)?/, '').replace(/\/\/+/g, '/').replace(/-scaled(-\d)?(?=\.)/, '');
    if (seen.has(k)) continue;
    seen.add(k);
    imageUrls.push(u.replace(/([^:])\/\/+/g, '$1/'));
  }

  // source text: page sections without the reviews block + the app's package facts
  const rStart = lines.findIndex(l => /^Reviews from returning travelers/i.test(l));
  const rEnd = lines.findIndex(l => /^The trip$/i.test(l));
  const tStart = Math.max(0, lines.findIndex(l => l === title));
  const footer = lines.findIndex(l => /^Other popular destinations$/i.test(l));
  const end = footer > tStart ? footer : lines.length;
  const kept = rStart > tStart && rEnd > rStart && rEnd < end
    ? [...lines.slice(tStart, rStart), ...lines.slice(rEnd, end)]
    : lines.slice(tStart, end);
  const appFacts = data.products.map(p => `${p.tier_label ?? p.name}: EUR ${p.price}, ${p.duration_nights ?? '?'} nights, booking ${p.is_booking_enabled ? 'on' : 'off'}`);
  const runFacts = data.productRuns.map(r => `run ${r.product_id.slice(0, 8)} ${r.start_date} ${r.nights}n seats_taken ${r.seats_taken}`);

  return {
    kind: 'tour',
    title,
    summary,
    continent: 'South America',
    country: 'Brazil',
    region: 'Ceará',
    spot: first,
    itinerarySpots: itinerary,
    durationDays: days(xxxl) ?? parseKiteactivePageVariants(html).find(v => /XXXL/i.test(v.name))?.days ?? null,
    // app FAQ (2026-10-09): Xplore needs level 5 (independent at sea), Adventure level 6.1 (independent downwinders)
    skillLevels: ['intermediate', 'advanced'],
    kiteLessons: false,           // coaching for independent riders, no beginner lessons
    equipmentRental: (data.addons ?? []).some(a => /gear|rental/i.test(a.name)) || /gear rental/i.test(pageText),
    beginnerFriendly: false,
    includedServices: included,
    optionalServices: optional,
    accommodation: 'Beach hotels and pousadas at the kite spots, shared rooms (private room upgrade available)',
    mealPlan: included.some(i => /^breakfast$/i.test(i)) ? 'breakfast' : null,
    languages: ['en', 'nl'],      // page in EN/NL, Dutch operator (2026-10-09)
    rooms: [],
    imageUrls: imageUrls.slice(0, 30),
    heroVideoUrl: data.trip.hero_video_url && /\.(mp4|webm|mov)(\?|$)/i.test(data.trip.hero_video_url) ? data.trip.hero_video_url : null,
    sourceUrl: KITEACTIVE_PAGE_URL,
    bookingUrl: `https://app.kiteactive.com/trip/${data.trip.slug}`,
    sourceText: [...kept, '--- booking app ---', ...appFacts, ...runFacts].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
async function loadTrip(): Promise<{ html: string; data: KaTripData }> {
  const html = await fetchText(KITEACTIVE_PAGE_URL);
  const slug = kiteactiveTripSlug(html);
  if (!slug) throw new Error('kiteactive: no app.kiteactive.com/trip/brazil-downwind-* link on the destination page');
  const data = await fetchJson<KaTripData>(TRIP_DATA_BASE + encodeURIComponent(slug));
  if (!data?.products || !Array.isArray(data.productRuns)) throw new Error(`kiteactive: trip-public-data for ${slug} has no products/productRuns`);
  return { html, data };
}

function noteMismatch(html: string, data: KaTripData, note: (t: string) => void): void {
  const pageXxxl = parseKiteactivePageVariants(html).find(v => /XXXL/i.test(v.name));
  const appXxxl = data.products.find(p => p.tier_label === 'XXXL');
  if (pageXxxl && appXxxl?.duration_nights != null && pageXxxl.days !== appXxxl.duration_nights + 1) {
    note(`page says XXXL ${pageXxxl.days} days, booking app ${appXxxl.duration_nights + 1} days (slots follow the app)`);
  }
}

export const kiteactiveXxxlDownwinder: OfferAdapter = {
  key: 'kiteactive-xxxl-downwinder',
  name: 'KiteActive XXXL Adventure Downwinder Brazil',
  kind: 'tour',
  operator: {
    name: 'KiteActive',
    websiteUrl: 'https://www.kiteactive.com',
    rootDomain: 'kiteactive.com',
    contactEmail: 'info@kiteactive.com',
  },
  url: KITEACTIVE_PAGE_URL,
  slotMethod: 'booking_engine',
  fetchBudget: 4,
  async fetchContent() {
    const { html, data } = await loadTrip();
    return parseKiteactiveContent(html, data);
  },
  async fetchSlots(ctx) {
    const { html, data } = await loadTrip();
    noteMismatch(html, data, ctx.note);
    const slots = parseKiteactiveSlots(data);
    const skipped = data.productRuns.length - slots.length;
    if (skipped > 0) ctx.note(`${skipped} run(s) without a bookable product skipped`);
    return slots;
  },
};
