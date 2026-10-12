// ---------------------------------------------------------------------------
// Urla Surf House, Gülbahçe (Urla, İzmir, Turkey) - small beach hotel on the Gülbahçe kite beach with its
// own kitesurf school and center on the lagoon (lessons, wing foil / hydrofoil, coaching, kids courses,
// rental and storage), a kite slider park, skate ramp, pool and homemade kitchen; family rooms, ten themed
// comfort rooms, bungalow tents and a camping area.
//
// Liveness (re-check 2026-10-12, verdict LIVE): surf-magazin.de feature of 2026-01-29 ("Urla Gülbahce - new
//   destination for wingfoilers") names Urla Surf House as the place to go, with current courses (English,
//   international instructors) and its standard / comfort / family rooms; the own site's sustainability
//   report and policy pages were edited 2025-11-28 and the home page 2025-01-15 (WordPress REST modified);
//   OTA listings showed rates for August 2026 (hint only, not data). Content pages themselves date from
//   2021-2022 (rooms, kitesurf) and the footer says "Copyright 2021".
//
// Data path (checked 2026-10-12): urlasurfhouse.com, WordPress (theme by 4step), English pages:
//   content  / (concept, school offer, room types), /hotel/ (room types, activities), /kitesurf/ (spot,
//            school, Google Maps place link = spotCoords), /hotel-comfort-room/ (10 themed rooms),
//            /hotel-family-room/ (2 budget rooms), /book-contact/ (inquiry, airport transfer, directions).
//   slots    none: the site prints no room or lesson price; bookings go through e-mail / phone ("We will try
//            to answer within a day"). fetchSlots re-reads /hotel/ (memoised) and returns [] (offer = "price
//            on request"); it notes when an amount shows up so the adapter can be extended.
// robots.txt (2026-10-12): disallows /wp-admin/ only.
// Requests per run: content 6, slots 1 (0 extra when content ran in the same process).
// Known limits: e-mail address is Cloudflare-obfuscated (data-cfemail, decoded locally); the bungalow tent
//   and camping area pages are not read (one-line descriptions on /hotel/ suffice); no season dates or
//   meal plan on the site; the theme still carries a few 2020 demo images (dropped).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, collapse, findPrices, imageCandidates } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://urlasurfhouse.com';
export const USH_HOME_URL = `${SITE}/`;
export const USH_HOTEL_URL = `${SITE}/hotel/`;
export const USH_KITE_URL = `${SITE}/kitesurf/`;
export const USH_COMFORT_URL = `${SITE}/hotel-comfort-room/`;
export const USH_FAMILY_URL = `${SITE}/hotel-family-room/`;
export const USH_BOOK_URL = `${SITE}/book-contact/`;

// --- local helpers ----------------------------------------------------------------------------
const memo = new Map<string, { at: number; p: Promise<string> }>();
/** one fetch per page per 10 minutes: fetchContent + fetchSlots in the same run share it */
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

/** Visible text lines of the page body between "Back To Top" and the footer ("Policies"). */
export function ushLines(html: string): string[] {
  const body = html.replace(/<!--[\s\S]*?-->|<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<svg[\s\S]*?<\/svg>|<noscript[\s\S]*?<\/noscript>/gi, '');
  const lines = body.split(/<[^>]+>/).map(s => clean(s)).filter(Boolean);
  const a = lines.findIndex(l => /^Back To Top$/i.test(l));
  const b = lines.findIndex((l, i) => i > a && /^Policies$/.test(l));
  return lines.slice(a + 1, b > a ? b : undefined);
}
const ushText = (html: string): string => collapse(ushLines(html).join(' '));

/** Cloudflare e-mail obfuscation (data-cfemail): XOR with the first byte. */
export function decodeCfEmail(hex: string): string {
  const key = parseInt(hex.slice(0, 2), 16);
  let out = '';
  for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
  return out;
}
export function ushEmail(html: string): string | null {
  const hex = html.match(/data-cfemail="([0-9a-f]+)"/i)?.[1];
  const email = hex ? decodeCfEmail(hex) : null;
  return email && /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email) ? email : null;
}

/** Google Maps place link on /kitesurf/: the place pin (!3d lat !4d lng), not the map centre. */
export function ushCoords(html: string): { lat: number; lng: number } | null {
  const m = html.match(/google\.com\/maps\/place\/[^"']*?!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if (!m) return null;
  const lat = Number(m[1]); const lng = Number(m[2]);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

/** Numbered room cards on the room-type pages: "1" / "CARIBBEAN ROOM" / text ... "Find Out More". */
export function parseUshRoomCards(html: string): Array<{ name: string; text: string }> {
  const ls = ushLines(html);
  const out: Array<{ name: string; text: string }> = [];
  for (let i = 0; i < ls.length - 1; i++) {
    if (!/^\d{1,2}$/.test(ls[i]) || !/ROOM$/.test(ls[i + 1])) continue;
    const text: string[] = [];
    for (let j = i + 2; j < ls.length && !/^Find Out More$/i.test(ls[j]); j++) text.push(ls[j]);
    const name = ls[i + 1].toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
    out.push({ name, text: collapse(text.join(' ')) });
  }
  return out;
}

/** Room types on /hotel/: label line, name line ("Family Room"), one-line description. */
export function parseUshRoomTypes(hotelHtml: string): Array<{ name: string; description: string }> {
  const ls = ushLines(hotelHtml);
  const out: Array<{ name: string; description: string }> = [];
  for (const name of ['Family Room', 'Comfort Room', 'Bungalow Tent', 'Camping Area']) {
    const i = ls.findIndex(l => l === name);
    if (i >= 0 && ls[i + 1]) out.push({ name, description: ls[i + 1] });
  }
  return out;
}

const guestsOf = (t: string): string | null => {
  const m = t.match(/Rooms are for ((?:one|two|three)(?:, (?:one|two|three))*(?: or (?:one|two|three))?) guests?/i);
  return m ? `For ${m[1]} guests` : null;
};

export interface UshPages { home: string; hotel: string; kite: string; comfort: string; family: string; book: string }

export function parseUrlaSurfHouseContent(p: UshPages): OfferContent {
  const home = ushText(p.home);
  const hotel = ushText(p.hotel);
  const kite = ushText(p.kite);
  const book = ushText(p.book);
  const types = parseUshRoomTypes(p.hotel);
  const comfort = parseUshRoomCards(p.comfort);
  const family = parseUshRoomCards(p.family);
  const coords = ushCoords(p.kite);
  const intro = home.match(/(Urla Surf House is a small beach hotel[\s\S]*?hotel directly on a kitesurf beach in Turkey!)/)?.[1] ?? '';
  const spot = kite.match(/(In front of our kitesurf center[\s\S]*?turquoise and flat water\.)/)?.[1] ?? '';
  const transfer = /arrange transfer/i.test(book);

  const commonFeature = (cards: Array<{ text: string }>, re: RegExp) => cards.length > 0 && cards.every(c => re.test(c.text));
  const desc = (name: string) => types.find(t => t.name === name)?.description ?? null;
  const rooms: ContentRoom[] = [];
  if (desc('Family Room') || family.length) {
    const f = family[0]?.text ?? '';
    rooms.push({
      name: 'Family Room',
      description: desc('Family Room'),
      features: [
        family.length ? `${family.length} rooms (${family.map(c => c.name).join(', ')})` : null,
        commonFeature(family, /private bathroom/i) ? 'Private bathroom' : null,
        commonFeature(family, /\bfan\b/i) ? 'Fan' : null,
        guestsOf(f),
      ].filter((x): x is string => !!x),
    });
  }
  if (desc('Comfort Room') || comfort.length) {
    const c0 = comfort[0]?.text ?? '';
    rooms.push({
      name: 'Comfort Room',
      description: desc('Comfort Room'),
      features: [
        comfort.length ? `${comfort.length} themed rooms (${comfort.map(c => c.name.replace(/ Room$/, '')).join(', ')})` : null,
        commonFeature(comfort, /air conditioning/i) ? 'Air conditioning' : null,
        commonFeature(comfort, /private bathroom/i) ? 'Private bathroom' : null,
        guestsOf(c0),
      ].filter((x): x is string => !!x),
    });
  }
  for (const name of ['Bungalow Tent', 'Camping Area']) {
    if (desc(name)) rooms.push({ name, description: desc(name), features: [] });
  }

  // images: hotel carousel + room types, then kite photos, one photo per family / themed comfort room
  const pick = (html: string, base: string, max: number, keep: (u: string) => boolean = () => true): string[] =>
    imageCandidates(html, base, null, 80).filter(u =>
      /\/wp-content\/uploads\/20(?:2[1-9])\//.test(u) // 2020 uploads are theme demo images
      && !/\.(?:png|svg|gif)$/i.test(u) && !/logo|team_|People-on-computers|book-now|dummy/i.test(u) && keep(u)).slice(0, max);
  const seen = new Set<string>();
  const imageUrls: string[] = [];
  for (const u of [
    ...pick(p.hotel, USH_HOTEL_URL, 20),
    ...pick(p.kite, USH_KITE_URL, 10),
    ...pick(p.family, USH_FAMILY_URL, 2, u => /_1\.jpe?g$/i.test(u)),
    ...pick(p.comfort, USH_COMFORT_URL, 10, u => /-1\.jpe?g$/i.test(u)),
    ...pick(p.kite, USH_KITE_URL, 40), ...pick(p.home, USH_HOME_URL, 40),
  ]) {
    const k = u.replace(/-(?:\d+x\d+|scaled|e\d{10,})(?=\.[a-z]+$)/i, '');
    if (seen.has(k)) continue;
    seen.add(k); imageUrls.push(u);
  }

  const nComfort = comfort.length || null;
  const summary = [
    'Urla Surf House is a small beach hotel on the Gülbahçe kite beach in Urla, about 40 minutes from İzmir airport on the Aegean coast of Turkey, with its own kitesurf center and school on the beach.',
    `In front of the center lies a large lagoon with flat, shallow water; the school teaches beginners, advanced riders and children and offers wing foil and hydrofoil, coaching, camps, rental and storage, and runs a kite slider park upwind.`,
    `Guests stay in ${family.length || 2} family rooms for smaller budgets (fan, private bathroom, one or two guests), ${nComfort ?? 10} themed comfort rooms with air conditioning and private bathroom (one to three guests), bungalow tents on a terrace or the camping area; the hotel has a homemade kitchen and bar, a pool and a skate ramp.`,
    `Stays are booked on request by e-mail or phone${transfer ? ', with airport transfers arranged on request' : ''}; the site publishes no prices.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Urla Surf House',
    summary,
    continent: 'Europe',
    country: 'Turkey',
    region: 'İzmir',
    spot: 'Gülbahçe, Urla',
    // Google Maps place link on /kitesurf/ (checked 2026-10-12)
    ...(coords ? { spotCoords: coords } : {}),
    itinerarySpots: [],
    durationDays: null,
    // home/kitesurf: beginner lessons, "Advance" lessons & coaching, freestyle and foiling areas
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: /KITESURF LESSONS/i.test(home),
    equipmentRental: /Rent the latest kiteboarding equipment/i.test(home),
    beginnerFriendly: /perfect for kitesurf beginners|easy & safe conditions/i.test(`${home} ${kite}`),
    includedServices: [
      /swimming pool/i.test(hotel) ? 'Swimming pool' : null,
      /skate/i.test(home) ? 'Skate mini ramp, slackline, table tennis and games' : null,
      /open and free for everybody/i.test(kite) ? 'Kite slider park (free for everybody)' : null,
    ].filter((x): x is string => !!x),
    optionalServices: [
      'Kitesurf lessons (beginner, advanced, kids)',
      'Wing foil and hydrofoil lessons',
      'Kite coaching and camps (incl. winter camps)',
      'Kite equipment rental and storage',
      /SUP boards/i.test(home) ? 'SUP boards' : null,
      'Homemade food at the kitchen & bar',
      transfer ? 'Airport transfer from İzmir Adnan Menderes (about 40 minutes, on request)' : null,
    ].filter((x): x is string => !!x),
    accommodation: 'small beach hotel with family and themed comfort rooms, bungalow tents and camping',
    mealPlan: null, // the site does not say what a stay includes
    languages: ['en'],
    rooms,
    imageUrls: imageUrls.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: USH_HOTEL_URL,
    bookingUrl: USH_BOOK_URL,
    sourceText: [
      `intro: ${intro}`,
      `spot: ${spot}`,
      `room types: ${types.map(t => `${t.name}: ${t.description}`).join(' | ')}`,
      `comfort rooms: ${comfort.map(c => `${c.name}: ${c.text}`).join(' | ')}`,
      `family rooms: ${family.map(c => `${c.name}: ${c.text}`).join(' | ')}`,
      `map: ${coords ? `${coords.lat},${coords.lng}` : '-'}`,
      `home: ${home}`,
      `hotel: ${hotel}`,
      `kitesurf: ${kite}`,
      `book & contact: ${book}`,
    ].join('\n'),
  };
}

/** No published price: [] (price on request). Returns the amounts if the hotel page starts printing some. */
export function ushVisiblePrices(hotelHtml: string): string[] {
  return findPrices(ushText(hotelHtml)).map(p => p.raw);
}

// --- adapter ----------------------------------------------------------------------------------
export const urlaSurfHouseGulbahce: OfferAdapter = {
  key: 'urla-surf-house-gulbahce',
  name: 'Urla Surf House Gülbahçe',
  kind: 'accommodation',
  operator: {
    name: 'Urla Surf House',
    websiteUrl: SITE,
    rootDomain: 'urlasurfhouse.com',
    contactEmail: 'hello@urlasurfhouse.com',
    phone: '+905313701777',
  },
  url: USH_HOTEL_URL,
  slotMethod: 'price_table',
  fetchBudget: 7,
  confidence: 'low', // no prices or dates on the site; inquiry only
  async fetchContent(ctx) {
    const [home, hotel, kite, comfort, family, book] = [
      await page(USH_HOME_URL), await page(USH_HOTEL_URL), await page(USH_KITE_URL),
      await page(USH_COMFORT_URL), await page(USH_FAMILY_URL), await page(USH_BOOK_URL),
    ];
    const email = ushEmail(home);
    if (email && email !== urlaSurfHouseGulbahce.operator.contactEmail) ctx.note(`contact e-mail on the site changed: ${email}`);
    return parseUrlaSurfHouseContent({ home, hotel, kite, comfort, family, book });
  },
  async fetchSlots(ctx): Promise<Slot[]> {
    const html = await page(USH_HOTEL_URL);
    if (parseUshRoomTypes(html).length === 0) throw new Error('urla-surf-house: room types missing on /hotel/ (layout changed?)');
    const prices = ushVisiblePrices(html);
    if (prices.length) ctx.note(`prices appeared on /hotel/ (${prices.slice(0, 5).join(', ')}): extend the adapter`);
    return [];
  },
};
