// ---------------------------------------------------------------------------
// Hotel Orkos Beach, Mikri Vigla (Naxos, Greece) - hotel about 50 m from the beach that houses the Flisvos
// Kite Centre (reception, kite café and shop in its northern building); rooms, studios and suites with
// breakfast, season 20 May to 1 October.
//
// Data path (checked 2026-10-12): WordPress/Elementor site of the kite centre.
//   slots    /accommodation/ - "room price list": UAEL table (<table id="uael-table-id-...">), header =
//            three season columns of date ranges without a year ("20.05 – 16.06 / 16.09 – 01.10",
//            "16.06 – 08.07 / 28.08 – 16.09", "08.07 – 28.08"), one row per room type
//            ("Twin / Bath, fridge, balcony (max 2 guests)", "€68" ...), EUR per room per night,
//            breakfast and taxes included ("Rate Information"). The year comes from the price-list PDF
//            linked on the same page (".../uploads/2026/02/prices-Kite-Hotel-2026.pdf").
//   content  /accommodation/ (hotel text, policies, room gallery) + /naxos-kite-center/ (station,
//            courses, RRD rental). Map pin = the site's own Google Maps place link
//            (".../place/Flisvos+Kitecentre/@...!3d37.0281122!4d25.3728393").
// Booking: /book-now/ is a quote request form ("Get your personal quote") -> 'on_request'.
// robots.txt (2026-10-12): only /wp-admin/ disallowed.
// Requests per run: content 2, slots 1.
// Parsed: slot = room type x season date range ("twin|2026-05-20"), EUR per room per night,
//   occupancy = the row's "max N guests". The printed ranges share their boundary days (16.06, 08.07,
//   28.08, 16.09), so they are read as arrival/departure days: a band's last night is the day before
//   its printed end (inferred; e.g. 20.05 – 16.06 -> nights 2026-05-20..2026-06-15).
// Known limits: the 2026 list ended 2026-10-01, so on 2026-10-12 every band is in the past; the offer
//   shows "price on request" until the site publishes a 2027 list (the year moves with the PDF link).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, imageCandidates, iso, parse, parseAmount, type HTMLElement } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.flisvos-kitecentre.com';
export const ORKOS_ACCOMMODATION_URL = `${SITE}/accommodation/`;
const KITE_URL = `${SITE}/naxos-kite-center/`;
const BOOKING_URL = `${SITE}/book-now/`;

export interface OrkosBand { column: number; start: string; end: string; printed: string }
export interface OrkosRoom { name: string; features: string[]; maxGuests: number | null; prices: Array<number | null> }

const keyPart = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const text = (el: HTMLElement): string => collapse(el.text);
const lines = (el: HTMLElement): string[] => el.text.split(/\n/).map(collapse).filter(Boolean);
const dayBefore = (d: string): string => new Date(Date.parse(`${d}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);

/** Year of the published price list: the linked PDF ("prices-Kite-Hotel-2026.pdf"). */
export function orkosPriceYear(html: string): number | null {
  const m = html.match(/prices?[^"'\s<>]*?(20\d{2})[^"'\s<>]*?\.pdf/i);
  return m ? Number(m[1]) : null;
}

function priceTable(html: string): HTMLElement | null {
  return parse(html).querySelectorAll('table').find(t => /max \d+ guests/i.test(t.text) && /€\s?\d/.test(t.text)) ?? null;
}

/** Season columns: each header cell holds one or two "dd.mm – dd.mm" ranges (no year). */
export function parseOrkosBands(html: string, year: number): OrkosBand[] {
  const table = priceTable(html);
  if (!table) return [];
  const ths = table.querySelectorAll('thead th').slice(1);
  const out: OrkosBand[] = [];
  ths.forEach((th, column) => {
    for (const m of th.text.matchAll(/(\d{1,2})\.(\d{1,2})\.?\s*[–—-]\s*(\d{1,2})\.(\d{1,2})/g)) {
      const start = iso(year, +m[2], +m[1]);
      const endPrinted = iso(+m[4] < +m[2] ? year + 1 : year, +m[4], +m[3]);
      out.push({ column, start, end: dayBefore(endPrinted), printed: collapse(m[0]) });
    }
  });
  return out.sort((a, b) => (a.start < b.start ? -1 : 1));
}

/** Room rows: name (first line or text before " - "), features, "max N guests", one price per season column. */
export function parseOrkosRooms(html: string): OrkosRoom[] {
  const table = priceTable(html);
  if (!table) return [];
  return table.querySelectorAll('tbody tr').map(tr => {
    const tds = tr.querySelectorAll('td');
    if (tds.length < 2) return null;
    const ls = lines(tds[0]);
    let name = ls[0] ?? '';
    let rest = ls.slice(1).join(', ');
    if (ls.length === 1 && / - /.test(name)) [name, rest] = [name.split(' - ')[0], name.split(' - ').slice(1).join(' - ')];
    const maxGuests = Number(rest.match(/max (\d+) guests/i)?.[1]) || null;
    const features = rest.replace(/\(max \d+ guests\)/i, '').split(/\s*,\s*/).map(s => s.trim()).filter(Boolean)
      .map(s => s.charAt(0).toUpperCase() + s.slice(1));
    return { name: name.trim(), features, maxGuests, prices: tds.slice(1).map(td => parseAmount(text(td))) };
  }).filter((r): r is OrkosRoom => !!r && !!r.name && r.prices.some(p => p !== null));
}

export function buildOrkosSlots(rooms: OrkosRoom[], bands: OrkosBand[]): Slot[] {
  const out: Slot[] = [];
  for (const b of bands) {
    for (const r of rooms) {
      const price = r.prices[b.column] ?? null;
      if (price === null) continue;
      out.push({
        key: `${keyPart(r.name)}|${b.start}`,
        startDate: b.start,
        endDate: b.end,
        unit: r.name,
        price,
        currency: 'EUR',
        priceUnit: 'per_night',
        priceBasis: 'room',
        occupancy: r.maxGuests,
        availability: 'on_request',
        availabilityText: null,
        spotsLeft: null,
      });
    }
  }
  return out;
}

/** Cloudflare-obfuscated e-mail (data-cfemail hex, XOR with the first byte). */
export function decodeCfEmail(hex: string): string {
  const k = parseInt(hex.slice(0, 2), 16);
  let s = '';
  for (let i = 2; i < hex.length; i += 2) s += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ k);
  return s;
}

/** Map pin from the site's own Google Maps place link (!3d<lat>!4d<lng>). */
export function orkosCoords(html: string): { lat: number; lng: number } | null {
  const m = html.match(/google\.[a-z.]+\/maps\/place\/Flisvos[^"'\s]*?!3d(-?[\d.]+)!4d(-?[\d.]+)/i);
  return m ? { lat: Math.round(Number(m[1]) * 1e5) / 1e5, lng: Math.round(Number(m[2]) * 1e5) / 1e5 } : null;
}

function blocks(html: string): string[] {
  const out: string[] = [];
  for (const el of parse(html).querySelectorAll('.elementor-widget-container p, .elementor-widget-container h1, .elementor-widget-container h2, .elementor-widget-container h3, .elementor-widget-container li, .elementor-tab-content p')) {
    const t = text(el);
    if (t && out[out.length - 1] !== t) out.push(t);
  }
  return out;
}

export interface OrkosPages { accommodation: string; kite: string }

export function parseOrkosContent(p: OrkosPages): OfferContent {
  const acc = blocks(p.accommodation);
  const kite = blocks(p.kite);
  const year = orkosPriceYear(p.accommodation);
  const rooms = parseOrkosRooms(p.accommodation);
  const bands = year ? parseOrkosBands(p.accommodation, year) : [];
  const accText = collapse(parse(p.accommodation).text);
  const pick = (re: RegExp): string | null => accText.match(re)?.[0]?.trim() ?? null;
  const hotel = acc.find(b => /situated in the bay of Mikri Vigla/i.test(b)) ?? '';
  const built = acc.find(b => /newly built hotel/i.test(b)) ?? '';
  const course = kite.find(b => /basic kitesurf course/i.test(b)) ?? '';
  const all = rooms.flatMap(r => r.prices).filter((x): x is number => x !== null);
  const seasonStart = bands[0]?.start ?? null;
  const lastPrinted = bands.length ? [...bands].sort((a, b) => (a.end < b.end ? 1 : -1))[0] : null;
  const policy = [
    pick(/Check-in time:\s*[\d:]+\s*[AP]M/i), pick(/Check-out time:\s*[\d:]+\s*[AP]M/i),
    pick(/Kids up to \d+ years old free of charge[^.]*\./i), pick(/Baby cot in room free of charge/i),
    pick(/Breakfast time:\s*[\d\s–-]+am/i), pick(/30% of the total amount of the reservation needed\./i),
    pick(/In case of cancellation 30 days before arrival[^.]*\./i),
  ].filter((x): x is string => !!x);

  const contentRooms: ContentRoom[] = rooms.map(r => ({
    name: r.name,
    description: r.maxGuests ? `Up to ${r.maxGuests} guests.` : null,
    features: [
      ...r.features,
      ...r.prices.map((x, i) => {
        const cols = bands.filter(b => b.column === i).map(b => b.printed).join(' / ');
        return x !== null && cols ? `${cols}${year ? ` ${year}` : ''}: EUR ${x} per room per night (breakfast included)` : null;
      }).filter((x): x is string => !!x),
    ],
  }));

  const seen = new Set<string>();
  const imageUrls: string[] = [];
  for (const [html, base] of [[p.accommodation, ORKOS_ACCOMMODATION_URL], [p.kite, KITE_URL]] as const) {
    for (const u of imageCandidates(html, base, null, 60)) {
      if (!/\/wp-content\/uploads\//.test(u) || /logo|icon|\.svg|\.png$/i.test(u)) continue;
      const k = u.replace(/-(?:\d+x\d+|scaled)(?=\.[a-z]+$)/i, '');
      if (seen.has(k)) continue;
      seen.add(k); imageUrls.push(u);
    }
  }

  const summary = [
    `Hotel Orkos Beach is a hotel in the bay of Mikri Vigla on Naxos, Greece, about 50 m from the beach and 10 km south of Naxos town, set in a garden with a pool; the reception of the Flisvos Kite Centre, its kite café and a small shop are in the hotel's northern building.`,
    `It has double rooms, studios for 2-3 people and apartments for up to 4 people with shower, air conditioning and TV (studios with a kitchenette), most with sea-view terraces, and rates include a Greek breakfast and taxes${all.length ? ` (EUR ${Math.min(...all)}-${Math.max(...all)} per room per night by room and season` : ''}${all.length && seasonStart && lastPrinted ? `, ${year} season from ${seasonStart.slice(8, 10)}.${seasonStart.slice(5, 7)}. to ${lastPrinted.printed.split(/[–—-]/).pop()!.trim()}.)` : all.length ? ')' : ''}.`,
    `The kite centre runs IKO courses (the basic course is 10 hours with at most 2 students per instructor) and rents RRD equipment.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Hotel Orkos Beach',
    summary,
    continent: 'Europe',
    country: 'Greece',
    region: 'Cyclades',
    spot: 'Mikri Vigla, Naxos',
    spotCoords: orkosCoords(p.accommodation) ?? orkosCoords(p.kite),
    itinerarySpots: [],
    durationDays: null,
    // kite centre page: "Beginner, Intermediate, Advanced rider? We've got the best training spot" (2026-10-12)
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: /kitesurf course|beginner course/i.test(kite.join(' ')),
    equipmentRental: /rentals?\b/i.test(kite.join(' ')),
    beginnerFriendly: /beginner course/i.test(kite.join(' ')),
    includedServices: ['Greek breakfast with organic and local products', 'All applicable taxes', 'Swimming pool', 'Baby cot (free)'],
    optionalServices: ['IKO kitesurf courses (Flisvos Kite Centre)', 'Kite equipment rental (RRD)', 'Restaurant and beach bar', 'Kite shop'],
    accommodation: 'hotel rooms, studios and suites',
    mealPlan: 'breakfast',
    languages: ['en', 'de', 'fr', 'it'],
    rooms: contentRooms,
    imageUrls: imageUrls.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: ORKOS_ACCOMMODATION_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      `hotel: ${hotel} ${built}`.trim(),
      `kite centre in the hotel: ${acc.find(b => /reception of the Kite centre/i.test(b)) ?? ''}`,
      `policy: ${policy.join(' | ')}`,
      `price list ${year ?? '?'}: ${bands.map(b => `col${b.column + 1} ${b.printed} (${b.start}..${b.end})`).join('; ')} | ${rooms.map(r => `${r.name} (max ${r.maxGuests ?? '?'}): ${r.prices.join('/')}`).join('; ')}`,
      `kite centre: ${kite.slice(0, 25).join(' | ')}`,
      `course: ${course}`,
    ].join('\n'),
  };
}

export const hotelOrkosBeachMikriVigla: OfferAdapter = {
  key: 'hotel-orkos-beach-mikri-vigla',
  name: 'Hotel Orkos Beach (Flisvos Kite Centre) Naxos',
  kind: 'accommodation',
  operator: {
    name: 'Flisvos Kite Centre',
    websiteUrl: SITE,
    rootDomain: 'flisvos-kitecentre.com',
    contactEmail: 'michele@flisvos-kitecentre.com',
    whatsapp: '+306945457407',
    phone: '+302285075490',
  },
  url: ORKOS_ACCOMMODATION_URL,
  slotMethod: 'price_table',
  fetchBudget: 3,
  async fetchContent() {
    const accommodation = await fetchText(ORKOS_ACCOMMODATION_URL, { accept: 'text/html' });
    const kite = await fetchText(KITE_URL, { accept: 'text/html' });
    return parseOrkosContent({ accommodation, kite });
  },
  async fetchSlots(ctx) {
    const html = await fetchText(ORKOS_ACCOMMODATION_URL, { accept: 'text/html' });
    const year = orkosPriceYear(html);
    if (!year) throw new Error('hotel-orkos-beach: price-list year not found (linked "prices-...-YYYY.pdf")');
    const rooms = parseOrkosRooms(html);
    const bands = parseOrkosBands(html, year);
    if (rooms.length < 4 || bands.length < 3) throw new Error(`hotel-orkos-beach: room price table not found or changed (${rooms.length} rooms, ${bands.length} season ranges)`);
    const slots = buildOrkosSlots(rooms, bands);
    if (slots.every(s => s.endDate! < new Date().toISOString().slice(0, 10))) ctx.note(`price list ${year} has expired; waiting for the next season's list`);
    return slots;
  },
};
