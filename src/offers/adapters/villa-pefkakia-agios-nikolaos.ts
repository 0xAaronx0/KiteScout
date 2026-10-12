// ---------------------------------------------------------------------------
// Villa Pefkakia, Agios Nikolaos (opposite Lefkada, Greece) - small family-run guesthouse for kitesurfers
// above the lagoon of Agios Nikolaos, about 2 minutes from the kite spot; four rooms, private pool,
// minimum stay 5 nights. Not a kite school: it hosts riders who kite on their own.
//
// Data path (checked 2026-10-12): Wix site, server-rendered text in <p>/<h*> blocks.
//   slots    /rooms - one sentence "Rates start from 88 € per night for two guests, green tax included."
//            + "Minimum stay 5 nights"; no season dates, no year, no inventory.
//   content  /rooms (room list "*Double room | 2 people | ...", rules), /the-kite-house (house text +
//            gallery), /kitespotlefkada (wind, lagoon), /booking-request (address, e-mail, WhatsApp).
//            Map pin = the site's own Wix business location ("businessLocationCoordinates" in the page
//            config: 38.8767, 20.7954, "Villa Pefkakia, Agios Nikolaos").
// Booking: request form only (Wix Hotels / Bookings apps are installed but no room-booking page is
//   published; the pages sitemap, lastmod 2026-07-05, lists none) -> 'on_request'.
// 2026 signal: "© 2026 Villa Pefkakia" on /rooms, gallery photos created 2026-03; no 2027 dates.
// robots.txt (2026-10-12): "Allow: /", only "*?lightbox=" disallowed.
// Requests per run: content 4, slots 1.
// Parsed: 1 slot = the published "from" rate (EUR per room per night, 2 guests, minNights 5), no dates.
// Known limits: the rate is a "from" price for an unnamed room; other rooms / seasons only on request.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, detectCurrency, imageCandidates, parse, parseAmount } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.kitesurfagiosnikolaos.com';
export const VP_ROOMS_URL = `${SITE}/rooms`;
const HOUSE_URL = `${SITE}/the-kite-house`;
const SPOT_URL = `${SITE}/kitespotlefkada`;
const BOOKING_URL = `${SITE}/booking-request`;

export interface VpRate { amount: number; currency: string; guests: number; minNights: number | null; text: string }

/** Visible text blocks (Wix rich text) in document order, deduplicated (mobile/desktop copies). */
function blocks(html: string): string[] {
  const out: string[] = [];
  for (const el of parse(html).querySelectorAll('p, h1, h2, h3, h4, li')) {
    const t = collapse(el.text.replace(/\u200b/g, ''));
    if (t && out[out.length - 1] !== t) out.push(t);
  }
  return out;
}

/** "Rates start from 88 € per night for two guests, green tax included." + "Minimum stay 5 nights". */
export function parseVpRate(html: string): VpRate | null {
  const bs = blocks(html);
  const line = bs.find(b => /rates? (?:start )?from .*per night/i.test(b));
  if (!line) return null;
  const amount = parseAmount(line.replace(/^.*?from/i, ''));
  if (!amount) return null;
  const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4 };
  const g = line.match(/for (\d+|one|two|three|four) (?:guests?|persons?|people)/i)?.[1];
  const guests = g ? (words[g.toLowerCase()] ?? Number(g)) : 2;
  const min = bs.join('\n').match(/minimum stay (\d+) nights?/i)?.[1];
  return { amount, currency: detectCurrency(line) ?? 'EUR', guests, minNights: min ? Number(min) : null, text: line };
}

export function buildVpSlots(rate: VpRate): Slot[] {
  return [{
    key: `room-${rate.guests}p-from`,
    startDate: null,
    endDate: null,
    unit: null,
    price: rate.amount,
    currency: rate.currency,
    priceUnit: 'per_night',
    priceBasis: 'room',
    occupancy: rate.guests,
    availability: 'on_request',
    availabilityText: rate.text,
    spotsLeft: null,
    minNights: rate.minNights,
  }];
}

/** Room list lines "*Double room | 2 people | 2 single beds". */
export function parseVpRooms(html: string): ContentRoom[] {
  const lines = blocks(html).filter(b => /^\*\s*\S/.test(b) && b.includes('|'));
  const parts = lines.map(l => l.replace(/^\*\s*/, '').split('|').map(s => s.trim()).filter(Boolean));
  const names = parts.map(p => p[0]);
  return parts.map(p => {
    const dup = names.filter(n => n === p[0]).length > 1;
    return {
      name: dup && p[2] ? `${p[0]}, ${p[2]}` : p[0],
      description: p.slice(1).join(', '),
      features: p.slice(1),
    };
  });
}

/** The site's own Wix business location (site settings), used as the map pin. */
export function parseVpCoords(html: string): { lat: number; lng: number } | null {
  const m = html.match(/"businessLocationCoordinates"\s*:\s*\{\s*"latitude"\s*:\s*(-?[\d.]+)\s*,\s*"longitude"\s*:\s*(-?[\d.]+)/);
  if (!m) return null;
  return { lat: Math.round(Number(m[1]) * 1e5) / 1e5, lng: Math.round(Number(m[2]) * 1e5) / 1e5 };
}

/** Original Wix media URLs (no /v1/ transforms), logo excluded, deduplicated by media id. */
export function vpImages(pages: Array<[string, string]>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const [html, base] of pages) {
    const logo = html.match(/"businessLogo"\s*:\s*"[^"]*media\\?\/([^"\\]+)"/)?.[1] ?? null;
    for (const u of imageCandidates(html, base, null, 80)) {
      const m = u.match(/^https:\/\/static\.wixstatic\.com\/media\/([^/?#]+)/);
      if (!m) continue;
      const id = decodeURIComponent(m[1]);
      if (seen.has(id) || (logo && id === logo) || /logo|\.svg|\.png$/i.test(id)) continue;
      seen.add(id);
      out.push(`https://static.wixstatic.com/media/${m[1]}`);
    }
  }
  return out;
}

/** Blocks from the first one matching `start` up to the footer ("Follow Us:"). */
function section(bs: string[], start: RegExp): string[] {
  const i = bs.findIndex(b => start.test(b));
  if (i < 0) return [];
  const rest = bs.slice(i);
  const end = rest.findIndex(b => /^Follow Us:?$/i.test(b));
  return end < 0 ? rest : rest.slice(0, end);
}

export interface VpPages { rooms: string; house: string; spot: string; booking: string }

export function parseVillaPefkakiaContent(p: VpPages): OfferContent {
  const rooms = blocks(p.rooms);
  const house = blocks(p.house);
  const spot = blocks(p.spot);
  const booking = blocks(p.booking);
  const rate = parseVpRate(p.rooms);
  const contentRooms = parseVpRooms(p.rooms);
  const wind = spot.find(b => /^Wind:/i.test(b)) ?? null;
  const months = spot.find(b => /^Best months:/i.test(b))?.replace(/^Best months:\s*/i, '') ?? null;

  const summary = [
    `Villa Pefkakia is a small family-run guesthouse for kitesurfers on the hill above the lagoon of Agios Nikolaos near Lefkada, Greece, about 2 minutes from the kite spot.`,
    `It has ${contentRooms.length || 4} rooms (double, triple and family rooms), a private pool for guests, a terrace and a garden; the minimum stay is ${rate?.minNights ?? 5} nights${rate ? ` and rates start from EUR ${rate.amount} per night for ${rate.guests} guests, green tax included` : ''}.`,
    `The lagoon has shallow flat water and a thermal afternoon wind${wind ? ` (${wind.replace(/^Wind:\s*/i, '').replace(/–/g, '-')})` : ''}${months ? `, best ${months.replace(/ to /i, '-')}` : ''}.`,
    'The house is not a kite school: it welcomes riders with some experience who kite on their own.',
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Villa Pefkakia',
    summary,
    continent: 'Europe',
    country: 'Greece',
    region: 'Aetolia-Acarnania',
    spot: 'Agios Nikolaos, Lefkada',
    spotCoords: parseVpCoords(p.rooms) ?? parseVpCoords(p.house),
    itinerarySpots: [],
    durationDays: null,
    // /rooms: "We welcome kitesurfers who already have some experience" (2026-10-12)
    skillLevels: ['intermediate', 'advanced'],
    kiteLessons: /not a kite school|no kite lessons/i.test([...rooms, ...booking].join(' ')) ? false : null,
    equipmentRental: null,
    beginnerFriendly: false,
    includedServices: [
      ...(rate && /green tax included/i.test(rate.text) ? ['Green tax (included in the rate)'] : []),
      'Private pool for guests',
      'Terrace and garden with a view over the lagoon',
    ],
    optionalServices: [],
    accommodation: 'family-run guesthouse rooms',
    mealPlan: null,
    languages: ['en'],
    rooms: contentRooms,
    imageUrls: vpImages([[p.house, HOUSE_URL], [p.rooms, VP_ROOMS_URL], [p.spot, SPOT_URL]]).slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: VP_ROOMS_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      `rooms: ${section(rooms, /^Our Accommodation$/i).filter(b => !/[\u0370-\u03ff]/.test(b)).join(' | ')}`,
      `kite house: ${section(house, /^Villa Pefkakia The kite house$/i).join(' | ')}`,
      `kite spot: ${section(spot, /^Kitesurf in Lefkada/i).join(' | ')}`,
      `booking: ${section(booking, /^BOOKING REQUEST$/).join(' | ')}`,
    ].join('\n'),
  };
}

export const villaPefkakiaAgiosNikolaos: OfferAdapter = {
  key: 'villa-pefkakia-agios-nikolaos',
  name: 'Villa Pefkakia Agios Nikolaos',
  kind: 'accommodation',
  operator: {
    name: 'Villa Pefkakia',
    websiteUrl: SITE,
    rootDomain: 'kitesurfagiosnikolaos.com',
    contactEmail: 'info@kitesurfagiosnikolaos.com',
    whatsapp: '+306992260973',
    phone: '+306992260973',
  },
  url: `${SITE}/`,
  slotMethod: 'price_table',
  fetchBudget: 5,
  confidence: 'medium',
  async fetchContent() {
    const [rooms, house, spot, booking] = [
      await fetchText(VP_ROOMS_URL, { accept: 'text/html' }),
      await fetchText(HOUSE_URL, { accept: 'text/html' }),
      await fetchText(SPOT_URL, { accept: 'text/html' }),
      await fetchText(BOOKING_URL, { accept: 'text/html' }),
    ];
    return parseVillaPefkakiaContent({ rooms, house, spot, booking });
  },
  async fetchSlots() {
    const rate = parseVpRate(await fetchText(VP_ROOMS_URL, { accept: 'text/html' }));
    if (!rate) throw new Error('villa-pefkakia: "Rates start from ... per night" not found on /rooms (layout or wording changed?)');
    return buildVpSlots(rate);
  },
};
