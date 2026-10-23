// ---------------------------------------------------------------------------
// Elevation Kite and Wing Center, Nitinat Lake camps (Vancouver Island, British Columbia, Canada) - 3-day kite and wing
// foil lesson camps on the beach of the Nitinat Lake (Nitinaht) campground: women's kite camps, co-ed kiteboarding
// camps, co-ed wing foiling camps, kids wing foiling and kids kiteboarding camps. WITHOUT accommodation: guests camp
// at the lake ("Contact us for accommodation", "Bring your camping gear", "You need to reserve your stay ... before
// booking lessons with us" -> the Ditidaht Nation campground, own listing nitinaht-windsurf-park-cabins-nitinat-lake).
// Kind 'course' (Aaron's call 2026-10-23: lessons only, no stay; see kitetribe-el-gouna.ts for the other course).
//
// Data path (checked 2026-10-23): Shopify theme pages, server-rendered.
//   slots    /pages/nitinaht-lake "Kite & Wing Camps" block (.rte): per camp type an <h4> "Summer 2027 Women's Kite
//            Camps", an <em> price "$1025CAD + tax (5% GST) per person", a <ul> of 3-day dates ("July 5-6-7",
//            "July19-20-21"). -> one slot per camp type x date (key "<type>|<start>"), CAD per person for the 3-day
//            camp (priceUnit 'package', priceBasis 'person'), the printed "+ tax (5% GST)" kept in the slot text,
//            availability 'on_request' (booking by request form; a "sold out" / "full" word on a date line would
//            override it). Dates already started are dropped. Summer 2027 on 2026-10-23: women's kite 2, co-ed kite 2,
//            wing 5, kids wing 1, kids kite 1 = 11 slots.
//   content  /pages/nitinaht-lake (wind season, campground, what to bring, getting there), /pages/womans-camps (3 days,
//            "beginners and intermediate", 10:30 am to about 4 or 5 pm, watercraft-assisted, Duotone gear supplied,
//            day plan), /pages/wing-camps (wing inclusions, kids "8-16 years old").
//   photos   Nitinat photos of the three pages (checked by eye 2026-10-23): kite launches and kites on the beach,
//            camp groups at the lake, wing foiling on the lake. Dropped: La Ventana photos (shop wall, beach portraits,
//            wing carry on sand, team group = og:image), the collages, the map, the .heic file and a single portrait.
//            Shopify "{width}" templates are resolved to 1400 px.
// Currency: printed "CAD" on every price line; a line without a code is read as CAD (Canadian site, inferred).
// Booking: request only (/pages/book-your-lesson -> "Nitinat Lake Lesson Form", a Google Form; e-mail, phone). The
//   Shopify store sells gear only -> instantBooking false, no live availability.
// robots.txt elevationkiteboarding.com (2026-10-23): Shopify default, /pages/ allowed (cart/checkout/account
//   disallowed and never touched). The file also carries a paragraph addressed to AI shopping agents; it is not a
//   crawl rule and was ignored.
// Requests per run: content 3, slots 1 (the Nitinat page, memoised for 10 minutes).
// Known limits / doubts:
//   - The camp hours (10:30 am to 4 or 5 pm), watercraft assistance and the beginner/intermediate level are printed on
//     the women's camp page; applied to all camp types (inferred).
//   - The wing page also promises a "Welcome drink at Joe's garage", which reads like a La Ventana leftover; not used.
//   - Kids age 8-16 is printed for the kids wing camp only (assumed for the kids kite camp, inferred).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { availabilityFromText, collapse, imageCandidates, iso, monthOf, parse, todayIso, type HTMLElement } from '../parse.js';
import type { OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://elevationkiteboarding.com';
export const EL_NITINAT_URL = `${SITE}/pages/nitinaht-lake`;
export const EL_WOMEN_URL = `${SITE}/pages/womans-camps`;
export const EL_WING_URL = `${SITE}/pages/wing-camps`;
export const EL_BOOKING_URL = `${SITE}/pages/book-your-lesson`;
const CAMP_DAYS = 3;

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
const slug = (s: string): string => s.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const txt = (el: HTMLElement | null | undefined): string => collapse((el?.text ?? '').replace(/[–—]/g, '-'));
function visible(html: string): HTMLElement {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, template, svg')) el.remove();
  return root;
}
/** Main page text (Shopify <main>), as lines. */
export function elLines(html: string): string[] {
  const root = visible(html);
  const main = root.querySelector('main') ?? root;
  return main.structuredText.split('\n').map(l => collapse(l.replace(/[–—]/g, '-'))).filter(Boolean);
}

// --- pure parsers -----------------------------------------------------------------
export interface ElDate { start: string; end: string; label: string; availability: ReturnType<typeof availabilityFromText> }
export interface ElCamp {
  /** heading without season/year, singular: "Women's Kite Camp" */
  type: string;
  heading: string;
  year: number | null;
  price: number | null;
  currency: string | null;
  /** "+ tax (5% GST)" as printed */
  tax: string | null;
  priceText: string | null;
  dates: ElDate[];
}

/** "July 5-6-7", "July19-20-21", "June 30-July 1-2" -> first and last day in `year`. */
export function parseElDays(text: string, year: number): { start: string; end: string } | null {
  let month: number | null = null;
  let prevDay = 0;
  const days: string[] = [];
  for (const m of text.matchAll(/([A-Za-z]{3,})?\.?\s*(\d{1,2})(?!\d)/g)) {
    if (m[1]) {
      const mo = monthOf(m[1]);
      if (!mo) continue;
      month = mo;
    } else if (month !== null && Number(m[2]) < prevDay) {
      month = month === 12 ? 1 : month + 1; // "29-30-1" runs into the next month
    }
    if (month === null) continue;
    prevDay = Number(m[2]);
    days.push(iso(year, month, prevDay));
  }
  if (days.length === 0) return null;
  const start = days[0];
  let end = days[days.length - 1];
  if (end < start) end = iso(year + 1, Number(end.slice(5, 7)), Number(end.slice(8, 10)));
  return { start, end };
}

/** Camp blocks of the Nitinat page: heading (h2-h5 or a bold paragraph naming a camp) -> price line -> date list. */
export function parseElCamps(html: string): ElCamp[] {
  const root = visible(html);
  const camps: ElCamp[] = [];
  for (const rte of root.querySelectorAll('.rte')) {
    let cur: ElCamp | null = null;
    for (const el of rte.childNodes as HTMLElement[]) {
      const tag = el.tagName?.toLowerCase();
      if (!tag) continue;
      const t = txt(el);
      if (!t) continue;
      if (/^h[2-5]$/.test(tag) && /camp/i.test(t)) {
        const year = Number(t.match(/\b(20\d{2})\b/)?.[1] ?? NaN) || null;
        const type = t
          .replace(/^(?:(?:summer|winter|spring|fall|autumn)\s+)?(?:20\d{2}(?:\/20?\d{2})?\s+)?/i, '')
          .replace(/\bCamps\b/, 'Camp')
          .trim();
        cur = { type, heading: t, year, price: null, currency: null, tax: null, priceText: null, dates: [] };
        camps.push(cur);
        continue;
      }
      if (!cur) continue;
      if (tag === 'p' && cur.price === null && /\$\s?\d/.test(t)) {
        const m = t.match(/\$\s?([\d,]+(?:\.\d{2})?)\s*([A-Z]{3})?/);
        if (m) {
          cur.price = Number(m[1].replace(/,/g, ''));
          cur.currency = m[2] ?? 'CAD'; // inferred when the line has no code (Canadian site)
          cur.tax = t.match(/\+\s*tax\s*\([^)]*\)|\+\s*(?:\d+%\s*)?(?:GST|tax)/i)?.[0].replace(/\s+/g, ' ') ?? null;
          cur.priceText = t;
        }
        continue;
      }
      if (tag === 'ul' && cur.year) {
        for (const li of el.querySelectorAll('li')) {
          const label = txt(li);
          const r = parseElDays(label, cur.year);
          if (r) cur.dates.push({ ...r, label, availability: availabilityFromText(label.replace(/^[A-Za-z]+\s*[\d\s-]+/, '')) });
        }
      }
    }
  }
  return camps.filter(c => c.dates.length > 0 || c.price !== null);
}

export function buildElSlots(camps: ElCamp[], today: string): Slot[] {
  const out: Slot[] = [];
  for (const c of camps) {
    for (const d of c.dates) {
      if (d.start <= today) continue;
      const avail = d.availability && d.availability !== 'available' ? d.availability : 'on_request';
      out.push({
        key: `${slug(c.type)}|${d.start}`,
        startDate: d.start,
        endDate: d.end,
        unit: `${c.type}, 3 days, lessons only`,
        price: c.price,
        currency: c.price !== null ? c.currency : null,
        priceUnit: c.price !== null ? 'package' : null,
        priceBasis: c.price !== null ? 'person' : null,
        occupancy: null,
        availability: avail,
        availabilityText: [
          c.price !== null ? `${c.currency} ${c.price}${c.tax ? ` ${c.tax}` : ''} per person for the 3-day camp (as printed: "${c.priceText}")` : null,
          `dates ${d.label}`,
          'lessons only, accommodation not included (camp at the Nitinat Lake campground)',
          avail === 'on_request' ? 'booked via the Nitinat Lake lesson request form' : null,
        ].filter(Boolean).join('; '),
        spotsLeft: null,
      });
    }
  }
  return out;
}

// --- content ----------------------------------------------------------------------
/** La Ventana photos, collages, the map, the og team photo, the .heic file and the single portrait (checked 2026-10-23). */
const PHOTO_DROP = /logo|\.svg|\.heic|\/map_|group_team|top_of_page_picture|second_picture_down|foil02|kitecamp_img|\/files\/camp_\d+x\.|WhatsApp_Image_2025-07-19/i;

export function elPhotos(pages: Array<{ html: string; url: string }>): string[] {
  const out: string[] = [];
  for (const p of pages) {
    if (!p.html) continue;
    for (const raw of imageCandidates(p.html, p.url, null, 40)) {
      const u = raw.replace(/%7Bwidth%7D|\{width\}/gi, '1400');
      if (PHOTO_DROP.test(u) || !/\/cdn\/shop\/files\//.test(u) || out.includes(u)) continue;
      out.push(u);
    }
  }
  return out;
}

export interface ElPages { nitinat: string; women: string; wing: string }

export function parseElContent(p: ElPages, today: string): OfferContent {
  const camps = parseElCamps(p.nitinat);
  if (camps.length === 0) throw new Error('elevation: no camp blocks on /pages/nitinaht-lake (layout changed?)');
  const nit = elLines(p.nitinat);
  const women = elLines(p.women);
  const wing = elLines(p.wing);
  const all = [...nit, ...women, ...wing].join('\n');
  const windLine = nit.find(l => /wind season/i.test(l)) ?? null;
  const season = windLine?.match(/wind season in Nitinat is from (\w+) to (\w+)/i);
  const knots = windLine?.match(/(\d+)\s*to\s*(\d+)\s*knots/i);
  const kidsAge = wing.join('\n').match(/Kids[^\n]*\((\d+)\s*-\s*(\d+) years/i);
  const hours = women.find(l => /camps? runs? from/i.test(l))?.match(/from ([\d:]+\s*[ap]m) to (about [\w\s]+? [ap]m)/i);
  const year = camps.find(c => c.year)?.year ?? null;
  const future = camps.filter(c => c.dates.some(d => d.start > today));
  const adult = camps.filter(c => !/kids/i.test(c.type) && c.price !== null);
  const kids = camps.filter(c => /kids/i.test(c.type) && c.price !== null);
  const fmt = (n: number) => n.toLocaleString('en-US');
  const priceOf = (xs: ElCamp[]) => {
    if (!xs.length) return null;
    const ps = [...new Set(xs.map(c => c.price!))].sort((a, b) => a - b);
    return `${xs[0].currency} ${ps.map(fmt).join(' to ')}`;
  };
  const typeList = (xs: ElCamp[]) => {
    const names = xs.map(c => {
      const n = c.type.replace(/\s*\((?:co-ed)\)/i, '').replace(/\s*Camp$/i, '').toLowerCase();
      return /co-ed/i.test(c.type) && !/^co-ed/.test(n) ? `co-ed ${n}` : n;
    });
    return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0] ?? '';
  };
  const tax = camps.find(c => c.tax)?.tax?.replace(/^\+\s*tax\s*\(([^)]*)\)$/i, 'plus $1') ?? null;

  const summary = [
    `Elevation Kite and Wing Center runs 3-day kite and wing foil camps on the campground beach of Nitinat Lake on the west coast of Vancouver Island, British Columbia${season ? `, where the wind season runs ${season[1]} to ${season[2]}` : ''}${knots ? ` with winds of usually ${knots[1]} to ${knots[2]} knots` : ''}.`,
    future.length
      ? `${year ? `Summer ${year} ` : ''}camps: ${typeList(future)} camps${adult.length ? `, at ${priceOf(adult)}${tax ? ` ${tax}` : ''} per person` : ''}${kids.length ? ` (kids ${priceOf(kids)}${kidsAge ? `, ages ${kidsAge[1]} to ${kidsAge[2]}` : ''})` : ''}.`
      : `Camps run every summer; the next dates are not published yet${year ? ` (last printed: summer ${year})` : ''}.`,
    `Lessons are watercraft assisted${hours ? ` and run from ${hours[1]} to ${hours[2]}` : ''}, with all kite and wing gear supplied; students bring a 4 to 5 mm wetsuit, booties and lunch.`,
    'Accommodation is not included: guests camp at the Nitinat Lake campground on the same beach (run by the Ditidaht Nation, booked separately and before the lessons).',
  ].join(' ');

  return {
    kind: 'course',
    title: 'Elevation Kite and Wing Center - Nitinat Lake Kite and Wing Camps',
    summary,
    continent: 'North America',
    country: 'Canada',
    region: 'Nitinat Lake, Vancouver Island',
    spot: 'Nitinat Lake',
    itinerarySpots: [],
    durationDays: CAMP_DAYS,
    // women's camp page: "3 days of lessons catered to beginners and intermediate"
    skillLevels: /beginners and intermediate/i.test(all) ? ['beginner', 'intermediate'] : ['beginner'],
    kiteLessons: true,
    equipmentRental: null,
    beginnerFriendly: true,
    includedServices: [
      '3 days of group instruction (kite or wing foil), watercraft assisted',
      ...(/supply all (?:of )?the (?:latest )?(?:kiteboarding )?(?:equipment|gear)|provide all the kiteboarding equipment/i.test(all) ? ['All kite / wing equipment (latest Duotone kites and boards)'] : []),
      ...(/Tow behind the jet skis/i.test(all) ? ['Wing camps: tow behind the jet skis on calm mornings'] : []),
    ],
    optionalServices: [
      'Camping at the Nitinat Lake (Windsurf Park) campground on the kite beach, booked separately with the Ditidaht Nation',
      'Wetsuits and gear from the Elevation store',
    ],
    accommodation: null,
    mealPlan: null,
    languages: ['en'],
    rooms: [],
    imageUrls: elPhotos([
      { html: p.nitinat, url: EL_NITINAT_URL },
      { html: p.women, url: EL_WOMEN_URL },
      { html: p.wing, url: EL_WING_URL },
    ]),
    heroVideoUrl: null,
    sourceUrl: EL_NITINAT_URL,
    bookingUrl: EL_BOOKING_URL,
    sourceText: [
      `nitinat: ${nit.join(' | ')}`,
      `women: ${women.filter(l => /Nitinat|3 days|beginners|runs from|watercraft|equipment|Day \d/i.test(l)).join(' | ')}`,
      `wing: ${wing.filter(l => /Nitinat|Includes|years old|\$/i.test(l)).join(' | ')}`,
      `camps: ${camps.map(c => `${c.type} ${c.currency} ${c.price} [${c.dates.map(d => d.start).join(', ')}]`).join('; ')}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------
export const elevationNitinatLakeKiteWingCamps: OfferAdapter = {
  key: 'elevation-nitinat-lake-kite-wing-camps',
  name: 'Elevation Kite and Wing Center - Nitinat Lake Kite and Wing Camps',
  kind: 'course',
  disciplines: ['kitesurf', 'wingfoil'],
  operator: {
    name: 'Elevation Kite and Wing Center',
    websiteUrl: `${SITE}/`,
    rootDomain: 'elevationkiteboarding.com',
    contactEmail: 'lessons@elevationkiteboarding.com', // /pages/book-your-lesson mailto, 2026-10-23
    phone: '+16048485197',                             // "In Canada ... (604) 848-5197 from May to September"
  },
  url: EL_NITINAT_URL,
  slotMethod: 'html_dates',
  instantBooking: false,
  fetchBudget: 4,
  async fetchContent() {
    const [nitinat, women, wing] = [await page(EL_NITINAT_URL), await page(EL_WOMEN_URL), await page(EL_WING_URL)];
    return parseElContent({ nitinat, women, wing }, todayIso());
  },
  async fetchSlots(ctx) {
    const camps = parseElCamps(await page(EL_NITINAT_URL));
    if (camps.length < 3 || camps.every(c => c.dates.length === 0)) {
      throw new Error(`elevation: camp blocks or date lists not found (${camps.length} camps parsed; layout changed?)`);
    }
    const slots = buildElSlots(camps, todayIso());
    if (slots.length === 0) ctx.note(`all printed camp dates are past (${camps.map(c => c.heading).join('; ')}); next dates not published yet`);
    return slots;
  },
};
