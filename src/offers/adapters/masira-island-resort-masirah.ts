// ---------------------------------------------------------------------------
// Masira Island Resort, Masirah Island (Oman) - 22-room boutique beach resort (rooms, suites, chalets) on
// Masirah, the island's kite season hotel; its activities page presents Masirah's kite spots and sends kiters
// to Watersport Oman, which runs kiteboarding and SUP on VDWS / IKO standards on the island
// (masirah@watersport-oman.com).
//
// Data path (checked 2026-10-12): masiraislandresort.com, a static export of a WordPress/Elementor site
//   (relative "../wp-content/" links, footer "(c) 2019", site icon uploaded 2023-08):
//   content  / (intro, restaurant + bars, facilities, meeting room), /book-a-room/ (4 room types with size,
//            beds, floor, view; shared amenities), /activities/ (kite surfing text, Watersport Oman contact),
//            /gallery/ (rooms, dining, pool, activity photos).
//   slots    none. The "Book Now" buttons open SynXis (be.synxis.com/?chain=31982&hotel=64798), whose
//            robots.txt disallows everything for "*" -> not used; the site prints no rates -> [] ("price on
//            request").
// robots.txt (2026-10-12): masiraislandresort.com answers 404 (no robots.txt = everything allowed).
// Kite link: /activities/ "Kite Surfing ... we have the perfect place for you - Masira Island ... For more
//   details, please visit www.watersport-oman.com" and "Water Sport: watersport Oman offers the very best in
//   kiteboarding and stand up paddling activities on international VDWS and IKO standards ...
//   masirah@watersport-oman.com".
// Liveness evidence (rule 5b relaxed, Aaron 2026-10-12): the own site carries no 2026 date. The kite partner's
//   own site (watersport-oman.com/masirah-island, sitemap lastmod 2026-08-04) recommends staying at the resort
//   ("you can stay at a 4 star hotel called Masirah Island resort ... 10-20 minute drive to both the lagoon and
//   wave spot") with room rates (Deluxe from 65 OMR with breakfast, Chalet 160 OMR); those rates are the
//   partner's, not the hotel's, so they are not used as slots. Booking platforms list the hotel as operating
//   (hint only, not read).
// Requests per run: content 4, slots 0.
// Known limits: no spotCoords (no map or geo data on the site); the resort's own pages do not say whether
//   breakfast is included.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, parse } from '../parse.js';
import type { ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://masiraislandresort.com';
export const MIR_HOME_URL = `${SITE}/`;
export const MIR_ROOMS_URL = `${SITE}/book-a-room/`;
export const MIR_ACTIVITIES_URL = `${SITE}/activities/`;
export const MIR_GALLERY_URL = `${SITE}/gallery/`;
const BOOKING_URL = 'https://be.synxis.com/?chain=31982&hotel=64798&level=hotel&locale=en-US';

// --- local helpers ----------------------------------------------------------------------------
const txt = (s: string | null | undefined): string => clean(s ?? '').replace(/[–—]/g, '-').replace(/\s+([,.])/g, '$1');

/** Visible text blocks (Elementor widgets), header/footer/nav removed. */
export function mirLines(html: string): string[] {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, svg, header, footer, nav')) el.remove();
  const out: string[] = [];
  for (const part of root.innerHTML.split(/<\/?(?:p|li|h\d|div|br|section|figure)\b[^>]*>/i)) {
    const t = txt(part.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' '));
    if (t && out[out.length - 1] !== t) out.push(t);
  }
  return out;
}

// --- pure parsers -----------------------------------------------------------------------------
export interface MirRoom { name: string; description: string; size: string | null; beds: string | null; floor: string | null; view: string | null }

/** /book-a-room/: Elementor image boxes (h3 title + description with "Room Size / Bed Type / Location / View"). */
export function parseMirRooms(html: string): MirRoom[] {
  const out: MirRoom[] = [];
  for (const box of parse(html).querySelectorAll('.elementor-image-box-content')) {
    const name = txt(box.querySelector('.elementor-image-box-title')?.text);
    const descEl = box.querySelector('.elementor-image-box-description');
    if (!name || !descEl) continue;
    const parts = descEl.innerHTML.replace(/<!--[\s\S]*?-->/g, ' ').split(/<br\s*\/?>|<\/p>|<p\b[^>]*>/i).map(x => txt(x.replace(/<[^>]+>/g, ' '))).filter(Boolean);
    const field = (re: RegExp): string | null => parts.map(p => p.match(re)?.[1]?.trim()).find(Boolean) ?? null;
    const all = parts.join(' ');
    const description = txt(all.split(/(?:Chalet|Room) Size:/i)[0]);
    out.push({
      name,
      description,
      size: field(/(?:Chalet|Room) Size:\s*([\d.,]+\s*sq\.?\s*m)/i) ?? all.match(/(?:Chalet|Room) Size:\s*([\d.,]+\s*sq\.?\s*m)/i)?.[1] ?? null,
      beds: all.match(/Bed Type:\s*(.+?)(?=\s+Location:|$)/i)?.[1]?.trim() ?? null,
      floor: all.match(/Location:\s*(.+?)(?=\s+View:|$)/i)?.[1]?.trim() ?? null,
      view: all.match(/View:\s*(.+?)(?=\s+Book Now|$)/i)?.[1]?.trim() ?? null,
    });
  }
  return out.filter(r => /room|suite|chalet/i.test(r.name));
}

/** /book-a-room/: the amenity list shared by all rooms. */
export function parseMirAmenities(html: string): string[] {
  const lines = mirLines(html);
  const i = lines.findIndex(l => /All guest rooms at Masira Island Resort offer the following amenities/i.test(l));
  if (i < 0) return [];
  const out: string[] = [];
  for (const l of lines.slice(i + 1)) {
    if (/^Rooms & Suites$/i.test(l) || l.length > 80) break;
    if (!out.includes(l)) out.push(l);
  }
  return out;
}

export interface MirKite { kite: string[]; partner: string | null; partnerEmail: string | null }

/** /activities/: the "Kite Surfing" paragraphs and the "Water Sport" partner block. */
export function parseMirKite(html: string): MirKite {
  const lines = mirLines(html);
  const i = lines.findIndex(l => /^Kite Surfing$/i.test(l));
  const kite: string[] = [];
  if (i >= 0) {
    for (const l of lines.slice(i + 1)) {
      if (/^Deep Sea Fishing$/i.test(l)) break;
      kite.push(l);
    }
  }
  const partner = lines.find(l => /^watersport Oman offers/i.test(l)) ?? null;
  const partnerEmail = html.match(/[\w.+-]+@watersport-oman\.com/i)?.[0] ?? null;
  return { kite, partner, partnerEmail };
}

/** Home page: restaurant/bar names and the facilities list. */
export function parseMirHome(html: string): { intro: string | null; dining: string[]; facilities: string[]; roomsLine: string | null } {
  const lines = mirLines(html);
  const intro = lines.find(l => /^The Masira Island Resort represents/i.test(l)) ?? null;
  const roomsLine = lines.find(l => /offers you \d+ well-appointed rooms/i.test(l)) ?? null;
  const dining = [...new Set(lines.filter(l => /^(The Dhow Restaurant|Sanctuary Bar|Oasis Bar)$/i.test(l)))];
  const fi = lines.findIndex(l => /^Facilities$/i.test(l));
  const facilities: string[] = [];
  if (fi >= 0) {
    for (const l of lines.slice(fi + 1)) {
      if (/^The Dhow Restaurant$/i.test(l) || l.length > 80) break;
      facilities.push(l);
    }
  }
  return { intro, dining, facilities, roomsLine };
}

/** Property photos (rooms, dining, pool, activities) from home + gallery, originals only; no bird close-ups, icons or logos. */
export function mirImages(home: string, gallery: string, activities: string): string[] {
  const out: string[] = [];
  const add = (html: string, base: string) => {
    for (const m of html.matchAll(/(?:src|href|data-src)="([^"]+\.jpe?g)"/gi)) {
      const u = new URL(m[1], base).toString();
      if (/-\d+x\d+\.jpe?g$|\/2019\/04\/|logo|Banner\.jpg$/i.test(u)) continue;
      if (!out.includes(u)) out.push(u);
    }
  };
  add(home, MIR_HOME_URL);
  add(activities, MIR_ACTIVITIES_URL);
  add(gallery, MIR_GALLERY_URL);
  // rooms and the kite photo first, then the rest in page order
  const rank = (u: string) => (/room|Executive|Chalet|Premier|Deluxe/i.test(u) ? 0 : /KiteSurfing|water-sports/i.test(u) ? 1 : 2);
  return out.map((u, i) => ({ u, i })).sort((a, b) => rank(a.u) - rank(b.u) || a.i - b.i).map(x => x.u);
}

export interface MirPages { home: string; rooms: string; activities: string; gallery: string }

export function parseMasiraIslandResortContent(p: MirPages): OfferContent {
  const rooms = parseMirRooms(p.rooms);
  const amenities = parseMirAmenities(p.rooms);
  const kite = parseMirKite(p.activities);
  const home = parseMirHome(p.home);
  if (kite.kite.length === 0 || !kite.partner) throw new Error('masira-island-resort: kite surfing section or Watersport Oman partner block missing on /activities/');
  const nRooms = home.roomsLine?.match(/offers you (\d+) well-appointed/i)?.[1] ?? null;

  const contentRooms: ContentRoom[] = rooms.map(r => ({
    name: r.name,
    description: r.description || null,
    features: [
      r.size ? `Size ${r.size.replace(/\s+/g, ' ')}` : null,
      r.beds ? `Beds: ${r.beds}` : null,
      r.floor ? `Floor: ${r.floor}` : null,
      r.view ? `View: ${r.view}` : null,
      ...amenities,
    ].filter((x): x is string => !!x),
  }));

  const summary = [
    `Masira Island Resort is a boutique beach resort on Masirah Island off Oman's south-east coast with ${nRooms ?? '22'} rooms, suites and chalets facing the Arabian Sea, an outdoor pool with jacuzzi, a fitness centre, The Dhow beach restaurant and two bars.`,
    'Its activities page presents Masirah as a kitesurfing destination (season from May/June, 20 to 45 knots from the south, flat lagoons on the west coast and Indian Ocean waves on the east, spots within 20 minutes) and refers kiters to Watersport Oman, which runs kiteboarding and stand-up paddling on VDWS and IKO standards on the island.',
    `Room types are ${rooms.map(r => r.name).join(', ')}; the site prints no rates, bookings go through the hotel's online booking engine or by e-mail.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Masira Island Resort',
    summary,
    continent: 'Asia',
    country: 'Oman',
    region: 'Al Sharqiyah South',
    spot: 'Masirah Island',
    itinerarySpots: [],
    durationDays: null,
    // /activities/: "Whether you are an expert or newbie"
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: /kiteboarding/i.test(kite.partner) ? true : null,
    equipmentRental: null,
    beginnerFriendly: true,
    includedServices: amenities.filter(a => /Wi-Fi/i.test(a)),
    optionalServices: [
      `Kiteboarding and stand-up paddling with Watersport Oman (VDWS / IKO standards${kite.partnerEmail ? `, ${kite.partnerEmail}` : ''})`,
      'Deep sea fishing (October to March)',
      'Bird watching and turtle watching',
    ],
    accommodation: 'boutique beach resort: rooms, suites and chalets',
    mealPlan: null,
    languages: [],
    rooms: contentRooms,
    imageUrls: mirImages(p.home, p.gallery, p.activities).slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: MIR_ACTIVITIES_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      `home: ${[home.intro, home.roomsLine].filter(Boolean).join(' | ')}`,
      `facilities: ${home.facilities.join(' | ')}`,
      `dining: ${home.dining.join(' | ')}`,
      `rooms: ${rooms.map(r => `${r.name} (${r.size ?? '-'}; ${r.beds ?? '-'}; ${r.floor ?? '-'}; ${r.view ?? '-'}): ${r.description}`).join(' | ')}`,
      `amenities: ${amenities.join(' | ')}`,
      `kite: ${kite.kite.join(' | ')}`,
      `water sport partner: ${kite.partner} ${kite.partnerEmail ?? ''}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const masiraIslandResortMasirah: OfferAdapter = {
  key: 'masira-island-resort-masirah',
  name: 'Masira Island Resort, Masirah',
  kind: 'accommodation',
  operator: {
    name: 'Masira Island Resort',
    websiteUrl: SITE,
    rootDomain: 'masiraislandresort.com',
    contactEmail: 'reservations@masiraislandresort.com',
    phone: '+968 2550 4274',
  },
  url: MIR_ACTIVITIES_URL,
  slotMethod: 'price_table', // no rates on the site, SynXis robots-disallowed: always [] (price on request)
  instantBooking: true,
  fetchBudget: 4,
  confidence: 'low',
  async fetchContent() {
    const home = await fetchText(MIR_HOME_URL, { accept: 'text/html' });
    const rooms = await fetchText(MIR_ROOMS_URL, { accept: 'text/html' });
    const activities = await fetchText(MIR_ACTIVITIES_URL, { accept: 'text/html' });
    const gallery = await fetchText(MIR_GALLERY_URL, { accept: 'text/html' });
    return parseMasiraIslandResortContent({ home, rooms, activities, gallery });
  },
  async fetchSlots(ctx: FetchContext): Promise<Slot[]> {
    ctx.note('no rates on masiraislandresort.com; its SynXis engine is disallowed by robots.txt: price on request');
    return [];
  },
};
