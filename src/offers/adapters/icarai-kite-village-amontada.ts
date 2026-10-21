// ---------------------------------------------------------------------------
// Icarai Kite Village, Icaraí de Amontada (Icaraizinho, Ceará, Brazil) - pousada of cabins and houses in a coconut
// grove 250 m from Icaraizinho beach, with its own kite and wing foil school "Chill Kite & Wing" (instructor
// Clément: courses, rental, half-day trips, kite & wing stays with accommodation).
//
// Inclusion: Aaron's decision of 2026-10-12 ("moderate liveness", third Icaraí entry): content only, confidence
//   'low'. Kite link: own school (/en/kite-wing-school, phone "Kiteboarding School" in the footer). Newest sign
//   of life on the own site: the school page advertises "Recent equipment (2025–2026)". No dated season, price or
//   booking calendar on the site.
//
// Data path (checked 2026-10-12): www.icaraikitevillage.com (Wix, server-rendered text; French site with /en/
//   pages, the English pages are read):
//   content  /en (intro, school teaser, contacts), /en/icarai-kite-village (accommodation hub: facilities, the six
//            unit names under "Our accommodation options", location facts), /en/kite-wing-school (school facts).
//   slots    none: no page prints a price; "Book" opens a contact form / WhatsApp. fetchSlots re-reads the hub
//            (memoised) and returns [] (offer = "price on request"); it notes when a price shows up.
// robots.txt (2026-10-12): Wix default (only "*?lightbox=" disallowed for all agents).
// Requests per run: content 3, slots 1 (0 extra when content ran in the same process). Pages are 0.8-0.9 MB
//   each (Wix); fixtures are trimmed to markup.
// Known limits: unit details live on six sub-pages (~1 MB each, not read: names only); the home text says "four
//   cabins and houses" while the hub lists six options. No business location in the Wix site data -> no
//   spotCoords. The linked school website kitesurficarai.com is not read.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, collapse, imageCandidates } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.icaraikitevillage.com';
export const IKV_HOME_URL = `${SITE}/en`;
export const IKV_HUB_URL = `${SITE}/en/icarai-kite-village`;
export const IKV_SCHOOL_URL = `${SITE}/en/kite-wing-school`;
const CONTACT_URL = `${SITE}/en/contact`;

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

/** Visible text lines of a Wix page between the menu and the footer address. */
export function ikvLines(html: string): string[] {
  const body = html.replace(/<!--[\s\S]*?-->|<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<svg[\s\S]*?<\/svg>/gi, '');
  const lines = body.split(/<[^>]+>/).map(s => clean(s).replace(/​/g, '').trim()).filter(Boolean);
  const a = lines.findIndex(l => /^Use tab to navigate/i.test(l));
  const b = lines.findIndex((l, i) => i > a && /^José Alameda/i.test(l));
  return lines.slice(a + 1, b > a ? b : undefined).filter(l => !/^(Book|Discover|Up)$/i.test(l));
}
const ikvText = (html: string): string => collapse(ikvLines(html).join(' ')).replace(/\s+([,.;:!?])/g, '$1');
const titleCase = (s: string): string => s.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_, sp: string, c: string) => sp + c.toUpperCase());

// --- pure parsers -----------------------------------------------------------------------------
/** Hub: unit names between "Our accommodation options" and the next section heading. */
export function parseIkvUnits(hubHtml: string): string[] {
  const body = hubHtml.replace(/<!--[\s\S]*?-->|<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<svg[\s\S]*?<\/svg>/gi, '');
  const lines = body.split(/<[^>]+>/).map(s => clean(s).replace(/​/g, '').trim()).filter(Boolean);
  const a = lines.findIndex(l => /^Our accommodation options$/i.test(l));
  if (a < 0) return [];
  const out: string[] = [];
  for (const l of lines.slice(a + 1)) {
    if (/^Discover$/i.test(l)) continue;
    if (l.length > 30 || /:$/.test(l)) break;
    const name = titleCase(l);
    if (!out.includes(name)) out.push(name);
  }
  return out;
}

/** Visible amounts with a currency sign (the pages print none today). */
export function ikvVisiblePrices(html: string): string[] {
  return [...ikvText(html).matchAll(/(?:R\$|€|US\$)\s?\d[\d.,]*|\d[\d.,]*\s?(?:€|reais)/g)].map(m => m[0]);
}

/** Wix originals (transform path dropped), PNG/SVG graphics and duplicates removed. */
export function ikvImages(pages: Array<[string, string]>, max = 30): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const [html, base] of pages) {
    for (const u of imageCandidates(html, base, null, 80)) {
      const d = decodeURIComponent(u);
      const id = d.match(/static\.wixstatic\.com\/media\/([^/~.]+)/)?.[1];
      if (!id || seen.has(id) || /~mv2\.(?:png|svg|gif)/i.test(d) || /\/11062b_/.test(d) || /logo|icon/i.test(d)) continue;
      seen.add(id);
      out.push(d.replace(/(\/media\/[^/]+)\/v1\/.*$/, '$1'));
    }
  }
  return out.slice(0, max);
}

export interface IkvPages { home: string; hub: string; school: string }

export function parseIcaraiKiteVillageContent(p: IkvPages): OfferContent {
  const home = ikvText(p.home);
  const hub = ikvText(p.hub);
  const school = ikvText(p.school);
  const units = parseIkvUnits(p.hub);
  const beach = hub.match(/just (\d+) meters from the fine sandy beaches/i)?.[1] ?? home.match(/\((\d+) m from the beach\)/)?.[1] ?? null;
  const fortaleza = hub.match(/Approximately (\d+) km \((\d+) hours?\) from Fortaleza/i);
  const schoolName = /Chill Kite & Wing/i.test(`${home} ${school}`) ? 'Chill Kite & Wing' : null;
  const gear = school.match(/Recent equipment \((\d{4})[–-](\d{4})\)/);
  const buggy = /Buggy transport included/i.test(school);
  const vhf = /VHF radio communication/i.test(school);

  const rooms: ContentRoom[] = units.map(name => ({ name, description: null, features: [] }));

  const summary = [
    `Icarai Kite Village is a pousada of cabins and houses in a coconut grove in Icaraizinho (Icaraí de Amontada, Ceará, Brazil)${beach ? `, ${beach} m from the beach` : ''}${fortaleza ? ` and about ${fortaleza[1]} km (${fortaleza[2]} hours) from Fortaleza airport` : ''}, with its own kitesurf and wing foil school${schoolName ? `, ${schoolName}` : ''}.`,
    `The units${units.length ? ` (${units.join(', ')})` : ''} include air-conditioned rooms, suites and bungalows with private bathroom, free Wi-Fi and covered terraces, some with a flat-screen TV; breakfast is optional, and airport transfers, excursions and kite and wing stays are arranged.`,
    `The school gives introductory and advanced courses${vhf ? ' with VHF radio coaching in the water' : ''}, rents equipment${gear ? ` (${gear[1]}-${gear[2]} gear)` : ''} and runs half-day trips such as the Patos lagoon${buggy ? '; buggy transport to the spot, 10 minutes along the beach, is included' : ''}.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Icarai Kite Village',
    summary,
    continent: 'South America',
    country: 'Brazil',
    region: 'Icaraí de Amontada, Ceará',
    spot: 'Icaraí de Amontada',
    spotCoords: null, // no business location in the Wix site data
    itinerarySpots: [],
    durationDays: null,
    // school page: "introductory and advanced courses"
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: /introductory and advanced courses|kitesurfing lessons/i.test(school),
    equipmentRental: /equipment rental/i.test(school),
    beginnerFriendly: /introductory/i.test(school) ? true : null,
    includedServices: ['Free Wi-Fi', 'Private bathroom', 'Covered terrace with garden furniture'],
    optionalServices: [
      'Breakfast (optional)',
      `Kitesurf and wing foil courses${schoolName ? ` (${schoolName} school)` : ''}`,
      'Equipment rental',
      'Half-day trip to the Patos lagoon',
      'Kite & wing camp stays with accommodation',
      'Airport transfers',
      'Excursions (buggy, hiking, biking)',
    ],
    accommodation: 'cabins and houses in a coconut grove',
    mealPlan: 'breakfast optional',
    languages: ['fr', 'en'], // site languages (French default, English pages)
    rooms,
    imageUrls: ikvImages([[p.hub, IKV_HUB_URL], [p.home, IKV_HOME_URL], [p.school, IKV_SCHOOL_URL]]),
    heroVideoUrl: null,
    sourceUrl: IKV_HUB_URL,
    bookingUrl: CONTACT_URL,
    sourceText: [
      `home: ${home}`,
      `kite village: ${hub}`,
      `kite & wing school: ${school}`,
      `units: ${units.join(', ')}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const icaraiKiteVillageAmontada: OfferAdapter = {
  key: 'icarai-kite-village-amontada',
  name: 'Icarai Kite Village Icaraí de Amontada',
  kind: 'accommodation',
  disciplines: ['kitesurf', 'wingfoil'],
  operator: {
    name: 'Icarai Kite Village',
    websiteUrl: SITE,
    rootDomain: 'icaraikitevillage.com',
    contactEmail: 'infokitevillage@gmail.com',
    phone: '+5588981366465',
  },
  url: IKV_HUB_URL,
  slotMethod: 'price_table',
  fetchBudget: 4,
  confidence: 'low', // Aaron 2026-10-12: moderate liveness, content only, no prices on the site
  async fetchContent() {
    const [home, hub, school] = [await page(IKV_HOME_URL), await page(IKV_HUB_URL), await page(IKV_SCHOOL_URL)];
    return parseIcaraiKiteVillageContent({ home, hub, school });
  },
  async fetchSlots(ctx): Promise<Slot[]> {
    const html = await page(IKV_HUB_URL);
    if (parseIkvUnits(html).length === 0) throw new Error('icarai-kite-village: accommodation options missing on /en/icarai-kite-village (layout changed?)');
    const prices = ikvVisiblePrices(html);
    if (prices.length) ctx.note(`prices appeared on /en/icarai-kite-village (${prices.slice(0, 5).join(', ')}): extend the adapter`);
    return [];
  },
};
