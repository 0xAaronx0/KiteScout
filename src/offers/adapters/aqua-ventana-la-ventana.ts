// ---------------------------------------------------------------------------
// Aqua Ventana, La Ventana (Baja California Sur, Mexico) - beachfront "adventure resort and spa" with 17 units
// (casitas and suites), restaurant (Coyas), beach bar, pool, jacuzzi and its own water sports center: kite, wing
// and windsurf lessons with two on-site IKO instructors, Duotone / Fanatic rental gear, launch on the beach in
// front of the resort, air hose on the beach and gear storage in the beachfront bodega.
//
// Data path (checked 2026-10-14): the site is a ThinkReservations-hosted website (Next.js). Every page has a
//   Markdown twin (`<page>.md`), announced in the site's own /llms.txt ("Checking Availability"): the room list
//   `/accommodations.md` returns every unit with its price when `startDate`, `endDate`, `numberOfAdults`,
//   `numberOfChildren`, `numberOfPets` are appended (an anonymous GET, no session, token or cookie).
//   content  / (HTML: JSON-LD Hotel with geo 24.0481319,-109.9886093 and the og:image), /accommodations.md (units,
//            "Price: Starts at $X / night", photos), /kiteboarding.md (water sports center, rental and lesson
//            prices), /about.md (location, FAQ), /policies.md ("All rates are listed in USD, and VAT and hotel tax
//            of 20% are not included", deposit and cancellation).
//   slots    /accommodations.md?startDate=..&endDate=..&numberOfAdults=2&numberOfChildren=0&numberOfPets=0: one
//            7-night sample stay per month (arrival on the first Saturday on or after the 12th; current month: after
//            tomorrow), 7 months ahead (the wind season runs mid-October to mid-April). Per unit the answer prints
//            "Price: $320 / night" (bookable for the sample stay; the per-room page shows the pre-tax nightly rate,
//            "Total" adds the 20% tax) or "Unavailable for selected dates. Next availability for 7 nights: Jan 19".
// robots.txt (2026-10-14): disallows /reservations/, /gift-certificates/, /account/, /thinkweb-preview only; the
//   .md pages are allowed. Currency: the site prints "$"; the policies page states USD.
// Requests per run: content 5, slots 7 + the room list (memoised; a full run makes 12). A unit booked in every sample
//   month keeps the room list's "Starts at $X / night" as an undated floor (2026-10-31).
// Parsed: slot = unit x month ("cardon|2027-01"), USD per unit per night before tax, occupancy 2,
//   datePrecision 'month' (the band is the month, the price is the sample stay's), 'available' with the price or
//   'sold_out' with the engine's own words. Taxes (20% VAT + hotel tax) are in the room features and the
//   availability text, not in the price.
// Known limits: one sample week per month, 2 adults; a unit that is booked for the sample week may still have free
//   nights in the same month. Off-season discount ("up to 50% Off", July 1 - October 31) is applied by the engine.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { printedFromSlots } from '../ingest.js';
import { collapse, imageCandidates, iso, ldOfType, todayIso } from '../parse.js';
import type { ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.aquaventana.com';
export const AQ_HOME_URL = `${SITE}/`;
export const AQ_ROOMS_MD = `${SITE}/accommodations.md`;
export const AQ_KITE_MD = `${SITE}/kiteboarding.md`;
export const AQ_ABOUT_MD = `${SITE}/about.md`;
export const AQ_POLICIES_MD = `${SITE}/policies.md`;
const ROOMS_URL = `${SITE}/accommodations`;
const MD = 'text/markdown,text/plain,*/*;q=0.8';

const memo = new Map<string, { at: number; p: Promise<string> }>();
/** one fetch per page per 10 minutes: fetchContent + fetchSlots in the same run share the room list */
function page(url: string, accept: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}
export const AQ_ADULTS = 2;
export const AQ_NIGHTS = 7;
export const AQ_HORIZON_MONTHS = 7;

// --- local helpers ---------------------------------------------------------------------------
const addDays = (d: string, n: number): string => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const lastDayOf = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate();
export const aqKey = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
/** Next.js image proxy (/_next/image?url=<original>&w=..) -> the original photo URL. */
export function unwrapNextImage(u: string): string {
  try {
    const x = new URL(u);
    if (x.pathname.endsWith('/_next/image') && x.searchParams.get('url')) return new URL(x.searchParams.get('url')!, x.origin).toString();
  } catch { /* keep */ }
  return u;
}
/** Markdown -> plain text (drops images, keeps link text, strips emphasis and escapes). */
export function mdText(md: string): string {
  return md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_]{1,3}/g, '')
    .replace(/\\([.*_\-#])/g, '$1')
    .replace(/^#+\s*/gm, '')
    .split('\n').map(l => l.trim()).filter(Boolean).join('\n');
}

// --- units -------------------------------------------------------------------------------------
export interface AqUnit {
  name: string;
  tagline: string;
  description: string;
  maxGuests: number | null;
  images: string[];
  /** "Price: Starts at $250 / night" (no dates) or "Price: $320 / night" (dated search) */
  price: number | null;
  fromPrice: boolean;
  /** "Unavailable for selected dates. Next availability for 7 nights: Jan 19" */
  unavailableText: string | null;
}

/** The unit blocks of accommodations.md ("### Name" ... "---"). */
export function parseAqUnits(md: string): AqUnit[] {
  const out: AqUnit[] = [];
  for (const block of md.split(/\n(?=### )/).slice(1)) {
    const lines = block.split('\n');
    const name = collapse(lines[0].replace(/^###\s*/, ''));
    const body = lines.slice(1).join('\n').split(/\n---\s*(\n|$)/)[0];
    const textLines = body.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('!['));
    const tagline = textLines[0] && !/^Price:|^Unavailable/i.test(textLines[0]) ? collapse(textLines[0]) : '';
    const description = collapse(mdText(textLines.slice(tagline ? 1 : 0).filter(l => !/^Price:|^Unavailable|^Availability|^Partial/i.test(l)).join(' ')));
    const images = [...body.matchAll(/!\[([^\]]*)\]\((https?:[^)\s]+)\)/g)].filter(m => !/map/i.test(m[1]) && !/Resort_Map/i.test(m[2])).map(m => m[2]);
    const priceLine = textLines.find(l => /^Price:/i.test(l)) ?? null;
    const p = priceLine?.match(/\$\s?([\d,]+(?:\.\d+)?)\s*\/\s*night/i);
    const unavailable = textLines.find(l => /^Unavailable/i.test(l)) ?? null;
    const maxGuests = Number(description.match(/Maximum occupancy:\s*(\d+)/i)?.[1]) || null;
    if (!name) continue;
    out.push({
      name, tagline, description, maxGuests, images,
      price: p ? Number(p[1].replace(/,/g, '')) : null,
      fromPrice: !!priceLine && /starts at/i.test(priceLine),
      unavailableText: unavailable ? collapse(unavailable.replace(/[*_]/g, '')) : null,
    });
  }
  return out;
}

// --- slots ---------------------------------------------------------------------------------------
export interface AqSample { month: string; checkIn: string; checkOut: string }

/** One sample stay per month: arrival on the first Saturday on/after the 12th (current month: after tomorrow). */
export function aqSamples(today: string, months = AQ_HORIZON_MONTHS, nights = AQ_NIGHTS): AqSample[] {
  const out: AqSample[] = [];
  let y = Number(today.slice(0, 4));
  let m = Number(today.slice(5, 7));
  const tomorrow = addDays(today, 1);
  for (let i = 0; i < months; i++) {
    let d = iso(y, m, 12) > tomorrow ? iso(y, m, 12) : addDays(tomorrow, 1);
    while (new Date(`${d}T00:00:00Z`).getUTCDay() !== 6) d = addDays(d, 1);
    if (d.slice(0, 7) === iso(y, m, 1).slice(0, 7)) out.push({ month: d.slice(0, 7), checkIn: d, checkOut: addDays(d, nights) });
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

export function aqSearchUrl(s: AqSample, adults = AQ_ADULTS): string {
  return `${AQ_ROOMS_MD}?startDate=${s.checkIn}&endDate=${s.checkOut}&numberOfAdults=${adults}&numberOfChildren=0&numberOfPets=0`;
}

export function buildAqSlots(results: Array<AqSample & { units: AqUnit[] }>): Slot[] {
  const out: Slot[] = [];
  for (const r of results) {
    const y = Number(r.month.slice(0, 4));
    const m = Number(r.month.slice(5, 7));
    const stay = `${AQ_NIGHTS}-night sample stay ${r.checkIn} to ${r.checkOut} for ${AQ_ADULTS} adults`;
    for (const u of r.units) {
      const bookable = u.price !== null && !u.fromPrice;
      if (!bookable && !u.unavailableText) continue; // neither a dated price nor the engine's "unavailable" words
      out.push({
        key: `${aqKey(u.name)}|${r.month}`,
        startDate: iso(y, m, 1),
        endDate: iso(y, m, lastDayOf(y, m)),
        unit: u.name,
        price: bookable ? u.price : null,
        currency: bookable ? 'USD' : null,
        priceUnit: bookable ? 'per_night' : null,
        priceBasis: 'room',
        occupancy: AQ_ADULTS,
        availability: bookable ? 'available' : 'sold_out',
        availabilityText: bookable
          ? `${stay}: $${u.price} / night (VAT and hotel tax of 20% not included)`
          : `${stay}: ${u.unavailableText}`,
        spotsLeft: null,
        datePrecision: 'month',
      });
    }
  }
  return out;
}

export async function fetchAqSlots(ctx: FetchContext, today: string): Promise<Slot[]> {
  const samples = aqSamples(today);
  const results: Array<AqSample & { units: AqUnit[] }> = [];
  let failed = 0;
  for (const s of samples) {
    try {
      const units = parseAqUnits(await fetchText(aqSearchUrl(s), { accept: 'text/markdown,text/plain,*/*;q=0.8' }));
      if (units.length === 0) throw new Error('no unit blocks in the answer');
      results.push({ ...s, units });
    } catch (e) {
      failed++;
      ctx.note(`aqua-ventana: sample ${s.checkIn} failed: ${(e as Error).message}`);
    }
  }
  if (failed) ctx.incomplete(`${failed} of ${samples.length} sample months failed`);
  const slots = buildAqSlots(results);
  if (slots.length === 0 && failed < samples.length) throw new Error('aqua-ventana: no priced or unavailable unit in any sample month (layout changed?)');
  // units booked in every sample month keep the room list's "Starts at $X / night" (memoised with the content)
  const printed = parseAqUnits(await page(AQ_ROOMS_MD, MD)).flatMap(u => u.price === null ? []
    : [{ room: u.name, price: u.price, currency: 'USD', priceUnit: 'per_night' as const, priceBasis: 'room' as const }]);
  return [...slots, ...printedFromSlots(slots, printed)];
}

// --- content -------------------------------------------------------------------------------------
export interface AqPages { home: string; rooms: string; kite: string; about: string; policies: string }

export function aqGeo(homeHtml: string): { lat: number; lng: number } | null {
  for (const o of ldOfType(homeHtml, 'Hotel')) {
    const g = o.geo as Record<string, unknown> | undefined;
    const lat = Number(g?.latitude);
    const lng = Number(g?.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0) return { lat, lng };
  }
  return null;
}

/** A price-list line of the kiteboarding page ("**KITESURF kit**" + "DAILY: $100 USD | ..."). */
function kiteLine(kite: string, label: RegExp): string | null {
  const lines = mdText(kite).split('\n');
  const i = lines.findIndex(l => label.test(l));
  return i >= 0 && lines[i + 1] ? `${lines[i]}: ${lines[i + 1]}` : null;
}

export function parseAquaContent(p: AqPages): OfferContent {
  const units = parseAqUnits(p.rooms);
  const kite = mdText(p.kite);
  const about = mdText(p.about);
  const policies = mdText(p.policies);
  const geo = aqGeo(p.home);
  const taxNote = policies.match(/All rates are listed in USD[^.]*\./i)?.[0] ?? null;
  const season = kite.match(/From (mid-\w+ to mid-\w+)/i)?.[1] ?? null;
  const prices = units.map(u => u.price).filter((n): n is number => n !== null);
  const min = prices.length ? Math.min(...prices) : null;
  const max = prices.length ? Math.max(...prices) : null;
  const iko = /two IKO instructors/i.test(kite);

  const rooms: ContentRoom[] = units.map(u => ({
    name: u.name,
    description: u.description || null,
    features: [
      ...u.tagline.split('·').map(s => collapse(s)).filter(Boolean),
      ...(u.maxGuests ? [`Up to ${u.maxGuests} guests`] : []),
      ...(u.price !== null ? [`From USD ${u.price} per night${taxNote ? ' (VAT and hotel tax of 20% not included)' : ''}`] : []),
    ],
  }));

  const seen = new Set<string>();
  const imageUrls: string[] = [];
  const homeImages = imageCandidates(p.home, AQ_HOME_URL, null, 30).map(unwrapNextImage);
  for (const u of [...homeImages, ...units.flatMap(x => x.images.slice(0, 3)), ...units.flatMap(x => x.images.slice(3))]) {
    if (/\.svg|logo|icon|favicon|Resort_Map/i.test(u)) continue;
    if (seen.has(u)) continue;
    seen.add(u); imageUrls.push(u);
  }

  const summary = [
    `Aqua Ventana is a beachfront resort on La Ventana Bay (Sea of Cortez, Baja California Sur) with ${units.length || 17} casitas and suites, a restaurant, a beach bar, a pool and a jacuzzi.`,
    `Its water sports center on the beach runs kite, wing foil and windsurf lessons${iko ? ' with two IKO kite instructors' : ''} and rents Duotone and Fanatic gear; kiters launch from the beach in front of the resort, with an air hose on the beach and gear storage in the beachfront bodega.`,
    `${season ? `The wind season runs from ${season}` : 'The wind season runs from autumn to spring'}${min !== null ? `; units are priced from USD ${min}${max !== min ? ` to ${max}` : ''} per night before 20% VAT and hotel tax` : ''}.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Aqua Ventana',
    summary,
    continent: 'North America',
    country: 'Mexico',
    region: 'La Ventana, Baja California Sur',
    spot: 'La Ventana',
    ...(geo ? { spotCoords: geo } : {}),
    spotCoordsPrecise: true,
    itinerarySpots: [],
    durationDays: null,
    // kiteboarding page: "consistent wind suited for beginners to experts"
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: /kite instruction|IKO instructors/i.test(kite),
    equipmentRental: /KITESURF kit/i.test(kite),
    beginnerFriendly: true,
    includedServices: [
      'Wi-Fi',
      'Maid service on request',
      'Use of kayaks, stand up paddle gear, cruiser bikes and snorkeling gear',
      'Beach launch in front of the resort with air hose',
      'Kite gear storage in the beachfront bodega',
    ],
    optionalServices: [
      kiteLine(p.kite, /^KITESURF kit/i) ? `Kite rental (${kiteLine(p.kite, /^KITESURF kit/i)})` : 'Kite gear rental (IKO card or proficiency check required)',
      ...(kite.match(/2 hr lesson \$200, \$270 With Jet Ski/i) ? ['Private kite lesson: USD 200 per 2 hours, USD 270 with jet ski'] : ['Private kite lessons']),
      'Wing foil and windsurf lessons and rental',
      ...(kite.match(/To Hot Springs:\s*\$20/i) ? ['Upwind shuttle for downwinders (USD 10 to the campground, USD 20 to the hot springs, 2 riders minimum)'] : []),
      'Restaurant and beach bar',
      'Spa treatments',
      'Mountain bike rental',
    ],
    accommodation: 'beachfront casitas and suites',
    mealPlan: null,
    languages: ['en', 'es'],
    rooms,
    imageUrls: imageUrls.slice(0, 40),
    heroVideoUrl: null,
    sourceUrl: ROOMS_URL,
    bookingUrl: ROOMS_URL,
    sourceText: [
      `about: ${about}`,
      `kiteboarding: ${kite}`,
      `policies: ${policies}`,
      `units: ${units.map(u => `${u.name} (${u.tagline}) ${u.price !== null ? `from $${u.price}/night` : ''} max ${u.maxGuests ?? '?'}`).join('; ')}`,
      geo ? `geo (JSON-LD): ${geo.lat},${geo.lng}` : '',
    ].filter(Boolean).join('\n'),
  };
}

export const aquaVentanaLaVentana: OfferAdapter = {
  key: 'aqua-ventana-la-ventana',
  name: 'Aqua Ventana La Ventana',
  kind: 'accommodation',
  disciplines: ['kitesurf', 'wingfoil'],
  operator: {
    name: 'Aqua Ventana',
    websiteUrl: SITE,
    rootDomain: 'aquaventana.com',
    contactEmail: 'ventanaaqua@gmail.com',
    whatsapp: '+52 612 229 3433',
    phone: '+52 612 114 0065',
  },
  url: ROOMS_URL,
  slotMethod: 'booking_engine',
  instantBooking: true,
  liveAvailability: true,
  fetchBudget: 13,
  async fetchContent() {
    const home = await page(AQ_HOME_URL, 'text/html');
    const rooms = await page(AQ_ROOMS_MD, MD);
    const kite = await page(AQ_KITE_MD, MD);
    const about = await page(AQ_ABOUT_MD, MD);
    const policies = await page(AQ_POLICIES_MD, MD);
    return parseAquaContent({ home, rooms, kite, about, policies });
  },
  async fetchSlots(ctx) {
    return fetchAqSlots(ctx, todayIso());
  },
};
