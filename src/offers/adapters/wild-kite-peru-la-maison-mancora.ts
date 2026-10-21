// ---------------------------------------------------------------------------
// La Maison by Wild Kite Peru, Mancora (Piura, Peru) - the 7-room eco guest house of the Wild Kite Peru
// kite school (IKO, teaching since 2009), a 5-minute walk from the main kite and surf spot.
//
// Data path (checked 2026-10-12): WordPress/Divi site, English pages.
//   slots    /best-place-to-stay-in-mancora/ - section #ourHotelClub ("Option #1: Stay with us"), Divi code
//            module .new-lodging-prices: one .price-for-person-col per occupancy ("1 person:" / "2 persons:" /
//            "Family:" + "Triple") with a p.price range ("From USD 25 to USD 90", "From USD 50 to 90",
//            "USD 55 or USD 110"). No dates, no year, no inventory; booking = Typeform inquiry -> 'on_request'.
//            The same page lists third-party places (a 4-star hotel, posadas, house rentals) the school books
//            for guests: those sections (#fiveStarsHotel, #guestHouse, #rentAHouse) are NOT read.
//   content  the same section (description, highlights, features, slide photos from the Divi CSS rules)
//            + the home page (school facts: IKO, since 2009, services, daily routine).
// robots.txt (2026-10-12): Yoast default, nothing disallowed.
// Requests per run: content 2, slots 1 (the lodging page is memoised for 10 min, so a full run makes 2).
// Parsed: slot = La Maison room x occupancy (1/2/3 persons), the LOWEST price of each printed range, USD,
//   per room and night (the La Maison block does not print "per night"; the posada block on the same page
//   does - read as nightly, inferred), availability 'on_request'.
// Known limits: the prices carry no year (the page's sitemap lastmod is 2024-02-29; the wave camp page,
//   edited 2026-10-08, still names La Maison as the school's base) -> confidence 'medium'. No map embed or
//   geo data on the site -> no spotCoords.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, detectCurrency, imageCandidates, parse, type HTMLElement } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://wild-kitesurf-peru.com';
export const WKP_LODGING_URL = `${SITE}/best-place-to-stay-in-mancora/`;
export const WKP_HOME_URL = `${SITE}/`;
export const WKP_UNIT = 'La Maison room';

export interface WkpRate { label: string; occupancy: number; min: number; max: number | null; currency: string; raw: string }

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

/** The "Option #1: Stay with us" section (La Maison), cut off before the next lodging option. */
export function laMaisonSection(html: string): string | null {
  const start = html.indexOf('id="ourHotelClub"');
  if (start < 0) return null;
  const next = html.slice(start + 20).search(/id="(?:fiveStarsHotel|guestHouse|rentAHouse)"/);
  return html.slice(start, next < 0 ? undefined : start + 20 + next);
}

// --- pure parsers -----------------------------------------------------------------------------
/** Price columns of La Maison: occupancy from the label ("1 person", "2 persons", "Family" + "Triple"). */
export function parseWkpRates(html: string): WkpRate[] {
  const sec = laMaisonSection(html);
  if (!sec) return [];
  const out: WkpRate[] = [];
  for (const col of parse(sec).querySelectorAll('.price-for-person-col')) {
    const ps = col.querySelectorAll('p');
    const label = txt(ps[0]).replace(/:$/, '');
    const sub = txt(col.querySelector('span'));
    const priceEl = col.querySelector('p.price') ?? ps[ps.length - 1];
    const raw = txt(priceEl);
    const occ = Number(label.match(/^(\d)\s*persons?/i)?.[1] ?? sub.match(/^(\d)\s*persons?/i)?.[1] ?? NaN);
    const occupancy = Number.isFinite(occ) ? occ : /triple/i.test(sub) ? 3 : /double/i.test(sub) ? 2 : /single/i.test(sub) ? 1 : NaN;
    const nums = [...raw.matchAll(/\d[\d.,]*/g)].map(m => Number(m[0].replace(/,/g, ''))).filter(n => Number.isFinite(n) && n > 0);
    const currency = detectCurrency(raw);
    if (!Number.isFinite(occupancy) || nums.length === 0 || !currency) continue;
    out.push({ label: /triple|double|single|twin/i.test(sub) && !label.toLowerCase().includes(sub.toLowerCase()) ? `${label} (${sub})` : label, occupancy, min: Math.min(...nums), max: nums.length > 1 ? Math.max(...nums) : null, currency, raw });
  }
  return out;
}

/** One slot per occupancy at the lowest printed price; no dates (the table has none). */
export function buildWkpSlots(rates: WkpRate[]): Slot[] {
  return rates.map(r => ({
    key: `la-maison-${r.occupancy}p`,
    startDate: null,
    endDate: null,
    unit: WKP_UNIT,
    price: r.min,
    currency: r.currency,
    priceUnit: 'per_night',
    priceBasis: 'room',
    occupancy: r.occupancy,
    availability: 'on_request',
    availabilityText: null,
    spotsLeft: null,
  }));
}

/** Description paragraphs, the highlight/feature list items, the inquiry link and the slide photos of La Maison. */
export function parseLaMaison(html: string, baseUrl = WKP_LODGING_URL): { paragraphs: string[]; features: string[]; inquiryUrl: string | null; images: string[] } {
  const sec = laMaisonSection(html) ?? '';
  const root = parse(sec);
  for (const el of root.querySelectorAll('script, style, .new-lodging-prices')) el.remove();
  const paragraphs = root.querySelectorAll('.et_pb_tab_content p, .et_pb_text_inner p').map(p => txt(p)).filter(t => t.length > 60);
  // Divi tabs: controls DESCRIPTION / HIGHLIGHTS / FEATURES; the facility list is the FEATURES tab
  const controls = root.querySelectorAll('.et_pb_tabs_controls li').map(li => txt(li).toUpperCase());
  const tabs = root.querySelectorAll('.et_pb_all_tabs .et_pb_tab');
  const featureTab = tabs[controls.indexOf('FEATURES')] ?? null;
  const features = (featureTab ?? root).querySelectorAll('li').map(li => txt(li))
    .filter(t => t && t.length < 120 && !/^(DESCRIPTION|HIGHLIGHTS|FEATURES)$/.test(t));
  const inquiryUrl = sec.match(/href="(https:\/\/[^"]*typeform\.com\/[^"]+)"/)?.[1] ?? null;
  // slides keep their photos in Divi CSS rules (.et_pb_slide_N { background-image:url(...) }), plus <img> tags
  const images: string[] = [];
  for (const id of sec.matchAll(/data-slide-id="(et_pb_slide_\d+)"/g)) {
    const m = html.match(new RegExp(`\\.${id[1]}(?![\\d])[^{}]*\\{[^}]*background-image:\\s*url\\(["']?([^"')]+)`));
    if (m) images.push(new URL(m[1], baseUrl).toString());
  }
  for (const m of sec.matchAll(/background-image:\s*url\(["']?(https?:\/\/[^"')]+)/gi)) images.push(m[1]);
  for (const m of sec.matchAll(/<img[^>]+(?:data-src|src)="(https?:\/\/[^"]+\.(?:jpe?g|webp))"/gi)) images.push(m[1]);
  return { paragraphs, features: [...new Set(features)], inquiryUrl, images: [...new Set(images)] };
}

function pageText(html: string): string {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, header, footer, nav, svg')) el.remove();
  return collapse((root.querySelector('#main-content') ?? root.querySelector('body') ?? root).text);
}

export interface WkpPages { lodging: string; home: string }

export function parseWildKitePeruContent(p: WkpPages): OfferContent {
  const home = pageText(p.home);
  const lm = parseLaMaison(p.lodging);
  const rates = parseWkpRates(p.lodging);
  const desc = lm.paragraphs.join(' ');
  const nRooms = desc.match(/(\d+)-room guest house/)?.[1] ?? null;
  const walk = desc.match(/(\d+)-minute walk from the primary kite-and-surf spot/)?.[1] ?? null;
  const since = home.match(/kitesurf since (\d{4})/i)?.[1] ?? null;
  const iko = /IKO certified/i.test(home);
  const cheapest = rates.length ? Math.min(...rates.map(r => r.min)) : null;

  const rooms: ContentRoom[] = [{
    name: WKP_UNIT,
    description: `${nRooms ?? 'Seven'} rooms, each one different (several with a private balcony), in the eco guest house next to the palm grove of Máncora.`,
    features: [
      ...lm.features.filter(f => !/^(swimming pool|private beach)$/i.test(f)),
      ...rates.map(r => `${r.label}: ${r.raw}`),
    ],
  }];

  const imgs: string[] = [];
  const seen = new Set<string>();
  for (const u of [...lm.images, ...imageCandidates(p.home, WKP_HOME_URL, null, 60)]) {
    if (!/\.(?:jpe?g|webp)(?:$|\?)/i.test(u) || /logo|picto|capture|screenshot|featuredin|admin-ajax|icon/i.test(u)) continue;
    const k = u.replace(/^https?:\/\/(?:i\d\.wp\.com\/)?/, '').replace(/-(?:med|small|large|mini|\d+x\d+)(?=\.[a-z]+$)/i, '');
    if (seen.has(k)) continue;
    seen.add(k); imgs.push(u);
  }

  const summary = [
    `La Maison is the eco guest house of the Wild Kite Peru kite school in Máncora on the north coast of Peru: ${nRooms ?? 'seven'} rooms next to a palm grove, a ${walk ?? '5'}-minute walk from the main kite and surf spot.`,
    'Breakfast, daily cleaning and Wi-Fi are included, and the house has a swimming pool, a terrace and a family dining area.',
    `Wild Kite Peru${iko ? ' is an IKO-certified school' : ''}${since ? ` teaching kitesurfing since ${since}` : ''} with kite and wing lessons, wave kite surfaris along the north shore, surf, stand-up paddle and gear rental.`,
    cheapest !== null ? `Rooms cost from USD ${cheapest} per night for one person; stays are booked by inquiry.` : 'Stays are booked by inquiry.',
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'La Maison by Wild Kite Peru',
    summary,
    continent: 'South America',
    country: 'Peru',
    region: 'Piura',
    spot: 'Máncora',
    itinerarySpots: [],
    durationDays: null,
    // home: "Learn Kiteboarding in Peru" (IKO initiation) + "WAVE KITE CAMPS Take your Wave Kitesurfing to the next Level" (2026-10-12)
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: /kite lessons|learn kiteboarding/i.test(home),
    equipmentRental: /gear rental/i.test(home),
    beginnerFriendly: /learn kiteboarding|initiation/i.test(home),
    includedServices: ['Breakfast', 'Daily cleaning', 'Wi-Fi', 'Drinking water and tea'],
    optionalServices: ['Kite and wing lessons (IKO)', 'Wave kite surfaris and downwinders', 'Surf lessons', 'Stand-up paddle', 'Kite gear rental', 'Yoga'],
    accommodation: 'eco guest house rooms',
    mealPlan: 'breakfast',
    languages: ['en', 'fr', 'es', 'de'],
    rooms,
    imageUrls: imgs.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: WKP_LODGING_URL,
    bookingUrl: lm.inquiryUrl ?? WKP_LODGING_URL,
    sourceText: [
      `la maison: ${desc}`,
      `features: ${lm.features.join(' | ')}`,
      `prices: ${rates.map(r => `${r.label} = ${r.raw}`).join('; ')}`,
      `home: ${home}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const wildKitePeruLaMaisonMancora: OfferAdapter = {
  key: 'wild-kite-peru-la-maison-mancora',
  name: 'La Maison by Wild Kite Peru, Mancora',
  kind: 'accommodation',
  disciplines: ['kitesurf', 'wingfoil'],
  operator: {
    name: 'Wild Kite Peru',
    websiteUrl: SITE,
    rootDomain: 'wild-kitesurf-peru.com',
    contactEmail: 'aloha@wildkiteperu.com',
    whatsapp: '+51941324784',
  },
  url: WKP_LODGING_URL,
  slotMethod: 'price_table',
  fetchBudget: 3,
  confidence: 'medium',
  async fetchContent() {
    const lodging = await page(WKP_LODGING_URL);
    const home = await page(WKP_HOME_URL);
    return parseWildKitePeruContent({ lodging, home });
  },
  async fetchSlots() {
    const rates = parseWkpRates(await page(WKP_LODGING_URL));
    if (rates.length === 0) throw new Error('wild-kite-peru: La Maison price block (#ourHotelClub .price-for-person-col) not found or changed');
    return buildWkpSlots(rates);
  },
};
