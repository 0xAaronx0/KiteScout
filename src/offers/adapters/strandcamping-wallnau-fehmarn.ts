// ---------------------------------------------------------------------------
// Strandcamping Wallnau (Fehmarn, Germany) - five-star family campsite on the natural beach of Fehmarn's west coast
// ("Sunset Coast"), between two nature reserves. Two independent kite schools sit on the campsite (Kitesplash at the
// rear beach access, Adventure Kite), both with VDWS-licensed instructors; wing courses run at a partner school in
// Orth. Campsite rule: only the rental caravans (Hobby, four lines) and the two mobile-home types are listed.
//
// Data path (checked 2026-10-14), Next.js site strandcamping.de (German):
//   content  / (JSON-LD Campground with geo 54.488 / 11.019), /wassersport (the two kite schools), /mietwohnwagen
//            (caravan lines and equipment), /mobilheim (two mobile-home sizes), /preise-saisonzeiten.
//   slots    /preise-saisonzeiten: the price tabs live in the page's RSC payload (self.__next_f.push strings) as JSON
//            {"label":"Mietobjekt 2026"|"Mietobjekt 2027","seasons":[{"label":"Nebensaison 27","dates":["19.03. – 05.05.2027",
//            …]},{"label":"Hauptsaison 27",…}],"rows":[{"label":"Wohnwagen Komfort 560 UL","sub":"…","cells":[{"main":"ab 2.
//            Nacht 55,- €","note":"1. Nacht 90,- €"},{…high season…}]}]} - per night incl. person fees, electricity, hot
//            water and final cleaning; the first night costs more. Season dates are arrival-to-departure ranges (they
//            share their boundary days), so a band's last night is the day before its end date.
//            Live availability: the site's own booking engine campbuchung.de (Onepage Booking, campsite 10206). Its page
//            /v2/10206/onepage.php carries the rental categories and their units (var jsShare), and the widget asks
//            /v2/10206/api.php anonymously (form POST, action=get_daterange_info, no cookie, CSRF field commented out in
//            core.js) for "blocked_objects": per unit the blocked night ranges. One POST covers today until the end of the
//            last printed season, for all rental categories at once.
// robots.txt (2026-10-14): strandcamping.de "Allow: /" (only /admin disallowed); campbuchung.de/robots.txt is 404.
// Requests per run: content 5, slots 2 (onepage.php + one POST; the prices page is memoised) = 7.
// Parsed: per price-table row (caravan / mobile-home type) and night from today on: season price (the "ab 2. Nacht" main
//   figure) + free units of the matching engine category (units of the category without a blocked range on that night).
//   Runs of equal (season band, availability class) become slots ("wohnwagen-komfort-560-ul|2027-07-04"): EUR per unit
//   and night, available (>= 3 free) / limited (1-2, spotsLeft = fewest free) / sold_out (0); minNights = the engine's
//   category minimum stay for that band, else the printed rule (high season 7 nights, low season 2).
// Known limits: the slot price is the from-the-2nd-night rate; the first night (EUR 35-50 more, final cleaning) is in
//   the room features. Per-night free units ignore arrival-day rules (high season Wednesday / Sunday) and minimum stays,
//   so "available" means a unit is free that night, not that every stay length fits. The engine category
//   "Superiorwohnwagen 650 KMFE" (1 unit) has no row in the printed table and is left out. Long-stay discounts in the
//   low season (10-20 %) are not applied.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, iso, ldOfType, parseAmount, runsOf, todayIso } from '../parse.js';
import type { Availability, ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://strandcamping.de';
export const SCW_HOME_URL = `${SITE}/`;
export const SCW_WATERSPORT_URL = `${SITE}/wassersport`;
export const SCW_CARAVANS_URL = `${SITE}/mietwohnwagen`;
export const SCW_MOBILEHOMES_URL = `${SITE}/mobilheim`;
export const SCW_PRICES_URL = `${SITE}/preise-saisonzeiten`;
const CB = 'https://campbuchung.de/v2/10206';
export const SCW_ONEPAGE_URL = `${CB}/onepage.php`;
export const SCW_API_URL = `${CB}/api.php`;

const memo = new Map<string, { at: number; p: Promise<string> }>();
/** one fetch per page per 10 minutes: fetchContent + fetchSlots in the same run share the prices page */
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

/** Visible text lines (scripts, styles, SVGs dropped), split at block tags. */
export function scwLines(html: string): string[] {
  return html
    .replace(/<(script|style|noscript|svg|head)\b[\s\S]*?<\/\1>/gi, ' ')
    .split(/<\/?(?:p|li|td|th|tr|h\d|div|br|ul|section|figure|header|footer|article|span|a|button)\b[^>]*>/i)
    .map(s => clean(s.replace(/<[^>]+>/g, ' ')))
    .filter(Boolean);
}

const addDays = (d: string, n: number): string => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
export const scwKeyPart = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Index just past the JSON value ({…} / […]) that starts at `i`, honoring strings. */
function endOfJson(src: string, i: number): number {
  let depth = 0;
  for (let k = i; k < src.length; k++) {
    const c = src[k];
    if (c === '"') { for (k++; k < src.length && src[k] !== '"'; k++) if (src[k] === '\\') k++; continue; }
    if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') { depth--; if (depth === 0) return k + 1; }
  }
  return -1;
}

/** The decoded RSC payload of a Next.js page (all self.__next_f.push([1,"…"]) strings joined). */
export function scwFlight(html: string): string {
  let out = '';
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g)) {
    try { out += JSON.parse(`"${m[1]}"`) as string; } catch { /* broken chunk: skip */ }
  }
  return out;
}

export interface ScwSeason { label: string; high: boolean; ranges: Array<{ start: string; end: string }> }
export interface ScwRow { label: string; sub: string | null; cells: Array<{ main: number | null; first: number | null }> }
export interface ScwTable { year: number; seasons: ScwSeason[]; rows: ScwRow[]; note: string | null }

/** "27.03. – 13.05.2026" -> arrival 2026-03-27, departure 2026-05-13. */
function scwRange(s: string): { start: string; end: string } | null {
  const m = s.replace(/\s/g, '').match(/^(\d{1,2})\.(\d{1,2})\.(?:(\d{4}))?[–-](\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!m) return null;
  const y2 = +m[6];
  const y1 = m[3] ? +m[3] : (+m[2] > +m[5] ? y2 - 1 : y2);
  return { start: iso(y1, +m[2], +m[1]), end: iso(y2, +m[5], +m[4]) };
}

/** Rental price tabs ("Mietobjekt YYYY") of /preise-saisonzeiten. */
export function parseScwTables(html: string): ScwTable[] {
  const flight = scwFlight(html);
  const out: ScwTable[] = [];
  for (const m of flight.matchAll(/\{"label":"Mietobjekt (20\d{2})"/g)) {
    const end = endOfJson(flight, m.index!);
    if (end < 0) continue;
    let o: { seasons?: Array<{ label?: string; dates?: string[] }>; rows?: Array<{ label?: string; sub?: string; cells?: Array<{ main?: string; note?: string }> }>; note?: string };
    try { o = JSON.parse(flight.slice(m.index!, end)); } catch { continue; }
    const year = Number(m[1]);
    if (out.some(t => t.year === year)) continue;
    const seasons: ScwSeason[] = (o.seasons ?? []).map(s => ({
      label: String(s.label ?? ''),
      high: /hauptsaison/i.test(String(s.label ?? '')),
      ranges: (s.dates ?? []).map(scwRange).filter((x): x is { start: string; end: string } => !!x),
    }));
    const rows: ScwRow[] = (o.rows ?? []).map(r => ({
      label: clean(String(r.label ?? '')),
      sub: r.sub ? clean(r.sub) : null,
      cells: (r.cells ?? []).map(c => ({ main: parseAmount(String(c.main ?? '').replace(/^ab \d+\. Nacht/, '')), first: parseAmount(String(c.note ?? '').replace(/^\d+\. Nacht/, '')) })),
    }));
    if (seasons.length && rows.length) out.push({ year, seasons, rows, note: o.note ? clean(o.note) : null });
  }
  return out.sort((a, b) => a.year - b.year);
}

/** Minimum-stay rule printed under the table ("In der Hauptsaison gilt für Mietobjekte ein Mindestaufenthalt von sieben Nächten … In der Nebensaison sind es zwei Nächte"). */
export function parseScwMinStay(html: string): { high: number | null; low: number | null } {
  const t = scwLines(html).join(' ');
  const words: Record<string, number> = { zwei: 2, drei: 3, vier: 4, fünf: 5, sechs: 6, sieben: 7 };
  const num = (s: string | undefined) => (s ? words[s.toLowerCase()] ?? (Number(s) || null) : null);
  return {
    high: num(t.match(/Hauptsaison gilt für Mietobjekte ein Mindestaufenthalt von (\w+) Nächten/)?.[1]),
    low: num(t.match(/In der Nebensaison sind es (\w+) Nächte/)?.[1]),
  };
}

// --- campbuchung.de (Onepage Booking) --------------------------------------------------------------
export interface ScwEngine {
  /** rental category id -> label */
  categories: Map<string, string>;
  /** rental category id -> unit (object) ids */
  objects: Map<string, string[]>;
  guestIds: string[];
}

/** `var jsShare = {…};` of onepage.php: rental categories and their units. */
export function parseScwEngine(html: string): ScwEngine {
  const i = html.indexOf('var jsShare = ');
  if (i < 0) throw new Error('strandcamping-wallnau: jsShare missing on onepage.php');
  const start = html.indexOf('{', i);
  const d = JSON.parse(html.slice(start, endOfJson(html, start))) as {
    object_categories?: Record<string, { id: string; label: string; accommodation: string }>;
    objects?: Record<string, { id: number | string; category_id: number | string }>;
    guest_categories?: Record<string, unknown>;
  };
  const categories = new Map<string, string>();
  for (const c of Object.values(d.object_categories ?? {})) if (c.accommodation === 'rental') categories.set(String(c.id), clean(c.label));
  const objects = new Map<string, string[]>();
  for (const o of Object.values(d.objects ?? {})) {
    const cat = String(o.category_id);
    if (!categories.has(cat)) continue;
    objects.set(cat, [...(objects.get(cat) ?? []), String(o.id)]);
  }
  return { categories, objects, guestIds: Object.keys(d.guest_categories ?? {}) };
}

/** Form body of the widget's get_daterange_info call (jQuery serialisation of {action, data:{…}}). */
export function scwRangeBody(engine: ScwEngine, start: string, end: string): string {
  const p = new URLSearchParams();
  p.append('action', 'get_daterange_info');
  p.append('data[start_date]', start);
  p.append('data[end_date]', end);
  for (const g of engine.guestIds) p.append(`data[guest_data][${g}]`, g === 'nadults' ? '2' : '0');
  for (const c of engine.categories.keys()) p.append('data[categories][]', c);
  return p.toString();
}

export interface ScwBlocks {
  /** unit id -> blocked night ranges (inclusive) */
  blocked: Map<string, Array<{ s: string; e: string }>>;
  /** category id -> minimum stays [{n, s, e}] */
  minStay: Map<string, Array<{ n: number; s: string; e: string }>>;
}

export function parseScwBlocks(json: string): ScwBlocks {
  const d = JSON.parse(json) as { rslt?: boolean; data?: { blocked_objects?: Record<string, { blocked_dates?: Array<{ s: string; e: string }> }>; min_max_stay?: { cat_min?: Record<string, Array<{ n: number; s: string; e: string }>> } } };
  if (!d.rslt || !d.data) throw new Error('strandcamping-wallnau: get_daterange_info answered without rslt / data');
  const blocked = new Map<string, Array<{ s: string; e: string }>>();
  for (const [id, b] of Object.entries(d.data.blocked_objects ?? {})) blocked.set(id, (b.blocked_dates ?? []).map(x => ({ s: x.s, e: x.e })));
  const minStay = new Map<string, Array<{ n: number; s: string; e: string }>>();
  for (const [id, l] of Object.entries(d.data.min_max_stay?.cat_min ?? {})) minStay.set(id, (l ?? []).map(x => ({ n: Number(x.n), s: x.s, e: x.e })));
  return { blocked, minStay };
}

/** "Wohnwagen Hund 560 UL" / "Hundewohnwagen 560 UL" -> "560 hund ul wohnwagen" (word set, order-free). */
export function scwMatchKey(label: string): string {
  return label.toLowerCase().replace(/\(.*?\)/g, ' ').replace(/(komfort|superior|luxus|hunde?)wohnwagen/g, '$1 wohnwagen').replace(/\bhunde\b/g, 'hund')
    .split(/[^a-z0-9&äöü]+/).filter(Boolean).sort().join(' ');
}

const UNIT_NAMES: Array<[RegExp, string]> = [
  [/^Wohnwagen Komfort (.+)$/, 'Comfort caravan Hobby $1'],
  [/^Wohnwagen Superior (.+)$/, 'Superior caravan Hobby $1'],
  [/^Wohnwagen Luxus (.+)$/, 'Luxury caravan Hobby $1 (own shower)'],
  [/^Wohnwagen Hund (.+)$/, 'Dog-friendly caravan Hobby $1'],
  [/^Mobilheim (.+)$/, 'Mobile home "$1"'],
];
export function scwUnitName(label: string): string {
  for (const [re, to] of UNIT_NAMES) if (re.test(label)) return label.replace(re, to);
  return label;
}

const BED_WORDS: Array<[RegExp, string]> = [
  [/Doppelbetten/g, 'double beds'], [/Doppelbett/g, 'double bed'], [/Einzelbetten/g, 'single beds'], [/Einzelbett/g, 'single bed'], [/Kinder-Stockbetten/g, "children's bunk beds"],
  [/Kinderbett/g, 'child bed'], [/eigenes Bad im Vorzelt/g, 'own bathroom in the awning'], [/eigenes Bad/g, 'own bathroom'],
  [/(?:max\. 1|ein) Familienhund(?: inkl\.| inklusive)?/g, 'one family dog included'], [/max\. (\d) Personen/g, 'max. $1 persons'],
  [/\bzwei\b/gi, 'two'], [/\bund\b/g, 'and'], [/&/g, 'and'],
];
export function scwBeds(sub: string | null): string | null {
  if (!sub) return null;
  let s = sub;
  for (const [re, to] of BED_WORDS) s = s.replace(re, to);
  return s;
}

/**
 * Slots: for each row of the newest tables and each night from today, the season price + free units of the matching
 * engine category; runs of equal (band, availability class) become slots.
 */
export function buildScwSlots(tables: ScwTable[], engine: ScwEngine, blocks: ScwBlocks, today: string, rule: { high: number | null; low: number | null }, ctx?: Pick<FetchContext, 'note'>): Slot[] {
  const byKey = new Map<string, string>();
  for (const [id, label] of engine.categories) byKey.set(scwMatchKey(label), id);
  const used = new Set<string>();
  const out: Slot[] = [];
  const rowLabels = [...new Set(tables.flatMap(t => t.rows.map(r => r.label)))];
  for (const label of rowLabels) {
    const cat = byKey.get(scwMatchKey(label)) ?? null;
    if (cat) used.add(cat);
    const units = cat ? engine.objects.get(cat) ?? [] : [];
    type Night = { date: string; band: string; price: number | null; high: boolean; free: number | null; min: number | null };
    const nights: Night[] = [];
    for (const t of tables) {
      const row = t.rows.find(r => r.label === label);
      if (!row) continue;
      t.seasons.forEach((s, si) => {
        const price = row.cells[si]?.main ?? null;
        for (const r of s.ranges) {
          const lastNight = addDays(r.end, -1);
          for (let d = r.start < today ? today : r.start; d <= lastNight; d = addDays(d, 1)) {
            const free = cat ? units.filter(u => !(blocks.blocked.get(u) ?? []).some(b => b.s <= d && d <= b.e)).length : null;
            const engineMin = cat ? (blocks.minStay.get(cat) ?? []).find(x => x.s <= d && d < x.e)?.n ?? null : null;
            nights.push({ date: d, band: `${r.start}`, price, high: s.high, free, min: engineMin ?? (s.high ? rule.high : rule.low) });
          }
        }
      });
    }
    nights.sort((a, b) => a.date.localeCompare(b.date));
    const cls = (n: Night): Availability => n.free === null ? 'unknown' : n.free === 0 ? 'sold_out' : n.free <= 2 ? 'limited' : 'available';
    for (const run of runsOf(nights, n => `${n.band}|${n.price}|${n.min}|${cls(n)}`)) {
      const f = run.first;
      const minFree = f.free === null ? null : Math.min(...run.days.map(n => n.free ?? 0));
      out.push({
        key: `${scwKeyPart(label)}|${run.start}`,
        startDate: run.start,
        endDate: run.end,
        unit: scwUnitName(label),
        price: f.price,
        currency: f.price !== null ? 'EUR' : null,
        priceUnit: f.price !== null ? 'per_night' : null,
        priceBasis: 'room',
        occupancy: null,
        availability: cls(f),
        availabilityText: minFree === null ? null : minFree === 0 ? `no unit free (${units.length} in this category)` : `${minFree} of ${units.length} free every night`,
        spotsLeft: minFree,
        minNights: f.min,
      });
    }
  }
  const unpriced = [...engine.categories].filter(([id]) => !used.has(id)).map(([, l]) => l);
  if (unpriced.length && ctx) ctx.note(`strandcamping-wallnau: engine categories without a printed price row, left out: ${unpriced.join(', ')}`);
  return out;
}

/** Content photos: /_next/image?url=%2Fimages%2F… -> /images/…; navigation tiles, floor plans, awards, logos dropped. */
export function scwImages(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/\/_next\/image\?url=(%2Fimages%2F[^&"]+)/g)) {
    const path = decodeURIComponent(m[1]);
    if (!/\.jpe?g$/i.test(path) || /reitstunde|entspannung|strandcamping-app|stellplatz|grundriss|logo|award|alpaka|ausritt|animation|ostseetaufe|reit/i.test(path)) continue;
    const u = `${SITE}${path}`;
    if (!out.includes(u)) out.push(u);
  }
  return out;
}

export interface ScwPages { home: string; watersport: string; caravans: string; mobilehomes: string; prices: string }

export function parseWallnauContent(p: ScwPages): OfferContent {
  const water = scwLines(p.watersport);
  const tables = parseScwTables(p.prices);
  const rule = parseScwMinStay(p.prices);
  const camp = ldOfType(p.home, 'Campground')[0] ?? null;
  const geo = (camp?.geo ?? null) as { latitude?: number; longitude?: number } | null;
  const latest = tables[tables.length - 1] ?? null;
  const schools = water.filter(l => /^(Kitesplash|Adventure Kite)$/.test(l));
  const twoSchools = water.find(l => /Zwei Surfschulen sitzen direkt auf dem Campingplatz/.test(l)) ?? null;
  const kiteCourse = water.find(l => /^Anfängerkurse für alle, die zum ersten Mal am Lenkdrachen stehen/.test(l)) ?? null;
  const mains = latest ? latest.rows.flatMap(r => r.cells.map(c => c.main)).filter((x): x is number => x !== null) : [];
  const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const span = latest ? { start: latest.seasons.flatMap(s => s.ranges.map(r => r.start)).sort()[0], end: latest.seasons.flatMap(s => s.ranges.map(r => r.end)).sort().reverse()[0] } : null;

  const rooms: ContentRoom[] = (latest?.rows ?? []).map(r => ({
    name: scwUnitName(r.label),
    description: scwBeds(r.sub),
    features: tables.flatMap(t => {
      const row = t.rows.find(x => x.label === r.label);
      if (!row) return [];
      return t.seasons.map((s, i) => {
        const c = row.cells[i];
        return c?.main ? `${t.year} ${s.high ? 'high' : 'low'} season: EUR ${c.main} per night from the 2nd night${c.first ? `, first night EUR ${c.first}` : ''}` : null;
      }).filter((x): x is string => !!x);
    }).concat(/Mobilheim/.test(r.label)
      ? ['Kitchen, own bathroom with shower and separate WC; no pets']
      : ['Fixed awning with floor, built-in kitchen and large fridge, TV, porcelain WC; electricity and hot water included']),
  }));

  const imgs: string[] = [];
  const kiteFirst = (l: string[]) => [...l.filter(u => /kite/i.test(u)), ...l.filter(u => !/kite/i.test(u))];
  for (const u of [...kiteFirst(scwImages(p.watersport)), ...scwImages(p.caravans), ...scwImages(p.mobilehomes), ...scwImages(p.home)]) if (!imgs.includes(u)) imgs.push(u);

  const summary = [
    `Strandcamping Wallnau is a five-star family campsite directly on the natural beach of Fehmarn's west coast in Germany, between two nature reserves${span ? `; the ${latest!.year} season runs from ${fmt(span.start)} to ${fmt(span.end)}` : ''}.`,
    `Besides pitches it rents Hobby caravans in four lines (comfort, superior, luxury with own shower, dog-friendly), all with a fixed awning, and two mobile-home sizes for 4 or 6 people${mains.length ? `, from EUR ${Math.min(...mains)} to EUR ${Math.max(...mains)} per unit and night from the second night, including person fees, electricity, hot water and final cleaning` : ''}${rule.high ? `; in the high season the minimum stay is ${rule.high} nights` : ''}.`,
    `Two independent kite schools with VDWS-licensed instructors work on the campsite (${schools.length ? schools.join(' and ') : 'Kitesplash and Adventure Kite'}), with beginner and advanced courses and equipment rental; the west coast offers onshore wind and flat water.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Strandcamping Wallnau',
    summary,
    continent: 'Europe',
    country: 'Germany',
    region: 'Wallnau, Fehmarn',
    spot: 'Wallnau',
    // JSON-LD Campground "geo" on the home page (54.488, 11.019 on 2026-10-14)
    spotCoords: geo && Number.isFinite(Number(geo.latitude)) && Number.isFinite(Number(geo.longitude)) ? { lat: Number(geo.latitude), lng: Number(geo.longitude) } : null,
    spotCoordsPrecise: true,
    itinerarySpots: [],
    durationDays: null,
    // water sports page: "Anfängerkurse … und Fortgeschrittenenkurse zum Weiterkommen"
    skillLevels: ['beginner', 'intermediate'],
    kiteLessons: kiteCourse || schools.length ? true : null,
    equipmentRental: water.some(l => /Ausrüstung kannst du aber auch vor Ort leihen/.test(l)) ? true : null,
    beginnerFriendly: true,
    includedServices: ['Electricity, hot water and final cleaning in the rental price', 'Wi-Fi', 'Kids club, sports programme and evening events'],
    optionalServices: ['Bed linen (EUR 12 per set)', 'Kite, windsurf, wing and SUP courses and rental at the schools on site', 'Tourist tax (Kurabgabe)', 'Restaurant and self-service shop', 'Physiotherapy, massages and beach sauna'],
    accommodation: 'rental caravans and mobile homes on a beach campsite',
    mealPlan: 'self_catering',
    languages: ['de', 'en', 'nl', 'fr'],
    rooms,
    imageUrls: imgs.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: SCW_WATERSPORT_URL,
    bookingUrl: SCW_ONEPAGE_URL,
    sourceText: [
      `water sports: ${twoSchools ?? ''} | schools: ${schools.join(', ')} | kite: ${kiteCourse ?? ''}`,
      `rules: high season min ${rule.high ?? '-'} nights, low season min ${rule.low ?? '-'} nights`,
      ...tables.map(t => `Mietobjekt ${t.year}: ${t.seasons.map(s => `${s.label} ${s.ranges.map(r => `${r.start}..${r.end}`).join(',')}`).join('; ')} | ${t.rows.map(r => `${r.label} ${r.cells.map(c => `${c.first ?? '-'}/${c.main ?? '-'}`).join(' ')}`).join('; ')}`),
    ].join('\n'),
  };
}

export async function fetchScwSlots(today: string, ctx: FetchContext): Promise<Slot[]> {
  const pricesHtml = await page(SCW_PRICES_URL);
  const tables = parseScwTables(pricesHtml).filter(t => t.seasons.some(s => s.ranges.some(r => r.end > today)));
  if (tables.length === 0) {
    if (parseScwTables(pricesHtml).length === 0) throw new Error('strandcamping-wallnau: no "Mietobjekt YYYY" price tab in the page payload (layout changed?)');
    ctx.note('strandcamping-wallnau: every printed rental season has ended; waiting for the next price list');
    return [];
  }
  const engine = parseScwEngine(await fetchText(SCW_ONEPAGE_URL, { accept: 'text/html' }));
  if (engine.categories.size === 0) throw new Error('strandcamping-wallnau: no rental categories in jsShare');
  const end = tables.flatMap(t => t.seasons.flatMap(s => s.ranges.map(r => r.end))).sort().reverse()[0];
  const json = await fetchText(SCW_API_URL, {
    method: 'POST',
    body: scwRangeBody(engine, today, end),
    contentType: 'application/x-www-form-urlencoded; charset=UTF-8',
    accept: 'application/json, text/javascript, */*; q=0.01',
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
  });
  return buildScwSlots(tables, engine, parseScwBlocks(json), today, parseScwMinStay(pricesHtml), ctx);
}

export const strandcampingWallnauFehmarn: OfferAdapter = {
  key: 'strandcamping-wallnau-fehmarn',
  name: 'Strandcamping Wallnau Fehmarn',
  kind: 'accommodation',
  operator: {
    name: 'Strandcamping Wallnau',
    websiteUrl: SITE,
    rootDomain: 'strandcamping.de',
    contactEmail: 'wallnau@strandcamping.de',
    phone: '+494372456',
  },
  url: SCW_WATERSPORT_URL,
  slotMethod: 'booking_engine',
  instantBooking: true,
  liveAvailability: true,
  fetchBudget: 8,
  async fetchContent() {
    const home = await page(SCW_HOME_URL);
    const watersport = await page(SCW_WATERSPORT_URL);
    const caravans = await page(SCW_CARAVANS_URL);
    const mobilehomes = await page(SCW_MOBILEHOMES_URL);
    const prices = await page(SCW_PRICES_URL);
    if (!/Kitesplash|Adventure Kite/.test(watersport)) throw new Error('strandcamping-wallnau: kite schools missing on /wassersport (kite link gone?)');
    return parseWallnauContent({ home, watersport, caravans, mobilehomes, prices });
  },
  async fetchSlots(ctx) {
    return fetchScwSlots(todayIso(), ctx);
  },
};
