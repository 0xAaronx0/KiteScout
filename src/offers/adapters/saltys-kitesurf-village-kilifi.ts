// ---------------------------------------------------------------------------
// Salty's Kitesurf Village, Bofa Beach, Kilifi (Kenya) - kite village with an IKO-affiliated kite centre, beach
// bar and restaurant and boutique rooms (cottage suites, ensuite rooms, king rooms with shared bathroom,
// surfers economy rooms), 3 km from Kilifi town.
//
// Data path (checked 2026-10-12): Squarespace site saltyskitesurf.com.
//   content  / (village, facilities), /saltys-accommodation (room cards), /kitecenter (IKO school, wind seasons,
//            course and rental prices), /kitesurf-packages (stay + course packages), /contactus (address, map
//            block with the pin, e-mail, phone).
//   slots    /saltys-accommodation: per room an <h2> name, a description <p>, then "From: Single 110 USD/night" /
//            "Double 143 USD/night" (or "Price: ..."). No season dates, no year.
// Booking engine: Sirvoy (widget form 5d95f3e47432e, saltyskitesurfvillage.stay.at). Its widget opens an engine
//   session via POST secured.sirvoy.com/widget/book_widget_cors.js before any search, so there is no stateless
//   public availability call to read -> not used; slots stay 'unknown'.
// robots.txt (2026-10-12): Squarespace defaults (/config, /search, /api/, /static/, ?format=json ...), the pages
//   above are allowed; secured.sirvoy.com and *.stay.at have an empty "User-agent: *" group.
// Requests per run: content 5, slots 1.
// Parsed: slot = room type x 1 / 2 guests ("cottage-double-ensuite-2p"), USD per room per night as printed
//   ("From" prices are the lowest rate), no dates (the page has none), availability 'unknown'.
// Known limits: the season start ("Friday, 10th July 2026 ... official start of the season", /new-events-2) is
//   only in an event post, so slots carry no date limits; the site warns that OTA prices differ and rates may
//   be adjusted at payment (exchange rates).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, imageCandidates, parseAmount } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://saltyskitesurf.com';
export const SKV_HOME_URL = `${SITE}/`;
export const SKV_ROOMS_URL = `${SITE}/saltys-accommodation`;
const SKV_KITE_URL = `${SITE}/kitecenter`;
const SKV_PACKAGES_URL = `${SITE}/kitesurf-packages`;
const SKV_CONTACT_URL = `${SITE}/contactus`;
const BOOKING_URL = 'https://saltyskitesurfvillage.stay.at';

const keyPart = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const titleCase = (s: string): string => s.toLowerCase().replace(/(^|\s)([a-z])/g, (_, a, b) => a + b.toUpperCase());

/** Headings and paragraphs in document order (script/style/noscript dropped). */
export function skvBlocks(html: string): Array<{ tag: string; text: string }> {
  const s = html.replace(/<(script|style|svg|noscript)\b[\s\S]*?<\/\1>/gi, ' ');
  const out: Array<{ tag: string; text: string }> = [];
  for (const m of s.matchAll(/<(h[1-4]|p|li)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const text = clean(m[2].replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' '));
    if (text) out.push({ tag: m[1].toLowerCase(), text });
  }
  return out;
}

// --- pure parsers -----------------------------------------------------------------------------
export interface SkvRoom { name: string; description: string; single: number | null; double: number | null; currency: string; from: boolean }

/** Room cards: <h2> name, description, "From: Single 110 USD/night", "Double 143 USD/night". */
export function parseSkvRooms(html: string): SkvRoom[] {
  const out: SkvRoom[] = [];
  let cur: SkvRoom | null = null;
  for (const b of skvBlocks(html)) {
    if (b.tag === 'h1') { cur = null; continue; }
    if (b.tag === 'h2') { cur = { name: titleCase(b.text), description: '', single: null, double: null, currency: 'USD', from: false }; out.push(cur); continue; }
    if (!cur) continue;
    const single = b.text.match(/Single\s+(\d[\d.,]*)\s*(USD|KES|EUR)\s*\/\s*night/i);
    const double = b.text.match(/Double\s+(\d[\d.,]*)\s*(USD|KES|EUR)\s*\/\s*night/i);
    if (single || double) {
      if (single) cur.single = parseAmount(single[1]);
      if (double) cur.double = parseAmount(double[1]);
      cur.currency = (single ?? double)![2].toUpperCase();
      if (/^From\b/i.test(b.text)) cur.from = true;
    } else if (!cur.description) cur.description = b.text;
  }
  return out.filter(r => r.single !== null || r.double !== null);
}

export function buildSkvSlots(rooms: SkvRoom[]): Slot[] {
  const out: Slot[] = [];
  for (const r of rooms) {
    for (const [guests, price] of [[1, r.single], [2, r.double]] as const) {
      if (price === null) continue;
      out.push({
        key: `${keyPart(r.name)}-${guests}p`,
        startDate: null,
        endDate: null,
        unit: r.name,
        price,
        currency: r.currency,
        priceUnit: 'per_night',
        priceBasis: 'room',
        occupancy: guests,
        availability: 'unknown',
        availabilityText: null,
        spotsLeft: null,
      });
    }
  }
  return out;
}

/** Map block on the contact page: {"location":{"markerLat":..,"markerLng":..}} (HTML-escaped JSON). */
export function parseSkvPin(html: string): { lat: number; lng: number } | null {
  const t = html.replace(/&quot;/g, '"');
  const m = t.match(/"markerLat":(-?\d+\.\d+),"markerLng":(-?\d+\.\d+)/);
  return m ? { lat: Number(m[1]), lng: Number(m[2]) } : null;
}

export interface SkvPages { home: string; rooms: string; kite: string; packages: string; contact: string }

export function parseSaltysContent(p: SkvPages): OfferContent {
  const home = skvBlocks(p.home).map(b => b.text);
  const kite = skvBlocks(p.kite).map(b => b.text);
  const packages = skvBlocks(p.packages).map(b => b.text);
  const contact = skvBlocks(p.contact).map(b => b.text);
  const rooms = parseSkvRooms(p.rooms);
  const pin = parseSkvPin(p.contact);
  const homeText = home.join(' ');
  const kiteText = kite.join(' ');
  const pkgText = packages.join(' ');
  const cheapest = [...rooms].filter(r => r.double !== null).sort((a, b) => a.double! - b.double!)[0];
  const kaskazi = kiteText.match(/December and March \(Kaskazi\):\s*Consistent ([\d-]+ knots)/)?.[1] ?? null;
  const kuzi = kiteText.match(/May to October \(Kuzi\):\s*Consistent ([\d-]+ knots)/)?.[1] ?? null;
  const pkgBlocks = skvBlocks(p.packages);
  const pkgs = pkgBlocks.flatMap((b, i) => {
    const dur = b.text.match(/^Duration\s*:\s*(.+?)\s+Accommodation\s*:/);
    const price = b.text.match(/Price\s*:\s*Starting at \$([\d,]+) per person/);
    if (!dur || !price || i === 0) return [];
    return [`${pkgBlocks[i - 1].text}: ${dur[1]}, from USD ${price[1].replace(',', '')} per person (room, kite course, breakfast, extras, return transfers)`];
  });
  const courses = [...kiteText.matchAll(/(\d+h (?:taster )?course):\s*\$(\d+)/g)].slice(0, 5).map(m => `Private kite ${m[1]}: USD ${m[2]}`);
  const rental = kiteText.match(/1h rent:\s*\$(\d+)/)?.[1] ?? null;

  const contentRooms: ContentRoom[] = rooms.map(r => ({
    name: r.name,
    description: r.description || null,
    features: [
      r.single !== null ? `Single: ${r.from ? 'from ' : ''}${r.currency} ${r.single} per night` : null,
      r.double !== null ? `Double: ${r.from ? 'from ' : ''}${r.currency} ${r.double} per night` : null,
    ].filter((x): x is string => !!x),
  }));

  const imgs: string[] = [];
  const seen = new Set<string>();
  for (const [html, base] of [[p.rooms, SKV_ROOMS_URL], [p.home, SKV_HOME_URL], [p.kite, SKV_KITE_URL]] as const) {
    for (const u of imageCandidates(html, base, null, 80)) {
      if (!/images\.squarespace-cdn\.com\/content\//.test(u) || /logo|favicon|icon|\.png(\?|$)/i.test(u)) continue;
      const k = u.replace(/\?.*$/, '');
      if (seen.has(k)) continue;
      seen.add(k); imgs.push(k);
    }
  }

  const summary = [
    "Salty's Kitesurf Village is a kite village on Bofa Beach, about 3 km from Kilifi town on the Kenyan coast, with its own IKO-affiliated kite centre, a beach bar and restaurant, and boutique rooms in the cottage and garden.",
    `Room types range from Surfers Economy rooms with a shared ablution block to king rooms and cottage suites${cheapest ? `, from USD ${cheapest.double} per night for two (${cheapest.name})` : ''}.`,
    `The kite centre teaches beginners to advanced riders, rents F-One gear and offers storage, rescue and downwinders; wind seasons are Kaskazi (December to March${kaskazi ? `, ${kaskazi}` : ''}) and Kuzi (May to October${kuzi ? `, ${kuzi}` : ''}).`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: "Salty's Kitesurf Village",
    summary,
    continent: 'Africa',
    country: 'Kenya',
    region: 'Kilifi County',
    spot: 'Bofa Beach, Kilifi',
    spotCoords: pin, // map block on /contactus
    itinerarySpots: [],
    durationDays: null,
    // kite center: "We offer courses for any/all riding levels" + coaching for intermediate/advanced
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: /course/i.test(kiteText),
    equipmentRental: /rent/i.test(kiteText),
    beginnerFriendly: /total beginner/i.test(kiteText),
    includedServices: /free WIFI/i.test(homeText) ? ['Free Wi-Fi'] : [],
    optionalServices: [
      ...courses,
      ...(rental ? [`Kite gear rental: USD ${rental} per hour (supervision available)`] : []),
      ...pkgs,
      'Kite equipment cleaning, storage and rescue at the kite centre',
      'Airport pick-up (Mombasa, Malindi, Vipingo Ridge) on request',
      'Downwinders, diving, deep-sea fishing, sailing, safari trips',
    ],
    accommodation: 'boutique rooms and cottage suites in the kite village',
    mealPlan: null, // the room rates do not say what they include (packages add daily breakfast)
    languages: ['en'],
    rooms: contentRooms,
    imageUrls: imgs.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: SKV_HOME_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      `home: ${homeText}`,
      `rooms: ${rooms.map(r => `${r.name}: ${r.description} single ${r.single} double ${r.double} ${r.currency}${r.from ? ' (from)' : ''}`).join(' | ')}`,
      `kite center: ${kiteText}`,
      `packages: ${pkgText}`,
      `contact: ${contact.join(' | ')}`,
      `pin: ${pin ? `${pin.lat},${pin.lng}` : '-'}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const saltysKitesurfVillageKilifi: OfferAdapter = {
  key: 'saltys-kitesurf-village-kilifi',
  name: "Salty's Kitesurf Village",
  kind: 'accommodation',
  operator: {
    name: "Salty's Kitesurf Village",
    websiteUrl: SITE,
    rootDomain: 'saltyskitesurf.com',
    contactEmail: 'reservations.saltys@gmail.com',
    whatsapp: '+254794449196',
    phone: '+254794449196',
  },
  url: SKV_HOME_URL,
  slotMethod: 'price_table',
  fetchBudget: 6,
  async fetchContent() {
    const home = await fetchText(SKV_HOME_URL, { accept: 'text/html' });
    const rooms = await fetchText(SKV_ROOMS_URL, { accept: 'text/html' });
    const kite = await fetchText(SKV_KITE_URL, { accept: 'text/html' });
    const packages = await fetchText(SKV_PACKAGES_URL, { accept: 'text/html' });
    const contact = await fetchText(SKV_CONTACT_URL, { accept: 'text/html' });
    return parseSaltysContent({ home, rooms, kite, packages, contact });
  },
  async fetchSlots() {
    const rooms = parseSkvRooms(await fetchText(SKV_ROOMS_URL, { accept: 'text/html' }));
    if (rooms.length < 4) throw new Error(`saltys: room price cards not found or changed (${rooms.length} rooms with prices)`);
    return buildSkvSlots(rooms);
  },
};

