// ---------------------------------------------------------------------------
// Che Shale, Mambrui bay about 25 km north of Malindi (Kenya) - rustic beach lodge with nine bandas a few steps
// from the sea and its own kite school (Kenya's first, est. 1999, still the only one in the bay).
//
// Data path (checked 2026-10-12): Wix site www.cheshale.com (server-rendered text).
//   content  / (lodge, getting there), /bandas (banda types, sleeps, prices), /kitesurfing (school, wind seasons,
//            course prices, kite storage), /packages (offers, "valid for stays until 15th December 2026").
//   slots    /bandas: per banda type a section "<Name> | Sleeps <n> | <description>" followed by "Single Occupancy:
//            From $135 | per banda, per night" / "Double Occupancy: From $185 | ..." or "Rates from $225 | (min 3
//            pax)" + "Additional guests (above 3 pax) charged at $65 per person, per night". The page carries a
//            desktop and a mobile copy of the tab box with the same values; the first copy wins.
// Booking engine: SiteMinder (direct-book.com/properties/cheshaledirect). robots.txt allows us, but the page loads
//   the AWS WAF challenge script (edge.sdk.awswaf.com .../challenge.js) whose token the booking API needs -> bot
//   protection, not used; slots stay 'unknown'.
// robots.txt (2026-10-12): Wix default ("Allow: /", only *?lightbox= disallowed for *).
// Requests per run: content 4, slots 1.
// Parsed: slot = banda type x guests ("deluxe-banda-2p"), USD "from" price per banda per night, no dates (the
//   page has none), availability 'unknown'. The extra-guest charge goes into the room features.
// Known limits: prices are "from" prices; the page does not say what a banda rate includes (the packages are
//   "on a B&B basis"). The two copies differ in wording for Kole Kole and Kajama, not in prices.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, imageCandidates } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.cheshale.com';
export const CS_HOME_URL = `${SITE}/`;
export const CS_BANDAS_URL = `${SITE}/bandas`;
const CS_KITE_URL = `${SITE}/kitesurfing`;
const CS_PACKAGES_URL = `${SITE}/packages`;
const BOOKING_URL = 'https://direct-book.com/properties/cheshaledirect';

/** Visible text of a Wix page as one string, blocks separated by " | " (scripts / styles dropped). */
export function csText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .split(/<\/?(?:p|li|h\d|div|br|span|section)\b[^>]*>/i)
    .map(s => clean(s.replace(/<[^>]+>/g, ' ')).replace(/​/g, '').trim())
    .filter(Boolean)
    .join(' | ');
}

// --- pure parsers -----------------------------------------------------------------------------
export interface CsBanda { id: string; name: string; sleeps: string | null; single: number | null; double: number | null; groupFrom: number | null; minPax: number | null; extraPerPerson: number | null; description: string }

/** Name for a section heading ("Deluxe Bandas" -> "Deluxe Banda"). */
const bandaName = (h: string): string => h.replace(/\bBandas\b/, 'Banda').trim();
const bandaId = (name: string): string => name.toLowerCase().replace(/&/g, ' ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Banda sections "<Name> | Sleeps <n> | <description> | <prices>" (the page carries a desktop and a mobile copy; first wins). */
export function parseCsBandas(html: string): CsBanda[] {
  const t = csText(html);
  const out: CsBanda[] = [];
  const re = /(?:^|\| )([A-Z][A-Za-z &]*? Bandas?) \| Sleeps ([\d-]+) \| ([^|]+?) \| ([\s\S]*?)(?=\| [A-Z][A-Za-z &]*? Bandas? \| Sleeps |\| BOOK |$)/g;
  for (const m of t.matchAll(re)) {
    const name = bandaName(m[1]);
    if (out.some(b => b.name === name)) continue;
    const block = `${m[3]} | ${m[4]}`;
    const single = block.match(/Single Occupancy: From \$(\d+) \| per banda, per night/);
    const double = block.match(/Double Occupancy: From \$(\d+) \| per banda, per night/);
    const group = block.match(/Rates from \$(\d+) \| \(min (\d+) pax\)/);
    const extra = block.match(/Additional guests \(above \d+ pax\) charged at \$(\d+) per person, per night/);
    if (!single && !double && !group) continue;
    out.push({
      id: bandaId(name), name, sleeps: m[2],
      single: single ? Number(single[1]) : null,
      double: double ? Number(double[1]) : null,
      groupFrom: group ? Number(group[1]) : null,
      minPax: group ? Number(group[2]) : null,
      extraPerPerson: extra ? Number(extra[1]) : null,
      description: m[3].trim(),
    });
  }
  return out;
}

export function buildCsSlots(bandas: CsBanda[]): Slot[] {
  const out: Slot[] = [];
  const base = { startDate: null, endDate: null, currency: 'USD', priceUnit: 'per_night' as const, priceBasis: 'room' as const, availability: 'unknown' as const, availabilityText: null, spotsLeft: null };
  for (const b of bandas) {
    if (b.single !== null) out.push({ ...base, key: `${b.id}-1p`, unit: b.name, price: b.single, occupancy: 1 });
    if (b.double !== null) out.push({ ...base, key: `${b.id}-2p`, unit: b.name, price: b.double, occupancy: 2 });
    if (b.groupFrom !== null) out.push({ ...base, key: `${b.id}-${b.minPax}p`, unit: b.name, price: b.groupFrom, occupancy: b.minPax });
  }
  return out;
}

// --- content ----------------------------------------------------------------------------------
export interface CsPages { home: string; bandas: string; kite: string; packages: string }

export function parseCheShaleContent(p: CsPages): OfferContent {
  const home = csText(p.home);
  const bandasText = csText(p.bandas);
  const kite = csText(p.kite);
  const packages = csText(p.packages);
  const bandas = parseCsBandas(p.bandas);
  const nBandas = home.match(/With just (\w+) uniquely designed bandas/)?.[1] ?? bandasText.match(/captured in (\d+) uniquely designed/)?.[1] ?? null;
  const established = kite.match(/EST\. (\d{4})/)?.[1] ?? null;
  const kuzi = kite.match(/Kuzi, June to the end of September\.\s*\|?\s*The wind blows from the south-east at ([\d to]+ knots)/)?.[1] ?? null;
  const kaskazi = kite.match(/Kaskazi, mid-December to mid-April\.\s*\|?\s*The wind blows from the north-east, comes in after lunch, and averages ([\d to]+ knots)/)?.[1] ?? null;
  const course = (re: RegExp) => kite.match(re)?.[1]?.replace(/\$(\d+)/, 'USD $1').replace(/\s*p\.p\.?$/, ' per person') ?? null;
  const beginner = course(/Beginner Kite Course \| 8-10 hours 1-2-1 lessons \(3-4 days\) \| (\$\d+ p\.p\.?)/);
  const refresher = course(/Refresher Kite Course \| 6 hours 1-2-1 lessons \| \(2-3 days\) \| (\$\d+ p\.p\.?)/);
  const coaching = course(/Private Coaching \| 1-2-1 lessons \| (\$\d+ per hour)/);
  const offers = [
    /Children under 12 stay free/i.test(packages) ? 'Family package: children under 12 stay free (B&B, sharing with a full-paying adult, minimum 2 nights, not in peak periods)' : null,
    /fourth night is on us/i.test(packages) ? 'Stay a little longer: 4 nights for the price of 3 (B&B, minimum 4 nights' + (packages.match(/valid for stays until ([^|]+?\d{4})/) ? `, stays until ${packages.match(/valid for stays until ([^|]+?\d{4})/)![1]}` : '') + ')' : null,
    /Kulalu Camp/i.test(packages) ? 'Beach to bush: beach stay combined with a safari at Kulalu Camp (under two hours away)' : null,
  ].filter((x): x is string => !!x);
  const valid = packages.match(/valid for stays until ([^|]+?\d{4})/)?.[1] ?? null;
  const cheapest = [...bandas].filter(b => b.double !== null).sort((a, b) => a.double! - b.double!)[0];

  const rooms: ContentRoom[] = bandas.map(b => ({
    name: b.name,
    description: b.description || null,
    features: [
      b.sleeps ? `Sleeps ${b.sleeps}` : null,
      b.single !== null ? `Single occupancy: from USD ${b.single} per banda per night` : null,
      b.double !== null ? `Double occupancy: from USD ${b.double} per banda per night` : null,
      b.groupFrom !== null ? `From USD ${b.groupFrom} per banda per night (min ${b.minPax} guests)` : null,
      b.extraPerPerson !== null ? `Additional guests above ${b.minPax}: USD ${b.extraPerPerson} per person per night` : null,
    ].filter((x): x is string => !!x),
  }));

  const imgs: string[] = [];
  for (const [html, base] of [[p.bandas, CS_BANDAS_URL], [p.home, CS_HOME_URL], [p.kite, CS_KITE_URL]] as const) {
    for (const u of imageCandidates(html, base, null, 80)) {
      if (!/^https:\/\/static\.wixstatic\.com\/media\/[^/]+$/.test(u) || /\.png$|\.svg$/i.test(u) || imgs.includes(u)) continue;
      imgs.push(u);
    }
  }

  const summary = [
    `Che Shale is a beach lodge on a secluded bay at Mambrui, about 25 km north of Malindi on the Kenyan coast, with ${nBandas ?? 'nine'} bandas built from palm, mango wood and driftwood a few steps from the sea, a seafood restaurant and dhow and fishing trips.`,
    `Its kite school, founded in ${established ?? '1999'} as Kenya's first and still the only one in the bay, teaches beginners to advanced riders, stores guests' gear and gives launch, landing and rescue help; the bay is kiteable at any tide, with the Kuzi wind from June to September${kuzi ? ` (${kuzi})` : ''} and the Kaskazi from mid-December to mid-April${kaskazi ? ` (${kaskazi})` : ''}.`,
    `Bandas range from the Kajama and Che Shale bandas to two Deluxe bandas and family bandas for up to 6${cheapest ? `, from USD ${cheapest.double} per banda per night for two (${cheapest.name})` : ''}.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Che Shale',
    summary,
    continent: 'Africa',
    country: 'Kenya',
    region: 'Kilifi County',
    spot: 'Mambrui, Malindi',
    itinerarySpots: [],
    durationDays: null,
    // kitesurfing page, "Spot Breakdown: Beginners/Intermediate/Advance Riders"
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: !!beginner || /Lessons or Coaching/i.test(kite),
    equipmentRental: null, // the site names lessons and storage, not rental
    beginnerFriendly: /flat water for learning/i.test(kite),
    includedServices: [
      /Kite Storage Available/i.test(kite) ? 'Kite storage at the school (free when travelling with own gear)' : null,
      'Launch and landing assistance, rescue service',
    ].filter((x): x is string => !!x),
    optionalServices: [
      beginner ? `Beginner kite course, 8-10 h 1-2-1 over 3-4 days: ${beginner}` : null,
      refresher ? `Refresher kite course, 6 h 1-2-1: ${refresher}` : null,
      coaching ? `Private coaching: ${coaching}` : null,
      'Downwinders across the bay',
      'Kite day trip on the dhow Sawa Sawa (December to April)',
      'Deep sea fishing, dhow trips, transfers from Malindi or Mombasa airport',
      ...offers,
    ].filter((x): x is string => !!x),
    accommodation: `${nBandas ?? 'nine'} beach bandas (Kajama, Che Shale and Deluxe bandas, family bandas)`,
    mealPlan: null,
    languages: ['en'],
    rooms,
    imageUrls: imgs.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: CS_HOME_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      `home: ${home}`,
      `bandas: ${bandasText}`,
      `kitesurfing: ${kite}`,
      `packages: ${packages}${valid ? ` (offer valid until ${valid})` : ''}`,
      `parsed bandas: ${bandas.map(b => `${b.name} ${b.single ?? '-'}/${b.double ?? '-'} group ${b.groupFrom ?? '-'} min ${b.minPax ?? '-'}`).join('; ')}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const cheShaleMambrui: OfferAdapter = {
  key: 'che-shale-mambrui',
  name: 'Che Shale',
  kind: 'accommodation',
  operator: {
    name: 'Che Shale',
    websiteUrl: SITE,
    rootDomain: 'cheshale.com',
    contactEmail: 'info@cheshale.com',
    phone: '+254722230931',
  },
  url: CS_HOME_URL,
  slotMethod: 'price_table',
  fetchBudget: 5,
  async fetchContent() {
    const home = await fetchText(CS_HOME_URL, { accept: 'text/html' });
    const bandas = await fetchText(CS_BANDAS_URL, { accept: 'text/html' });
    const kite = await fetchText(CS_KITE_URL, { accept: 'text/html' });
    const packages = await fetchText(CS_PACKAGES_URL, { accept: 'text/html' });
    return parseCheShaleContent({ home, bandas, kite, packages });
  },
  async fetchSlots() {
    const bandas = parseCsBandas(await fetchText(CS_BANDAS_URL, { accept: 'text/html' }));
    if (bandas.length < 4) throw new Error(`che-shale: banda prices not found or changed (${bandas.length} banda types parsed)`);
    return buildCsSlots(bandas);
  },
};
