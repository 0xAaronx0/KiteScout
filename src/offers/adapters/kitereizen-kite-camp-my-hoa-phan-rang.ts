// ---------------------------------------------------------------------------
// Kitereizen - The Kite Camp Vietnam ("Master the Elements"), My Hoa lagoon near Phan Rang: a 7-night big-air coaching
// week with King of the Air winner Marc Jacobs (the shop also names Ross-Dillon Player) at a basecamp on the lagoon:
// deluxe room (shared or private), full board, radio-headset coaching, video analysis, Cam Ranh airport transfers,
// own scooter, laundry.
// Operator check (2026-10-19): Kitereizen (kitereizen.nl, Netherlands) organises the camp itself - its own coaches
// ("Advanced clinic with our own instructors"), "our crew" / "our team" on the beach, its own shop sells the weeks.
// It is not reselling another operator's package; the basecamp property is not named on the site (inferred: a rented
// lagoon-side resort).
//
// Data path (checked 2026-10-19), site built on LeadConnector (HighLevel) with its own store:
//   slots    the store's product list https://kitereizen.nl/product-list has a section "Phan Rang, Vietnam (with Marc and
//            Ross)" linking one product per camp week (/product-details/product/<id>: "January 1-8, 2027",
//            "January 8-15, 2027"). Each product page carries a schema.org ProductGroup (JSON-LD) whose variants are
//            room x extra clinics; we read the two base variants "Shared room (€1995)" and "Private room (€2395)" with all
//            clinics "Not applicable": price (EUR), availability (InStock / OutOfStock). The store tracks inventory
//            (page data: trackInventory true, availableQuantity 7 on every variant - a per-variant count, not the camp's
//            places, so it is not used as spotsLeft). The camp page's "AVAILABLE DATES 2027 / WEEK 1: 1 Jan - 8 Jan 2027
//            (Only a few spots left)" turns an in-stock week into 'limited'.
//            One slot per week x room, EUR per person (package, 7 nights); past weeks dropped.
//            Date conflict on the camp page: its hero says "Data: 9 - 16 Jan / 16 - 23 Jan 2027", its booking block and
//            the store say 1-8 and 8-15 Jan 2027 -> the store's products are used (they are what a guest can buy).
//   content  /en/vietnam (camp page: inclusions, add-ons, prices, gear guide, photos) + the first week's product page.
//            Photos: not imageCandidates - on this page it returns the "other trips" teasers (Dakhla, Feldberg, Workum),
//            logos and a gallery the page also labels "Sicily" / "Italy" / "Europe"; krImages() keeps the body photos
//            before the teasers, unwraps the image proxy to the original file and drops every file the page labels with
//            another destination anywhere (the remaining generic gallery photos are left to the vision QC).
// robots.txt (2026-10-19): HTTP 200 with an empty body -> everything allowed.
// Requests per run: slots 4 (product list, 2 product pages, camp page), content +0 (memoised).
// Flags: instantBooking yes (store "Add to Cart" checkout, the same model as the Shopify camps; payment step not tested);
//   liveAvailability no: every store variant reports a fixed 7 in stock (a set value, not real inventory; lead 2026-10-19).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, jsonLd, parse, parseRange, todayIso } from '../parse.js';
import type { FetchContext, OfferAdapter, OfferContent, OperatorRef, Slot } from '../types.js';

export const KR_SITE = 'https://kitereizen.nl';
export const KR_CAMP_URL = `${KR_SITE}/en/vietnam`;
export const KR_PRODUCT_LIST_URL = `${KR_SITE}/product-list`;
const NIGHTS = 7;

export const KR_OPERATOR: OperatorRef = {
  name: 'Kitereizen',
  websiteUrl: `${KR_SITE}/en/home`,
  rootDomain: 'kitereizen.nl',
  contactEmail: 'info@kitereizen.nl',
  phone: '+31 6 13897376',
};

const memo = new Map<string, { at: number; p: Promise<string> }>();
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

export function krLines(html: string): string[] {
  const root = parse(html);
  for (const el of root.querySelectorAll('script,style,noscript,svg')) el.remove();
  return (root.querySelector('body') ?? root).structuredText
    .split('\n').map(s => collapse(s.replace(/[​ ]/g, ' ')).replace(/[–—]/g, '-')).filter(Boolean);
}

// --- product list --------------------------------------------------------------------------
export interface KrWeekLink { url: string; name: string }

/** Product links of the store's "... Vietnam ..." section(s), de-duplicated. */
export function parseKrVietnamProducts(html: string): KrWeekLink[] {
  const out: KrWeekLink[] = [];
  const parts = html.split(/class="ec-featured-list-heading">/).slice(1);
  for (const part of parts) {
    const heading = part.slice(0, part.indexOf('<'));
    if (!/vietnam/i.test(heading)) continue;
    for (const m of part.matchAll(/<a href="(https:\/\/kitereizen\.nl\/product-details\/product\/[0-9a-f]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
      const text = collapse(parse(m[2]).text);
      const name = text.replace(/€\s?[\d.,]+.*$/, '').trim();
      if (!out.some(o => o.url === m[1])) out.push({ url: m[1], name });
    }
  }
  return out;
}

// --- product page ---------------------------------------------------------------------------
export interface KrVariant { room: 'shared' | 'private'; price: number; currency: string; inStock: boolean; availability: string }
export interface KrWeek { name: string; start: string | null; end: string | null; url: string; image: string | null; description: string | null; variants: KrVariant[] }

export function parseKrProduct(html: string, url: string): KrWeek {
  const group = jsonLd(html).find(o => o['@type'] === 'ProductGroup') as
    | { name?: string; description?: string; hasVariant?: Array<{ name?: string; image?: string; offers?: { price?: number | string; priceCurrency?: string; availability?: string } }> }
    | undefined;
  const name = collapse(group?.name ?? '');
  const range = name ? parseRange(name.replace(/,/g, '')) : null;
  const variants: KrVariant[] = [];
  for (const v of group?.hasVariant ?? []) {
    const raw = collapse(v.name ?? '');
    const opts = (raw.startsWith(name) ? raw.slice(name.length) : raw.split(' - ').slice(1).join(' - '))
      .replace(/^\s*-\s*/, '').split('/').map(s => s.trim());
    if (opts.length < 2 || opts.slice(1).some(o => !/^not applicable$/i.test(o))) continue; // base variants only (no extra clinics)
    const room = /^shared room/i.test(opts[0]) ? 'shared' : /^private room/i.test(opts[0]) ? 'private' : null;
    if (!room || !v.offers) continue;
    const price = Number(v.offers.price);
    if (!(price > 0) || variants.some(x => x.room === room)) continue;
    const availability = String(v.offers.availability ?? '').replace(/^https?:\/\/schema\.org\//, '');
    variants.push({ room, price, currency: v.offers.priceCurrency ?? 'EUR', inStock: /^(InStock|LimitedAvailability|PreOrder)$/i.test(availability), availability });
  }
  return {
    name,
    start: range?.start ?? null,
    end: range?.end ?? null,
    url,
    image: group?.hasVariant?.[0]?.image ?? null,
    description: group?.description ? collapse(group.description) : null,
    variants,
  };
}

// --- camp page ------------------------------------------------------------------------------------
/** "WEEK 1: 1 Jan - 8 Jan 2027 (Only a few spots left)" -> start date + status words. */
export function parseKrWeekStatus(html: string): Array<{ start: string; end: string; status: string }> {
  const out: Array<{ start: string; end: string; status: string }> = [];
  for (const l of krLines(html)) {
    const m = l.match(/^week\s*\d+\s*:\s*(.+?)\s*\(([^)]+)\)\s*$/i);
    if (!m) continue;
    const r = parseRange(m[1]);
    if (r) out.push({ start: r.start, end: r.end, status: m[2].trim() });
  }
  return out;
}

export function buildKrSlots(weeks: KrWeek[], status: Array<{ start: string; status: string }>, today: string): Slot[] {
  const out: Slot[] = [];
  for (const w of weeks) {
    if (!w.start || !w.end || w.start < today) continue;
    const words = status.find(s => s.start === w.start)?.status ?? null;
    for (const v of w.variants) {
      const availability: Slot['availability'] = !v.inStock ? 'sold_out' : words && /few|last|limited|only/i.test(words) ? 'limited' : 'available';
      out.push({
        key: `${w.start}|${v.room}`,
        startDate: w.start,
        endDate: w.end,
        unit: v.room === 'shared' ? 'Shared deluxe room' : 'Private deluxe room',
        price: v.price,
        currency: v.currency,
        priceUnit: 'package',
        priceBasis: 'person',
        occupancy: v.room === 'shared' ? 2 : 1,
        availability,
        availabilityText: [v.inStock ? 'in stock in the online shop' : `shop: ${v.availability || 'not in stock'}`, words].filter(Boolean).join('; '),
        spotsLeft: null,
      });
    }
  }
  return out;
}

export async function fetchKrWeeks(ctx?: Pick<FetchContext, 'note' | 'incomplete'>): Promise<KrWeek[]> {
  const links = parseKrVietnamProducts(await page(KR_PRODUCT_LIST_URL));
  if (links.length === 0) throw new Error('kitereizen: no "Vietnam" section with products in the store list (layout changed?)');
  const weeks: KrWeek[] = [];
  for (const l of links) {
    try {
      weeks.push(parseKrProduct(await page(l.url), l.url));
    } catch (e) {
      ctx?.incomplete(`product page ${l.url}: ${(e as Error).message}`);
    }
  }
  return weeks;
}

export async function fetchKrSlots(today: string, ctx?: Pick<FetchContext, 'note' | 'incomplete'>): Promise<Slot[]> {
  const weeks = await fetchKrWeeks(ctx);
  const status = parseKrWeekStatus(await page(KR_CAMP_URL));
  for (const w of weeks) if (w.variants.length === 0) ctx?.note(`kitereizen: no shared/private base variant in "${w.name}"`);
  const slots = buildKrSlots(weeks, status, today);
  const past = weeks.filter(w => w.start && w.start < today);
  if (past.length) ctx?.note(`${past.length} past week(s) dropped (${past.map(w => w.start).join(', ')})`);
  if (slots.length === 0) ctx?.note('no future camp week in the store');
  return slots;
}

// --- content ---------------------------------------------------------------------------------------
const OTHER_PLACE = /sicili|stagnone|itali|europa|marokk|dahkla|dakhla|duitsland|feldberg|workum|logo/i;

/** Camp photos of the page body (before the "other trips" teasers), unwrapped from the image proxy, de-duplicated by file. */
export function krImages(html: string): string[] {
  const cut = html.search(/>\s*Andere reizen\s*</i);
  const body = html.slice(Math.max(0, html.indexOf('<body')), cut > 0 ? cut : html.length);
  const out: string[] = [];
  const fileOf = (src: string) => src.split('/').pop() ?? src;
  // a file the page also labels with another destination anywhere (the site reuses a Sicily / Europe gallery) is left out
  const files = new Set<string>();
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const alt = m[0].match(/\balt="([^"]*)"/i)?.[1] ?? '';
    const src = m[0].match(/\bsrc="([^"]+)"/i)?.[1] ?? '';
    if (src && OTHER_PLACE.test(alt)) files.add(fileOf(src));
  }
  for (const m of body.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const alt = tag.match(/\balt="([^"]*)"/i)?.[1] ?? '';
    let src = tag.match(/\bsrc="([^"]+)"/i)?.[1] ?? '';
    if (!src || OTHER_PLACE.test(alt) || /\.svg$|icons\//i.test(src)) continue;
    const inner = src.match(/\/u_(https?:\/\/.+)$/);
    if (inner) src = inner[1];
    const file = fileOf(src);
    if (!/\.(jpe?g|png|webp)$/i.test(file) || files.has(file)) continue;
    files.add(file);
    out.push(src);
  }
  return out;
}

function listBetween(lines: string[], head: RegExp, stop: RegExp): string[] {
  const i = lines.findIndex(l => head.test(l));
  if (i < 0) return [];
  const out: string[] = [];
  for (let j = i + 1; j < lines.length && !stop.test(lines[j]); j++) out.push(lines[j]);
  return out;
}

export function parseKrContent(campHtml: string, weeks: KrWeek[], today: string): OfferContent {
  const lines = krLines(campHtml);
  const included = listBetween(lines, /^what.s included:?$/i, /^optional add-ons:?$/i);
  const optional = listBetween(lines, /^optional add-ons:?$/i, /^andere reizen$/i);
  const future = weeks.filter(w => w.start && w.start >= today).sort((a, b) => a.start!.localeCompare(b.start!));
  const minOf = (room: 'shared' | 'private') => Math.min(...weeks.flatMap(w => w.variants.filter(v => v.room === room).map(v => v.price)));
  const shared = minOf('shared');
  const priv = minOf('private');
  const partner = lines.join(' ').match(/partner (?:option|upgrade)\s*\(?\+\s*€\s*([\d.,]+)/i)?.[1] ?? null;
  const fmtW = (w: KrWeek) => w.name.replace(/,?\s*20\d{2}$/, '');
  const year = future[0]?.start?.slice(0, 4) ?? weeks[0]?.start?.slice(0, 4) ?? null;

  const imageUrls: string[] = [];
  for (const u of [weeks[0]?.image ?? null, ...krImages(campHtml)]) {
    if (!u) continue;
    const f = u.split('/').pop();
    if (!imageUrls.some(x => x.split('/').pop() === f)) imageUrls.push(u);
  }

  const summary = [
    `Dutch kite-travel organiser Kitereizen runs a one-week big-air coaching camp on the My Hoa lagoon near Phan Rang, Vietnam, with King of the Air winner Marc Jacobs coaching through BB-talkin radio headsets, evening video analysis and photos of your jumps; January winds there typically blow 15-40 knots.`,
    `The 7 nights are spent at a basecamp directly on the lagoon (deluxe room, infinity pool, recovery bath) with full board, Cam Ranh airport transfers, an own scooter and daily laundry; extra clinics, gear rental and a partner place can be added.`,
    future.length
      ? `Weeks ${year}: ${future.map(fmtW).join(' and ')}${Number.isFinite(shared) ? `, EUR ${shared.toLocaleString('en-US')} per person in a shared room` : ''}${Number.isFinite(priv) ? `, EUR ${priv.toLocaleString('en-US')} in a private room` : ''}.`
      : `Runs in January; next weeks not yet in the shop${weeks.length ? ` (last: ${weeks.map(fmtW).join(', ')} ${weeks[0]?.start?.slice(0, 4) ?? ''})` : ''}.`,
  ].join(' ');

  return {
    kind: 'camp',
    title: 'Kitereizen Kite Camp Vietnam with Marc Jacobs, My Hoa Lagoon',
    summary,
    continent: 'Asia',
    country: 'Vietnam',
    region: 'Ninh Thuan',
    spot: 'My Hoa Lagoon',
    itinerarySpots: [],
    durationDays: NIGHTS + 1,
    skillLevels: ['intermediate', 'advanced'],
    kiteLessons: true,
    equipmentRental: true,
    beginnerFriendly: false,
    includedServices: included,
    optionalServices: optional.length ? optional : partner ? [`Partner or friend sharing the room (+EUR ${partner})`] : [],
    accommodation: 'Deluxe room (shared or private) at a basecamp resort on the lagoon, infinity pool',
    mealPlan: 'full_board',
    languages: ['nl', 'en'],
    rooms: [],
    imageUrls: imageUrls.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: KR_CAMP_URL,
    bookingUrl: future[0]?.url ?? KR_PRODUCT_LIST_URL,
    sourceText: [
      lines.slice(Math.max(0, lines.findIndex(l => /^master the elements/i.test(l))), Math.max(0, lines.findIndex(l => /^andere reizen$/i.test(l)))).join('\n'),
      `store weeks: ${weeks.map(w => `${w.name} (${w.start}..${w.end}): ${w.variants.map(v => `${v.room} ${v.currency} ${v.price} ${v.availability}`).join(', ')}`).join(' | ')}`,
      `store description: ${weeks[0]?.description ?? ''}`,
    ].join('\n'),
  };
}

export const kitereizenKiteCampMyHoaPhanRang: OfferAdapter = {
  key: 'kitereizen-kite-camp-my-hoa-phan-rang',
  name: 'Kitereizen Kite Camp Vietnam, My Hoa Lagoon (Phan Rang)',
  kind: 'camp',
  operator: KR_OPERATOR,
  url: KR_CAMP_URL,
  slotMethod: 'jsonld',
  instantBooking: true,
  fetchBudget: 5,
  async fetchContent(ctx) {
    const camp = await page(KR_CAMP_URL);
    const weeks = await fetchKrWeeks(ctx);
    return parseKrContent(camp, weeks, todayIso());
  },
  fetchSlots: ctx => fetchKrSlots(todayIso(), ctx),
};
