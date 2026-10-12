// ---------------------------------------------------------------------------
// Offer adapter: LakeUnited Kitecamp Tunisia, Djerba lagoon (stay in Zarzis).
//
// Data path: ONE page, https://www.lakeunited.com/en/portfolio/kitecamp-tunisia-djerba (WordPress +
//   Elementor, server-rendered). Camp weeks are the "eael-feature-list" items ("03.04. - 10.04.2027 /
//   Kitecamp for all levels"); the price is the "Bestseller" box ("Djerba package 1 week in a double
//   room / EUR 2.090,-"); inclusions are the "Service overview" tab (Including / Excluding / Additionally).
//   Booking is inquiry-only: "Send request" -> /en/portfolio/kitecamps-request/?kitecamp=tu, then the
//   team mails a non-binding booking link. No booking engine, no inventory.
// robots.txt www.lakeunited.com (checked 2026-10-09): only /wp-admin/ and one plugin JSON disallowed.
// Requests per run: 1 (content + slots share one memoised page fetch).
// Slots: one per visible camp week (key = start date, unit 'Double room' = what the price covers),
//   priceUnit 'package', availability 'on_request' (inquiry-only), availabilityText = the CTA words.
// Known limits:
//   - Elementor widgets hidden on desktop, tablet AND mobile are invisible to every visitor; we drop
//     them. On 2026-10-09 the weeks 17.04.-24.04. and 24.04.-01.05.2027 sit in such a hidden widget
//     (EN and DE page alike), so only 2 of the 4 weeks are emitted; the hidden ones go to ctx.note.
//   - The price is shown for a double room only, and "per person" is not written next to it
//     (inferred from the package wording); single/triple room prices come with the booking link.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { parse, collapse, parseAmount, detectCurrency, parseRange, daysInclusive, imageCandidates, type HTMLElement } from '../parse.js';
import { upscaleCdnUrl } from '../../lib/images.js';
import type { ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

export const LAKEUNITED_URL = 'https://www.lakeunited.com/en/portfolio/kitecamp-tunisia-djerba';

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

/** Elementor elements hidden on every device are invisible to all visitors. */
export function isHiddenEverywhere(el: HTMLElement): boolean {
  const c = el.getAttribute('class') ?? '';
  return /\belementor-hidden-desktop\b/.test(c) && /\belementor-hidden-tablet\b/.test(c) && /\belementor-hidden-mobile\b/.test(c);
}
/** Parse and drop scripts/styles plus all-device-hidden Elementor elements (returns them for notes). */
export function visibleRoot(html: string): { root: HTMLElement; hidden: HTMLElement[] } {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, template')) el.remove();
  const hidden = root.querySelectorAll('.elementor-element').filter(isHiddenEverywhere);
  for (const el of hidden) el.remove();
  return { root, hidden };
}
/** "a, b (x, y), c" -> ["a", "b (x, y)", "c"] */
function splitTopLevel(s: string): string[] {
  const out: string[] = []; let depth = 0; let cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map(x => collapse(x)).filter(Boolean);
}
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

export interface CampWeek { start: string; end: string; label: string; raw: string }
/** Dated camp weeks ("03.04. - 10.04.2027") from the Elementor feature lists. */
export function campWeeks(root: HTMLElement): CampWeek[] {
  const out: CampWeek[] = [];
  for (const li of root.querySelectorAll('.eael-feature-list-item')) {
    const raw = txt(li.querySelector('.eael-feature-list-title'));
    if (!/\d{1,2}\.\d{1,2}\.\s*-\s*\d{1,2}\.\d{1,2}\.\d{4}/.test(raw)) continue;
    const r = parseRange(raw);
    if (!r) continue;
    out.push({ start: r.start, end: r.end, label: txt(li.querySelector('.eael-feature-list-content')), raw });
  }
  return out;
}

/** "Djerba package 1 week in a double room EUR 2.090,-" */
export function bestsellerPrice(text: string): { weeks: number; room: string; amount: number; currency: string } | null {
  const m = text.match(/package\s+(\d+)\s+weeks?\s+in\s+an?\s+(single|double|triple)\s+room\s*((?:€|EUR)\s*[\d.,]+)/i);
  if (!m) return null;
  const amount = parseAmount(m[3]);
  const currency = detectCurrency(m[3]);
  return amount && currency ? { weeks: Number(m[1]), room: `${cap(m[2].toLowerCase())} room`, amount, currency } : null;
}

// --- slots ------------------------------------------------------------------------
export function parseLakeUnitedSlots(html: string): { slots: Slot[]; hiddenWeeks: string[] } {
  const { root, hidden } = visibleRoot(html);
  const weeks = campWeeks(root);
  if (weeks.length === 0) throw new Error('lakeunited: no dated camp weeks found (page layout changed?)');
  const price = bestsellerPrice(txt(root));
  const cta = txt(root.querySelector('a[href*="kitecamps-request"]')) || 'Send request';
  const slots: Slot[] = [];
  const seen = new Set<string>();
  for (const w of weeks) {
    if (seen.has(w.start)) continue;
    seen.add(w.start);
    const oneWeek = daysInclusive(w.start, w.end) === 8;
    const priced = price && oneWeek && price.weeks === 1;
    slots.push({
      key: w.start,
      startDate: w.start,
      endDate: w.end,
      unit: price?.room ?? null,
      price: priced ? price!.amount : null,
      currency: priced ? price!.currency : null,
      priceUnit: 'package',
      priceBasis: 'person',  // camp package price; "p.p." not printed next to it (see header)
      occupancy: price?.room === 'Double room' ? 2 : null,
      availability: 'on_request',
      availabilityText: `${cta} (non-binding inquiry)`,
      spotsLeft: null,
    });
  }
  const hiddenWeeks = hidden.flatMap(h => campWeeks(h).map(w => w.raw));
  return { slots, hiddenWeeks };
}

// --- content ----------------------------------------------------------------------
export function parseLakeUnitedContent(html: string, url = LAKEUNITED_URL): OfferContent {
  const { root } = visibleRoot(html);
  const post = root.querySelector('[data-elementor-type="wp-post"]') ?? root;
  const text = txt(post);

  const service: Record<string, string[]> = {};
  for (const li of post.querySelectorAll('li')) {
    const label = txt(li.querySelector('strong'));
    if (!/^(including|excluding|additionally)$/i.test(label)) continue;
    const body = li.childNodes.slice(1).map(n => ((n as HTMLElement).tagName ? `, ${n.text}` : n.text)).join('');
    const items = splitTopLevel(collapse(parse(`<p>${body}</p>`).text));
    const uniq: string[] = [];
    for (const i of items) if (!uniq.some(u => u.toLowerCase() === i.toLowerCase())) uniq.push(i);
    service[label.toLowerCase()] = uniq.map(cap);
  }
  const nightsText = text.match(/(\d+)\s*or\s*(\d+)\s*nights/i);
  const nights = nightsText ? Number(nightsText[1]) : 7;
  const weeks = campWeeks(root);
  const price = bestsellerPrice(text);

  // rooms: "double rooms (with twin beds), triple rooms, or single rooms" (page, 2026-10-09)
  const rooms: ContentRoom[] = [];
  if (/double rooms? \(with twin beds\)/i.test(text)) rooms.push({ name: 'Double room', description: 'Twin beds, two rooms per bungalow around the pool', features: ['Twin beds'] });
  if (/triple rooms?/i.test(text)) rooms.push({ name: 'Triple room', description: null, features: [] });
  if (/single rooms?/i.test(text)) rooms.push({ name: 'Single room', description: null, features: [] });

  // images: og/content images + the Elementor Pro gallery (data-thumbnail, missed by discoverImageUrls);
  // team portraits are not offer photos
  const gallery = root.querySelectorAll('[data-thumbnail]').map(e => upscaleCdnUrl(new URL(e.getAttribute('data-thumbnail')!, url).toString()));
  const imageUrls = [...new Set([...imageCandidates(html, url, null, 40), ...gallery])]
    .filter(u => !/[-_]Team[-_.]|borlabs|recaptcha/i.test(u)); // "LU_Team_Domi", "Flo-LakeUnited-Team" (not "Teambus")

  const year = weeks[0]?.start.slice(0, 4);
  const summary = [
    'LakeUnited runs this kite camp on the large, shallow lagoon between Djerba and the Tunisian mainland, with steady side-onshore wind and flat water for all levels.',
    'The group stays in a family-run bungalow complex with pool in Zarzis, about 30 minutes from the kite stations, and drives to the spots in shared rental cars.',
    `A ${nights}-night week includes half board, kite and board rental, unlimited coaching and guided downwinders${price ? ` (EUR ${price.amount.toLocaleString('en-US')} in a double room)` : ''}.`,
    weeks.length ? `Camp weeks run in April${year ? ` ${year}` : ''}; booking is by non-binding request.` : 'Booking is by non-binding request.',
  ].join(' ');

  return {
    kind: 'camp',
    title: txt(root.querySelector('h1')) || 'Kite camp Tunisia - Kiting in the Djerba lagoon',
    summary,
    continent: 'Africa',
    country: 'Tunisia',
    region: 'Medenine (Djerba / Zarzis)',
    spot: 'Djerba lagoon',
    // lagoon between Djerba and the mainland at the El Kantara causeway (geocoder has no "Djerba lagoon")
    spotCoords: { lat: 33.6802, lng: 10.9156 },
    itinerarySpots: [],
    durationDays: nights + 1,
    skillLevels: /for all levels|beginner,? intermediate,? (and|or) advanced/i.test(text) ? ['beginner', 'intermediate', 'advanced'] : [],
    kiteLessons: true,
    equipmentRental: (service.including ?? []).some(i => /equipment rental/i.test(i)),
    beginnerFriendly: /for all levels|first steps/i.test(text),
    includedServices: service.including ?? [],
    optionalServices: [
      ...(service.additionally ?? []),
      ...(nightsText ? [`${nightsText[2]}-night stay (two camp weeks)`] : []),
    ],
    accommodation: 'Family-run bungalow complex with pool in Zarzis (single, double or triple rooms)',
    mealPlan: (service.including ?? []).some(i => /half board/i.test(i)) ? 'half_board' : null,
    languages: ['de', 'en'], // site hreflang de/en, Austrian operator (2026-10-09)
    rooms,
    imageUrls,
    heroVideoUrl: null, // YouTube embed only (behind a consent placeholder)
    sourceUrl: url,
    bookingUrl: root.querySelector('a[href*="kitecamps-request"]')?.getAttribute('href') ?? url,
    sourceText: text,
  };
}

export const lakeunitedDjerba: OfferAdapter = {
  key: 'lakeunited-djerba',
  name: 'LakeUnited - Kitecamp Tunisia (Djerba lagoon)',
  kind: 'camp',
  operator: {
    name: 'LakeUnited',
    websiteUrl: 'https://www.lakeunited.com/',
    rootDomain: 'lakeunited.com',
  },
  url: LAKEUNITED_URL,
  slotMethod: 'html_dates',
  fetchBudget: 3,
  async fetchContent() {
    return parseLakeUnitedContent(await page(LAKEUNITED_URL), LAKEUNITED_URL);
  },
  async fetchSlots(ctx: FetchContext) {
    const { slots, hiddenWeeks } = parseLakeUnitedSlots(await page(LAKEUNITED_URL));
    if (hiddenWeeks.length) ctx.note(`weeks hidden on the page (not emitted): ${hiddenWeeks.join('; ')}`);
    return slots;
  },
};
