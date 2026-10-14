// ---------------------------------------------------------------------------
// Hatteras Island Vacation Rentals - the three soundfront kite homes in Avon (Hatteras Island, North Carolina, USA):
// Seas the Breeze I (#101), Seas the Breeze II (#102) and Sounds Sea'rious (#105), three neighbouring 10-bedroom houses
// on Pamlico Sound north of Canadian Hole / Kite Point, each with its own sound beach to launch and land kites, an
// outside gear closet, private heated pool and hot tub; owner-managed, each house rented in its entirety.
// One listing for the three: the site sells them as separate houses (own pages, own calendars) but markets them as a
// set ("rent one, two or three 10BR vacation homes for your group", "trio of homes ... up to 72 people").
// The operator's two oceanfront houses (Lady of Dare, Looney Dunes) have no kite link and are not listed.
//
// Data path (checked 2026-10-14): OwnerRez hosted site (www.hatterasislandvacationrentals.com).
//   content  / (what every home includes, the comparison table with the kite notes) + the three property pages:
//            JSON-LD VacationRental (name, latitude/longitude, bedrooms, bathrooms, occupancy, beds, photos on
//            uc.orez.io, check-in/out) and the page text (kite beach, gear closet, pool season and pool-heat fee).
//   slots    none. No rate is printed on the site; rates, quotes and the availability calendar are OwnerRez widgets
//            loaded from app.ownerrez.com/widgets/*, which app.ownerrez.com/robots.txt disallows (also /api,
//            /services) -> [] ("price on request"). The site's own POST search (/properties with arrival/departure,
//            anonymous, robots allowed) returns which houses are free for given dates but no price, and the stay
//            rules (turnover day, minimum nights) are not published, so a sample week could read as "taken" when it
//            only breaks a rule - not used (open question in the report). fetchSlots re-reads one property page
//            (memoised) and notes when a nightly price appears.
// robots.txt (2026-10-14): www.hatterasislandvacationrentals.com "User-agent: * / Allow: *".
// Requests per run: content 4, slots 1 (memoised with content).
// spotCoords: mean of the three houses' JSON-LD coordinates (they lie within ~250 m of each other).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, collapse, ldOfType, parse } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.hatterasislandvacationrentals.com';
export const HIVR_HOME_URL = `${SITE}/`;
export const HIVR_HOUSES = [
  { url: `${SITE}/seas-the-breeze-i-orp5b5e665x`, number: '101' },
  { url: `${SITE}/seas-the-breeze-ii-orp5b5e666x`, number: '102' },
  { url: `${SITE}/sounds-searious-orp5b66becx`, number: '105' },
];

// --- local helpers ----------------------------------------------------------------------------
const memo = new Map<string, { at: number; p: Promise<string> }>();
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}
const num = (v: unknown): number | null => { const n = Number(v); return v !== null && v !== undefined && v !== '' && Number.isFinite(n) ? n : null; };

/** Visible text of an OwnerRez page body (scripts, styles, nav, header, footer dropped). */
export function hivrText(html: string): string {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, nav, header, footer, form, svg')) el.remove();
  return collapse((root.querySelector('body') ?? root).text);
}

export interface HivrHouse {
  name: string; number: string | null; url: string; subtitle: string | null; lat: number | null; lng: number | null;
  bedrooms: number | null; bathrooms: number | null; sleeps: number | null; beds: string | null; sqft: number | null;
  checkIn: string | null; checkOut: string | null; images: Array<{ src: string; alt: string }>; kiteLines: string[];
  poolHeat: string | null; poolSeason: string | null; minAge: string | null; text: string;
}

/** One property page -> house facts (JSON-LD VacationRental + page text). */
export function parseHivrHouse(html: string, url: string): HivrHouse {
  const ld = ldOfType(html, 'VacationRental')[0] ?? {};
  const place = (ld.containsPlace ?? {}) as Record<string, unknown>;
  const beds = ((place.bed ?? []) as Array<Record<string, unknown>>)
    .map(b => `${num(b.numberOfBeds) ?? ''} ${String(b.typeOfBed ?? '').toLowerCase()}`.trim()).filter(Boolean);
  const text = hivrText(html);
  const name = clean(String(ld.name ?? '')) || (parse(html).querySelector('h1')?.text.trim() ?? '');
  const root = parse(html);
  const gallery: Array<{ src: string; alt: string }> = [];
  for (const img of root.querySelectorAll('figure.item img')) {
    const src = img.getAttribute('src') ?? '';
    if (/^https:\/\/uc\.orez\.io\/f\/[0-9a-f]+$/.test(src) && !gallery.some(g => g.src === src)) gallery.push({ src, alt: clean(img.getAttribute('alt') ?? '') });
  }
  const ldImages = ((ld.image ?? []) as unknown[]).filter((u): u is string => typeof u === 'string');
  for (const src of ldImages) if (!gallery.some(g => g.src === src)) gallery.push({ src, alt: '' });
  const sentences = text.split(/(?<=[.!])\s+/);
  const kiteLines = sentences.filter(s => /kite|wind ?surf|gear closet/i.test(s) && s.length < 400 && !/Toggle|Blog/i.test(s));
  const subtitle = text.match(new RegExp(`Search ${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} (.+?) ★`))?.[1] ?? null;
  const time = (v: unknown) => (typeof v === 'string' ? v.slice(0, 5) : null);
  return {
    name,
    number: text.match(/#(\d{3}) in Avon/)?.[1] ?? null,
    url,
    subtitle: subtitle ? collapse(subtitle) : null,
    lat: num(ld.latitude),
    lng: num(ld.longitude),
    bedrooms: num(place.numberOfBedrooms),
    bathrooms: num(place.numberOfBathroomsTotal),
    sleeps: num((place.occupancy as Record<string, unknown> | undefined)?.value),
    beds: beds.length ? beds.join(', ') : null,
    sqft: num((place.floorSize as Record<string, unknown> | undefined)?.value),
    checkIn: time(ld.checkinTime),
    checkOut: time(ld.checkoutTime),
    images: gallery,
    kiteLines,
    poolHeat: text.match(/pool that can be heated for \$[\d,]+[^.]*|Pool heat additional \$[\d,]+ per week[^.]*/i)?.[0] ?? null,
    poolSeason: text.match(/Pool is open ([A-Za-z]+ \d+(?:st|nd|rd|th)? - [A-Za-z]+ \d+(?:st|nd|rd|th)?)/i)?.[1] ?? null,
    minAge: text.match(/Minimum age of primary renter: (\d+)/i)?.[1] ?? null,
    text,
  };
}

/** Images: per house the kite photos, then sound-beach / aerial photos, then the gallery in order, interleaved across houses. */
export function hivrImages(houses: HivrHouse[], max = 40): string[] {
  const tier = (alt: string) => (/kite/i.test(alt) ? 0 : /sound ?front beach|sound beach|overhead|aerial/i.test(alt) ? 1 : 2);
  const kiteFirst = houses.map(h => [...h.images].sort((a, b) => tier(a.alt) - tier(b.alt)).map(i => i.src));
  const out: string[] = [];
  for (let i = 0; out.length < max && kiteFirst.some(l => i < l.length); i++) {
    for (const l of kiteFirst) if (l[i] && !out.includes(l[i]) && out.length < max) out.push(l[i]);
  }
  return out;
}

export function hivrCoords(houses: HivrHouse[]): { lat: number; lng: number } | null {
  const pts = houses.filter(h => h.lat !== null && h.lng !== null);
  if (pts.length === 0) return null;
  const avg = (xs: number[]) => Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 1e5) / 1e5;
  return { lat: avg(pts.map(h => h.lat!)), lng: avg(pts.map(h => h.lng!)) };
}

// --- content ----------------------------------------------------------------------------------
export interface HivrPages { home: string; houses: Array<{ html: string; url: string }> }

export function parseHatterasRentalsContent(p: HivrPages): OfferContent {
  const home = hivrText(p.home);
  const houses = p.houses.map(h => parseHivrHouse(h.html, h.url));
  const coords = hivrCoords(houses);
  const included = home.match(/All Hatteras Island Vacation Rentals listed here are waterfront, pet friendly and include ([^.]+?) to provide/i)?.[1] ?? null;
  const sleepsTotal = houses.reduce((a, h) => a + (h.sleeps ?? 0), 0);

  const rooms: ContentRoom[] = houses.map(h => ({
    name: h.name,
    description: h.subtitle ? `${h.subtitle}${h.number ? ` (house #${h.number}, Avon)` : ''}` : null,
    features: [
      h.bedrooms !== null ? `${h.bedrooms} bedrooms` : null,
      h.bathrooms !== null ? `${h.bathrooms} bathrooms` : null,
      h.sleeps !== null ? `Sleeps up to ${h.sleeps}` : null,
      h.beds ? `Beds: ${h.beds}` : null,
      h.sqft ? `${h.sqft.toLocaleString('en-US')} sq ft` : null,
      'Soundfront with own sound beach (launch and land kites), outside gear closet',
      'Private pool and 8-person hot tub, elevator, game room, theater room',
      h.poolSeason ? `Pool open ${h.poolSeason}` : null,
      h.poolHeat && /\$\s?([\d,]+)/.test(h.poolHeat) ? `Pool heating USD ${h.poolHeat.match(/\$\s?([\d,]+)/)![1]} per week (optional)` : null,
      h.checkIn && h.checkOut ? `Check-in ${h.checkIn}, check-out ${h.checkOut}` : null,
      h.minAge ? `Minimum age of primary renter: ${h.minAge}` : null,
      'Whole house rental; price on request (online quote on the site)',
    ].filter((x): x is string => !!x),
  }));

  const summary = [
    `Hatteras Island Vacation Rentals lets three neighbouring soundfront houses in Avon on Hatteras Island, North Carolina - Seas the Breeze I, Seas the Breeze II and Sounds Sea'rious - each with 10 en-suite bedrooms for up to ${houses[0]?.sleeps ?? 24} guests, rented as a whole house (one, two or all three${sleepsTotal ? `, up to ${sleepsTotal} guests` : ''}).`,
    `The houses sit on Pamlico Sound just north of Canadian Hole and Kite Point; each has its own sandy sound beach a few steps away to launch and land kites, and an outside gear closet.`,
    `Every house has a private pool and hot tub, elevator, game and theater rooms, a full kitchen, linens and towels; the owner manages them directly and books online through the site.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Hatteras Island Vacation Rentals - soundfront kite homes',
    summary,
    continent: 'North America',
    country: 'United States',
    region: 'Hatteras Island, North Carolina',
    spot: 'Avon',
    ...(coords ? { spotCoords: coords } : {}),
    itinerarySpots: [],
    durationDays: null,
    skillLevels: [],
    kiteLessons: null,
    equipmentRental: null,
    // "Watersport novices and pros alike", "Family friendly shallow waters"
    beginnerFriendly: null,
    includedServices: [
      ...(included ? included.split(/,\s*(?:and\s+)?/).map(s => s.trim().replace(/^an? /i, '').replace(/ and more$/i, '')).filter(Boolean).map(s => s.replace(/^./, c => c.toUpperCase())) : []),
      'Own sound beach for kite launch and landing',
      'Outside gear closet',
    ],
    optionalServices: ['Pool heating (USD 600 per week)', 'Dogs (pet fee per dog)', 'Travel insurance'],
    accommodation: 'three 10-bedroom soundfront vacation houses (whole-house rental)',
    mealPlan: 'self_catering',
    languages: ['en'],
    rooms,
    imageUrls: hivrImages(houses),
    heroVideoUrl: null,
    sourceUrl: HIVR_HOUSES[2].url,
    bookingUrl: `${SITE}/properties`,
    sourceText: [
      `home: ${home.match(/Why rent with us\?[\s\S]*?(?=\d+ vacation rentals|$)/)?.[0] ?? home.slice(0, 3000)}`,
      ...houses.map(h => `${h.name} (#${h.number ?? '?'}, ${h.url}): ${h.bedrooms} BR, ${h.bathrooms} baths, sleeps ${h.sleeps}, beds ${h.beds}; ${h.lat},${h.lng}; pool ${h.poolSeason ?? '-'}; ${h.poolHeat ?? '-'}; kite: ${h.kiteLines.join(' ')}`),
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const hatterasIslandVacationRentalsAvon: OfferAdapter = {
  key: 'hatteras-island-vacation-rentals-avon',
  name: 'Hatteras Island Vacation Rentals, soundfront kite homes (Avon)',
  kind: 'accommodation',
  operator: {
    name: 'Hatteras Island Vacation Rentals',
    websiteUrl: SITE,
    rootDomain: 'hatterasislandvacationrentals.com',
    contactEmail: 'Info@RentHatteras.com',
    phone: '+12525525270',
  },
  url: HIVR_HOUSES[2].url,
  slotMethod: 'booking_engine',
  fetchBudget: 5,
  confidence: 'medium',
  async fetchContent() {
    const home = await page(HIVR_HOME_URL);
    const houses: Array<{ html: string; url: string }> = [];
    for (const h of HIVR_HOUSES) houses.push({ html: await page(h.url), url: h.url });
    return parseHatterasRentalsContent({ home, houses });
  },
  async fetchSlots(ctx): Promise<Slot[]> {
    const html = await page(HIVR_HOUSES[2].url);
    const h = parseHivrHouse(html, HIVR_HOUSES[2].url);
    if (!h.name || h.bedrooms === null) throw new Error('hatteras-island-vacation-rentals: property JSON-LD missing (layout changed?)');
    const nightly = h.text.match(/\$\s?[\d,]+(?:\.\d{2})?\s*(?:\/|per)\s*night/i)?.[0] ?? null;
    if (nightly) ctx.note(`a nightly price appeared on the Sounds Sea'rious page (${nightly}): extend the adapter`);
    return [];
  },
};
