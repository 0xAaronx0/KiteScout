// ---------------------------------------------------------------------------
// Camping Strukkamphuk, Fehmarnsund (Fehmarn, Germany) - large campsite on the south-west tip of Fehmarn by the
// Strukkamphuk lighthouse and the Fehmarnsund bridge, on the Orther Reede (mostly standing depth). A kitesurf school and
// a sailing / windsurf school (both with SUP rental and wing courses) are on the campsite. Campsite rule: only the 22
// rental caravans are listed, never the pitches.
//
// Data path (checked 2026-10-14), WordPress / Divi site strukkamphuk.de (German):
//   content  / (kite school sentence, Google-Maps directions link with the coordinates), /mietwohnwagen/ (caravan models:
//            "<Make> mit Standvorzelt (Typ 580 QS)" + "Mietwohnwagen 1 – 4" + layout + berths), /angebote-preise/
//            (2026 season bands "Hauptsaison 13.05. – 26.05.26 …", "Preise Mietwohnwagen": per model "123 € / 85 €"
//            high / low season per night incl. camping fees, electricity and gas, final cleaning EUR 50 or 60 extra,
//            and the 7- to 28-night package offers), /sport-spass/ (Orther Reede, the two schools on site).
//   slots    Compusoft online booking (the site's "Jetzt buchen" / "Wohnwagen mieten" buttons open csobV2 with portal key
//            389e16fb-…), through the shared helpers of hvide-sande-camping.ts: per sample week the widget's anonymous
//            profile list + one price call. One Saturday-to-Saturday week per month inside the published seasons (the
//            season bands of /angebote-preise/, merged per year), max 9 within 12 months.
// robots.txt (2026-10-14): strukkamphuk.de "Disallow:" (empty, allows all); v3.onlinebooking.dk "Allow: /".
// Requests per run: content 4, slots 1 (prices page, memoised) + up to 2 per sample week = max 22.
// Parsed: slot = caravan profile x sample week ("mietwohnwagen-knaus-sport-580-qs|2027-06-05"), EUR per caravan for
//   7 nights incl. final cleaning as quoted by the engine (priceUnit 'package', packageNights 7, priceBasis 'room');
//   available / limited (1-2 free) / sold_out. The engine's package-offer caravan profiles ("Angebot Herbstliebe
//   Mietwohnwagen 1-4, 17-20 7 Nächte", family offers for 2 adults + children) are kept as their own units - on
//   2026-10-14 the only free caravan in the last 2026 season week was such an offer (EUR 586 = printed 536 + 50
//   cleaning). Caravan types free in none of the sampled weeks are left out (not "sold out").
// Known limits: the 2026 season ends 25.10.2026 and the engine had no 2027 stays on 2026-10-14 (every profile 0 on
//   05.06.2027), so after that week the offer shows "price on request" until the 2027 bands are printed. The printed
//   2026 per-night table goes into the room features only.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, iso, parseAmount, todayIso } from '../parse.js';
import type { ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';
import { csobSaturdaySamples, csobSlots, fetchCsobSamples, type CsobPortal } from './hvide-sande-camping.js';

const SITE = 'https://strukkamphuk.de';
export const CSK_HOME_URL = `${SITE}/`;
export const CSK_CARAVANS_URL = `${SITE}/mietwohnwagen/`;
export const CSK_PRICES_URL = `${SITE}/angebote-preise/`;
export const CSK_SPORT_URL = `${SITE}/sport-spass/`;
export const CSK_PORTAL: CsobPortal = {
  portalKey: '389e16fb-e3b7-404f-8865-23115c0b5773',
  language: 'de',
  currency: 'EUR',
  // "Mietwohnwagen …" (one profile is spelled "Miewohnwagen") and the caravan package offers; pitches ("Stellplatz…") out
  isUnit: p => /mie?t?wohnwagen/i.test(p.title),
};

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
export function cskLines(html: string): string[] {
  return html
    .replace(/<(script|style|noscript|svg|head)\b[\s\S]*?<\/\1>/gi, ' ')
    .split(/<\/?(?:p|li|td|th|tr|h\d|div|br|ul|section|figure|header|footer|article|button)\b[^>]*>/i)
    .map(s => clean(s.replace(/<[^>]+>/g, ' ')))
    .filter(Boolean);
}

export interface CskBand { season: 'high' | 'low'; start: string; end: string }

/** Season bands of /angebote-preise/: "Hauptsaison" / "Nebensaison" followed by "13.05. – 26.05.26" lines. */
export function parseCskBands(html: string): CskBand[] {
  const out: CskBand[] = [];
  let season: CskBand['season'] | null = null;
  for (const l of cskLines(html)) {
    if (/^Hauptsaison$/.test(l)) { season = 'high'; continue; }
    if (/^Nebensaison$/.test(l)) { season = 'low'; continue; }
    const m = l.match(/^(\d{1,2})\.(\d{1,2})\.\s*[–-]\s*(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/);
    if (season && m) {
      const y = m[5].length === 2 ? 2000 + Number(m[5]) : Number(m[5]);
      out.push({ season, start: iso(y, +m[2], +m[1]), end: iso(y, +m[4], +m[3]) });
      continue;
    }
    if (season && out.length) season = null; // the band list ended
  }
  return out;
}

/** Bands merged per year into the open season (first arrival to last departure). */
export function cskSeasons(bands: CskBand[]): Array<{ start: string; end: string }> {
  const byYear = new Map<string, { start: string; end: string }>();
  for (const b of bands) {
    const y = b.start.slice(0, 4);
    const s = byYear.get(y);
    byYear.set(y, s ? { start: b.start < s.start ? b.start : s.start, end: b.end > s.end ? b.end : s.end } : { start: b.start, end: b.end });
  }
  return [...byYear.values()].sort((a, b) => a.start.localeCompare(b.start));
}

export interface CskPrice { model: string; high: number; low: number; note: string | null; numbers: number[] }

/** "Kategorie 1 - 4" / "Nr. 6+7, 12-14" / "1 – 4" / "24, 27 & 28" -> caravan numbers. */
export function cskNumbers(s: string): number[] {
  const out: number[] = [];
  for (const m of s.replace(/–/g, '-').matchAll(/(\d+)\s*(?:-\s*(\d+))?/g)) {
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    for (let n = a; n <= b && n - a < 40; n++) if (!out.includes(n)) out.push(n);
  }
  return out;
}

/** "Preise Mietwohnwagen": name, "123 € / 85 €", "mit Standvorzelt (Nr. 6+7, 12-14)" triples. */
export function parseCskPrices(html: string): { rows: CskPrice[]; cleaning: string | null; year: number | null } {
  const l = cskLines(html);
  const i = l.findIndex(x => /^Preise Mietwohnwagen$/.test(x));
  const rows: CskPrice[] = [];
  if (i < 0) return { rows, cleaning: null, year: null };
  for (let k = i + 1; k < l.length && !/^Informationen zu unseren Mietwohnwagen/.test(l[k]); k++) {
    const pr = l[k + 1]?.match(/^(\d+(?:,\d+)?)\s*€\s*\/\s*(\d+(?:,\d+)?)\s*€$/);
    if (!pr || /^Preis /.test(l[k])) continue;
    const note = l[k + 2] && !/€/.test(l[k + 2]) ? l[k + 2] : null;
    const nr = note?.match(/\(Nr\.\s*([^)]+)\)/)?.[1] ?? '';
    rows.push({ model: l[k], high: parseAmount(pr[1])!, low: parseAmount(pr[2])!, note, numbers: nr ? cskNumbers(nr) : [] });
  }
  const cleaning = l.slice(i).find(x => /^Endreinigung/.test(x)) ?? null;
  const year = Number(parseCskBands(html)[0]?.start.slice(0, 4) ?? NaN) || null;
  return { rows, cleaning, year };
}

export interface CskCaravan { name: string; numbers: number[]; numbersText: string; lines: string[] }

/** Model blocks of /mietwohnwagen/: "Knaus Sport mit Standvorzelt (Typ 580 QS)" / "Deluxe-Wohnwagen für 4" + "Mietwohnwagen 1 – 4". */
export function parseCskCaravans(html: string): CskCaravan[] {
  const l = cskLines(html);
  const out: CskCaravan[] = [];
  let cur: CskCaravan | null = null;
  for (let k = 0; k < l.length; k++) {
    const nos = l[k + 1]?.match(/^Mietwohnwagen\s+([\d\s,–&-]+)$/);
    const head = l[k].match(/^(.+?) mit Standvorzelt \(Typ ([^)]+)\)$/) ?? l[k].match(/^(Deluxe-Wohnwagen für \d)$/);
    if (head && nos) {
      cur = { name: head[2] ? `${head[1]} ${head[2]}` : head[1], numbers: cskNumbers(nos[1]), numbersText: nos[1].trim().replace(/\s+,/g, ',').replace(/\s*[–-]\s*/g, '-').replace(/\s*&\s*/g, ' and '), lines: [] };
      out.push(cur);
      k++;
      continue;
    }
    if (cur && /^Buche jetzt|^Jetzt buchen|^Wir freuen uns auf dich/.test(l[k])) { cur = null; continue; }
    if (cur && cur.lines.length < 3) cur.lines.push(l[k]);
  }
  return out;
}

/** "Schlafplätze für 5 Personen (2 Erwachsene und 3 Kinder)." -> "5 (2 adults and 3 children)"; Deluxe "für 4" -> "4". */
function berths(c: CskCaravan): string | null {
  const m = c.lines.join(' ').match(/Schlafpl\S+ für (\d) Personen(?: \((\d) Erwachsene und (\d) Kinder\))?/);
  if (m) return m[2] ? `${m[1]} (${m[2]} adults and ${m[3]} children)` : m[1];
  return c.name.match(/für (\d)$/)?.[1] ?? null;
}

function priceFor(c: CskCaravan, rows: CskPrice[]): CskPrice | null {
  if (/deluxe/i.test(c.name)) return rows.find(r => /deluxe/i.test(r.model)) ?? null;
  return rows.find(r => r.numbers.length && r.numbers.some(n => c.numbers.includes(n))) ?? null;
}

/** Original photos of a page (WordPress uploads without -WxH), icons / logos / floor-plan PNGs dropped. */
export function cskImages(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/https:\/\/strukkamphuk\.de\/wp-content\/uploads\/[^"'\s,)]+\.(?:jpe?g|webp)/gi)) {
    const u = m[0].replace(/-\d{2,4}x\d{2,4}(?=\.[a-z]+$)/i, '');
    if (/icon|logo|lageplan|siegel|award|camping-info|pincamp|adac/i.test(u)) continue;
    // "-scaled" (WordPress 2560 px copy) and the plain upload are the same photo: keep the first one seen
    const k = u.replace(/-scaled(?=\.[a-z]+$)/i, '');
    if (!out.some(x => x.replace(/-scaled(?=\.[a-z]+$)/i, '') === k)) out.push(u);
  }
  return out;
}

/** English unit names for the engine's German profile titles. */
export function cskUnitName(title: string): string {
  const offer = title.match(/^Angebot (.+?) Mie?t?wohnwagen ([\d,\s-]+?) (\d+) Nächte$/);
  if (offer) return `Rental caravan no. ${offer[2].trim()} (${offer[1]} offer, ${offer[3]} nights)`;
  return title.replace(/^Mie?t?wohnwagen /, 'Rental caravan ').replace(/ für (\d)$/, ' for $1').replace(/´/g, "'");
}

export interface CskPages { home: string; caravans: string; prices: string; sport: string }

export function parseStrukkamphukContent(p: CskPages): OfferContent {
  const home = cskLines(p.home);
  const sport = cskLines(p.sport);
  const caravans = parseCskCaravans(p.caravans);
  const { rows, cleaning, year } = parseCskPrices(p.prices);
  const seasons = cskSeasons(parseCskBands(p.prices));
  const coords = p.home.match(/!1d(\d{1,3}\.\d+)!2d(\d{1,2}\.\d+)/);
  const kiteLine = sport.find(l => /Kitesurf-Schule/.test(l)) ?? home.find(l => /Kitesurf-Schule/.test(l)) ?? null;
  const intro = home.find(l => /Südwesten der Sonneninsel Fehmarn/.test(l)) ?? null;
  const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const units = caravans.reduce((n, c) => n + c.numbers.length, 0);
  const lows = rows.map(r => r.low);
  const highs = rows.map(r => r.high);

  const rooms: ContentRoom[] = caravans.map(c => {
    const pr = priceFor(c, rows);
    return {
      name: `Rental caravan ${c.name.replace(/^Deluxe-Wohnwagen für (\d)$/, 'Deluxe for $1')}`,
      description: `Caravans no. ${c.numbersText} with a fixed awning (kitchen unit and seating) and terrace${berths(c) ? `; sleeps ${berths(c)}` : ''}.`,
      features: [
        ...(pr ? [`${year ?? ''} per night: high season EUR ${pr.high}, low season EUR ${pr.low} (incl. camping fees, electricity and gas)`.trim()] : []),
        ...(cleaning ? [`Final cleaning extra: EUR ${[...cleaning.matchAll(/(\d+(?:,\d+)?)\s*€/g)].map(m => parseAmount(m[1])).join(' or ')}`] : []),
        'Toilet, TV and radio, gas heating, parking at the caravan; non-smoking, no pets',
      ],
    };
  });

  const imgs: string[] = [];
  for (const u of [...cskImages(p.caravans), ...cskImages(p.sport), ...cskImages(p.home)]) if (!imgs.includes(u)) imgs.push(u);

  const season = seasons.filter(s => s.end >= todayIso()).sort((a, b) => a.start.localeCompare(b.start))[0] ?? seasons[seasons.length - 1];
  const summary = [
    `Camping Strukkamphuk is a large campsite on the south-west tip of Fehmarn, Germany, between the Strukkamphuk lighthouse and the Fehmarnsund bridge, with a natural beach behind the dyke${season ? `; the ${season.start.slice(0, 4)} season runs from ${fmt(season.start)} to ${fmt(season.end)}` : ''}.`,
    `Besides pitches it rents ${units || 22} fully equipped caravans with fixed awnings for up to 4 or 5 people${lows.length ? `, priced in ${year ?? 'the current year'} from EUR ${Math.min(...lows)} (low season) to EUR ${Math.max(...highs)} (high season) per caravan and night including camping fees, electricity and gas, plus final cleaning` : ''}.`,
    'The water in front is part of the Orther Reede, mostly standing depth and suited to all levels; a kitesurf school and a sailing and windsurf school are on the campsite, both with SUP rental and wing courses.',
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Camping Strukkamphuk',
    summary,
    continent: 'Europe',
    country: 'Germany',
    region: 'Fehmarnsund, Fehmarn',
    spot: 'Strukkamphuk',
    // Google-Maps directions link on the home page (".../@54.411847,11.098098,15z/...!1d11.098098!2d54.411847")
    spotCoords: coords ? { lat: Number(coords[2]), lng: Number(coords[1]) } : null,
    itinerarySpots: [],
    durationDays: null,
    // sport page: "perfekt für jedes Level wie Anfänger, Aufsteiger, aber auch erfahrene Surfer"
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: kiteLine ? true : null,
    equipmentRental: sport.some(l => /Materialverleih|SUP-Verleih/.test(l)) || home.some(l => /Materialverleih/.test(l)) ? true : null,
    beginnerFriendly: true,
    includedServices: ['Camping fees, electricity and gas in the caravan price', 'Free Wi-Fi', 'Fitness room', 'Surfer shower for wetsuits'],
    optionalServices: ['Final cleaning (EUR 50 or 60)', 'Kite, windsurf, wing and SUP lessons and rental at the schools on site', 'Sauna and massage', 'Restaurant, beach bar and supermarket on site', 'Ostseecard (tourist tax)'],
    accommodation: 'rental caravans with fixed awnings on a beach campsite',
    mealPlan: 'self_catering',
    languages: ['de', 'en'],
    rooms,
    imageUrls: imgs.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: CSK_CARAVANS_URL,
    bookingUrl: CSK_CARAVANS_URL,
    sourceText: [
      `home: ${intro ?? ''}`,
      `water sports: ${kiteLine ?? ''}`,
      `season bands: ${parseCskBands(p.prices).map(b => `${b.season} ${b.start}..${b.end}`).join('; ')}`,
      `caravans: ${caravans.map(c => `${c.name} (no. ${c.numbersText}): ${c.lines.join(' ')}`).join(' | ')}`,
      `caravan prices ${year ?? ''}: ${rows.map(r => `${r.model} ${r.high}/${r.low}${r.note ? ` ${r.note}` : ''}`).join('; ')}${cleaning ? ` | ${cleaning}` : ''}`,
    ].join('\n'),
  };
}

export async function fetchCskSlots(today: string, ctx: FetchContext): Promise<Slot[]> {
  const seasons = cskSeasons(parseCskBands(await page(CSK_PRICES_URL)));
  if (seasons.length === 0) throw new Error('camping-strukkamphuk: no "Hauptsaison / Nebensaison" bands on /angebote-preise/ (layout changed?)');
  const checkIns = csobSaturdaySamples(today, seasons, { max: 9 });
  if (checkIns.length === 0) { ctx.note('camping-strukkamphuk: no sample week inside a published season within 12 months'); return []; }
  return csobSlots(await fetchCsobSamples(CSK_PORTAL, checkIns, ctx), ctx).map(s => ({ ...s, unit: s.unit ? cskUnitName(s.unit) : s.unit }));
}

export const campingStrukkamphukFehmarnsund: OfferAdapter = {
  key: 'camping-strukkamphuk-fehmarnsund',
  name: 'Camping Strukkamphuk Fehmarnsund',
  kind: 'accommodation',
  operator: {
    name: 'Camping Strukkamphuk',
    websiteUrl: SITE,
    rootDomain: 'strukkamphuk.de',
    contactEmail: 'camping@strukkamphuk.de',
    phone: '+4943712194',
  },
  url: CSK_CARAVANS_URL,
  slotMethod: 'booking_engine',
  instantBooking: true,
  liveAvailability: true,
  fetchBudget: 23,
  async fetchContent() {
    const home = await page(CSK_HOME_URL);
    const caravans = await page(CSK_CARAVANS_URL);
    const prices = await page(CSK_PRICES_URL);
    const sport = await page(CSK_SPORT_URL);
    if (!/Kitesurf-Schule/.test(sport) && !/Kitesurf-Schule/.test(home)) throw new Error('camping-strukkamphuk: kite school sentence missing (kite link gone?)');
    if (parseCskCaravans(caravans).length === 0) throw new Error('camping-strukkamphuk: no caravan blocks on /mietwohnwagen/ (layout changed?)');
    return parseStrukkamphukContent({ home, caravans, prices, sport });
  },
  async fetchSlots(ctx) {
    return fetchCskSlots(todayIso(), ctx);
  },
};
