// ---------------------------------------------------------------------------
// Cabarete Kite Point - "7-Day All-Inclusive Kitesurfing Package" (Kite Beach, Cabarete, Dominican Republic):
// the kite school (formerly Dare2Fly, since 1999, Ozone gear) and its El Cocotazo Cafe at Agualina Kite Resort in the
// middle of Kite Beach sell one package: 9 hours of private beginner lessons, 7 nights in a private standard
// beachfront room (ocean view, Wi-Fi, cleaning), 6 meals at the cafe (one per day on six days) and full gear rental.
// No dates (book any week), "Booking via WhatsApp only". KIND = 'camp'.
//
// Data path (checked 2026-10-21): WordPress + Elementor.
//   content+price  /all-inclusive-deals/: "KITE. EAT. SLEEP. REPEAT. 7-Day All-Inclusive / Kitesurfing Lessons + Food
//            + Hotel / STARTING AT JUST $1375 USD", "9 HOURS OF PRIVATE BEGINNER LESSONS", "6 DELICIOUS MEALS",
//            "7 NIGHTS OF PRIVATE ACCOMMODATION", "WHAT'S NOT INCLUDED: Airfare, Airport Transportation". The
//            Yoast description repeats "starting at $1375". dateModified 2026-08-11.
//   images   the package page's own uploads (two large Kite Beach photos + three small 360x203 tiles) and two photos
//            of /kiteboarding-school-in-cabarete/ (drone shot of the school + resort, a lesson on Kite Beach). The
//            Instagram feed embedded on the page (cdninstagram.com) is never used.
// Price basis: 'person' is INFERRED - the package is one guest's private room, lessons and meals; the page says
//   "starting at" and never "per person". Currency: "USD" printed on the page.
// durationDays: 7 nights -> 8 (the site sells it as "7-Day").
// No coordinates on the site (only a Google Maps embed by name) -> spot "Kite Beach, Cabarete" for the geocoder.
// Booking: "BOOK NOW" = wa.me WhatsApp link, "Booking via WhatsApp only" -> 'on_request', instantBooking false.
// robots.txt (2026-10-21): only /wp-admin/ disallowed.
// Requests per run: content 2 (package + school page), slots 1 (memoised: 2 for a full run).
// Flags: liveAvailability no (static page), instantBooking false (WhatsApp).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, parse, parseAmount } from '../parse.js';
import type { OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://cabaretekitepoint.com';
export const CKP_URL = `${SITE}/all-inclusive-deals/`;
export const CKP_SCHOOL_URL = `${SITE}/kiteboarding-school-in-cabarete/`;
const WHATSAPP = '+18292523417';

const memo = new Map<string, { at: number; p: Promise<string> }>();
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url);
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

/** Visible text of an Elementor page in one line (scripts, styles, the Instagram feed dropped). */
export function ckpText(html: string): string {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, template, #sb_instagram, .sbi')) el.remove();
  return collapse(root.querySelector('main, #content, body')?.text ?? root.text);
}

export interface CkpPackage {
  price: number; currency: string; nights: number | null; lessonHours: number | null; meals: number | null;
  days: number | null; whatsappOnly: boolean;
}

export function parseCkpPackage(html: string): CkpPackage | null {
  const t = ckpText(html);
  const m = t.match(/STARTING AT (?:JUST )?\$\s?([\d,]+)\s*(USD)?/i);
  if (!m) return null;
  const n = (re: RegExp) => { const x = t.match(re)?.[1]; return x ? Number(x) : null; };
  return {
    price: parseAmount(m[1])!,
    currency: 'USD', // "$1375 USD" on the page
    nights: n(/(\d+)\s+NIGHTS OF\b/i) ?? n(/(\d+) nights of beachfront/i),
    lessonHours: n(/(\d+)\s+HOURS OF\s+PRIVATE/i) ?? n(/(\d+) hours of private lessons/i),
    meals: n(/(\d+)\s+(?:DELICIOUS|fresh)\s+MEALS/i),
    days: n(/(\d+)-Day All-Inclusive/i),
    whatsappOnly: /Booking via WhatsApp only/i.test(t),
  };
}

export function buildCkpSlots(p: CkpPackage): Slot[] {
  return [{
    key: 'all-inclusive',
    startDate: null,
    endDate: null,
    unit: `${p.days ?? 7}-Day All-Inclusive (private standard beachfront room)`,
    price: p.price,
    currency: p.currency,
    priceUnit: 'package',
    priceBasis: 'person', // inferred: one guest's room, private lessons and meals; the page says "starting at"
    occupancy: 1,
    availability: 'on_request',
    availabilityText: p.whatsappOnly ? 'Booking via WhatsApp only' : null,
    spotsLeft: null,
    packageNights: p.nights,
  }];
}

const JUNK_IMG = /logo|favicon|icon|banner|background|bkg|marble|bokeh|-\d+x\d+\.(?:jpe?g|png|webp)$/i;
/** Own uploads of the package page + the school page's drone and lesson photos (no Instagram feed). */
export function ckpImages(pkgHtml: string, schoolHtml: string | null): string[] {
  const uploads = (html: string) => [...html.matchAll(/(?:https?:)?\/\/cabaretekitepoint\.com\/+wp-content\/uploads\/[^"'\s)]+?\.(?:jpe?g|png|webp)/gi)]
    .map(m => m[0].replace(/^(?:https?:)?\/\/cabaretekitepoint\.com\/+/, `${SITE}/`));
  const out: string[] = [];
  const add = (u: string) => { if (!JUNK_IMG.test(u) && !out.includes(u)) out.push(u); };
  const pkg = uploads(pkgHtml);
  // large Kite Beach photos first, then the small tiles
  for (const u of pkg) if (/kiteboarding-lessons-cabarete|DJI_/i.test(u)) add(u);
  if (schoolHtml) for (const u of uploads(schoolHtml)) if (/drone|kiteboarding-lessons-kite-beach\.jpg/i.test(u)) add(u);
  for (const u of pkg) add(u);
  return out;
}

export function parseCkpContent(pkgHtml: string, schoolHtml: string | null): OfferContent {
  const p = parseCkpPackage(pkgHtml);
  if (!p) throw new Error('cabarete-kite-point: "STARTING AT JUST $... USD" not found');
  const t = ckpText(pkgHtml);
  const nights = p.nights ?? 7;
  const summary = [
    `Cabarete Kite Point (formerly Dare2Fly, founded 1999) sells a ${p.days ?? 7}-day all-inclusive kitesurf package at its school in the middle of Kite Beach, Cabarete, on the north coast of the Dominican Republic.`,
    `It includes ${p.lessonHours ?? 9} hours of private beginner lessons with Ozone gear, ${nights} nights in a private standard beachfront room with ocean view, ${p.meals ?? 6} meals at the school's El Cocotazo Cafe (one per day) and full equipment rental.`,
    `The package starts at USD ${p.price.toLocaleString('en-US')}, suits beginners and intermediates and is booked via WhatsApp only; flights and airport transfers are not included.`,
  ].join(' ');
  return {
    kind: 'camp',
    title: 'Cabarete Kite Point 7-Day All-Inclusive Kitesurfing Package',
    summary,
    continent: 'North America',
    country: 'Dominican Republic',
    region: 'Puerto Plata',            // as cabarete-boutique-kite-hotel.ts / kite-beach-inn-cabarete.ts
    spot: 'Kite Beach, Cabarete',
    spotCoords: { lat: 19.76256, lng: -70.42241 }, // same beach pin as kite-beach-inn-cabarete (the geocoder finds no 'Kite Beach, Cabarete'), set by the lead 2026-10-21
    itinerarySpots: [],
    durationDays: nights + 1,
    skillLevels: /beginners or intermediates/i.test(t) ? ['beginner', 'intermediate'] : ['beginner'],
    kiteLessons: true,
    equipmentRental: /full gear rental/i.test(t) || null,
    beginnerFriendly: true,
    includedServices: [
      `${p.lessonHours ?? 9} hours of private beginner kite lessons (certified instructors, Ozone kites)`,
      `${nights} nights in a private standard beachfront room (ocean view, Wi-Fi, cleaning)`,
      `${p.meals ?? 6} meals at El Cocotazo Cafe (one meal per day on ${p.meals ?? 6} days)`,
      'Full kite gear rental',
    ],
    optionalServices: /Airport Transportation/i.test(t) ? ['Airport taxi (quote via WhatsApp, not included)'] : [],
    accommodation: 'Private standard beachfront room at the school (Agualina Kite Resort, Kite Beach)',
    mealPlan: `one meal a day on ${p.meals ?? 6} days`,
    languages: ['en', 'es'],
    rooms: [],
    imageUrls: ckpImages(pkgHtml, schoolHtml),
    heroVideoUrl: null,
    sourceUrl: CKP_URL,
    bookingUrl: `https://wa.me/${WHATSAPP.slice(1)}`,
    sourceText: t,
  };
}

export const cabareteKitePoint7DayAllInclusive: OfferAdapter = {
  key: 'cabarete-kite-point-7-day-all-inclusive',
  name: 'Cabarete Kite Point - 7-Day All-Inclusive Kitesurfing Package, Kite Beach',
  kind: 'camp',
  operator: {
    name: 'Cabarete Kite Point',
    websiteUrl: `${SITE}/`,
    rootDomain: 'cabaretekitepoint.com',
    whatsapp: WHATSAPP,
    phone: WHATSAPP,
  },
  url: CKP_URL,
  slotMethod: 'price_table',
  instantBooking: false,
  fetchBudget: 3,
  async fetchContent(ctx) {
    const pkg = await page(CKP_URL);
    let school: string | null = null;
    try { school = await page(CKP_SCHOOL_URL); } catch (e) { ctx.note(`school page (images only) failed: ${(e as Error).message}`); }
    return parseCkpContent(pkg, school);
  },
  async fetchSlots() {
    const p = parseCkpPackage(await page(CKP_URL));
    if (!p) throw new Error('cabarete-kite-point: "STARTING AT JUST $... USD" not found');
    return buildCkpSlots(p);
  },
};
