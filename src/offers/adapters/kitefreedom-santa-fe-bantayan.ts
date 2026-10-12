// ---------------------------------------------------------------------------
// KiteFreedom Kiteboard Center, Santa Fe (Bantayan Island, Cebu, Philippines) - IKO/BKSA kite school based at its
// partner resort Amihan Beach Cabanas; its "kitesurfing package" sells a beachfront cabana stay (4 nights) together
// with a 3-day one-on-one Zero to Hero course.
//
// Re-check 2026-10-12 (Google Maps pin "KITEFREEDOM KITEBOARD CENTER (SANTA FE)", 5.0/22): the earlier rejection
//   "domain does not resolve" no longer holds - www.kitefreedomsantafe.com answers 200 (Wix).
// Kite link (own site): the school operates on the resort's beach; /learn-kitesurfing/kitesurfing-package "on the spot
//   beachfront accommodation at our partner resort Amihan Beach Cabanas, kitesurfing lessons + courses, kite equipment
//   rental service plus beach assistance".
// Liveness (2026-10-12): every page footer reads "Copyright 2026" (a hand-typed Wix text element); the header image is
//   an upload named "IMG-20260721-WA0000_edited.png" (July 2026); Wix site revision 4120; text "Enjoy learning to
//   Kitesurf in paradise this opening season". Verdict LIVE. Amihan Beach Cabanas' own site (amihanbeachcabanas.com)
//   sits behind a SiteGround captcha and is NOT read.
// Data path (checked 2026-10-12): Wix, server-rendered text:
//   content  / (school intro), /beach-accommodation (cabanas + casita), /learn-kitesurfing/kitesurfing-package.
//   slots    /learn-kitesurfing/kitesurfing-package: "4 Nights = 24,400php / Up to 2 guests + 1 child / Beachfront
//            Cabana Accommodation" (the /learn-kitesurfing page prints the same package as "5 Days = 24,400php";
//            /beach-accommodation says "Up to 3 guests + 1 child"). No booking engine: "Check availability" is a
//            mailto link -> 'on_request'. Prices undated; used because the page carrying them was edited in 2026.
//   coordinates  Wix business location of the site (businessLocationCoordinates 11.1559681 / 123.8081698; the Google
//            Maps pin of the school sits about 20 m away).
// robots.txt (2026-10-12): Wix default (only "*?lightbox=" disallowed).
// Requests per run: content 3, slots 1. Pages are 0.65-0.9 MB; fixtures are trimmed to markup + the coordinates.
// Parsed: 1 slot = the 4-night cabana stay of the package, PHP per cabana (package price, packageNights 4).
// Known limits: no dates, no inventory; the 3-day course (PHP 27,000) is listed as a service, not summed into a total;
//   no separate per-night rates for the cabanas or the casita with private pool.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, parseAmount } from '../parse.js';
import type { ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.kitefreedomsantafe.com';
export const KF_HOME_URL = SITE;
export const KF_ACCOMMODATION_URL = `${SITE}/beach-accommodation`;
export const KF_PACKAGE_URL = `${SITE}/learn-kitesurfing/kitesurfing-package`;
export const KF_CABANA_UNIT = 'Beachfront cabana (kitesurfing package)';

// --- local helpers ----------------------------------------------------------------------------
/** Visible text lines of a Wix page (scripts, styles and inline SVG dropped; zero-width spaces removed). */
export function kfLines(html: string): string[] {
  const body = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<svg[\s\S]*?<\/svg>/gi, '');
  return body.split(/<[^>]+>/).map(s => clean(s).replace(/​/g, '').trim()).filter(Boolean);
}

/** Original-size Wix photos (jpg/webp) shown in the page markup, in document order; logos/icons (png) skipped. */
export function kfImages(html: string): string[] {
  const body = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  const out: string[] = [];
  for (const m of body.matchAll(/<img\b[^>]*>/gi)) {
    const id = m[0].match(/static\.wixstatic\.com\/media\/([0-9a-f]{6}_[0-9a-f]{32}~mv2(?:_d_\d+_\d+_s_\d+)?\.(?:jpe?g|webp))/i)?.[1];
    if (!id) continue;
    const u = `https://static.wixstatic.com/media/${id}`;
    if (!out.includes(u)) out.push(u);
  }
  return out;
}

/** Wix business location of the site (set by the owner; the site's map widget uses it). */
export function kfCoords(html: string): { lat: number; lng: number } | null {
  const m = html.match(/"businessLocationCoordinates":\{"latitude":(-?\d+\.\d+),"longitude":(-?\d+\.\d+)\}/);
  return m ? { lat: Math.round(Number(m[1]) * 1e6) / 1e6, lng: Math.round(Number(m[2]) * 1e6) / 1e6 } : null;
}

/** Year of the hand-typed "Copyright 2026" footer (the site's freshness signal for its undated prices). */
export function kfFooterYear(html: string): number | null {
  const y = kfLines(html).map(l => l.match(/^Copyright (20\d{2})$/)).find(Boolean);
  return y ? Number(y[1]) : null;
}

// --- pure parsers -----------------------------------------------------------------------------
export interface KfPackage {
  courseDays: number | null;
  coursePrice: number | null;
  nights: number | null;
  stayPrice: number | null;
  guests: number | null;
  children: number | null;
  /** the package lines as printed */
  text: string[];
}

/** "THE KITESURFING PACKAGE INCLUDES:" block: "3 Day = 27.000php" (course) and "4 Nights = 24,400php" (cabana). */
export function parseKfPackage(html: string): KfPackage {
  const lines = kfLines(html);
  const i = lines.findIndex(l => /^THE KITESURFING PACKAGE INCLUDES/i.test(l));
  const block = i >= 0 ? lines.slice(i + 1, i + 12) : [];
  const end = block.findIndex(l => /^(CHECK (AVAILABILITY|NOW)|CONTACT US|BOOK NOW)$/i.test(l));
  const text = end >= 0 ? block.slice(0, end) : block;
  const course = text.map(l => l.match(/^(\d+)\s*Days?\s*=\s*([\d.,]+)\s*php/i)).find(m => m && !/night/i.test(m[0]));
  const stay = text.map(l => l.match(/^(\d+)\s*Nights?\s*=\s*([\d.,]+)\s*php/i)).find(Boolean);
  const guests = text.map(l => l.match(/Up to (\d+) guests?(?:\s*\+\s*(\d+) child)?/i)).find(Boolean);
  return {
    courseDays: course ? Number(course[1]) : null,
    coursePrice: course ? parseAmount(course[2]) : null,
    nights: stay ? Number(stay[1]) : null,
    stayPrice: stay ? parseAmount(stay[2]) : null,
    guests: guests ? Number(guests[1]) : null,
    children: guests?.[2] ? Number(guests[2]) : null,
    text,
  };
}

/** One slot: the cabana stay of the package (package price for `nights` nights, per cabana, on request). */
export function buildKfSlots(p: KfPackage): Slot[] {
  if (p.stayPrice === null || p.nights === null) return [];
  return [{
    key: `cabana-package-${p.nights}n`,
    startDate: null,
    endDate: null,
    unit: KF_CABANA_UNIT,
    price: p.stayPrice,
    currency: 'PHP',
    priceUnit: 'package',
    priceBasis: 'room',
    occupancy: p.guests,
    availability: 'on_request',
    availabilityText: 'Check availability (e-mail)',
    spotsLeft: null,
    packageNights: p.nights,
  }];
}

export interface KfAccommodation { name: string; description: string; features: string[] }

/** Unit blocks on /beach-accommodation: heading ("CASITA WITH PRIVATE POOL", "CABANAS WITH SEA VIEW") up to "BOOK NOW". */
export function parseKfAccommodation(html: string): KfAccommodation[] {
  const lines = kfLines(html);
  const out: KfAccommodation[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^(CASITA|CABANAS?)\b.*$/.test(lines[i]) || lines[i] !== lines[i].toUpperCase()) continue;
    const stop = lines.findIndex((l, j) => j > i && /^BOOK NOW$/i.test(l));
    if (stop < 0) continue;
    const body = lines.slice(i + 1, stop).filter(l => !/^Amihan Beach Cabanas$/i.test(l) && !/^Welcome to paradise/i.test(l));
    // short capitalised lines without a full stop are the amenity labels ("Private Swimming Pool", "Beach Bar")
    const isFeature = (l: string) => l.length < 40 && !/[.,]$/.test(l) && /^[A-Z][a-z]+ [A-Z]/.test(l);
    const features = body.filter(isFeature);
    const text = body.filter(l => !isFeature(l)).join(' ').replace(/\s+([,.])/g, '$1').replace(/,(?=[A-Za-z])/g, ', ').replace(/\.\.+/g, '.').replace(/\s+/g, ' ').trim();
    const name = lines[i].charAt(0) + lines[i].slice(1).toLowerCase();
    out.push({ name, description: text, features });
    i = stop;
  }
  return out;
}

export interface KfPages { home: string; accommodation: string; pkg: string }

export function parseKiteFreedomContent(p: KfPages): OfferContent {
  const pkg = parseKfPackage(p.pkg);
  const units = parseKfAccommodation(p.accommodation);
  const acc = kfLines(p.accommodation);
  const pkgLines = kfLines(p.pkg);
  const home = kfLines(p.home);
  const season = [...pkgLines, ...acc].find(l => /windy season (?:normally )?run/i.test(l)) ?? null;
  const wind = season?.match(/(\d+)\s*-\s*(\d+)\s*knot/i) ?? null;
  const cabanaText = acc.find(l => /^The cabanas are furnished with/i.test(l)) ?? null;
  const certs = /BKSA & IKO|IKO & BKSA/.test([...pkgLines, ...home].join(' ')) ? 'IKO and BKSA' : null;

  const rooms: ContentRoom[] = units.map(u => ({
    name: /^Cabana/i.test(u.name) ? 'Beachfront cabana with sea view' : u.name,
    description: u.description,
    features: u.features,
  }));
  if (pkg.stayPrice !== null && rooms.length) {
    const cab = rooms.find(r => /cabana/i.test(r.name));
    cab?.features.push(`Kitesurfing package: ${pkg.nights} nights PHP ${pkg.stayPrice.toLocaleString('en-US')} (up to ${pkg.guests ?? '?'} guests${pkg.children ? ` + ${pkg.children} child` : ''})`);
  }

  const imageUrls: string[] = [];
  for (const u of [...kfImages(p.accommodation), ...kfImages(p.pkg), ...kfImages(p.home)]) if (!imageUrls.includes(u)) imageUrls.push(u);

  const summary = [
    'KiteFreedom Kiteboard Center is a kite school on the beach of Amihan Beach Cabanas, a small private beach resort in the centre of Santa Fe on Bantayan Island, Cebu, Philippines.',
    `Its kitesurfing package combines ${pkg.nights ?? 4} nights in a beachfront bamboo cabana (queen bed, air conditioning, private bathroom, 32 m2 with terrace, communal pool) with a ${pkg.courseDays ?? 3}-day one-on-one Zero to Hero course${certs ? ` taught to ${certs} standards` : ''}; the resort also has a two-level casita with a private pool.`,
    // rental brands and rider levels from /learn-kitesurfing (read 2026-10-12; not fetched per run)
    `The school rents Core kites and Hyde equipment to intermediate and advanced riders and helps with launching; the Amihan wind season runs from end of October to April${wind ? ` with ${wind[1]}-${wind[2]} knots from the north-east` : ''}.`,
    'Bookings and availability go by e-mail.',
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'KiteFreedom Kiteboard Center & Amihan Beach Cabanas',
    summary,
    continent: 'Asia',
    country: 'Philippines',
    region: 'Central Visayas (Cebu)',
    spot: 'Santa Fe, Bantayan Island',
    spotCoords: kfCoords(p.pkg) ?? kfCoords(p.accommodation) ?? kfCoords(p.home),
    itinerarySpots: [],
    durationDays: null,
    // /learn-kitesurfing: 2 h lesson for complete beginners ... rental for intermediate + advanced riders only
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: true,
    equipmentRental: true,
    beginnerFriendly: true,
    includedServices: ['Beach assistance to set up and launch the kite', 'Communal swimming pool', 'Beach bar and restaurant'],
    optionalServices: [
      ...(pkg.coursePrice ? [`${pkg.courseDays}-day Zero to Hero course, one-on-one (PHP ${pkg.coursePrice.toLocaleString('en-US')}, part of the kitesurfing package)`] : []),
      'Kite lessons and courses (2-hour lesson, group course, refresher, 1-day and 2-day courses)',
      'Kite equipment rental (Core kites, Hyde, Mystic harness) for intermediate and advanced riders',
      'Kite downwind safari', 'Island hopping', 'ATV rental and tours', 'Sky dive',
    ],
    accommodation: 'beachfront bamboo cabanas and a casita with private pool at the partner resort',
    mealPlan: null,
    languages: ['en'],
    rooms,
    imageUrls: imageUrls.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: KF_PACKAGE_URL,
    bookingUrl: KF_PACKAGE_URL,
    sourceText: [
      `package: ${pkg.text.join(' | ')}`,
      `season: ${season ?? ''}`,
      `accommodation: ${cabanaText ?? ''} ${units.map(u => `${u.name}: ${u.description}`).join(' || ')}`,
      `school: ${home.find(l => /^Our certified team of instructors/i.test(l)) ?? ''}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const kitefreedomSantaFeBantayan: OfferAdapter = {
  key: 'kitefreedom-santa-fe-bantayan',
  name: 'KiteFreedom Kiteboard Center & Amihan Beach Cabanas (Bantayan)',
  kind: 'accommodation',
  operator: {
    name: 'KiteFreedom Kiteboard Center (Santa Fe)',
    websiteUrl: SITE,
    rootDomain: 'kitefreedomsantafe.com',
    contactEmail: 'kitefreedomsantafe@gmail.com', // page footers, 2026-10-12
    phone: '+639279972818',
  },
  url: KF_PACKAGE_URL,
  slotMethod: 'price_table',
  fetchBudget: 4,
  confidence: 'medium', // undated package price, no inventory
  async fetchContent() {
    const home = await fetchText(KF_HOME_URL, { accept: 'text/html' });
    const accommodation = await fetchText(KF_ACCOMMODATION_URL, { accept: 'text/html' });
    const pkg = await fetchText(KF_PACKAGE_URL, { accept: 'text/html' });
    return parseKiteFreedomContent({ home, accommodation, pkg });
  },
  async fetchSlots(ctx: FetchContext): Promise<Slot[]> {
    const html = await fetchText(KF_PACKAGE_URL, { accept: 'text/html' });
    const pkg = parseKfPackage(html);
    if (pkg.stayPrice === null) throw new Error('kitefreedom: package block "N Nights = ...php" not found (layout changed?)');
    // the prices are undated; they count as current only while the page is maintained (footer year)
    const year = kfFooterYear(html);
    if (year === null || year < new Date().getUTCFullYear() - 1) ctx.note(`footer year ${year ?? 'missing'}: undated package price may be stale`);
    return buildKfSlots(pkg);
  },
};
