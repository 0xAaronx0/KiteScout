// ---------------------------------------------------------------------------
// Nitinaht Windsurf Park, Nitinat Lake (Vancouver Island, British Columbia, Canada) - the Ditidaht Nation's lodging
// at Canada's best-known kite and windsurf lake: the six Caycuse Cabins in the forest of the Windsurf Park campground
// ("kiteboarders" named as a target group), the basic campsites on the kite beach (Caycuse Recreation Site
// Campground) and the Nitinaht Lake Motel in Nitinaht village, which guests pass on the road to the park. One
// listing for the park's lodging; rooms = cabin (no pets) / pet friendly cabin / motel room types / basic campsite,
// as the site prints them.
//
// Data path (checked 2026-10-23): WordPress + Divi (visitnitinaht.com, entry domain nitinahtcampground.com redirects
// there), server-rendered, behind Cloudflare (pages served normally to our UA).
//   slots    /book-your-cabin/ "$220/per night for a no pet cabin; $245/night for a pet friendly cabin", "Minimum 2 night
//            stay", "open year-round", "prices are based on double occupancy", "Maximum 4 persons per cabin".
//            /book-your-room/ "$120/night: Rooms 1 - 5. Room has a single queen sized bed ..." and "$150/night: Rooms
//            6 - 9. Rooms are 2 bedroom with kitchenettes ...", "Rooms 1 - 5: maximum 2 people", "Room 7: maximum 4
//            people", "open year-round. Minimum 1 night stay".
//            /book-your-site/ "Caycuse Recreation Site Campground open April 27 - October 4, 2026", "Basic Campsite ...
//            $35 plus $5 online booking fee plus GST", "Prices are based on two (2) Adults per site", extra adults $10.
//            -> cabins and motel rooms: undated slots (year-round), CAD per cabin / room per night (priceUnit
//            'per_night', priceBasis 'room'), availability 'unknown'. Campsite: one dated band = the printed season,
//            CAD 35 per site per night for 2 adults (the $5 online fee per booking and GST in the slot text), dropped
//            once the season has ended: on 2026-10-23 the 2026 season (to Oct 4) is past and no 2027 dates are
//            printed, so the campsite has no slot until the page names the next season; its past band is the last
//            published price (2026-10-31), so the campsite keeps its from-price.
//   content  the three booking pages + /things-to-do/ ("ride the legendary winds of Nitinaht Lake", "Windriders don't
//            call this place Mecca for nothing", the kite-beach photo).
// Currency: the pages print only "$"; CAD is inferred (Canadian operator, Canadian GST on the campsite page).
// Booking engine: Checkfront (nitinaht-campground.checkfront.com, DROPLET widget on each booking page, category 4).
//   Its robots.txt answered our honest UA with a Cloudflare "Sorry, you have been blocked" page (2026-10-23) ->
//   BLOCKED, never retried or bypassed; no live availability (liveAvailability unset), prices from the static pages.
//   instantBooking true: the own pages say "Booking Online only. Payment is by Debit/Credit card", "Full Payment is
//   required for all dates booked" and embed the Checkfront checkout (immediate confirmation inferred from that
//   prepaid online checkout; we cannot open the engine to confirm).
// Fire banner (checked 2026-10-23): "Due to the local fires burning near China Creek, Port Alberni ... we are unable to
//   accept bookings until further notice" sits as a content block on four older info pages only (/things-to-do/
//   modified 2024-06-05, /faqs/ 2025-04-09, /announcements/ 2022-04-08, /getting-here/ 2021-02-23), NOT on the three
//   booking pages (modified 2026-01-07, 2026-04-27, 2026-06-06), which carry the 2026 season. Inferred stale. If it
//   ever appears on a booking page, that page's slots become 'closed' with the banner text (ctx note).
// robots.txt visitnitinaht.com (2026-10-23): Yoast "User-agent: * / Disallow:" (allow all).
// Requests per run: content 4, slots 3 (the booking pages, memoised for 10 minutes).
// Known limits: the motel 2-bedroom rooms sleep 3 or 4 depending on the room (occupancy null, features say so); the
//   campsite GST amount is not printed; no seasonal pricing exists on the pages. The kite school on the beach
//   (Elevation Kite and Wing Center, its own listing elevation-nitinat-lake-kite-wing-camps) is a separate operator.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, iso, monthOf, parse, todayIso, type HTMLElement } from '../parse.js';
import type { Availability, ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://visitnitinaht.com';
export const NW_CABIN_URL = `${SITE}/book-your-cabin/`;
export const NW_MOTEL_URL = `${SITE}/book-your-room/`;
export const NW_CAMPSITE_URL = `${SITE}/book-your-site/`;
export const NW_THINGS_URL = `${SITE}/things-to-do/`;
const CURRENCY = 'CAD'; // inferred: the pages print "$" only (see header)

// --- local helpers ----------------------------------------------------------------
const memo = new Map<string, { at: number; p: Promise<string> }>();
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}
const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const dashes = (s: string): string => s.replace(/[–—]/g, '-');

/** Main content as lines (Divi #main-content), script/style/template bodies dropped, dashes normalised. */
export function nwLines(html: string): string[] {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, template, svg')) el.remove();
  const main: HTMLElement = root.querySelector('#main-content') ?? root.querySelector('main') ?? root;
  return main.structuredText.split('\n').map(l => dashes(collapse(l))).filter(Boolean);
}

/** The "unable to accept bookings" banner when the page shows it. */
export function nwBookingBanner(html: string): string | null {
  return nwLines(html).find(l => /unable to accept bookings/i.test(l)) ?? null;
}

// --- pure parsers -----------------------------------------------------------------
export interface NwUnit {
  /** stable key part */
  id: string;
  /** room / unit name as shown in the app */
  name: string;
  price: number;
  occupancy: number | null;
  minNights: number | null;
  features: string[];
}

export interface NwCabins { units: NwUnit[]; minNights: number | null; maxPersons: number | null; yearRound: boolean; description: string | null }

/** /book-your-cabin/: "$220/per night for a no pet cabin; $245/night for a pet friendly cabin". */
export function parseNwCabins(html: string): NwCabins {
  const lines = nwLines(html);
  const t = lines.join('\n');
  const minNights = Number(t.match(/Minimum\s+(\d+)\s+night stay/i)?.[1] ?? NaN) || null;
  const maxPersons = Number(t.match(/Maximum\s+(\d+)\s+persons? per cabin/i)?.[1] ?? NaN) || null;
  const double = /based on double occupancy/i.test(t);
  const description = lines.find(l => /cozy .*cabins? each included with/i.test(l)) ?? null;
  const units: NwUnit[] = [];
  for (const m of t.matchAll(/\$\s?([\d,]+)\s*\/\s*(?:per\s+)?night\s+for\s+an?\s+([^;.\n$]*?cabin)/gi)) {
    const kind = collapse(m[2]);
    const pets = /pet friendly/i.test(kind);
    units.push({
      id: pets ? 'cabin-pet-friendly' : /no pet/i.test(kind) ? 'cabin-no-pets' : `cabin-${slug(kind)}`,
      name: pets ? 'Caycuse Cabin, pet friendly' : /no pet/i.test(kind) ? 'Caycuse Cabin, no pets' : `Caycuse Cabin, ${kind}`,
      price: Number(m[1].replace(/,/g, '')),
      occupancy: double ? 2 : null,
      minNights,
      features: [
        `${kind} as printed`,
        '1 bedroom, kitchenette, pull-out couch, bathroom with shower, wrap-around deck with BBQ and propane fire ring',
        ...(double ? ['price based on double occupancy; 2 more family members can share the hide-a-bed'] : []),
        ...(maxPersons ? [`maximum ${maxPersons} persons per cabin`] : []),
        ...(minNights ? [`minimum ${minNights} night stay`] : []),
      ],
    });
  }
  return { units, minNights, maxPersons, yearRound: /open year-round/i.test(t), description };
}

export interface NwMotel { units: NwUnit[]; minNights: number | null; yearRound: boolean }

/** /book-your-room/: "$120/night: Rooms 1 - 5. Room has ..." + "Rooms 1 - 5: maximum 2 people", "Room 7: maximum 4 people". */
export function parseNwMotel(html: string): NwMotel {
  const lines = nwLines(html);
  const t = lines.join('\n');
  const maxByRoom = new Map<number, number>();
  for (const m of t.matchAll(/Rooms?\s+(\d+)(?:\s*-\s*(\d+))?\s*:\s*maxi\w*\s+(\d+)\s+people/gi)) {
    for (let r = Number(m[1]); r <= Number(m[2] ?? m[1]); r++) maxByRoom.set(r, Number(m[3]));
  }
  const minNights = Number(t.match(/Minimum\s+(\d+)\s+night stay/i)?.[1] ?? NaN) || null;
  const units: NwUnit[] = [];
  for (const l of lines) {
    const m = l.match(/^\$\s?([\d,]+)\s*\/\s*night\s*:\s*Rooms?\s+(\d+)(?:\s*-\s*(\d+))?\.?\s*(.*)$/i);
    if (!m) continue;
    const from = Number(m[2]);
    const to = Number(m[3] ?? m[2]);
    const desc = m[4].trim();
    const maxima = [...new Set(Array.from({ length: to - from + 1 }, (_, i) => maxByRoom.get(from + i)).filter((x): x is number => x !== undefined))].sort();
    const label = /2 bedroom/i.test(desc) ? '2-bedroom room with kitchenette' : /queen/i.test(desc) ? 'queen room' : 'room';
    const rooms = from === to ? `room ${from}` : `rooms ${from}-${to}`;
    units.push({
      id: `motel-rooms-${from}-${to}`,
      name: `Nitinaht Lake Motel, ${label} (${rooms})`,
      price: Number(m[1].replace(/,/g, '')),
      occupancy: maxima.length === 1 ? maxima[0] : null,
      minNights,
      features: [
        desc,
        ...(maxima.length ? [`maximum ${maxima.join(' or ')} people`] : []),
        'in Nitinaht village, on the road to the Windsurf Park',
      ],
    });
  }
  return { units, minNights, yearRound: /open year-round/i.test(t) };
}

export interface NwCampsite { start: string | null; end: string | null; price: number | null; bookingFee: number | null; gst: boolean; adults: number | null; extraAdult: number | null }

/** /book-your-site/: "Campground open April 27 - October 4, 2026", "$35 plus $5 online booking fee plus GST". */
export function parseNwCampsite(html: string): NwCampsite {
  const t = nwLines(html).join('\n');
  const season = t.match(/open\s+([A-Z][a-z]+)\.?\s+(\d{1,2})\s*-\s*([A-Z][a-z]+)\.?\s+(\d{1,2}),?\s+(20\d{2})/);
  let start: string | null = null;
  let end: string | null = null;
  if (season && monthOf(season[1]) && monthOf(season[3])) {
    const y = Number(season[5]);
    start = iso(y, monthOf(season[1])!, Number(season[2]));
    end = iso(y, monthOf(season[3])!, Number(season[4]));
  }
  const price = t.match(/\$\s?(\d+)\s+plus\s+\$\s?(\d+)\s+online booking fee(\s+plus\s+GST)?/i);
  const adults = t.match(/based on (?:two|\w+)\s*\((\d)\)\s*Adults per site/i);
  const extra = t.match(/Additional adults[^$]*\$\s?(\d+)\s+per adult per night/i);
  return {
    start, end,
    price: price ? Number(price[1]) : null,
    bookingFee: price ? Number(price[2]) : null,
    gst: !!price?.[3],
    adults: adults ? Number(adults[1]) : null,
    extraAdult: extra ? Number(extra[1]) : null,
  };
}

const ONLINE = 'Online booking only (Checkfront on the own site), full prepayment by card';

function unitSlot(u: NwUnit, availability: Availability, banner: string | null): Slot {
  return {
    key: u.id,
    startDate: null,
    endDate: null,
    unit: u.name,
    price: u.price,
    currency: CURRENCY,
    priceUnit: 'per_night',
    priceBasis: 'room',
    occupancy: u.occupancy,
    availability,
    availabilityText: banner ?? `${ONLINE}; open year-round${u.minNights ? `; minimum ${u.minNights} night${u.minNights > 1 ? 's' : ''}` : ''}`,
    spotsLeft: null,
    minNights: u.minNights,
  };
}

export interface NwPages { cabins: string; motel: string; campsite: string }

/** Cabins + motel rooms (undated, year-round) + the campsite season band while it has not ended. */
export function buildNwSlots(p: NwPages, today: string, ctx?: Pick<FetchContext, 'note' | 'lastPublished'>): Slot[] {
  const out: Slot[] = [];
  const cabins = parseNwCabins(p.cabins);
  const motel = parseNwMotel(p.motel);
  const camp = parseNwCampsite(p.campsite);
  const banner = (html: string, what: string): string | null => {
    const b = nwBookingBanner(html);
    if (b) ctx?.note(`${what} page shows "${b}" -> slots closed`);
    return b;
  };
  const cabinBanner = banner(p.cabins, 'cabin');
  for (const u of cabins.units) out.push(unitSlot(u, cabinBanner ? 'closed' : 'unknown', cabinBanner));
  const motelBanner = banner(p.motel, 'motel');
  for (const u of motel.units) out.push(unitSlot(u, motelBanner ? 'closed' : 'unknown', motelBanner));

  const campBanner = banner(p.campsite, 'campsite');
  if (camp.price !== null && camp.start && camp.end) {
    const slot: Slot = {
      key: `campsite|${camp.start}`,
      startDate: camp.start,
      endDate: camp.end,
      unit: 'Basic campsite (Windsurf Park campground)',
      price: camp.price,
      currency: CURRENCY,
      priceUnit: 'per_night',
      priceBasis: 'room',
      occupancy: camp.adults,
      availability: campBanner ? 'closed' : 'unknown',
      availabilityText: campBanner ?? [
        `CAD ${camp.price} per site per night${camp.bookingFee ? ` plus CAD ${camp.bookingFee} online booking fee per booking` : ''}${camp.gst ? ' plus GST' : ''}`,
        camp.adults ? `price for ${camp.adults} adults${camp.extraAdult ? `, extra adults CAD ${camp.extraAdult} per night` : ''}` : null,
        ONLINE,
      ].filter(Boolean).join('; '),
      spotsLeft: null,
    };
    if (camp.end < today) {
      ctx?.note(`campground season ${camp.start}..${camp.end} has ended; no next-season dates printed yet`);
      // Aaron 2026-10-31 ("1+2+3 ja"): the printed season price stays the campsite's from-price until the next season
      ctx?.lastPublished?.([slot]);
    } else out.push(slot);
  } else {
    ctx?.note('campsite price or season not found on /book-your-site/');
  }
  return out;
}

// --- content ----------------------------------------------------------------------
const PHOTO_DROP = /logo|graphic|r-arrow|getting-here\.png|things-to-do\.png|people\.png|windsurf\.png|campground-map|things-grid-[13]|ZenSeekers-7\b/i;

/** Real photos of the park, best first: the kite beach (things-to-do grid), then the cabin set. */
export function nwPhotos(pages: Array<{ html: string; url: string }>): string[] {
  const all: string[] = [];
  for (const p of pages) {
    const root = parse(p.html);
    for (const img of root.querySelectorAll('#main-content img')) {
      // gallery thumbnails link to the original; otherwise drop the WordPress -WxH size suffix
      const href = img.parentNode?.getAttribute?.('href') ?? null;
      const src = href && /\.(?:jpe?g|png|webp)$/i.test(href) ? href : (img.getAttribute('src') ?? img.getAttribute('data-src'));
      if (!src || /^data:/.test(src)) continue;
      const u = new URL(src, p.url).toString().replace(/-\d+x\d+(?=\.(?:jpe?g|png|webp)$)/i, '');
      if (PHOTO_DROP.test(u) || !/\.(?:jpe?g|png|webp)$/i.test(u) || all.includes(u)) continue;
      all.push(u);
    }
  }
  // kite beach first (about-grid-2 shows kites on the beach of the park)
  return [...all.filter(u => /about-grid-2/.test(u)), ...all.filter(u => !/about-grid-2/.test(u))];
}

export interface NwContentPages extends NwPages { things: string }

export function parseNwContent(p: NwContentPages, today: string): OfferContent {
  const cabins = parseNwCabins(p.cabins);
  const motel = parseNwMotel(p.motel);
  const camp = parseNwCampsite(p.campsite);
  if (cabins.units.length === 0 && motel.units.length === 0) throw new Error('nitinaht: no cabin or motel prices found (layout changed?)');
  const things = nwLines(p.things);
  const windLine = things.find(l => /winds at Nitinaht Lake/i.test(l)) ?? null;
  const thingsBanner = nwBookingBanner(p.things);
  const cad = (n: number) => `CAD ${n}`;
  const cabinPrices = cabins.units.map(u => u.price).sort((a, b) => a - b);
  const queen = motel.units.find(u => /queen/i.test(u.name));
  const twoBed = motel.units.find(u => /2-bedroom/i.test(u.name));
  const fmtDay = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });
  const campSentence = camp.price !== null
    ? `Basic campsites on the beach cost ${cad(camp.price)} per night for two adults${camp.bookingFee ? ` plus a ${cad(camp.bookingFee)} online booking fee` : ''}${camp.gst ? ' and GST' : ''}; ${camp.start && camp.end
      ? (camp.end < today
        ? `the ${camp.start.slice(0, 4)} campground season ran ${fmtDay(camp.start)} to ${fmtDay(camp.end)} and the next season's dates are not published yet.`
        : `the campground is open ${fmtDay(camp.start)} to ${fmtDay(camp.end)}, ${camp.start.slice(0, 4)}.`)
      : 'the campground opens for the summer season.'}`
    : '';

  const summary = [
    'The Ditidaht Nation runs the Windsurf Park campground on the beach of Nitinat (Nitinaht) Lake on the west coast of Vancouver Island, a 20 km ocean fjord whose consistent, strong winds draw kiteboarders and windsurfers.',
    cabins.units.length
      ? `${/^Six\b/i.test(cabins.description ?? '') ? 'Six ' : 'The '}1-bedroom Caycuse Cabins stand in the forest inside the park (kitchenette, pull-out couch, shower, deck with BBQ and propane fire ring) at ${cabinPrices.length > 1 ? `${cad(cabinPrices[0])} to ${cabinPrices[cabinPrices.length - 1]}` : cad(cabinPrices[0])} per night${cabinPrices.length > 1 ? ' (pet friendly cabins cost more)' : ''}${cabins.minNights ? `, minimum ${cabins.minNights} nights` : ''}${cabins.yearRound ? ', open year-round' : ''}.`
      : '',
    motel.units.length
      ? `The Nitinaht Lake Motel in Nitinaht village, on the road to the park, has ${[queen ? `queen rooms (${cad(queen.price)})` : null, twoBed ? `2-bedroom rooms with kitchenette (${cad(twoBed.price)})` : null].filter(Boolean).join(' and ') || 'rooms'} per night.`
      : '',
    campSentence,
    'Bookings are online only with full prepayment by card; kite and wing lessons on the beach come from Elevation Kite and Wing Center, a separate school.',
  ].filter(Boolean).join(' ');

  const rooms: ContentRoom[] = [
    ...cabins.units.map(u => ({ name: u.name, description: cabins.description, features: [`${cad(u.price)} per night`, ...u.features] })),
    ...motel.units.map(u => ({ name: u.name, description: u.features[0] ?? null, features: [`${cad(u.price)} per night`, ...u.features.slice(1), ...(motel.minNights ? [`minimum ${motel.minNights} night stay`] : [])] })),
    ...(camp.price !== null ? [{
      name: 'Basic campsite (Windsurf Park campground)',
      description: 'Campsite with picnic table and fire ring; communal outhouses, camp hosts, pay-per-use Wi-Fi hotspots; tents or small off-grid RVs.',
      features: [
        `${cad(camp.price)} per site per night${camp.bookingFee ? ` plus ${cad(camp.bookingFee)} online booking fee` : ''}${camp.gst ? ' plus GST' : ''}`,
        ...(camp.adults ? [`price for ${camp.adults} adults${camp.extraAdult ? `; extra adults ${cad(camp.extraAdult)} per night, max 5 adults` : ''}`] : []),
        ...(camp.start && camp.end ? [`season ${camp.start} to ${camp.end}`] : []),
        'pets welcome (max 2 per site)',
      ],
    }] : []),
  ];

  return {
    kind: 'accommodation',
    title: 'Nitinaht Windsurf Park: Caycuse Cabins, Campground and Nitinaht Lake Motel',
    summary,
    continent: 'North America',
    country: 'Canada',
    region: 'Nitinat Lake, Vancouver Island',
    spot: 'Nitinat Lake',
    itinerarySpots: [],
    durationDays: null,
    skillLevels: [],
    kiteLessons: null, // the lodging sells no lessons; the school on the beach is a separate operator
    equipmentRental: null,
    beginnerFriendly: null,
    includedServices: ['Cabins: kitchenette, bathroom with shower, deck with BBQ and propane fire ring', 'Campsites: picnic table, fire ring, communal outhouses, camp hosts'],
    optionalServices: [
      'Kite and wing lessons and camps by Elevation Kite and Wing Center on the campground beach (separate operator, summer)',
      'Pay-per-use Wi-Fi hotspots in the campground',
      'Store and cafe in Nitinaht village',
    ],
    accommodation: 'forest cabins and campsites in the Windsurf Park, motel rooms in Nitinaht village',
    mealPlan: 'self_catering',
    languages: ['en'],
    rooms,
    imageUrls: nwPhotos([
      { html: p.things, url: NW_THINGS_URL },
      { html: p.cabins, url: NW_CABIN_URL },
      { html: p.campsite, url: NW_CAMPSITE_URL },
      { html: p.motel, url: NW_MOTEL_URL },
    ]),
    heroVideoUrl: null,
    sourceUrl: NW_CABIN_URL,
    bookingUrl: NW_CABIN_URL,
    sourceText: [
      `cabins: ${nwLines(p.cabins).filter(l => /cabin|night|occupancy|persons|year-round|kiteboard/i.test(l)).join(' | ')}`,
      `motel: ${nwLines(p.motel).filter(l => /\$|maxi|year-round|Minimum/i.test(l)).join(' | ')}`,
      `campsite: ${nwLines(p.campsite).filter(l => /open|\$|Adults/i.test(l)).slice(0, 8).join(' | ')}`,
      windLine ? `things-to-do: ${windLine}` : '',
      thingsBanner ? `info-page banner (not on the booking pages): ${thingsBanner}` : '',
    ].filter(Boolean).join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------
export const nitinahtWindsurfParkCabinsNitinatLake: OfferAdapter = {
  key: 'nitinaht-windsurf-park-cabins-nitinat-lake',
  name: 'Nitinaht Windsurf Park Cabins, Campground and Motel, Nitinat Lake',
  kind: 'accommodation',
  disciplines: ['kitesurf'], // the own site names kiteboarders and windriders, never wing
  operator: {
    name: 'Ditidaht Nation - Visit Nitinaht',
    websiteUrl: `${SITE}/`,
    rootDomain: 'visitnitinaht.com',
    contactEmail: 'bookings@nitinahtcampground.com', // cabin + campsite pages (Cloudflare-encoded mailto), 2026-10-23
    phone: '+17788170162',                          // "Nitinaht Campsite inquiries 778-817-0162 (May 1 - Sept 30)"
  },
  url: NW_CABIN_URL,
  slotMethod: 'price_table',
  instantBooking: true,
  fetchBudget: 5,
  confidence: 'medium',
  async fetchContent() {
    const [cabins, motel, campsite, things] = [await page(NW_CABIN_URL), await page(NW_MOTEL_URL), await page(NW_CAMPSITE_URL), await page(NW_THINGS_URL)];
    return parseNwContent({ cabins, motel, campsite, things }, todayIso());
  },
  async fetchSlots(ctx) {
    const [cabins, motel, campsite] = [await page(NW_CABIN_URL), await page(NW_MOTEL_URL), await page(NW_CAMPSITE_URL)];
    const slots = buildNwSlots({ cabins, motel, campsite }, todayIso(), ctx);
    if (slots.filter(s => s.key.startsWith('cabin')).length < 2 || slots.filter(s => s.key.startsWith('motel')).length < 2) {
      throw new Error(`nitinaht: cabin / motel price lines not found or changed (${slots.map(s => s.key).join(', ') || 'none'})`);
    }
    return slots;
  },
};
