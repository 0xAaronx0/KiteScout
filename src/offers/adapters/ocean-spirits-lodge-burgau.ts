// ---------------------------------------------------------------------------
// The Ocean Spirits Lodge, Burgau (Algarve, Portugal) - guesthouse of Kiteschool Portugal (VDWS/IKO kite,
// SUP and surf school): 3 suites with balcony, 2 suites, 1 dorm with 8 bunk beds, shared kitchen.
//
// Data path (checked 2026-10-12): WordPress (X theme / Cornerstone), server-rendered:
//   content  /the-ocean-spirits-kitesurf-camp/ (room headlines h2.h-custom-headline + <ul>, facilities,
//            price table) + / (school: VDWS + IKO instructors, North equipment, lessons for ages 14-75).
//   slots    "Lodge Prices - Stay only" <table class="custom-table"> on the lodge page: header = month
//            groups ("March, Nov, Dec" | "April, May, Oct" | "June, Sept" | "July, August"), rows = Dorm /
//            Suite / Suite w/ balcony, cells "30€". Note under it: "Prices per room based on 2 people
//            sharing private rooms / prices include the use of fully equipped kitchen".
//            The table has no year: we take it from the page's JSON-LD WebPage dateModified (2026-03-19 on
//            2026-10-12; the same edit uploaded a new 2026/03 header photo), so the bands are the 2026
//            season and roll forward when the school edits the page again.
// 2026/27 operation: lodge, home and packages pages edited 2026-03-19; booking-request form live
//   (/booking-form/, arrival/departure fields). No text names 2026 or 2027 explicitly.
// Booking: request form, WhatsApp (+351 932 839 003) -> no inventory; availability 'unknown'.
// robots.txt (2026-10-12): Yoast default, nothing disallowed.
// Requests per run: content 2, slots 1 (memoised: 0 extra when content ran in the same process).
// Parsed: slot = unit x run of consecutive months with the same price column in the table year
//   ("suite|2026-11" = 2026-11-01..2026-12-31), EUR per night; suites per room for 2 persons, the dorm per
//   bed (inferred: the note prices private rooms per room; a dorm is sold per bed). Months not in the
//   table (January, February) get no slot.
// Known limits: year inferred from the page edit date (see above); camp packages (7 nights + lessons,
//   /packages/) are not modelled.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, detectCurrency, imageCandidates, iso, ldOfType, monthOf, parse, parseAmount, todayIso, type HTMLElement } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://kiteschoolportugal.com';
export const OSL_PAGE_URL = `${SITE}/the-ocean-spirits-kitesurf-camp/`;
export const OSL_HOME_URL = `${SITE}/`;
const BOOKING_URL = `${SITE}/booking-form/`;

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
const keyPart = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const lastDay = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate();
function pageText(html: string): string {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, svg, header, footer, nav')) el.remove();
  return collapse((root.querySelector('main') ?? root.querySelector('.x-main') ?? root.querySelector('body') ?? root).text);
}

// --- pure parsers -----------------------------------------------------------------------------
export interface OslRate { unit: string; months: number[]; label: string; amount: number; currency: string }

/** "Lodge Prices - Stay only" table: one rate per unit x month-group column. */
export function parseOslRates(html: string): OslRate[] {
  const table = parse(html).querySelectorAll('table').find(t => /dorm/i.test(t.text) && /suite/i.test(t.text));
  if (!table) return [];
  const heads = table.querySelectorAll('thead th').map(th => collapse(th.text)).slice(1);
  const groups = heads.map(h => h.split(/,|\band\b/).map(w => monthOf(w.trim())).filter((m): m is number => m !== null));
  const out: OslRate[] = [];
  for (const tr of table.querySelectorAll('tbody tr')) {
    const cells = tr.querySelectorAll('td').map(td => collapse(td.text));
    const unit = cells[0];
    if (!unit) continue;
    cells.slice(1).forEach((c, i) => {
      const amount = parseAmount(c);
      if (!amount || !groups[i]?.length) return;
      out.push({ unit, months: groups[i], label: heads[i], amount, currency: detectCurrency(c) ?? 'EUR' });
    });
  }
  return out;
}

/** Year the table applies to: the page's last edit (JSON-LD WebPage dateModified / article:modified_time). */
export function oslTableYear(html: string): number | null {
  const wp = ldOfType(html, 'WebPage').find(o => typeof o.dateModified === 'string');
  const d = (wp?.dateModified as string | undefined) ?? html.match(/article:modified_time" content="(\d{4}-\d{2}-\d{2})/)?.[1];
  return d && /^\d{4}/.test(d) ? Number(d.slice(0, 4)) : null;
}

/** One slot per unit and run of consecutive months that share a price column. */
export function buildOslSlots(rates: OslRate[], year: number): Slot[] {
  const out: Slot[] = [];
  for (const unit of [...new Set(rates.map(r => r.unit))]) {
    const byMonth = new Map<number, OslRate>();
    for (const r of rates.filter(x => x.unit === unit)) for (const m of r.months) byMonth.set(m, r);
    const months = [...byMonth.keys()].sort((a, b) => a - b);
    const runs: Array<{ from: number; to: number; rate: OslRate }> = [];
    for (const m of months) {
      const last = runs[runs.length - 1];
      if (last && last.to === m - 1 && last.rate === byMonth.get(m)) last.to = m;
      else runs.push({ from: m, to: m, rate: byMonth.get(m)! });
    }
    const dorm = /dorm/i.test(unit);
    for (const run of runs) {
      out.push({
        key: `${keyPart(unit)}|${year}-${String(run.from).padStart(2, '0')}`,
        startDate: iso(year, run.from, 1),
        endDate: iso(year, run.to, lastDay(year, run.to)),
        unit,
        price: run.rate.amount,
        currency: run.rate.currency,
        priceUnit: 'per_night',
        priceBasis: dorm ? 'person' : 'room',
        occupancy: dorm ? 1 : 2,
        availability: 'unknown',
        availabilityText: null,
        spotsLeft: null,
      });
    }
  }
  return out;
}

/** Room headlines (h2.h-custom-headline) with the bullet list that follows each. */
export function parseOslRooms(html: string): Array<{ name: string; features: string[] }> {
  const out: Array<{ name: string; features: string[] }> = [];
  for (const h2 of parse(html).querySelectorAll('h2.h-custom-headline')) {
    const name = collapse(h2.text);
    if (!/^(suite|dorm)/i.test(name)) continue;
    let el: HTMLElement | null = h2.nextElementSibling;
    let features: string[] = [];
    while (el && el.tagName !== 'H2') {
      const lis = el.querySelectorAll('li');
      if (lis.length) { features = lis.map(li => collapse(li.text)).filter(Boolean); break; }
      el = el.nextElementSibling;
    }
    out.push({ name, features });
  }
  return out;
}

/** Facilities list under "Ocean Spirit Kite camp Facilities". */
export function parseOslFacilities(html: string): string[] {
  const h2 = parse(html).querySelectorAll('h2').find(h => /camp Facilities/i.test(h.text));
  let sec: HTMLElement | null = h2 ?? null;
  while (sec && !sec.classList.contains('x-section')) sec = sec.parentNode as HTMLElement | null;
  return sec ? sec.querySelectorAll('li').map(li => collapse(li.text)).filter(Boolean) : [];
}

export interface OslPages { lodge: string; home: string }

export function parseOceanSpiritsContent(p: OslPages): OfferContent {
  const lodge = pageText(p.lodge);
  const home = pageText(p.home);
  const rates = parseOslRates(p.lodge);
  const facilities = parseOslFacilities(p.lodge);
  const roomLists = parseOslRooms(p.lodge);
  const eur = (n: number) => `€${n}`;
  const rateUnit = (roomName: string) => roomName.replace(/\s+Room$/i, '');

  const rooms: ContentRoom[] = roomLists.map(r => ({
    name: r.name,
    description: null,
    features: [
      ...r.features,
      ...rates.filter(x => x.unit.toLowerCase() === rateUnit(r.name).toLowerCase())
        .map(x => `${x.label}: ${eur(x.amount)} per night${/dorm/i.test(x.unit) ? ' per bed' : ' per room (2 persons)'}`),
    ],
  }));
  const min = rates.length ? Math.min(...rates.map(r => r.amount)) : null;
  const max = rates.length ? Math.max(...rates.map(r => r.amount)) : null;

  const seen = new Set<string>();
  const imageUrls: string[] = [];
  for (const u of [...imageCandidates(p.lodge, OSL_PAGE_URL, null, 60), ...imageCandidates(p.home, OSL_HOME_URL, null, 40)]) {
    if (/\.svg|logo|icon|ProfilePic|kiteschool-touch|social-share|package20\d\d|-\d+x\d+\.(?:jpe?g|png)$/i.test(u)) continue;
    // WordPress crops (-e1496400609401) and -scaled copies of the same photo count once
    const k = u.replace(/-(?:scaled|e\d{10,})(?=\.[a-z]+$)/i, '');
    if (seen.has(k)) continue;
    seen.add(k); imageUrls.push(u);
  }

  const summary = [
    'The Ocean Spirits Lodge is the guesthouse of Kiteschool Portugal in Burgau, a village on the southwest Algarve coast between Lagos and Sagres, 700 m from the beach.',
    `It has 3 suites with balconies, 2 suites and a dorm with 8 bunk beds, a fully equipped shared kitchen, a garden with hammocks, a bar and a yoga studio${min !== null ? `; stay-only prices run from ${eur(min)} per dorm bed to ${eur(max!)} per suite per night depending on the month (March to December)` : ''}.`,
    'The school teaches kitesurfing, SUP and surfing with VDWS- and IKO-certified instructors and North equipment, rents kite, surf and SUP gear and picks guests up for lessons.',
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'The Ocean Spirits Lodge',
    summary,
    continent: 'Europe',
    country: 'Portugal',
    region: 'Algarve',
    spot: 'Burgau',
    spotCoords: { lat: 37.0733, lng: -8.7745 }, // Burgau village; "Burgau, Algarve" does not geocode (2026-10-12)
    itinerarySpots: [],
    durationDays: null,
    // home: "Kite lessons for all levels and ages from 14 to 75"
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: /Kite lessons for all levels/i.test(home),
    equipmentRental: facilities.some(f => /gear rental/i.test(f)),
    beginnerFriendly: /all levels/i.test(home),
    includedServices: ['Towels and linen', 'Use of the fully equipped kitchen', 'Wi-Fi', 'Free bicycles'],
    optionalServices: [
      'Kitesurf, SUP and surf lessons with pick-up and drop-off',
      'Kite, surf and SUP gear rental',
      'Dinners by the in-house chef (2-3 nights per week)',
      'Yoga in the garden studio',
      'Camp packages: 7 nights at the lodge with kite, surf, SUP or yoga activities',
    ],
    accommodation: 'guesthouse with suites and an 8-bunk dorm',
    mealPlan: 'self_catering',
    languages: ['en', 'de'],
    rooms,
    imageUrls: imageUrls.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: OSL_PAGE_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      `rates (${oslTableYear(p.lodge) ?? 'year ?'}): ${rates.map(r => `${r.unit} ${r.label} ${r.amount} ${r.currency}`).join('; ')}`,
      `rooms: ${roomLists.map(r => `${r.name}: ${r.features.join(' / ')}`).join(' | ')}`,
      `facilities: ${facilities.join(' | ')}`,
      `lodge page: ${lodge}`,
      `home: ${home}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const oceanSpiritsLodgeBurgau: OfferAdapter = {
  key: 'ocean-spirits-lodge-burgau',
  name: 'The Ocean Spirits Lodge Burgau',
  kind: 'accommodation',
  operator: {
    name: 'Kiteschool Portugal',
    websiteUrl: SITE,
    rootDomain: 'kiteschoolportugal.com',
    whatsapp: '+351932839003',
    phone: '+351932839003',
  },
  url: OSL_PAGE_URL,
  slotMethod: 'price_table',
  fetchBudget: 3,
  confidence: 'medium', // the table year is inferred from the page's last edit
  async fetchContent() {
    const [lodge, home] = [await page(OSL_PAGE_URL), await page(OSL_HOME_URL)];
    return parseOceanSpiritsContent({ lodge, home });
  },
  async fetchSlots(ctx) {
    const html = await page(OSL_PAGE_URL);
    const rates = parseOslRates(html);
    if (rates.length < 9) throw new Error(`ocean-spirits: stay-only price table not found or changed (${rates.length} rates parsed)`);
    const year = oslTableYear(html);
    if (!year) throw new Error('ocean-spirits: page dateModified (table year) not found');
    const slots = buildOslSlots(rates, year);
    if (slots.every(s => s.endDate! < todayIso())) ctx.note(`price table last edited in ${year}: every band is in the past (waiting for new prices)`);
    return slots;
  },
};
