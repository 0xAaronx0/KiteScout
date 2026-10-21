// ---------------------------------------------------------------------------
// Kite Sisters - "Essential Kiteboarding Camp Peru" (North Shore Peru, Piura): a women-only kite camp week of the
// Kite Sisters (the catalog has their Brazil retreat, kite-sisters-brazil.ts, whose page helpers are imported; the
// Morocco adapter is NOT touched). 7 nights in the beachfront Kite Sisters Villa (pool, single / double / triple
// occupancy), all meals by a chef, kite lessons for beginners and intermediates (gear included) or daily group
// clinics and downwinders for advanced riders, morning yoga, workshops, IKO certification, transfer from Piura
// airport. Max 13 women. Part of the cheaper "Essential Kite Camps" line. KIND = 'camp'.
//
// Data path (checked 2026-10-21): ONE WordPress + Elementor page /kite-camps/mancora-northshore-peru-october/.
//   dates    visible <h5> headings "2026 Dates: October 3rd to 10th 2026. New spots have opened!" and "2027 Dates:
//            October 2nd to 9th 2027." each followed by its own notes (waitlist sentence; "Pre-sale: Book your spot
//            before March 2nd 2027 and get $400 off.", "Early bird: Book your spot before June 1st 2027 and get $200
//            off."). A hidden Elementor duplicate (old "2025 Date" + a second description) is dropped with the
//            Brazil adapter's visibleRoot(). Any new "<year> Dates:" heading is picked up.
//   price    none printed: "Request a Quote" (Contact Form 7 on the page) -> price null, 'on_request'. The pre-sale /
//            early-bird discounts are kept as availabilityText (no base price to apply them to).
//   content  the same page: "What is included?" list, group size ("only 13 women per week"), photo carousel.
// Past dates never become slots: on 2026-10-21 the 2026 week (3-10 Oct) is past -> 1 slot (2-9 Oct 2027).
// Place: the page names "North Shore Peru" and Piura airport only; the URL slug says "mancora-northshore" -> spot
//   "Máncora", region "Piura" (as wild-kite-peru-la-maison-mancora.ts). No coordinates on the page.
// robots.txt (2026-10-21): only /wp-admin/ disallowed. Requests per run: 1 (memoised).
// Flags: liveAvailability no (page text), instantBooking false (quote request).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { availabilityFromText, collapse, imageCandidates, parseDate, todayIso, type HTMLElement } from '../parse.js';
import type { Availability, OfferAdapter, OfferContent, Slot } from '../types.js';
import { visibleRoot, weekRange } from './kite-sisters-brazil.js';

export const KS_PERU_URL = 'https://kite-sisters.com/kite-camps/mancora-northshore-peru-october/';

const memo = new Map<string, { at: number; p: Promise<string> }>();
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url);
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}
const txt = (el: HTMLElement | null | undefined): string => collapse(el?.text ?? '').replace(/\s*[—–]\s*/g, ' - ');
/** Headings, paragraphs and list items in document order. */
function walk(el: HTMLElement, out: HTMLElement[] = []): HTMLElement[] {
  for (const n of el.childNodes) {
    const e = n as HTMLElement;
    if (!e.tagName) continue;
    if (/^(H2|H3|H4|H5|P|LI)$/.test(e.tagName)) { out.push(e); continue; }
    walk(e, out);
  }
  return out;
}
function post(html: string): HTMLElement {
  const root = visibleRoot(html);
  return root.querySelector('[data-elementor-type="wp-post"]') ?? root;
}

export interface KsWeek { start: string; end: string; status: string; notes: string[] }

/** "<year> Dates: October 2nd to 9th 2027. <status>" headings + the paragraphs / items up to the next heading. */
export function parseKsPeruWeeks(html: string): KsWeek[] {
  const els = walk(post(html));
  const out: KsWeek[] = [];
  for (let i = 0; i < els.length; i++) {
    if (!/^H[2-5]$/.test(els[i].tagName)) continue;
    const m = txt(els[i]).match(/^(20\d{2})\s+Dates?\s*:\s*(.+?\b20\d{2})\.?\s*(.*)$/i);
    if (!m) continue;
    const range = weekRange(m[2]);
    if (!range) continue;
    const notes: string[] = [];
    for (let j = i + 1; j < els.length && !/^H[2-5]$/.test(els[j].tagName); j++) { const t = txt(els[j]); if (t) notes.push(t); }
    out.push({ start: range.start, end: range.end, status: m[3].trim(), notes });
  }
  return out;
}

/** The heading's own words decide; notes only when they carry a hard signal for this week. */
export function ksPeruAvailability(w: KsWeek): { availability: Availability; text: string | null } {
  const own = availabilityFromText(w.status);
  if (own === 'sold_out' || own === 'waitlist' || own === 'limited') return { availability: own, text: w.status };
  if (!w.status) {
    const fromNotes = availabilityFromText(w.notes.join(' '));
    if (fromNotes === 'sold_out' || fromNotes === 'waitlist') return { availability: fromNotes, text: w.notes.join(' ') };
  }
  return { availability: 'on_request', text: w.status || null };
}

/** "Pre-sale: Book your spot before March 2nd 2027 and get $400 off." -> "Pre-sale: book before 2027-03-02, $400 off" */
export function ksDiscounts(notes: string[]): string[] {
  const out: string[] = [];
  for (const n of notes) {
    const m = n.match(/^([A-Za-z -]+):\s*Book your spot before (.+?\d{4}) and get (\$\s?[\d,]+) off/i);
    if (!m) continue;
    const d = parseDate(m[2].replace(/(\d)(st|nd|rd|th)\b/g, '$1'));
    out.push(`${m[1].trim()}: book before ${d ?? m[2]}, ${m[3].replace(/\s/g, '')} off`);
  }
  return out;
}

export function buildKsPeruSlots(weeks: KsWeek[], today: string): Slot[] {
  return weeks.filter(w => w.start >= today).map(w => {
    const st = ksPeruAvailability(w);
    const disc = ksDiscounts(w.notes);
    return {
      key: `women|${w.start}`,
      startDate: w.start,
      endDate: w.end,
      unit: 'women',
      price: null,            // no price printed: "Request a Quote"
      currency: null,
      priceUnit: null,
      priceBasis: null,
      occupancy: null,
      availability: st.availability,
      availabilityText: [st.text, ...disc].filter(Boolean).join('; ') || null,
      spotsLeft: null,
    };
  });
}

export function parseKsPeruContent(html: string, today: string): OfferContent {
  const p = post(html);
  const text = txt(p);
  const els = walk(p);
  const incAt = els.findIndex(e => /^H[2-5]$/.test(e.tagName) && /what is included/i.test(txt(e)) && !/not included/i.test(txt(e)));
  const includedServices: string[] = [];
  for (let j = incAt + 1; incAt >= 0 && j < els.length && !/^H[2-5]$/.test(els[j].tagName); j++) {
    if (els[j].tagName !== 'LI') continue;
    const t = txt(els[j]);
    const label = t.match(/^([^:]{3,70}):/)?.[1];
    includedServices.push((label ?? t.match(/^.+?[.!](?=\s|$)/)?.[0] ?? t).replace(/[.!]$/, '')
      .replace(/,\s*(?:ensuring|providing|right at)\b.*$/i, '').replace(/\s+(?:designed to|crafted by)\b.*$/i, '').trim());
  }
  const nights = Number(text.match(/(\d+)\s+nights accommodation/i)?.[1] ?? 7);
  const maxGroup = text.match(/only (\d+) women per week/i)?.[1] ?? null;
  const weeks = parseKsPeruWeeks(html);
  const future = weeks.filter(w => w.start >= today);
  const dateSentence = future.length
    ? `Dates: ${future.map(w => `${w.start} to ${w.end}`).join(', ')}.`
    : `It runs every October; the next dates are not published yet${weeks.length ? ` (last printed: ${weeks[weeks.length - 1].start} to ${weeks[weeks.length - 1].end})` : ''}.`;
  const summary = [
    `Kite Sisters' Essential Kiteboarding Camp is a women-only kite week on the North Shore of Peru (Piura region), the cheapest camp of their calendar, based at the beachfront Kite Sisters Villa with pool, kite in and kite out.`,
    `It includes ${nights} nights in single, double or triple occupancy, all meals by the chef, IKO lessons with North and Mystic gear for beginners and intermediates or daily group clinics and downwinders for advanced riders, morning yoga, workshops and the transfer from Piura airport${maxGroup ? `, for at most ${maxGroup} women` : ''}.`,
    `Prices are given on request (quote form, pre-sale and early-bird discounts). ${dateSentence}`,
  ].join(' ');
  return {
    kind: 'camp',
    title: "Kite Sisters Essential Women's Kiteboarding Camp, North Shore Peru",
    summary,
    continent: 'South America',
    country: 'Peru',
    region: 'Piura',                   // as wild-kite-peru-la-maison-mancora.ts
    spot: 'Máncora',                   // URL slug "mancora-northshore"; the text says "North Shore Peru"
    itinerarySpots: [],
    durationDays: nights + 1,
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: true,
    equipmentRental: /Top-of-the-Line Gear/i.test(includedServices.join(' ')) || null, // gear included for beginner packages; "Gear Rental (Intermediate & Advanced Packages)" not included
    beginnerFriendly: /first time with a kite|beginners/i.test(text),
    includedServices,
    optionalServices: /Gear Rental \(Intermediate & Advanced Packages\)/i.test(text) ? ['Gear rental for intermediate and advanced packages', 'Private tours (whale watching)'] : [],
    accommodation: 'Beachfront Kite Sisters Villa with pool, single, double or triple occupancy',
    mealPlan: /All meals \(breakfast, lunch and dinner\)/i.test(text) ? 'full_board' : null,
    languages: ['en'],
    rooms: [],
    imageUrls: imageCandidates(html, KS_PERU_URL, null, 40),
    heroVideoUrl: null,
    sourceUrl: KS_PERU_URL,
    bookingUrl: KS_PERU_URL,           // the quote form is on the page
    sourceText: text,
  };
}

export const kiteSistersEssentialCampPeru: OfferAdapter = {
  key: 'kite-sisters-essential-camp-peru',
  name: "Kite Sisters - Essential Women's Kiteboarding Camp, North Shore Peru",
  kind: 'camp',
  operator: {
    name: 'Kite Sisters',
    websiteUrl: 'https://kite-sisters.com/',
    rootDomain: 'kite-sisters.com',
  },
  url: KS_PERU_URL,
  slotMethod: 'html_dates',
  instantBooking: false,
  fetchBudget: 2,
  async fetchContent() {
    return parseKsPeruContent(await page(KS_PERU_URL), todayIso());
  },
  async fetchSlots(ctx) {
    const weeks = parseKsPeruWeeks(await page(KS_PERU_URL));
    if (weeks.length === 0) throw new Error('kite-sisters-peru: no "<year> Dates:" headings found (layout changed?)');
    const today = todayIso();
    const past = weeks.filter(w => w.start < today);
    if (past.length) ctx.note(`${past.length} past week(s) dropped (${past.map(w => w.start).join(', ')})`);
    return buildKsPeruSlots(weeks, today);
  },
};
