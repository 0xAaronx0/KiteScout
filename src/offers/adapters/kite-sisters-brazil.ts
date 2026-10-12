// ---------------------------------------------------------------------------
// Offer adapter: Kite Sisters Boutique Kitesurf Retreat Brazil, Moitas (Ceará).
//
// Data path: ONE page, https://kite-sisters.com/kitesurf-retreat/brazil-october-november/ (WordPress +
//   Elementor). The old URL /kite-camps/brazil-october-november/ redirects here (2026-10-09); the
//   un-hyphenated kitesisters.com has certificate errors, the hyphenated domain is the real one.
//   Weeks are <li> items "Week 1: October 25th – November 1st, 2026 → Co-Ed/Couples. 2 spots have just
//   opened!" under year headings ("2026 Dates. Reservations open."). Booking = quote request (Contact
//   Form 7 on the page), no booking engine, no prices on the page.
// robots.txt kite-sisters.com (checked 2026-10-09): only /wp-admin/ disallowed.
// Requests per run: 1 (content + slots share one memoised page fetch).
// Slots: one per week, unit 'women' | 'co-ed', key `<unit>|<start>`, price null (on request),
//   availability from the week's own words: "SOLD OUT" -> sold_out, "N spots have just opened/left"
//   -> limited (spotsLeft N), no words -> on_request (inquiry-only), text = the year heading's words.
// Known limits: Elementor widgets hidden on every device are dropped (the stale "2025 Dates" list
//   sits in one on 2026-10-09). Pre-sale/early-bird discounts ($500/$250) are text only, no price.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { parse, collapse, parseRange, availabilityFromText, imageCandidates, meta, type HTMLElement } from '../parse.js';
import type { Availability, OfferAdapter, OfferContent, Slot } from '../types.js';

export const KITE_SISTERS_URL = 'https://kite-sisters.com/kitesurf-retreat/brazil-october-november/';

// --- local helpers ----------------------------------------------------------------
const memo = new Map<string, { at: number; p: Promise<string> }>();
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url);
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}
const txt = (el: HTMLElement | null | undefined): string => collapse(el?.text ?? '');
function isHiddenEverywhere(el: HTMLElement): boolean {
  const c = el.getAttribute('class') ?? '';
  return /\belementor-hidden-desktop\b/.test(c) && /\belementor-hidden-tablet\b/.test(c) && /\belementor-hidden-mobile\b/.test(c);
}
/** Parse and drop scripts/styles plus Elementor elements hidden on every device. */
export function visibleRoot(html: string): HTMLElement {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, template')) el.remove();
  for (const el of root.querySelectorAll('.elementor-element').filter(isHiddenEverywhere)) el.remove();
  return root;
}
/** Elements in document order (headings + list items), independent of selector-engine ordering. */
function walk(el: HTMLElement, out: HTMLElement[] = []): HTMLElement[] {
  for (const n of el.childNodes) {
    const e = n as HTMLElement;
    if (!e.tagName) continue;
    if (/^(H2|H3|H4|H5|LI)$/.test(e.tagName)) out.push(e);
    walk(e, out);
  }
  return out;
}

/** "October 25th – November 1st, 2026" / "November 7th – 14th, 2026" / "October 16th to 23rd 2027" */
export function weekRange(text: string): { start: string; end: string } | null {
  const t = text.replace(/(\d)(st|nd|rd|th)\b/gi, '$1').replace(/\s+to\s+/gi, ' - ').replace(/[–—]/g, '-').replace(/,/g, ' ');
  return parseRange(t);
}

export interface WeekStatus { availability: Availability; text: string | null; spotsLeft: number | null }
/** The week's own words; inquiry-only booking means no words = on_request. */
export function weekStatus(rest: string, heading: string | null): WeekStatus {
  if (/sold[\s-]?out/i.test(rest)) return { availability: 'sold_out', text: rest.match(/sold[\s-]?out/i)![0], spotsLeft: null };
  const opened = rest.match(/\b(\d+|one|two|three|four|five|few)\s+(?:spot|place|room)s?\s+(?:have\s+)?(?:just\s+)?(?:opened|left|remaining|available)\b[^.!]*[.!]?/i);
  if (opened) {
    const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
    const n = words[opened[1].toLowerCase()] ?? (Number.isFinite(Number(opened[1])) ? Number(opened[1]) : null);
    return { availability: 'limited', text: opened[0].trim(), spotsLeft: n };
  }
  const generic = availabilityFromText(rest);
  if (generic && generic !== 'available') return { availability: generic, text: collapse(rest), spotsLeft: null };
  const open = heading?.match(/reservations open/i)?.[0] ?? null;
  return { availability: 'on_request', text: open, spotsLeft: null };
}

// --- slots ------------------------------------------------------------------------
export function parseKiteSistersSlots(html: string): Slot[] {
  const root = visibleRoot(html);
  const post = root.querySelector('[data-elementor-type="wp-post"]') ?? root;
  const slots: Slot[] = [];
  let heading: string | null = null;
  for (const el of walk(post)) {
    if (el.tagName !== 'LI') { heading = txt(el); continue; }
    const t = txt(el);
    const m = t.match(/^Week\s*\d+\s*:\s*(.+)$/i);
    if (!m) continue;
    const [datePart, ...restParts] = m[1].split(/\s*→\s*|\s*->\s*/);
    const range = weekRange(datePart);
    if (!range) continue;
    const rest = restParts.join(' ');
    const unit = /women/i.test(rest) ? 'women' : /co-?ed|couples/i.test(rest) ? 'co-ed' : null;
    const st = weekStatus(rest.replace(/^(Co-Ed\/Couples|Women Only)\.?\s*/i, ''), heading);
    slots.push({
      key: unit ? `${unit}|${range.start}` : range.start,
      startDate: range.start,
      endDate: range.end,
      unit,
      price: null,          // no prices on the page: quote on request
      currency: null,
      priceUnit: null,
      priceBasis: null,
      occupancy: null,
      availability: st.availability,
      availabilityText: st.text,
      spotsLeft: st.spotsLeft,
    });
  }
  if (slots.length === 0) throw new Error('kite-sisters: no "Week N:" dates found (page layout changed?)');
  return slots;
}

// --- content ----------------------------------------------------------------------
export function parseKiteSistersContent(html: string, url = KITE_SISTERS_URL): OfferContent {
  const root = visibleRoot(html);
  const post = root.querySelector('[data-elementor-type="wp-post"]') ?? root;
  const text = txt(post);

  // visible "...: What is included?" heading widget -> next text widget -> one <li> per inclusion
  // (2026-10-09: "Group transfer from Fortaleza Airport ...", "6 x Kitesurfing / Kiteboarding Lessons & Coaching: ...")
  const incHead = post.querySelectorAll('h2, h3, h4, h5').find(h => /what is included/i.test(txt(h)) && !/not included/i.test(txt(h)));
  const incWidget = incHead?.closest('.elementor-element')?.nextElementSibling ?? null;
  const includedServices = (incWidget?.querySelectorAll('li') ?? []).map(li => {
    const t = txt(li);
    const label = t.match(/^([^:]{3,70}):/)?.[1];
    return (label ?? t.match(/^.+?[.!](?=\s|$)/)?.[0] ?? t).replace(/[.!]$/, '').trim();
  }).filter(Boolean);
  const incText = includedServices.join(' ');

  const lessons = text.match(/(\d+)\s*x\s*Kitesurfing/i)?.[1];
  const maxGroup = text.match(/maximum of (\d+) women/i)?.[1];
  const nights = Number(text.match(/(\d+)\s*Nights (?:at the Kite Sisters Villas|accommodation)/i)?.[1] ?? 7);
  const spot = /Villas in Moitas/i.test(text) ? 'Moitas' : null;
  const titleBase = /Boutique Kitesurf Retreat Brazil/i.test(text) ? 'Kite Sisters Boutique Kitesurf Retreat Brazil' : (meta(html, 'og:title') ?? 'Kite Sisters Kitesurf Retreat Brazil');

  // stable facts from the page (2026-10-09), sentences composed here
  const summary = [
    `Kite Sisters' boutique kitesurf retreat${spot ? ` in ${spot}` : ''} on the windy coast of Ceará in northeast Brazil, with flat-water lagoons, open ocean and daily trade wind in October and November.`,
    `A week includes ${nights} nights in a beachfront villa (double or single occupancy), all gourmet meals, ${lessons ?? 'daily'} kitesurf lessons with IKO-certified coaches and North/Mystic gear, morning yoga, off-water workshops, 4x4 trips to the spots and transfers from Fortaleza airport.`,
    `Weeks are women-only or co-ed for couples, groups are small${maxGroup ? ` (max ${maxGroup})` : ''}, and prices are given on request.`,
  ].join(' ');

  return {
    kind: 'camp',
    title: titleBase,
    summary,
    continent: 'South America',
    country: 'Brazil',
    region: 'Ceará', // Moitas (Amontada) is in Ceará; the page names Fortaleza airport and Moitas
    spot,
    itinerarySpots: [],
    durationDays: nights + 1,
    skillLevels: /all levels|full beginner or an advanced rider/i.test(text) ? ['beginner', 'intermediate', 'advanced'] : [],
    kiteLessons: true,
    equipmentRental: /gear|equipment/i.test(incText) || null,
    beginnerFriendly: /full beginner|beginner or an advanced/i.test(text),
    includedServices,
    optionalServices: /Wingfoil package/i.test(text) ? ['Wing foil package (separate page)'] : [],
    accommodation: 'Beachfront boutique villa with pool (Kite Sisters Villas), double or single occupancy',
    mealPlan: /all gourmet meals|from breakfast (through )?to dinner/i.test(incText) ? 'full_board' : null,
    languages: ['en'], // English-only site (2026-10-09)
    rooms: [],
    imageUrls: imageCandidates(html, url, null, 40),
    heroVideoUrl: null, // only a YouTube link in a hidden widget
    sourceUrl: url,
    bookingUrl: url,    // the quote form lives on the page
    sourceText: text,
  };
}

export const kiteSistersBrazil: OfferAdapter = {
  key: 'kite-sisters-brazil',
  name: 'Kite Sisters - Boutique Kitesurf Retreat Brazil (Moitas)',
  kind: 'camp',
  operator: {
    name: 'Kite Sisters',
    websiteUrl: 'https://kite-sisters.com/',
    rootDomain: 'kite-sisters.com',
  },
  url: KITE_SISTERS_URL,
  slotMethod: 'html_dates',
  fetchBudget: 3,
  async fetchContent() {
    return parseKiteSistersContent(await page(KITE_SISTERS_URL), KITE_SISTERS_URL);
  },
  async fetchSlots() {
    return parseKiteSistersSlots(await page(KITE_SISTERS_URL));
  },
};
