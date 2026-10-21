// ---------------------------------------------------------------------------
// ProBoarding Rügen Ferienwohnungen, Klein Zicker (Thiessow, south-east Rügen, Germany) - three holiday apartments in
// the house of the kite / wind / wing / SUP school ProBoarding (Dörpstrat 35, "Kitesurfschule und Shop mit
// Ferienwohnungen"), a few metres from the Greifswalder Bodden; the school's station is on the beach about 300 m from the
// Klein Zicker car park, VDWS school no. VS16290, season 2026 "26. April bis 18. Oktober 2026".
//
// Data path (checked 2026-10-14), WordPress (twentyfourteen), German only:
//   content  /fewo/ (apartment overview, location: "Zum Greifswalder Bodden sind es nur wenige Meter zu Fuß. Zum
//            Ostseestrand nach Thiessow ca 1,5km", footer "Saison 2026"), the three apartment pages below,
//            /kitesurfen/ (course prices), /kitenlernenkitesurfenkiteboarding/anfahrt-wegbeschreibung/ (address, phone,
//            Google My Maps embed centred on ll=54.294689,13.689995 = Klein Zicker; a map centre at zoom 12, not a pin).
//   slots    /fewo/ferienwohnung-zur-seeseite/, /fewo/ferienwohnung-zur-bergseite/, /fewo/deluxe-ferienwohnung/:
//            "Preisliste & Saisonzeiten" without a year: "44,00 € Saison A 01.11. bis 31.03." / "66,00 € Saison B
//            01.04. bis 31.05. / 16.09. – 31.10." / "88,00 € Saison C 01.06. bis 15.09.", "(Mindestaufenthalt 3 Nächte)",
//            "Die Preise gelten für 2 Personen pro Nacht". The year comes from the pages' own WordPress modification date
//            (GET /wp-json/wp/v2/pages?include=23,24,25&_fields=id,slug,modified -> all three "2026-01-03"), i.e. the
//            2026 price list; fallback: the footer "Saison <year>".
// No booking engine: the "Belegungsplan / Onlinebuchung" block is an empty div (no script fills it); bookings go through
//   the contact form, mail or phone. The pages also embed Airbnb cards (a portal, not used).
// robots.txt (2026-10-14): "User-agent: *" disallows only /wp-content/cache/cachify/ (named bad bots are blocked, not us).
// Requests per run: content 6 (/fewo/, 3 apartments, /kitesurfen/, directions) + 1 (REST dates), slots 4 (memoised with
//   content) -> 7 for a full run.
// Parsed: slot = apartment x season band of the price-list year with real limits (Saison A wraps the turn of the year:
//   01.11. to 31.03. of the next year), EUR per apartment per night for 2 people (priceBasis 'room', occupancy 2),
//   minNights 3, availability 'unknown'; bands that ended before today are dropped, so the 2026 list runs out on
//   2027-03-31 and the offer shows "price on request" until the page is updated.
// Known limits: New Year's Eve is charged at Saison C ("Silvester/Jahreswechsel"), without dates -> room features only.
//   Extra bed EUR 20 per person and night, linen package EUR 20 per person, final cleaning EUR 54 / 63 / 86, dog EUR 10 +
//   10 per night and the local tourist tax come on top (room features). The /kitesurfen-camp/ page (KiteCamp
//   apartments "ab 25,00 Euro pro Person und Nacht", "Kitesurfcamps 2019 Termine", "Corona Update" 2020) is stale and
//   not used.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, iso, parseAmount, todayIso } from '../parse.js';
import type { ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.proboarding.de';
export const PB_FEWO_URL = `${SITE}/fewo/`;
export const PB_KITE_URL = `${SITE}/kitesurfen/`;
export const PB_DIRECTIONS_URL = `${SITE}/kitenlernenkitesurfenkiteboarding/anfahrt-wegbeschreibung/`;
const CONTACT_URL = `${SITE}/kitenlernenkitesurfenkiteboarding/kontaktformular/`;

export interface PbApartment { id: number; slug: string; key: string; unit: string; url: string }
export const PB_APARTMENTS: PbApartment[] = [
  { id: 24, slug: 'ferienwohnung-zur-seeseite', key: 'seeseite', unit: 'Apartment 1 Seeseite', url: `${SITE}/fewo/ferienwohnung-zur-seeseite/` },
  { id: 23, slug: 'ferienwohnung-zur-bergseite', key: 'bergseite', unit: 'Apartment 2 Bergseite', url: `${SITE}/fewo/ferienwohnung-zur-bergseite/` },
  { id: 25, slug: 'deluxe-ferienwohnung', key: 'deluxe', unit: 'Apartment 3 DeLuxe', url: `${SITE}/fewo/deluxe-ferienwohnung/` },
];
export const PB_DATES_URL = `${SITE}/wp-json/wp/v2/pages?include=${PB_APARTMENTS.map(a => a.id).join(',')}&_fields=id,slug,modified`;

// --- local helpers ----------------------------------------------------------------------------
const memo = new Map<string, { at: number; p: Promise<string> }>();
/** one fetch per page per 10 minutes: fetchContent + fetchSlots in the same run share the apartment pages */
function page(url: string, accept = 'text/html'): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}
const addDays = (d: string, n: number): string => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

/** Visible text lines (scripts, styles dropped), split at block tags. */
export function pbLines(html: string): string[] {
  return html
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .split(/<\/?(?:p|li|td|th|tr|h\d|div|br|ul|section|article|table|blockquote)\b[^>]*>/i)
    .map(s => clean(s.replace(/<[^>]+>/g, ' ')))
    .filter(Boolean);
}

// --- price list -------------------------------------------------------------------------------
export interface PbSeason { season: string; price: number; ranges: Array<{ from: [number, number]; to: [number, number] }> }
export interface PbPrices {
  seasons: PbSeason[]; minNights: number | null; persons: number | null;
  extraBed: number | null; linen: number | null; cleaning: number | null; dog: string | null; newYear: boolean;
}

/** "44,00 € Saison A 01.11. bis 31.03." lines + the rules under the table. */
export function parsePbPrices(html: string): PbPrices {
  const lines = pbLines(html);
  const seasons: PbSeason[] = [];
  for (const l of lines) {
    const m = l.match(/^([\d.,]+)\s*€\s*Saison\s+([A-Z])\b\s*(.*)$/);
    if (!m) continue;
    const ranges = [...m[3].matchAll(/(\d{1,2})\.(\d{1,2})\.\s*(?:bis|–|-)\s*(\d{1,2})\.(\d{1,2})\./g)]
      .map(r => ({ from: [+r[2], +r[1]] as [number, number], to: [+r[4], +r[3]] as [number, number] }));
    const price = parseAmount(m[1]);
    if (price && ranges.length) seasons.push({ season: m[2], price, ranges });
  }
  const all = lines.join('\n');
  return {
    seasons,
    minNights: Number(all.match(/Mindestaufenthalt (\d+) Nächte/)?.[1] ?? NaN) || null,
    persons: Number(all.match(/Preise gelten für (\d+) Personen pro Nacht/)?.[1] ?? NaN) || null,
    extraBed: /Aufbettung ist in dieser Wohnung nicht möglich/i.test(all) ? null : parseAmount(all.match(/Aufbettung ([\d.,]+)\s*€/)?.[1] ?? ''),
    linen: parseAmount(all.match(/Wäschepaket[^\n]*?([\d.,]+)\s*€\s*pro Person/)?.[1] ?? ''),
    cleaning: parseAmount(all.match(/Endreinigung[^\n]*?einmalig ([\d.,]+)\s*€/)?.[1] ?? ''),
    dog: all.match(/Vierbeiner[^\n]*?einmalig ([\d.,]+)\s*€[^\n]*?([\d.,]+)\s*€ pro Nacht/)?.slice(1, 3).map(x => `EUR ${parseAmount(x)}`).join(' once + ') ?? null,
    newYear: /Silvester\/Jahreswechsel gelten die Preise der Hauptsaison/i.test(all),
  };
}

/** WordPress REST answer -> the price-list year per apartment slug (from `modified`). */
export function parsePbYears(json: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of Array.isArray(json) ? json as Array<{ slug?: string; modified?: string }> : []) {
    const y = Number(p.modified?.slice(0, 4));
    if (p.slug && y > 2000) out[p.slug] = y;
  }
  return out;
}

/** Footer "// Saison 2026" (school season) - fallback year when the REST dates are missing. */
export function pbSeasonYear(html: string): number | null {
  return Number(pbLines(html).join('\n').match(/Saison (20\d{2})\n/)?.[1] ?? NaN) || null;
}

/** Season bands of the price-list year; a range ending before it starts wraps into the next year. */
export function pbBands(p: PbPrices, year: number): Array<{ season: string; price: number; start: string; end: string }> {
  const out: Array<{ season: string; price: number; start: string; end: string }> = [];
  for (const s of p.seasons) {
    for (const r of s.ranges) {
      const wraps = r.to[0] < r.from[0] || (r.to[0] === r.from[0] && r.to[1] < r.from[1]);
      if (wraps) out.push({ season: s.season, price: s.price, start: iso(year, 1, 1), end: iso(year, r.to[0], r.to[1]) });
      out.push({ season: s.season, price: s.price, start: iso(year, r.from[0], r.from[1]), end: iso(wraps ? year + 1 : year, r.to[0], r.to[1]) });
    }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

export function buildPbSlots(apts: Array<{ apt: PbApartment; prices: PbPrices; year: number }>, today: string): Slot[] {
  const out: Slot[] = [];
  for (const { apt, prices, year } of apts) {
    for (const b of pbBands(prices, year)) {
      if (b.end < today) continue;
      out.push({
        key: `${apt.key}|${b.start}`,
        startDate: b.start,
        endDate: b.end,
        unit: apt.unit,
        price: b.price,
        currency: 'EUR',
        priceUnit: 'per_night',
        priceBasis: 'room',
        occupancy: prices.persons,
        availability: 'unknown',
        availabilityText: null,
        spotsLeft: null,
        ...(prices.minNights ? { minNights: prices.minNights } : {}),
      });
    }
  }
  return out;
}

// --- content ----------------------------------------------------------------------------------
/** "Wohnfläche 36qm, für 2-3 Personen, DU/WC, mini Küche …" -> English facts. */
export function pbApartmentFacts(html: string): { size: number | null; persons: string | null; text: string; features: string[] } {
  const text = pbLines(html).find(l => /^Wohnfläche \d+\s?qm/.test(l)) ?? '';
  const has = (re: RegExp) => re.test(text);
  return {
    size: Number(text.match(/Wohnfläche (\d+)\s?qm/)?.[1] ?? NaN) || null,
    persons: text.match(/für ([\d-]+) Personen/)?.[1] ?? null,
    text,
    features: [
      has(/Maisonette/i) ? 'Maisonette with sleeping loft' : null,
      has(/Kinderschlafzimmer/i) ? 'Extra children\'s bedroom' : null,
      has(/Balkon/i) ? 'Balcony' : null,
      has(/Badewanne/i) ? 'Bathtub and WC' : has(/\bBad\/WC/) ? 'Bathroom and WC' : 'Shower and WC',
      has(/mini Küche/i) ? 'Mini kitchen' : 'Kitchen',
      has(/großes Wohnzimmer/i) ? 'Large living room with sofa' : null,
      has(/Geschirrsp/i) ? 'Dishwasher' : null,
      has(/Mikrowelle/i) ? 'Microwave' : null,
      'Coffee maker, toaster and kettle',
      has(/Nichtraucher/i) ? 'Non-smoking' : null,
      has(/hundefreundlich/i) ? 'Fully tiled, dogs welcome' : null,
    ].filter((x): x is string => !!x),
  };
}

/** Course prices on /kitesurfen/ ("150,00€ / (Tag 3H)" etc.). */
export function parsePbCourses(html: string): string[] {
  const t = pbLines(html).join('\n');
  const eur = (re: RegExp) => parseAmount(t.match(re)?.[1] ?? '');
  const out: Array<string | null> = [
    eur(/4 Teilnehmer \/ 1 Lehrer[^\n]*\n([\d.,]+)\s*€ \/ \(Tag 3H\)/) ? `Premium kite course (max. 4 students per instructor): EUR ${eur(/4 Teilnehmer \/ 1 Lehrer[^\n]*\n([\d.,]+)\s*€ \/ \(Tag 3H\)/)} per person and 3-hour day` : null,
    eur(/2 Teilnehmer \/ 1 Lehrer[^\n]*\n([\d.,]+)\s*€/) ? `Exclusive kite course (2 students, radio helmet): EUR ${eur(/2 Teilnehmer \/ 1 Lehrer[^\n]*\n([\d.,]+)\s*€/)} per person and 3-hour day` : null,
    eur(/1 Teilnehmer \/ 1 Lehrer[^\n]*\n([\d.,]+)\s*€/) ? `Private kite course (1:1, radio helmet): EUR ${eur(/1 Teilnehmer \/ 1 Lehrer[^\n]*\n([\d.,]+)\s*€/)} per 3-hour day` : null,
    eur(/begleitet Kiten 3H \(unsere[^\n]*?für ([\d.,]+)\s*€/) ? `Supervised kiting with rental kite and board (3 h): EUR ${eur(/begleitet Kiten 3H \(unsere[^\n]*?für ([\d.,]+)\s*€/)} per day` : null,
    eur(/VDWS Kitesurf Lizenz ([\d.,]+)\s*€/) ? `VDWS kite licence EUR ${eur(/VDWS Kitesurf Lizenz ([\d.,]+)\s*€/)} (included with 5 course days)` : null,
  ];
  return out.filter((x): x is string => !!x);
}

/** Google My Maps embed on the directions page: map centre ll=<lat>,<lng>. */
export function pbMapCentre(html: string): { lat: number; lng: number } | null {
  const m = html.match(/maps\.google\.com\/maps\/ms\?[^"']*?ll=(-?\d+\.\d+),(-?\d+\.\d+)/);
  return m ? { lat: Math.round(Number(m[1]) * 1e5) / 1e5, lng: Math.round(Number(m[2]) * 1e5) / 1e5 } : null;
}

/** Full-size uploads linked from the pages (apartments and house first, kite photos next); winter landscapes and thumbnails dropped. */
export function pbImages(htmls: string[]): string[] {
  const all: string[] = [];
  for (const html of htmls) {
    for (const m of html.matchAll(/href="(https:\/\/www\.proboarding\.de\/wp-content\/uploads\/[^"]+?\.(?:jpe?g|png))"/gi)) {
      if (!all.includes(m[1]) && !/-\d+x\d+\.|logo|Winter-|Zollhaus/i.test(m[1])) all.push(m[1]);
    }
  }
  const rank = (u: string) => (/Fewo-Haus/i.test(u) ? 0 : /fewo/i.test(u) ? 1 : /kite/i.test(u) ? 2 : 3);
  return all.map((u, i) => ({ u, i })).sort((a, b) => rank(a.u) - rank(b.u) || a.i - b.i).map(x => x.u);
}

export interface PbPages { fewo: string; apartments: string[]; kite: string; directions: string; years: Record<string, number> }

export function parseProboardingContent(p: PbPages): OfferContent {
  const fewo = pbLines(p.fewo);
  const fewoText = fewo.join('\n');
  const season = fewoText.match(/Saison (20\d{2})\n([^\n]+)/);
  const courses = parsePbCourses(p.kite);
  const centre = pbMapCentre(p.directions);
  const apts = PB_APARTMENTS.map((a, i) => ({ a, html: p.apartments[i], prices: parsePbPrices(p.apartments[i]), facts: pbApartmentFacts(p.apartments[i]) }));
  const year = (slug: string) => p.years[slug] ?? pbSeasonYear(p.fewo);
  const rooms: ContentRoom[] = apts.map(({ a, prices, facts }) => ({
    name: a.unit,
    description: `${facts.size ? `${facts.size} m²` : 'Apartment'} for ${facts.persons ?? '2'} people in the ProBoarding house at Dörpstrat 35, Klein Zicker.`,
    features: [
      ...facts.features,
      ...prices.seasons.map(s => `${year(a.slug) ?? ''} Saison ${s.season} (${s.ranges.map(r => `${String(r.from[1]).padStart(2, '0')}.${String(r.from[0]).padStart(2, '0')}.-${String(r.to[1]).padStart(2, '0')}.${String(r.to[0]).padStart(2, '0')}.`).join(', ')}): EUR ${s.price} per night for ${prices.persons ?? 2} people`.trim()),
      prices.minNights ? `Minimum stay ${prices.minNights} nights` : null,
      prices.newYear ? 'New Year\'s Eve at Saison C prices' : null,
      prices.extraBed ? `Extra bed EUR ${prices.extraBed} per person and night (on request)` : 'No extra bed (child on request)',
      prices.linen ? `Bed linen and towels EUR ${prices.linen} per person` : null,
      prices.cleaning ? `Final cleaning EUR ${prices.cleaning}` : null,
      prices.dog ? `Dog ${prices.dog} per night` : null,
    ].filter((x): x is string => !!x),
  }));
  const nightly = apts.flatMap(x => x.prices.seasons.map(s => s.price));
  const yr = year(PB_APARTMENTS[0].slug);
  const DE_MONTH: Record<string, string> = { März: 'March', April: 'April', Mai: 'May', Juni: 'June', September: 'September', Oktober: 'October', November: 'November' };
  const kiteSeason = season?.[2].match(/^(\d{1,2})\. (\S+) bis (\d{1,2})\. (\S+) (20\d{2})$/);
  const kiteSeasonText = kiteSeason ? `${kiteSeason[1]} ${DE_MONTH[kiteSeason[2]] ?? kiteSeason[2]} to ${kiteSeason[3]} ${DE_MONTH[kiteSeason[4]] ?? kiteSeason[4]} ${kiteSeason[5]}` : null;
  const aptText = apts.map(({ a, facts }) => `${a.unit.replace(/^Apartment \d /, '')} (${facts.size ?? '?'} m², ${facts.persons ?? '?'} people${/Maisonette/.test(facts.text) ? ', maisonette' : ''}${/Balkon/.test(facts.text) ? ' with balcony' : ''})`);

  const summary = [
    'ProBoarding is the kite, windsurf, wing and SUP school at Thiessow / Klein Zicker on the south-eastern tip of Rügen, teaching VDWS courses in the standing-depth water of the Greifswalder Bodden; its station is on the beach about 300 m from the Klein Zicker car park.',
    `The school rents ${apts.length} self-catering apartments in its own house in Klein Zicker, a few metres' walk from the Bodden and about 1.5 km from the Baltic beach at Thiessow: ${aptText.join(', ')}.`,
    nightly.length ? `${yr ? `${yr} prices` : 'Prices'} run from EUR ${Math.min(...nightly)} (November to March) to EUR ${Math.max(...nightly)} (June to mid-September) per apartment and night for 2 people, minimum 3 nights, plus final cleaning, linen and tourist tax${kiteSeasonText ? `; the school's ${season![1]} season ran from ${kiteSeasonText}` : ''}.` : '',
  ].filter(Boolean).join(' ');

  return {
    kind: 'accommodation',
    title: 'ProBoarding Rügen Ferienwohnungen',
    summary,
    continent: 'Europe',
    country: 'Germany',
    region: 'Thiessow, Rügen',
    spot: 'Klein Zicker, Thiessow',
    ...(centre ? { spotCoords: centre } : {}),
    itinerarySpots: [],
    durationDays: null,
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: true,
    equipmentRental: /Materialmiete/i.test(p.kite),
    beginnerFriendly: true,
    includedServices: ['Electricity and water', 'Free parking at the house', 'Free Wi-Fi (fibre)', 'Garden with terrace and barbecue'],
    optionalServices: [...courses, 'Wing, windsurf and SUP courses, SUP rental', 'Individual kite camp (course days + apartment) on request'],
    accommodation: 'holiday apartments in the kite school\'s house',
    mealPlan: 'self_catering',
    languages: ['de'],
    rooms,
    imageUrls: pbImages([p.fewo, ...p.apartments]).slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: PB_FEWO_URL,
    bookingUrl: CONTACT_URL,
    sourceText: [
      `fewo: ${fewo.filter(l => /Klein Zicker|Greifswalder Bodden|Kitesurfschule ProBoarding|Saison 20|Station Thiessow|Stehrevier|300 Meter/i.test(l)).join(' | ')}`,
      ...apts.map(({ a, prices, facts }) => `${a.unit} (${year(a.slug) ?? '?'}): ${facts.text} | ${prices.seasons.map(s => `${s.season} ${s.price} ${s.ranges.map(r => `${r.from.join('/')}-${r.to.join('/')}`).join(',')}`).join('; ')} | min ${prices.minNights} | persons ${prices.persons} | extra bed ${prices.extraBed} | linen ${prices.linen} | cleaning ${prices.cleaning}`),
      `kite courses: ${courses.join('; ')}`,
      `directions map centre: ${centre ? `${centre.lat},${centre.lng}` : '-'}`,
    ].join('\n'),
  };
}

async function fetchYears(ctx: FetchContext): Promise<Record<string, number>> {
  try { return parsePbYears(JSON.parse(await page(PB_DATES_URL, 'application/json'))); }
  catch (e) { ctx.note(`proboarding: WordPress page dates not read (${(e as Error).message}); using the footer season year`); return {}; }
}

export async function fetchPbSlots(ctx: FetchContext, today: string): Promise<Slot[]> {
  const years = await fetchYears(ctx);
  const apts: Array<{ apt: PbApartment; prices: PbPrices; year: number }> = [];
  for (const apt of PB_APARTMENTS) {
    const html = await page(apt.url);
    const prices = parsePbPrices(html);
    if (prices.seasons.length < 3) throw new Error(`proboarding: price list ("<price> € Saison A/B/C …") not found on ${apt.url}`);
    const year = years[apt.slug] ?? pbSeasonYear(html);
    if (!year) throw new Error(`proboarding: no year for the price list of ${apt.url}`);
    apts.push({ apt, prices, year });
  }
  const slots = buildPbSlots(apts, today);
  if (slots.length === 0) ctx.note('proboarding: the printed price list has no band from today on - price on request until the page is updated');
  return slots;
}

export const proboardingFerienwohnungenKleinZicker: OfferAdapter = {
  key: 'proboarding-ferienwohnungen-klein-zicker',
  name: 'ProBoarding Rügen Ferienwohnungen, Klein Zicker',
  kind: 'accommodation',
  disciplines: ['kitesurf', 'wingfoil'],
  operator: {
    name: 'ProBoarding Rügen',
    websiteUrl: SITE,
    rootDomain: 'proboarding.de',
    contactEmail: 'team@proboarding.de',
    phone: '+493830885916',
  },
  url: PB_FEWO_URL,
  slotMethod: 'price_table',
  fetchBudget: 7,
  async fetchContent(ctx) {
    const fewo = await page(PB_FEWO_URL);
    const apartments: string[] = [];
    for (const a of PB_APARTMENTS) apartments.push(await page(a.url));
    const kite = await page(PB_KITE_URL);
    const directions = await page(PB_DIRECTIONS_URL);
    if (!/Kitesurfschule ProBoarding/i.test(fewo)) throw new Error('proboarding: kite school text missing on /fewo/');
    return parseProboardingContent({ fewo, apartments, kite, directions, years: await fetchYears(ctx) });
  },
  fetchSlots: ctx => fetchPbSlots(ctx, todayIso()),
};
