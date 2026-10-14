// ---------------------------------------------------------------------------
// High Flyers Kite House, Tarifa (Cadiz, Andalusia, Spain) - guest house of kite instructor Kevin Mitchem (in Tarifa
// since 2006, lives in the house) in the historic old town opposite the castle, 50 m from the port: 5 private single
// and double rooms (no dorms), shared kitchen, living room, 2 bathrooms and a roof terrace. Kite lessons and rental
// through the partner school KBC Tarifa; Kevin runs his own 6-day kite camps for riders with a year of experience.
//
// Data path (checked 2026-10-12): Duda site "Powered by Smoobu" (www.highflyerstarifa.com).
//   content  / (house, FAQ), /guesthouse (room photos), /new-page09b1e3bb ("About us": Kevin, partner KBC Tarifa),
//            /kitesurfcamps (camp programme) + the Duda collection "propertiessmoobu" that the guesthouse page's room
//            widget reads (dmAPI collection.data("propertiessmoobu").get()):
//              GET /_dm/s/rt/actions/sites/<SiteAlias>/collections/propertiessmoobu/ENGLISH
//            -> {"value":"[{uuid,data:{marketingTitle,maxOccupancy,aboutApartment,amenities,propertySize,location.geo,
//               smoobu_apartment_id,iframeHash,price_minimal:null,...}}]"} (5 rooms; no prices). The URL is the Duda
//            runtime's public collection read (path pattern inferred from the Duda runtime). It answers 200 with
//            "Accept: text/html" and HTTP 500 with "Accept: application/json" (both checked 2026-10-12), so we send
//            text/html; if it fails, fetchContent notes it and continues without rooms. Fixture: iframeHash redacted.
//   slots    /kitesurfcamps: "Choose Your 2026 Camp" date cards (month + "18 - 25th" + "Places still available" /
//            "CAMP FULL") and the camp price "Shared double/twin room: 845€" / "Single (private) room: 995€" for
//            "6 days of guided kitesurfing" + "7 nights accommodation in the kite house".
// Booking engine: Smoobu. The room widget embeds login.smoobu.com/<locale>/cockpit/widget/show-calendar-iframe/
//   <apartment id>/<hash>; that host answered our UA with a bot challenge page (2026-10-12) -> BLOCKED, not used
//   (no retry), so there is no nightly room price or live availability. Room photos also sit on login.smoobu.com
//   (/upload/images/...) and are not used; the gallery comes from the Duda CDN.
// Kind 'accommodation': the rooms are sold on their own (Smoobu calendar + Book button per room); the only printed
//   price is the camp package, so the slots are the camp weeks (stay + guiding), priced per person.
// robots.txt (2026-10-12): only a Sitemap line and a Content-Signal (allow all); login.smoobu.com has no robots.txt.
// Requests per run: content 5, slots 1 (the camps page is memoised across content + slots).
// Parsed: slot = camp week x room type ("shared-double-twin-room|2026-10-10"), EUR per person (priceUnit 'package',
//   packageNights 7), availability 'available' ("Places still available") / 'sold_out' ("CAMP FULL").
// Map pin: the collection's location.geo (Calle Santa Teresa 2, 36.011858 / -5.6036924) - the site's own data.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, iso, monthOf, parse } from '../parse.js';
import type { Availability, ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.highflyerstarifa.com';
export const HF_HOME_URL = `${SITE}/`;
export const HF_ROOMS_URL = `${SITE}/guesthouse`;
export const HF_ABOUT_URL = `${SITE}/new-page09b1e3bb`;
export const HF_CAMPS_URL = `${SITE}/kitesurfcamps`;
/** Duda SiteAlias of www.highflyerstarifa.com (window.Parameters.SiteAlias, 2026-10-12); read from the page when present. */
const HF_SITE_ALIAS = '4dff6c3a885c43daaa7b1b9e6445a736';
export const hfCollectionUrl = (alias: string): string => `${SITE}/_dm/s/rt/actions/sites/${alias}/collections/propertiessmoobu/ENGLISH`;

const keyPart = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const memo = new Map<string, { at: number; p: Promise<string> }>();
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

/** Visible text of the page body (scripts, styles, nav and footer removed). */
function mainText(html: string): string {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, svg, header, footer, nav')) el.remove();
  return collapse((root.querySelector('#dm-content') ?? root.querySelector('body') ?? root).text).replace(/&acute;|´/g, "'");
}

/** Text of every Duda paragraph widget, in document order, one entry per widget (its <p>s joined by " | "). */
export function hfParagraphs(html: string): string[] {
  return parse(html).querySelectorAll('.dmNewParagraph')
    .map(el => {
      const ps = el.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li');
      const parts = (ps.length ? ps.map(p => p.text) : [el.text]).map(t => collapse(t).replace(/&acute;|´/g, "'")).filter(Boolean);
      return parts.join(' | ');
    })
    .filter(Boolean);
}

// --- pure parsers -------------------------------------------------------------------------------------
export interface HfCamp { start: string; end: string; status: string; availability: Availability }
export interface HfCampPrice { unit: string; amount: number; occupancy: number }
export interface HfCampInfo { year: number | null; camps: HfCamp[]; prices: HfCampPrice[]; nights: number | null; days: number | null; included: string[] }

const MONTH_RE = '(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)';

/** "18 - 25th" (with the card's month), "30th May - 6th JuneCAMP FULL" -> ISO start/end. */
export function hfRange(text: string, month: number | null, year: number): { start: string; end: string } | null {
  const t = text.replace(/[–—]/g, '-');
  const m = t.match(new RegExp(`(\\d{1,2})(?:st|nd|rd|th)?\\s*${MONTH_RE}?\\s*-\\s*(\\d{1,2})(?:st|nd|rd|th)?\\s*${MONTH_RE}?`, 'i'));
  if (!m) return null;
  const m1 = m[2] ? monthOf(m[2]) : null;
  const m2 = m[4] ? monthOf(m[4]) : null;
  const endMonth = m2 ?? month ?? m1;
  const startMonth = m1 ?? endMonth;
  if (!startMonth || !endMonth) return null;
  const endYear = endMonth < startMonth ? year + 1 : year;
  return { start: iso(year, startMonth, Number(m[1])), end: iso(endYear, endMonth, Number(m[3])) };
}

export function parseHfCamps(html: string): HfCampInfo {
  const paras = hfParagraphs(html);
  const text = mainText(html);
  const yearM = text.match(/Choose Your (20\d{2}) Camp/i);
  const year = yearM ? Number(yearM[1]) : null;
  const camps: HfCamp[] = [];
  if (year) {
    const from = paras.findIndex(p => /Pick from the dates below/i.test(p));
    let month: number | null = null;
    for (const p of paras.slice(from + 1)) {
      if (/Are these camps for you/i.test(p)) break;
      const only = p.match(new RegExp(`^${MONTH_RE}$`, 'i'));
      if (only) { month = monthOf(only[1]); continue; }
      if (!/\d/.test(p)) continue;
      const r = hfRange(p, month, year);
      if (!r) continue;
      const full = /camp full|\bfull\b|sold out/i.test(p);
      const avail = /available/i.test(p);
      camps.push({
        ...r,
        status: full ? 'CAMP FULL' : (p.match(/Places? still available|available/i)?.[0] ?? ''),
        availability: full ? 'sold_out' : avail ? 'available' : 'unknown',
      });
    }
  }
  const prices: HfCampPrice[] = [];
  const shared = text.match(/Shared double\/twin room:\s*([\d.,]+)\s*(?:€|&euro;)/i);
  const single = text.match(/Single \(private\) room:\s*([\d.,]+)\s*(?:€|&euro;)/i);
  if (shared) prices.push({ unit: 'Shared double/twin room', amount: Number(shared[1].replace(/[.,]/g, '')), occupancy: 2 });
  if (single) prices.push({ unit: 'Single room', amount: Number(single[1].replace(/[.,]/g, '')), occupancy: 1 });
  const nights = text.match(/(\d+) nights accommodation/i)?.[1];
  const days = text.match(/(\d+) days of guided kitesurfing/i)?.[1];
  // "What's Included in the Camp:" heading widget, the list in the next widget
  const incStart = paras.findIndex(p => /What.s Included in the Camp/i.test(p));
  const included = incStart >= 0 ? (paras[incStart + 1] ?? '').split(' | ').map(x => x.replace(/\s*[–—]\s*/g, ' - ').trim()).filter(x => x && !/All this for just/i.test(x)) : [];
  return { year, camps, prices, nights: nights ? Number(nights) : null, days: days ? Number(days) : null, included };
}

export function buildHfSlots(info: HfCampInfo): Slot[] {
  const out: Slot[] = [];
  for (const c of info.camps) {
    for (const p of info.prices) {
      out.push({
        key: `${keyPart(p.unit)}|${c.start}`,
        startDate: c.start,
        endDate: c.end,
        unit: `Kite camp week, ${p.unit.toLowerCase()}`,
        price: p.amount,
        currency: 'EUR',
        priceUnit: 'package',
        priceBasis: 'person',
        occupancy: p.occupancy,
        availability: c.availability,
        availabilityText: c.status || null,
        spotsLeft: null,
        packageNights: info.nights ?? 7,
      });
    }
  }
  return out;
}

export interface HfRoom { name: string; maxGuests: number | null; sizeM2: number | null; about: string; amenities: string[]; geo: { lat: number; lng: number } | null }

/** The Duda collection {"value":"[...]"} the room widget reads. */
export function parseHfCollection(json: string): HfRoom[] {
  const outer = JSON.parse(json) as { value?: string | unknown[] };
  const list = (typeof outer.value === 'string' ? JSON.parse(outer.value) : outer.value ?? []) as Array<{ data?: Record<string, unknown> }>;
  const rooms: HfRoom[] = [];
  for (const row of list) {
    const d = row.data ?? {};
    const name = collapse(String(d.marketingTitle ?? d.name ?? ''));
    if (!name) continue;
    const loc = (d.location ?? {}) as { geo?: { latitude?: number; longitude?: number } };
    const size = Number(d.propertySize);
    rooms.push({
      name,
      maxGuests: typeof d.maxOccupancy === 'number' ? d.maxOccupancy : null,
      sizeM2: Number.isFinite(size) && size > 0 ? size : null,
      about: collapse(parse(String(d.aboutApartment ?? '').replace(/<\/?(?:p|br|div|li)\b[^>]*>/gi, ' ')).text),
      amenities: Array.isArray(d.amenities) ? (d.amenities as Array<{ label?: string }>).map(a => collapse(a.label ?? '')).filter(Boolean) : [],
      geo: typeof loc.geo?.latitude === 'number' && typeof loc.geo?.longitude === 'number' ? { lat: loc.geo.latitude, lng: loc.geo.longitude } : null,
    });
  }
  // "Room 3: Los Lances" before "Room 4: Balneario"
  return rooms.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
}

/** Duda SiteAlias: window.Parameters.SiteAlias, else the site folder in the page's own CDN image paths. */
export function hfSiteAlias(html: string): string | null {
  return html.match(/SiteAlias:\s*'([0-9a-f]{32})'/)?.[1] ?? html.match(/cdn-website\.com\/([0-9a-f]{32})\/dms3rep\//)?.[1] ?? null;
}

/** Photos on the Duda CDN (hydration JSON + markup), one per file, original size where the page links it. */
export function hfImages(html: string): string[] {
  const byBase = new Map<string, string[]>();
  for (const m of html.matchAll(/https:\/\/(?:le-)?de\.cdn-website\.com\/[0-9a-f]{32}\/dms3rep\/multi\/[^"'\s)\\]+?\.(?:jpe?g|JPE?G|webp)/g)) {
    const u = m[0];
    if (/logo|banner|favicon/i.test(u)) continue;
    const base = u.replace(/^https:\/\/(?:le-)?de\./, '').replace('/opt/', '/').replace(/-\d+w(?=\.[A-Za-z]+$)/, '');
    if (!byBase.has(base)) byBase.set(base, []);
    byBase.get(base)!.push(u);
  }
  const out: string[] = [];
  for (const urls of byBase.values()) {
    const orig = urls.find(u => !u.includes('/opt/'));
    const width = (u: string) => Number(u.match(/-(\d+)w\.[A-Za-z]+$/)?.[1] ?? 0);
    out.push(orig ?? [...urls].sort((a, b) => width(b) - width(a))[0]);
  }
  return out;
}

export interface HfPages { home: string; rooms: string; about: string; camps: string; collection: string | null }

export function parseHighFlyersContent(p: HfPages): OfferContent {
  const home = mainText(p.home);
  const about = mainText(p.about);
  const camps = parseHfCamps(p.camps);
  const coll = p.collection ? parseHfCollection(p.collection) : [];
  const geo = coll.find(r => r.geo)?.geo ?? null;
  // house-wide amenities = those every room lists; the rest are room features
  const withAmen = coll.filter(r => r.amenities.length);
  const amenities = withAmen.length ? withAmen[0].amenities.filter(a => withAmen.every(r => r.amenities.includes(a))) : [];
  const shared = camps.prices.find(x => x.occupancy === 2);

  const rooms: ContentRoom[] = coll.map(r => ({
    name: r.name,
    description: r.about || null,
    features: [
      r.maxGuests ? `Up to ${r.maxGuests} guest${r.maxGuests > 1 ? 's' : ''}` : null,
      r.sizeM2 ? `${r.sizeM2} m²` : null,
      ...r.amenities.filter(a => !amenities.includes(a)),
      'Shared kitchen, living room, 2 bathrooms and roof terrace',
    ].filter((x): x is string => !!x),
  }));

  // room photos (guesthouse page) first, then the house and Tarifa photos; one URL per file across the pages
  const imageUrls = hfImages(p.rooms + p.home + p.about).slice(0, 30);

  const summary = [
    `High Flyers Kite House is a guest house in Tarifa's historic old town, Spain, opposite the castle and 50 m from the port, a 3-4 minute walk from Playa Chica and Los Lances beach; it is run by kite instructor Kevin Mitchem, who has taught in Tarifa since 2006 and lives in the house.`,
    `It has ${coll.length || 5} private single and double rooms (no dorms) with a shared kitchen, living room, two bathrooms and a roof terrace looking over the castle, the port and Morocco.`,
    `Kite lessons and F-ONE rental are arranged with the partner school KBC Tarifa, and Kevin runs ${camps.days ?? 6}-day kite camps for riders with at least a year of experience${shared ? ` (${camps.nights ?? 7} nights in the house, EUR ${shared.amount} per person in a shared room)` : ''}.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'High Flyers Kite House',
    summary,
    continent: 'Europe',
    country: 'Spain',
    region: 'Tarifa town',
    spot: 'Tarifa',
    spotCoords: geo,
    itinerarySpots: [],
    durationDays: null,
    // about: KBC lessons "whether you're taking your very first lesson or fine-tuning your technique"; camps are not for beginners
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: /kitesurf lessons/i.test(about),
    equipmentRental: /equipment rental/i.test(about),
    beginnerFriendly: /very first lesson/i.test(about),
    includedServices: amenities.length ? amenities.filter(a => !/smoking/i.test(a)) : ['Towels and bed linen', 'Shared kitchen', 'Wi-Fi', 'Roof terrace'],
    optionalServices: [
      `Kite camp with Kevin: ${camps.included.join('; ') || '6 days of guided kitesurfing, 7 nights in the kite house'}`,
      'Kite lessons and F-ONE equipment rental with the partner school KBC Tarifa (IKO/VDWS instructors; English, Spanish, German)',
    ],
    accommodation: 'guest house with private single and double rooms',
    mealPlan: 'self_catering',
    languages: ['en', 'es'],
    rooms,
    imageUrls,
    heroVideoUrl: null,
    sourceUrl: HF_HOME_URL,
    bookingUrl: HF_ROOMS_URL,
    sourceText: [
      `home: ${home}`,
      `about: ${about}`,
      `rooms: ${coll.map(r => `${r.name} (max ${r.maxGuests ?? '?'}${r.sizeM2 ? `, ${r.sizeM2} m2` : ''}): ${r.about}`).join(' | ')}`,
      `camps ${camps.year ?? ''}: ${camps.camps.map(c => `${c.start}..${c.end} ${c.status}`).join('; ')}; prices ${camps.prices.map(x => `${x.unit} ${x.amount}`).join(', ')}; included: ${camps.included.join('; ')}`,
      `geo: ${geo ? `${geo.lat},${geo.lng}` : '-'}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------------
export const highFlyersKiteHouseTarifa: OfferAdapter = {
  key: 'high-flyers-kite-house-tarifa',
  name: 'High Flyers Kite House Tarifa',
  kind: 'accommodation',
  operator: {
    name: 'High Flyers Tarifa',
    websiteUrl: SITE,
    rootDomain: 'highflyerstarifa.com',
    contactEmail: 'highflyerstarifa@gmail.com',
    phone: '+34676286118',
  },
  url: HF_HOME_URL,
  slotMethod: 'html_dates',
  fetchBudget: 7,
  async fetchContent(ctx) {
    const home = await page(HF_HOME_URL);
    const rooms = await page(HF_ROOMS_URL);
    const about = await page(HF_ABOUT_URL);
    const camps = await page(HF_CAMPS_URL);
    let collection: string | null = null;
    try {
      // Accept text/html on purpose: the endpoint answered HTTP 500 to "Accept: application/json" (2026-10-12)
      collection = await page(hfCollectionUrl(hfSiteAlias(rooms) ?? HF_SITE_ALIAS));
    } catch (e) {
      ctx.note(`room collection not readable (${(e as Error).message}): rooms left empty`);
    }
    return parseHighFlyersContent({ home, rooms, about, camps, collection });
  },
  async fetchSlots() {
    const info = parseHfCamps(await page(HF_CAMPS_URL));
    if (!info.year || info.camps.length === 0) throw new Error('high-flyers: no "Choose Your YYYY Camp" date cards on /kitesurfcamps (layout changed?)');
    if (info.prices.length === 0) throw new Error('high-flyers: camp prices ("Shared double/twin room: ...€") not found');
    return buildHfSlots(info);
  },
};
