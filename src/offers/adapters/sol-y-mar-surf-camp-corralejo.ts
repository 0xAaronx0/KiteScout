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
// Data path (checked 2026-10-12), WordPress block theme:
//   content  GET /wp-json/wp/v2/pages/623?_fields=id,link,modified,title,content  (the site's public WP REST
//            API; page 623 "Sol y Mar surf camp", status publish, modified 2026-04-17): description, minimum
//            stay, facilities list, slider photos (Jetpack i0.wp.com CDN, unwrapped to the originals).
//            The front-end URL /accommodation/sol-y-mar/ now redirects to /accommodation/ (also for browsers),
//            and the site menu no longer lists Sol y Mar - see "Known limits".
//          + /accommodation/ (the Sol y Mar card: "4km to Flag Beach" + blurb; also the liveness guard)
//          + /kite-surfing/kite-surfing-packages/ (the operator's kite school and packages).
//   slots    none: no prices on the own site (Surfer's Retreat has a price table, Sol y Mar has none).
// Booking engine: Cloudbeds (hotels.cloudbeds.com/reservation/RGVfxl). Not used: Cloudbeds answers its
//   /booking/* data calls with HTTP 403 to non-browser clients -> "price on request".
// robots.txt (2026-10-12): only /wp-admin/ disallowed.
// Requests per run: content 3, slots 1 (the /accommodation/ guard; memoised with content).
// Known limits / liveness: the overview card is live (page modified 2026-05-08 per the WP sitemap) and the
//   detail page is published (modified 2026-04-17) with a working Cloudbeds link, but the detail URL
//   redirects and the menu dropped the house - Flag Beach may be phasing it out. fetchSlots throws when
//   the card disappears from /accommodation/. Which hostel the kite packages' "surf hostel stay" means is
//   not stated (Sol y Mar is called "the Flag Beach surf hostel", Surfer's Retreat "Flag Beach's new hostel").
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, parse, parseAmount, type HTMLElement } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent } from '../types.js';

const SITE = 'https://www.flagbeach.com';
export const SYM_API_URL = `${SITE}/wp-json/wp/v2/pages/623?_fields=id,link,modified,title,content`;
export const SYM_OVERVIEW_URL = `${SITE}/accommodation/`;
export const SYM_KITE_PACKAGES_URL = `${SITE}/kite-surfing/kite-surfing-packages/`;
const FALLBACK_BOOKING_URL = 'https://hotels.cloudbeds.com/reservation/RGVfxl';

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
  if (!o.content?.rendered) throw new Error('sol-y-mar: WP page 623 has no rendered content');
  return { id: o.id ?? 0, modified: o.modified ?? '', title: collapse(parse(`<p>${o.title?.rendered ?? ''}</p>`).text), html: o.content.rendered };
}

/** The Sol y Mar card on /accommodation/: distance line + blurb; null when the card is gone. */
export function parseSymCard(overviewHtml: string): { distance: string | null; blurb: string } | null {
  const h = parse(overviewHtml).querySelectorAll('h2, h3').find(x => /^sol y mar$/i.test(txt(x)));
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
  for (const tr of parse(html).querySelectorAll('table tr')) {
    const [cell, priceCell] = tr.querySelectorAll('td');
    if (!cell || !priceCell) continue;
    const details = txt(cell.querySelector('sup'));
    const name = collapse(cell.text.replace(details, '')) || txt(cell);
    const amount = parseAmount(txt(priceCell));
    if (amount && /kite/i.test(name)) out.push({ name, details, amount });
  }
  return out;
}

export interface SymPages { api: string; overview: string; kitePackages: string }

export function parseSolYMarContent(p: SymPages): OfferContent {
  const page = parseSymApi(p.api);
  const f = parseSymFacts(page.html);
  const card = parseSymCard(p.overview);
  if (!card) throw new Error('sol-y-mar: card no longer on /accommodation/');
  const kite = mainText(p.kitePackages);
  const packages = parseSymKitePackages(p.kitePackages);
  const km = card.distance?.match(/(\d+(?:[.,]\d+)?)\s*km/i)?.[1] ?? null;

  const rooms: ContentRoom[] = f.roomTypes.map(t => ({
    name: `${t.charAt(0).toUpperCase()}${t.slice(1)} room`,
    description: null,
    features: f.noBunkBeds ? ['No bunk beds'] : [],
  }));

  const summary = [
    `Sol y Mar is the original surf hostel of the Flag Beach Watersports Centre, in the old town of Corralejo, Fuerteventura${km ? `, ${km} km from Flag Beach` : ''}.`,
    `It has ${f.bedrooms ?? 10} bedrooms (${f.roomTypes.length ? f.roomTypes.join(', ') : 'single to quad'}${f.noBunkBeds ? ', no bunk beds' : ''}), ${f.kitchens ?? 2} kitchens, ${f.bathrooms ?? 4} bathrooms, a living room and a rooftop terrace with BBQ${f.breakfast ? '; continental breakfast is included' : ''}${f.minNights ? ` and the minimum stay is ${f.minNights} nights` : ''}.`,
    `Flag Beach teaches kitesurfing, windsurfing, surfing, wing foiling and SUP at Flag Beach and rents equipment; arrival days are flexible and rooms are booked through Flag Beach's online booking page.`,
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
    kiteLessons: /kitesurfing course/i.test(kite),
    equipmentRental: /equipment rentals?/i.test(kite),
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
    imageUrls: f.imageUrls.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: SYM_OVERVIEW_URL,
    bookingUrl: f.bookingUrl ?? FALLBACK_BOOKING_URL,
    sourceText: [
      `wp page ${page.id} "${page.title}" modified ${page.modified}`,
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
  operator: {
    name: 'Flag Beach Watersports Centre',
    websiteUrl: SITE,
    rootDomain: 'flagbeach.com',
  },
  url: SYM_OVERVIEW_URL,
  slotMethod: 'price_table',
  fetchBudget: 4,
  confidence: 'low',
  async fetchContent() {
    const [api, overview, kitePackages] = [
      await get(SYM_API_URL, 'application/json'), await get(SYM_OVERVIEW_URL, 'text/html'), await get(SYM_KITE_PACKAGES_URL, 'text/html'),
    ];
    return parseSolYMarContent({ api, overview, kitePackages });
  },
  async fetchSlots(ctx) {
    // liveness guard: the house must still be on the operator's accommodation overview
    if (!parseSymCard(await get(SYM_OVERVIEW_URL, 'text/html'))) throw new Error('sol-y-mar: card no longer on /accommodation/ (house retired?)');
    ctx.note('no room prices on the own site and Cloudbeds /booking/* answers 403: offer stays "price on request"');
    return [];
  },
};
