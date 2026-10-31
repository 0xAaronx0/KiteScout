// ---------------------------------------------------------------------------
// Batikite Resort, Mallasoro (Jeneponto, South Sulawesi, Indonesia) - beachfront kite camp of Jeneponto
// Kitesurfing (PT Angin Sejahtera Indonesia) on a 2 km flat, shallow lagoon: bungalows, a dormitory, pool,
// restaurant and an F-ONE kite center on site; wind season May to October.
//
// Found via bstoked listing 7360 ("Best kitesurfing Indonesia", host "batikite"; inactive). The resort has its
// OWN website, so nothing is read from bstoked (Aaron's data rule 2026-10-12: data from the provider's own site).
// Data path (checked 2026-10-12): WordPress (Elementor + Yoast), English.
//   content  / (quick facts: season, wind, spot, gear, transfer), /kitesurf-camp-indonesia/ (the Batikite
//            page: property, bungalow galleries per type, "Our Pricing 2026" + "Our Pricing 2027" tables,
//            schema.org Resort JSON-LD with geo, amenities, numberOfRooms), /kitesurf-travel/ (FAQ: capacity
//            per bungalow type, lesson / rental / transfer prices in IDR, payment and deposit rules).
//   slots    the two pricing tables on /kitesurf-camp-indonesia/ ("GAJAH IDR 2.2 M by night ..."), IDR per
//            bungalow per night for 2 persons with breakfast ("Prices for 2 persons - Includes breakfast -
//            Single occupancy -150K"). Band = the table's year (2026-01-01..12-31, 2027-01-01..12-31,
//            datePrecision 'season'; the page gives no other date limits); bands that ended are dropped.
//            Booking is a request form (/book-now/) answered by the team -> 'on_request'.
// Liveness (rule 5b): the page prints "Our Pricing 2026" and "Our Pricing 2027"; dateModified 2026-08-19; home
//   Instagram feed "Enjoying the season 2026"; blog posts July/August 2026.
// robots.txt (2026-10-12): only /wp-admin/ disallowed (admin-ajax allowed).
// Requests per run: content 3, slots 1.
// Map pin: the page's own Resort JSON-LD geo (-5.6492245, 119.5844938).
// Known limits: the sister property Salmira Beach Resort (500 m from the spot, same site, own price table on
//   /jeneponto-hotel-beach/) is not part of this offer. MONYET is a dormitory "up to 12 persons" but the
//   footnote prices every unit "for 2 persons" -> occupancy 2 as printed. KUDA (2 bedrooms, 4 persons) is only
//   in the 2027 table. The village fee (IDR 150K per stay, /book-now/) is not read.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, imageCandidates, ldOfType, parse, todayIso } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://indonesiakitesurfing.com';
export const BK_HOME_URL = `${SITE}/`;
export const BK_RESORT_URL = `${SITE}/kitesurf-camp-indonesia/`;
export const BK_FAQ_URL = `${SITE}/kitesurf-travel/`;
const BOOKING_URL = `${SITE}/book-now/`;

/** Bungalow class names from the FAQ ("GAJAH (Premium)"); KUDA is new in the 2027 table. */
const CLASS: Record<string, string> = { gajah: 'Premium', penyu: 'Deluxe', monyet: 'Dormitory', kuda: 'Two-bedroom' };

export interface BkRate { year: number; room: string; price: number; persons: number | null; features: string[] }

function mainText(html: string): string {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, svg, header, footer, nav, form')) el.remove();
  return collapse((root.querySelector('main') ?? root.querySelector('body') ?? root).text);
}
const titleCase = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

// --- pure parsers -------------------------------------------------------------------------------------
/** "IDR 2.2 M" / "IDR 700 K" / "IDR 1,400,000" -> rupiah. */
export function idr(amount: string, scale?: string): number | null {
  const n = Number(amount.replace(/,(?=\d{3}\b)/g, '').replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return null;
  const f = scale?.toUpperCase() === 'M' ? 1_000_000 : scale?.toUpperCase() === 'K' ? 1_000 : 1;
  return Math.round(n * f);
}

/** Both pricing tables: "Our Pricing 2026 ... GAJAH IDR 2.2 M by night Get Started 51 m2 Sea view ...". */
export function parseBkRates(html: string): BkRate[] {
  const parts = mainText(html).split(/Our Pricing (20\d{2})/);
  const out: BkRate[] = [];
  for (let i = 1; i + 1 < parts.length; i += 2) {
    const year = Number(parts[i]);
    const body = parts[i + 1].split(/Stay In Touch|Follow us/i)[0];
    const footPersons = body.match(/Prices for (\d+) persons/i)?.[1];
    const re = /\b([A-Z]{4,})\s+IDR\s+(\d+(?:[.,]\d+)?)\s*(M|K)\s+by night\s+(?:Get Started\s+)?([\s\S]*?)(?=\b[A-Z]{4,}\s+IDR\b|Prices for|$)/g;
    for (const m of body.matchAll(re)) {
      const price = idr(m[2], m[3]);
      if (!price) continue;
      const tail = collapse(m[4]);
      const own = tail.match(/^(\d+) persons?\b/i)?.[1];
      const features = tail
        .replace(/^(?:up to )?\d+ persons?\s*/i, '')
        .split(/\s(?=\d+ m2|\d+ bedrooms?|Sea view|Garden view|King size|Queen size|Size |AC|Mosquitoes net|Safety box|Bunk beds|Shared bathroom|Smart TV|Kettle)/)
        .map(s => s.trim()).filter(Boolean);
      const capacity = tail.match(/^((?:up to )?\d+ persons?)/i)?.[1];
      out.push({
        year,
        room: titleCase(m[1]),
        price,
        persons: own ? Number(own) : footPersons ? Number(footPersons) : null,
        features: capacity && !own ? [`${capacity}`, ...features] : features,
      });
    }
  }
  return out;
}

/** Footnote under the tables: "Prices for 2 persons — Includes breakfast — Single occupancy -150K" + extra bed line. */
export function parseBkNotes(html: string): string[] {
  const t = mainText(html);
  const notes: string[] = [];
  const foot = t.match(/Prices for \d+ persons[^A]*?Includes breakfast[^A]*?Single occupancy\s*-\s*\d+K/i)?.[0];
  if (foot) notes.push(collapse(foot.replace(/\s*[—–-]\s*(?=Includes|Single)/g, '; ')));
  const extra = t.match(/Additional single bed \(by night\):[^.]+?\(< ?5yo\)/i)?.[0];
  if (extra) notes.push(extra);
  return [...new Set(notes)];
}

/** Home "quick facts" block: <div class="mjs-fact"><dt>Wind season</dt><dd>May to October, ...</dd></div>. */
export function parseBkFacts(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of parse(html).querySelectorAll('.mjs-fact')) {
    const k = collapse(f.querySelector('dt')?.text ?? '').toLowerCase();
    const v = collapse(f.querySelector('dd')?.text ?? '');
    if (k && v) out[k] = v;
  }
  return out;
}

/** Organization JSON-LD contactPoint.availableLanguage ("English", "French", "Indonesian") -> ISO codes. */
export function parseBkLanguages(html: string): string[] {
  const ISO: Record<string, string> = { english: 'en', french: 'fr', indonesian: 'id', spanish: 'es', italian: 'it', german: 'de' };
  const out: string[] = [];
  for (const o of ldOfType(html, 'Organization')) {
    for (const cp of ([] as unknown[]).concat(o.contactPoint ?? [])) {
      for (const l of ([] as unknown[]).concat((cp as Record<string, unknown>)?.availableLanguage ?? [])) {
        const code = ISO[String(l).toLowerCase()];
        if (code && !out.includes(code)) out.push(code);
      }
    }
  }
  return out;
}

/** FAQ: capacity per bungalow type ("3 x GAJAH (Premium – 6 guests)") and the priced extras. */
export function parseBkFaq(html: string): { capacity: string[]; extras: string[] } {
  const t = mainText(html);
  const cap = t.match(/BATIKITE can accommodate up to (\d+) people:\s*([\s\S]*?)SALMIRA/i);
  const capacity = cap ? [...cap[2].matchAll(/(\d+)\s*x\s*([A-Z]+)\s*\(([^)]+)\)/g)].map(m => `${m[1]} x ${titleCase(m[2])} (${collapse(m[3]).replace(/\s*[–—]\s*/, ', ')})`) : [];
  const extras: string[] = [];
  const pick = (label: string, re: RegExp) => { const m = t.match(re); if (m) extras.push(`${label}: IDR ${m[1]}`); };
  pick('Airport transfer from Makassar (one way, private car)', /Airport transfer \(one way, private car\) = IDR ([\d,]+)/i);
  for (const [name, hours] of [['Coaching', '1 hour'], ['Taster', '2 hours'], ['Crush', '5 hours'], ['Passion', '9 hours'], ['Addict', '12 hours']]) {
    pick(`Private kite lesson "${name}" (${hours}, per person, gear included)`, new RegExp(`${name} \\(${hours}\\) = IDR ([\\d,]+)`, 'i'));
  }
  pick('Kite rental, complete set, 1 day', /Complete set \(kite, board, harness\)\s*1\/2 day = IDR [\d,]+\s*1 day = IDR ([\d,]+)/i);
  pick('Kite rental, complete set, 6+ days (per day)', /Complete set[\s\S]*?6\+ days = IDR ([\d,]+) per day/i);
  pick('Kite gear insurance (per day)', /Kite gear insurance = IDR ([\d,]+) by day/i);
  if (/Groups get 20% off/i.test(t)) extras.push('Group lessons: 20% off the private rate');
  return { capacity, extras };
}

export function buildBkSlots(rates: BkRate[], today = todayIso()): Slot[] {
  return rates
    .filter(r => `${r.year}-12-31` >= today)
    .map(r => ({
      key: `${r.room.toLowerCase()}|${r.year}`,
      startDate: `${r.year}-01-01`,
      endDate: `${r.year}-12-31`,
      unit: CLASS[r.room.toLowerCase()] ? `${r.room} (${CLASS[r.room.toLowerCase()]})` : r.room,
      price: r.price,
      currency: 'IDR',
      priceUnit: 'per_night' as const,
      priceBasis: 'room' as const,
      occupancy: r.persons,
      availability: 'on_request' as const,
      availabilityText: null,
      spotsLeft: null,
      datePrecision: 'season' as const,
    }));
}

// --- content --------------------------------------------------------------------------------------------
export interface BkPages { home: string; resort: string; faq: string }

export function parseBatikiteContent(p: BkPages): OfferContent {
  const home = mainText(p.home);
  const resort = mainText(p.resort);
  const ld = ldOfType(p.resort, 'Resort')[0] ?? {};
  const geo = (ld.geo ?? {}) as Record<string, unknown>;
  const lat = Number(geo.latitude);
  const lng = Number(geo.longitude);
  const amenities = ((ld.amenityFeature ?? []) as Array<Record<string, unknown>>).map(a => String(a.name ?? '')).filter(Boolean);
  const rates = parseBkRates(p.resort);
  const notes = parseBkNotes(p.resort);
  const { capacity, extras } = parseBkFaq(p.faq);
  const languages = parseBkLanguages(p.home);
  if (rates.length === 0) throw new Error('batikite: pricing tables not found on /kitesurf-camp-indonesia/ (page changed)');

  const facts = parseBkFacts(p.home);
  const season = facts['wind season'] ?? null;
  const spotFact = facts['the spot'] ?? null;
  const gear = facts['gear'] ?? null;
  const getting = facts['getting here'] ?? null;
  const nRooms = typeof ld.numberOfRooms === 'string' || typeof ld.numberOfRooms === 'number' ? String(ld.numberOfRooms) : resort.match(/with (\d+) bungalows/i)?.[1] ?? null;
  const hectare = resort.match(/property of ([\d.]+) hectare/i)?.[1] ?? null;
  const currentYear = rates.some(r => r.year === Number(todayIso().slice(0, 4))) ? Number(todayIso().slice(0, 4)) : rates[0].year;
  const yearRates = rates.filter(r => r.year === currentYear);
  const fmt = (n: number) => n.toLocaleString('en-US');

  const summary = [
    `Batikite Resort is the beachfront kite camp of Jeneponto Kitesurfing in Mallasoro village, Jeneponto (South Sulawesi, Indonesia), on a ${spotFact ?? 'flat, shallow lagoon'}${getting ? `, ${getting}` : ''}.`,
    `The ${hectare ? `${hectare}-hectare ` : ''}property has ${nRooms ?? '12'} traditional bungalows, including a dormitory, around a pool, lounge and restaurant overlooking the spot; ${currentYear} rates run from IDR ${fmt(Math.min(...yearRates.map(r => r.price)))} to ${fmt(Math.max(...yearRates.map(r => r.price)))} per bungalow and night for two persons with breakfast.`,
    `The on-site kite center rents ${gear && /F-ONE/i.test(gear) ? 'F-ONE ' : ''}gear and gives private and group lessons for beginners to advanced riders${season ? `; the wind season runs ${season.replace(/,.*$/, '')}` : ''}.`,
  ].join(' ');

  const byRoom = new Map<string, ContentRoom>();
  for (const r of [...rates].sort((a, b) => b.year - a.year)) {
    const cls = CLASS[r.room.toLowerCase()];
    const name = cls ? `${r.room} (${cls})` : r.room;
    const room = byRoom.get(name) ?? { name, description: null, features: [...r.features] };
    room.features.push(`${r.year}: IDR ${fmt(r.price)} per night${r.persons ? ` for ${r.persons} persons` : ''}, breakfast included`);
    byRoom.set(name, room);
  }
  for (const c of capacity) {
    const m = c.match(/^(\d+) x (\w+) \(([^)]+)\)/);
    if (!m) continue;
    const room = [...byRoom.values()].find(r => r.name.startsWith(m[2]));
    if (room) room.description = `${m[1]} unit${m[1] === '1' ? '' : 's'} on site (${m[3]}).`;
  }
  const rooms = [...byRoom.values()].map(r => ({ ...r, features: [...new Set(r.features)].sort((a, b) => Number(/^\d{4}:/.test(a)) - Number(/^\d{4}:/.test(b))) }));

  const seen = new Set<string>();
  const imageUrls: string[] = [];
  for (const u of [...imageCandidates(p.resort, BK_RESORT_URL, null, 60), ...imageCandidates(p.home, BK_HOME_URL, null, 40)]) {
    if (/\.svg|logo|icon|\/elementor\/thumbs\/|trustindex|favicon/i.test(u)) continue;
    const k = u.replace(/-(?:\d+x\d+|scaled)(?=\.[a-z]+$)/i, '');
    if (seen.has(k)) continue;
    seen.add(k); imageUrls.push(u);
  }

  return {
    kind: 'accommodation',
    title: String(ld.name ?? 'Batikite Resort'),
    summary,
    continent: 'Asia',
    country: 'Indonesia',
    region: 'South Sulawesi',
    spot: 'Mallasoro, Jeneponto',
    spotCoords: Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0) ? { lat, lng } : null,
    spotCoordsPrecise: true,
    itinerarySpots: [],
    durationDays: null,
    // home quick facts: "Level Beginners to advanced, private and group lessons" (2026-10-12)
    skillLevels: /Beginners to advanced/i.test(home) ? ['beginner', 'intermediate', 'advanced'] : [],
    kiteLessons: /lessons/i.test(home),
    equipmentRental: /for rent|rental/i.test(home),
    beginnerFriendly: /Beginners to advanced|learn kitesurf/i.test(home) ? true : null,
    includedServices: amenities.filter(a => !/^(Beachfront|On-site kite center)$/i.test(a)),
    optionalServices: [...extras, ...notes.filter(n => /Additional single bed/i.test(n))],
    accommodation: 'beachfront bungalows and a dormitory in a kite camp',
    mealPlan: 'breakfast',
    languages: languages.length ? languages : ['en'],
    rooms,
    imageUrls: imageUrls.slice(0, 40),
    heroVideoUrl: null,
    sourceUrl: BK_RESORT_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      `resort JSON-LD: ${String(ld.description ?? '')} priceRange ${String(ld.priceRange ?? '')}; amenities ${amenities.join(', ')}`,
      `resort page: ${resort.split(/Our Pricing/i)[0].slice(0, 1500)}`,
      `rates: ${rates.map(r => `${r.year} ${r.room} IDR ${r.price}${r.persons ? ` (${r.persons}p)` : ''} [${r.features.join(', ')}]`).join('; ')}`,
      `notes: ${notes.join(' | ')}`,
      `home quick facts: ${Object.entries(facts).map(([k, v]) => `${k}: ${v}`).join('; ')}`,
      `languages (Organization JSON-LD contactPoint): ${languages.join(', ')}`,
      `faq capacity: ${capacity.join('; ')}`,
      `faq extras: ${extras.join('; ')}`,
      `geo: ${geo.latitude ?? ''},${geo.longitude ?? ''}`,
    ].join('\n'),
  };
}

// --- adapter --------------------------------------------------------------------------------------------
export const batikiteResortJeneponto: OfferAdapter = {
  key: 'batikite-resort-jeneponto',
  name: 'Batikite Resort (Jeneponto)',
  kind: 'accommodation',
  operator: {
    name: 'Jeneponto Kitesurfing',
    websiteUrl: SITE,
    rootDomain: 'indonesiakitesurfing.com',
    contactEmail: 'jenepontokitesurfing@gmail.com', // Resort JSON-LD + footer, 2026-10-12
    phone: '+6282298686099',                        // "+62 822-9868-6099", Resort JSON-LD + footer
  },
  url: BK_RESORT_URL,
  slotMethod: 'price_table',
  fetchBudget: 4,
  async fetchContent() {
    const home = await fetchText(BK_HOME_URL, { accept: 'text/html' });
    const resort = await fetchText(BK_RESORT_URL, { accept: 'text/html' });
    const faq = await fetchText(BK_FAQ_URL, { accept: 'text/html' });
    return parseBatikiteContent({ home, resort, faq });
  },
  async fetchSlots(ctx) {
    const rates = parseBkRates(await fetchText(BK_RESORT_URL, { accept: 'text/html' }));
    if (rates.length < 3) throw new Error(`batikite: pricing tables not found or changed (${rates.length} rates parsed)`);
    const years = [...new Set(rates.map(r => r.year))];
    if (!years.some(y => `${y}-12-31` >= todayIso())) ctx.note(`batikite: only expired price tables (${years.join(', ')}) - price on request until new rates`);
    return buildBkSlots(rates);
  },
};
