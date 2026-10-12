// ---------------------------------------------------------------------------
// Pousada Maré Alta, Parajuru (Ceará, Brazil) - 8-apartment guesthouse on the grounds of KBC Parajuru,
// the Kiteboarding Club's kite and wingfoil center (free gear storage for guests).
//
// Data path (checked 2026-10-12):
//   content  www.kiteboarding-club.com/en/pousada (TYPO3): intro + check list, room blocks (<h3> + guests
//            line + description + <table class="contenttable"> "Guests | Price per night | Book" with a
//            myleao.com/product/<id> link per row), price validity ("Prices are valid from February 1,
//            2026, through January 31, 2027"), long-stay discounts, transfers (Leão price list), FAQ, map
//            embed (Google Maps pin "Kiteboarding Club Parajuru").
//   slots    booking engine = Leão Booking (myleao.com, station 4), public JSON without login, the same
//            engine the page's "Book" buttons open:
//            GET /api/product/station/4  -> all products; the apartments (tag 1395 "Apartments Maré Alta")
//                                           are sold as "<apartment>, <n> Personen <k> Nächte" variants;
//                                           the 1-night variant (duration_net 86400) gives the nightly
//                                           price per apartment and guest count.
//            GET /api/product/available/<parent>/<resource>/<startUnix>/<endUnix>/en/0
//                                        -> month check for one apartment category: `notAvail` lists the
//                                           nights the engine's apartment is taken, `error` says "may not
//                                           be available for the entire travel period", `bookedOut: true`
//                                           = nothing bookable. The engine answers at most 30 days per call.
//            Resource per category from /api/ressource/product/<parent>/en (2026-10-12): Tarifa/Portugal
//            47, Hindeloopen/Brouwersdam 48, El Gouna 49, Sal/Sicily/Dakhla 50.
// robots.txt (2026-10-12): kiteboarding-club.com allows the page (only TYPO3 folders and tracking
//   parameters disallowed); www.myleao.com/robots.txt is 404 (= allow all).
// Requests per run: content 1, slots 1 + 4 categories x 6 months = 25.
// Parsed: slot = apartment category x guest count x run of nights with the same engine state
//   ("tarifa-portugal-2p|2026-11-01"), EUR per apartment per night incl. breakfast; occupancy = guests the
//   product is sold for (the El Gouna "2 people + 1 child" product counts 3).
// Known limits: rates are flat in the engine (the page: "valid from February 1, 2026, through January
//   31, 2027 (subject to change)"); months after January 2027 carry the engine's current 1-night price.
//   The month check also returns the engine's priced stay variation; stays of <= 14 nights matched the
//   1-night rates for every month on 2026-10-12 (longer ones carry the long-stay discount), so a
//   mismatch there is reported as a run note (season price change).
//   The month check reflects the one apartment the engine would assign: for the 2- and 3-apartment
//   categories "taken" means that apartment, not the whole category (-> limited); El Gouna is a single
//   apartment, so "taken" there is sold out. Long-stay discounts (5/8/10 %) are in the room features.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, imageCandidates, iso, parse, parseAmount, runsOf, todayIso } from '../parse.js';
import type { Availability, ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.kiteboarding-club.com';
export const MA_PAGE_URL = `${SITE}/en/pousada`;
const LEAO = 'https://www.myleao.com';
const STATION = 4;
export const MA_PRODUCTS_URL = `${LEAO}/api/product/station/${STATION}`;
const BOOKING_URL = `${LEAO}/station/${STATION}/en`;
const APARTMENT_TAG = '1395';
const MONTHS = 6;

export type MaCategory = 'el-gouna' | 'hindeloopen-brouwersdam' | 'tarifa-portugal' | 'sal-sicily-dakhla';
/** unit names = OfferContent.rooms names (the ingest joins on them) */
export const MA_UNITS: Record<MaCategory, string> = {
  'el-gouna': 'El Gouna two-bedroom apartment',
  'hindeloopen-brouwersdam': 'Hindeloopen / Brouwersdam apartment',
  'tarifa-portugal': 'Tarifa / Portugal apartment',
  'sal-sicily-dakhla': 'Sal / Sicily / Dakhla apartment',
};
/** Leão room resources per category (from /api/ressource/product/<parent>/en, 2026-10-12). */
export const MA_RESOURCES: Record<MaCategory, number> = { 'tarifa-portugal': 47, 'hindeloopen-brouwersdam': 48, 'el-gouna': 49, 'sal-sicily-dakhla': 50 };
/** apartments per category (page: "Hindeloopen" & "Brouwersdam", "Tarifa" & "Portugal", "Sal," "Sicily," and "Dakhla") */
const UNITS_PER_CATEGORY: Record<MaCategory, number> = { 'el-gouna': 1, 'hindeloopen-brouwersdam': 2, 'tarifa-portugal': 2, 'sal-sicily-dakhla': 3 };

export function maCategoryOf(name: string): MaCategory | null {
  if (/el gouna/i.test(name)) return 'el-gouna';
  if (/hindeloopen|brouwersdam/i.test(name)) return 'hindeloopen-brouwersdam';
  if (/tarifa|portugal/i.test(name)) return 'tarifa-portugal';
  if (/da?h?kla|sizilien|sicily|\bsal\b/i.test(name)) return 'sal-sicily-dakhla';
  return null;
}

export interface MaRoomProduct {
  category: MaCategory;
  /** stable slug, e.g. "tarifa-portugal-2p", "el-gouna-2p1c" */
  slug: string;
  unit: string;
  /** parent product id (the page's "Book" link and the availability/quote id) */
  parentId: number;
  adults: number;
  children: number;
  nightly: number;
  currency: string;
}

// --- Leão helpers (local; kite-village-hamata.ts carries the same engine logic) ------------------
function daysIn(year: number, month: number): number { return new Date(Date.UTC(year, month, 0)).getUTCDate(); }

/** UTC unix window of a calendar month (end = last second of the month). */
export function maMonthWindow(year: number, month: number): { start: number; end: number } {
  return { start: Date.UTC(year, month - 1, 1) / 1000, end: Date.UTC(year, month, 1) / 1000 - 1 };
}

/** The current month and the following ones. */
export function maMonths(today: string, n = MONTHS): Array<{ year: number; month: number }> {
  let y = Number(today.slice(0, 4));
  let m = Number(today.slice(5, 7));
  const out: Array<{ year: number; month: number }> = [];
  for (let k = 0; k < n; k++) {
    out.push({ year: y, month: m });
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

export function maAvailableUrl(parentId: number, resource: number, year: number, month: number): string {
  const w = maMonthWindow(year, month);
  return `${LEAO}/api/product/available/${parentId}/${resource}/${w.start}/${w.end}/en/0`;
}

/** 1-night apartment products of station 4 (nightly price per apartment for n guests). */
export function parseMaRoomProducts(json: string): MaRoomProduct[] {
  const data = (JSON.parse(json) as { data?: Record<string, { tag_name?: string; products?: Array<Record<string, unknown>> }> }).data ?? {};
  const out: MaRoomProduct[] = [];
  for (const [tagId, tag] of Object.entries(data)) {
    if (tagId !== APARTMENT_TAG && !/apartment/i.test(String(tag.tag_name ?? ''))) continue;
    for (const p of tag.products ?? []) {
      const name = collapse(String(p.name ?? ''));
      if (Number(p.duration_net) !== 86400 || !(Number(p.price) > 0)) continue;
      const category = maCategoryOf(name);
      const guests = name.match(/(\d+)\s+Person(?:en)?(?:\s*\+\s*(\d+)\s+Kind)?/i);
      if (!category || !guests) continue;
      const adults = Number(guests[1]);
      const children = guests[2] ? Number(guests[2]) : 0;
      out.push({
        category,
        slug: `${category}-${adults}p${children ? `${children}c` : ''}`,
        unit: MA_UNITS[category],
        parentId: Number(p.p_id),
        adults,
        children,
        nightly: Number(p.price),
        currency: String(p.currency ?? 'EUR'),
      });
    }
  }
  return out.sort((a, b) => a.category.localeCompare(b.category) || (a.adults + a.children) - (b.adults + b.children) || a.children - b.children);
}

export type MaNightState = 'free' | 'taken' | 'booked_out' | 'unknown';

/** Night-level state of one month check (`notAvail` = taken nights, YYYY-MM-DD). */
export function parseMaNights(json: string, year: number, month: number): Array<{ date: string; state: MaNightState }> {
  const d = (JSON.parse(json) as { data?: Record<string, unknown> }).data ?? {};
  const err = typeof d.error === 'string' ? collapse(d.error) : null;
  const prefix = `${year}-${String(month).padStart(2, '0')}-`;
  const listed = (Array.isArray(d.notAvail) ? d.notAvail : []).filter((x): x is string => typeof x === 'string');
  const blocked = new Set(listed.filter(x => x.startsWith(prefix)));
  const out: Array<{ date: string; state: MaNightState }> = [];
  for (let day = 1; day <= daysIn(year, month); day++) {
    const date = iso(year, month, day);
    const state: MaNightState = d.bookedOut === true ? 'booked_out'
      : blocked.has(date) ? 'taken'
      // the window's last night touches the next month: an error explained by a taken night there leaves this month free
      : err && listed.length === 0 ? 'unknown'
      : 'free';
    out.push({ date, state });
  }
  return out;
}

/** Stay variation the engine prices for the month check (e.g. "... 7 nights", 910) -> nights + nightly rate. */
export function parseMaVariation(json: string): { nights: number; nightly: number } | null {
  const v = ((JSON.parse(json) as { data?: { variation?: { name?: unknown; price?: unknown } } }).data ?? {}).variation;
  const nights = typeof v?.name === 'string' ? Number(v.name.match(/(\d+)\s+nights?\b/i)?.[1]) : NaN;
  const price = Number(v?.price);
  return Number.isFinite(nights) && nights > 0 && price > 0 ? { nights, nightly: Math.round((price / nights) * 100) / 100 } : null;
}

function nightText(st: MaNightState, category: MaCategory): string {
  if (st === 'free') return 'free every night';
  if (st === 'booked_out') return 'booked out';
  if (st === 'unknown') return 'no availability answer';
  return UNITS_PER_CATEGORY[category] > 1
    ? `taken in the apartment the engine offers; the other ${UNITS_PER_CATEGORY[category] - 1 === 1 ? 'apartment' : 'apartments'} of this type may be free`
    : 'apartment taken';
}

/**
 * Bands by night state: one slot per apartment product and run of nights with the same engine
 * state, so a band ends where availability changes, not at a month end. Nights before `today`
 * are dropped.
 */
export function buildMaRunSlots(
  rooms: MaRoomProduct[],
  nights: Partial<Record<MaCategory, Array<{ date: string; state: MaNightState }>>>,
  today: string,
): Slot[] {
  const out: Slot[] = [];
  for (const r of rooms) {
    const list = (nights[r.category] ?? []).filter(n => n.date >= today).sort((x, y) => x.date.localeCompare(y.date));
    for (const run of runsOf(list, n => n.state)) {
      const st = run.first.state;
      const availability: Availability = st === 'free' ? 'available'
        : st === 'taken' ? (UNITS_PER_CATEGORY[r.category] > 1 ? 'limited' : 'sold_out')
        : st === 'booked_out' ? 'sold_out' : 'unknown';
      out.push({
        key: `${r.slug}|${run.start}`,
        startDate: run.start,
        endDate: run.end,
        unit: r.unit,
        price: r.nightly,
        currency: r.currency,
        priceUnit: 'per_night',
        priceBasis: 'room',
        occupancy: r.adults + r.children,
        availability,
        availabilityText: nightText(st, r.category) + (r.children ? `; ${r.adults} adults + ${r.children} child` : ''),
        spotsLeft: null,
      });
    }
  }
  return out;
}

// --- page parsers --------------------------------------------------------------------------------
export interface MaPageRoom { heading: string; category: MaCategory | null; guests: string | null; description: string; rates: Array<{ guests: string; price: number; productId: number | null }> }

/** Room blocks: <h3> + body text + "Guests | Price per night | Book" table. */
export function parseMaPageRooms(html: string): MaPageRoom[] {
  const out: MaPageRoom[] = [];
  for (const frame of parse(html).querySelectorAll('.frame-type-textpic')) {
    const table = frame.querySelector('table.contenttable');
    const h3 = frame.querySelector('h3');
    if (!table || !h3) continue;
    const heading = collapse(h3.text).replace(/"/g, '').trim();
    const body = frame.querySelector('.ce-bodytext');
    const p = body?.querySelector('p');
    const pText = p ? p.innerHTML.split(/<br\s*\/?>/i).map(x => collapse(parse(x).text)).filter(Boolean) : [];
    const guestsLine = pText.find(x => /guests?\)?$/i.test(x) && /\d/.test(x)) ?? null;
    const description = pText.filter(x => x !== guestsLine).join(' ').replace(/^:\s*/, '');
    const rates: MaPageRoom['rates'] = [];
    for (const tr of table.querySelectorAll('tr')) {
      const cells = tr.querySelectorAll('td');
      if (cells.length < 2) continue;
      const price = parseAmount(collapse(cells[1].text));
      if (!price || !/euro/i.test(cells[1].text)) continue;
      const href = tr.querySelector('a')?.getAttribute('href') ?? '';
      const id = href.match(/myleao\.com\/product\/(\d+)/)?.[1];
      rates.push({ guests: collapse(cells[0].text), price, productId: id ? Number(id) : null });
    }
    out.push({ heading, category: maCategoryOf(heading), guests: guestsLine?.replace(/[()]/g, '').trim() ?? null, description, rates });
  }
  return out;
}

/** "Prices are valid from February 1, 2026, through January 31, 2027" -> ISO dates. */
export function parseMaPriceValidity(html: string): { from: string; to: string } | null {
  const t = collapse(parse(html).text);
  const m = t.match(/Prices are valid from ([A-Z][a-z]+) (\d{1,2}), (20\d{2}),? (?:through|to|until) ([A-Z][a-z]+) (\d{1,2}), (20\d{2})/);
  if (!m) return null;
  const mo = (s: string) => new Date(`${s} 1, 2000`).getMonth() + 1;
  return { from: iso(+m[3], mo(m[1]), +m[2]), to: iso(+m[6], mo(m[4]), +m[5]) };
}

function pageText(html: string): string {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, header nav, footer, form')) el.remove();
  return collapse((root.querySelector('main') ?? root.querySelector('body') ?? root).text);
}

const IMG_JUNK = /logo|\.svg|Plan_|Kontakt|buchen|Team_|Wedding|googleusercontent|tripadvisor|tacdn/i;

export function parseMareAltaContent(html: string): OfferContent {
  const text = pageText(html);
  const rooms = parseMaPageRooms(html);
  const validity = parseMaPriceValidity(html);
  const discounts = text.match(/cheaper it gets:\s*(\d+% discount[\s\S]*?)\s*(?:General Cancellation|Breakfast included|$)/)?.[1]?.trim() ?? null;
  const transfers = [...text.matchAll(/(Airport transfer Fortaleza - Parajuru \([^)]*\))\s*(\d+)€/g)].map(m => `${m[1]}: EUR ${m[2]}`);
  const nRooms = text.match(/(\w+) rooms with private bathrooms/i)?.[1] ?? null;
  const season = text.match(/trade winds between (\w+) and (\w+)/i) ?? text.match(/Kite season from (\w+) to (\w+)/i);
  const languages = text.match(/The team speaks ([A-Za-z, ]+?) and (\w+)\./);
  const map = html.match(/maps\/embed\?pb=[^"']*?!2d(-?\d+\.\d+)!3d(-?\d+\.\d+)/);
  const all = rooms.flatMap(r => r.rates.map(x => x.price));
  const min = all.length ? Math.min(...all) : null;
  const max = all.length ? Math.max(...all) : null;

  const contentRooms: ContentRoom[] = rooms.filter(r => r.category).map(r => ({
    name: MA_UNITS[r.category!],
    description: r.description || null,
    features: [
      r.guests ? `${r.guests}` : null,
      ...r.rates.map(x => `${x.guests}: EUR ${x.price} per night (breakfast included)`),
      'Covered terrace with seating area and hammock',
      'Air conditioning, TV, refrigerator, electric kettle',
      r.category === 'sal-sicily-dakhla' ? 'Open-air bathroom with whirlpool tub' : 'Private open-air bathroom with hot-water shower',
      discounts ? `Long-stay discount: ${discounts}` : null,
    ].filter((x): x is string => !!x),
  }));

  const seen = new Set<string>();
  const imageUrls: string[] = [];
  for (const u of imageCandidates(html, MA_PAGE_URL, null, 80)) {
    if (!u.startsWith(`${SITE}/fileadmin/`) || IMG_JUNK.test(u)) continue;
    const k = u.split('/').pop()!.replace(/^(?:csm_)+/, '').replace(/_[0-9a-f]{10}(?=\.[a-z]+$)/i, '');
    if (seen.has(k)) continue;
    seen.add(k); imageUrls.push(u);
  }

  const summary = [
    `Pousada Maré Alta is a guesthouse with ${nRooms ? nRooms.toLowerCase() : 'eight'} ground-floor apartments on the grounds of KBC Parajuru, the Kiteboarding Club's kite and wingfoil center in Parajuru, Ceará, about 130 km east of Fortaleza; the kite spot is a two-minute walk from the rooms.`,
    `Each apartment has a covered terrace, air conditioning and a private open-air bathroom (three with a whirlpool tub), the breakfast buffet is included${min !== null ? `, and rates run from EUR ${min} to ${max} per apartment per night depending on apartment and guests` : ''}.`,
    `The spot has flat water behind a sandbar, a lagoon for learning and waves for advanced riders${season ? `, with trade winds from ${season[1]} to ${season[2]}` : ''}; pousada guests get free gear storage and service at the center, which offers courses and kite and wingfoil rental.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Pousada Maré Alta',
    summary,
    continent: 'South America',
    country: 'Brazil',
    region: 'Ceará',
    spot: 'Parajuru',
    // Google Maps embed on the page, pin "Kiteboarding Club Parajuru" (2026-10-12)
    spotCoords: map ? { lat: Number(map[2]), lng: Number(map[1]) } : null,
    itinerarySpots: [],
    durationDays: null,
    // spot text: "flat water behind the sandbar for beginners ... open waves for advanced riders" (2026-10-12)
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: /kite school|courses/i.test(text),
    equipmentRental: /for rental/i.test(text),
    beginnerFriendly: /for beginners/i.test(text),
    includedServices: ['Breakfast buffet', 'Free gear storage and equipment service at KBC Parajuru', 'Air conditioning', 'Wi-Fi', 'Daily housekeeping'],
    optionalServices: [
      'Kitesurf and wingfoil courses at KBC Parajuru (incl. kids and teens courses)',
      'Kite, board, wing and foil rental at KBC Parajuru',
      'Lunch and dinner at the Maré Alta restaurant (a la carte, weekly churrasco evening)',
      ...(transfers.length ? transfers : ['Airport transfer from Fortaleza']),
    ],
    accommodation: 'guesthouse apartments on the kite center grounds',
    mealPlan: 'breakfast',
    languages: languages ? [...languages[1].split(/,\s*/), languages[2]].filter(l => l.trim()).map(l => ({ Portuguese: 'pt', Polish: 'pl', English: 'en', German: 'de' } as Record<string, string>)[l.trim()] ?? l.trim().toLowerCase()) : [],
    rooms: contentRooms,
    imageUrls: imageUrls.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: MA_PAGE_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      `page: ${text.slice(0, 6000)}`,
      `rooms: ${rooms.map(r => `${r.heading} (${r.guests ?? '-'}): ${r.rates.map(x => `${x.guests} ${x.price} EUR [leao ${x.productId ?? '-'}]`).join(', ')}`).join(' | ')}`,
      `price validity: ${validity ? `${validity.from}..${validity.to}` : '-'}`,
      `map pin: ${map ? `${map[2]},${map[1]}` : '-'}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const pousadaMareAltaParajuru: OfferAdapter = {
  key: 'pousada-mare-alta-parajuru',
  name: 'Pousada Maré Alta Parajuru',
  kind: 'accommodation',
  operator: {
    name: 'Kiteboarding Club Parajuru',
    websiteUrl: SITE,
    rootDomain: 'kiteboarding-club.com',
    contactEmail: 'parajuru@KBC-World.com',
    whatsapp: '+5585996012006',
  },
  url: MA_PAGE_URL,
  // parent product ids per guest count (the page's Book links, checked 2026-10-12); the engine prices any stay length
  quote: {
    engine: 'leao',
    stationId: STATION,
    rooms: [
      { unit: MA_UNITS['tarifa-portugal'], resource: MA_RESOURCES['tarifa-portugal'], products: { '1': 13042, '2': 13085, '3': 13128 } },
      { unit: MA_UNITS['hindeloopen-brouwersdam'], resource: MA_RESOURCES['hindeloopen-brouwersdam'], products: { '1': 13300, '2': 13343 } },
      { unit: MA_UNITS['sal-sicily-dakhla'], resource: MA_RESOURCES['sal-sicily-dakhla'], products: { '1': 13704, '2': 13790, '3': 13876 } },
      { unit: MA_UNITS['el-gouna'], resource: MA_RESOURCES['el-gouna'], products: { '3': 14977, '4': 13458, '5': 13516, '6': 13574, '7': 13632 } },
    ],
  },
  slotMethod: 'booking_engine',
  fetchBudget: 27,
  async fetchContent() {
    return parseMareAltaContent(await fetchText(MA_PAGE_URL, { accept: 'text/html' }));
  },
  async fetchSlots(ctx) {
    const rooms = parseMaRoomProducts(await fetchText(MA_PRODUCTS_URL, { accept: 'application/json' }));
    if (rooms.length < 4) throw new Error(`pousada-mare-alta: only ${rooms.length} 1-night apartment products in the Leão station 4 feed`);
    // one availability parent per category: the 2-guest product, else the smallest
    const parents = new Map<MaCategory, number>();
    for (const r of rooms) {
      const cur = parents.get(r.category);
      if (cur === undefined || (r.adults === 2 && r.children === 0)) parents.set(r.category, r.parentId);
    }
    const nights: Partial<Record<MaCategory, Array<{ date: string; state: MaNightState }>>> = {};
    let failed = 0;
    for (const { year, month } of maMonths(todayIso())) {
      for (const [category, parentId] of parents) {
        try {
          const json = await fetchText(maAvailableUrl(parentId, MA_RESOURCES[category], year, month), { accept: 'application/json' });
          (nights[category] ??= []).push(...parseMaNights(json, year, month));
          // stays up to 14 nights carry no long-stay discount: a different nightly rate there = a season price change
          const v = parseMaVariation(json);
          const base = rooms.find(r => r.parentId === parentId)?.nightly;
          if (v && v.nights <= 14 && base && Math.abs(v.nightly - base) / base > 0.01) ctx.note(`${category} ${year}-${month}: engine prices a ${v.nights}-night stay at ${v.nightly}/night vs 1-night product ${base}`);
        } catch (e) {
          failed++;
          ctx.note(`availability ${category} ${year}-${month}: ${(e as Error).message}`);
        }
      }
    }
    if (failed > 0) ctx.incomplete(`${failed} month checks failed`);
    // a wrong resource id answers bookedOut for every month: refuse instead of reporting "sold out"
    for (const category of parents.keys()) {
      const list = nights[category] ?? [];
      if (list.length >= 60 && list.every(n => n.state === 'booked_out')) {
        throw new Error(`pousada-mare-alta: resource ${MA_RESOURCES[category]} (${category}) is booked out in every month - resource id probably changed`);
      }
    }
    return buildMaRunSlots(rooms, nights, todayIso());
  },
};
