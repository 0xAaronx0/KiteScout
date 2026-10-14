// ---------------------------------------------------------------------------
// Offer adapter: REAL Watersports La Ventana SuperCamp (Baja California Sur, Mexico).
//
// Data path (Shopify store, live inventory):
//   1. /search/suggest.json?q=la ventana supercamp&resources[type]=product -> current product handles
//      (`la-ventana-supercamp-<year>`). The landing page's "Book Now" buttons still point to the 2026
//      product, which answers 404 (checked 2026-10-09), so we do not trust those links first.
//   2. /products/<handle>.js -> one variant per room type x date, with Shopify's `available` flag
//      (inventory-managed: false = no stock left) and the price in cents.
//   3. /pages/la-ventana-supercamp (landing page) -> content only (inclusions, coaches, travel info).
//   The product description lists the room prices ("Premium Double: $7990 ($3995 / person)"), which
//   tells us which variant price is per room for two and which is per person.
// robots.txt www.realwatersports.com (checked 2026-10-09): /pages/, /products/ and /search are allowed
//   (cart/checkout/account are disallowed and never touched). No cart, no checkout.
// Requests per run: 3 (suggest + product .js + landing page; memoised across content + slots),
//   +1 per extra SuperCamp product year listed at the same time.
// Slots: one per variant (unit = room type, key `<room>|<start>`), priceUnit 'package', price per
//   person (room-for-two variants divided by 2 as the description states), availability from Shopify.
// Known limits: Shopify's .js gives no stock count (inventory_quantity null) -> spotsLeft null; the
//   currency is not in the .js, we read it from the "$" amounts of the product description (USD store).
// ---------------------------------------------------------------------------
import { fetchJson, fetchText, HttpStatusError } from '../http.js';
import { parse, collapse, detectCurrency, parseRange, imageCandidates, type HTMLElement } from '../parse.js';
import type { ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const ORIGIN = 'https://www.realwatersports.com';
export const REAL_LANDING_URL = `${ORIGIN}/pages/la-ventana-supercamp`;
const HANDLE_PREFIX = 'la-ventana-supercamp';
export const REAL_SUGGEST_URL = `${ORIGIN}/search/suggest.json?q=la%20ventana%20supercamp&resources%5Btype%5D=product&resources%5Blimit%5D=10`;

export interface ShopifyVariant { id: number; title: string; option1: string | null; option2: string | null; option3: string | null; price: number; available: boolean }
export interface ShopifyProduct {
  id: number; title: string; handle: string; description: string; available: boolean;
  options: Array<{ name: string; position: number; values: string[] }>;
  variants: ShopifyVariant[]; images: string[];
}

// --- local helpers ----------------------------------------------------------------
const memo = new Map<string, { at: number; p: Promise<unknown> }>();
function once<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p as Promise<T>;
  const p = fn();
  memo.set(key, { at: Date.now(), p });
  p.catch(() => memo.delete(key));
  return p;
}
const txt = (el: HTMLElement | null | undefined): string => collapse(el?.text ?? '');
const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Handles of SuperCamp products from the search-suggest JSON. */
export function supercampHandles(suggest: unknown): string[] {
  const products = (suggest as { resources?: { results?: { products?: Array<{ handle?: string }> } } })
    ?.resources?.results?.products ?? [];
  return products.map(p => p.handle ?? '').filter(h => h.startsWith(HANDLE_PREFIX));
}

/** Pricing lines of the product description: "Premium Double: $7990 ($3995 / person)" / "Single: $4995 / person". */
export interface PriceLine { name: string; total: number | null; perPerson: number; features: string[] }
export function parsePriceLines(descriptionHtml: string): PriceLine[] {
  const root = parse(descriptionHtml);
  const out: PriceLine[] = [];
  for (const li of root.querySelectorAll('li')) {
    const own = txt(li);
    let m = own.match(/^(.+?):\s*\$\s?([\d,]+)\s*\(\s*\$\s?([\d,]+)\s*\/\s*person\s*\)/i);
    const features = (li.nextElementSibling?.tagName === 'UL' ? li.nextElementSibling.querySelectorAll('li') : []).map(x => txt(x));
    if (m) { out.push({ name: m[1].trim(), total: Number(m[2].replace(/,/g, '')), perPerson: Number(m[3].replace(/,/g, '')), features }); continue; }
    m = own.match(/^(.+?):\s*\$\s?([\d,]+)\s*\/\s*person/i);
    if (m) out.push({ name: m[1].trim(), total: null, perPerson: Number(m[2].replace(/,/g, '')), features });
  }
  return out;
}

/** Year of the camp from the product title / handle ("La Ventana SuperCamp 2027"). */
export function productYear(p: Pick<ShopifyProduct, 'title' | 'handle'>): number | null {
  const m = `${p.title} ${p.handle}`.match(/\b(20\d{2})\b/);
  return m ? Number(m[1]) : null;
}

function optionIndex(p: ShopifyProduct, re: RegExp): number | null {
  const o = p.options.find(x => re.test(x.name));
  return o ? o.position : null;
}
const opt = (v: ShopifyVariant, pos: number | null): string | null =>
  pos === 1 ? v.option1 : pos === 2 ? v.option2 : pos === 3 ? v.option3 : null;

/** Map a variant price (USD) to per-person price + occupancy using the description's price lines. */
export function perPersonPrice(variantPrice: number, lines: PriceLine[]): { price: number; occupancy: number | null; line: PriceLine | null } {
  const room = lines.find(l => l.total !== null && l.total === variantPrice);
  if (room) return { price: room.perPerson, occupancy: Math.round(room.total! / room.perPerson), line: room };
  const pp = lines.find(l => l.total === null && l.perPerson === variantPrice);
  if (pp) {
    const shared = /shared|twin|for two/i.test(`${pp.name} ${pp.features.join(' ')}`);
    return { price: pp.perPerson, occupancy: shared ? 2 : 1, line: pp };
  }
  return { price: variantPrice, occupancy: null, line: null };
}

// --- slots ------------------------------------------------------------------------
export function parseRealSlots(p: ShopifyProduct): Slot[] {
  const year = productYear(p);
  if (!year) throw new Error(`real: no year in product "${p.title}"`);
  const datePos = optionIndex(p, /date/i);
  const roomPos = optionIndex(p, /booking|room|type/i) ?? (datePos === 1 ? 2 : 1);
  const lines = parsePriceLines(p.description);
  const currency = detectCurrency(collapse(parse(p.description).text).match(/(US)?\$\s?\d/)?.[0] ?? '') ?? 'USD';
  const slots: Slot[] = [];
  for (const v of p.variants) {
    const dateText = opt(v, datePos) ?? '';
    const range = parseRange(dateText, year);
    if (!range) throw new Error(`real: unparseable date option "${dateText}"`);
    const room = opt(v, roomPos) ?? v.title;
    const { price, occupancy } = perPersonPrice(v.price / 100, lines);
    slots.push({
      key: `${slug(room)}|${range.start}`,
      startDate: range.start,
      endDate: range.end,
      unit: room,
      price,
      currency,
      priceUnit: 'package',
      priceBasis: occupancy === null ? null : 'person',
      occupancy,
      availability: v.available ? 'available' : 'sold_out',
      availabilityText: null, // Shopify flag only; the store shows no wording per variant in the data
      spotsLeft: null,
    });
  }
  return slots;
}

// --- content ----------------------------------------------------------------------
export function parseRealContent(landingHtml: string, p: ShopifyProduct, url = REAL_LANDING_URL): OfferContent {
  const root = parse(landingHtml);
  // node-html-parser's .text includes inline <script>/<style> bodies: drop them before reading text
  for (const el of root.querySelectorAll('script, style, noscript, template')) el.remove();
  const main = root.querySelector('main') ?? root;
  const mainText = txt(main);
  const descText = collapse(parse(p.description).text);
  const year = productYear(p);
  const lines = parsePriceLines(p.description);

  // "Trip Includes:" list on the landing page; its last item carries "Not Included: ..."
  const includes: string[] = [];
  let notIncluded: string | null = null;
  const head = main.querySelectorAll('p').find(x => /^trip includes:?$/i.test(txt(x)));
  const list = head?.nextElementSibling;
  for (const li of list?.tagName === 'UL' ? list.querySelectorAll('li') : []) {
    const t = txt(li);
    const [inc, ni] = t.split(/\s*Not Included:\s*/i);
    if (inc) includes.push(inc.trim());
    if (ni) notIncluded = ni.replace(/\.$/, '');
  }

  const shuttle = mainText.match(/group shuttle is \$(\d+) each way.*?private shuttle can be booked at a cost of \$(\d+) each way/i);
  const optionalServices = shuttle
    ? [`Group airport shuttle from SJD (USD ${shuttle[1]} p.p. each way)`, `Private airport shuttle (USD ${shuttle[2]} each way)`]
    : [];

  const datePos = optionIndex(p, /date/i);
  const roomPos = optionIndex(p, /booking|room|type/i) ?? (datePos === 1 ? 2 : 1);
  const roomNames = [...new Set(p.variants.map(v => opt(v, roomPos) ?? v.title))];
  const rooms: ContentRoom[] = roomNames.map(name => {
    const v = p.variants.find(x => (opt(x, roomPos) ?? x.title) === name)!;
    const { line } = perPersonPrice(v.price / 100, lines);
    const description = line
      ? `${line.name}: ${line.features.join(', ') || 'see page'}${line.total ? ` (USD ${line.total} per room for two, USD ${line.perPerson} per person)` : ` (USD ${line.perPerson} per person)`}`
      : null;
    return { name, description, features: line?.features ?? [] };
  });

  const nights = Number(descText.match(/(\d+)\s*Nights?/i)?.[1] ?? NaN);
  const dateText = p.variants.map(v => opt(v, datePos)).find(Boolean) ?? '';
  const openTo = descText.match(/is open to ([^.]+)\./i)?.[1] ?? null;   // "wing foilers of all levels plus intermediate and advanced kiters"
  const coaches = mainText.match(/coaching from professional athletes ([^.]+?)\./i)?.[1] ?? null;
  const productImages = p.images.map(u => (u.startsWith('//') ? `https:${u}` : u));
  const imageUrls = [...new Set([...productImages, ...imageCandidates(landingHtml, url, null, 40)])];

  const summary = [
    `${p.title}: a ${Number.isFinite(nights) ? `${nights}-night` : 'week-long'} kiteboarding and wing foil camp by REAL Watersports and Strut Kiteboarding at The Kite House at Casa Cortez in La Ventana, Baja California Sur${dateText ? `, ${dateText}${year ? ` ${year}` : ''}` : ''}.`,
    coaches ? `Coaching by ${coaches}, 2-4 hours a day on the water when conditions allow.` : null,
    'Three meals a day, daily yoga and off-the-water workshops are included; flights, airport transfer and kite gear are not.',
    openTo ? `Open to ${openTo}.` : null,
  ].filter(Boolean).join(' ');

  return {
    kind: 'camp',
    title: p.title,
    summary,
    continent: 'North America',
    country: 'Mexico',
    region: 'Baja California Sur',
    spot: 'La Ventana',
    itinerarySpots: [],
    durationDays: Number.isFinite(nights) ? nights + 1 : 8,
    // description: kite "Staying upwind confidently" required; wing "All levels" (2026-10-09)
    skillLevels: /intermediate and advanced kiters/i.test(descText) ? ['intermediate', 'advanced'] : ['intermediate'],
    kiteLessons: true,
    equipmentRental: notIncluded && /kite gear/i.test(notIncluded) ? false : null,
    beginnerFriendly: false,
    includedServices: includes,
    optionalServices,
    accommodation: 'The Kite House at Casa Cortez, beachfront (single, shared double, premium and ultra premium suites)',
    mealPlan: includes.some(i => /3 .*meals per day/i.test(i)) ? 'full_board' : null,
    languages: ['en'], // US store, English-only site (2026-10-09)
    rooms,
    imageUrls,
    heroVideoUrl: null, // YouTube embed only (youtube.com/embed/KGKREO5q9cw), not a video file
    sourceUrl: url,
    bookingUrl: `${ORIGIN}/products/${p.handle}`,
    sourceText: [txt(main), descText].join('\n\n'),
  };
}

// --- fetch ------------------------------------------------------------------------
async function products(ctx: FetchContext): Promise<ShopifyProduct[]> {
  return once('products', async () => {
    let handles = supercampHandles(await fetchJson(REAL_SUGGEST_URL));
    if (handles.length === 0) {
      // fallback: the landing page's product links (may be stale, see header)
      const html = await once('landing', () => fetchText(REAL_LANDING_URL));
      handles = [...new Set([...html.matchAll(/\/products\/(la-ventana-supercamp[a-z0-9-]*)/g)].map(m => m[1]))];
      ctx.note(`search-suggest found no SuperCamp product; trying landing-page links ${handles.join(', ')}`);
    }
    const out: ShopifyProduct[] = [];
    for (const h of handles.slice(0, 3)) {
      try {
        out.push(await fetchJson<ShopifyProduct>(`${ORIGIN}/products/${h}.js`));
      } catch (e) {
        if (e instanceof HttpStatusError && e.status === 404) { ctx.note(`product ${h} answers 404 (stale link)`); continue; }
        throw e;
      }
    }
    if (out.length === 0) throw new Error('real: no La Ventana SuperCamp product found in the store');
    return out;
  });
}

export const realLaVentanaSupercamp: OfferAdapter = {
  key: 'real-la-ventana-supercamp',
  name: 'REAL Watersports - La Ventana SuperCamp',
  kind: 'camp',
  operator: {
    name: 'REAL Watersports',
    websiteUrl: `${ORIGIN}/`,
    rootDomain: 'realwatersports.com',
    contactEmail: 'REALpro@realwatersports.com', // landing page "Contact a REALPro", 2026-10-09
    phone: '+12529876000',                       // landing page "252.987.6000", 2026-10-09
  },
  url: REAL_LANDING_URL,
  slotMethod: 'booking_engine',
  instantBooking: true,
  liveAvailability: true,
  fetchBudget: 6,
  async fetchContent(ctx) {
    const [landing, prods] = await Promise.all([once('landing', () => fetchText(REAL_LANDING_URL)), products(ctx)]);
    // newest camp year first: the landing page describes the upcoming edition
    const p = [...prods].sort((a, b) => (productYear(b) ?? 0) - (productYear(a) ?? 0))[0];
    return parseRealContent(landing, p, REAL_LANDING_URL);
  },
  async fetchSlots(ctx) {
    return (await products(ctx)).flatMap(parseRealSlots);
  },
};
