// ---------------------------------------------------------------------------
// Sol y Mar surf camp, Corralejo (Fuerteventura, Canary Islands, Spain) - "the original" surf hostel of the
// Flag Beach Watersports Centre (kitesurf, windsurf, surf, wing foil and SUP school + rental at Flag Beach).
// 10 bedrooms (single to quad, no bunk beds), 2 kitchens, rooftop BBQ terrace, continental breakfast.
//
// Separate listing, not a unit of flag-beach-surfers-retreat-corralejo (Aaron 2026-10-12: a second unit only
// if directly next door). The site puts the two houses in different parts of Corralejo: Sol y Mar "in the Old
// Town of Corralejo ... 4km to Flag Beach", Surfer's Retreat "half way between Flag Beach and Corralejo town
// centre ... across the road from the Campanario shopping centre ... 2km to Flag Beach" (/accommodation/,
// both detail pages). Street addresses from search snippets of the portals (hint only, not used as data):
// Sol y Mar Bajo Blanco 7, Surfer's Retreat Calle el Hierro 55 - roughly 1.5 km apart.
//
// Data path (checked 2026-10-27, after Flag Beach's Oct 2026 redesign; was a WP page 623 + Cloudbeds until then):
//   content  GET /wp-json/wp/v2/stay/82?_fields=id,link,modified,title,content  (custom post type "stay", linked
//            from the detail page's <link rel="alternate">): description, minimum stay, rooms, breakfast.
//          + /accommodation/sol-y-mar/ (detail page, 200 again): hero photo, "Per night: On request", booking by
//            the "Send us your dates" form (confirmed by e-mail with a small deposit) -> instantBooking false.
//          + /accommodation/ (tile "Sol y Mar surf camp", "4 km"; also the liveness guard)
//          + /kite-surfing/kite-surfing-packages/ (the operator's kite school and packages).
//   slots    none: "Prices for this are being finalised" on the detail page -> price on request.
//   The facilities list and the photo slider of the old page are gone; stored images stay (ingest keeps them).
// robots.txt (2026-10-27): /wp-admin/ and the form result params (fb_sent / fb_error) disallowed.
// Requests per run: content 4, slots 1 (the /accommodation/ guard; memoised with content).
// Known limits: which hostel the kite packages' "surf hostel stay" means is not stated (Sol y Mar is called
//   "the Flag Beach surf hostel", Surfer's Retreat "Flag Beach's new hostel"). fetchSlots throws when the tile
//   disappears from /accommodation/.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, parse, parseAmount, type HTMLElement } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent } from '../types.js';

const SITE = 'https://www.flagbeach.com';
export const SYM_API_URL = `${SITE}/wp-json/wp/v2/stay/82?_fields=id,link,modified,title,content`;
export const SYM_DETAIL_URL = `${SITE}/accommodation/sol-y-mar/`;
export const SYM_OVERVIEW_URL = `${SITE}/accommodation/`;
export const SYM_KITE_PACKAGES_URL = `${SITE}/kite-surfing/kite-surfing-packages/`;

// --- local helpers ----------------------------------------------------------------------------
const memo = new Map<string, { at: number; p: Promise<string> }>();
/** one fetch per URL per 10 minutes: fetchContent + fetchSlots in the same run share it */
function get(url: string, accept: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}
const txt = (el: HTMLElement | null | undefined): string => collapse(el?.text ?? '');
function mainText(html: string): string {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, svg, header, footer, nav, aside')) el.remove();
  return collapse((root.querySelector('main') ?? root.querySelector('body') ?? root).text);
}
/** Jetpack Photon URL -> the original on the site ("https://i0.wp.com/flagbeach.com/wp-content/...?resize=..."). */
export function symUnPhoton(u: string): string {
  const m = u.match(/^https:\/\/i\d\.wp\.com\/(?:www\.)?flagbeach\.com(\/wp-content\/[^?#]+)/);
  return m ? `${SITE}${m[1]}` : u;
}

// --- pure parsers -----------------------------------------------------------------------------
export interface SymPage { id: number; modified: string; title: string; html: string }

/** WP REST page JSON -> rendered content. */
export function parseSymApi(json: string): SymPage {
  const o = JSON.parse(json) as { id?: number; modified?: string; title?: { rendered?: string }; content?: { rendered?: string } };
  if (!o.content?.rendered) throw new Error('sol-y-mar: WP stay 82 has no rendered content');
  return { id: o.id ?? 0, modified: o.modified ?? '', title: collapse(parse(`<p>${o.title?.rendered ?? ''}</p>`).text), html: o.content.rendered };
}

/** The Sol y Mar card on /accommodation/: distance line + blurb; null when the card is gone. */
export function parseSymCard(overviewHtml: string): { distance: string | null; blurb: string } | null {
  const root = parse(overviewHtml);
  // tile layout since Oct 2026: <a class="fb-stay"> <span class="fb-stay__name">Sol y Mar surf camp</span>
  // <span class="fb-stay__km">4 km</span> <span class="fb-stay__meta">Hostel</span>
  const name = root.querySelectorAll('.fb-stay__name').find(x => /^sol y mar\b/i.test(txt(x)));
  if (name) {
    const tile = name.closest('.fb-stay') ?? name.parentNode;
    const km = tile?.querySelector('.fb-stay__km') ? txt(tile.querySelector('.fb-stay__km')!) : '';
    return { distance: km ? `${km} to Flag Beach` : null, blurb: tile?.querySelector('.fb-stay__meta') ? txt(tile.querySelector('.fb-stay__meta')!) : '' };
  }
  // older layout: <h3>Sol y Mar</h3><p>4km to Flag Beach</p><p>blurb</p>
  const h = root.querySelectorAll('h2, h3').find(x => /^sol y mar$/i.test(txt(x)));
  if (!h) return null;
  const ps: string[] = [];
  for (let el = h.nextElementSibling; el && el.tagName === 'P' && ps.length < 3; el = el.nextElementSibling) ps.push(txt(el));
  const distance = ps.find(p => /km to Flag Beach/i.test(p)) ?? null;
  const blurb = ps.find(p => p !== distance && p.length > 40) ?? '';
  return { distance, blurb };
}

export interface SymFacts {
  paragraphs: string[];
  minNights: number | null;
  bedrooms: number | null;
  kitchens: number | null;
  bathrooms: number | null;
  roomTypes: string[];
  noBunkBeds: boolean;
  breakfast: boolean;
  facilities: string[];
  bookingUrl: string | null;
  imageUrls: string[];
}

export function parseSymFacts(contentHtml: string): SymFacts {
  const root = parse(contentHtml);
  const paragraphs = root.querySelectorAll('p').map(p => txt(p)).filter(t => t.length > 40);
  const all = collapse(root.text);
  const num = (re: RegExp): number | null => { const m = all.match(re); return m ? Number(m[1]) : null; };
  const types = all.match(/We have ([a-z, ]+?) rooms available/i)?.[1] ?? '';
  const h = root.querySelectorAll('h2, h3').find(x => /^facilities$/i.test(txt(x)));
  const ul = h?.nextElementSibling?.tagName === 'UL' ? h.nextElementSibling : h?.parentNode?.querySelector('ul');
  const seen = new Set<string>();
  const imageUrls: string[] = [];
  for (const img of root.querySelectorAll('.wp-block-getwid-images-slider img, figure img')) {
    const src = img.getAttribute('src') ?? img.getAttribute('data-src');
    if (!src) continue;
    const u = symUnPhoton(src);
    if (!/\/wp-content\/uploads\//.test(u) || /logo|icon|\.svg/i.test(u) || seen.has(u)) continue;
    seen.add(u); imageUrls.push(u);
  }
  return {
    paragraphs,
    minNights: num(/minimum stay (?:of )?(\d+) nights?/i),
    bedrooms: num(/(\d+) bedrooms/i),
    kitchens: num(/(\d+) kitchens/i),
    bathrooms: num(/(\d+) bathrooms/i),
    roomTypes: types.split(/,|\bor\b/).map(s => s.trim()).filter(Boolean),
    noBunkBeds: /no bunk beds/i.test(all),
    breakfast: /continental breakfast is provided/i.test(all),
    facilities: ul ? ul.querySelectorAll('li').map(li => txt(li)).filter(Boolean) : [],
    bookingUrl: root.querySelector('a[href*="cloudbeds.com/reservation/"]')?.getAttribute('href') ?? null,
    imageUrls,
  };
}

/** The operator's kite packages (rows "name <sup>contents</sup> | €680") - for the optional services. */
export function parseSymKitePackages(html: string): Array<{ name: string; details: string; amount: number }> {
  const out: Array<{ name: string; details: string; amount: number }> = [];
  const root = parse(html);
  // card layout since Oct 2026: <a class="fb-card" data-filter="kitesurf"> title / facts ("7 nights · Beginner") / "From €735"
  for (const card of root.querySelectorAll('a.fb-card')) {
    const name = txt(card.querySelector('.fb-card__title'));
    const kite = /kite/i.test(card.getAttribute('data-filter') ?? '') || /kite/i.test(name);
    const amount = parseAmount(txt(card.querySelector('.fb-price')).replace(/^from\s*/i, ''));
    if (kite && name && amount) out.push({ name, details: txt(card.querySelector('.fb-card__facts')).replace(/\s*·\s*/g, ', '), amount });
  }
  if (out.length) return out;
  // older table layout
  for (const tr of root.querySelectorAll('table tr')) {
    const [cell, priceCell] = tr.querySelectorAll('td');
    if (!cell || !priceCell) continue;
    const details = txt(cell.querySelector('sup'));
    const name = collapse(cell.text.replace(details, '')) || txt(cell);
    const amount = parseAmount(txt(priceCell));
    if (amount && /kite/i.test(name)) out.push({ name, details, amount });
  }
  return out;
}

export interface SymPages { api: string; overview: string; kitePackages: string; detail?: string }

/** Detail page (since Oct 2026): hero photo, "Per night On request", booking by "Send us your dates" form. */
export function parseSymDetail(html: string): { heroImage: string | null; priceOnRequest: boolean; formBooking: boolean } {
  const root = parse(html);
  const hero = root.querySelector('.fb-hero img')?.getAttribute('src') ?? null;
  // the price + booking box is an <aside class="fb-panel"> (mainText drops asides, and node-html-parser closes <main>
  // early on these WP pages), so test the tag-stripped page text
  const text = collapse(html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' '));
  return {
    heroImage: hero ? hero.replace(/-\d{2,4}x\d{2,4}(?=\.(?:jpe?g|png|webp)$)/i, '') : null,
    priceOnRequest: /per night\s*on request/i.test(text),
    formBooking: /send us your dates/i.test(text),
  };
}

export function parseSolYMarContent(p: SymPages): OfferContent {
  const page = parseSymApi(p.api);
  const f = parseSymFacts(page.html);
  const card = parseSymCard(p.overview);
  if (!card) throw new Error('sol-y-mar: card no longer on /accommodation/');
  const kite = mainText(p.kitePackages);
  const packages = parseSymKitePackages(p.kitePackages);
  const km = card.distance?.match(/(\d+(?:[.,]\d+)?)\s*km/i)?.[1] ?? null;
  const detail = p.detail ? parseSymDetail(p.detail) : null;

  const rooms: ContentRoom[] = f.roomTypes.map(t => ({
    name: `${t.charAt(0).toUpperCase()}${t.slice(1)} room`,
    description: null,
    features: f.noBunkBeds ? ['No bunk beds'] : [],
  }));

  const summary = [
    `Sol y Mar is the original surf hostel of the Flag Beach Watersports Centre, in the old town of Corralejo, Fuerteventura${km ? `, ${km} km from Flag Beach` : ''}.`,
    `It has ${f.bedrooms ?? 10} bedrooms (${f.roomTypes.length ? f.roomTypes.join(', ') : 'single to quad'}${f.noBunkBeds ? ', no bunk beds' : ''}), ${f.kitchens ?? 2} kitchens, ${f.bathrooms ?? 4} bathrooms, a living room and a rooftop terrace with BBQ${f.breakfast ? '; continental breakfast is included' : ''}${f.minNights ? ` and the minimum stay is ${f.minNights} nights` : ''}.`,
    `Flag Beach teaches kitesurfing, windsurfing, surfing, wing foiling and SUP at Flag Beach and rents equipment; arrival days are flexible and ${detail?.formBooking ? 'rooms are requested by sending your dates through Flag Beach\'s form (confirmed by e-mail with a small deposit)' : 'rooms are booked through Flag Beach\'s booking page'}.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: page.title ? page.title.replace(/\bsurf camp\b/i, 'Surf Camp') : 'Sol y Mar Surf Camp',
    summary,
    continent: 'Europe',
    country: 'Spain',
    region: 'Canary Islands',
    spot: 'Corralejo, Fuerteventura',
    itinerarySpots: [],
    durationDays: null,
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: /kitesurfing course|beginner course|kite(?:surfing)? lessons?/i.test(kite),
    // since Oct 2026 rental is its own page in the kite menu ("Courses / Packages / Rental"), not text on this page
    equipmentRental: /equipment rentals?/i.test(kite) || /href="[^"]*\/rental[^"]*"/i.test(p.kitePackages),
    beginnerFriendly: /beginner/i.test(kite),
    includedServices: f.facilities,
    optionalServices: [
      'Kitesurf, windsurf, surf, wing foil and SUP courses (Flag Beach Watersports Centre, 4 km away at Flag Beach)',
      'Kite equipment rental',
      ...packages.slice(0, 4).map(x => `Flag Beach kite package: ${x.name}${x.details ? ` (${x.details})` : ''}, €${x.amount}`),
      'Bike hire at a local shop',
    ],
    accommodation: 'surf hostel with single, twin, double, triple and quad rooms (no bunk beds)',
    mealPlan: f.breakfast ? 'breakfast' : null,
    languages: [],
    rooms,
    imageUrls: (f.imageUrls.length ? f.imageUrls : detail?.heroImage ? [detail.heroImage] : []).slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: p.detail ? SYM_DETAIL_URL : SYM_OVERVIEW_URL,
    bookingUrl: f.bookingUrl ?? SYM_DETAIL_URL,
    sourceText: [
      `wp stay ${page.id} "${page.title}" modified ${page.modified}`,
      `detail page: ${detail ? `price per night ${detail.priceOnRequest ? 'on request' : 'shown'}, booking ${detail.formBooking ? 'by form' : 'other'}` : 'not read'}`,
      `overview card: ${card.distance ?? '?'} | ${card.blurb}`,
      `description: ${f.paragraphs.join(' ')}`,
      `facilities: ${f.facilities.join(' | ')}`,
      `kite packages (operator): ${packages.map(x => `${x.name} (${x.details}) ${x.amount}`).join(' | ')}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const solYMarSurfCampCorralejo: OfferAdapter = {
  key: 'sol-y-mar-surf-camp-corralejo',
  name: 'Sol y Mar Surf Camp Corralejo (Flag Beach)',
  kind: 'accommodation',
  disciplines: ['kitesurf', 'wingfoil'],
  operator: {
    name: 'Flag Beach Watersports Centre',
    websiteUrl: SITE,
    rootDomain: 'flagbeach.com',
  },
  url: SYM_OVERVIEW_URL,
  slotMethod: 'price_table',
  instantBooking: false, // since Oct 2026: "Send us your dates" form, confirmed by e-mail with a deposit (Cloudbeds gone)
  fetchBudget: 5,
  confidence: 'low',
  async fetchContent() {
    const [api, overview, kitePackages, detail] = [
      await get(SYM_API_URL, 'application/json'), await get(SYM_OVERVIEW_URL, 'text/html'), await get(SYM_KITE_PACKAGES_URL, 'text/html'),
      await get(SYM_DETAIL_URL, 'text/html'),
    ];
    return parseSolYMarContent({ api, overview, kitePackages, detail });
  },
  async fetchSlots(ctx) {
    // liveness guard: the house must still be on the operator's accommodation overview
    if (!parseSymCard(await get(SYM_OVERVIEW_URL, 'text/html'))) throw new Error('sol-y-mar: card no longer on /accommodation/ (house retired?)');
    ctx.note('no room prices on the own site ("Per night: On request"): offer stays "price on request"');
    return [];
  },
};
