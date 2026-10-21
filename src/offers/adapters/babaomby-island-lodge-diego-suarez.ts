// ---------------------------------------------------------------------------
// Babaomby Island Lodge, Babaomby peninsula on the Emerald Sea (Mer d'Emeraude) lagoon near Diego Suarez
// (Antsiranana, Madagascar) - eco lodge with bungalows on stilts facing the spot and its own kitesurf /
// wingfoil / windsurf school (4 IKO instructors, jet-ski assistance). Full board. Reached from Diego Suarez
// airport by car and boat.
//
// Data path (checked 2026-10-12), French pages of www.babaomby.com (WordPress, no English version):
//   content  / (school, 5-hectare park, team, phone), /hebergements-a-babaomby/hebergement/ (bungalows),
//            /hebergements-a-babaomby/tarifs/ (unit counts, board, transfers),
//            /ecole-de-kite-et-de-windsurf/ecole_de_kitesurf/ (IKO school, lessons, brands),
//            /ecole-de-kite-et-de-windsurf/tarifs-kite-wind-sup-kayaks/ (rental / lesson prices for lodge guests).
//   slots    /hebergements-a-babaomby/tarifs/: heading "Ouverture : du 17 mars 2026 au 1er décembre 2026" +
//            one <table>: per bungalow type ("Babaomby Vue Mer" / "Babaomby Vue Jardin") the full-board price
//            "euros /jours/pers" for 1 person, 2 persons, 3 / 4 persons (family bungalow) and children under 10.
// No booking engine: quotes and bookings by e-mail (address hidden behind a script) or phone / WhatsApp ->
//   availability 'on_request'.
// robots.txt (2026-10-12): Yoast default, nothing disallowed.
// Requests per run: content 5, slots 1.
// Parsed: slot = bungalow type x persons for the 2026 opening period ("sea-view-2p|2026"), EUR per person per
//   day (priceUnit 'per_day', priceBasis 'person': "night + breakfast + lunch + dinner"). The child rate,
//   the tourist tax (+1 EUR per person per day) and the transfer prices go into the room features / services.
//   A period that ended before today yields no slots (the offer falls back to "price on request").
// Known limits: the home and accommodation pages say "10 bungalows", the rate table lists 10 sea-view + 6
//   garden-view bungalows; the summary follows the rate table. No 2027 dates on the site yet. The contact
//   e-mail is rendered by a script ("loading..."), so the operator has phone / WhatsApp only.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, imageCandidates, iso, parseAmount, todayIso } from '../parse.js';
import type { ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.babaomby.com';
export const BB_HOME_URL = `${SITE}/`;
export const BB_RATES_URL = `${SITE}/hebergements-a-babaomby/tarifs/`;
const BB_LODGING_URL = `${SITE}/hebergements-a-babaomby/hebergement/`;
const BB_KITE_URL = `${SITE}/ecole-de-kite-et-de-windsurf/ecole_de_kitesurf/`;
const BB_KITE_RATES_URL = `${SITE}/ecole-de-kite-et-de-windsurf/tarifs-kite-wind-sup-kayaks/`;
const BOOKING_URL = `${SITE}/contacts/`;

const FR_MONTHS: Record<string, number> = {
  janvier: 1, fevrier: 2, février: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7,
  aout: 8, août: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12, décembre: 12,
};

/** Visible text split at block tags (one entry per heading / paragraph / cell / line). */
export function bbLines(html: string): string[] {
  return html
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .split(/<\/?(?:p|li|td|th|tr|h\d|div|br|ul|section|article|header|footer|nav)\b[^>]*>/i)
    .map(s => clean(s.replace(/<[^>]+>/g, ' ')))
    .filter(Boolean);
}

/** Text of the article body only (no menu, no sidebar "Infos récentes"). */
function bodyLines(html: string): string[] {
  const m = html.match(/<div class="blog-post-entry[^"]*">([\s\S]*?)<\/article>/);
  return bbLines(m ? m[1] : html);
}

// --- pure parsers -----------------------------------------------------------------------------
export interface BbSeason { start: string; end: string }
export interface BbRate { unitId: 'sea-view' | 'garden-view'; unit: string; persons: number; amount: number }
export interface BbTable { rates: BbRate[]; childRate: number | null; units: Array<{ unitId: string; unit: string; text: string }>; touristTax: string | null; transfer: string | null }

function frDate(s: string): string | null {
  const m = s.toLowerCase().match(/(\d{1,2})(?:er)?\s+([a-zéû]+)\s+(\d{4})/);
  const mo = m ? FR_MONTHS[m[2]] : undefined;
  return m && mo ? iso(+m[3], mo, +m[1]) : null;
}

/** "Ouverture : du 17 mars 2026 au 1er décembre 2026" -> the opening period. */
export function parseBbSeason(html: string): BbSeason | null {
  const t = bbLines(html).join(' ');
  const m = t.match(/Ouverture\s*:\s*du\s+(\d{1,2}(?:er)?\s+[A-Za-zéû]+\s+\d{4})\s+au\s+(\d{1,2}(?:er)?\s+[A-Za-zéû]+\s+\d{4})/i);
  if (!m) return null;
  const start = frDate(m[1]);
  const end = frDate(m[2]);
  return start && end && end >= start ? { start, end } : null;
}

const UNITS: Array<{ re: RegExp; unitId: BbRate['unitId']; unit: string }> = [
  { re: /Vue Mer/i, unitId: 'sea-view', unit: 'Sea-view bungalow (Vue Mer)' },
  { re: /Vue Jardin/i, unitId: 'garden-view', unit: 'Garden-view bungalow (Vue Jardin)' },
];

/** The lodge rate table: per bungalow type the full-board price per person per day by persons sharing. */
export function parseBbTable(html: string): BbTable {
  const out: BbTable = { rates: [], childRate: null, units: [], touristTax: null, transfer: null };
  const table = html.match(/<table[\s\S]*?<\/table>/i)?.[0] ?? '';
  for (const row of table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(c => c[1]);
    if (cells.length === 0) continue;
    const first = cells[0].split(/<br\s*\/?>/i).map(x => clean(x.replace(/<[^>]+>/g, ' '))).filter(Boolean);
    const label = first.join(' ');
    if (/taxe/i.test(label)) { out.touristTax = label; continue; }
    if (/^Transfert/i.test(label)) {
      const vals = cells.slice(1).map(c => clean(c.replace(/<[^>]+>/g, ' ')));
      const price = (v: string) => (/offert/i.test(v) ? 'free' : parseAmount(v) ? `EUR ${parseAmount(v)}` : v);
      const parts = ['1 person', '2 persons', '3-4 persons', 'children'].map((p, i) => (vals[i] ? `${p} ${price(vals[i])}` : null)).filter(Boolean);
      out.transfer = `Return transfer Diego Suarez airport - lodge by car and boat, per person: ${parts.join(' / ')}`;
      continue;
    }
    const u = UNITS.find(x => x.re.test(first[0] ?? ''));
    if (!u || cells.length < 4) continue;
    out.units.push({ unitId: u.unitId, unit: u.unit, text: first.slice(1).join('; ') });
    const amounts = (c: string) => c.split(/<br\s*\/?>/i).map(x => clean(x.replace(/<[^>]+>/g, ' '))).filter(Boolean);
    const one = parseAmount(amounts(cells[1])[0] ?? '');
    const two = parseAmount(amounts(cells[2])[0] ?? '');
    if (one) out.rates.push({ unitId: u.unitId, unit: u.unit, persons: 1, amount: one });
    if (two) out.rates.push({ unitId: u.unitId, unit: u.unit, persons: 2, amount: two });
    for (const line of amounts(cells[3])) {
      const pax = line.match(/(\d)\s*pax/i);
      const n = parseAmount(line);
      if (pax && n) out.rates.push({ unitId: u.unitId, unit: u.unit, persons: Number(pax[1]), amount: n });
    }
    const child = cells[4] ? parseAmount(clean(cells[4].replace(/<[^>]+>/g, ' '))) : null;
    if (child && out.childRate === null) out.childRate = child;
  }
  return out;
}

export function buildBbSlots(table: BbTable, season: BbSeason, today: string): Slot[] {
  if (season.end < today) return [];
  const year = season.start.slice(0, 4);
  return table.rates.map(r => ({
    key: `${r.unitId}-${r.persons}p|${year}`,
    startDate: season.start,
    endDate: season.end,
    unit: r.unit,
    price: r.amount,
    currency: 'EUR',
    priceUnit: 'per_day',
    priceBasis: 'person',
    occupancy: r.persons,
    availability: 'on_request',
    availabilityText: null,
    spotsLeft: null,
  }));
}

// --- content ----------------------------------------------------------------------------------
export interface BbPages { home: string; rates: string; lodging: string; kite: string; kiteRates: string }

const KITE_ROWS: Array<[RegExp, string]> = [
  [/^Location kite wingfoil et windsurf/i, 'Kite, wingfoil and windsurf rental (per person)'],
  [/^Location surfboard de kite/i, 'Kite surfboard only'],
  [/^Location de board twintip/i, 'Twin-tip board only'],
  [/^Location aile de kite/i, 'Kite only'],
  [/^Forfait stockage/i, 'Storage + jet-ski safety assistance (included with rental)'],
  [/^Cours particulier/i, 'Private kite or windsurf lesson incl. gear and jet-ski assistance (per person)'],
  [/^Down Wind/i, 'Downwinder "Piscine"'],
  [/^A\/R îlot Suarez/i, 'Return boat trip to Suarez islet'],
];
const KITE_COLS: Array<[RegExp, string]> = [[/1h/i, '1 h'], [/1\/2 journée/i, 'half day'], [/1 journée/i, '1 day'], [/2 semaines/i, '2 weeks'], [/1 semaine/i, '1 week']];
const frPrice = (s: string): string => s
  .replace(/(\d+) heures (\d+) euros/i, '$1 h EUR $2').replace(/Au delà (\d+) euros\/heure/i, 'then EUR $1 per hour')
  .replace(/\(au delà (\d+) euros\/jours\)/i, '(then EUR $1 per day)').replace(/(\d+) euros\/pers/i, 'EUR $1 per person')
  .replace(/(\d+) euros/i, 'EUR $1');

/** Water-sports price table for lodge guests, in English: "<item>: 1 h EUR 35 / half day EUR 55 / ...". */
export function parseBbKiteRates(html: string): string[] {
  const table = html.match(/<table[\s\S]*?<\/table>/i)?.[0] ?? '';
  const cellsOf = (row: string) => [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(c => clean(c[1].replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')));
  const rows = [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map(r => cellsOf(r[1]));
  const head = (rows.find(r => r.some(c => /Tarif 1h/i.test(c))) ?? []).map(h => KITE_COLS.find(([re]) => re.test(h))?.[1] ?? null);
  const out: string[] = [];
  for (const cells of rows) {
    const label = KITE_ROWS.find(([re]) => re.test(cells[0] ?? ''))?.[1];
    if (!label) continue;
    const vals = cells.map((c, i) => (i > 0 && /euros/i.test(c) ? `${head[i] && !/heures|au delà \d+ euros\/heure|euros\/pers/i.test(c) ? `${head[i]} ` : ''}${frPrice(c)}` : null)).filter((x): x is string => !!x);
    if (vals.length) out.push(`${label}: ${vals.join(' / ')}`);
  }
  return out;
}

export function parseBabaombyContent(p: BbPages): OfferContent {
  const home = bodyLines(p.home);
  const lodging = bodyLines(p.lodging);
  const kite = bodyLines(p.kite);
  const table = parseBbTable(p.rates);
  const season = parseBbSeason(p.rates);
  const kiteRates = parseBbKiteRates(p.kiteRates);
  const homeText = home.join(' ');
  const kiteText = kite.join(' ');
  const lodgingText = lodging.join(' ');

  const sea = table.units.find(u => u.unitId === 'sea-view');
  const garden = table.units.find(u => u.unitId === 'garden-view');
  const nSea = sea?.text.match(/(\d+) bungalows/)?.[1] ?? null;
  const nGarden = garden?.text.match(/(\d+) bungalows/)?.[1] ?? null;
  const instructors = kiteText.match(/constituée de (\d+) moniteurs/)?.[1] ?? null;
  const lagoonKm = homeText.match(/lagon de plus de (\d+)\s*kms?/)?.[1] ?? null;
  const parkHa = homeText.match(/parc de (\d+) hectares/)?.[1] ?? null;
  const cheapest = [...table.rates].filter(r => r.persons === 2).sort((a, b) => a.amount - b.amount)[0];
  const phone = homeText.match(/Téléphone\s*:\s*(\+261[\d\s]+?)\s+à Madagascar/)?.[1]?.trim() ?? null;

  const ratesFor = (unitId: string) => table.rates.filter(r => r.unitId === unitId)
    .map(r => `${r.persons} person${r.persons > 1 ? 's' : ''} sharing: EUR ${r.amount} per person per day (full board)`);
  const extras = [
    table.childRate ? `Children under 10: EUR ${table.childRate} per child per day` : null,
    table.touristTax ? 'Tourist tax: EUR 1 per person per day extra' : null,
  ].filter((x): x is string => !!x);
  /** English facts from the French unit cell ("10 bungalows – 24pax; 8 bungalows double 2 lits, ..."). */
  const unitFacts = (t: string): string[] => [
    t.match(/(\d+)\s*pax/i) ? `Up to ${t.match(/(\d+)\s*pax/i)![1]} guests in total` : null,
    t.match(/(\d+) bungalows double/i) ? `${t.match(/(\d+) bungalows double/i)![1]} double bungalows${/2 lits/.test(t) ? ' with 2 beds' : ''}` : null,
    t.match(/(\d+) bungalows familiaux/i) ? `${t.match(/(\d+) bungalows familiaux/i)![1]} family bungalows with 3-4 beds` : null,
    t.match(/(\d+) salles de bain/i) ? `${t.match(/(\d+) salles de bain/i)![1]} shared bathrooms and toilets` : null,
    /Draps/i.test(t) ? 'Bed linen, duvets, pillows and towels provided' : null,
  ].filter((x): x is string => !!x);
  const rooms: ContentRoom[] = table.units.map(u => ({
    name: u.unit,
    description: u.unitId === 'sea-view'
      ? `${nSea ?? '10'} bungalows facing the lagoon: double bungalows and family bungalows for 3-4 people, with shared bathrooms with hot water.`
      : `${nGarden ?? '6'} double bungalows in the garden, with shared bathrooms with hot water.`,
    features: [...unitFacts(u.text), ...ratesFor(u.unitId), ...extras],
  }));

  const imgs: string[] = [];
  const seen = new Set<string>();
  for (const [html, base] of [[p.lodging, BB_LODGING_URL], [p.home, BB_HOME_URL], [p.rates, BB_RATES_URL], [p.kite, BB_KITE_URL]] as const) {
    for (const u of imageCandidates(html, base, null, 60)) {
      if (!/babaomby\.com\/wp-content\/uploads\//.test(u) || /logo|icon|favicon|test21|cropped-|avatar|\.png$/i.test(u)) continue;
      const k = u.replace(/-\d+x\d+(?=\.[a-z]+$)/i, '');
      const id = k.replace(/-scaled(?=\.[a-z]+$)/i, '');
      if (seen.has(id)) continue;
      seen.add(id); imgs.push(k);
    }
  }

  const summary = [
    `Babaomby Island Lodge is a kitesurf, wingfoil and windsurf lodge on the Babaomby peninsula facing the Emerald Sea (Mer d'Emeraude), a lagoon${lagoonKm ? ` over ${lagoonKm} km long` : ''} near Diego Suarez (Antsiranana) in northern Madagascar${parkHa ? `, set in a ${parkHa}-hectare park opposite the spot` : ''}.`,
    `Guests sleep in wooden bungalows on stilts with a safari tent inside: ${nSea ?? '10'} sea-view bungalows (doubles and family bungalows for 3-4) and ${nGarden ?? '6'} garden-view doubles, with shared bathrooms, on full board${cheapest ? ` from EUR ${cheapest.amount} per person per day for two sharing` : ''}${season ? ` (open ${season.start} to ${season.end})` : ''}.`,
    `The lodge's own school has ${instructors ?? 'four'} IKO instructors with jet-ski and boat assistance; beginners learn in a shallow, protected area in front of the lodge, and experienced riders get flat water in the lagoon and waves on the reef; lessons run daily in French and English, and kite, wingfoil and windsurf gear can be rented.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Babaomby Island Lodge',
    summary,
    continent: 'Africa',
    country: 'Madagascar',
    region: 'Diana (Diego Suarez)',
    spot: "Emerald Sea (Mer d'Emeraude), Babaomby",
    itinerarySpots: [],
    durationDays: null,
    // kite school page: "Débutant à expert, vous trouverez les conditions idéales"
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: /cours/i.test(kiteText) && /IKO/.test(kiteText),
    equipmentRental: kiteRates.some(r => /rental/i.test(r)),
    beginnerFriendly: /débutants évoluent juste devant le lodge/i.test(kiteText),
    includedServices: [
      'Bungalow with full board (breakfast, lunch, dinner)',
      'Bed linen, duvets and towels',
      'Wi-Fi and electricity for charging devices',
    ],
    optionalServices: [
      ...kiteRates.map(r => `Water sports (lodge guests): ${r}`),
      ...(table.transfer ? [table.transfer] : []),
      'Kitesurf, wingfoil and windsurf lessons (private, freestyle and wave coaching, supervision)',
      'Excursions and massages',
    ],
    accommodation: 'wooden bungalows on stilts with safari tents (sea view and garden view)',
    mealPlan: 'full_board',
    languages: ['fr', 'en'],
    rooms,
    imageUrls: imgs.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: BB_HOME_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      `home: ${home.join(' | ')}`,
      `lodging: ${lodgingText}`,
      `kite school: ${kiteText}`,
      `rates: ${table.rates.map(r => `${r.unitId} ${r.persons}p ${r.amount} EUR/day/pp`).join('; ')}; child ${table.childRate ?? '-'}; ${table.touristTax ?? ''}; ${table.transfer ?? ''}`,
      `season: ${season ? `${season.start}..${season.end}` : '-'}`,
      `kite rates: ${kiteRates.join(' | ')}`,
      `phone: ${phone ?? '-'}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const babaombyIslandLodgeDiegoSuarez: OfferAdapter = {
  key: 'babaomby-island-lodge-diego-suarez',
  name: 'Babaomby Island Lodge',
  kind: 'accommodation',
  disciplines: ['kitesurf', 'wingfoil'],
  operator: {
    name: 'Babaomby Island Lodge',
    websiteUrl: SITE,
    rootDomain: 'babaomby.com',
    whatsapp: '+261325500939',
    phone: '+261325500939',
  },
  url: BB_HOME_URL,
  slotMethod: 'price_table',
  fetchBudget: 6,
  async fetchContent() {
    const home = await fetchText(BB_HOME_URL, { accept: 'text/html' });
    const rates = await fetchText(BB_RATES_URL, { accept: 'text/html' });
    const lodging = await fetchText(BB_LODGING_URL, { accept: 'text/html' });
    const kite = await fetchText(BB_KITE_URL, { accept: 'text/html' });
    const kiteRates = await fetchText(BB_KITE_RATES_URL, { accept: 'text/html' });
    return parseBabaombyContent({ home, rates, lodging, kite, kiteRates });
  },
  async fetchSlots(ctx: FetchContext) {
    const html = await fetchText(BB_RATES_URL, { accept: 'text/html' });
    const table = parseBbTable(html);
    const season = parseBbSeason(html);
    if (table.rates.length < 6) throw new Error(`babaomby: lodge rate table not found or changed (${table.rates.length} rates parsed)`);
    if (!season) throw new Error('babaomby: opening period ("Ouverture : du ... au ...") not found on the rates page');
    const slots = buildBbSlots(table, season, todayIso());
    if (slots.length === 0) ctx.note(`opening period ${season.start}..${season.end} is over; no newer rates on the page`);
    return slots;
  },
};
