// ---------------------------------------------------------------------------
// Gnaraloo Station - 3 Mile Camp (Gnaraloo, Western Australia, 150 km north of Carnarvon): the station's beachfront
// campground next to the Tombstones wave (kite, windsurf and surf) and the 3 Mile lagoon: 65 unpowered campsites
// in four styles (Basic sites, Primo sites, the Lagoon site, "the Hilton" beach shack), 3 ablution blocks with hot
// showers, a small shop. Gnaraloo's own kitesurfing page (/kitesurfing/) describes the two kite spots: Tombstones
// (waves, experienced riders) and Gnaraloo Bay (flat water) -> KIND = 'accommodation'.
// Aaron's call 2026-10-19: here the stay itself is camping, so the site types are listed as units (the usual
// "rental units only, never pitches" rule does not fit this product).
//
// This file also holds the shared Gnaraloo helpers (tariff table parser, room blocks, photos); the Homestead adapter
// (gnaraloo-station-homestead.ts) imports them.
//
// Data path (checked 2026-10-19): WordPress.com site, static pages, no booking engine ("Book Now" links all go to
//   the /booking-enquiry/ form; bookings by enquiry):
//   slots    /3-mile-tariffs/ "3 Mile Camp Tariffs 2026" ("Tariffs are advised in Australian Dollars, including GST"):
//            three tables (Off Peak / Standard / Peak period rates), each row = site type, PAX, Base Price, Add Adult,
//            Add Child. One UNDATED slot per site type x period: price = base price for PAX guests, AUD,
//            priceUnit 'per_night' (inferred: the table does not say "per night"; the extras on the same page are
//            "$2.50 per night per dog"), priceBasis 'room' (per site), occupancy = PAX; the period definition and
//            the add-adult / add-child rates go into availabilityText. availability 'on_request' (enquiry form).
//            The periods are defined by WA school holidays, not by dates on the page -> no dated bands.
//   content  /3-mile-camp/ (facilities, the four site styles with their descriptions, photos) + /kitesurfing/.
// Unit naming: the tariff names ("General Camp Sites", "Red/Green/Gold Star Premium Sites", "Hilton") differ from the
//   site styles on the camp page (Basic, Primo, Lagoon, Hilton). General = Basic and Hilton = The Hilton are mapped
//   (inferred); which star grade is a Primo or the Lagoon site is not stated -> those slots carry no `room`.
// Note: the 2026 off-peak table prices every site at AUD 20 base for 1 guest (the Hilton 40 for 2), the standard
//   and peak tables scale the premium sites by PAX (2/3/4 guests) - kept as printed.
// robots.txt (2026-10-19): only /wp-admin/ disallowed.
// Requests per run: content 3 (camp page, tariffs, kitesurfing page), slots 1 (tariffs, memoised in the same run).
// spotCoords: none on the site (the location page gives driving directions only).
// ---------------------------------------------------------------------------
import { imageCandidates, parseAmount, todayIso } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, OperatorRef, Slot } from '../types.js';
import { memoPage, wpLines } from './kite-republic-aitutaki-winter-escape.js';

export const GNARALOO_SITE = 'https://gnaraloostation.com';
export const GNARALOO_KITE_URL = `${GNARALOO_SITE}/kitesurfing/`;
export const GNARALOO_ENQUIRY_URL = `${GNARALOO_SITE}/booking-enquiry/`;
export const G3M_URL = `${GNARALOO_SITE}/3-mile-camp/`;
export const G3M_TARIFFS_URL = `${GNARALOO_SITE}/3-mile-tariffs/`;

export const GNARALOO_OPERATOR: OperatorRef = {
  name: 'Gnaraloo Station',
  websiteUrl: GNARALOO_SITE,
  rootDomain: 'gnaraloostation.com',
  contactEmail: 'bookings@gnaraloo.com.au',
};

// --- shared parsers ------------------------------------------------------------------------------------
export type GnPeriod = 'off_peak' | 'standard' | 'peak';
export interface GnRate { unit: string; period: GnPeriod; pax: number; base: number; addAdult: number | null; addChild: number | null }
export interface GnTariffs { year: number | null; rates: GnRate[]; periods: Partial<Record<GnPeriod, string>>; extras: string[] }

const MONEY = /^\$\s?[\d,]+(?:\.\d{1,2})?$/;
const periodOf = (s: string): GnPeriod | null =>
  /off[\s-]?peak/i.test(s) ? 'off_peak' : /standard/i.test(s) ? 'standard' : /\bpeak/i.test(s) ? 'peak' : null;
export const GN_PERIOD_LABEL: Record<GnPeriod, string> = { off_peak: 'Off peak', standard: 'Standard', peak: 'Peak' };

/** "<x> Tariffs 2026" + per period: heading "... - Off Peak Period Rates" (en dash on the page), definition line, header row, then rows of
 *  5 cells (name, PAX, $base, $add adult, $add child). */
export function parseGnTariffs(html: string): GnTariffs {
  const lines = wpLines(html).map(l => l.replace(/[–—]/g, '-'));
  const year = Number(lines.find(l => /Tariffs\s+20\d{2}$/i.test(l))?.match(/(20\d{2})$/)?.[1] ?? 0) || null;
  const rates: GnRate[] = [];
  const periods: Partial<Record<GnPeriod, string>> = {};
  let extras: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const h = lines[i].match(/-\s*(.+?) Period Rates$/i);
    if (h) {
      const period = periodOf(h[1]);
      if (!period) continue;
      periods[period] = lines[i + 1] ?? '';
      let j = lines.findIndex((l, k) => k > i && /^Add Child$/i.test(l));
      if (j < 0) continue;
      j++;
      while (j + 4 < lines.length && /^\d+$/.test(lines[j + 1]) && MONEY.test(lines[j + 2])) {
        const base = parseAmount(lines[j + 2]);
        if (base !== null) {
          rates.push({
            unit: lines[j],
            period,
            pax: Number(lines[j + 1]),
            base,
            addAdult: MONEY.test(lines[j + 3]) ? parseAmount(lines[j + 3]) : null,
            addChild: MONEY.test(lines[j + 4]) ? parseAmount(lines[j + 4]) : null,
          });
        }
        j += 5;
      }
      i = j - 1;
      continue;
    }
    if (/- Additional Services$/i.test(lines[i])) {
      const end = lines.findIndex((l, k) => k > i && /^Gnaraloo Station$|Powered by WordPress/i.test(l));
      extras = lines.slice(i + 1, end > 0 ? end : undefined);
    }
  }
  return { year, rates, periods, extras };
}

/** Accommodation blocks of a WordPress.com page: "<name>" + description lines, each closed by a "Book Now" button. */
export function parseGnRooms(html: string): ContentRoom[] {
  const lines = wpLines(html);
  const start = lines.findIndex(l => /^Know before you go$/i.test(l));
  const out: ContentRoom[] = [];
  let block: string[] = [];
  for (const l of lines.slice(start + 1)) {
    if (/^Book Now$/i.test(l)) {
      if (block.length >= 2) out.push({ name: block[0], description: block.slice(1).join(' '), features: [] });
      block = [];
    } else if (/^Gnaraloo Station$|Powered by WordPress/i.test(l)) {
      break;
    } else {
      block.push(l);
    }
  }
  return out;
}

/** Own photos, originals: the i0.wp.com proxy is unwrapped to the site's uploads; maps and icons dropped. */
export function gnImages(html: string, baseUrl: string): string[] {
  const out: string[] = [];
  for (const u of imageCandidates(html, baseUrl, null, 80)) {
    const direct = u.replace(/^https:\/\/i\d\.wp\.com\/(gnaraloostation\.com\/)/, 'https://$1').replace(/\?.*$/, '');
    if (!/^https:\/\/gnaraloostation\.com\/wp-content\/uploads\/.+\.(jpe?g|png|webp)$/i.test(direct)) continue;
    if (/map|logo|icon|\/camp\.png$/i.test(direct)) continue;
    const orig = direct.replace(/-\d{2,4}x\d{2,4}(\.[a-z]+)$/i, '$1');
    if (!out.includes(orig)) out.push(orig);
  }
  return out;
}

/** Text of the kitesurfing page between its title and the footer. */
export function gnKiteText(html: string | null): string {
  if (!html) return '';
  const lines = wpLines(html);
  const s = lines.findIndex(l => /^Kitesurfing$/i.test(l));
  const e = lines.findIndex((l, k) => k > s && /^Gnaraloo Station$|Powered by WordPress/i.test(l));
  return lines.slice(s + 1, e > s ? e : undefined).join('\n');
}

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const aud = (n: number): string => `AUD ${Number.isInteger(n) ? n : n.toFixed(2)}`;

/** One undated slot per unit x period (base price for PAX guests per night, AUD, by enquiry). */
export function buildGnSlots(t: GnTariffs, roomOf: (unit: string) => string | null, unitName: (unit: string) => string = u => u): Slot[] {
  return t.rates.map(r => {
    const unit = unitName(r.unit);
    const def = t.periods[r.period];
    return {
      key: `${slug(unit)}|${r.period}`,
      startDate: null,
      endDate: null,
      unit,
      room: roomOf(r.unit),
      price: r.base,
      currency: 'AUD',
      priceUnit: 'per_night' as const,
      priceBasis: 'room' as const,
      occupancy: r.pax,
      availability: 'on_request' as const,
      availabilityText: [
        `${GN_PERIOD_LABEL[r.period]} period rate${t.year ? ` ${t.year}` : ''}${def ? ` (${def.replace(/[.,;:\s]+$/, '')})` : ''}`,
        `base price for ${r.pax} guest${r.pax === 1 ? '' : 's'}${r.addAdult ? `, +${aud(r.addAdult)} per extra adult` : ''}${r.addChild ? `, +${aud(r.addChild)} per child` : ''}`,
        'booking by enquiry',
      ].join('; '),
      spotsLeft: null,
    };
  });
}

// --- 3 Mile Camp --------------------------------------------------------------------------------------------
/** General = Basic sites and Hilton = The Hilton (inferred); the star grades are not tied to a site style. */
export function g3mRoomOf(unit: string): string | null {
  if (/general/i.test(unit)) return 'Basic Sites';
  if (/hilton/i.test(unit)) return 'The Hilton';
  return null;
}

export interface G3mPages { camp: string; tariffs: string; kite: string | null }

export function parseG3mContent(p: G3mPages): OfferContent {
  const lines = wpLines(p.camp);
  const t = parseGnTariffs(p.tariffs);
  const rooms = parseGnRooms(p.camp);
  if (!t.rates.length) throw new Error('gnaraloo-3-mile: no tariff rows (layout changed?)');
  if (!rooms.length) throw new Error('gnaraloo-3-mile: no site blocks on the camp page (layout changed?)');
  const sites = lines.find(l => /\d+\s+unpowered campsites/i.test(l))?.match(/(\d+)\s+unpowered/i)?.[1] ?? null;
  const cheapest = Math.min(...t.rates.map(r => r.base));
  const hilton = t.rates.filter(r => /hilton/i.test(r.unit)).map(r => r.base);
  const kite = gnKiteText(p.kite);

  const summary = [
    `3 Mile Camp is Gnaraloo Station's beachfront campground on the remote Ningaloo coast of Western Australia, about 150 km north of Carnarvon, with ${sites ?? 'a few dozen'} unpowered campsites next to the Tombstones wave and a protected lagoon.`,
    'Guests choose basic or primo sites, the large private Lagoon site or "the Hilton", the only beach shack on the ocean front; the camp has three ablution blocks with hot showers, a small shop and no power on the sites.',
    'Gnaraloo describes two kite spots: Tombstones, a big reef wave for experienced riders, and the flatter water of Gnaraloo Bay, with a Tombstones to Gnaraloo Bay downwinder.',
    `${t.year ? `${t.year} rates` : 'Rates'} run from ${aud(cheapest)} per site and night in the off peak period${hilton.length ? `, the Hilton ${aud(Math.min(...hilton))} to ${aud(Math.max(...hilton))}` : ''}; peak periods follow the West Australian school holidays, and bookings are made by enquiry.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Gnaraloo Station 3 Mile Camp',
    summary,
    continent: 'Oceania',
    country: 'Australia',
    region: 'Gnaraloo, Western Australia',
    spot: '3 Mile Camp',
    spotCoords: null,
    itinerarySpots: [],
    durationDays: null,
    skillLevels: ['intermediate', 'advanced'], // Tombstones: experienced riders; Gnaraloo Bay: confident self-rescue
    kiteLessons: null,     // the station offers no kite school; nothing on the site either way
    equipmentRental: null,
    beginnerFriendly: false,
    includedServices: ['Unpowered campsite or beach shack', 'Ablution blocks with flushing toilets, hot showers, sinks for dishes and laundry'],
    optionalServices: ['Shop: groceries, drinking water, cold beer, wireless internet, power to recharge', 'Dogs permitted (fees and conditions apply)'],
    accommodation: 'unpowered beachfront campsites and one beach shack (the Hilton)',
    mealPlan: 'self_catering',
    languages: ['en'],
    rooms,
    imageUrls: gnImages(p.camp, G3M_URL).slice(0, 20),
    heroVideoUrl: null,
    sourceUrl: G3M_URL,
    bookingUrl: GNARALOO_ENQUIRY_URL,
    sourceText: [
      lines.join('\n'),
      `tariffs ${t.year}: ${t.rates.map(r => `${r.unit}/${r.period}: ${r.pax} pax $${r.base} +${r.addAdult}/+${r.addChild}`).join('; ')}`,
      `periods: ${Object.entries(t.periods).map(([k, v]) => `${k} = ${v}`).join(' | ')}`,
      `extras: ${t.extras.join(' | ')}`,
      kite ? `kitesurfing page: ${kite}` : '',
    ].filter(Boolean).join('\n'),
  };
}

export async function fetchG3mSlots(ctx?: { note(t: string): void }): Promise<Slot[]> {
  const t = parseGnTariffs(await memoPage(G3M_TARIFFS_URL));
  if (!t.rates.length) throw new Error('gnaraloo-3-mile: no tariff rows (layout changed?)');
  if (t.year && t.year < Number(todayIso().slice(0, 4))) ctx?.note(`tariffs are for ${t.year} (not updated yet)`);
  return buildGnSlots(t, g3mRoomOf);
}

export const gnaralooStation3MileCamp: OfferAdapter = {
  key: 'gnaraloo-station-3-mile-camp',
  name: 'Gnaraloo Station 3 Mile Camp',
  kind: 'accommodation',
  operator: GNARALOO_OPERATOR,
  url: G3M_URL,
  slotMethod: 'price_table',
  fetchBudget: 4,
  async fetchContent() {
    const camp = await memoPage(G3M_URL);
    const tariffs = await memoPage(G3M_TARIFFS_URL);
    const kite = await memoPage(GNARALOO_KITE_URL).catch(() => null);
    return parseG3mContent({ camp, tariffs, kite });
  },
  fetchSlots: ctx => fetchG3mSlots(ctx),
};
