// ---------------------------------------------------------------------------
// Kitesurfing Guimaras & Kite Resort, Playa de Paraiso (San Lorenzo, Guimaras Island, Philippines) - VDWS/IKO kite
// centre (since 2018) whose kite beach lies inside its own beach resort ("Our Kitespot / beach is inside the Kite
// Resort. We keep our uncrowded spot exclusive for our guests from the resort"); two suite types, restaurant and beach
// bar, pools, gym. Kite school open 1 November to 1 April.
//
// Found 2026-10-12 as Google Maps pin "Kitesurfing Guimaras" (kite shop, 4.9/27) near Iloilo / Guimaras.
// Liveness (2026-10-12): Google Maps reviews dated about 7 months back (March 2026) with owner replies 6-7 months back
//   (read in the built-in browser, a hint, not data); the home page advertises "the latest F.One 2026 Kites"; resort
//   gallery items uploaded 2025-08-19 (Wix createdDate); "In 2023 / 2024 all rooms were completely renovated".
//   Verdict LIVE.
// Data path (checked 2026-10-12): Wix, server-rendered text:
//   slots    / (home): "Accommodation / Choose your Room" block - per suite a nightly rate, a single-use rate and the
//            "Long Term (7+)" rates, "PHP / night"; undated. Used as current because the same page carries the 2026
//            kite range ("F.One 2026"); the /kite-resort-guimaras-philippines page repeats the identical table.
//   content  / (kite centre, courses, rental, storage fee, weather) + /kite-resort-guimaras-philippines (resort text,
//            gallery). Booking: every "Book ... NOW!" button opens the contact form -> 'on_request'.
//   coordinates  the home page's Google Maps link "Playa De Paraiso" (@10.6428308,122.7230572).
// robots.txt (2026-10-12): Wix default (only "*?lightbox=" disallowed).
// Requests per run: content 2, slots 1. Pages are 0.75-1.2 MB; fixtures are trimmed to markup.
// Parsed: 4 slots = 2 suites x (standard occupancy, single use), PHP per room per night, no dates, on request; the
//   7+ night rates go into the room features (no stay-length field on Slot).
// Known limits: no inventory, no season dates for the rooms; "3 swimming pools" (home) vs "2 swimming pools" (resort
//   page) - the summary says "pools".
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, parseAmount } from '../parse.js';
import type { ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.kitesurfing-guimaras.com';
export const GM_HOME_URL = SITE;
export const GM_RESORT_URL = `${SITE}/kite-resort-guimaras-philippines`;
const CONTACT_URL = `${SITE}/contact-kitesurfing-guimaras`;

const keyPart = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// --- local helpers ----------------------------------------------------------------------------
/** Visible text lines of a Wix page (scripts, styles and inline SVG dropped; zero-width spaces removed). */
export function gmLines(html: string): string[] {
  const body = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<svg[\s\S]*?<\/svg>/gi, '');
  return body.split(/<[^>]+>/).map(s => clean(s).replace(/​/g, '').trim()).filter(Boolean);
}

/** Original-size Wix photos (jpg/webp) in the page markup, document order; logos and badges (png) skipped. */
export function gmImages(html: string): string[] {
  const body = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  const out: string[] = [];
  for (const m of body.matchAll(/<img\b[^>]*>/gi)) {
    const id = m[0].match(/static\.wixstatic\.com\/media\/([0-9a-f]{6}_[0-9a-f]{32}~mv2(?:_d_\d+_\d+_s_\d+)?\.(?:jpe?g|webp))/i)?.[1];
    if (!id) continue;
    const u = `https://static.wixstatic.com/media/${id}`;
    if (!out.includes(u)) out.push(u);
  }
  return out;
}

/** The site's own Google Maps place link ("Playa De Paraiso", @lat,lng), else the Wix business location. */
export function gmCoords(html: string): { lat: number; lng: number } | null {
  const m = html.match(/google\.com\/maps\/place\/[^"'\s]*?@(-?\d+\.\d+),(-?\d+\.\d+)/)
    ?? html.match(/"businessLocationCoordinates":\{"latitude":(-?\d+\.\d+),"longitude":(-?\d+\.\d+)\}/);
  return m ? { lat: Math.round(Number(m[1]) * 1e6) / 1e6, lng: Math.round(Number(m[2]) * 1e6) / 1e6 } : null;
}

// --- pure parsers -----------------------------------------------------------------------------
export interface GmRoom {
  name: string;
  /** "Good for 2 Pax" */
  pax: number | null;
  features: string[];
  nightly: number | null;
  single: number | null;
  /** "Long Term (7+)" */
  longTermNights: number | null;
  longNightly: number | null;
  longSingle: number | null;
}

/**
 * Room cards of the accommodation block: name ("... Suite"), feature lines, then
 * "3500 PHP / night", "3300 PHP / night (Single Use)", "Long Term (7+)", the same two again, "Book your room NOW!".
 */
export function parseGmRooms(html: string): GmRoom[] {
  const lines = gmLines(html);
  const start = lines.findIndex((l, i) => /^Accommodation$/i.test(l) && lines.slice(i + 1, i + 4).some(x => /Suite$/.test(x)));
  if (start < 0) return [];
  const out: GmRoom[] = [];
  let cur: GmRoom | null = null;
  let long = false;
  for (const l of lines.slice(start + 1)) {
    if (/^Additional Kitesurfing Service|^Contact$|^Weather$/i.test(l)) break;
    if (/^(Choose your Room)$/i.test(l)) continue;
    if (/\bSuite$|\bRoom$/.test(l) && !/PHP/.test(l)) {
      cur = { name: l, pax: null, features: [], nightly: null, single: null, longTermNights: null, longNightly: null, longSingle: null };
      out.push(cur); long = false; continue;
    }
    if (!cur) continue;
    if (/^Book your room NOW!?$/i.test(l)) { cur = null; continue; }
    const lt = l.match(/^Long Term \((\d+)\+?\)$/i);
    if (lt) { long = true; cur.longTermNights = Number(lt[1]); continue; }
    const pr = l.match(/^([\d.,]+)\s*PHP\s*\/\s*night(\s*\(Single Use\))?$/i);
    if (pr) {
      const n = parseAmount(pr[1]);
      if (long) { if (pr[2]) cur.longSingle = n; else cur.longNightly = n; }
      else if (pr[2]) cur.single = n; else cur.nightly = n;
      continue;
    }
    const pax = l.match(/^Good for (\d+) Pax$/i);
    if (pax) cur.pax = Number(pax[1]);
    cur.features.push(l);
  }
  return out;
}

/** Per suite: the standard nightly rate (its stated occupancy) and the single-use rate; on request, no dates. */
export function buildGmSlots(rooms: GmRoom[]): Slot[] {
  const out: Slot[] = [];
  for (const r of rooms) {
    const base = {
      startDate: null, endDate: null, unit: r.name, currency: 'PHP', priceUnit: 'per_night' as const,
      priceBasis: 'room' as const, availability: 'on_request' as const, availabilityText: null, spotsLeft: null,
    };
    if (r.nightly !== null) out.push({ ...base, key: keyPart(r.name), price: r.nightly, occupancy: r.pax });
    if (r.single !== null) out.push({ ...base, key: `${keyPart(r.name)}-single`, price: r.single, occupancy: 1 });
  }
  return out;
}

export interface GmCourse { name: string; price: number; duration: string | null }

/** Course cards: name, description lines, "PHP 11000", "3h (1Pax) / 4h (2Pax)" or "PHP 3666 / 1h", "Book it NOW!". */
export function parseGmCourses(html: string): GmCourse[] {
  const lines = gmLines(html);
  const out: GmCourse[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/(Course)$/.test(lines[i]) || /^(Go to|Learn)/.test(lines[i])) continue;
    const end = lines.findIndex((l, j) => j > i && /^Book it NOW!?$/i.test(l));
    if (end < 0 || end - i > 8) continue;
    const pl = lines.slice(i + 1, end).find(l => /^PHP\s?[\d.,]+/.test(l));
    if (!pl) continue;
    const price = parseAmount(pl);
    if (price === null) continue;
    const per = pl.match(/\/\s*(\d+h)$/)?.[1];
    const dur = lines.slice(i + 1, end).find(l => /^\d+h \(\d+Pax\)/.test(l)) ?? (per ? `per ${per}` : null);
    out.push({ name: lines[i], price, duration: dur });
    i = end;
  }
  return out;
}

/** Rental of the complete set ("Complete Set / 1h - PHP 2000 / full day - PHP 4000 / week / 7days - PHP 26000"). */
export function parseGmRental(html: string): { hour: number | null; day: number | null; week: number | null } {
  const lines = gmLines(html);
  const i = lines.findIndex(l => /^Complete Set$/i.test(l));
  const block = i >= 0 ? lines.slice(i + 1, i + 5) : [];
  const pick = (re: RegExp) => { const l = block.find(x => re.test(x)); return l ? parseAmount(l.replace(/^.*PHP/i, '')) : null; };
  return { hour: pick(/^1h\b/i), day: pick(/^full day/i), week: pick(/^week/i) };
}

/** "Storage p. Kitesurfer with own equipment - 1 00 PHP per day" (the amount is split by a span on the page). */
export function parseGmStorageFee(html: string): number | null {
  const t = gmLines(html).join(' ');
  const m = t.match(/own equipment\s*-\s*([\d ]+?)\s*PHP per day/i);
  return m ? Number(m[1].replace(/\s/g, '')) || null : null;
}

export interface GmPages { home: string; resort: string }

export function parseGuimarasContent(p: GmPages): OfferContent {
  const home = gmLines(p.home);
  const resort = gmLines(p.resort);
  const rooms = parseGmRooms(p.home).length ? parseGmRooms(p.home) : parseGmRooms(p.resort);
  const courses = parseGmCourses(p.home);
  const rental = parseGmRental(p.home);
  const storage = parseGmStorageFee(p.home);
  const since = home.join(' ').match(/operational since (\d{4})/)?.[1] ?? null;
  const open = home.find(l => /Kite School is open/i.test(l)) ?? null;
  const openRange = open?.match(/open (\w+ \d+)\.? until (\w+ \d+)/i) ?? null;
  const renovated = /In 2023 \/ 2024 all rooms/i.test([...home, ...resort].join(' '));
  const brands = home.join(' ').match(/latest\s+F\.One\s*&\s*Flysurfer/i) ? 'F.One and Flysurfer' : 'F.One';
  const resident = resort.find(l => /^1 day incl\. Kitesurfing Service/i.test(l)) ?? null;
  const fmt = (n: number) => n.toLocaleString('en-US');

  const contentRooms: ContentRoom[] = rooms.map(r => ({
    name: r.name,
    description: r.pax ? `Suite for up to ${r.pax} guests at the kite resort, ocean or garden view.` : null,
    features: [
      ...r.features,
      ...(r.nightly !== null ? [`PHP ${fmt(r.nightly)} per night${r.single !== null ? ` (single use PHP ${fmt(r.single)})` : ''}`] : []),
      ...(r.longNightly !== null ? [`Long term (${r.longTermNights}+ nights): PHP ${fmt(r.longNightly)} per night${r.longSingle !== null ? ` (single use PHP ${fmt(r.longSingle)})` : ''}`] : []),
    ],
  }));

  const imageUrls: string[] = [];
  for (const u of [...gmImages(p.resort), ...gmImages(p.home)]) if (!imageUrls.includes(u)) imageUrls.push(u);

  const cheapest = rooms.map(r => r.nightly).filter((n): n is number => n !== null);
  const summary = [
    `Kitesurfing Guimaras is a VDWS-approved kite centre${since ? ` operating since ${since}` : ''} at Playa de Paraiso in San Lorenzo on Guimaras Island, Philippines, whose kite beach lies inside its own beach resort and is kept for resort guests.`,
    `The resort has ${rooms.length ? rooms.map(r => `${r.name}s${r.pax ? ` for ${r.pax}` : ''}`).join(' and ') : 'suites'} with air conditioning and breakfast for two${renovated ? ', renovated in 2023/2024' : ''}, plus a restaurant and beach bar, pools and a gym${cheapest.length ? `; suites cost from PHP ${fmt(Math.min(...cheapest))} per night` : ''}.`,
    `IKO and VDWS instructors teach private and group courses in English and German with ${brands} kites on flat lagoon water, with waves at the outer reef; F.One equipment is rented to riders from IKO level 3K / VDWS level 5${openRange ? `, and the school is open from ${openRange[1]} to ${openRange[2]}` : ''}.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Kitesurfing Guimaras & Kite Resort',
    summary,
    continent: 'Asia',
    country: 'Philippines',
    region: 'Western Visayas (Guimaras)',
    spot: 'Playa de Paraiso, San Lorenzo, Guimaras',
    spotCoords: gmCoords(p.home) ?? gmCoords(p.resort),
    spotCoordsPrecise: true,
    itinerarySpots: [],
    durationDays: null,
    // home: "Kitesurfing Courses / lessons for all kinds of levels. From Beginner to Advanced to Jumping and Looping"
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: courses.length > 0,
    equipmentRental: rental.day !== null || rental.hour !== null,
    beginnerFriendly: home.some(l => /shallow warm water/i.test(l)),
    includedServices: ['Breakfast for 2 guests', 'Wi-Fi', 'Air-conditioning', 'Access to the private kite beach of the resort', 'Swimming pool, gym, music lounge'],
    optionalServices: [
      ...courses.map(c => `${c.name}: PHP ${fmt(c.price)}${c.duration ? ` (${c.duration})` : ''}`),
      ...(rental.day !== null ? [`Equipment rental, complete set: PHP ${fmt(rental.hour ?? 0)} per hour, ${fmt(rental.day)} per day${rental.week ? `, ${fmt(rental.week)} per week` : ''} (IKO 3K / VDWS 5 required)`] : []),
      ...(storage ? [`Kitesurfing service / storage with own equipment: PHP ${storage} per day`] : []),
      'Kite safari and downwinders, island hopping by kayak, boat and SUP (wind and bookings permitting)',
    ],
    accommodation: 'beach resort suites with the kite beach on site',
    mealPlan: 'breakfast',
    languages: ['en', 'de'],
    rooms: contentRooms,
    imageUrls: imageUrls.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: GM_RESORT_URL,
    bookingUrl: CONTACT_URL,
    sourceText: [
      `kite centre: ${home.filter(l => /first established Kite Center|operational since|approved VDWS|Kitespot \/ beach is inside|Kite School is open|F\.One 2026/i.test(l)).join(' ')}`,
      `resort: ${resort.filter(l => l.length > 60).join(' ')}`,
      `rooms: ${rooms.map(r => `${r.name} (good for ${r.pax ?? '?'}): ${r.nightly}/${r.single} single; long term ${r.longTermNights}+: ${r.longNightly}/${r.longSingle}`).join('; ')}`,
      `courses: ${courses.map(c => `${c.name} PHP ${c.price} ${c.duration ?? ''}`).join('; ')}`,
      `rental complete set: ${rental.hour}/h ${rental.day}/day ${rental.week}/week; storage ${storage ?? '-'} per day`,
      `residents: ${resident ?? ''}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const kitesurfingGuimarasSanLorenzo: OfferAdapter = {
  key: 'kitesurfing-guimaras-san-lorenzo',
  name: 'Kitesurfing Guimaras & Kite Resort (San Lorenzo)',
  kind: 'accommodation',
  operator: {
    name: 'Kitesurfing Guimaras',
    websiteUrl: SITE,
    rootDomain: 'kitesurfing-guimaras.com',
    contactEmail: 'kitesurfing.guimaras@gmail.com', // page header + footer, 2026-10-12
    whatsapp: '+639271578535',
    phone: '+639271578535',
  },
  url: GM_RESORT_URL,
  slotMethod: 'price_table',
  fetchBudget: 3,
  confidence: 'medium', // undated room rates, contact form only
  async fetchContent() {
    const home = await fetchText(GM_HOME_URL, { accept: 'text/html' });
    const resort = await fetchText(GM_RESORT_URL, { accept: 'text/html' });
    return parseGuimarasContent({ home, resort });
  },
  async fetchSlots(ctx: FetchContext): Promise<Slot[]> {
    const html = await fetchText(GM_HOME_URL, { accept: 'text/html' });
    const rooms = parseGmRooms(html);
    if (rooms.length === 0 || rooms.every(r => r.nightly === null)) throw new Error('kitesurfing-guimaras: room price block not found on the home page (layout changed?)');
    // the rates are undated; they count as current while the page advertises a current kite range
    const range = gmLines(html).join(' ').match(/F\.One (20\d{2}) Kites/i)?.[1];
    if (!range || Number(range) < new Date().getUTCFullYear()) ctx.note(`kite range year ${range ?? 'missing'} on the price page: undated room rates may be stale`);
    return buildGmSlots(rooms);
  },
};
