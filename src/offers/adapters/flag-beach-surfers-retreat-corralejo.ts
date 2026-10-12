// ---------------------------------------------------------------------------
// Surfer's Retreat, Corralejo (Fuerteventura, Canary Islands, Spain) - boutique hostel (14 beds, pool) of
// the Flag Beach Watersports Centre (kitesurf, windsurf, surf, wing foil and SUP school + rental).
//
// Data path (checked 2026-10-12): WordPress block theme, server-rendered:
//   content  /accommodation/surfers-retreat/ (description, minimum stay, facilities list, slider photos
//            served through Jetpack's i0.wp.com CDN) + /kite-surfing/kite-surfing-packages/ (the school's kite
//            packages: "7 nights surf hostel stay, 4 day kitesurfing course", "hostel B&B (shared room)").
//   slots    the "Prices" table on the retreat page: per bed / per room occupancy a "from €23/night" price,
//            no dates, no season, no year; "Book your stay now (minimum stay 3 nights)".
// Booking engine: Cloudbeds (hotels.cloudbeds.com/reservation/kn1mGC + widget). Not used: Cloudbeds
//   answers its /booking/* data calls with HTTP 403 to non-browser clients (seen on keros-blue-limnos,
//   2026-10-09), so there is no live price or inventory here -> availability 'unknown'.
// 2026/27 operation: WP REST "modified" of the retreat, accommodation and kite-package pages =
//   2026-05-08 (checked 2026-10-12); online booking link live. No text names 2026 or 2027; the school
//   runs year-round (no season on the pages).
// robots.txt (2026-10-12): only /wp-admin/ disallowed.
// Requests per run: content 2, slots 1 (memoised: 0 extra when content ran in the same process).
// Parsed: 4 undated slots, one per table row: bed in dorm / bed in twin room (EUR per person per night),
//   double room single / double occupancy (EUR per room per night), minNights 3. The prices are "from"
//   prices (lowest rate); the exact rate is only in Cloudbeds.
// Known limits: that the kite packages' "surf hostel" is this house is inferred (Surfer's Retreat is the
//   only hostel among Flag Beach's six accommodations and is called "Flag Beach's new hostel").
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, detectCurrency, imageCandidates, parse, parseAmount } from '../parse.js';
import type { OfferAdapter, OfferContent, Slot, SlotPriceBasis } from '../types.js';

const SITE = 'https://www.flagbeach.com';
export const FBR_PAGE_URL = `${SITE}/accommodation/surfers-retreat/`;
export const FBR_KITE_PACKAGES_URL = `${SITE}/kite-surfing/kite-surfing-packages/`;
const BOOKING_URL = 'https://hotels.cloudbeds.com/reservation/kn1mGC';
export const FBR_UNIT_DORM = '1 bed in dorm room';

// --- local helpers ----------------------------------------------------------------------------
const memo = new Map<string, { at: number; p: Promise<string> }>();
/** one fetch per page per 10 minutes: fetchContent + fetchSlots in the same run share it */
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}
const keyPart = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
function mainText(html: string): string {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, svg, header, footer, nav, aside')) el.remove();
  return collapse((root.querySelector('main') ?? root.querySelector('body') ?? root).text);
}
/** Jetpack Photon URL -> the original on the site ("https://i0.wp.com/flagbeach.com/wp-content/...?ssl=1"). */
export function unPhoton(u: string): string {
  const m = u.match(/^https:\/\/i\d\.wp\.com\/(?:www\.)?flagbeach\.com(\/wp-content\/[^?#]+)/);
  return m ? `${SITE}${m[1]}` : u;
}

// --- pure parsers -----------------------------------------------------------------------------
export interface FbrRate { unit: string; amount: number; currency: string; from: boolean; basis: SlotPriceBasis; occupancy: number }

/** "Prices" table: label cell + "from €23/night" cell. */
export function parseFbrRates(html: string): FbrRate[] {
  const root = parse(html);
  const h = root.querySelectorAll('h2, h3').find(x => /^prices$/i.test(collapse(x.text)));
  const table = root.querySelectorAll('table').find(t => /per\s*night|\/night/i.test(t.text) && /bed/i.test(t.text));
  if (!h || !table) return [];
  const out: FbrRate[] = [];
  for (const tr of table.querySelectorAll('tr')) {
    const [label, value] = tr.querySelectorAll('td').map(td => collapse(td.text));
    if (!label || !value || !/night/i.test(value)) continue;
    const amount = parseAmount(value);
    if (!amount) continue;
    const perBed = /^\d+\s+bed\b/i.test(label);
    const occupancy = perBed || /single occupancy/i.test(label) ? 1 : /double occupancy/i.test(label) ? 2 : 1;
    out.push({ unit: label, amount, currency: detectCurrency(value) ?? 'EUR', from: /\bfrom\b/i.test(value), basis: perBed ? 'person' : 'room', occupancy });
  }
  return out;
}

export function parseFbrMinNights(html: string): number | null {
  const m = mainText(html).match(/minimum stay (\d+) nights?/i);
  return m ? Number(m[1]) : null;
}

export function buildFbrSlots(rates: FbrRate[], minNights: number | null): Slot[] {
  return rates.map(r => ({
    key: keyPart(r.unit),
    startDate: null,
    endDate: null,
    unit: r.unit,
    price: r.amount,
    currency: r.currency,
    priceUnit: 'per_night',
    priceBasis: r.basis,
    occupancy: r.occupancy,
    availability: 'unknown',
    availabilityText: null,
    spotsLeft: null,
    minNights,
  }));
}

export function parseFbrFacilities(html: string): string[] {
  const root = parse(html);
  const h = root.querySelectorAll('h2, h3').find(x => /^facilities$/i.test(collapse(x.text)));
  const ul = h?.parentNode?.querySelector('ul');
  return ul ? ul.querySelectorAll('li').map(li => collapse(li.text)).filter(Boolean) : [];
}

/** Kite package rows of the school: name + <sup>contents</sup> | price ("Beginner kitesurfing camp 7 nights" | "€680"). */
export function parseFbrKitePackages(html: string): Array<{ name: string; details: string; amount: number }> {
  const out: Array<{ name: string; details: string; amount: number }> = [];
  for (const tr of parse(html).querySelectorAll('table tr')) {
    const [cell, priceCell] = tr.querySelectorAll('td');
    if (!cell || !priceCell) continue;
    const details = collapse(cell.querySelector('sup')?.text ?? '');
    const name = collapse(cell.text.replace(details, '')) || collapse(cell.text);
    const amount = parseAmount(collapse(priceCell.text));
    if (amount && /hostel/i.test(details)) out.push({ name, details, amount });
  }
  return out;
}

export interface FbrPages { retreat: string; kitePackages: string }

export function parseFlagBeachRetreatContent(p: FbrPages): OfferContent {
  const retreat = mainText(p.retreat);
  const kite = mainText(p.kitePackages);
  const rates = parseFbrRates(p.retreat);
  const minNights = parseFbrMinNights(p.retreat);
  const facilities = parseFbrFacilities(p.retreat);
  const packages = parseFbrKitePackages(p.kitePackages);
  const desc = parse(p.retreat).querySelectorAll('main p').map(x => collapse(x.text)).filter(t => t.length > 60);
  const sleeps = retreat.match(/house sleeps (\d+) people/i)?.[1] ?? null;
  const baths = retreat.match(/There are (\d+) modern bathrooms/i)?.[1] ?? null;
  const dorm = rates.find(r => r.unit === FBR_UNIT_DORM);
  const dbl = rates.find(r => /double occupancy/i.test(r.unit));
  const cheapestPkg = packages.length ? Math.min(...packages.map(x => x.amount)) : null;

  const seen = new Set<string>();
  const imageUrls: string[] = [];
  for (const raw of imageCandidates(p.retreat, FBR_PAGE_URL, null, 60)) {
    const u = unPhoton(raw);
    if (/\.svg|logo|icon|Pastilla|ECOACT/i.test(u)) continue;
    if (!/\/wp-content\/uploads\//.test(u) || seen.has(u)) continue;
    seen.add(u); imageUrls.push(u);
  }

  const summary = [
    `Surfer's Retreat is the boutique hostel of the Flag Beach Watersports Centre in Corralejo, Fuerteventura, halfway between Flag Beach and the town centre and across the road from the Campanario shopping centre.`,
    `The house sleeps ${sleeps ?? '14'} in twin and double rooms and a dorm with bunk beds, with ${baths ?? '3'} bathrooms, a shared kitchen and living room, a BBQ, two terraces and a private pool${dorm && dbl ? `; beds start at €${dorm.amount} per night in the dorm and €${dbl.amount} for a double room for two` : ''}${minNights ? `, minimum stay ${minNights} nights` : ''}.`,
    `Flag Beach teaches kitesurfing, windsurfing, surfing, wing foiling and SUP and rents equipment; its kite packages combine a 4-day course, equipment and daily beach transfers with a hostel stay on bed and breakfast${cheapestPkg ? ` (7 nights from €${cheapestPkg})` : ''}.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: "Surfer's Retreat",
    summary,
    continent: 'Europe',
    country: 'Spain',
    region: 'Canary Islands',
    spot: 'Corralejo, Fuerteventura',
    itinerarySpots: [],
    durationDays: null,
    // kite packages page: "Kitesurfing courses on Fuerteventura - from beginner to advanced levels"
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: /kitesurfing course/i.test(kite),
    equipmentRental: /equipment rentals?/i.test(kite),
    beginnerFriendly: /beginner/i.test(kite),
    includedServices: facilities,
    optionalServices: [
      'Kitesurf, windsurf, surf, wing foil and SUP courses (Flag Beach Watersports Centre)',
      'Kite equipment rental and storage on the beach',
      ...packages.map(x => `${x.name}: ${x.details} (€${x.amount})`),
    ],
    accommodation: 'boutique hostel with twin and double rooms and a bunk-bed dorm',
    // the facilities list names both "Breakfast" and "Self Catering"; the kite packages say "hostel B&B".
    // What a room-only booking includes is not stated -> null
    mealPlan: null,
    languages: ['en', 'de', 'es', 'it'],
    rooms: [
      { name: 'Dorm room', description: 'Shared dorm with bunk beds, sold per bed.', features: rates.filter(r => /dorm/i.test(r.unit)).map(r => `${r.unit}: ${r.from ? 'from ' : ''}€${r.amount} per night`) },
      { name: 'Twin room', description: 'Twin room, sold per bed.', features: rates.filter(r => /twin/i.test(r.unit)).map(r => `${r.unit}: ${r.from ? 'from ' : ''}€${r.amount} per night`) },
      { name: 'Double room', description: 'Double room; single travellers can take it at a reduced rate.', features: rates.filter(r => /double bed/i.test(r.unit)).map(r => `${r.unit}: ${r.from ? 'from ' : ''}€${r.amount} per night`) },
    ],
    imageUrls: imageUrls.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: FBR_PAGE_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      `description: ${desc.join(' ')}`,
      `prices: ${rates.map(r => `${r.unit} ${r.from ? 'from ' : ''}${r.amount} ${r.currency}/night`).join('; ')}; minimum stay ${minNights ?? '?'} nights`,
      `facilities: ${facilities.join(' | ')}`,
      `kite packages: ${packages.map(x => `${x.name} (${x.details}) ${x.amount}`).join(' | ')}`,
      `kite packages page: ${kite}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const flagBeachSurfersRetreatCorralejo: OfferAdapter = {
  key: 'flag-beach-surfers-retreat-corralejo',
  name: "Flag Beach Surfer's Retreat Corralejo",
  kind: 'accommodation',
  operator: {
    name: 'Flag Beach Watersports Centre',
    websiteUrl: SITE,
    rootDomain: 'flagbeach.com',
  },
  url: FBR_PAGE_URL,
  slotMethod: 'price_table',
  fetchBudget: 3,
  async fetchContent() {
    const [retreat, kitePackages] = [await page(FBR_PAGE_URL), await page(FBR_KITE_PACKAGES_URL)];
    return parseFlagBeachRetreatContent({ retreat, kitePackages });
  },
  async fetchSlots(ctx) {
    const html = await page(FBR_PAGE_URL);
    const rates = parseFbrRates(html);
    if (rates.length < 3) throw new Error(`flag-beach-surfers-retreat: price table not found or changed (${rates.length} rows parsed)`);
    const minNights = parseFbrMinNights(html);
    if (minNights === null) ctx.note('minimum stay sentence not found on the page');
    return buildFbrSlots(rates, minNights);
  },
};
