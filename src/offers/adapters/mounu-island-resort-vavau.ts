// ---------------------------------------------------------------------------
// Mounu Island, Vava'u (Tonga) - small private island resort with four traditional thatched Tongan fales (villas)
// on the beach, run all-inclusive by The Bucket List Collection (transfers from Vava'u airport, all meals, whale
// swimming or water adventures with guides, boat and skipper). Kite link on the own site (/tonga, "Experiences"):
// "Kite Surfing & Winging - The shallow lagoon is perfect for learning kiteboarding new skills whilst the deep
// waters are perfect for foiling and winging. Trade winds blow April-Nov SE to E direction."; the FAQ lists kite
// surfing among the island's activities. No kite school, instructor or rental gear is named on the site.
// The old domain mounuisland.com is parked; the own site is the operator's thebucketlistcollection.com. Found via a
// former bstoked.net listing - a hint only, nothing is read from it.
//
// Data path (checked 2026-10-12): Squarespace site, English.
//   content  /tonga (overview, experiences, getting there, what is included), /accommodations-at-mounu (the
//            fales, sustainability, families / solo / full-island charter), /mounu-book-now (pricing + FAQ).
//   slots    /mounu-book-now: per Squarespace text block an <h2> season ("Shoulder Season"), an <h4> with
//            year-less ranges ("June 1 - 30, Oct 15-31"), "Villa $1,700 USD/Night" and "7 Nights - $11,900 USD";
//            footnote "**Pricing is per room per night assuming double occupancy.**".
//            The table has NO year: the bands are anchored on the page's own <lastmod> in /sitemap.xml (2026-03-09 on
//            2026-10-12): the season band containing that date plus the following bands for one 12-month cycle
//            (inferred), i.e. 2026-01-12 .. 2027-01-11; bands that ended before today are dropped.
//   Booking: "Book Now" opens a Cloudbeds widget (D08o3O) - Cloudbeds /booking/* is known to block us (403), so it
//            is not called -> availability 'unknown'.
// Liveness (rule 5b, Aaron 2026-10-12): sitemap lastmod 2026-03-09 (/mounu-book-now, /accommodations-at-mounu,
//   /mounu-faqs), 2026-03-11 (/tonga), 2026-06-16 (/itinerary-at-mounu), 2026-10-06 (/7-day-itinerary-mounu, still an
//   empty page), site-wide lastmod up to 2026-10-08; search snippets show travel-agent Mounu packages for travel
//   1 Apr - 31 Dec 2026 (hint only, not used as data). The /mounupromo page is an expired 2025 offer.
// robots.txt (2026-10-12): Squarespace defaults (/config, /search, /api/, /static/, ?format=json ...) for "*";
//   the pages and /sitemap.xml are allowed.
// Requests per run: content 3, slots 2 (book-now page memoised, so a full run makes 4).
// Parsed: slot = season band ("fale|2026-10-15"), USD per fale per night for 2 guests (all-inclusive), real band
//   limits from the printed day ranges.
// Known limits: year inferred from the page edit (see above); after 2027-01-11 the offer falls back to "price on
//   request" until the page is edited again. Solo-traveller and full-island prices are on request. spotCoords
//   omitted (no map or geo data on the site).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, imageCandidates, iso, monthOf, parse, parseAmount, todayIso } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.thebucketlistcollection.com';
export const MOU_TONGA_URL = `${SITE}/tonga`;
export const MOU_ROOMS_URL = `${SITE}/accommodations-at-mounu`;
export const MOU_BOOK_URL = `${SITE}/mounu-book-now`;
export const MOU_SITEMAP_URL = `${SITE}/sitemap.xml`;
const UNIT = 'Tongan fale (villa)';

export interface MouRange { m1: number; d1: number; m2: number; d2: number }
export interface MouSeason { name: string; text: string | null; ranges: MouRange[]; printed: string; perNight: number; week: number | null; currency: string }
export interface MouBand { season: string; start: string; end: string; perNight: number; currency: string }

// --- memoised page fetch -----------------------------------------------------------------------------------
const pageCache = new Map<string, Promise<string>>();
function page(url: string): Promise<string> {
  if (!pageCache.has(url)) {
    const p = fetchText(url, { accept: url.endsWith('.xml') ? 'application/xml,text/xml,*/*;q=0.8' : 'text/html' });
    p.catch(() => pageCache.delete(url));
    pageCache.set(url, p);
  }
  return pageCache.get(url)!;
}

/** Squarespace text blocks as line lists (h2 / p / h4 each a line). */
function textBlocks(html: string): string[][] {
  const root = parse(html);
  for (const el of root.querySelectorAll('footer, header, nav, script, style, noscript')) el.remove();
  return root.querySelectorAll('[data-sqsp-text-block-content]')
    .map(b => b.querySelectorAll('h1, h2, h3, h4, p, li').map(e => collapse(e.text.replace(/ /g, ' '))).filter(Boolean))
    .filter(l => l.length > 0);
}
function pageText(html: string): string {
  return collapse(textBlocks(html).map(b => b.join(' ')).join(' '));
}

// --- pure parsers -------------------------------------------------------------------------------------
/** "June 1 - 30, Oct 15-31" / "July 1 - Oct 14" / "Nov 1 - Jan 11" -> month/day ranges (no year). */
export function parseMouRanges(text: string): MouRange[] {
  const out: MouRange[] = [];
  for (const m of text.replace(/[–—]/g, '-').matchAll(/([A-Za-z]+)\.?\s*(\d{1,2})\s*-\s*(?:([A-Za-z]+)\.?\s*)?(\d{1,2})/g)) {
    const m1 = monthOf(m[1]);
    const m2 = m[3] ? monthOf(m[3]) : m1;
    if (!m1 || !m2) continue;
    out.push({ m1, d1: Number(m[2]), m2, d2: Number(m[4]) });
  }
  return out;
}

/** /mounu-book-now pricing blocks: <h2> "... Season", <h4> ranges, "$1,700/Night USD", "7 Nights $11,900 USD". */
export function parseMouSeasons(html: string): MouSeason[] {
  const out: MouSeason[] = [];
  for (const lines of textBlocks(html)) {
    const name = lines[0];
    if (!/season$/i.test(name)) continue;
    const dateLine = lines.find(l => parseMouRanges(l).length > 0 && !/\$/.test(l));
    const nightLine = lines.find(l => /\/\s*night/i.test(l) && /\$/.test(l));
    const weekLine = lines.find(l => /^7 nights/i.test(l));
    if (!dateLine || !nightLine) continue;
    const perNight = parseAmount(nightLine.replace(/^[^$]*\$/, ''));
    if (perNight === null) continue;
    out.push({
      name,
      text: lines.slice(1).find(l => l !== dateLine && l !== nightLine && l !== weekLine && l.length > 30) ?? null,
      ranges: parseMouRanges(dateLine),
      printed: `${dateLine}: ${nightLine}`,
      perNight,
      week: weekLine ? parseAmount(weekLine.replace(/^[^$]*\$/, '')) : null,
      currency: /USD/.test(nightLine) ? 'USD' : 'USD?',
    });
  }
  return out;
}

/** Squarespace accordion FAQ (question -> answer), e.g. "What's included in my booking?". */
export function parseMouFaq(html: string): Array<{ q: string; a: string }> {
  const out: Array<{ q: string; a: string }> = [];
  for (const li of parse(html).querySelectorAll('li.accordion-item')) {
    const q = collapse(li.querySelector('.accordion-item__title')?.text ?? '');
    const a = collapse(li.querySelector('.accordion-item__description')?.text ?? '');
    if (q && a && !out.some(x => x.q === q)) out.push({ q, a });
  }
  return out;
}

/** "**Pricing is per room per night assuming double occupancy.**" */
export function parseMouPricingNote(html: string): string | null {
  for (const b of textBlocks(html)) for (const l of b) if (/pricing is per room per night/i.test(l)) return l.replace(/\*/g, '').trim();
  return null;
}

/** <lastmod> of one page in a sitemap.xml. */
export function sitemapLastmod(xml: string, loc: string): string | null {
  for (const m of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    const l = m[1].match(/<loc>\s*([^<\s]+)\s*<\/loc>/)?.[1];
    if (l === loc) return m[1].match(/<lastmod>\s*(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
  }
  return null;
}

/** Year-less seasons -> dated bands for one 12-month cycle starting at the band that contains `anchor`. */
export function mouBands(seasons: MouSeason[], anchor: string): MouBand[] {
  const y0 = Number(anchor.slice(0, 4));
  const all: MouBand[] = [];
  for (const s of seasons) {
    for (const r of s.ranges) {
      for (const y of [y0 - 1, y0, y0 + 1]) {
        const start = iso(y, r.m1, r.d1);
        const end = iso(r.m2 < r.m1 ? y + 1 : y, r.m2, r.d2);
        all.push({ season: s.name, start, end, perNight: s.perNight, currency: s.currency });
      }
    }
  }
  all.sort((a, b) => a.start.localeCompare(b.start));
  const first = all.find(b => b.start <= anchor && b.end >= anchor) ?? all.find(b => b.start > anchor);
  if (!first) return [];
  const cycleEnd = iso(Number(first.start.slice(0, 4)) + 1, Number(first.start.slice(5, 7)), Number(first.start.slice(8, 10)));
  return all.filter(b => b.start >= first.start && b.start < cycleEnd);
}

export function buildMouSlots(bands: MouBand[], today: string): Slot[] {
  return bands.filter(b => b.end >= today && b.currency === 'USD').map(b => ({
    key: `fale|${b.start}`,
    startDate: b.start,
    endDate: b.end,
    unit: UNIT,
    price: b.perNight,
    currency: b.currency,
    priceUnit: 'per_night' as const,
    priceBasis: 'room' as const,
    occupancy: 2,
    availability: 'unknown' as const,
    availabilityText: null,
    spotsLeft: null,
  }));
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthName = (w: string): string => { const m = monthOf(w); return m ? MONTH_NAMES[m - 1] : w; };

export interface MouPages { tonga: string; rooms: string; book: string }

export function parseMounuContent(p: MouPages): OfferContent {
  const tonga = pageText(p.tonga);
  const rooms = pageText(p.rooms);
  const book = pageText(p.book);
  const seasons = parseMouSeasons(p.book);
  const note = parseMouPricingNote(p.book);
  const kite = tonga.match(/Kite Surfing & Winging (.+?Trade winds blow [^.]+\.)/)?.[1] ?? null;
  const wind = tonga.match(/Trade winds blow ([A-Za-z]+)-([A-Za-z]+) ([A-Z]{1,3}) to ([A-Z]{1,3}) direction/);
  const fales = rooms.match(/We currently have (\w+) traditional Tongan fales/i)?.[1] ?? tonga.match(/Our (\w+) traditional Tongan fales/i)?.[1] ?? 'four';
  const boat = tonga.match(/it’s a (\d+)-minute boat ride to Mounu Island/i)?.[1] ?? tonga.match(/it's a (\d+)-minute boat ride/i)?.[1] ?? null;
  const prices = seasons.map(s => s.perNight);
  const faq = parseMouFaq(p.book);
  const included = faq.find(f => /what's included/i.test(f.q))?.a ?? '';
  const activities = faq.find(f => /activities/i.test(f.q))?.a ?? '';

  const contentRooms: ContentRoom[] = [{
    name: UNIT,
    description: (rooms.match(/Each fale is privately secluded[^.]*\./)?.[0] ?? `${fales} traditional Tongan fales with thatched roofs on the beach.`).replace(/\s*[—–]\s*/g, ', '),
    features: [
      'Oceanfront, a few steps from the beach', 'Thatched roof', 'Off-grid power, low-flow water fixtures, biogas',
      'Extra beds for families on request',
      ...(note ? [note] : []),
      ...seasons.map(s => `${s.name} (${s.printed.split(':')[0]}): USD ${s.perNight.toLocaleString('en-US')} per night${s.week ? `, 7 nights USD ${s.week.toLocaleString('en-US')}` : ''}`),
    ],
  }];

  const seen = new Set<string>();
  const imageUrls: string[] = [];
  for (const u of [...imageCandidates(p.rooms, MOU_ROOMS_URL, null, 40), ...imageCandidates(p.tonga, MOU_TONGA_URL, null, 40)]) {
    if (!/images\.squarespace-cdn\.com\/content\//.test(u)) continue;
    // stock photos (unsplash-image-*) and the operator's text graphics are not the property
    if (/logo|icon|screenshot|favicon|unsplash-image|bucket_list_collection_all_inclusive|\.svg/i.test(decodeURIComponent(u))) continue;
    const k = u.replace(/\?.*$/, '');
    if (seen.has(k)) continue;
    seen.add(k); imageUrls.push(u);
  }

  const summary = [
    `Mounu Island is a small private island in the Vava'u group of northern Tonga${boat ? `, a ${boat}-minute boat ride from Vava'u` : ''}, run as an all-inclusive resort by The Bucket List Collection with ${fales} traditional thatched Tongan fales (villas) on the beach and off-grid power.`,
    /5 days of whale swimming/i.test(included)
      ? `Stays include return transfers from Vava'u airport, all meals and non-alcoholic drinks, five days of whale swimming (or water adventures outside whale season) with guides, boat and skipper; airfare, alcohol and extra excursions are paid separately.`
      : `Stays include return transfers from Vava'u airport, all meals and non-alcoholic drinks, guides, boat and skipper.`,
    `${kite ? `The shallow lagoon is used for learning to kite and the deeper water for foiling and winging${wind ? `, with ${wind[3]} to ${wind[4]} trade winds from ${monthName(wind[1])} to ${monthName(wind[2])}` : ''}; no kite school or rental is named on the site. ` : ''}${prices.length ? `Rates are USD ${Math.min(...prices).toLocaleString('en-US')} to ${Math.max(...prices).toLocaleString('en-US')} per fale per night for two, by season.` : 'Prices on request.'}`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Mounu Island',
    summary,
    continent: 'Oceania',
    country: 'Tonga',
    region: "Vava'u",
    spot: 'Mounu Island',
    spotCoords: null,
    itinerarySpots: [],
    durationDays: null,
    skillLevels: kite ? ['beginner', 'intermediate', 'advanced'] : [], // lagoon "for learning", deep water for foiling
    kiteLessons: null,
    equipmentRental: null,
    beginnerFriendly: kite ? true : null,
    includedServices: [
      "Return transfers from Vava'u airport (VAV)", 'All meals and non-alcoholic drinks',
      ...(/5 days of whale swimming/i.test(included) ? ['Five days of whale swimming or water adventures'] : []),
      'Accredited guides', 'Boat and skipper',
      ...(faq.some(f => /wi-fi/i.test(f.q) && /available/i.test(f.a)) ? ['Wi-Fi (intermittent)'] : []),
    ],
    optionalServices: [
      ...(/kite/i.test(activities) || kite ? ['Kite surfing and winging in the lagoon (no kite school or rental named on the site)'] : []),
      'Kayaking, paddle boarding, snorkelling',
      'Scuba diving (dives coordinated on request)', 'Trips to Neiafu', 'Sailing, fishing, bird colonies, village visits (extra cost)',
      'Full island charter (on request)',
    ],
    accommodation: 'traditional Tongan fales (villas) on a private island',
    mealPlan: 'full_board',
    languages: [],
    rooms: contentRooms,
    imageUrls: imageUrls.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: MOU_TONGA_URL,
    bookingUrl: MOU_BOOK_URL,
    sourceText: [
      `tonga: ${tonga}`,
      `accommodations: ${rooms}`,
      `pricing: ${seasons.map(s => `${s.name} | ${s.printed} | 7 nights ${s.week ?? '-'}`).join(' || ')} | ${note ?? 'no pricing note'}`,
      `book now: ${book}`,
      `FAQ: ${faq.map(f => `${f.q} ${f.a}`).join(' | ')}`,
    ].join('\n'),
  };
}

export const mounuIslandResortVavau: OfferAdapter = {
  key: 'mounu-island-resort-vavau',
  name: "Mounu Island (Vava'u, Tonga)",
  kind: 'accommodation',
  operator: {
    name: 'The Bucket List Collection',
    websiteUrl: SITE,
    rootDomain: 'thebucketlistcollection.com',
    contactEmail: 'mounu@thebucketlistcollection.com', // mailto on /accommodations-at-mounu, 2026-10-12
  },
  url: MOU_TONGA_URL,
  slotMethod: 'price_table',
  instantBooking: true,
  fetchBudget: 5,
  confidence: 'medium', // year-less price table, year inferred from the page edit
  async fetchContent() {
    const tonga = await page(MOU_TONGA_URL);
    const rooms = await page(MOU_ROOMS_URL);
    const book = await page(MOU_BOOK_URL);
    return parseMounuContent({ tonga, rooms, book });
  },
  async fetchSlots(ctx) {
    const seasons = parseMouSeasons(await page(MOU_BOOK_URL));
    if (seasons.length < 2) throw new Error(`mounu: pricing blocks not found or changed (${seasons.length} seasons)`);
    if (seasons.some(s => s.currency !== 'USD')) ctx.note('a pricing line without "USD": that season is skipped');
    let anchor: string | null = null;
    try {
      anchor = sitemapLastmod(await page(MOU_SITEMAP_URL), MOU_BOOK_URL);
    } catch (err) {
      ctx.note(`sitemap failed: ${(err as Error).message}`);
    }
    if (!anchor) {
      ctx.note('no <lastmod> for /mounu-book-now: the year-less seasons cannot be dated, price on request');
      return [];
    }
    const slots = buildMouSlots(mouBands(seasons, anchor), todayIso());
    if (slots.length === 0) ctx.note(`price table last edited ${anchor}: its 12-month cycle has ended, waiting for an edit`);
    return slots;
  },
};
