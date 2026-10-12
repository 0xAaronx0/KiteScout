// ---------------------------------------------------------------------------
// Urla Kite Camp, Gülbahçe (Urla, İzmir, Turkey) - long-standing kitesurf school with a small hotel
// (Design and Classic rooms), a tent camping area, café / restaurant with a wood-fired oven and a shop
// (Turkish Naish Kites representative), a few steps from the sea at Gülbahçe. A separate business from
// Urla Surf House (other address, 12075/1 Sok. No:5 vs 12075 Sk. No:46, and other phone numbers).
//
// Liveness (re-check 2026-10-12, verdict LIVE): the site was rebuilt and republished in 2026 - sitemap.xml
//   lastmod 2026-07-28 for the one page, and a new robots.txt written for 2025/26 AI search crawlers
//   (OAI-SearchBot, PerplexityBot, ClaudeBot ...); the page lists the current offer (courses, Kite & Stay
//   package, rooms, café, shop). No 2026-dated social post or review was found in search snippets (OTA
//   listings exist; hints only, not data).
//
// Data path (checked 2026-10-12): www.urlakitecamp.com, a static one-page site in Turkish (no English
//   version despite og:locale:alternate en_US):
//   content  / only: sections #kitesurf (course content), #hotel (Design Room, Classic Room, tent area),
//            #cafe, #shop, #kite-stay (package: 2 nights / 3 days, 6 h lessons with all gear, breakfast),
//            #community, #spot (thermal summer wind), #contact (address, phone, e-mail, WhatsApp),
//            JSON-LD SportsActivityLocation (address, phone, sports). Several course items (advanced
//            package, wing foil, rental, supervision) are commented out in the HTML and are NOT used.
//   slots    none: the site prints no price; rooms and lessons are booked by WhatsApp ("Rezervasyon için
//            iletişim"). fetchSlots re-reads the page (memoised) and returns [] (offer = "price on
//            request"); it notes when an amount shows up so the adapter can be extended.
// robots.txt (2026-10-12): "User-agent: * Allow: /" (explicit allow lists for search and AI bots).
// Requests per run: content 1, slots 1 (0 extra when content ran in the same process).
// Known limits: the summary is an English rendering of the Turkish facts; no coordinates on the site (the
//   map link is an address query) - the spot is geocoded from "Gülbahçe, Urla"; no season dates.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, findPrices, imageCandidates, ldOfType, parse, type HTMLElement } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.urlakitecamp.com';
export const UKC_HOME_URL = `${SITE}/`;
const WHATSAPP = '+905326065579';
const BOOKING_URL = 'https://wa.me/905326065579';

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

/** The page without HTML comments (commented-out course items must not count as offered). */
function root(html: string): HTMLElement {
  return parse(html.replace(/<!--[\s\S]*?-->/g, ''));
}

export interface UkcSection { id: string; text: string; facts: Array<{ title: string | null; detail: string }> }

/** Each <section id=...>: description paragraphs + the facts list (title/detail pairs; picture tiles dropped). */
export function parseUkcSections(html: string): UkcSection[] {
  return root(html).querySelectorAll('section[id]').map(s => {
    const text = collapse(s.querySelectorAll('.section__description-inner').map(e => e.text).join(' '));
    const facts = s.querySelectorAll('.section__facts-item')
      .filter(li => !li.classNames.includes('section__facts-item--clickable'))
      .map(li => ({
        title: collapse(li.querySelector('.section__facts-title')?.text ?? '') || null,
        detail: collapse(li.querySelector('.section__facts-detail')?.text ?? ''),
      }))
      .filter(f => f.title || f.detail);
    return { id: s.getAttribute('id') ?? '', text, facts };
  });
}

/** Visible text of the whole page (comments, scripts, styles dropped). */
export function ukcText(html: string): string {
  const r = root(html);
  for (const el of r.querySelectorAll('script, style, noscript, svg')) el.remove();
  return collapse((r.querySelector('body') ?? r).text);
}

export function parseUrlaKiteCampContent(html: string): OfferContent {
  const sections = parseUkcSections(html);
  const sec = (id: string) => sections.find(s => s.id === id) ?? { id, text: '', facts: [] };
  const kite = sec('kitesurf');
  const hotel = sec('hotel');
  const cafe = sec('cafe');
  const shop = sec('shop');
  const stay = sec('kite-stay');
  const spot = sec('spot');
  const contact = sec('contact');
  const place = ldOfType(html, 'SportsActivityLocation')[0] ?? {};
  const address = (place.address ?? {}) as Record<string, unknown>;
  const fact = (s: UkcSection, title: RegExp) => s.facts.find(f => f.title && title.test(f.title))?.detail ?? null;

  const course = kite.facts.map(f => f.detail.replace(/^-\s*/, '')).filter(Boolean);
  const stayNights = fact(stay, /Paket İçeriği/i)?.match(/(\d+)\s*Gece\s*(\d+)\s*Gün/i);
  const stayHours = fact(stay, /Kitesurf Eğitimi/i)?.match(/(\d+)\s*Saat/i)?.[1] ?? null;
  const stayIncl = fact(stay, /Konaklama Dahil/i);
  const facilities = stay.text.match(/olanaklar:\s*([^.]+)\./i)?.[1] ?? null;
  const naish = /Naish Kites[”"]?ın Türkiye temsilcisidir/i.test(shop.text);
  const woodOven = /odun fırını/i.test(cafe.text);

  const roomDesc: Record<string, string> = {
    'Design Room': 'Rooms with more living space and extra comfort.',
    'Classic Room': 'Simple, comfortable and functional rooms.',
    'Çadır Konaklama': 'Tent pitches in the camping area, popular in summer.',
  };
  const rooms: ContentRoom[] = hotel.facts.filter(f => f.title && roomDesc[f.title]).map(f => ({
    name: f.title === 'Çadır Konaklama' ? 'Tent (camping area)' : f.title!,
    description: roomDesc[f.title!],
    features: [],
  }));

  const summary = [
    `Urla Kite Camp is a long-established kitesurf school in Gülbahçe (Urla, İzmir) on the Aegean coast of Turkey with its own small hotel, a tent camping area, a café and a shop${naish ? ' (it is the Turkish representative of Naish Kites)' : ''}, a few steps from the sea.`,
    `Guests stay in ${rooms.length ? rooms.map(r => (r.name === 'Tent (camping area)' ? 'tents in the camping area' : r.name.replace(/Room$/, 'Rooms'))).join(', ').replace(/, ([^,]*)$/, ' or $1') : 'rooms or tents'}; the café serves Aegean breakfast, bowls, snacks and vegan dishes${woodOven ? ' plus pizza and stews from a wood-fired oven' : ''}, and the grounds have free Wi-Fi, hot showers, a bar and free parking.`,
    `Courses cover wind and safety theory, equipment, kite control, land drills, water starts, board starts and first rides; the Kite & Stay package combines ${stayNights ? `${stayNights[1]} nights / ${stayNights[2]} days` : 'a short stay'}${stayHours ? ` with ${stayHours} hours of lessons and all equipment` : ' with lessons'}, breakfast, Wi-Fi and tea and coffee all day.`,
    'Gülbahçe has regular thermal winds in summer; rooms and lessons are booked by WhatsApp and the site publishes no prices.',
  ].join(' ');

  const order = ['/img/hotel/', '/img/otel', '/img/kitesurf', '/img/kite%26stay', '/img/spot', '/img/community', '/img/cafe', '/img/shop'];
  const imgs = imageCandidates(html, UKC_HOME_URL, null, 80).filter(u => !/logo|favicon|icon|\.svg/i.test(u));
  const rank = (u: string) => { const i = order.findIndex(o => u.includes(o)); return i < 0 ? order.length : i; };
  const imageUrls = imgs.map((u, i) => ({ u, i })).sort((a, b) => rank(a.u) - rank(b.u) || a.i - b.i).map(x => x.u);

  return {
    kind: 'accommodation',
    title: 'Urla Kite Camp',
    summary,
    continent: 'Europe',
    country: 'Turkey',
    region: typeof address.addressRegion === 'string' ? address.addressRegion : 'İzmir',
    spot: 'Gülbahçe, Urla',
    itinerarySpots: [],
    durationDays: null,
    // "Daha önce hiç kitesurf yapmamış olsanız da, mevcut seviyenizi geliştirmek isteseniz de ... her seviyeye uygun"
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: course.length > 0,
    equipmentRental: null, // the rental item is commented out on the page (2026-10-12)
    beginnerFriendly: /hiç kitesurf yapmamış/i.test(kite.text),
    includedServices: [
      /Ücretsiz Wi-Fi/i.test(facilities ?? '') ? 'Free Wi-Fi' : null,
      /sıcak duş/i.test(facilities ?? '') ? 'Hot showers' : null,
      /ücretsiz otopark/i.test(facilities ?? '') ? 'Free parking' : null,
      /elektrik/i.test(facilities ?? '') ? 'Electricity in the camping area' : null,
    ].filter((x): x is string => !!x),
    optionalServices: [
      course.length ? 'Kitesurf lessons for all levels (theory, kite control, land drills, water and board starts, first rides)' : null,
      stayNights ? `Kite & Stay package: ${stayNights[1]} nights / ${stayNights[2]} days${stayHours ? `, ${stayHours} h of kitesurf lessons with all equipment` : ''}${stayIncl ? ', breakfast, Wi-Fi, tea and coffee' : ''}` : null,
      'Café / restaurant (breakfast, snacks, vegan dishes, cocktails)',
      naish ? 'Kite shop (Naish Kites, Quiksilver, GoPro, G-Shock)' : 'Kite shop',
    ].filter((x): x is string => !!x),
    accommodation: 'small hotel with design and classic rooms plus a tent camping area',
    mealPlan: null, // breakfast is listed for the Kite & Stay package only
    languages: ['tr'],
    rooms,
    imageUrls: imageUrls.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: UKC_HOME_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      ...sections.map(s => `${s.id}: ${s.text}${s.facts.length ? ` | facts: ${s.facts.map(f => `${f.title ?? ''}${f.title ? ': ' : ''}${f.detail}`).join(' ; ')}` : ''}`),
      `json-ld: ${[address.streetAddress, address.postalCode, address.addressLocality, address.addressRegion].filter(Boolean).join(', ')}; sports ${JSON.stringify(place.sport ?? [])}`,
      `contact: ${contact.text}`,
    ].join('\n'),
  };
}

/** No published price: [] (price on request). Returns the amounts if the page starts printing some. */
export function ukcVisiblePrices(html: string): string[] {
  // Turkish lira is written "₺" or "TL": findPrices does not know them, so catch them here
  const t = ukcText(html);
  const lira = [...t.matchAll(/(?:₺\s?\d[\d.,]*|\d[\d.,]*\s?(?:₺|TL\b))/g)].map(m => m[0]);
  return [...findPrices(t).map(p => p.raw), ...lira];
}

// --- adapter ----------------------------------------------------------------------------------
export const urlaKiteCampGulbahce: OfferAdapter = {
  key: 'urla-kite-camp-gulbahce',
  name: 'Urla Kite Camp Gülbahçe',
  kind: 'accommodation',
  operator: {
    name: 'Urla Kite Camp',
    websiteUrl: SITE,
    rootDomain: 'urlakitecamp.com',
    contactEmail: 'info@urlakitecamp.com',
    whatsapp: WHATSAPP,
    phone: WHATSAPP,
  },
  url: UKC_HOME_URL,
  slotMethod: 'price_table',
  fetchBudget: 2,
  confidence: 'low', // no prices or dates on the site; inquiry only
  async fetchContent() {
    return parseUrlaKiteCampContent(await page(UKC_HOME_URL));
  },
  async fetchSlots(ctx): Promise<Slot[]> {
    const html = await page(UKC_HOME_URL);
    if (!/id="hotel"/.test(html)) throw new Error('urla-kite-camp: hotel section missing (layout changed?)');
    const prices = ukcVisiblePrices(html);
    if (prices.length) ctx.note(`prices appeared on the page (${prices.slice(0, 5).join(', ')}): extend the adapter`);
    return [];
  },
};
