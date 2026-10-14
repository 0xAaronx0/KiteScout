// ---------------------------------------------------------------------------
// Playa Central Windsports camps, La Ventana (Baja California Sur, Mexico) - the kite and wing school, shop
// and beach restaurant Playa Central runs all-inclusive 7-day camps with a private bedroom and bathroom in a
// villa with pool and hot tub (the villa is not named), daily yoga, chef breakfast, lunch at Playa Central
// and airport transport. Only the camps that involve kiting are listed here (2026-10-14: Beginner
// Kiteboarding Camp, Women's Wellness and Windsports Camp (kite or wing), Adventure Wing & Kite Foil Camp);
// the wingfoil and parawing downwinder camps are left out. Kind 'camp'.
//
// Data path (checked 2026-10-14), Squarespace site www.playacentralkiteboarding.com:
//   /windsport-camps  accordion of upcoming camps: title "Beginner Kiteboarding Camp: Jan 10-16, 2027", text,
//                     "Starting at $2,899 Private Queen | $3,099 Double | $3,299 Deluxe Suite" and a link
//                     to the Squarespace product /school/p/<slug>. A camp counts as kiting when its title or
//                     text mentions "kite". The page's Static.SQUARESPACE_CONTEXT carries the site location
//                     (mapLat/mapLng of Playa Central, Calle Salome Lucero) -> spotCoords.
//   /school/p/<slug>  the product page itself (no API call): <div data-controller="ProductDetail"
//                     data-context="{...}"> holds the product JSON with variants
//                     [{ price {currency, value}, qtyInStock, unlimited, soldOut, attributes {Dates,
//                     Accomodation} }], title with the year ("| JAN. 10 -16, 2027") and the photo list.
//   No cart, no checkout, no ?format=json (robots-disallowed).
// robots.txt (2026-10-14): Squarespace defaults (disallows /api/, /static/, /search, ?format=json etc.;
//   pages and /school/p/ are allowed). Our UA is not in its AI-bot group.
// Requests per run: 1 + one per kiting camp (3 on 2026-10-14), memoised across content and slots.
// Slots: one per camp x room type, key `<camp>|<room>|<start>`, unit "<camp> · <room>", priceUnit 'package',
//   priceBasis 'person' (each camper gets a private room; sharing gives 10% off each, text only), USD as
//   the product JSON states. Availability from Squarespace stock: soldOut or 0 left -> sold_out, <= 2 left
//   -> limited, else available; spotsLeft = qtyInStock of that room type. Dates from the variant ("January
//   10 - 16") with the year from the product title.
// Known limits: the Adventure camp's product title says "MAR. 7 - MAR. 12, 2027" while its variant and the
//   camps page say March 7-13; the variant wins. The pay-in-full 5% discount, the $500 deposit, the
//   companion price ($1,899) and the $699 gear rental (foil camps) are text, not slots.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, daysInclusive, parse, parseRange, todayIso, type HTMLElement } from '../parse.js';
import type { Availability, ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.playacentralkiteboarding.com';
export const PC_CAMPS_URL = `${SITE}/windsport-camps`;

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
const txt = (el: HTMLElement | null | undefined): string => collapse(el?.text ?? '');
const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
function decodeAttr(s: string): string {
  return s.replace(/&quot;/g, '"').replace(/&#39;|&#039;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/** One name per accommodation type across camps ("Private Queen" and "Private Queen Bedroom" are the same room). */
export function pcRoomName(room: string): string {
  return /queen/i.test(room) ? 'Private Queen Bedroom' : /double/i.test(room) ? 'Double Room' : /deluxe/i.test(room) ? 'Deluxe Suite' : room;
}

// --- camps page ------------------------------------------------------------------------
export interface PcCampItem { title: string; name: string; text: string; url: string | null; kiting: boolean }

/** Accordion items of /windsport-camps: title, text, product link; kiting = "kite" in title or text. */
export function parsePcCampList(html: string): PcCampItem[] {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, svg')) el.remove();
  return root.querySelectorAll('li.accordion-item').map(li => {
    const title = txt(li.querySelector('.accordion-item__title'));
    const body = li.querySelector('.accordion-item__dropdown') ?? li;
    const text = txt(body).replace(title, '').trim();
    const href = li.querySelectorAll('a').map(a => a.getAttribute('href') ?? '').find(h => /\/school\/p\//.test(h)) ?? null;
    return {
      title,
      name: title.split(':')[0].trim(),
      text,
      url: href ? new URL(href, SITE).toString() : null,
      kiting: /\bkite/i.test(`${title} ${text}`),
    };
  }).filter(c => c.title && c.url && /camp/i.test(c.title)); // FAQ items have no product link
}

/** Site location from Static.SQUARESPACE_CONTEXT (the business address pin). */
export function pcCoords(html: string): { lat: number; lng: number } | null {
  const m = html.match(/"location":\{[^}]*"mapLat":(-?\d+\.\d+),"mapLng":(-?\d+\.\d+)/);
  return m ? { lat: Number(m[1]), lng: Number(m[2]) } : null;
}

// --- product pages ---------------------------------------------------------------------
export interface PcVariant { dates: string; room: string; price: number; currency: string; qty: number | null; unlimited: boolean; soldOut: boolean }
export interface PcProduct { title: string; url: string; variants: PcVariant[]; images: string[] }

export function parsePcProduct(html: string, url: string): PcProduct | null {
  const m = html.match(/data-controller="ProductDetail"[^>]*?data-context="([^"]*)"/) ?? html.match(/data-context="([^"]*&quot;variants&quot;[^"]*)"/);
  if (!m) return null;
  let ctx: { product?: Record<string, unknown> };
  try { ctx = JSON.parse(decodeAttr(m[1])); } catch { return null; }
  const p = ctx.product;
  if (!p) return null;
  const variants = ((p.variants as Array<Record<string, any>>) ?? []).map(v => ({
    dates: collapse(String(v.attributes?.Dates ?? '')),
    room: collapse(String(v.attributes?.Accomodation ?? v.attributes?.Accommodation ?? '')).replace(/\s*[-—–]\s*\$\s?[\d,.]+\s*$/, '').trim(),
    price: Number(v.price?.value),
    currency: String(v.price?.currency ?? ''),
    qty: Number.isFinite(Number(v.qtyInStock)) ? Number(v.qtyInStock) : null,
    unlimited: v.unlimited === true,
    soldOut: v.soldOut === true,
  })).filter(v => v.dates && v.room && v.price > 0 && /^[A-Z]{3}$/.test(v.currency));
  const images = ((p.images as Array<{ assetUrl?: string }>) ?? []).map(i => i.assetUrl ?? '').filter(u => /^https?:/.test(u));
  return { title: collapse(String(p.title ?? '')), url, variants, images };
}

export function pcAvailability(v: PcVariant): { availability: Availability; text: string | null; spotsLeft: number | null } {
  if (v.unlimited) return { availability: v.soldOut ? 'sold_out' : 'available', text: v.soldOut ? 'Sold out' : null, spotsLeft: null };
  const left = v.qty !== null ? Math.max(0, Math.trunc(v.qty)) : null;
  if (v.soldOut || left === 0) return { availability: 'sold_out', text: 'Sold out', spotsLeft: 0 };
  if (left !== null && left <= 2) return { availability: 'limited', text: `${left} left`, spotsLeft: left };
  return { availability: 'available', text: left !== null ? `${left} left` : null, spotsLeft: left };
}

export interface PcCamp { item: PcCampItem; product: PcProduct }

export function buildPcSlots(camps: PcCamp[], today = todayIso()): Slot[] {
  const slots: Slot[] = [];
  for (const { item, product } of camps) {
    const year = Number((product.title.match(/\b(20\d{2})\b/g) ?? item.title.match(/\b(20\d{2})\b/g) ?? []).pop());
    for (const v of product.variants) {
      const range = parseRange(v.dates, Number.isFinite(year) && year > 0 ? year : undefined);
      if (!range || range.end < today) continue;
      const st = pcAvailability(v);
      slots.push({
        key: `${slug(item.name)}|${slug(pcRoomName(v.room))}|${range.start}`,
        startDate: range.start,
        endDate: range.end,
        unit: `${item.name} · ${pcRoomName(v.room)}`,
        price: v.price,
        currency: v.currency,
        priceUnit: 'package',
        priceBasis: 'person',
        occupancy: 1,
        availability: st.availability,
        availabilityText: st.text,
        spotsLeft: st.spotsLeft,
      });
    }
  }
  return slots;
}

// --- content ---------------------------------------------------------------------------
export function parsePcContent(campsHtml: string, camps: PcCamp[]): OfferContent {
  const root = parse(campsHtml);
  for (const el of root.querySelectorAll('script, style, noscript, svg, header, footer, nav')) el.remove();
  const text = txt(root.querySelector('main') ?? root.querySelector('body') ?? root);
  const coords = pcCoords(campsHtml);

  // "Every camp includes a private bedroom and bathroom in a villa with pool and hot tub, daily yoga, ..."
  const incl = text.match(/Every camp includes (.+?)\.\s/)?.[1] ?? '';
  const includedServices = incl.split(/,\s*(?:and\s+)?/).map(s => s.trim()).filter(Boolean).map(s => s[0].toUpperCase() + s.slice(1));
  const access = text.match(/Access to Playa Central's ([^.]+?) is included/i)?.[1];
  if (access) includedServices.push(`Use of Playa Central's ${access}`);
  includedServices.push('Camp-specific coaching or guided sessions (see each camp)');

  const companion = text.match(/Non-riding guests are welcome to join for \$([\d,]+)/i)?.[1];
  const rental = text.match(/add a weekly (?:wingfoil or parawing )?rental(?: package)? for \$([\d,]+)/i)?.[1];
  const optionalServices = [
    ...(companion ? [`Non-riding companion sharing a room: USD ${companion}`] : []),
    ...(rental ? [`Weekly gear rental for the foil camps: USD ${rental}`] : []),
    'Extra lessons and rentals during the week (discounted for camp guests)',
    'Massages and ocean tours',
  ];

  // rooms: the three accommodation types with each kiting camp's price
  const roomOrder: string[] = [];
  const roomPrices = new Map<string, string[]>();
  for (const { item, product } of camps) {
    for (const v of product.variants) {
      const base = pcRoomName(v.room);
      if (!roomPrices.has(base)) { roomPrices.set(base, []); roomOrder.push(base); }
      roomPrices.get(base)!.push(`${item.name} (${v.dates}): ${v.currency} ${v.price.toLocaleString('en-US')} per person`);
    }
  }
  const order = ['Private Queen Bedroom', 'Double Room', 'Deluxe Suite'];
  roomOrder.sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99));
  const rooms: ContentRoom[] = roomOrder.map(name => ({
    name,
    description: 'Private bedroom with private bathroom in the camp villa (pool and hot tub).',
    features: roomPrices.get(name)!,
  }));

  // photos: the products' galleries round-robin, without the date flyers ("WITH DATES" graphics)
  const lists = camps.map(c => c.product.images.filter(u => !/WITH\+DATES|WITH%20DATES|with-dates/i.test(u)));
  const imageUrls: string[] = [];
  for (let i = 0; imageUrls.length < 30 && lists.some(l => i < l.length); i++) {
    for (const l of lists) if (l[i] && !imageUrls.includes(l[i])) imageUrls.push(l[i]);
  }

  const first = camps.map(c => buildPcSlots([c], '1970-01-01')[0]).filter(Boolean);
  const durationDays = first.length ? daysInclusive(first[0].startDate!, first[0].endDate!) : 7;
  const prices = camps.flatMap(c => c.product.variants.map(v => v.price));
  const campList = camps.map(c => c.item.title.replace(/:\s*/, ' (') + ')').join('; ');

  const summary = [
    `Playa Central is a kite and wing school with shop, rentals and a beach restaurant on the beach of La Ventana, Baja California Sur, and runs all-inclusive 7-day camps in the winter wind season.`,
    `Kiting camps for 2026/27: ${campList || 'see the camps page'}; lessons are private one-on-one (6 hours in the beginner and women's camps), the adventure camp is guided foiling for intermediate and advanced riders with their own or rented gear.`,
    `Every camp includes a private bedroom and bathroom in a villa with pool and hot tub, daily yoga, breakfast by a private chef, lunch at Playa Central and airport and local transport${prices.length ? `; prices run from USD ${Math.min(...prices).toLocaleString('en-US')} to ${Math.max(...prices).toLocaleString('en-US')} per person by room type` : ''}.`,
  ].join(' ');

  return {
    kind: 'camp',
    title: 'Playa Central Windsports Camps',
    summary,
    continent: 'North America',
    country: 'Mexico',
    region: 'La Ventana, Baja California Sur',
    spot: 'La Ventana',
    ...(coords ? { spotCoords: coords } : {}),
    itinerarySpots: [],
    durationDays,
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: true,
    equipmentRental: true,
    beginnerFriendly: camps.some(c => /beginner/i.test(c.item.title)),
    includedServices,
    optionalServices,
    accommodation: 'private bedroom and bathroom in a shared villa with pool and hot tub',
    mealPlan: 'breakfast and lunch',
    languages: ['en'],
    rooms,
    imageUrls,
    heroVideoUrl: null,
    sourceUrl: PC_CAMPS_URL,
    bookingUrl: camps[0]?.product.url ?? PC_CAMPS_URL,
    sourceText: [
      `camps page: ${text}`,
      ...camps.map(c => `product ${c.product.title}: ${c.product.variants.map(v => `${v.dates} / ${v.room} ${v.currency} ${v.price} qty ${v.qty}${v.soldOut ? ' sold out' : ''}`).join('; ')}`),
      `site location: ${coords ? `${coords.lat},${coords.lng}` : '-'}`,
    ].join('\n'),
  };
}

async function loadCamps(): Promise<{ html: string; camps: PcCamp[] }> {
  const html = await page(PC_CAMPS_URL);
  const items = parsePcCampList(html).filter(c => c.kiting && c.url);
  const camps: PcCamp[] = [];
  for (const item of items) {
    const product = parsePcProduct(await page(item.url!), item.url!);
    if (product && product.variants.length) camps.push({ item, product });
  }
  return { html, camps };
}

export const playaCentralCampsLaVentana: OfferAdapter = {
  key: 'playa-central-camps-la-ventana',
  name: 'Playa Central Windsports Camps (kiting camps), La Ventana',
  kind: 'camp',
  operator: {
    name: 'Playa Central Kiteboarding',
    websiteUrl: SITE,
    rootDomain: 'playacentralkiteboarding.com',
    contactEmail: 'info@playacentralkiteboarding.com',
    whatsapp: '+52 612 114 0267',
  },
  url: PC_CAMPS_URL,
  slotMethod: 'booking_engine',
  instantBooking: true,
  liveAvailability: true,
  fetchBudget: 6,
  async fetchContent(ctx) {
    const { html, camps } = await loadCamps();
    if (camps.length === 0) ctx.note('playa-central: no kiting camp products found on /windsport-camps');
    return parsePcContent(html, camps);
  },
  async fetchSlots(ctx) {
    const { html, camps } = await loadCamps();
    const listed = parsePcCampList(html).filter(c => c.kiting && c.url).length;
    if (listed === 0) throw new Error('playa-central: no kiting camps on /windsport-camps (layout changed?)');
    if (camps.length < listed) ctx.incomplete(`playa-central: ${listed - camps.length} of ${listed} camp product pages had no variant data`);
    return buildPcSlots(camps);
  },
};
