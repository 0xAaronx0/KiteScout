// ---------------------------------------------------------------------------
// Offer adapter: Algarve Watersport "Zero to Hero" Kite Camp, Lagos / Ria de Alvor (Portugal).
//
// Data path: ONE page, https://algarvewatersport.com/en/algarve-kite-camp/ (WordPress, server-rendered).
//   - slots: the Zero to Hero season table (.hero-package .season-price-row: label, months, EUR/person/week)
//     and the "Other packages" cards (.secondary-card: "From EUR x /person/week").
//   - year: the table has none; we read it from the page's JSON-LD TouristTrip AggregateOffer
//     (validThrough / priceValidUntil, "2026-12-31" on 2026-10-09).
//   - content: package features, room tabs (.accom-tab-panel), JSON-LD (Place, TouristTrip), page images.
// Booking engine: Bookinglayer (algarve-watersports.bookinglayer.com is an SPA shell; its data API
//   api.bookinglayer.io answers robots.txt "Disallow: /", checked 2026-10-09) -> NOT used: no live inventory.
// robots.txt algarvewatersport.com (checked 2026-10-09): only /wp-admin/ disallowed -> page allowed.
// Requests per run: 1 (content + slots share one memoised fetch of the page).
// Slots: one month band per package (unit = package name), weekly price per person in the shared dorm
//   (page: "All prices per person, shared dorm"), availability 'unknown' (no calendar on the page; the
//   JSON-LD "InStock" is static marketing data, not inventory).
// Known limits:
//   - The price list is dated 2026 (priceValidUntil 2026-12-31) and the season is May-Sep, so on
//     2026-10-09 every band is in the past; the bands roll forward once the operator republishes the
//     table with a 2027 validity. October is part of the season ("May to October") but has no price.
//   - Secondary packages only show a "From" price; the page footnote says "Low season prices shown",
//     so they get bands for the low-season months of the Zero to Hero table only.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { parse, collapse, ldOfType, parseAmount, detectCurrency, monthOf, iso, imageCandidates, type HTMLElement } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

export const ALGARVE_URL = 'https://algarvewatersport.com/en/algarve-kite-camp/';

// --- small local helpers --------------------------------------------------------
const memo = new Map<string, { at: number; p: Promise<string> }>();
/** one fetch per page per 10 minutes: fetchContent + fetchSlots in the same run share it */
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url);
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}
const txt = (el: HTMLElement | null | undefined): string => collapse(el?.text ?? '');
const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const lastDay = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** "May – Jun" -> [5, 6]; "Jul, Sep" -> [7, 9]; "Aug" -> [8] */
export function monthList(text: string): number[] {
  const out: number[] = [];
  for (const part of text.split(/,|&|\band\b/)) {
    const ms = (part.match(/[A-Za-zäç]+/g) ?? []).map(monthOf).filter((m): m is number => m !== null);
    if (ms.length === 2 && /[-–—]|\bto\b/.test(part) && ms[1] >= ms[0]) {
      for (let m = ms[0]; m <= ms[1]; m++) out.push(m);
    } else out.push(...ms);
  }
  return [...new Set(out)];
}

/** Year of the published price list (JSON-LD TouristTrip offers validThrough / priceValidUntil). */
export function priceListYear(html: string): number | null {
  for (const o of ldOfType(html, 'TouristTrip')) {
    const agg = o.offers as Record<string, unknown> | undefined;
    if (!agg) continue;
    const inner = Array.isArray(agg.offers) ? (agg.offers as Array<Record<string, unknown>>) : [];
    for (const c of [agg.validThrough, agg.priceValidUntil, ...inner.map(x => x.priceValidUntil)]) {
      if (typeof c === 'string' && /^\d{4}-\d{2}-\d{2}/.test(c)) return Number(c.slice(0, 4));
    }
  }
  return null;
}

function band(pkg: string, year: number, month: number, price: number | null, currency: string | null, per: string): Slot {
  const ym = `${year}-${String(month).padStart(2, '0')}`;
  return {
    key: `${slug(pkg)}|${ym}`,
    startDate: iso(year, month, 1),
    endDate: iso(year, month, lastDay(year, month)),
    unit: pkg,
    price,
    currency: price === null ? null : currency,
    priceUnit: /week/i.test(per) ? 'per_week' : 'package',
    priceBasis: /person/i.test(per) ? 'person' : null,
    occupancy: 1, // shared-dorm bed, the base of every package price
    availability: 'unknown',
    availabilityText: null,
    spotsLeft: null,
  };
}

// --- slots ------------------------------------------------------------------------
export function parseAlgarveSlots(html: string): Slot[] {
  const year = priceListYear(html);
  if (!year) throw new Error('algarve: price-list year not found (JSON-LD TouristTrip priceValidUntil)');
  const root = parse(html);
  const hero = root.querySelector('.hero-package');
  if (!hero) throw new Error('algarve: .hero-package price table missing (page layout changed?)');
  const heroName = txt(hero.querySelector('.hero-package-name'));
  if (!heroName) throw new Error('algarve: hero package name missing');

  const slots: Slot[] = [];
  let lowMonths: number[] = [];
  for (const row of hero.querySelectorAll('.season-price-row')) {
    const label = txt(row.querySelector('.season-label'));
    const months = monthList(txt(row.querySelector('.season-months')));
    const amount = txt(row.querySelector('.season-amount'));
    const per = txt(row.querySelector('.season-per'));
    const price = parseAmount(amount);
    if (/low/i.test(label)) lowMonths = months;
    for (const m of months) slots.push(band(heroName, year, m, price, detectCurrency(amount), per));
  }
  if (slots.length === 0) throw new Error('algarve: no season rows parsed');

  // "From EUR x" on the other cards = low-season price (footnote "Low season prices shown").
  const pricing = root.querySelector('#section-pricing') ?? root;
  if (lowMonths.length > 0 && /low season prices shown/i.test(txt(pricing))) {
    for (const card of root.querySelectorAll('.secondary-card')) {
      const name = txt(card.querySelector('.secondary-card-name'));
      const amount = txt(card.querySelector('.secondary-card-price'));
      const per = txt(card.querySelector('.secondary-card-price-unit'));
      const price = parseAmount(amount);
      if (!name || price === null) continue;
      for (const m of lowMonths) slots.push(band(name, year, m, price, detectCurrency(amount), per));
    }
  }
  return slots;
}

// --- content ----------------------------------------------------------------------
export function parseAlgarveContent(html: string, url = ALGARVE_URL): OfferContent {
  const root = parse(html);
  // node-html-parser's .text includes inline <script>/<style> bodies: drop them before reading text
  for (const el of root.querySelectorAll('script, style, noscript, template')) el.remove();
  const hero = root.querySelector('.hero-package');
  const heroName = txt(hero?.querySelector('.hero-package-name')) || 'Zero to Hero Kite Camp';
  const level = txt(hero?.querySelector('.hero-package-level'));             // "7 nights · 5 kite days · beginner"
  const nights = Number(level.match(/(\d+)\s*nights?/i)?.[1] ?? NaN);
  const pricingIntro = txt(root.querySelector('#section-pricing .subtitle'));
  const features = (hero?.querySelectorAll('.package-features li') ?? []).map(li => txt(li)).filter(Boolean);

  const place = ldOfType(html, 'Place').find(o => o.address)?.address as Record<string, string> | undefined;
  const trip = ldOfType(html, 'TouristTrip')[0];
  const touristTypes = Array.isArray(trip?.touristType) ? (trip!.touristType as string[]) : [];
  const skillLevels = ['beginner', 'intermediate', 'advanced'].filter(l => touristTypes.some(t => t.toLowerCase().includes(l)));

  // room tabs: Shared Dorm (base), Bungalow, Apartment, The Hill (supplements p.p./week)
  const rooms: ContentRoom[] = root.querySelectorAll('.accom-tab-panel').map(p => ({
    name: txt(p.querySelector('h4')),
    description: txt(p.querySelector('p')) || null,
    features: [
      ...p.querySelector('.accom-panel-price')?.innerHTML.split(/<br\s*\/?>/i).map(s => collapse(parse(s).text)).filter(Boolean) ?? [],
      ...p.querySelectorAll('.check-list li').map(li => txt(li)),
    ],
  })).filter(r => r.name);
  // a room whose price line carries a "+ EUR x" supplement is an upgrade (the dorm says "Included in base price")
  const upgrades = rooms.filter(r => r.features.some(f => /^\s*(from\s*)?\+/i.test(f)))
    .map(r => `Room upgrade: ${r.name} (${r.features.filter(f => /^\s*(from\s*)?\+/i.test(f)).join('; ')})`);

  const pageText = txt(root.querySelector('body') ?? root);
  const transfer = pageText.match(/airport transfers? for (€\s?\d+|\d+\s?€?)\s*per booking/i);
  const optionalServices = [...upgrades];
  if (transfer) optionalServices.push(`Airport transfer from Faro (${transfer[1].includes('€') ? transfer[1] : `€${transfer[1]}`} per booking)`);

  // sourceText: the sections a guest reads to understand the offer (changes when the page changes)
  const sourceText = ['#section-pricing', '.accom-tabs']
    .map(sel => txt(root.querySelector(sel))).filter(Boolean).join('\n\n') || null;

  // images: JSON-LD gallery first (curated by the operator), then the page's content images
  const ldImages = Array.isArray(trip?.image) ? (trip!.image as string[]) : [];
  const imageUrls = [...new Set([...ldImages, ...imageCandidates(html, url, null, 40)])];

  const bookingUrl = hero?.querySelector('a[href*="bookinglayer"]')?.getAttribute('href') ?? null;
  // our own wording from the page's facts (only our own texts, no operator prose - Aaron 2026-10-21)
  const n = (re: RegExp) => features.join(' ').match(re)?.[1] ?? null;
  const groupLessons = n(/(\d+)\s*group kite lessons?/i);
  const semiLessons = n(/(\d+)\s*semi-private kite lessons?/i);
  const dinners = n(/(\d+)\s*dinners/i);
  const lessonLine = [
    groupLessons ? `${groupLessons} group lessons` : null,
    semiLessons ? `${semiLessons} semi-private lessons on a kite of your own` : null,
    /wake park/i.test(features.join(' ')) ? 'a wake park session to practise water starts' : null,
  ].filter((x): x is string => !!x).reduce((acc, x, i, all) => (i === 0 ? x : `${acc}${i === all.length - 1 ? ' and ' : ', '}${x}`), '');
  const nightsText = Number.isFinite(nights) ? `${nights} nights` : 'a week';
  const summary = [
    `Algarve Watersport's beginner kite week in Lagos (Portugal)${/Ria de Alvor/i.test(pageText) ? ', taught on the Ria de Alvor lagoon' : ''}: ${nightsText} at the school's Kitehouse${rooms.length ? ` (${rooms[0].name.toLowerCase()} in the base price, other rooms as upgrades)` : ''}${lessonLine ? ` with ${lessonLine}` : ''}.`,
    `Kite gear, the VDWS licence, daily breakfast${dinners ? `, ${dinners} dinners` : ''}, yoga and rides to the kite spots are part of the price${transfer ? '; the Faro airport transfer is extra' : ''}.`,
  ].join(' ');

  return {
    kind: 'camp',
    title: `${heroName} - Algarve Watersport, Lagos`,
    summary,
    continent: 'Europe',
    country: place?.addressCountry === 'PT' ? 'Portugal' : (place?.addressCountry ?? 'Portugal'),
    region: place?.addressRegion ?? 'Algarve',
    // page: "Ria de Alvor Lagoon ... Primary kite spot" (deep-water days at Meia Praia), 2026-10-09
    spot: /Ria de Alvor/i.test(pageText) ? `Ria de Alvor lagoon, ${place?.addressLocality ?? 'Lagos'}` : (place?.addressLocality ?? 'Lagos'),
    // Nominatim has no "Ria de Alvor lagoon, Lagos"; "Ria de Alvor" alone resolves here (2026-10-12)
    spotCoords: /Ria de Alvor/i.test(pageText) ? { lat: 37.1403, lng: -8.6113 } : null,
    itinerarySpots: [],
    durationDays: Number.isFinite(nights) ? nights + 1 : 8,
    skillLevels: skillLevels.length ? skillLevels : ['beginner'],
    kiteLessons: true,
    equipmentRental: /all kite equipment included/i.test(features.join(' ')) || /equipment/i.test(pricingIntro),
    beginnerFriendly: /beginner/i.test(level) || skillLevels.includes('beginner'),
    includedServices: features,
    optionalServices,
    accommodation: rooms.length
      ? `The Kitehouse, Lagos: ${rooms[0].name.toLowerCase()} included; upgrades: ${rooms.slice(1).map(r => r.name).join(', ')}`
      : 'The Kitehouse, Lagos (shared dorm)',
    // page: "7 breakfasts + 6 dinners included" -> half board (2026-10-09)
    mealPlan: /breakfast/i.test(features.join(' ')) && /dinner/i.test(features.join(' ')) ? 'half_board' : null,
    languages: ['en', 'de', 'es', 'it', 'pl', 'pt', 'cs', 'hu'], // site hreflang list (2026-10-09); instruction language not stated
    rooms,
    imageUrls,
    heroVideoUrl: null, // only a YouTube embed (youtube.com/embed/_2xBxevV9Lo), not a video file
    sourceUrl: url,
    bookingUrl,
    sourceText,
  };
}

export const algarveWatersportZeroToHero: OfferAdapter = {
  key: 'algarve-watersport-zero-to-hero',
  name: 'Algarve Watersport - Zero to Hero Kite Camp (Lagos)',
  kind: 'camp',
  operator: {
    name: 'Algarve Watersport',
    websiteUrl: 'https://algarvewatersport.com/',
    rootDomain: 'algarvewatersport.com',
    contactEmail: 'info@algarvewatersport.com', // page JSON-LD Organization.email, 2026-10-09
    phone: '+351960460800',                      // page JSON-LD Organization.telephone, 2026-10-09
  },
  url: ALGARVE_URL,
  slotMethod: 'price_table',
  instantBooking: true,
  fetchBudget: 3,
  async fetchContent() {
    return parseAlgarveContent(await page(ALGARVE_URL), ALGARVE_URL);
  },
  async fetchSlots() {
    return parseAlgarveSlots(await page(ALGARVE_URL));
  },
};
