// ---------------------------------------------------------------------------
// Kailua Lodge, Pelzerhaken (Neustadt in Holstein, Baltic coast, Germany) - Hawaii-themed holiday village of 38 holiday
// houses, flats and lodges on the beach of Pelzerhaken (Bay of Lübeck). Kite link: the water-sports partner Sail & Surf
// Pelzerhaken (VDWS school, Naish pro centre; kitesurfing, windsurfing, sailing and SUP courses and rental) is right next
// to the lodge; the sandbank is standing depth up to 400 m out.
//
// Data path (checked 2026-10-14), WordPress site www.kailualodge.de (German):
//   content  / (intro, links to the price lists), /uebernachten/ (per unit type: size, bedrooms, bathrooms, persons,
//            distance to the beach, dogs), /wassersportferien-sail-surf-pelzerhaken/ (kite text), /anreise-und-kontakt/
//            (Google-Maps link with the coordinates).
//   slots    the prices are NOT in the HTML: every page links two PDF price lists, /wp-content/uploads/2026/08/
//            preisliste-2026.pdf and …/preisliste-2027.pdf ("Saisonzeiten und Preise": season dates with minimum stays,
//            and per house / flat / lodge the price of the first night incl. final cleaning and of each following
//            night, in four tiers NS / ZS / HS A / HS B). We cannot parse a PDF through fetchText, so the tables below
//            are constants read from the PDFs (pdftotext + visual check, 2026-10-14). A year's constants are released
//            only while the home page still links that year's PDF under the same path (like kenyaways-diani); a newer
//            price list link is reported via ctx.note for a manual re-read.
// Booking engine: V-Office (buchen.kailualodge.de). Its search page embeds a signed JWT (HS256) that the widget sends
//   with every API call - a signed token, so we do not use it (no live availability).
// robots.txt (2026-10-14): www.kailualodge.de only /wp-admin/ disallowed; buchen.kailualodge.de "Allow: /".
// Requests per run: content 4, slots 1 (the home page is memoised, so a full run makes 4).
// Parsed: slot = unit type x season range with the sheet's real dates ("lodge-c2|2027-07-10"), EUR per unit and night =
//   the following-night rate of the cheapest unit of that type ("ab" price; the first night costs EUR 59-179 more and
//   includes the final cleaning - in the room features), occupancy = the type's regular maximum, minNights from the sheet
//   (houses A / B and flat D2 vs. lodges C1 / C2, mini lodges and flat D1), availability 'unknown'. Ranges are
//   arrival-to-departure (neighbouring ranges share their boundary day), so a range's last night is the day before its
//   end. Ranges that ended before today are dropped.
// Known limits / inferred: "Himmelfahrt / Pfingsten" sits in the high-season block without an A / B label; it is read as
//   HS A (same row shading as "Sommer A" in the PDF). Easter in 2026 ("Osterferien 12.04. – 27.04.", 5 / 4 nights) is
//   inside the 2026 spring range and keeps the range's 3-night minimum. The Loft "Waterfront" (ab EUR 219 per day on its
//   page) is not in the PDFs and has no slots. Short stays of 2 nights in the low season cost 13.2 % extra; dogs EUR 12 per
//   night; booking fee EUR 25 - in the features. Map pin = the Google-Maps link on /anreise-und-kontakt/.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, iso, todayIso } from '../parse.js';
import type { ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.kailualodge.de';
export const KLP_HOME_URL = `${SITE}/`;
export const KLP_UNITS_URL = `${SITE}/uebernachten/`;
export const KLP_WATERSPORT_URL = `${SITE}/wassersportferien-sail-surf-pelzerhaken/`;
export const KLP_CONTACT_URL = `${SITE}/anreise-und-kontakt/`;
const BOOKING_URL = 'https://buchen.kailualodge.de/';

const memo = new Map<string, { at: number; p: Promise<string> }>();
/** one fetch per page per 10 minutes: fetchContent + fetchSlots in the same run share the home page */
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

// --- price lists (constants, read from the PDFs on 2026-10-14) -----------------------------------------------------
export type KlpTier = 'NS' | 'ZS' | 'HA' | 'HB';
/** min nights: houses A / B, flat D2, lodges C1 / C2 + mini lodges + flat D1 */
export interface KlpSeason { label: string; tier: KlpTier; start: string; end: string; min: { AB: number; D2: number; C: number } }
/** per tier: [first night incl. final cleaning, each following night] */
export type KlpPrices = Record<KlpTier, [number, number]>;
export interface KlpUnitPrices { units: string[]; prices: KlpPrices }
export interface KlpSheet { year: number; pdf: string; seasons: KlpSeason[]; types: Record<KlpType, KlpUnitPrices[]> }
export type KlpType = 'A' | 'B1' | 'B2' | 'D1' | 'D2' | 'C1' | 'C2' | 'MC1' | 'MC2';

const p = (ns1: number, ns: number, zs1: number, zs: number, ha1: number, ha: number, hb1: number, hb: number): KlpPrices =>
  ({ NS: [ns1, ns], ZS: [zs1, zs], HA: [ha1, ha], HB: [hb1, hb] });
const all = (n: number) => ({ AB: n, D2: n, C: n });
const split = (ab: number, c: number) => ({ AB: ab, D2: ab, C: c });

export const KLP_SHEETS: KlpSheet[] = [
  {
    year: 2026,
    pdf: '/wp-content/uploads/2026/08/preisliste-2026.pdf',
    seasons: [
      { label: 'Winter / spring (low season)', tier: 'NS', start: '2026-01-03', end: '2026-03-20', min: all(2) },
      { label: 'Spring (mid season)', tier: 'ZS', start: '2026-03-20', end: '2026-05-13', min: all(3) },
      { label: 'Ascension / Whitsun (high season)', tier: 'HA', start: '2026-05-13', end: '2026-05-26', min: split(5, 4) },
      { label: 'Summer (mid season)', tier: 'ZS', start: '2026-05-26', end: '2026-06-29', min: split(5, 3) },
      { label: 'Summer A (high season)', tier: 'HA', start: '2026-06-29', end: '2026-07-11', min: all(7) },
      { label: 'Summer B (high season)', tier: 'HB', start: '2026-07-11', end: '2026-08-16', min: all(7) },
      { label: 'Summer A (high season)', tier: 'HA', start: '2026-08-16', end: '2026-09-06', min: all(7) },
      { label: 'Autumn (mid season)', tier: 'ZS', start: '2026-09-06', end: '2026-10-31', min: split(5, 3) },
      { label: 'Autumn / winter (low season)', tier: 'NS', start: '2026-10-31', end: '2026-12-18', min: all(2) },
      { label: 'Christmas (mid season)', tier: 'ZS', start: '2026-12-18', end: '2026-12-27', min: split(5, 4) },
      { label: 'New Year B (high season)', tier: 'HB', start: '2026-12-27', end: '2027-01-03', min: { AB: 7, D2: 5, C: 5 } },
    ],
    types: {
      A: [{ units: ['Kailua'], prices: p(368, 189, 418, 239, 478, 299, 518, 339) }, { units: ['Haiku', 'Honolulu', 'Lahaina'], prices: p(378, 199, 428, 249, 488, 309, 528, 349) }],
      B1: [{ units: ['Kula', 'Paia', 'Hana'], prices: p(318, 149, 358, 189, 428, 259, 458, 289) }, { units: ['Molokai', 'Pukalani'], prices: p(324, 155, 368, 199, 438, 269, 468, 299) }],
      B2: [{ units: ['Kihei', 'Kona', 'Makani', 'Pali', 'Aloha', 'Mahalo', 'Wailea'], prices: p(348, 169, 398, 219, 464, 285, 504, 325) }],
      D1: [{ units: ['Kelii', 'Nalu'], prices: p(238, 99, 278, 139, 318, 179, 338, 199) }],
      D2: [{ units: ['Hookena Beach', 'Koko Head', 'Papa Bay', 'Ocean View', 'Sunset Beach', 'Diamond Head', 'Waikiki', 'North Shore'], prices: p(318, 149, 364, 195, 408, 239, 438, 269) }],
      C1: [{ units: ['Napali Coast', 'Barking Sands', 'Hanapepe Bay', 'Kee Beach'], prices: p(248, 109, 288, 149, 328, 189, 348, 209) }],
      C2: [{ units: ['Kanaha B.P.', 'Spreckelsville', 'Hookipa', 'Makena'], prices: p(308, 139, 348, 179, 394, 225, 418, 249) }],
      MC1: [{ units: ['Mana Point 1', 'Mana Point 2'], prices: p(104, 45, 118, 59, 134, 75, 144, 85) }],
      MC2: [{ units: ['Kalama B.P. 1', 'Kalama B.P. 2'], prices: p(120, 55, 140, 75, 154, 89, 164, 99) }],
    },
  },
  {
    year: 2027,
    pdf: '/wp-content/uploads/2026/08/preisliste-2027.pdf',
    seasons: [
      { label: 'Winter / spring (low season)', tier: 'NS', start: '2027-01-03', end: '2027-03-20', min: all(2) },
      { label: 'Easter (mid season)', tier: 'ZS', start: '2027-03-20', end: '2027-04-04', min: split(5, 4) },
      { label: 'Spring (mid season)', tier: 'ZS', start: '2027-04-04', end: '2027-05-05', min: all(3) },
      { label: 'Ascension / Whitsun (high season)', tier: 'HA', start: '2027-05-05', end: '2027-05-18', min: split(5, 4) },
      { label: 'Summer (mid season)', tier: 'ZS', start: '2027-05-18', end: '2027-06-28', min: split(5, 3) },
      { label: 'Summer A (high season)', tier: 'HA', start: '2027-06-28', end: '2027-07-10', min: all(7) },
      { label: 'Summer B (high season)', tier: 'HB', start: '2027-07-10', end: '2027-08-15', min: all(7) },
      { label: 'Summer A (high season)', tier: 'HA', start: '2027-08-15', end: '2027-09-05', min: all(7) },
      { label: 'Autumn (mid season)', tier: 'ZS', start: '2027-09-05', end: '2027-10-30', min: split(5, 3) },
      { label: 'Autumn / winter (low season)', tier: 'NS', start: '2027-10-30', end: '2027-12-18', min: all(2) },
      { label: 'Christmas (mid season)', tier: 'ZS', start: '2027-12-18', end: '2027-12-27', min: split(5, 4) },
      { label: 'New Year B (high season)', tier: 'HB', start: '2027-12-27', end: '2028-01-04', min: { AB: 7, D2: 5, C: 5 } },
    ],
    types: {
      A: [{ units: ['Kailua'], prices: p(368, 189, 428, 249, 508, 329, 538, 359) }, { units: ['Haiku', 'Honolulu', 'Lahaina'], prices: p(378, 199, 438, 259, 518, 339, 548, 369) }],
      B1: [{ units: ['Kula', 'Paia', 'Hana'], prices: p(318, 149, 358, 189, 438, 269, 468, 299) }, { units: ['Molokai', 'Pukalani'], prices: p(324, 155, 368, 199, 448, 279, 478, 309) }],
      B2: [{ units: ['Kihei', 'Kona', 'Makani', 'Pali', 'Aloha', 'Mahalo', 'Wailea'], prices: p(348, 169, 398, 219, 478, 299, 518, 339) }],
      D1: [{ units: ['Kelii', 'Nalu'], prices: p(238, 99, 278, 139, 318, 179, 338, 199) }],
      D2: [{ units: ['Hookena Beach', 'Koko Head', 'Papa Bay', 'Ocean View', 'Sunset Beach', 'Diamond Head', 'Waikiki', 'North Shore'], prices: p(318, 149, 364, 195, 408, 239, 438, 269) }],
      C1: [{ units: ['Napali Coast', 'Barking Sands', 'Hanapepe Bay', 'Kee Beach'], prices: p(248, 109, 288, 149, 328, 189, 348, 209) }],
      C2: [{ units: ['Kanaha B.P.', 'Spreckelsville', 'Hookipa', 'Makena'], prices: p(308, 139, 348, 179, 394, 225, 418, 249) }],
      MC1: [{ units: ['Mana Point 1', 'Mana Point 2'], prices: p(104, 45, 118, 59, 134, 75, 144, 85) }],
      MC2: [{ units: ['Kalama B.P. 1', 'Kalama B.P. 2'], prices: p(120, 55, 140, 75, 154, 89, 164, 99) }],
    },
  },
];

export const KLP_TYPES: Record<KlpType, { name: string; site: string; persons: number; group: 'AB' | 'D2' | 'C' }> = {
  A: { name: 'Holiday house type A', site: 'Ferienhaus Typ A', persons: 6, group: 'AB' },
  B1: { name: 'Holiday house type B1', site: 'Ferienhaus Typ B1', persons: 4, group: 'AB' },
  B2: { name: 'Holiday house type B2', site: 'Ferienhaus Typ B2', persons: 6, group: 'AB' },
  D1: { name: 'Holiday flat type D1', site: 'Ferienwohnung Typ D1', persons: 3, group: 'C' },
  D2: { name: 'Holiday flat type D2', site: 'Ferienwohnung Typ D2', persons: 4, group: 'D2' },
  C1: { name: 'Lodge type C1', site: 'Lodge Typ C1', persons: 6, group: 'C' },
  C2: { name: 'Lodge type C2', site: 'Lodge Typ C2', persons: 6, group: 'C' },
  MC1: { name: 'Mini lodge type C1', site: 'Mini-Lodge Typ C1', persons: 2, group: 'C' },
  MC2: { name: 'Mini lodge type C2', site: 'Mini-Lodge Typ C2', persons: 2, group: 'C' },
};
const TYPE_KEYS: Record<KlpType, string> = { A: 'house-a', B1: 'house-b1', B2: 'house-b2', D1: 'flat-d1', D2: 'flat-d2', C1: 'lodge-c1', C2: 'lodge-c2', MC1: 'mini-lodge-c1', MC2: 'mini-lodge-c2' };

const addDays = (d: string, n: number): string => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/** Price-list PDF links on a page: year -> path. */
export function klpPdfLinks(html: string): Map<number, string> {
  const out = new Map<number, string>();
  for (const m of html.matchAll(/https?:\/\/www\.kailualodge\.de(\/wp-content\/uploads\/\d{4}\/\d{2}\/preisliste-(20\d{2})[^"'\s]*\.pdf)/g)) out.set(Number(m[2]), m[1]);
  return out;
}

/** Sheets whose PDF is still linked under the same path. */
export function klpReleasedSheets(html: string, ctx?: Pick<FetchContext, 'note'>): KlpSheet[] {
  const links = klpPdfLinks(html);
  const out: KlpSheet[] = [];
  for (const s of KLP_SHEETS) {
    if (links.get(s.year) === s.pdf) out.push(s);
    else ctx?.note(`kailua-lodge: price list ${s.year} no longer linked as ${s.pdf} (now: ${links.get(s.year) ?? 'none'}) - constants withheld, re-read the PDF`);
  }
  for (const [y, path] of links) if (!KLP_SHEETS.some(s => s.year === y)) ctx?.note(`kailua-lodge: new price list ${y} linked (${path}) - read it by hand`);
  return out;
}

export function buildKlpSlots(sheets: KlpSheet[], today: string): Slot[] {
  const out: Slot[] = [];
  for (const sheet of sheets) {
    for (const type of Object.keys(KLP_TYPES) as KlpType[]) {
      const t = KLP_TYPES[type];
      const groups = sheet.types[type];
      for (const s of sheet.seasons) {
        const last = addDays(s.end, -1);
        if (last < today) continue;
        const cheapest = groups.reduce((a, b) => (b.prices[s.tier][1] < a.prices[s.tier][1] ? b : a));
        out.push({
          key: `${TYPE_KEYS[type]}|${s.start}`,
          startDate: s.start,
          endDate: last,
          unit: t.name,
          price: cheapest.prices[s.tier][1],
          currency: 'EUR',
          priceUnit: 'per_night',
          priceBasis: 'room',
          occupancy: t.persons,
          availability: 'unknown',
          availabilityText: null,
          spotsLeft: null,
          minNights: s.min[t.group],
        });
      }
    }
  }
  return out;
}

/** Visible text lines (scripts, styles, SVGs dropped), split at block tags. */
export function klpLines(html: string): string[] {
  return html
    .replace(/<(script|style|noscript|svg|head)\b[\s\S]*?<\/\1>/gi, ' ')
    .split(/<\/?(?:p|li|td|th|tr|h\d|div|br|ul|section|figure|header|footer|article|span|a|button)\b[^>]*>/i)
    .map(s => clean(s.replace(/<[^>]+>/g, ' ')))
    .filter(Boolean);
}

export interface KlpUnitFacts { site: string; facts: Record<string, string>; extras: string[] }

/** Unit-type cards of /uebernachten/: name, then label / value pairs (Größe, Schlafzimmer, Badezimmer / WC, Personen, Strand in, Hunde erlaubt) and equipment words. */
export function parseKlpUnits(html: string): KlpUnitFacts[] {
  const l = klpLines(html);
  const start = l.findIndex(x => /^Unsere Feriendomizile/.test(x));
  const out: KlpUnitFacts[] = [];
  let cur: KlpUnitFacts | null = null;
  const LABELS = ['Größe', 'Schlafzimmer', 'Schlafsofa', 'Hochbett', 'Badezimmer / WC', 'Personen', 'Strand in', 'Hunde erlaubt'];
  for (let k = start + 1; start >= 0 && k < l.length; k++) {
    const x = l[k];
    if (/^Lageplan$|^Welche Unterkunft erfüllt/.test(x)) break;
    if (/^(Ferienhaus Typ|Ferienwohnung Typ|Lodge Typ|Mini-Lodge Typ|Kailua Loft)/.test(x)) { cur = { site: x, facts: {}, extras: [] }; out.push(cur); continue; }
    if (!cur) continue;
    if (LABELS.includes(x) && l[k + 1]) { cur.facts[x] = l[k + 1]; k++; continue; }
    if (/^(Parkplatz|WLAN|Sauna|Kamin)$/.test(x)) cur.extras.push(x);
  }
  return out;
}

/** Original uploads (no -WxH) of the pages; logos / icons / PDFs dropped. */
export function klpImages(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/https:\/\/www\.kailualodge\.de\/wp-content\/uploads\/[^"'\s,)]+\.(?:jpe?g|webp)/gi)) {
    const u = m[0].replace(/-\d{2,4}x\d{2,4}(?=\.[a-z]+$)/i, '').replace(/-scaled(?=\.[a-z]+$)/i, '');
    if (/logo|icon|favicon|grundriss|lageplan|siegel|award/i.test(u)) continue;
    if (!out.includes(u)) out.push(u);
  }
  return out;
}

export interface KlpPages { home: string; units: string; watersport: string; contact: string }

export function parseKailuaContent(pg: KlpPages): OfferContent {
  const home = klpLines(pg.home);
  const water = klpLines(pg.watersport);
  const units = parseKlpUnits(pg.units);
  const sheets = klpReleasedSheets(pg.home);
  const coords = pg.contact.match(/!1d(\d{1,3}\.\d+)!2d(\d{1,2}\.\d+)/);
  const partner = water.find(l => /Direkt neben der Kailua Lodge/.test(l)) ?? null;
  const school = water.find(l => /Windsurfen, Kitesurfen, Segeln und Stand-up-Paddling/.test(l)) ?? null;
  const sandbank = water.find(l => /Sandbank/.test(l)) ?? null;
  const intro = home.find(l => /hawaiianischen Feriendorf/.test(l)) ?? null;
  const latest = sheets[sheets.length - 1] ?? null;
  const fromPrices = latest ? (Object.keys(KLP_TYPES) as KlpType[]).filter(t => !/^MC/.test(t)).flatMap(t => latest.types[t].map(g => g.prices.NS[1])) : [];

  const rooms: ContentRoom[] = units.map(u => {
    const type = (Object.keys(KLP_TYPES) as KlpType[]).find(t => KLP_TYPES[t].site === u.site) ?? null;
    const f = u.facts;
    const facts = [
      f['Größe'] ? `${f['Größe']}` : null,
      f['Schlafzimmer'] ? `${f['Schlafzimmer']} bedroom${f['Schlafzimmer'] === '1' ? '' : 's'}` : null,
      f['Badezimmer / WC'] ? `bathrooms / WC ${f['Badezimmer / WC']}` : null,
      f['Personen'] ? `${f['Personen'].replace(' bis ', '-')} persons` : null,
      f['Strand in'] ? `beach ${f['Strand in'].replace(' bis ', '-')}` : null,
      f['Hunde erlaubt'] ? (f['Hunde erlaubt'] === 'Ja' ? 'dogs allowed (EUR 12 per night)' : 'no dogs') : null,
    ].filter((x): x is string => !!x);
    const priceFeatures = type ? sheets.map(s => {
      const g = s.types[type];
      const lo = Math.min(...g.map(x => x.prices.NS[1]));
      const hi = Math.max(...g.map(x => x.prices.HB[1]));
      const firstExtra = g.map(x => x.prices.NS[0] - x.prices.NS[1]);
      return `${s.year}: EUR ${lo}-${hi} per following night (low season to high season B); first night incl. final cleaning EUR ${Math.min(...firstExtra)}${Math.max(...firstExtra) !== Math.min(...firstExtra) ? `-${Math.max(...firstExtra)}` : ''} more`;
    }) : ['Not in the PDF price lists (price on request)'];
    return {
      name: type ? KLP_TYPES[type].name : u.site.replace(/^Kailua Loft\s*/, 'Loft ').replace(/[„“"]/g, ''),
      description: `${facts.join(', ')}${u.extras.length ? `; ${u.extras.map(x => ({ Parkplatz: 'parking', WLAN: 'Wi-Fi', Sauna: 'sauna', Kamin: 'fireplace' } as Record<string, string>)[x]).join(', ')}` : ''}.`,
      features: [...(type ? [`Units: ${KLP_SHEETS[KLP_SHEETS.length - 1].types[type].flatMap(g => g.units).join(', ')}`] : []), ...priceFeatures],
    };
  });

  const imgs: string[] = [];
  const surfFirst = (l: string[]) => [...l.filter(u => /surf|naish|kite/i.test(u)), ...l.filter(u => !/surf|naish|kite/i.test(u))];
  for (const x of [...surfFirst(klpImages(pg.watersport)), ...klpImages(pg.units), ...klpImages(pg.home)]) if (!imgs.includes(x)) imgs.push(x);

  const summary = [
    'Kailua Lodge is a Hawaii-themed holiday village on the sandy beach of Pelzerhaken on the Bay of Lübeck, Germany, with 38 holiday houses, flats and lodges for 2 to 6 people, many with sauna and fireplace, 80 to 200 m from the beach.',
    `Its water-sports partner Sail & Surf Pelzerhaken, a VDWS school and Naish pro centre, is right next door and teaches and rents kitesurfing, windsurfing, sailing and SUP; the sandbank in front is standing depth up to 400 m out, and kites stay on land only with north-west wind.`,
    latest && fromPrices.length ? `The ${latest.year} price list starts at EUR ${Math.min(...fromPrices)} per night for a flat in the low season (plus a higher first night that includes the final cleaning); minimum stays run from 2 nights in the low season to 7 in the summer high season.` : '',
  ].filter(Boolean).join(' ');

  return {
    kind: 'accommodation',
    title: 'Kailua Lodge',
    summary,
    continent: 'Europe',
    country: 'Germany',
    region: 'Pelzerhaken, Baltic Coast',
    spot: 'Pelzerhaken',
    // Google-Maps link on /anreise-und-kontakt/ ("…!1d10.8728051!2d54.0881448", 2026-10-14)
    spotCoords: coords ? { lat: Number(coords[2]), lng: Number(coords[1]) } : null,
    spotCoordsPrecise: true,
    itinerarySpots: [],
    durationDays: null,
    // water-sports page: "Als Gruppenunterricht oder als Einzelstunde, für Anfänger und Fortgeschrittene"
    skillLevels: ['beginner', 'intermediate'],
    kiteLessons: school ? true : null,
    equipmentRental: water.some(l => /Material und Verleih|Vermietung und Kurse/.test(l)) ? true : null,
    beginnerFriendly: true,
    includedServices: ['Electricity, water, heating and Wi-Fi', 'Bed linen and towels', 'Final cleaning (in the first-night price)'],
    optionalServices: ['Kite, windsurf, sailing and SUP courses and rental at Sail & Surf Pelzerhaken (next door)', 'Dog (EUR 12 per night)', 'Booking fee EUR 25', 'Tourist tax (Kurtaxe)', 'BeachHouse restaurant 100 m away'],
    accommodation: 'holiday houses, flats and lodges in a holiday village by the beach',
    mealPlan: 'self_catering',
    languages: ['de'],
    rooms,
    imageUrls: imgs.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: KLP_WATERSPORT_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      `home: ${intro ?? ''}`,
      `water sports: ${sandbank ?? ''} | ${partner ?? ''} | ${school ?? ''}`,
      `units: ${units.map(u => `${u.site}: ${Object.entries(u.facts).map(([k, v]) => `${k} ${v}`).join(', ')}${u.extras.length ? `, ${u.extras.join(', ')}` : ''}`).join(' | ')}`,
      `price lists linked: ${[...klpPdfLinks(pg.home)].map(([y, path]) => `${y} ${path}`).join('; ')} (prices = constants read from these PDFs)`,
    ].join('\n'),
  };
}

export async function fetchKlpSlots(today: string, ctx: FetchContext): Promise<Slot[]> {
  const sheets = klpReleasedSheets(await page(KLP_HOME_URL), ctx);
  ctx.note('kailua-lodge: prices are constants read from the PDF price lists on 2026-10-14');
  return buildKlpSlots(sheets, today);
}

export const kailuaLodgePelzerhaken: OfferAdapter = {
  key: 'kailua-lodge-pelzerhaken',
  name: 'Kailua Lodge Pelzerhaken',
  kind: 'accommodation',
  operator: {
    name: 'Kailua Lodge KG',
    websiteUrl: SITE,
    rootDomain: 'kailualodge.de',
    contactEmail: 'info@kailualodge.de',
    phone: '+4945615588229',
  },
  url: KLP_WATERSPORT_URL,
  slotMethod: 'price_table',
  instantBooking: true,
  fetchBudget: 4,
  confidence: 'medium', // prices are hand-read constants from the PDF price lists
  async fetchContent() {
    const home = await page(KLP_HOME_URL);
    const units = await page(KLP_UNITS_URL);
    const watersport = await page(KLP_WATERSPORT_URL);
    const contact = await page(KLP_CONTACT_URL);
    if (!/Sail &amp; Surf Pelzerhaken|Sail & Surf Pelzerhaken/.test(watersport) || !/Kitesurfen/.test(watersport)) throw new Error('kailua-lodge: Sail & Surf / Kitesurfen missing on the water-sports page (kite link gone?)');
    if (parseKlpUnits(units).length === 0) throw new Error('kailua-lodge: no unit-type cards on /uebernachten/ (layout changed?)');
    return parseKailuaContent({ home, units, watersport, contact });
  },
  async fetchSlots(ctx) {
    return fetchKlpSlots(todayIso(), ctx);
  },
};

// sanity check of the constants (cheap; throws at import if a table row was mistyped)
for (const s of KLP_SHEETS) {
  const sorted = [...s.seasons].sort((a, b) => a.start.localeCompare(b.start));
  sorted.forEach((x, i) => { if (i && sorted[i - 1].end !== x.start) throw new Error(`kailua-lodge: season gap/overlap ${sorted[i - 1].end} / ${x.start} in ${s.year}`); });
  if (iso(s.year, 1, 3) !== sorted[0].start) throw new Error(`kailua-lodge: ${s.year} sheet does not start on 3 January`);
}
