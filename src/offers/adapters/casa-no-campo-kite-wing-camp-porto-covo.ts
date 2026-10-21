// ---------------------------------------------------------------------------
// Casa no Campo / CNC Kite&Wing Center, near Porto Covo (Alentejo coast, Costa Vicentina Natural Park, Portugal) -
// "PACKAGE KITE&WING CAMP": a country guesthouse with its own kite and wing school that teaches on a flat-water lake
// spot near Porto Covo in the afternoon Nortada wind, with a school boat and radio helmets. The package: 7 nights in a
// dorm room, 7 breakfasts + 1 communal dinner, 5 days of kitesurf lessons (3 h a day), transfer from the Porto Covo bus
// station, helmets with radio, insurance, life vests and the teaching boat; wakeboard / wakefoil / wingfoil / surf on
// no-wind days. One place, stay + lessons -> KIND = 'camp'.
//
// Data path (checked 2026-10-21): WordPress/Elementor page https://casanocampo.com/kite-surfing/ (one request):
//   slots    the Elementor price table "PACKAGE KITE&WING CAMP" / "€ 890" + its feature list. No dates or season on the
//            page -> one undated slot: EUR 890, priceUnit 'package' (packageNights from "7 nights in a Dorm Room"),
//            priceBasis 'person' (INFERRED: a dorm bed + one learner's lessons; the page does not say "per person").
//            The package's "Book Now" opens the contact form (/en/contact/) -> availability 'on_request'.
//            A private room is "check availability with us" (no price) -> optional service, not a slot.
//   content  the same page: school facts, the 4-day course outline, single-lesson prices (optional services) and the
//            header slider photos (lazy `data-src`, 1920x1080: kite lessons on the lake and the guesthouse).
// Flags: instantBooking no (the package is booked through a contact form; the site's "Book Online" button opens a
//   FrontDeskMaster room engine for the guesthouse, not this package); liveAvailability no.
// robots.txt (2026-10-21): Yoast default, nothing disallowed.
// Requests per run: 1 (memoised for content + slots).
// Location: the page says "on the wild Alentejo in the Costa Vicentina Natural Park" and "our flat-water lake training
//   spot near Porto Covo"; no address or coordinates on this page -> spot 'Porto Covo' for the geocoder (the guesthouse
//   itself is outside the village, exact place not printed), region 'Porto Covo, Alentejo' (no other adapter here).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { parse, parseAmount } from '../parse.js';
import { wpLines } from './kite-republic-aitutaki-winter-escape.js';
import type { OfferAdapter, OfferContent, Slot } from '../types.js';

export const CNC_SITE = 'https://casanocampo.com';
export const CNC_URL = `${CNC_SITE}/kite-surfing/`;
const CONTACT_URL = `${CNC_SITE}/en/contact/`;

const memo = new Map<string, { at: number; p: Promise<string> }>();
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

export interface CncPrice { name: string; amount: number; currency: string; duration: string | null; features: string[] }

/** Elementor price tables: header title, "€ 890", then the feature list / duration until "Book Now". */
export function parseCncPrices(html: string): CncPrice[] {
  const out: CncPrice[] = [];
  for (const table of parse(html).querySelectorAll('.elementor-price-table')) {
    const name = table.querySelector('.elementor-price-table__heading')?.text.trim() ?? '';
    const cur = table.querySelector('.elementor-price-table__currency')?.text.trim() ?? '';
    const int = table.querySelector('.elementor-price-table__integer-part')?.text.trim() ?? '';
    const frac = table.querySelector('.elementor-price-table__fractional-part')?.text.trim() ?? '';
    const amount = parseAmount(frac ? `${int}.${frac}` : int);
    if (!name || !amount) continue;
    const features = table.querySelectorAll('.elementor-price-table__features-list li')
      .map(li => li.text.replace(/\s+/g, ' ').trim()).filter(Boolean);
    // single lessons list only their length ("2 Hours") as the feature
    const duration = table.querySelector('.elementor-price-table__period')?.text.trim()
      || (features.length === 1 && /^\d+\s*hours?$/i.test(features[0]) ? features[0] : null);
    out.push({ name: name.replace(/\s+/g, ' '), amount, currency: /€|EUR/i.test(cur) ? 'EUR' : cur || 'EUR', duration, features });
  }
  return out;
}

export function cncPackage(prices: CncPrice[]): CncPrice | null {
  return prices.find(p => /PACKAGE/i.test(p.name) && /CAMP/i.test(p.name)) ?? null;
}

export function buildCncSlots(prices: CncPrice[]): Slot[] {
  const p = cncPackage(prices);
  if (!p) return [];
  const nights = Number(p.features.join('\n').match(/(\d+)\s*nights?/i)?.[1] ?? NaN);
  const dorm = p.features.find(f => /dorm/i.test(f));
  return [{
    key: 'kite-wing-camp|dorm',
    startDate: null,
    endDate: null,
    unit: dorm ? 'Dorm room' : 'Package',
    price: p.amount,
    currency: p.currency,
    priceUnit: 'package',
    priceBasis: 'person',
    occupancy: null,
    availability: 'on_request',
    availabilityText: 'Undated package; dates and private room on request (contact form)',
    spotsLeft: null,
    packageNights: Number.isFinite(nights) ? nights : null,
  }];
}

/** Header slider photos (lazy-loaded `data-src`), logos and banners left out. */
export function cncImages(html: string): string[] {
  const out: string[] = [];
  for (const img of parse(html).querySelectorAll('img.swiper-slide-image, .elementor-image-carousel img, .elementor-gallery-item img')) {
    const u = img.getAttribute('data-src') ?? img.getAttribute('src') ?? '';
    if (!/^https:\/\/casanocampo\.com\/wp-content\/uploads\/.+\.(jpe?g|webp|png)$/i.test(u) || /logo|icon|rentals|banner/i.test(u)) continue;
    const orig = u.replace(/-\d{2,4}x\d{2,4}(\.[a-z]+)$/i, '$1');
    if (!out.includes(orig)) out.push(orig);
  }
  return out;
}

const fmtEur = (n: number) => `EUR ${n.toLocaleString('en-US')}`;

export function parseCncContent(html: string): OfferContent {
  const lines = wpLines(html);
  const prices = parseCncPrices(html);
  const pkg = cncPackage(prices);
  if (!pkg) throw new Error('casa-no-campo: no "PACKAGE KITE&WING CAMP" price table on the kite page (layout changed?)');
  const f = pkg.features.join('\n');
  const nights = Number(f.match(/(\d+)\s*nights?/i)?.[1] ?? 7);
  const days = f.match(/(\d+)\s*Days? of Kite ?Surf Lessons\s*\((\d+)\s*h\/day\)/i);
  const lessons = prices.filter(p => p !== pkg).map(p => `${p.name}: ${fmtEur(p.amount)}${p.duration ? ` (${p.duration.toLowerCase()})` : ''}`);
  const included = pkg.features
    .filter(x => !/^According to your evolution/i.test(x) && !/^Special Deal/i.test(x))
    .map(x => x.replace(/\s*\(for private room check availability with us\)/i, ''));

  const summary = [
    'Casa no Campo is a guesthouse with its own kite and wing school, the CNC Kite&Wing Center, in the Costa Vicentina Natural Park on the Alentejo coast of Portugal; lessons run on a flat-water lake spot near Porto Covo in the strong afternoon Nortada wind, with a school boat alongside and radio helmets.',
    `The Kite&Wing Camp package covers ${nights} nights in a dorm room, ${nights} breakfasts and one communal dinner, ${days ? `${days[1]} days of kitesurf lessons of ${days[2]} hours` : 'a week of kitesurf lessons'}, safety gear and insurance, the transfer from the Porto Covo bus station and wakeboard, wakefoil, wing or surf sessions on days without wind.`,
    `It costs ${fmtEur(pkg.amount)} (per person inferred, no dates published: dates and a private room on request).`,
  ].join(' ');

  return {
    kind: 'camp',
    title: 'Casa no Campo CNC Kite&Wing Camp, Porto Covo',
    summary,
    continent: 'Europe',
    country: 'Portugal',
    region: 'Porto Covo, Alentejo',
    spot: 'Porto Covo',
    itinerarySpots: [],
    durationDays: nights + 1,
    skillLevels: ['beginner', 'intermediate'],
    kiteLessons: true,
    equipmentRental: true,
    beginnerFriendly: true,
    includedServices: included,
    optionalServices: [
      'Private room instead of the dorm (availability on request)',
      'Lesson gear can be switched to rental gear as you progress',
      ...lessons,
    ],
    accommodation: 'Dorm room at the Casa no Campo guesthouse (private room on request)',
    mealPlan: 'breakfast',
    languages: ['pt', 'en'],
    rooms: [],
    imageUrls: cncImages(html).slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: CNC_URL,
    bookingUrl: CONTACT_URL,
    sourceText: [
      lines.slice(lines.findIndex(l => /^Harness the power/i.test(l)), lines.findIndex(l => /^Contacto$/i.test(l)) > 0 ? lines.findIndex(l => /^Contacto$/i.test(l)) : undefined).join('\n'),
      `price tables: ${prices.map(p => `${p.name} ${p.currency} ${p.amount}${p.duration ? ` / ${p.duration}` : ''} [${p.features.join('; ')}]`).join(' | ')}`,
    ].join('\n'),
  };
}

export const casaNoCampoKiteWingCampPortoCovo: OfferAdapter = {
  key: 'casa-no-campo-kite-wing-camp-porto-covo',
  name: 'Casa no Campo CNC Kite&Wing Camp, Porto Covo',
  kind: 'camp',
  operator: {
    name: 'Casa no Campo (CNC Kite&Wing Center)',
    websiteUrl: `${CNC_SITE}/en/`,
    rootDomain: 'casanocampo.com',
    whatsapp: '+351914757829',
    phone: '+351914757829',
  },
  url: CNC_URL,
  slotMethod: 'price_table',
  fetchBudget: 1,
  async fetchContent() {
    return parseCncContent(await page(CNC_URL));
  },
  async fetchSlots() {
    const prices = parseCncPrices(await page(CNC_URL));
    if (!cncPackage(prices)) throw new Error('casa-no-campo: no "PACKAGE KITE&WING CAMP" price table on the kite page (layout changed?)');
    return buildCncSlots(prices);
  },
};

