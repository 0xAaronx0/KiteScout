// ---------------------------------------------------------------------------
// Bork Havn Camping, Bork Havn (south side of Ringkøbing Fjord, West Jutland, Denmark) - three-star family campsite (220
// units) at the small fishing harbour of Bork Havn, 150 m from the harbour and the surf beach; the site calls the harbour
// area "one of Northern Europe's best kite and windsurf areas" and lists windsurfing / kitesurfing as an activity. Five
// rental cabins (for up to 2 and up to 5 people). No kite school is named on the site.
//
// Data path (checked 2026-10-12), WordPress (Danish pages; the English pages are 2020 copies without prices):
//   content  / (kite sentence, "Pladsen er åben fra 25. marts 2026 til 18. oktober 2026", Google Maps embed with the
//            campsite pin), /pladsen/ (150 m to harbour and surf beach, 220 units, 5 cabins), /hytter/ (two cabin types:
//            "Hytter til max. 5 personer" / "… 2 personer" + equipment lines), /aktiviteter/.
//   slots    /priser-hytter/ "Priser hytter 2026": low season 25.03.26-28.06.26 and 09.08.26-18.10.26, high season
//            28.06.26-09.08.26; per cabin type a price per night and per week (DKK), final cleaning DKK 250, bed linen DKK 80.
//            The page renders the table twice (desktop table + mobile list); the parser reads the mobile lines
//            ("Hytte Max 2 Pers. pr overnatning DKK 450,-") under their season heading.
// Booking engine: Compusoft (v3.onlinebooking.dk/v3borkcamp) - it lists pitches only (no cabins, checked 2026-10-12), so
//   the cabins are booked by mail / phone ("Forespørgsel") and there is no live availability.
// robots.txt (2026-10-12): WordPress defaults (nothing we read).
// Requests per run: content 5, slots 1 (memoised with content).
// Parsed: slot = cabin type x season band with real limits (end = last night before the next band / closing day), DKK per
//   cabin per night (priceUnit 'per_night', priceBasis 'room'), minNights 2, availability 'unknown'; bands that ended
//   before today are dropped. After 18.10.2026 the 2026 table has no future band -> [] (price on request) until the 2027
//   prices are published.
// Known limits: week 31 is bookable by the week only (not modelled); weekly prices go into the room features.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, iso, parseAmount, todayIso } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.borkhavncamping.dk';
export const BHC_HOME_URL = `${SITE}/`;
export const BHC_SITE_URL = `${SITE}/pladsen/`;
export const BHC_CABINS_URL = `${SITE}/hytter/`;
export const BHC_PRICES_URL = `${SITE}/priser-hytter/`;
export const BHC_ACTIVITIES_URL = `${SITE}/aktiviteter/`;

const memo = new Map<string, { at: number; p: Promise<string> }>();
/** one fetch per page per 10 minutes: fetchContent + fetchSlots in the same run share the price page */
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}
const addDays = (d: string, n: number): string => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/** Visible text lines (scripts, styles dropped), split at block tags. */
export function bhcLines(html: string): string[] {
  return html
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .split(/<\/?(?:p|li|td|th|tr|h\d|div|br|ul|section|figure|table)\b[^>]*>/i)
    .map(s => clean(s.replace(/<[^>]+>/g, ' ')))
    .filter(Boolean);
}

export interface BhcRate { persons: number; season: 'low' | 'high'; night: number | null; week: number | null }
export interface BhcPrices { year: number | null; bands: Array<{ season: 'low' | 'high'; start: string; end: string }>; rates: BhcRate[]; cleaning: number | null; linen: number | null }

/** "Priser hytter 2026": season headings, "dd.mm.yy – dd.mm.yy" ranges and the inline price lines of the mobile list. */
export function parseBhcPrices(html: string): BhcPrices {
  const lines = bhcLines(html);
  const year = Number(lines.join(' ').match(/Priser hytter (20\d{2})/)?.[1] ?? NaN) || null;
  const bands: BhcPrices['bands'] = [];
  const rates: BhcRate[] = [];
  let season: 'low' | 'high' | null = null;
  for (const l of lines) {
    if (/^Lavs(?:æ|ae)son$/i.test(l)) { season = 'low'; continue; }
    if (/^H(?:ø|oe)js(?:æ|ae)son$/i.test(l)) { season = 'high'; continue; }
    if (/^Tilkøb|^Kontakt$/i.test(l)) season = null;
    if (!season) continue;
    for (const m of l.matchAll(/(\d{2})\.(\d{2})\.(\d{2})\s*(?:–|-|til)\s*(\d{2})\.(\d{2})\.(\d{2})/g)) {
      const b = { season, start: iso(2000 + +m[3], +m[2], +m[1]), end: addDays(iso(2000 + +m[6], +m[5], +m[4]), -1) };
      if (!bands.some(x => x.start === b.start && x.end === b.end)) bands.push(b);
    }
    const r = l.match(/^Hytte max\.? (\d) pers\.? (pr\.? overnatning|1 uge) DKK ([\d.]+)/i);
    if (r) {
      const persons = Number(r[1]);
      let rate = rates.find(x => x.persons === persons && x.season === season);
      if (!rate) { rate = { persons, season, night: null, week: null }; rates.push(rate); }
      const v = parseAmount(r[3]);
      if (/uge/i.test(r[2])) rate.week = v; else rate.night = v;
    }
  }
  const all = lines.join('\n');
  return {
    year, bands: bands.sort((a, b) => a.start.localeCompare(b.start)), rates,
    cleaning: parseAmount(all.match(/Slutrengøring\s*\n?\s*DKK ([\d.]+)/)?.[1] ?? ''),
    linen: parseAmount(all.match(/Sengelinned pr\. sæt\s*\n?\s*DKK ([\d.]+)/)?.[1] ?? ''),
  };
}

export const bhcUnit = (persons: number): string => `Cabin for up to ${persons} people`;

export function buildBhcSlots(p: BhcPrices, today: string): Slot[] {
  const out: Slot[] = [];
  for (const b of p.bands) {
    if (b.end < today) continue;
    for (const r of p.rates.filter(x => x.season === b.season && x.night)) {
      out.push({
        key: `cabin-${r.persons}p|${b.start}`,
        startDate: b.start,
        endDate: b.end,
        unit: bhcUnit(r.persons),
        price: r.night,
        currency: 'DKK',
        priceUnit: 'per_night',
        priceBasis: 'room',
        occupancy: null,
        availability: 'unknown',
        availabilityText: null,
        spotsLeft: null,
        minNights: 2,
      });
    }
  }
  return out;
}

const DA_EN: Array<[RegExp, string]> = [
  [/^Værelse m\. (\d) køjesenge$/i, 'Room with $1 bunk beds'], [/^Værelse m\. dobbeltseng$/i, 'Room with a double bed'],
  [/^Briks i .stue.$/i, 'Daybed in the living room'], [/^Stue m\. (\d) senge$/i, 'Living room with $1 beds'],
  [/^Toilet m\. håndvask$/i, 'Toilet with washbasin'], [/^Bad i servicebygning ca\. (\d+) m\. fra hytte$/i, 'Shower in the service building about $1 m away'],
  [/^(\d) kogeplader$/i, '$1 hotplates'], [/^vask$/i, 'Sink'], [/^køleskab m\. frostboks$/i, 'Fridge with freezer compartment'],
  [/^kaffemaskine og el-keddel$/i, 'Coffee maker and kettle'], [/^Service til (?:min\. )?(\d) personer$/i, 'Tableware for $1'],
  [/^Dansk TV \(DR\)$/i, 'Danish TV (DR)'], [/^Gratis internet$/i, 'Free internet'],
  [/^Sengelinned medbringes – kan evt lejes$/i, 'Bring bed linen (can be rented)'],
  [/^Ankomst fra kl\. ([\d.]+)\/ afrejse senest kl\. ([\d.]+)$/i, 'Arrival from $1, departure by $2'],
  [/^Min\. 2 overnatninger\s*[–/-]\s*uge 31 min 1 uge$/i, 'Minimum 2 nights; week 31 by the week only'],
];
const toEnglish = (l: string): string => { for (const [re, en] of DA_EN) if (re.test(l)) return l.replace(re, en); return l; };

/** /hytter/: "Hytter til max. N personer" headings, each followed by its equipment lines. */
export function parseBhcCabins(html: string): Array<{ persons: number; features: string[] }> {
  const lines = bhcLines(html);
  const out: Array<{ persons: number; features: string[] }> = [];
  let cur: { persons: number; features: string[] } | null = null;
  for (const l of lines) {
    const h = l.match(/^Hytter til max\. (\d) personer$/i);
    if (h) { cur = { persons: Number(h[1]), features: [] }; out.push(cur); continue; }
    if (/^Kontakt$/.test(l)) cur = null;
    if (cur && l.length < 80) cur.features.push(toEnglish(l));
  }
  return out;
}

/** Google Maps embed of the page (!2d<lng>!3d<lat>). */
export function parseBhcPin(html: string): { lat: number; lng: number } | null {
  const m = html.match(/maps\/embed\?pb=[^"']*?!2d(-?\d+\.\d+)!3d(-?\d+\.\d+)/);
  return m ? { lat: Math.round(Number(m[2]) * 1e5) / 1e5, lng: Math.round(Number(m[1]) * 1e5) / 1e5 } : null;
}

/** Original photos (usercontent.one uploads without -WxH suffix); logos and EU / LAG funding badges dropped. */
export function bhcImages(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/https:\/\/usercontent\.one\/wp\/www\.borkhavncamping\.dk\/wp-content\/uploads\/[^"'\s)]+?\.(?:jpe?g|webp)/gi)) {
    const u = m[0];
    if (/-\d+x\d+\.|logo|LAG|Medfinansieret|DA-V-/i.test(u) || out.includes(u)) continue;
    out.push(u);
  }
  return out;
}

export interface BhcPages { home: string; site: string; cabins: string; prices: string; activities: string }

export function parseBorkHavnContent(p: BhcPages): OfferContent {
  const home = bhcLines(p.home);
  const site = bhcLines(p.site);
  const act = bhcLines(p.activities);
  const prices = parseBhcPrices(p.prices);
  const cabins = parseBhcCabins(p.cabins);
  const kite = home.find(l => /kite- og vindsurfområder/i.test(l)) ?? null;
  const open = home.join(' ').match(/åben fra\s+(\d{1,2})\.\s*([a-zæøå]+)\s+(20\d{2})\s+til\s+(\d{1,2})\.\s*([a-zæøå]+)\s+(20\d{2})/i);
  const DA_MONTH: Record<string, string> = { marts: 'March', april: 'April', maj: 'May', oktober: 'October', september: 'September', november: 'November' };
  const openText = open ? `${open[1]} ${DA_MONTH[open[2].toLowerCase()] ?? open[2]} to ${open[4]} ${DA_MONTH[open[5].toLowerCase()] ?? open[5]} ${open[6]}` : null;
  const units = site.join(' ').match(/med (\d+) enheder/)?.[1] ?? null;
  const dk = (n: number | null) => (n ? `DKK ${n.toLocaleString('en-US')}` : '-');
  const rooms: ContentRoom[] = cabins.map(c => ({
    name: bhcUnit(c.persons),
    description: null,
    features: [
      ...c.features,
      ...prices.rates.filter(r => r.persons === c.persons).map(r => `${prices.year ?? ''} ${r.season} season: ${dk(r.night)} per night, ${dk(r.week)} per week`.trim()),
    ],
  }));
  const nights = prices.rates.map(r => r.night).filter((x): x is number => !!x);
  const imgs: string[] = [];
  for (const u of [...bhcImages(p.cabins), ...bhcImages(p.site), ...bhcImages(p.home)]) if (!imgs.includes(u)) imgs.push(u);

  const summary = [
    `Bork Havn Camping is a three-star family campsite${units ? ` with ${units} units` : ''} at the small fishing harbour of Bork Havn on the south side of Ringkøbing Fjord in West Jutland, Denmark, 150 m from the harbour and the surf beach and 9 km from the North Sea${openText ? `, open ${openText}` : ''}.`,
    `It rents five simple cabins for up to 2 or up to 5 people with kitchenette and toilet (showers in the service building)${nights.length ? `, ${prices.year} prices DKK ${Math.min(...nights)}-${Math.max(...nights)} per night, minimum 2 nights` : ''}.`,
    'The campsite calls the harbour area one of the best kite and windsurf areas in Northern Europe and lists kitesurfing among its activities; it names no kite school.',
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Bork Havn Camping',
    summary,
    continent: 'Europe',
    country: 'Denmark',
    region: 'Bork Havn, West Jutland',
    spot: 'Bork Havn',
    ...(parseBhcPin(p.home) ? { spotCoords: parseBhcPin(p.home)! } : {}),
    spotCoordsPrecise: true,
    itinerarySpots: [],
    durationDays: null,
    skillLevels: [],
    kiteLessons: null,
    equipmentRental: null,
    beginnerFriendly: null,
    includedServices: ['Free Wi-Fi', 'Danish TV in the cabins'],
    optionalServices: [`Final cleaning ${dk(prices.cleaning)}`, `Bed linen ${dk(prices.linen)} per set`, 'Showers by chip card'],
    accommodation: 'camping cabins on a family campsite',
    mealPlan: 'self_catering',
    languages: ['da', 'en', 'de'],
    rooms,
    imageUrls: imgs.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: BHC_CABINS_URL,
    bookingUrl: `${SITE}/?page_id=1026`,
    sourceText: [
      `home: ${kite ?? ''} | open ${openText ?? '-'}`,
      `site: ${site.find(l => /150 m/.test(l)) ?? ''} | ${site.find(l => /enheder/.test(l)) ?? ''}`,
      `activities: ${act.find(l => /kitesurfing/i.test(l)) ?? ''}`,
      `cabins: ${cabins.map(c => `max ${c.persons}: ${c.features.join(', ')}`).join(' | ')}`,
      `prices ${prices.year}: ${prices.bands.map(b => `${b.season} ${b.start}..${b.end}`).join('; ')} | ${prices.rates.map(r => `${r.persons}p ${r.season} ${r.night}/night ${r.week}/week`).join('; ')} | cleaning ${prices.cleaning} linen ${prices.linen}`,
    ].join('\n'),
  };
}

export async function fetchBhcSlots(today: string): Promise<Slot[]> {
  const prices = parseBhcPrices(await page(BHC_PRICES_URL));
  if (prices.bands.length === 0 || prices.rates.length === 0) throw new Error('bork-havn-camping: cabin price table (season ranges / "Hytte max N pers." lines) not found on /priser-hytter/');
  return buildBhcSlots(prices, today);
}

export const borkHavnCamping: OfferAdapter = {
  key: 'bork-havn-camping',
  name: 'Bork Havn Camping',
  kind: 'accommodation',
  operator: {
    name: 'Bork Havn Camping',
    websiteUrl: SITE,
    rootDomain: 'borkhavncamping.dk',
    contactEmail: 'mail@borkhavncamping.dk',
    phone: '+4575280037',
  },
  url: BHC_CABINS_URL,
  slotMethod: 'price_table',
  fetchBudget: 6,
  async fetchContent() {
    const home = await page(BHC_HOME_URL);
    const site = await page(BHC_SITE_URL);
    const cabins = await page(BHC_CABINS_URL);
    const prices = await page(BHC_PRICES_URL);
    const activities = await page(BHC_ACTIVITIES_URL);
    if (!/kite/i.test(home)) throw new Error('bork-havn-camping: kite sentence missing on the home page');
    return parseBorkHavnContent({ home, site, cabins, prices, activities });
  },
  async fetchSlots(ctx) {
    const slots = await fetchBhcSlots(todayIso());
    if (slots.length === 0) ctx.note('bork-havn-camping: no future band in the printed cabin prices - price on request until the next season is published');
    return slots;
  },
};
