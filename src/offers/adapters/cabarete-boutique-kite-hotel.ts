// ---------------------------------------------------------------------------
// Cabarete Boutique Kite Hotel (Kite Buen Hombre), Cabarete (Puerto Plata, Dominican Republic) - the Cabarete
// base of the Kite Buen Hombre school: six boutique lofts, a Tropical House and a villa around a pool, yoga
// studio and gardens in downtown Cabarete; the school's Cabarete kite gear is stored here (gear storage and
// rinse stations), lessons run from whichever beach works best that day. Up to 25 guests.
// Same operator as kite-buen-hombre-eco-lodge (Playa Buen Hombre); this adapter is the Cabarete stay only.
//
// Data path (checked 2026-10-12): Wix site (server-rendered text + JSON-LD), one page:
//   /cabarete-boutique-kite-hotel - room cards between "CHOOSE YOUR SPACE" and "Every accommodation includes"
//   (<h3>For ...</h3><h3>Name</h3>, description <p>s, attribute <div>s, link /book?room=cab-...), price block
//   "YOUR loft $60– 150 / night Per lofts" and "Retreat Pricing $85 per person / night" (whole property),
//   JSON-LD LodgingBusiness (description, geo 19.74706/-70.40588, amenities, makesOffer 85 USD per night) and
//   the FAQPage. 2026 operation: the page is maintained in 2026 (photo "Image Aug 10, 2026", videos uploaded
//   2026-10-10/12, "©2026"), the operator's /book page offers stays 1 Nov - 15 Dec 2026 (Buen Hombre special)
//   but is 6.7 MB, above the fetch size cap, so it is not read.
// Booking: /book#book-cabarete (enquiry by form / WhatsApp, no inventory) -> 'on_request'.
// robots.txt (2026-10-12): Wix default (only "*?lightbox=" disallowed for all agents).
// Requests per run: content 1, slots 1 (memoised for 10 minutes, so a full run makes 1). The page is ~3.2 MB;
//   the fixture is trimmed to markup + JSON-LD.
// Parsed: 2 slots - "loft" = USD 60 per loft per night (lowest of the printed $60-150 range, the cards carry no
//   individual prices) and "whole-property" = USD 85 per person per night (retreat pricing, up to 25 guests).
// Known limits: no dates, no availability; the loft range is not broken down by loft.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, collapse, imageCandidates, ldOfType, parse, parseAmount, type HTMLElement } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.kitebuenhombre.com';
export const CBK_URL = `${SITE}/cabarete-boutique-kite-hotel`;
const BOOKING_URL = `${SITE}/book#book-cabarete`;
export const CBK_LOFT_UNIT = 'Boutique loft';
export const CBK_HOUSE_UNIT = 'Whole property (retreat, up to 25 guests)';

export interface CbkCard { audience: string; name: string; description: string | null; attributes: string[]; roomCode: string | null }
export interface CbkPrices { loftFrom: number | null; loftTo: number | null; retreatPp: number | null; currency: string }

// --- local helpers ----------------------------------------------------------------------------
const memo = new Map<string, { at: number; p: Promise<string> }>();
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}
/** Visible text lines of a Wix page (scripts, styles and inline SVG dropped; zero-width spaces removed). */
export function cbkLines(html: string): string[] {
  const body = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<svg[\s\S]*?<\/svg>/gi, '');
  return body.split(/<[^>]+>/).map(s => clean(s).replace(/​/g, '').trim()).filter(Boolean);
}
const dashes = (s: string): string => s.replace(/\s*[—–]\s*/g, ' - ');

// --- pure parsers -----------------------------------------------------------------------------
/** Room cards: "For <audience>" h3, name h3, description <p>s, attribute divs, /book?room=<code> link. */
export function parseCbkCards(html: string): CbkCard[] {
  const root = parse(html);
  const out: CbkCard[] = [];
  const h3s = root.querySelectorAll('h3');
  for (let i = 0; i + 1 < h3s.length; i++) {
    const audience = collapse(h3s[i].text);
    if (!/^For \w/.test(audience)) continue;
    const name = collapse(h3s[i + 1].text);
    // card container: the closest ancestor holding a /book?room= link
    let box: HTMLElement | null = h3s[i].parentNode as HTMLElement | null;
    while (box && !box.querySelector('a[href*="book?room="]')) box = box.parentNode as HTMLElement | null;
    if (!box || box.querySelectorAll('h3').length > 3) continue;
    const groups = box.querySelectorAll('div')
      .filter(d => d.childNodes.some(c => (c as HTMLElement).tagName === 'P') && d.childNodes.every(c => (c as HTMLElement).tagName === 'P' || !collapse(c.text)))
      .map(d => d.querySelectorAll('p').map(p => collapse(p.text)).filter(Boolean))
      .filter(g => g.length);
    const href = box.querySelector('a[href*="book?room="]')?.getAttribute('href') ?? '';
    out.push({
      audience: audience.replace(/^For /, ''),
      name,
      description: groups[0] ? dashes(groups[0].join(' ')) : null,
      attributes: groups.slice(1).map(g => g.join(' ').replace(/\s+/g, ' ')),
      roomCode: href.match(/room=([\w-]+)/)?.[1] ?? null,
    });
  }
  return out;
}

/** "$60– 150 / night Per lofts" and "Retreat Pricing $85 per person / night". */
export function parseCbkPrices(html: string): CbkPrices {
  const t = cbkLines(html).join(' ');
  const loft = t.match(/YOUR loft\s*\$\s?(\d[\d,.]*)\s*[–-]\s*\$?\s?(\d[\d,.]*)\s*\/\s*night\s*Per lofts?/i);
  const retreat = t.match(/Retreat Pricing\s*\$\s?(\d[\d,.]*)\s*per person\s*\/\s*night/i);
  return {
    loftFrom: loft ? parseAmount(loft[1]) : null,
    loftTo: loft ? parseAmount(loft[2]) : null,
    retreatPp: retreat ? parseAmount(retreat[1]) : null,
    currency: 'USD',
  };
}

export function buildCbkSlots(p: CbkPrices): Slot[] {
  const base = { startDate: null, endDate: null, currency: p.currency, priceUnit: 'per_night' as const, availability: 'on_request' as const, availabilityText: null, spotsLeft: null };
  const out: Slot[] = [];
  if (p.loftFrom) out.push({ ...base, key: 'loft', unit: CBK_LOFT_UNIT, price: p.loftFrom, priceBasis: 'room', occupancy: null });
  if (p.retreatPp) out.push({ ...base, key: 'whole-property', unit: CBK_HOUSE_UNIT, price: p.retreatPp, priceBasis: 'person', occupancy: null });
  return out;
}

export function parseCabareteBoutiqueContent(html: string): OfferContent {
  const lines = cbkLines(html);
  const text = lines.join(' ');
  const lodging = ldOfType(html, 'LodgingBusiness')[0] ?? {};
  const geo = (lodging.geo ?? {}) as Record<string, unknown>;
  const lat = Number(geo.latitude); const lng = Number(geo.longitude);
  const amenities = ((lodging.amenityFeature ?? []) as Array<Record<string, unknown>>).map(a => String(a.name ?? '')).filter(Boolean);
  const cards = parseCbkCards(html);
  const prices = parseCbkPrices(html);
  const faq = ((ldOfType(html, 'FAQPage')[0]?.mainEntity ?? []) as Array<Record<string, unknown>>)
    .map(q => ({ q: String(q.name ?? ''), a: String((q.acceptedAnswer as Record<string, unknown> | undefined)?.text ?? '') }));
  const ans = (re: RegExp) => faq.find(f => re.test(f.q))?.a ?? null;
  const incStart = lines.findIndex(l => /^Every accommodation includes:?$/i.test(l));
  const included = incStart >= 0 ? lines.slice(incStart + 1, incStart + 8).filter(l => !/^Check Rates/i.test(l)) : [];
  const incEnd = included.findIndex(l => /^Check Rates|^A DAY IN/i.test(l));
  const accIncludes = incEnd >= 0 ? included.slice(0, incEnd) : included;
  const since = text.match(/Since (\d{4})/)?.[1] ?? null;
  // "Small Terrace Loft" repeats the Tropical House text on the page (2026-10-12): a repeated text stays with
  // the first card only
  const seenDesc = new Set<string>();

  const rooms: ContentRoom[] = cards.map(c => ({
    name: c.name,
    description: c.description && !seenDesc.has(c.description) ? (seenDesc.add(c.description), c.description) : null,
    features: [`For ${c.audience.toLowerCase()}`, ...c.attributes],
  }));

  const logoIds = new Set([...html.matchAll(/"logo":\{[^}]*"url":"[^"]*\/media\/([^"/~.]+)/g)].map(m => m[1]));
  const seen = new Set<string>();
  const imageUrls: string[] = [];
  for (const u of imageCandidates(html, CBK_URL, null, 80)) {
    const id = u.match(/static\.wixstatic\.com\/media\/([^/~.]+)/)?.[1];
    if (!id || logoIds.has(id) || /logo|icon|\.svg|\.png/i.test(u) || seen.has(id)) continue;
    seen.add(id);
    imageUrls.push(u.replace(/(\/media\/[^/]+)\/v1\/.*$/, '$1'));
  }

  const walk = ans(/How far is the hotel from Kite Beach/i) ?? '';
  const walkMin = walk.match(/(\d+)-minute walk/)?.[1] ?? null;
  const moped = walk.match(/(\d+) minutes by moped/)?.[1] ?? null;
  const lofts = text.match(/(\w+) boutique lofts/i)?.[1]?.toLowerCase() ?? null;
  const summary = [
    `The Cabarete Boutique Kite Hotel is the Cabarete base of the Kite Buen Hombre kite school${since ? ` (since ${since})` : ''}: ${lofts ?? 'several'} boutique lofts, a Tropical House and a villa around a pool, a yoga studio and tropical gardens in downtown Cabarete, Dominican Republic, for up to 25 guests.`,
    `The school keeps its Cabarete kite gear here, with secure gear storage and rinse stations, and teaches from whichever beach works best that day${walkMin ? `; Kite Beach is about ${walkMin} minutes on foot${moped ? ` or ${moped} by moped` : ''}` : ''}.`,
    [
      prices.loftFrom ? `Lofts cost USD ${prices.loftFrom}${prices.loftTo ? `-${prices.loftTo}` : ''} per night` : null,
      prices.retreatPp ? `the whole property USD ${prices.retreatPp} per person per night for groups` : null,
    ].filter(Boolean).join(', and ') + (prices.loftFrom || prices.retreatPp ? '; every unit has a full kitchen, air conditioning and Starlink internet, and meals are not included (private chef on request).' : 'Every unit has a full kitchen, air conditioning and Starlink internet.'),
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Cabarete Boutique Kite Hotel (Kite Buen Hombre)',
    summary,
    continent: 'North America',
    country: 'Dominican Republic',
    region: 'Puerto Plata',
    spot: 'Cabarete',
    // JSON-LD LodgingBusiness.geo on the page
    ...(Number.isFinite(lat) && Number.isFinite(lng) && lat !== 0 ? { spotCoords: { lat, lng } } : {}),
    itinerarySpots: [],
    durationDays: null,
    skillLevels: ['beginner', 'intermediate', 'advanced'], // school: beginner lessons to advanced coaching (site menu)
    kiteLessons: /Certified lessons|kite lessons/i.test(text),
    equipmentRental: /rentals/i.test(text) ? true : null,
    beginnerFriendly: null,
    includedServices: [
      ...accIncludes,
      ...(/Secure gear storage and rinse stations/i.test(text) ? ['Secure kite gear storage and rinse stations'] : []),
      ...amenities.filter(a => /pool|yoga/i.test(a)),
    ],
    optionalServices: [
      'Kite and wing lessons, rentals and boat trips (Kite Buen Hombre)',
      'Private chef / BBQ',
      'Airport transfers',
      'Yoga instructors and massage',
      'Scooter rental',
    ],
    accommodation: 'boutique lofts, a tropical house and a villa around a pool',
    mealPlan: 'self_catering',
    languages: ['en', 'es'],
    rooms,
    imageUrls: imageUrls.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: CBK_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      `page: ${text}`,
      `lodging json-ld: ${String(lodging.description ?? '')}; geo ${lat},${lng}; amenities ${amenities.join(' | ')}`,
      `cards: ${cards.map(c => `${c.name} [${c.roomCode}] ${c.description ?? ''} {${c.attributes.join('; ')}}`).join(' | ')}`,
      `prices: loft ${prices.loftFrom}-${prices.loftTo} USD/night, retreat ${prices.retreatPp} USD pp/night`,
      `faq: ${faq.map(f => `${f.q} ${f.a}`).join(' | ')}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const cabareteBoutiqueKiteHotel: OfferAdapter = {
  key: 'cabarete-boutique-kite-hotel',
  name: 'Cabarete Boutique Kite Hotel (Kite Buen Hombre)',
  kind: 'accommodation',
  operator: {
    name: 'Kite Buen Hombre',
    websiteUrl: SITE,
    rootDomain: 'kitebuenhombre.com',
    contactEmail: 'kitebuen@gmail.com',
    whatsapp: '+18295212367',
    phone: '+18295212367',
  },
  url: CBK_URL,
  slotMethod: 'price_table',
  fetchBudget: 2,
  confidence: 'medium',
  async fetchContent() {
    return parseCabareteBoutiqueContent(await page(CBK_URL));
  },
  async fetchSlots() {
    const prices = parseCbkPrices(await page(CBK_URL));
    if (!prices.loftFrom && !prices.retreatPp) throw new Error('cabarete-boutique-kite-hotel: loft / retreat prices not found on the page');
    return buildCbkSlots(prices);
  },
};
