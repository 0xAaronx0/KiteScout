// ---------------------------------------------------------------------------
// Kite Club Hatteras, Avon (Hatteras Island, North Carolina, USA) - kiteboarding school with its own canal-front guest
// house ("kite house") in Kinnakeet Village, Avon: private and shared rooms, plus the whole Kite Club Hatteras House and
// the Turtle Club and Sea Star houses (four bedrooms each) for groups. Lessons leave by boat / jet ski from the
// property's own docks to the shallow Pamlico Sound; Cabrinha school gear.
//
// Data path (checked 2026-10-14): WordPress + Avada + WooCommerce.
//   content  /accommodations/ (rooms and houses, "Weekly, nightly and partial stay rates are available - contact us"),
//            /about/ (school, boat / jet ski lessons, gear) and the WooCommerce Store API product list
//            GET /wp-json/wc/store/v1/products?per_page=50&_fields=... (public JSON the shop itself uses; room and house
//            descriptions, photos, season terms). The accommodation products carry price 0 and are not purchasable
//            ("PLEASE CALL FOR AVAILABILITY BEFORE BOOKING!!!").
//   slots    none: no room or house price is published -> [] ("price on request"); fetchSlots re-reads the product list
//            and notes when a room product gets a price. The camp weeks are a separate adapter
//            (kite-club-hatteras-camp-avon.ts, kind camp), which imports the helpers below.
// robots.txt (2026-10-14): WooCommerce rules (cart / add-to-cart / wp-admin) disallowed; pages and /wp-json allowed.
// Requests per run: content 3 (product list memoised), slots 1 (memoised).
// Known limits: rooms on request only; no coordinates on the site (the contact page has only a maps short link), so
//   no spotCoords - the geocoder places "Avon".
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, collapse, parse } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

export const KCH_SITE = 'https://kiteclubhatteras.com';
export const KCH_ACCOM_URL = `${KCH_SITE}/accommodations/`;
export const KCH_ABOUT_URL = `${KCH_SITE}/about/`;
export const KCH_PRODUCTS_URL = `${KCH_SITE}/wp-json/wc/store/v1/products?per_page=50&_fields=id,name,slug,permalink,description,prices,images,attributes,is_purchasable,is_in_stock,variations`;
export const KCH_OPERATOR = {
  name: 'Kite Club Hatteras',
  websiteUrl: KCH_SITE,
  rootDomain: 'kiteclubhatteras.com',
  contactEmail: 'info@kiteclubhatteras.com',
  phone: '+12025497693',
};

// --- local helpers ----------------------------------------------------------------------------
const memo = new Map<string, { at: number; p: Promise<string> }>();
/** one fetch per URL per 10 minutes (content + slots of both Kite Club adapters share pages). */
export function kchFetch(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: url.includes('/wp-json/') ? 'application/json' : 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

/** Visible text of the page body (scripts, styles, header, footer, nav dropped), whitespace collapsed. */
export function kchText(html: string): string {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, header, footer, nav, form, svg')) el.remove();
  return collapse((root.querySelector('main') ?? root.querySelector('body') ?? root).text);
}

export interface KchProduct {
  id: number; name: string; slug: string; url: string; description: string; price: number | null;
  priceMax: number | null; currency: string | null; purchasable: boolean; images: string[]; seasons: string[];
}

/** Store API product list -> products (prices in major units; 0 = no price). */
export function parseKchProducts(json: string): KchProduct[] {
  const list = JSON.parse(json) as Array<Record<string, unknown>>;
  return list.map(p => {
    const pr = (p.prices ?? {}) as Record<string, unknown>;
    const minor = Number(pr.currency_minor_unit ?? 2);
    const major = (v: unknown): number | null => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n / 10 ** minor : null; };
    const range = (pr.price_range ?? null) as Record<string, unknown> | null;
    const attrs = (p.attributes ?? []) as Array<{ name?: string; terms?: Array<{ name?: string }> }>;
    return {
      id: Number(p.id),
      name: clean(String(p.name ?? '')),
      slug: String(p.slug ?? ''),
      url: String(p.permalink ?? ''),
      // Amelia booking shortcodes leave inline script text in the descriptions: cut it
      description: clean(String(p.description ?? '').replace(/<script[\s\S]*?<\/script>/gi, ' ')),
      price: major(range?.min_amount ?? pr.price),
      priceMax: major(range?.max_amount ?? pr.price),
      currency: typeof pr.currency_code === 'string' ? pr.currency_code : null,
      purchasable: p.is_purchasable === true,
      images: ((p.images ?? []) as Array<{ src?: string }>).map(i => i.src ?? '').filter(u => /\.(jpe?g|webp)$/i.test(u)),
      seasons: attrs.filter(a => /season/i.test(a.name ?? '')).flatMap(a => (a.terms ?? []).map(t => clean(t.name ?? ''))),
    };
  }).filter(p => p.id && p.name);
}

/** The guest-house rooms and the rental houses (the shop also sells lessons, gear and the camp). */
export function kchStayProducts(products: KchProduct[]): KchProduct[] {
  return products.filter(p => /room|house/i.test(p.name) && !/camp|lesson|course/i.test(p.name));
}

// --- content ----------------------------------------------------------------------------------
export interface KchPages { accom: string; about: string; products: string }

function roomOf(p: KchProduct): ContentRoom {
  const d = p.description.replace(/PLEASE CALL FOR AVAILABILITY BEFORE BOOKING!*\s*/i, '').trim();
  const four = /four bedroom/i.test(`${p.name} ${d}`) || /house/i.test(p.slug);
  return {
    name: p.name,
    description: d ? d.slice(0, 600) : null,
    features: [
      /queen bed/i.test(d) ? 'Queen bed' : null,
      /canal front view|canal/i.test(d) && /room/i.test(p.name) ? 'Canal view, sliding door to a large porch' : null,
      /towels and linens are included|sheets and bath towels are provided/i.test(d) ? 'Linens and towels included' : null,
      /shared room/i.test(d) ? 'Shared room in the guest house (kitchen, living room, Wi-Fi)' : null,
      four && /house/i.test(p.name) ? 'Four bedrooms, sleeps up to 10' : null,
      /pool/i.test(d) ? 'Shared pool (May to September)' : null,
      /kayak and Stand Up Paddle Board are free/i.test(d) ? 'Kayak and SUP free to use' : null,
      p.seasons.length ? `Rate seasons: ${p.seasons.map(s => s.replace(/^\d+\s*-\s*/, '')).join('; ')}` : null,
      'Price on request (call for availability)',
    ].filter((x): x is string => !!x),
  };
}

export function parseKiteClubHatterasContent(p: KchPages): OfferContent {
  const accom = kchText(p.accom);
  const about = kchText(p.about);
  const stays = kchStayProducts(parseKchProducts(p.products));
  const rates = accom.match(/Weekly, nightly and partial stay rates are available[^!.]*[!.]/i)?.[0] ?? null;
  const rooms = stays.map(roomOf);

  const imageUrls: string[] = [];
  const order = ['private-room', 'shared-bunk', 'kite-club-hatteras-house', 'turtle', 'sea-star'];
  const sorted = [...stays].sort((a, b) => order.findIndex(o => a.slug.includes(o)) - order.findIndex(o => b.slug.includes(o)));
  for (const u of [...sorted.flatMap(s => s.images.slice(0, 3)), ...sorted.flatMap(s => s.images.slice(3))]) {
    const k = u.replace(/-(?:\d+x\d+|scaled)(?=\.[a-z]+$)/i, '');
    if (!imageUrls.some(x => x.replace(/-(?:\d+x\d+|scaled)(?=\.[a-z]+$)/i, '') === k)) imageUrls.push(u);
  }

  const summary = [
    `Kite Club Hatteras is a kiteboarding school in Avon on Hatteras Island, North Carolina, with its own canal-front guest house in Kinnakeet Village: private rooms (queen bed, porch over the canal) and a shared bunk room, with a shared kitchen and living room.`,
    `Groups can rent a whole four-bedroom house for up to 10 people (the Kite Club Hatteras House, the Turtle Club or the Sea Star), with a shared pool open May to September and free kayak and SUP.`,
    `Lessons leave by boat and jet ski from the property's own docks to the shallow Pamlico Sound, with Cabrinha school kites; rooms and houses are booked on request (weekly, nightly and partial stays).`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Kite Club Hatteras',
    summary,
    continent: 'North America',
    country: 'United States',
    region: 'Hatteras Island, North Carolina',
    spot: 'Avon',
    itinerarySpots: [],
    durationDays: null,
    // about: "Whether you are a beginner or an experienced kiter"
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: true,
    equipmentRental: null,
    beginnerFriendly: true,
    includedServices: ['Linens and towels', 'Wi-Fi', 'Shared kitchen (guest house)', 'Kayak and SUP (houses)', 'Shared pool (May to September)'],
    optionalServices: [
      'Kiteboarding lessons with boat / jet ski support from the docks (Kite Control, Get Moving, Learn to Ride; 3-day express course)',
      'Foilboard, wing foil and e-foil lessons',
      'IKO certification',
      'Kite camp weeks (7 nights private room + 3 days private lessons)',
    ],
    accommodation: 'kite guest house rooms (private and shared) and four-bedroom rental houses',
    mealPlan: 'self_catering',
    languages: ['en'],
    rooms,
    imageUrls: imageUrls.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: KCH_ACCOM_URL,
    bookingUrl: `${KCH_SITE}/contact/`,
    sourceText: [
      `accommodations: ${accom}`,
      `about: ${about}`,
      `rates: ${rates ?? '-'}`,
      ...stays.map(s => `${s.name} (${s.url}): price ${s.price ?? 'none'} ${s.currency ?? ''}, purchasable ${s.purchasable}; seasons ${s.seasons.join(' | ') || '-'}; ${s.description}`),
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const kiteClubHatterasAvon: OfferAdapter = {
  key: 'kite-club-hatteras-avon',
  name: 'Kite Club Hatteras guest house, Avon',
  kind: 'accommodation',
  disciplines: ['kitesurf', 'wingfoil'],
  operator: KCH_OPERATOR,
  url: KCH_ACCOM_URL,
  slotMethod: 'price_table',
  fetchBudget: 4,
  confidence: 'medium',
  async fetchContent() {
    const accom = await kchFetch(KCH_ACCOM_URL);
    const about = await kchFetch(KCH_ABOUT_URL);
    const products = await kchFetch(KCH_PRODUCTS_URL);
    return parseKiteClubHatterasContent({ accom, about, products });
  },
  async fetchSlots(ctx): Promise<Slot[]> {
    const stays = kchStayProducts(parseKchProducts(await kchFetch(KCH_PRODUCTS_URL)));
    if (stays.length < 3) throw new Error(`kite-club-hatteras: room / house products missing in the Store API list (${stays.length})`);
    const priced = stays.filter(s => s.price !== null);
    if (priced.length) ctx.note(`room products got prices (${priced.map(s => `${s.name} ${s.price} ${s.currency}`).join(', ')}): extend the adapter`);
    return [];
  },
};
