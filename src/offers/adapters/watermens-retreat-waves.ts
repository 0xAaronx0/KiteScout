// ---------------------------------------------------------------------------
// Watermen's Retreat, Waves (Hatteras Island, North Carolina, USA) - waterfront resort of 14 suites, 8 cabanas
// and one cottage on Pamlico Sound at "The Slick", directly beside REAL Watersports (kite school, rental shop) with
// a private kite launch for guests (air compressors, gear lockers, hot showers), secure gear storage in every unit.
//
// Data path (checked 2026-10-14): WordPress + the Streamline VRS plugin ("streamline-core" 3.4.0-beta3, ResortPro),
// the same engine and the same anonymous plugin proxy as villa-esencia-long-bay.ts:
//   content  / (14 suites, 1 cottage, 8 cabanas; 3-night stays), /play/kiteboarding/ (REAL, private launch,
//            compressors, lockers), /about/ (what the rate includes, 12.75% tax, check-in), /accommodations/ (the
//            nine unit types and their beds) + the Streamline unit list below.
//   engine   POST /wp-admin/admin-ajax.php?action=streamlinecore-api-request&params={"methodName":M,"params":P}
//            (empty body, exactly as resortpro.min.js rpapi.getWithParams calls it; no login, nonce, cookie or token):
//            M = GetPropertyListWordPress -> 23 units (bedrooms, bathrooms, max_occupants, view_name, floor_name,
//                location_area_name, location_latitude/longitude, price_data.daily = "from" rate, default image);
//            M = GetPropertyAvailabilityWithRatesWordPress {startdate, enddate (MM/DD/YYYY), occupants 2, floor_name 1,
//                use_bundled_fees_in_room_rate 1, page_results_number 50} -> the units free for that stay with
//                price (rent), taxes, total. This is the site's own date search.
//            NOT used: GetTapeChartData (guest names) and the per-unit calendars (two calls per unit).
//   slots    one sample stay per month (Saturday to Saturday, 7 nights, check-in on the 2nd Saturday) for the next 12
//            months; per unit type (the site's nine types on /accommodations/): the cheapest free unit's rent / 7 =
//            USD per unit per night, spotsLeft = free units of the type, 'sold_out' when no unit of the type is free
//            for that week. Tax (12.75%) is printed by the engine separately and goes into availabilityText.
// robots.txt (2026-10-14): Yoast block "User-agent: * / Allow:" - everything allowed.
// Requests per run: content 4 + 1 (unit list, memoised), slots 1 (list, memoised) + 12 -> 17 for a full run.
// Known limits: one sample week per month (a unit booked for part of that week counts as taken for that month);
//   minimum stays (3-4 nights by season) and shorter stays are not sampled; occupancy surcharges none seen.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, collapse, imageCandidates, iso, parse, todayIso } from '../parse.js';
import type { ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.watermensretreat.com';
export const WR_HOME_URL = `${SITE}/`;
export const WR_KITE_URL = `${SITE}/play/kiteboarding/`;
export const WR_ABOUT_URL = `${SITE}/about/`;
export const WR_ACCOM_URL = `${SITE}/accommodations/`;
const AJAX = `${SITE}/wp-admin/admin-ajax.php`;
export const WR_SAMPLE_NIGHTS = 7;
const SAMPLE_MONTHS = 12;

export interface WrUnit {
  id: number; name: string; bedrooms: number | null; bathrooms: number | null; maxGuests: number | null;
  view: string | null; floor: string | null; area: string | null; lat: number | null; lng: number | null;
  fromDaily: number | null; currency: string | null; image: string | null; description: string | null;
}
export interface WrQuote { id: number; name: string; rent: number; taxes: number | null; total: number | null }

/** The plugin's admin-ajax proxy URL for one Streamline method. */
export function wrApiUrl(method: string, params: Record<string, unknown>): string {
  return `${AJAX}?action=streamlinecore-api-request&params=${encodeURIComponent(JSON.stringify({ methodName: method, params }))}`;
}
export const WR_LIST_URL = wrApiUrl('GetPropertyListWordPress', { page_number: 1, page_results_number: 50, use_description: 'no', use_amenities: 'no' });
/** check-in / check-out as ISO dates -> the site's own date search. */
export function wrSearchUrl(checkIn: string, checkOut: string): string {
  const us = (d: string) => `${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(0, 4)}`;
  return wrApiUrl('GetPropertyAvailabilityWithRatesWordPress', {
    startdate: us(checkIn), enddate: us(checkOut), occupants: 2, page_number: 1, page_results_number: 50,
    use_bundled_fees_in_room_rate: 1, floor_name: 1, use_room_type_logic: 0, sort_by: 'name',
  });
}

// --- local helpers ----------------------------------------------------------------------------
const keyPart = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const num = (v: unknown): number | null => { const n = Number(v); return v !== null && v !== undefined && v !== '' && Number.isFinite(n) ? n : null; };
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? collapse(v) : null);
const addDays = (d: string, n: number): string => new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10);
const money = (n: number): string => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function post(url: string): Promise<string> {
  return fetchText(url, { method: 'POST', contentType: 'application/json', accept: 'application/json, text/plain, */*' });
}
const memo = new Map<string, { at: number; p: Promise<string> }>();
function once(url: string, load: (u: string) => Promise<string>): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = load(url);
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}
function asList(raw: unknown): Array<Record<string, unknown>> {
  return (Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? [raw] : []) as Array<Record<string, unknown>>;
}

// --- pure parsers -----------------------------------------------------------------------------
/** GetPropertyListWordPress -> units. */
export function parseWrUnits(json: string): WrUnit[] {
  const d = JSON.parse(json) as { data?: { property?: unknown } };
  return asList(d.data?.property).map(p => {
    const price = (p.price_data ?? {}) as Record<string, unknown>;
    const desc = typeof p.short_description === 'string' ? clean(p.short_description.replace(/<br\s*\/?>/gi, ' ')) : '';
    return {
      id: Number(p.id),
      name: collapse(String(p.name ?? '')),
      bedrooms: num(p.bedrooms_number),
      bathrooms: num(p.bathrooms_number),
      maxGuests: num(p.max_occupants),
      view: str(p.view_name),
      floor: str(p.floor_name),
      area: str(p.location_area_name),
      lat: num(p.location_latitude ?? p.latitude),
      lng: num(p.location_longitude ?? p.longitude),
      fromDaily: num(price.daily),
      currency: str(price.currency),
      image: str(p.default_image_path),
      description: desc || null,
    };
  }).filter(u => u.id && u.name);
}

const WORDS: Record<number, string> = { 1: 'One', 2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five' };
/** The site's unit types (/accommodations/): suites by bedrooms + view, waterfront top floor = penthouse, cabanas
 *  by bedrooms, the cottage. Unknown future units fall back to "<n> Bedroom <area>". */
export function wrUnitType(u: Pick<WrUnit, 'name' | 'bedrooms' | 'view' | 'floor' | 'area'>): string {
  const n = u.bedrooms ? (WORDS[u.bedrooms] ?? String(u.bedrooms)) : null;
  const area = u.area ?? '';
  if (/cottage|hideout/i.test(`${area} ${u.name}`)) return "Watermen's Hideout (cottage)";
  if (/cabana/i.test(area)) return n ? `${n} Bedroom Cabana` : 'Cabana';
  if (/suite|penthouse/i.test(area) && n && u.view) {
    if (/waterfront/i.test(u.view) && /3rd/i.test(u.floor ?? '')) return `${n} Bedroom Waterfront Penthouse`;
    return `${n} Bedroom ${u.view.replace(/\bview\b/i, 'View')} Suite`;
  }
  return n ? `${n} Bedroom ${area || 'Unit'}` : u.name;
}

/** GetPropertyAvailabilityWithRatesWordPress -> the free units with rent, tax and total for the searched stay. */
export function parseWrSearch(json: string): WrQuote[] {
  const d = JSON.parse(json) as { data?: { available_properties?: { property?: unknown } } };
  const out: WrQuote[] = [];
  for (const p of asList(d.data?.available_properties?.property)) {
    const rent = num(p.price);
    if (!p.id || !rent || rent <= 0) continue;
    out.push({ id: Number(p.id), name: collapse(String(p.name ?? '')), rent, taxes: num(p.taxes), total: num(p.total) });
  }
  return out;
}

/** Check-in = 2nd Saturday of each of the next `months` months (from the month after `today`). */
export function wrSampleStays(today: string, months = SAMPLE_MONTHS): Array<{ month: string; checkIn: string; checkOut: string }> {
  const out: Array<{ month: string; checkIn: string; checkOut: string }> = [];
  let y = +today.slice(0, 4);
  let m = +today.slice(5, 7);
  for (let i = 0; i < months; i++) {
    m++; if (m > 12) { m = 1; y++; }
    const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay(); // 0 = Sunday
    const firstSat = 1 + ((6 - first + 7) % 7);
    const checkIn = iso(y, m, firstSat + 7);
    out.push({ month: checkIn.slice(0, 7), checkIn, checkOut: addDays(checkIn, WR_SAMPLE_NIGHTS) });
  }
  return out;
}

/** One slot per unit type and sample week. */
export function buildWrSlots(units: WrUnit[], samples: Array<{ month: string; checkIn: string; checkOut: string; quotes: WrQuote[] }>): Slot[] {
  const types = new Map<string, WrUnit[]>();
  for (const u of units) {
    const t = wrUnitType(u);
    types.set(t, [...(types.get(t) ?? []), u]);
  }
  const out: Slot[] = [];
  for (const s of samples) {
    const byId = new Map(s.quotes.map(q => [q.id, q]));
    for (const [type, us] of types) {
      const free = us.map(u => byId.get(u.id)).filter((q): q is WrQuote => !!q).sort((a, b) => a.rent - b.rent);
      const best = free[0] ?? null;
      const nights = WR_SAMPLE_NIGHTS;
      out.push({
        key: `${keyPart(type)}|${s.month}`,
        startDate: s.checkIn,
        endDate: addDays(s.checkOut, -1),
        unit: type,
        price: best ? Math.round((best.rent / nights) * 100) / 100 : null,
        currency: best ? 'USD' : null,
        priceUnit: best ? 'per_night' : null,
        priceBasis: best ? 'room' : null,
        occupancy: null,
        availability: best ? 'available' : 'sold_out',
        availabilityText: best
          ? `${free.length} of ${us.length} free for ${s.checkIn} to ${s.checkOut} (${nights} nights): rent USD ${money(best.rent)}${best.taxes ? ` + tax USD ${money(best.taxes)}` : ''} (${best.name})`
          : `none of ${us.length} free for ${s.checkIn} to ${s.checkOut} (${nights} nights)`,
        spotsLeft: free.length,
      });
    }
  }
  return out;
}

/** Median of the unit pins (the suites, cabanas and cottage sit within ~150 m of each other). */
export function wrCoords(units: WrUnit[]): { lat: number; lng: number } | null {
  const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  const lats = units.map(u => u.lat).filter((x): x is number => x !== null && x !== 0);
  const lngs = units.map(u => u.lng).filter((x): x is number => x !== null && x !== 0);
  if (lats.length < 3 || lngs.length < 3) return null;
  return { lat: Math.round(med(lats) * 1e5) / 1e5, lng: Math.round(med(lngs) * 1e5) / 1e5 };
}

// --- content ----------------------------------------------------------------------------------
export function wrLines(html: string): string[] {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, header, footer, nav, form')) el.remove();
  return (root.querySelector('body') ?? root).querySelectorAll('h1, h2, h3, h4, h5, p, li').map(e => collapse(e.text)).filter(Boolean);
}
/** WordPress photos of a page (originals, no template stock / logos / buttons / icons). */
export function wrImages(html: string, base: string): string[] {
  const out: string[] = [];
  const raw = [...imageCandidates(html, base, null, 60),
    ...[...html.matchAll(/((?:https:\/\/www\.watermensretreat\.com)?\/wp-content\/uploads\/[^"'\s)]+?\.(?:jpe?g|webp))/gi)].map(m => new URL(m[1], base).toString())];
  for (const u0 of raw) {
    if (!/watermensretreat\.com\/wp-content\/uploads\//.test(u0)) continue;
    if (/logo|icon|button|chevron|arrow|amelia-island|stowe-mountain|winter-in-the-woods|\.png$|\.svg$/i.test(u0)) continue;
    const u = u0.replace(/-(?:\d+x\d+|scaled)(?=\.[a-z]+$)/i, '');
    if (!out.includes(u)) out.push(u);
  }
  return out;
}

export const wrNorm = (s: string): string => s.toLowerCase().replace(/[’']/g, "'").replace(/\s*\(cottage\)/, '').trim();
/** /accommodations/: per unit type the text between its heading and "Learn More" (views, floor, beds, weekly). */
export function wrTypeFacts(html: string): Map<string, string> {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, header, footer, nav, form')) el.remove();
  const text = collapse((root.querySelector('body') ?? root).text).replace(/[’]/g, "'");
  const out = new Map<string, string>();
  for (const m of text.matchAll(/((?:One|Two|Three|Four|Five) Bedroom(?: [A-Za-z]+)*? (?:Suite|Penthouse|Cabana)|Watermen's Hideout) ((?:(?!Learn More).){5,160}?) Learn More/g)) {
    const facts = m[2].replace(/\s*\|\s*/g, ' | ').trim();
    if (/king|queen|twin|bunk/i.test(facts) && !out.has(wrNorm(m[1]))) out.set(wrNorm(m[1]), facts);
  }
  return out;
}

export interface WrPages { home: string; kite: string; about: string; accom: string; list: string }

export function parseWatermensContent(p: WrPages): OfferContent {
  const home = wrLines(p.home);
  const kite = wrLines(p.kite);
  const about = wrLines(p.about);
  const accom = wrLines(p.accom);
  const homeText = home.join(' ');
  const kiteText = kite.join(' ');
  const aboutText = about.join(' ');
  const units = parseWrUnits(p.list);
  const coords = wrCoords(units);
  const counts = homeText.match(/consists of (\d+) suites, (\d+) cottage and (\d+) cabanas/i);
  const tax = aboutText.match(/([\d.]+)% tax is applied/i)?.[1] ?? null;
  const included = aboutText.match(/What is included in the rate\? ([^?]+?\.)(?= What|$)/i)?.[1] ?? null;
  const checkIn = aboutText.match(/Check in is available any time after ([^.]+)\. Check out time is ([^.]+)\./i);
  const kiteDays = kiteText.match(/average over (\d+) days of kiteable wind per month and ([\d-]+) days per month in the summer/i);
  const prices = units.map(u => u.fromDaily).filter((x): x is number => x !== null);

  // type -> units (site order of /accommodations/ is kept by first appearance in the unit list)
  const types = new Map<string, WrUnit[]>();
  for (const u of units) { const t = wrUnitType(u); types.set(t, [...(types.get(t) ?? []), u]); }
  const typeFacts = wrTypeFacts(p.accom);
  const rooms: ContentRoom[] = [...types.entries()].map(([type, us]) => {
    const from = us.map(u => u.fromDaily).filter((x): x is number => x !== null);
    const first = us[0];
    const floors = [...new Set(us.map(u => u.floor).filter((x): x is string => !!x))];
    return {
      name: type,
      description: first.description ? first.description.slice(0, 500) : null,
      features: [
        `Units: ${us.map(u => u.name).join(', ')}`,
        first.bedrooms !== null ? `${first.bedrooms} bedrooms` : null,
        first.bathrooms !== null ? `${first.bathrooms} bathroom${first.bathrooms === 1 ? '' : 's'} (plus half bath where listed)` : null,
        first.maxGuests !== null ? `Up to ${first.maxGuests} guests` : null,
        first.view,
        floors.length ? `${floors.join(' / ')}` : null,
        typeFacts.get(wrNorm(type)) ?? null,
        from.length ? `From USD ${Math.min(...from)} per night${tax ? ` (plus ${tax}% tax)` : ''}` : null,
      ].filter((x): x is string => !!x),
    };
  });

  const imageUrls: string[] = [];
  for (const u of [...wrImages(p.home, WR_HOME_URL), ...wrImages(p.kite, WR_KITE_URL), ...wrImages(p.accom, WR_ACCOM_URL),
    ...units.map(x => x.image).filter((x): x is string => !!x && /\.(jpe?g|webp)$/i.test(x)), ...wrImages(p.about, WR_ABOUT_URL)]) {
    if (!imageUrls.includes(u)) imageUrls.push(u);
  }

  const summary = [
    `Watermen's Retreat is a waterfront resort in Waves on Hatteras Island, North Carolina, at "The Slick" flat-water spot on Pamlico Sound${counts ? `, with ${counts[1]} suites, ${counts[2]} cottage and ${counts[3]} cabanas` : ''}, all with fully equipped kitchens.`,
    `It sits directly beside REAL Watersports (kite school, lesson center and rental shop); guests use the private kite launch with air compressors, gear lockers and hot showers, and every unit has secure gear storage.`,
    `Stays are three nights or more${prices.length ? `; rates start at USD ${Math.min(...prices)} to ${Math.max(...prices)} per unit per night by type and season` : ''}${tax ? `, plus ${tax}% tax` : ''}.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: "Watermen's Retreat",
    summary,
    continent: 'North America',
    country: 'United States',
    region: 'Hatteras Island, North Carolina',
    spot: 'Waves',
    // median of the unit pins in the site's own Streamline data
    ...(coords ? { spotCoords: coords } : {}),
    itinerarySpots: [],
    durationDays: null,
    // REAL: "beginner instruction, jumping, foiling, or waveriding"
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: /REAL Lesson Center|Learn To Kiteboard/i.test(kiteText) ? true : null,
    equipmentRental: /rent gear|Rental Shop/i.test(`${kiteText} ${aboutText}`) ? true : null,
    beginnerFriendly: /beginner instruction/i.test(kiteText) ? true : null,
    includedServices: [
      'Private kite launch at REAL Watersports (Bermuda grass, air compressors, lockers, hot showers)',
      'Secure gear storage',
      'Fully equipped kitchen, in-room washer/dryer',
      'Made beds and bath towels',
      'High-speed Wi-Fi, cable TV, parking',
    ],
    optionalServices: [
      'Kite, wing, foil and surf lessons at REAL Watersports (next door)',
      ...(/10% off gear rentals/i.test(aboutText) ? ['Gear rental at the REAL Rental Shop (10% off for guests)'] : ['Gear rental at the REAL Rental Shop']),
      'Concierge: daily adventure prescriptions, food and beverage provisioning',
      ...(/Dogs \(max 2\)/i.test(aboutText) ? ['Dogs in the cottage and cabanas (pet fee)'] : []),
    ],
    accommodation: 'waterfront suites, penthouses, cabanas and a cottage with kitchens',
    mealPlan: 'self_catering',
    languages: ['en'],
    rooms,
    imageUrls: imageUrls.slice(0, 40),
    heroVideoUrl: null,
    sourceUrl: WR_HOME_URL,
    bookingUrl: WR_ACCOM_URL,
    sourceText: [
      `home: ${homeText}`,
      `kiteboarding: ${kiteText}`,
      `about: ${aboutText}`,
      `accommodations: ${accom.join(' | ')}`,
      `rate includes: ${included ?? '-'}; tax ${tax ?? '-'}%; check-in ${checkIn?.[1] ?? '-'}, check-out ${checkIn?.[2] ?? '-'}; kiteable days ${kiteDays ? `${kiteDays[1]}/month, summer ${kiteDays[2]}` : '-'}`,
      `units: ${units.map(u => `${u.id} ${u.name} [${wrUnitType(u)}] ${u.bedrooms}br ${u.maxGuests}p ${u.view ?? ''} ${u.floor ?? ''} from ${u.fromDaily} ${u.currency}`).join(' | ')}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export async function fetchWrSlots(ctx: FetchContext, today: string): Promise<Slot[]> {
  const units = parseWrUnits(await once(WR_LIST_URL, post));
  if (units.length < 10) throw new Error(`watermens-retreat: Streamline unit list too short (${units.length} units)`);
  const samples: Array<{ month: string; checkIn: string; checkOut: string; quotes: WrQuote[] }> = [];
  for (const s of wrSampleStays(today)) {
    try { samples.push({ ...s, quotes: parseWrSearch(await post(wrSearchUrl(s.checkIn, s.checkOut))) }); }
    catch (e) { ctx.incomplete(`date search ${s.checkIn}..${s.checkOut}: ${(e as Error).message}`); }
  }
  const slots = buildWrSlots(units, samples);
  if (!slots.some(x => x.price !== null)) ctx.note('no free unit in any sample week');
  return slots;
}

export const watermensRetreatWaves: OfferAdapter = {
  key: 'watermens-retreat-waves',
  name: "Watermen's Retreat, Waves (Hatteras Island)",
  kind: 'accommodation',
  operator: {
    name: "Watermen's Retreat",
    websiteUrl: SITE,
    rootDomain: 'watermensretreat.com',
    phone: '+12529876060',
  },
  url: WR_HOME_URL,
  slotMethod: 'booking_engine',
  instantBooking: true,
  liveAvailability: true,
  fetchBudget: 18,
  async fetchContent() {
    const home = await fetchText(WR_HOME_URL, { accept: 'text/html' });
    const kite = await fetchText(WR_KITE_URL, { accept: 'text/html' });
    const about = await fetchText(WR_ABOUT_URL, { accept: 'text/html' });
    const accom = await fetchText(WR_ACCOM_URL, { accept: 'text/html' });
    const list = await once(WR_LIST_URL, post);
    return parseWatermensContent({ home, kite, about, accom, list });
  },
  fetchSlots: ctx => fetchWrSlots(ctx, todayIso()),
};
