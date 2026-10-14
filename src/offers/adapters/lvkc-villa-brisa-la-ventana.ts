// ---------------------------------------------------------------------------
// La Ventana Kite Camp (LVKC) at Villa Brisa, La Ventana (Baja California Sur, Mexico) - hosted 6-night kite
// camp weeks in a beachfront villa on the kite spot: private 1-to-1 coaching (up to 15 hours), gear, chef
// breakfast and lunch, yoga, run by Alina and Louis. Kind 'camp' (dated weeks with coaching).
//
// Data path (checked 2026-10-14), static site on Vercel, English + Spanish in the same HTML (lang spans):
//   slots    GET /api/camps?public=1 - the JSON the page's own script (assets/js/camps.js) loads anonymously,
//            no key, no cookie: { camps: [{ id, titleEn, startDate, endDate, spotsTotal, spotsRemaining,
//            statusOverride, published, order }] }. On an HTTP error the site falls back to
//            assets/content/camps.json; so do we. The camp cards baked into the HTML are stale (2026-10-14:
//            HTML "6 spots left", API 3), so the API is the source.
//            Room prices: /kite-camps room tabs, data-room-title-en / data-room-price ("3,250") /
//            data-room-count-en ("7 suites available"); the page prints "Package Price 3,250 USD" and
//            "1 guest Total 3,250 USD" -> USD per guest for the whole camp week.
//   content  /kite-camps (schedule, coaching, inclusion cards, villa, rooms), / (JSON-LD LocalBusiness: phone,
//            e-mail, geo 24.0522,-109.993 -> spotCoords), /gallery-kite-camp (photos).
// robots.txt (2026-10-14): "User-agent: * Allow: /".
// Requests per run: 4 (kite-camps page and API memoised across content + slots, home, gallery).
// Slots: camp week x room type, key `<room>|<start>`, unit = room name, priceUnit 'package', priceBasis
//   'person', occupancy 1, USD. Availability mirrors the site's computeStatus(): statusOverride unless
//   'auto', else 0 left = full, <= 2 = few, else open; open/filling -> available, few -> limited,
//   full -> sold_out, soon ("Opening Soon") -> closed. spotsLeft = the week's spotsRemaining (guests, shared
//   by all room types; repeated on each room slot). Past weeks and unpublished weeks are dropped.
// Known limits: booking is a request form; the room is confirmed by mail within 24 h, so room-level
//   availability is not published (only the room-type count). The 10% sharing discount and the non-kiter
//   partner price ("special pricing", no amount) are text, not slots.
// ---------------------------------------------------------------------------
import { fetchJson, fetchText, HttpStatusError } from '../http.js';
import { collapse, daysInclusive, imageCandidates, ldOfType, parse, parseAmount, todayIso, type HTMLElement } from '../parse.js';
import type { Availability, ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.laventanacamps.com';
export const LVKC_CAMPS_URL = `${SITE}/kite-camps`;
export const LVKC_HOME_URL = `${SITE}/`;
export const LVKC_GALLERY_URL = `${SITE}/gallery-kite-camp`;
export const LVKC_API_URL = `${SITE}/api/camps?public=1`;
const LVKC_FALLBACK_URL = `${SITE}/assets/content/camps.json`;

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
const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
/** Collapsed text of an element of root() (Spanish spans already removed). */
const en = (el: HTMLElement | null | undefined): string => collapse(el?.text ?? '');
/** Parse, drop scripts/styles/svg and the Spanish half of the bilingual page (lang="es" elements). */
function root(html: string): HTMLElement {
  const r = parse(html);
  for (const el of r.querySelectorAll('script, style, noscript, svg, [lang="es"]')) el.remove();
  return r;
}

// --- camp weeks (API) ---------------------------------------------------------------
export interface LvkcCamp {
  id: string; titleEn: string; startDate: string; endDate: string;
  spotsTotal: number | null; spotsRemaining: number | null; statusOverride: string | null;
  published: boolean; order: number;
}
export function parseLvkcCamps(json: unknown): LvkcCamp[] {
  const list = Array.isArray(json) ? json : ((json as { camps?: unknown[] })?.camps ?? []);
  return (list as Array<Record<string, unknown>>).map(c => ({
    id: String(c.id ?? ''),
    titleEn: String(c.titleEn ?? ''),
    startDate: String(c.startDate ?? ''),
    endDate: String(c.endDate ?? ''),
    spotsTotal: Number.isFinite(Number(c.spotsTotal)) ? Number(c.spotsTotal) : null,
    spotsRemaining: Number.isFinite(Number(c.spotsRemaining)) ? Number(c.spotsRemaining) : null,
    statusOverride: typeof c.statusOverride === 'string' ? c.statusOverride : null,
    published: c.published === true,
    order: Number(c.order ?? 0),
  })).filter(c => /^\d{4}-\d{2}-\d{2}$/.test(c.startDate) && /^\d{4}-\d{2}-\d{2}$/.test(c.endDate))
    .sort((a, b) => a.order - b.order || a.startDate.localeCompare(b.startDate));
}

/** The site's own computeStatus() (assets/js/camps.js, 2026-10-14). */
export function lvkcStatus(c: LvkcCamp): string {
  if (c.statusOverride && c.statusOverride !== 'auto') return c.statusOverride;
  const remaining = c.spotsRemaining ?? 0;
  const total = c.spotsTotal || 1;
  if (remaining <= 0) return 'full';
  if (remaining <= 2) return 'few';
  if (remaining <= total / 2) return 'filling';
  return 'open';
}
const STATUS: Record<string, { availability: Availability; label: string }> = {
  open: { availability: 'available', label: 'Available' },
  filling: { availability: 'available', label: 'Available' },
  few: { availability: 'limited', label: 'Available' },
  soon: { availability: 'closed', label: 'Opening Soon' },
  full: { availability: 'sold_out', label: 'Sold Out' },
};

// --- rooms + prices (page) ------------------------------------------------------------
export interface LvkcRoom { name: string; price: number; currency: string; count: string | null; description: string | null; features: string[] }
export function parseLvkcRooms(html: string): LvkcRoom[] {
  const r = parse(html);
  const currency = /\d[\d,]*\s*USD\b/.test(r.text) ? 'USD' : null; // "Package Price 3,250 USD"
  const out: LvkcRoom[] = [];
  for (const b of r.querySelectorAll('[data-room-title-en][data-room-price]')) {
    const name = collapse(b.getAttribute('data-room-title-en') ?? '');
    const price = parseAmount(b.getAttribute('data-room-price') ?? '');
    if (!name || !price || !currency) continue;
    let features: string[] = [];
    try { features = JSON.parse(b.getAttribute('data-room-features-en') ?? '[]'); } catch { /* keep [] */ }
    out.push({
      name, price, currency,
      count: collapse(b.getAttribute('data-room-count-en') ?? '') || null,
      description: collapse(b.getAttribute('data-room-desc-en') ?? '') || null,
      features: features.map(f => collapse(String(f))).filter(Boolean),
    });
  }
  return out;
}

export function buildLvkcSlots(camps: LvkcCamp[], rooms: LvkcRoom[], today = todayIso()): Slot[] {
  const slots: Slot[] = [];
  for (const c of camps) {
    if (!c.published || c.endDate < today) continue;
    const st = STATUS[lvkcStatus(c)] ?? { availability: 'unknown' as Availability, label: lvkcStatus(c) };
    const left = c.spotsRemaining !== null ? Math.max(0, Math.trunc(c.spotsRemaining)) : null;
    const text = [st.label, left !== null ? `${left === 1 ? '1 spot' : `${left} spots`} left` : null].filter(Boolean).join(' · ');
    for (const room of rooms) {
      slots.push({
        key: `${slug(room.name)}|${c.startDate}`,
        startDate: c.startDate,
        endDate: c.endDate,
        unit: room.name,
        price: room.price,
        currency: room.currency,
        priceUnit: 'package',
        priceBasis: 'person',
        occupancy: 1,
        availability: st.availability,
        availabilityText: `${c.titleEn ? `${c.titleEn}: ` : ''}${text}`,
        spotsLeft: left,
      });
    }
  }
  return slots;
}

// --- content ------------------------------------------------------------------------
export interface LvkcPages { camps: string; home: string; gallery: string }

export function lvkcCoords(homeHtml: string): { lat: number; lng: number } | null {
  for (const o of [...ldOfType(homeHtml, 'LocalBusiness'), ...ldOfType(homeHtml, 'SportsActivityLocation')]) {
    const g = o.geo as { latitude?: unknown; longitude?: unknown } | undefined;
    const lat = Number(g?.latitude), lng = Number(g?.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0) return { lat, lng };
  }
  return null;
}

export function parseLvkcContent(p: LvkcPages, camps: LvkcCamp[] = []): OfferContent {
  const r = root(p.camps);
  const text = en(r.querySelector('body') ?? r);
  const rooms = parseLvkcRooms(p.camps);
  const biz = ldOfType(p.home, 'LocalBusiness')[0] ?? {};
  const coords = lvkcCoords(p.home);

  const inclusions = r.querySelectorAll('.inclusion-card').map(card => {
    const title = en(card.querySelector('.inclusion-card-title'));
    const body = en(card.querySelector('.inclusion-card-text'));
    return title && body ? `${title}: ${body.replace(/\.$/, '')}` : title;
  }).filter(Boolean);

  const nightsM = text.match(/(\d+)\s+nights in a premium beachfront property/i)?.[1];
  const nights = nightsM ? Number(nightsM) : /Six nights/i.test(text) ? 6 : NaN;
  const firstWeek = camps.find(c => c.published);
  const durationDays = firstWeek ? daysInclusive(firstWeek.startDate, firstWeek.endDate) : (Number.isFinite(nights) ? nights + 1 : 7);
  const hours = text.match(/up to (\d+) hours of private 1-to-1 coaching/i)?.[1] ?? '15';
  const weeks = text.match(/We host (\w+) camp weeks/i)?.[1] ?? null;
  const prices = rooms.map(x => x.price);
  const min = prices.length ? Math.min(...prices) : null;
  const max = prices.length ? Math.max(...prices) : null;

  const contentRooms: ContentRoom[] = rooms.map(x => ({
    name: x.name,
    description: x.description,
    features: [
      ...x.features,
      ...(x.count ? [`${x.count} in Villa Brisa`] : []),
      `${x.currency} ${x.price.toLocaleString('en-US')} per guest for the camp week`,
    ],
  }));
  const shareDiscount = text.match(/10% discount per guest when two guests travelling together share a room/i)?.[0] ?? null;
  for (const room of contentRooms) if (shareDiscount) room.features.push(shareDiscount);

  const seen = new Set<string>();
  const imageUrls: string[] = [];
  for (const u of [...imageCandidates(p.camps, LVKC_CAMPS_URL, null, 40), ...imageCandidates(p.gallery, LVKC_GALLERY_URL, null, 40)]) {
    if (/logo|icon|floorplan|\.svg|og\.png/i.test(u)) continue;
    if (seen.has(u)) continue;
    seen.add(u); imageUrls.push(u);
  }

  const summary = [
    `La Ventana Kite Camp (LVKC) hosts ${weeks ?? 'several'} kite camp weeks per winter wind season in La Ventana, Baja California Sur, with ${Number.isFinite(nights) ? nights : 6} nights in Villa Brisa, a beachfront villa with pool, jacuzzi and fire pit directly on the kite spot.`,
    `Every kiter gets a private 1-to-1 coach for up to ${hours} hours over five days (IKO standards, Ozone kites and boards, BbTALKIN radios), from first lessons to jumps and downwinders; gear, wetsuit and safety equipment are included.`,
    `The week also includes chef-made breakfast and lunch, one group dinner, three yoga sessions, town transport and other activities on no-wind days${min !== null ? `; prices run from USD ${min.toLocaleString('en-US')} to ${max!.toLocaleString('en-US')} per guest depending on the suite` : ''}.`,
  ].join(' ');

  return {
    kind: 'camp',
    title: 'La Ventana Kite Camp (LVKC) at Villa Brisa',
    summary,
    continent: 'North America',
    country: 'Mexico',
    region: 'La Ventana, Baja California Sur',
    spot: 'La Ventana',
    ...(coords ? { spotCoords: coords } : {}),
    itinerarySpots: [],
    durationDays,
    skillLevels: /complete beginners/i.test(text) && /intermediate (&|and) advanced/i.test(text) ? ['beginner', 'intermediate', 'advanced'] : [],
    kiteLessons: true,
    equipmentRental: /gear|kite gear/i.test(inclusions.join(' ')) || null,
    beginnerFriendly: /For Complete Beginners/i.test(text),
    includedServices: inclusions,
    optionalServices: ['Airport transfers (coordinated by the camp)', 'Non-kiter partner package (special pricing on request)'],
    accommodation: 'private suites in a shared beachfront villa (Villa Brisa)',
    mealPlan: 'breakfast and lunch',
    languages: ['en', 'es'],
    rooms: contentRooms,
    imageUrls: imageUrls.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: LVKC_CAMPS_URL,
    bookingUrl: LVKC_CAMPS_URL,
    sourceText: [
      `kite camps: ${text}`,
      `rooms: ${rooms.map(x => `${x.name} ${x.currency} ${x.price} (${x.count ?? '-'})`).join('; ')}`,
      `weeks: ${camps.map(c => `${c.titleEn} ${c.startDate}..${c.endDate} ${c.spotsRemaining}/${c.spotsTotal} ${c.statusOverride}`).join('; ')}`,
      `business: ${JSON.stringify({ telephone: biz.telephone ?? null, email: biz.email ?? null, geo: coords })}`,
    ].join('\n'),
  };
}

let campsMemo: { at: number; p: Promise<LvkcCamp[]> } | null = null;
function loadCamps(ctx?: FetchContext): Promise<LvkcCamp[]> {
  if (campsMemo && Date.now() - campsMemo.at < 10 * 60_000) return campsMemo.p;
  const p = loadCampsOnce(ctx);
  campsMemo = { at: Date.now(), p };
  p.catch(() => { campsMemo = null; });
  return p;
}
async function loadCampsOnce(ctx?: FetchContext): Promise<LvkcCamp[]> {
  try {
    return parseLvkcCamps(await fetchJson(LVKC_API_URL));
  } catch (e) {
    if (!(e instanceof HttpStatusError) && !(e instanceof SyntaxError)) throw e;
    ctx?.note(`lvkc: ${LVKC_API_URL} failed (${(e as Error).message}); using the site's fallback ${LVKC_FALLBACK_URL}`);
    return parseLvkcCamps(await fetchJson(LVKC_FALLBACK_URL));
  }
}

export const lvkcVillaBrisaLaVentana: OfferAdapter = {
  key: 'lvkc-villa-brisa-la-ventana',
  name: 'La Ventana Kite Camp (LVKC) at Villa Brisa',
  kind: 'camp',
  operator: {
    name: 'La Ventana Kite Camp',
    websiteUrl: SITE,
    rootDomain: 'laventanacamps.com',
    contactEmail: 'laventanacamps@gmail.com',
    whatsapp: '+52 612 197 4886',
    phone: '+52 612 197 4886',
  },
  url: LVKC_CAMPS_URL,
  slotMethod: 'booking_engine',
  liveAvailability: true,
  fetchBudget: 6,
  async fetchContent(ctx) {
    const [camps, home, gallery] = [await page(LVKC_CAMPS_URL), await page(LVKC_HOME_URL), await page(LVKC_GALLERY_URL)];
    let weeks: LvkcCamp[] = [];
    try { weeks = await loadCamps(ctx); } catch (e) { ctx.note(`lvkc: camp weeks not loaded for content (${(e as Error).message})`); }
    return parseLvkcContent({ camps, home, gallery }, weeks);
  },
  async fetchSlots(ctx) {
    const rooms = parseLvkcRooms(await page(LVKC_CAMPS_URL));
    if (rooms.length === 0) throw new Error('lvkc: no room prices (data-room-price) on /kite-camps (layout changed?)');
    const camps = await loadCamps(ctx);
    if (camps.length === 0) ctx.note('lvkc: the camps API lists no weeks');
    return buildLvkcSlots(camps, rooms);
  },
};
