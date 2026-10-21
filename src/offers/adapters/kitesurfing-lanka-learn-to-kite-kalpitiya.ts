// ---------------------------------------------------------------------------
// Kitesurfing Lanka (KSL), Kandakuliya (Kalpitiya, Sri Lanka) - "Learn to Kite" deal: 7 nights full board at the
// KSL camp + 9 hours of semi-private lessons (or 6 hours private when no partner is available), boat rescue,
// transport to the Kalpitiya lagoon and a beach hut there. One place, stay + lessons as a package -> KIND = 'camp'.
// The camp itself is listed separately as a stay (adapter kitesurfing-lanka-kalpitiya); this is the packaged course.
//
// Data path (checked 2026-10-21): WordPress (theme "ksl"), English pages.
//   slots    /deals/learn-to-kite/: <table> "Nights | Kite lessons/ hours | Accommodation Type | Semi private
//            lesson", one row per accommodation ("7 nights / Full board" | "6 hours private or 9 hours group
//            lesson" | "Deluxe Tent" | "545ᴇᴜʀ"; the currency is printed in small-caps letters). One undated slot per
//            row, EUR, package of 7 nights. "Contact us for booking" opens the inquiry form -> 'on_request'.
//            "Only valid in high season (15 may till 15 september and 15 december till 15 march)" -> kept in the
//            slot text (no dates printed, so no season bands).
//   content  the same deal page (inclusions, hero photo, the learn-to-kite card) + /stay/ (bungalow and tent
//            photos of the camp; same memo-free fetch as the stay adapter, 1 request).
// Liveness: AIOSEO dateModified 2026-07-22 on the deal page; "Copyright © 2026"; home page news "We Are Hiring:
//   IKO Kite Instructors for Winter 2026/27" (stay adapter, 2026-10-12).
// robots.txt (2026-10-21): "User-agent: * Allow: /" (only Googlebot has a /nogooglebot/ rule).
// Requests per run: content 2 (deal page memoised), slots 1.
// Inferred: the price basis is per person (the table and the deal cards print a bare "545 EUR"; "Non-AC Bungalow
//   (shared)" reads as a shared bungalow per person). Occupancy is not printed -> null.
// spotCoords omitted (no map embed or JSON-LD geo on the site); region / spot as in the stay adapter.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, imageCandidates, ldOfType, parse, parseAmount } from '../parse.js';
import type { OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.kitesurfinglanka.com';
export const KSL_LTK_URL = `${SITE}/deals/learn-to-kite/`;
const KSL_STAY_URL = `${SITE}/stay/`;
const INQUIRY_URL = `${SITE}/contact-us-inquiry-form/`;

export interface KslLtkRow { nights: number | null; board: string | null; lessons: string; accommodation: string; price: number; currency: string; raw: string }

const keyPart = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** "545ᴇᴜʀ" (small capitals) / "545 EUR" / "€545" -> { 545, EUR } */
function priceCell(raw: string): { price: number; currency: string } | null {
  const t = raw.normalize('NFKC').replace(/ᴇᴜʀ/gi, 'EUR');
  if (!/eur|€/i.test(t)) return null;
  const price = parseAmount(t);
  return price === null ? null : { price, currency: 'EUR' };
}

// --- memoised page fetch (content and slots share the deal page) ------------------------------------
const pageCache = new Map<string, Promise<string>>();
function page(url: string): Promise<string> {
  if (!pageCache.has(url)) {
    const p = fetchText(url, { accept: 'text/html' });
    p.catch(() => pageCache.delete(url));
    pageCache.set(url, p);
  }
  return pageCache.get(url)!;
}

// --- pure parsers -------------------------------------------------------------------------------------
/** The package table: header row contains "Accommodation Type"; the price is the last cell with EUR. */
export function parseKslLtkTable(html: string): KslLtkRow[] {
  for (const table of parse(html).querySelectorAll('table')) {
    const rows = table.querySelectorAll('tr');
    const head = rows[0]?.querySelectorAll('th, td').map(c => collapse(c.text).toLowerCase()) ?? [];
    const accIdx = head.findIndex(h => /accommodation/.test(h));
    const nightIdx = head.findIndex(h => /night/.test(h));
    const lessonIdx = head.findIndex(h => /lesson/.test(h) && !/semi private|price/.test(h));
    if (accIdx < 0) continue;
    const out: KslLtkRow[] = [];
    for (const tr of rows.slice(1)) {
      const cells = tr.querySelectorAll('td').map(td => collapse(td.text));
      if (cells.length < accIdx + 1) continue;
      const priceIdx = cells.map((c, i) => (priceCell(c) ? i : -1)).filter(i => i >= 0).pop();
      if (priceIdx === undefined) continue;
      const p = priceCell(cells[priceIdx])!;
      const nightsCell = nightIdx >= 0 ? cells[nightIdx] ?? '' : '';
      out.push({
        nights: Number(nightsCell.match(/(\d+)\s*nights?/i)?.[1] ?? NaN) || null,
        board: nightsCell.match(/(full|half) board|breakfast/i)?.[0].toLowerCase() ?? null,
        lessons: lessonIdx >= 0 ? cells[lessonIdx] ?? '' : '',
        accommodation: cells[accIdx],
        price: p.price,
        currency: p.currency,
        raw: cells[priceIdx],
      });
    }
    if (out.length) return out;
  }
  return [];
}

/** "Only valid in high season ( 15 may till 15 september and 15 december till 15 march)" -> the bracket text. */
export function parseKslLtkSeason(html: string): string | null {
  const root = parse(html);
  for (const el of root.querySelectorAll('script,style,noscript,svg')) el.remove();
  const t = collapse(root.text);
  const m = t.match(/Only valid in high season\s*\(\s*([^)]+?)\s*\)/i);
  if (!m) return null;
  const month = /^(january|february|march|april|may|june|july|august|september|october|november|december)$/i;
  return m[1].replace(/\btill\b/gi, 'to').replace(/\b[a-z]+\b/gi, w => (month.test(w) ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w));
}

/** The "Package includes:" list (spans next to the icons, until the table). */
export function parseKslLtkIncludes(html: string): string[] {
  const root = parse(html);
  const out: string[] = [];
  for (const span of root.querySelectorAll('.col-10 span')) {
    const t = collapse(span.text);
    if (t && t.length < 120 && !out.includes(t)) out.push(t);
  }
  return out;
}

export function buildKslLtkSlots(rows: KslLtkRow[], season: string | null): Slot[] {
  const out: Slot[] = [];
  for (const r of rows) {
    const key = keyPart(r.accommodation);
    if (!key || out.some(s => s.key === key)) continue;
    out.push({
      key,
      startDate: null,
      endDate: null,
      unit: r.accommodation,
      price: r.price,
      currency: r.currency,
      priceUnit: 'package',
      priceBasis: 'person', // inferred: bare "545 EUR" per package
      occupancy: null,
      availability: 'on_request',
      availabilityText: `Contact us for booking (inquiry form); ${r.nights ?? 7} nights ${r.board ?? 'full board'}, ${r.lessons || 'lessons'}${season ? `; only valid in high season (${season})` : ''}`,
      spotsLeft: null,
      packageNights: r.nights ?? 7,
    });
  }
  return out;
}

export interface KslLtkPages { deal: string; stay: string }

export function parseKslLtkContent(p: KslLtkPages): OfferContent {
  const rows = parseKslLtkTable(p.deal);
  if (!rows.length) throw new Error('kitesurfing-lanka-learn-to-kite: package table not found (layout changed?)');
  const season = parseKslLtkSeason(p.deal);
  const includes = parseKslLtkIncludes(p.deal);
  const nights = rows[0].nights ?? 7;
  const cheapest = Math.min(...rows.map(r => r.price));
  const modified = (ldOfType(p.deal, 'WebPage')[0]?.dateModified as string | undefined) ?? null;
  const dealText = (() => {
    const root = parse(p.deal);
    for (const el of root.querySelectorAll('script,style,noscript,svg,header,footer,nav')) el.remove();
    return collapse((root.querySelector('main') ?? root.querySelector('body') ?? root).text);
  })();

  // Photos: deal page (hero, background, the kite deal cards; the wing-foil and dive cards are skipped), then the
  // camp's bungalow and tent photos from /stay/.
  const skip = new Set<string>();
  for (const [html] of [[p.deal], [p.stay]] as const) {
    for (const a of parse(html).querySelectorAll('a')) {
      const href = a.getAttribute('href') ?? '';
      // other deals (wing foil, kite-and-dive) show unrelated photos; kite course / coaching cards stay
      if (!/\/deals\//.test(href) || /\/deals\/(learn-to-kite|kite-clinic)/.test(href)) continue;
      for (const img of a.querySelectorAll('img')) skip.add(img.getAttribute('src') ?? '');
    }
  }
  const seen = new Set<string>();
  const imageUrls: string[] = [];
  for (const u of [...imageCandidates(p.deal, KSL_LTK_URL, null, 40), ...imageCandidates(p.stay, KSL_STAY_URL, null, 40)]) {
    if (skip.has(u) || /logo|icon|flag|trustindex|tripadvisor|google|\.svg|avatar|gravatar|\/themes\/ksl\/assets\//i.test(u)) continue;
    const k = u.replace(/-\d+x\d+(?=\.[a-z]+$)|-scaled(?=\.[a-z]+$)/i, '');
    if (seen.has(k)) continue;
    seen.add(k); imageUrls.push(u);
  }

  const lessons = rows[0].lessons || '6 hours private or 9 hours group lesson';
  const summary = [
    `Kitesurfing Lanka's "Learn to Kite" deal is a ${nights}-night beginner kite course at its beachfront camp in Kandakuliya on the Kalpitiya peninsula in north-western Sri Lanka.`,
    `It includes full board, 9 hours of semi-private lessons (6 hours private when no partner is available), boat rescue, transport to the Kalpitiya lagoon with a beach hut there, and wifi.`,
    `Guests choose a deluxe tent or a shared non-AC or AC bungalow, from EUR ${cheapest}${season ? `; the deal is only valid in the high seasons (${season})` : ''}. Booking is by inquiry.`,
  ].join(' ');

  return {
    kind: 'camp',
    title: 'Kitesurfing Lanka Learn to Kite, 7 nights',
    summary,
    continent: 'Asia',
    country: 'Sri Lanka',
    region: 'North Western Province',
    spot: 'Kandakuliya, Kalpitiya',
    spotCoords: null,
    itinerarySpots: [],
    durationDays: nights + 1,
    skillLevels: ['beginner'],
    kiteLessons: true,
    equipmentRental: true,
    beginnerFriendly: true,
    includedServices: includes.length ? includes.map(i => (/^\d+ nights$/i.test(i) ? `${i} at the KSL camp` : i)) : [`${nights} nights`, lessons, 'Full board', 'Boat rescue'],
    optionalServices: ['Kite gear rental after the course', 'Kite trips (Vella Island, Dream Spot)', 'Yoga, diving, dolphin and whale watching', 'Airport transfer (price on request)'],
    accommodation: 'deluxe tent, or shared non-AC / AC bungalow at the KSL camp',
    mealPlan: 'full_board',
    languages: ['en'],
    rooms: rows.map(r => ({ name: r.accommodation, description: null, features: [`${r.nights ?? nights} nights, ${r.board ?? 'full board'}`, r.lessons, `EUR ${r.price}`] })),
    imageUrls: imageUrls.slice(0, 12),
    heroVideoUrl: null,
    sourceUrl: KSL_LTK_URL,
    bookingUrl: INQUIRY_URL,
    sourceText: [
      `deal (dateModified ${modified ?? '?'}): ${dealText}`,
      `table: ${rows.map(r => `${r.nights} | ${r.board} | ${r.lessons} | ${r.accommodation} | ${r.raw}`).join('; ')}`,
    ].join('\n'),
  };
}

export const kitesurfingLankaLearnToKiteKalpitiya: OfferAdapter = {
  key: 'kitesurfing-lanka-learn-to-kite-kalpitiya',
  name: 'Kitesurfing Lanka Learn to Kite (Kalpitiya)',
  kind: 'camp',
  operator: {
    name: 'Kitesurfing Lanka',
    websiteUrl: SITE,
    rootDomain: 'kitesurfinglanka.com',
    contactEmail: 'info@kitesurfinglanka.com', // footer, 2026-10-21
    phone: '+94766839462',                    // KSL hotline, footer
  },
  url: KSL_LTK_URL,
  slotMethod: 'price_table',
  instantBooking: false, // "Contact us for booking" -> inquiry form
  fetchBudget: 3,
  async fetchContent() {
    return parseKslLtkContent({ deal: await page(KSL_LTK_URL), stay: await page(KSL_STAY_URL) });
  },
  async fetchSlots() {
    const html = await page(KSL_LTK_URL);
    const rows = parseKslLtkTable(html);
    if (!rows.length) throw new Error('kitesurfing-lanka-learn-to-kite: package table not found (layout changed?)');
    return buildKslLtkSlots(rows, parseKslLtkSeason(html));
  },
};
