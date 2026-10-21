// ---------------------------------------------------------------------------
// Regenbogen Ferienanlage Ummanz, Suhrendorf (Ummanz, off the west coast of Rügen, Mecklenburg-Vorpommern, Germany) -
// holiday park of Regenbogen AG on the shallow Bodden ("großes Stehrevier ... perfekte Bedingungen für Kiter"); the
// UMMAII kite and surf school is on the site. Listed: the rental units only (Mietwohnwagen and Holli® holiday units),
// never the pitches.
//
// Data path (checked 2026-10-14), Neos site www.regenbogen.ag, one server-rendered page per park:
//   content  /ferienanlagen/ummanz.html: intro (Stehrevier, kiters), address + "Öffnungszeiten: 20. März 2026 bis
//            01. November 2026", tab panes ("Surf- und Kiteschule", "Mietwohnwagen", "Ferienunterkunft Holli",
//            "Ferienunterkunft Holli Boddenblick" + pitches/services we skip), offer cards (schema.org Offer markup,
//            "SPAR-ANGEBOT-MIETOBJEKT ... AB € 257,-"), "Auf Google Maps anzeigen" link with the park's coordinates
//            (maps.google.de/?q=54.4642...,13.1383... -> spotCoords).
//   slots    the page links the price list PDF "Ummanz_Preisliste-2026-1.pdf" (Stand November 2025): per category an
//            "ab" price for season A+B / C / D and the 2026 season dates (A+B 06.01.-12.05., 26.05.-01.07., 02.09.-26.12.;
//            C 13.05.-25.05.; D 02.07.-01.09., 27.12.26-03.01.27). We cannot parse a PDF through fetchText, so the
//            rental-unit rows are constants read by hand (2026-10-14). They are released only while the page still links
//            the same PDF path (/resources/persistent/<hash>/...); a new link -> [] + ctx.note for a manual re-read
//            (the Kenyaways pattern).
// Booking engine: SIHOT web client (buchen.regenbogen.ag/SIHOTWebRegenbogenAG/client/?HN=55). Its robots.txt is a 404
//   (allow), and POST /sessionServlet answers anonymously with a tab id, but POST /dataServlet (AVR availability, RRX
//   rates) answers 401 "session expired" with that X-Tab-Id alone: the engine keeps its session in a cookie, which we do
//   not carry (checked 2026-10-14, 2 requests). So there is no live price or availability (slots stay 'unknown').
// robots.txt www.regenbogen.ag (2026-10-14): only /neos/ disallowed.
// Requests per run: content 1, slots 1 (the same page, memoised for 10 minutes) -> 1.
// Parsed: slot = rental category x season band clipped to the park's opening (20.03.-31.10.2026 nights), EUR per unit
//   per night ("ab" price = cheapest night of that season; priceUnit 'per_night', priceBasis 'room'), availability
//   'unknown'; bands that ended before today are dropped. The PDF table does not print the unit: per night per unit is
//   INFERRED from the page's offer card (7 nights 15.10.-22.10.26 "ab € 257" = 5 x 51 + 2 x 1 EUR = the Mietwohnwagen
//   A+B price). After 01.11.2026 the 2026 list has no open band left -> [] (price on request) until the 2027 list.
// Known limits: "ab" prices only (daily prices live in SIHOT); final cleaning, electricity/gas and linen are extra (room
//   features). The pet-friendly variants are separate categories with the same prices.
// Shared: the Regenbogen helpers below (rgb*) are imported by regenbogen-born.ts (same site, same price list layout,
//   same SIHOT engine).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, collapse, parse, parseAmount, parseDate, todayIso } from '../parse.js';
import type { ContentRoom, FetchContext, OfferContent, OfferAdapter, Slot } from '../types.js';

// =============================================================================================
// Regenbogen AG (www.regenbogen.ag) - shared helpers
// =============================================================================================
export const RGB_SITE = 'https://www.regenbogen.ag';
export const RGB_OPERATOR = {
  name: 'Regenbogen AG',
  websiteUrl: RGB_SITE,
  rootDomain: 'regenbogen.ag',
  contactEmail: 'urlaub@regenbogen.ag', // printed as "urlaub (at) regenbogen.ag"
  phone: '+494312372370', // "Urlaubsberatung 0431 237 237 0"
};

export type RgbSeason = 'A+B' | 'C' | 'D';
export interface RgbUnitRow {
  name: string; persons: number | null; pets: boolean; prices: Record<RgbSeason, number>;
  /** the content room (tab pane name) this row prices, when the sheet names it differently ("Ferienhaus Holli®" -> pane "Ferienunterkunft Holli") */
  room?: string;
}
export interface RgbPriceSheet {
  /** path of the PDF the page links (the constants are valid for this file only) */
  href: string;
  year: number;
  /** printed season ranges, inclusive (the next range starts the day after) */
  seasons: Array<{ season: RgbSeason; start: string; end: string }>;
  /** park opening as printed on the sheet: first night .. closing (departure) day */
  opening: { start: string; end: string };
  /** rental-unit rows only, as printed ("ab" prices, EUR) */
  units: RgbUnitRow[];
  /** extra costs for rental units (sheet page 2, "Stand April 2026") */
  extras: string[];
}

/** Season dates 2026 printed on every Regenbogen 2026 price list (Ummanz and Born read 2026-10-14: identical). */
export const RGB_SEASONS_2026: RgbPriceSheet['seasons'] = [
  { season: 'A+B', start: '2026-01-06', end: '2026-05-12' },
  { season: 'C', start: '2026-05-13', end: '2026-05-25' },
  { season: 'A+B', start: '2026-05-26', end: '2026-07-01' },
  { season: 'D', start: '2026-07-02', end: '2026-09-01' },
  { season: 'A+B', start: '2026-09-02', end: '2026-12-26' },
  { season: 'D', start: '2026-12-27', end: '2027-01-03' },
];

/** "Mietobjekte-Zusatzleistungen" (page 2 of the 2026 sheets, Stand April 2026), the lines that apply to Holli / Mietwohnwagen. */
export const RGB_EXTRAS_2026 = [
  'Electricity EUR 0.63 per kWh; water / waste water EUR 9.10 / 9.90 per m³',
  'Bed linen EUR 17.90 per set, towels EUR 9.90 per set of 3',
  'Pets EUR 4 per night (pet-friendly units only)',
];

const addDays = (d: string, n: number): string => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
export const rgbKeyPart = (s: string): string => s.toLowerCase().replace(/®/g, '').replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const memo = new Map<string, { at: number; p: Promise<string> }>();
/** one fetch per page per 10 minutes: fetchContent + fetchSlots in the same run share the park page */
export function rgbPage(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

/** Visible text lines (scripts, styles dropped), split at block tags. */
export function rgbLines(html: string): string[] {
  return html
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .split(/<\/?(?:p|li|td|th|tr|h\d|div|br|ul|section|figure|table|span)\b[^>]*>/i)
    .map(s => clean(s.replace(/<[^>]+>/g, ' ')))
    .filter(Boolean);
}

/** "Öffnungszeiten: 20. März 2026 bis 01. November 2026" -> first night / closing day. */
export function rgbOpening(html: string): { start: string; end: string } | null {
  const t = rgbLines(html).join(' ');
  const m = t.match(/Öffnungszeiten:?\s*(\d{1,2}\.\s*[A-Za-zäÄ]+\s+20\d{2})\s*bis\s*(\d{1,2}\.\s*[A-Za-zäÄ]+\s+20\d{2})/);
  if (!m) return null;
  const start = parseDate(m[1]);
  const end = parseDate(m[2]);
  return start && end ? { start, end } : null;
}

/** Path of the linked price list PDF ("/resources/persistent/<hash>/Ummanz_Preisliste-2026-1.pdf"). */
export function rgbPriceListHref(html: string): string | null {
  return html.match(/href="(\/resources\/persistent\/[0-9a-f]+\/[^"]*Preisliste[^"]*\.pdf)"/i)?.[1] ?? null;
}

/** "Auf Google Maps anzeigen" link: maps.google.de/?q=<lat>,<lng>. */
export function rgbPin(html: string): { lat: number; lng: number } | null {
  const m = html.match(/maps\.google\.[a-z.]+\/\?q=(-?\d+\.\d+),\s*(-?\d+\.\d+)/);
  return m ? { lat: Math.round(Number(m[1]) * 1e5) / 1e5, lng: Math.round(Number(m[2]) * 1e5) / 1e5 } : null;
}

export interface RgbPane { name: string; text: string; html: string }
/** Tab panes of the park page (nav name -> pane), in page order. */
export function rgbPanes(html: string): RgbPane[] {
  const root = parse(html);
  const names = new Map<string, string>();
  for (const a of root.querySelectorAll('a[data-toggle="tab"]')) names.set((a.getAttribute('href') ?? '').replace(/^#/, ''), collapse(a.text));
  return root.querySelectorAll('.tab-pane').map(p => ({
    name: names.get(p.getAttribute('id') ?? '') ?? '',
    text: rgbLines(p.innerHTML).join('\n'),
    html: p.innerHTML,
  })).filter(p => p.name);
}

export const isRentalPane = (name: string): boolean => /mietwohnwagen|holli|mietobjekt|ferienhaus/i.test(name) && !/wunsch/i.test(name);
const isKitePane = (name: string): boolean => /kite|surfschule|surfangebote/i.test(name);

/** Images of the park: hero slider (1920 px) + the kite/surf and rental-unit panes (2560 px teaser, 1200 px popups). */
export function rgbImages(html: string): string[] {
  const out: string[] = [];
  const add = (u: string | null | undefined) => {
    if (!u) return;
    const abs = new URL(u.replace(/&amp;/g, '&'), RGB_SITE).toString();
    if (!/\/_img\//.test(abs) || /unsplash|logo/i.test(abs) || out.includes(abs)) return;
    out.push(abs);
  };
  for (const m of html.matchAll(/<img[^>]+itemprop="image"[^>]+src="([^"]+rs:fit:1920:[^"]+)"/g)) add(m[1]);
  for (const p of rgbPanes(html)) {
    if (!isRentalPane(p.name) && !isKitePane(p.name)) continue;
    for (const m of p.html.matchAll(/background-image:\s*url\(([^)]+)\)/g)) add(m[1].replace(/^['"]|['"]$/g, ''));
    for (const m of p.html.matchAll(/<a href="([^"]+)" class="popup"/g)) add(m[1]);
  }
  return out;
}

const DE_EN: Array<[RegExp, string]> = [
  [/voll ausgestattete(?:n)? Küche|Küchenzeile ist komplett ausgestattet|Pantryküche/i, 'Fully equipped kitchen'],
  [/Vorzelt/i, 'Awning with camping furniture'],
  [/Kühlschrank/i, 'Fridge'],
  [/Heizung/i, 'Heating'],
  [/Geschirrspüler/i, 'Dishwasher'],
  [/Mikrowelle/i, 'Microwave'],
  [/Duschbad|Badezimmer|eigene[mn]? Bad/i, 'Shower room'],
  [/separate[sm]? WC|extra WC/i, 'Separate toilet'],
  [/Terrasse/i, 'Terrace with furniture'],
  [/Parkplatz|PKW parkt/i, 'Parking at the unit'],
  [/Boddenblick|aufs Wasser schauen/i, 'View over the Bodden'],
  [/Bettzeug ist vorhanden/i, 'Bedding provided (linen and towels to rent)'],
];

/** Rental-unit panes -> rooms (English facts: size, persons, equipment). */
export function rgbRooms(html: string): ContentRoom[] {
  return rgbPanes(html).filter(p => isRentalPane(p.name)).map(p => {
    const persons = p.text.match(/(?:bis zu|für bis zu|Platz für bis zu)\s+(?:(\d+)|(vier|sechs))\s+Personen/i);
    const n = persons ? Number(persons[1] ?? (persons[2]?.toLowerCase() === 'vier' ? 4 : 6)) : null;
    const area = p.text.match(/(?:rund|knapp|auf)?\s*(\d+)\s*(?:qm|Quadratmetern)/i)?.[1] ?? null;
    const features = DE_EN.filter(([re]) => re.test(p.text)).map(([, en]) => en);
    const kind = /mietwohnwagen/i.test(p.name) ? 'Rental caravan' : 'Holli® holiday unit';
    return {
      name: p.name.replace(/\s+/g, ' ').trim(),
      description: `${kind}${area ? ` of about ${area} m²` : ''}${n ? ` for up to ${n} persons` : ''}.`,
      features,
    };
  });
}

export interface RgbOffer { name: string; example: string | null; text: string; price: number | null }
/** Offer cards for rental units ("SPAR-ANGEBOT-MIETOBJEKT", "MIETOBJEKT FRÜHBUCHER-ANGEBOT"). */
export function rgbRentalOffers(html: string): RgbOffer[] {
  const root = parse(html);
  return root.querySelectorAll('.offer-container').map(c => {
    const name = collapse(c.querySelector('h3')?.text ?? '');
    const sub = collapse(c.querySelector('.subtitle')?.text ?? '');
    const text = collapse(c.querySelector('.description')?.text ?? '');
    // schema.org UnitPriceSpecification: <span itemprop="price"><span>AB</span><small>€</small>257,-</span>
    const price = parseAmount(collapse(c.querySelector('[itemprop="price"]')?.text ?? '').replace(/^\D+/, '')) ?? null;
    return { name, example: sub.match(/(\d{2}\.\d{2}\.\d{2}\s*-\s*\d{2}\.\d{2}\.\d{2})/)?.[1] ?? null, text, price };
  }).filter(o => /MIETOBJEKT/i.test(o.name));
}

/** English line for an offer card (only what the card says). */
export function rgbOfferLine(o: RgbOffer): string {
  const what = /SPAR/i.test(o.name) && /6\.\s*und\s*7\.\s*Nacht/i.test(o.text)
    ? 'Off-season saver for rental units: stay 7 nights, pay EUR 1 each for the 6th and 7th night (also 14=12, 21=19)'
    : /FRÜHBUCHER/i.test(o.name) ? 'Early-booking discount for rental units in 2027 (deducted automatically)' : o.name;
  return `${what}${o.example ? ` - example ${o.example}` : ''}${o.price ? ` from EUR ${o.price}` : ''}`;
}

/**
 * Slots: rental row x season range, clipped to the park opening (nights first..closing-1). Bands that ended before today
 * are dropped; the key is the unit + the band start ("ferienhaus-holli|2026-09-02").
 */
export function buildRgbSlots(sheet: RgbPriceSheet, opening: { start: string; end: string }, today: string): Slot[] {
  const lastNight = addDays(opening.end, -1);
  const out: Slot[] = [];
  for (const s of sheet.seasons) {
    const start = s.start < opening.start ? opening.start : s.start;
    const end = s.end > lastNight ? lastNight : s.end;
    if (end < start || end < today) continue;
    for (const u of sheet.units) {
      out.push({
        key: `${rgbKeyPart(u.name)}|${start}`,
        startDate: start,
        endDate: end,
        unit: u.name,
        ...(u.room ? { room: u.room } : {}),
        price: u.prices[s.season],
        currency: 'EUR',
        priceUnit: 'per_night',
        priceBasis: 'room',
        occupancy: u.persons,
        availability: 'unknown',
        availabilityText: `season ${s.season} ${sheet.year}: "ab" price (cheapest night), daily prices in the online booking`,
        spotsLeft: null,
      });
    }
  }
  return out;
}

/** Slots from the page: the hand-read sheet is released only while the page links that very PDF. */
export function rgbSlotsFromPage(html: string, sheet: RgbPriceSheet, today: string, ctx?: Pick<FetchContext, 'note'>): Slot[] {
  const href = rgbPriceListHref(html);
  if (href !== sheet.href) {
    ctx?.note(`regenbogen: the page links ${href ?? 'no price list'} instead of ${sheet.href} - prices need a manual re-read (price on request until then)`);
    return [];
  }
  const opening = rgbOpening(html) ?? sheet.opening;
  const slots = buildRgbSlots(sheet, opening, today);
  if (slots.length === 0) ctx?.note(`regenbogen: no open season band left in the ${sheet.year} price list - price on request until the next list`);
  return slots;
}

/** Room features: the sheet's prices per unit row + the extra costs. */
export function rgbPriceFeatures(sheet: RgbPriceSheet, roomName: string): string[] {
  const base = (s: string) => rgbKeyPart(s).replace(/^ferienunterkunft-|^ferienhaus-/, '').replace(/-mit-haustiererlaubnis$/, '');
  const k = base(roomName);
  const rows = sheet.units.filter(u => base(u.name).startsWith(k) && (k !== 'holli' || !/boddenblick|boddennaehe|exklusiv/.test(base(u.name))));
  return rows.map(u => `${u.name}: ${sheet.year} from EUR ${u.prices['A+B']} (season A+B) / ${u.prices.C} (C) / ${u.prices.D} (D) per night`);
}

// =============================================================================================
// Regenbogen Ummanz
// =============================================================================================
export const RUM_URL = `${RGB_SITE}/ferienanlagen/ummanz.html`;
const RUM_BOOKING_URL = 'https://buchen.regenbogen.ag/SIHOTWebRegenbogenAG/client/?HN=55';

const ab = (a: number, c: number, d: number): Record<RgbSeason, number> => ({ 'A+B': a, C: c, D: d });
/** Tab pane names of the park page (= content room names, no ® on this page; checked against the 2026-10-14 fixture). */
export const RUM_ROOM_HOLLI = 'Ferienunterkunft Holli';
export const RUM_ROOM_BODDENBLICK = 'Ferienunterkunft Holli Boddenblick';
/** Ummanz_Preisliste-2026-1.pdf, page 1 "Camping & Mietobjekte", rental rows (read by hand 2026-10-14). */
export const RUM_SHEET: RgbPriceSheet = {
  href: '/resources/persistent/7dfbf8d60fc6a65793d4b106fa9e0e3fa9f1f24c/Ummanz_Preisliste-2026-1.pdf',
  year: 2026,
  seasons: RGB_SEASONS_2026,
  opening: { start: '2026-03-20', end: '2026-11-01' },
  units: [
    { name: 'Mietwohnwagen', persons: null, pets: false, prices: ab(51, 59, 62) },
    // occupancy and pet variants price the pane's unit; "Boddennähe" has no pane of its own and the pet 2/3-person rows
    // cost the same as the Boddenblick 2/3-person rows (house type unclear) -> no room
    { name: 'Ferienhaus Holli® Boddenblick 2 Personen', persons: 2, pets: false, prices: ab(84, 124, 132), room: RUM_ROOM_BODDENBLICK },
    { name: 'Ferienhaus Holli® 2 Personen mit Haustiererlaubnis', persons: 2, pets: true, prices: ab(84, 124, 132) },
    { name: 'Ferienhaus Holli® Boddenblick 3 Personen', persons: 3, pets: false, prices: ab(89, 129, 137), room: RUM_ROOM_BODDENBLICK },
    { name: 'Ferienhaus Holli® 3 Personen mit Haustiererlaubnis', persons: 3, pets: true, prices: ab(89, 129, 137) },
    { name: 'Ferienhaus Holli®', persons: null, pets: false, prices: ab(94, 136, 142), room: RUM_ROOM_HOLLI },
    { name: 'Ferienhaus Holli® mit Haustiererlaubnis', persons: null, pets: true, prices: ab(94, 136, 142), room: RUM_ROOM_HOLLI },
    { name: 'Ferienhaus Holli® Boddennähe', persons: null, pets: false, prices: ab(98, 140, 145) },
    { name: 'Ferienhaus Holli® Boddenblick', persons: null, pets: false, prices: ab(109, 151, 156), room: RUM_ROOM_BODDENBLICK },
  ],
  extras: [
    'Final cleaning: Holli EUR 89, Mietwohnwagen EUR 85',
    'Electricity and gas flat rate for the rental caravans: EUR 10 per night (June-August), EUR 15 (September-May)',
    ...RGB_EXTRAS_2026,
  ],
};

export function parseRegenbogenUmmanzContent(html: string): OfferContent {
  const lines = rgbLines(html);
  const all = lines.join('\n');
  const panes = rgbPanes(html);
  const kite = panes.find(p => /kite/i.test(p.name));
  const opening = rgbOpening(html);
  const pin = rgbPin(html);
  const offers = rgbRentalOffers(html);
  const rooms = rgbRooms(html).map(r => ({
    ...r,
    features: [...r.features, ...rgbPriceFeatures(RUM_SHEET, r.name.replace(/^Ferienunterkunft/, 'Ferienhaus'))],
  }));
  const min = Math.min(...RUM_SHEET.units.map(u => u.prices['A+B']));
  const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

  const summary = [
    `Regenbogen Ummanz is a holiday park of Regenbogen AG at Suhrendorf on Ummanz (Rügen), directly on the shallow Bodden that the park calls a large standing-depth area for kiters, windsurfers and SUP${opening ? `; it is open from ${fmt(opening.start)} to ${fmt(opening.end)}` : ''}.`,
    `The UMMAII kite and surf school is on the site and teaches beginners as well as rents equipment.`,
    `Besides pitches the park rents caravans for up to 4 persons and Holli® holiday units (some with a view over the Bodden), self-catering, from EUR ${min} per unit and night in the ${RUM_SHEET.year} low season; there is a restaurant, a minimarket and a sauna by the surf spot.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Regenbogen Ferienanlage Ummanz',
    summary,
    continent: 'Europe',
    country: 'Germany',
    region: 'Suhrendorf, Rügen',
    spot: 'Suhrendorf, Ummanz',
    ...(pin ? { spotCoords: pin } : {}),
    itinerarySpots: [],
    durationDays: null,
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: kite ? /Neulinge|lernen/i.test(kite.text) : null,
    equipmentRental: kite ? /versorgt Sie mit allem/i.test(kite.text) : null,
    beginnerFriendly: /Einsteiger/i.test(all),
    includedServices: ['Sanitary buildings with showers and cooking corners', 'Playground, minigolf, beach volleyball'],
    optionalServices: [
      'Kite and surf lessons and rental at the UMMAII school on site',
      'Sauna by the surf spot',
      ...offers.map(rgbOfferLine),
      ...RUM_SHEET.extras,
    ],
    accommodation: 'rental caravans and Holli® holiday units on a holiday park',
    mealPlan: 'self_catering',
    languages: ['de'],
    rooms,
    imageUrls: rgbImages(html).slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: RUM_URL,
    bookingUrl: RUM_BOOKING_URL,
    sourceText: [
      `intro: ${lines.find(l => /Hotspot für Wassersport/i.test(l)) ?? ''}`,
      `opening: ${opening ? `${opening.start}..${opening.end}` : '-'}`,
      `kite school: ${kite?.text ?? '-'}`,
      ...rgbPanes(html).filter(p => isRentalPane(p.name)).map(p => `${p.name}: ${p.text}`),
      `offers: ${offers.map(o => `${o.name} ${o.example ?? ''} ${o.price ?? ''}`).join(' | ')}`,
      `price list ${RUM_SHEET.href} (read by hand 2026-10-14): ${RUM_SHEET.units.map(u => `${u.name} ${u.prices['A+B']}/${u.prices.C}/${u.prices.D}`).join('; ')}`,
    ].join('\n'),
  };
}

export const regenbogenUmmanz: OfferAdapter = {
  key: 'regenbogen-ummanz',
  name: 'Regenbogen Ferienanlage Ummanz',
  kind: 'accommodation',
  operator: RGB_OPERATOR,
  url: RUM_URL,
  slotMethod: 'price_table',
  instantBooking: true,
  fetchBudget: 2,
  confidence: 'medium', // prices are hand-read constants from the linked PDF price list
  async fetchContent() {
    const html = await rgbPage(RUM_URL);
    if (!/Kite/i.test(html)) throw new Error('regenbogen-ummanz: kite school text missing on the park page');
    return parseRegenbogenUmmanzContent(html);
  },
  async fetchSlots(ctx) {
    return rgbSlotsFromPage(await rgbPage(RUM_URL), RUM_SHEET, todayIso(), ctx);
  },
};

