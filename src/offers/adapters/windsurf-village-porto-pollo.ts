// ---------------------------------------------------------------------------
// Windsurf Village - Baia dei Delfini, Porto Pollo (Palau, north Sardinia, Italy) - complex of self-catering
// holiday apartments (types A, B, C for 1-6 people) a short dune path from the beach; the Porto Pollo kite
// area is 900 m away, where guests deposit or rent gear at the Porto Pollo Pro Center (instructors on site);
// a daily shuttle runs June to September.
//
// Data path (checked 2026-10-12): WordPress/Enfold site www.windsurfvillage.it (English pages).
//   content  / (complex, location), /home-holidays-sardinia/ (apartment types A / B / C), /kitesurfing-
//            sardinia/ (kite area, Pro Center, shuttle).
//   slots    the site's own booking engine = HBook (WordPress plugin 2.0.23). The home page embeds its data:
//              var hb_booking_form_data = {..., "seasons":[{season_id, start_date, end_date}, ...]}
//              var hb_status_days_all  = {"2026-10-25":"hb-day-fully-taken", ...}   (all apartments)
//              data-booking-rules='{"allowed_check_in_days":"5","minimum_stay":"7",...}' (5 = Saturday,
//              HBook counts Monday = 0)
//            and the search form posts anonymously (no nonce, no cookie) to
//              POST /source_/wp-admin/admin-ajax.php  action=hb_get_available_accom&check_in=YYYY-MM-DD&
//                   check_out=..&adults=2&children=0&... (the widget's own field list, see wvSearchBody)
//              -> {"success":true,"mark_up":"<div class=\"hb-accom-quantity\" data-accom-id=\"214\"
//                 data-quantity=\"3\">...<div class=\"hb-accom-title\">Type A – Superior 1</div>...
//                 <div class=\"hb-accom-price\">695 &euro;</div> price for 7 nights ... Accommodation price:
//                 600 € ... Pulizia finale: 95 €"}
//            We sample one Saturday-to-Saturday week per calendar month (the last arrival of the month whose
//            nights the calendar shows free), at most MAX_SAMPLES per run.
// robots.txt (2026-10-12): disallows /source_/wp-admin/ but allows /source_/wp-admin/admin-ajax.php.
// Requests per run: content 3, slots 1 + one search per month with a free week (1 on 2026-10-12, at most 6).
// Parsed: per apartment variant x run of equal state (season period, all-apartment calendar, sample week;
//   runsOf): price = the season's sampled weekly price (EUR per apartment for 7 nights incl. the final
//   cleaning fee, priceUnit 'package', packageNights 7, minNights 7, 2 adults). Inside a sample week the
//   availability is exact ('available', 'limited' <= 2 left, or 'sold_out' when the variant is not offered);
//   other open nights are 'unknown'; nights the calendar marks fully taken are 'sold_out'. unit = apartment
//   type ("Type A", joins the content rooms); the floor variant (Superior 1 = ground floor, Superior 2 =
//   first floor) is part of the key and the status text.
// Known limits: only the 2026 seasons (28 Mar - 7 Nov 2026) were loaded on 2026-10-12; once they end the
//   offer is "price on request" until the 2027 seasons appear in the page data (picked up automatically).
//   The price of a season is assumed flat (HBook rates are per season; one sample per season). The global
//   calendar only marks nights when every apartment is taken.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, parse, parseAmount, runsOf, todayIso } from '../parse.js';
import type { Availability, ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.windsurfvillage.it';
export const WV_HOME_URL = `${SITE}/`;
const APTS_URL = `${SITE}/home-holidays-sardinia/`;
const KITE_URL = `${SITE}/kitesurfing-sardinia/`;
export const WV_AJAX_URL = `${SITE}/source_/wp-admin/admin-ajax.php`;
const BOOKING_URL = `${SITE}/booking-holidays-sardinia/`;
const ADULTS = 2;
const MONTHS = 12;
const MAX_SAMPLES = 6;

export interface WvSeason { seasonId: string; start: string; end: string }
export interface WvEngine { seasons: WvSeason[]; status: Record<string, string>; checkInDays: number[]; minStay: number; pageId: string }
export interface WvAccom { id: string; title: string; unit: string; variant: string; desc: string; total: number; base: number | null; fees: string[]; quantity: number | null }
export interface WvSample { seasonId: string; checkIn: string; checkOut: string }
export interface WvSampleResult { stay: WvSample; accoms: WvAccom[] }

const keyPart = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const addDays = (isoDate: string, n: number): string => new Date(Date.parse(`${isoDate}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const weekday = (isoDate: string): number => new Date(`${isoDate}T00:00:00Z`).getUTCDay();

// --- pure parsers -----------------------------------------------------------------------------
/** HBook data embedded in the home page (seasons, all-apartment calendar, booking rules). */
export function parseWvEngine(html: string): WvEngine {
  const data = JSON.parse(html.match(/var hb_booking_form_data = (\{[\s\S]*?\});/)?.[1] ?? '{}') as { seasons?: Array<Record<string, string>> };
  const status = JSON.parse(html.match(/var hb_status_days_all = (\{[\s\S]*?\});/)?.[1] ?? '{}') as Record<string, string>;
  const rules = JSON.parse((html.match(/data-booking-rules='(\{[^']*\})'/)?.[1] ?? '{}').replace(/&quot;/g, '"')) as Record<string, string>;
  // HBook weekday numbers: Monday = 0 .. Sunday = 6 -> JS getUTCDay (Sunday = 0)
  const days = rules.allowed_check_in_days && rules.allowed_check_in_days !== 'all'
    ? rules.allowed_check_in_days.split(',').map(d => (Number(d) + 1) % 7)
    : [0, 1, 2, 3, 4, 5, 6];
  return {
    seasons: (data.seasons ?? []).map(s => ({ seasonId: String(s.season_id), start: String(s.start_date), end: String(s.end_date) }))
      .filter(s => /^\d{4}-\d{2}-\d{2}$/.test(s.start) && /^\d{4}-\d{2}-\d{2}$/.test(s.end))
      .sort((a, b) => a.start.localeCompare(b.start)),
    status,
    checkInDays: days,
    minStay: Number(rules.minimum_stay) || 1,
    pageId: html.match(/data-current-page-id="(\d+)"/)?.[1] ?? '',
  };
}

/** A night is taken for every apartment when the calendar marks it fully taken (or as the first night of such a stretch). */
const nightFull = (e: WvEngine, d: string): boolean => /hb-day-(fully-taken|taken-start)/.test(e.status[d] ?? '');

/** Season periods of HBook end on the changeover day: nights run start .. end-1. */
function seasonOf(e: WvEngine, night: string): WvSeason | null {
  return e.seasons.find(s => night >= s.start && night < s.end) ?? null;
}

/**
 * One sample week per calendar month: the LAST allowed arrival of the month whose nights (minimum stay, at
 * least 7) lie inside one season period and are not marked full - later weeks are less booked, so the sample
 * shows more apartment types. At most MAX_SAMPLES per run.
 */
export function wvSampleStays(e: WvEngine, today: string): WvSample[] {
  const nights = Math.max(7, e.minStay);
  const last = addDays(today, MONTHS * 31);
  const byMonth = new Map<string, WvSample>();
  for (let d = today; d <= last; d = addDays(d, 1)) {
    if (!e.checkInDays.includes(weekday(d)) || /no-check-in/.test(e.status[d] ?? '')) continue;
    const season = seasonOf(e, d);
    const checkOut = addDays(d, nights);
    if (!season || checkOut > season.end) continue;
    if (Array.from({ length: nights }, (_, i) => addDays(d, i)).some(n => nightFull(e, n))) continue;
    byMonth.set(d.slice(0, 7), { seasonId: season.seasonId, checkIn: d, checkOut });
  }
  return [...byMonth.values()].slice(0, MAX_SAMPLES);
}

/** POST body exactly as the widget sends it (field order of booking-form.js). */
export function wvSearchBody(e: WvEngine, checkIn: string, checkOut: string): string {
  return new URLSearchParams({
    action: 'hb_get_available_accom', check_in: checkIn, check_out: checkOut, adults: String(ADULTS), children: '0',
    results_show_only_accom_id: '', page_accom_id: '', current_page_id: e.pageId, exists_main_booking_form: 'yes',
    force_display_thumb: 'no', force_display_desc: 'no', chosen_options: '', chosen_accom_num: '', is_admin: 'no',
    admin_accom_id: '', admin_search_type: '', accom_people: '',
  }).toString();
}

/** hb_get_available_accom answer -> available apartment types with the stay price. */
export function parseWvSearch(json: string): WvAccom[] {
  const r = JSON.parse(json) as { success?: boolean; mark_up?: string };
  if (!r.success || !r.mark_up) return [];
  const qty = new Map([...r.mark_up.matchAll(/data-accom-id="(\d+)" data-quantity="(\d+)"/g)].map(m => [m[1], Number(m[2])] as const));
  const root = parse(r.mark_up);
  const out: WvAccom[] = [];
  for (const el of root.querySelectorAll('.hb-accom')) {
    const id = el.getAttribute('data-accom-id') ?? '';
    const title = clean(el.querySelector('.hb-accom-title')?.text);
    const total = parseAmount(clean(el.querySelector('.hb-accom-price')?.text));
    if (!id || !title || !total) continue;
    const [unit, ...rest] = title.split(/\s+[–-]\s+/);
    out.push({
      id, title, unit, variant: rest.join(' - '),
      desc: clean(el.querySelector('.hb-accom-desc')?.text),
      total,
      base: parseAmount(clean(el.querySelector('.hb-price-breakdown-amount')?.text)),
      fees: el.querySelectorAll('.hb-fee').map(f => clean(f.text)),
      quantity: qty.get(id) ?? null,
    });
  }
  return out;
}

/**
 * Bands per apartment variant: nights from the first allowed check-in day on, inside the loaded seasons, split
 * where the season period, the all-apartment calendar state or a sample week starts or ends (runsOf). Inside a
 * sample week the availability is exact (free count of that variant, or not offered = sold_out); elsewhere it is
 * 'unknown' with the season's sampled price, or 'sold_out' when the calendar marks every apartment taken.
 */
export function buildWvSlots(e: WvEngine, results: WvSampleResult[], today: string): Slot[] {
  let first = today;
  while (!e.checkInDays.includes(weekday(first))) first = addDays(first, 1);
  const lastSeasonEnd = e.seasons.map(x => x.end).sort().reverse()[0];
  if (!lastSeasonEnd) return [];
  const nights = Math.max(7, e.minStay);
  const sampleOf = (d: string) => results.findIndex(r => d >= r.stay.checkIn && d < r.stay.checkOut);
  const days: Array<{ date: string; season: WvSeason; full: boolean; sample: number }> = [];
  for (let d = first; d < lastSeasonEnd && d <= addDays(today, MONTHS * 31); d = addDays(d, 1)) {
    const season = seasonOf(e, d);
    if (season) days.push({ date: d, season, full: nightFull(e, d), sample: sampleOf(d) });
  }
  const variants = new Map<string, WvAccom>();
  for (const r of results) for (const a of r.accoms) if (!variants.has(a.id)) variants.set(a.id, a);
  const out: Slot[] = [];
  for (const v of variants.values()) {
    for (const run of runsOf(days, d => `${d.season.seasonId}|${d.season.start}|${d.full}|${d.sample}`)) {
      const seasonHits = results.filter(r => r.stay.seasonId === run.first.season.seasonId)
        .flatMap(r => r.accoms.filter(a => a.id === v.id).map(a => ({ r, a })));
      const price = seasonHits.length ? Math.min(...seasonHits.map(h => h.a.total)) : null;
      const inSample = run.first.sample >= 0 ? results[run.first.sample] : null;
      const hit = inSample?.accoms.find(a => a.id === v.id) ?? null;
      let availability: Availability;
      let text: string;
      if (run.first.full) { availability = 'sold_out'; text = 'all apartments taken (site calendar)'; }
      else if (inSample && hit) {
        availability = hit.quantity !== null && hit.quantity <= 2 ? 'limited' : 'available';
        text = `${v.title}${v.desc ? ` (${v.desc.replace(/\.$/, '')})` : ''}: ${hit.quantity ?? '?'} free for ${inSample.stay.checkIn}..${inSample.stay.checkOut}`;
      } else if (inSample) { availability = 'sold_out'; text = `${v.title} not offered for ${inSample.stay.checkIn}..${inSample.stay.checkOut}`; }
      else {
        availability = 'unknown';
        text = price !== null
          ? `${v.title}: season price from the sample week ${seasonHits[0].r.stay.checkIn}..${seasonHits[0].r.stay.checkOut}; free nights in the site calendar`
          : `${v.title}: no sample week of this season offered it`;
      }
      out.push({
        key: `${keyPart(v.title)}|${run.start}`,
        startDate: run.start,
        endDate: run.end,
        unit: v.unit,
        price,
        currency: price !== null ? 'EUR' : null,
        priceUnit: price !== null ? 'package' : null,
        priceBasis: 'room',
        occupancy: ADULTS,
        availability,
        availabilityText: text,
        spotsLeft: availability === 'limited' ? hit!.quantity : null,
        packageNights: price !== null ? nights : null,
        minNights: e.minStay,
      });
    }
  }
  return out;
}

// --- content ----------------------------------------------------------------------------------
/** Visible text split at block tags (Enfold blocks, icon-list items: one entry each). */
export function wvLines(html: string): string[] {
  return html
    .replace(/<(script|style|noscript|svg|select|form)\b[\s\S]*?<\/\1>/gi, ' ')
    .split(/<\/?(?:p|li|td|th|tr|h\d|div|br|ul|section|span|a|button|table)\b[^>]*>/i)
    .map(x => clean(x.replace(/<[^>]+>/g, ' ')))
    .filter(Boolean);
}

/** Apartment types on /home-holidays-sardinia/: "Type A" followed by its room list, until the next type. */
export function parseWvTypes(html: string): ContentRoom[] {
  const ls = wvLines(html);
  const out: ContentRoom[] = [];
  for (let i = 0; i < ls.length; i++) {
    const m = ls[i].match(/^Type ([A-C])$/);
    if (!m || out.some(r => r.name === `Type ${m[1]}`)) continue;
    const features: string[] = [];
    for (let j = i + 1; j < ls.length && !/^Type [A-C]$/.test(ls[j]) && features.length < 8 && ls[j].length < 60 && !/^\d+$/.test(ls[j]); j++) features.push(ls[j]);
    if (features.length) out.push({ name: `Type ${m[1]}`, description: `Apartment type ${m[1]}: ${features.join(', ').toLowerCase()}.`, features });
  }
  return out;
}

const PHOTO_JUNK = /logo|cropped|Cattura\.jpg|\.png$/i;

/** Photos per page (uploads JPEGs in document order; Enfold sliders keep them in data attributes and srcsets),
 *  size variants folded, "-scaled" preferred over a same-name original, pages interleaved. */
export function wvImages(pages: string[], max = 30): string[] {
  const seen = new Set<string>();
  const perPage = pages.map(html => {
    const list: string[] = [];
    for (const m of html.matchAll(/https:\/\/www\.windsurfvillage\.it\/source_\/wp-content\/uploads\/[^"'()\s,]+?\.jpe?g/gi)) {
      const url = m[0].replace(/-\d+x\d+(?=\.[a-z]+$)/i, '');
      const k = url.replace(/-scaled(?=\.[a-z]+$)/i, '');
      if (PHOTO_JUNK.test(url) || seen.has(k)) continue;
      seen.add(k); list.push(url);
    }
    return list;
  });
  const out: string[] = [];
  for (let i = 0; out.length < max && perPage.some(l => l.length > i); i++) for (const l of perPage) if (l[i] && out.length < max) out.push(l[i]);
  return out;
}

export interface WvPages { home: string; apartments: string; kite: string }

export function parseWindsurfVillageContent(p: WvPages): OfferContent {
  const home = wvLines(p.home);
  const apts = wvLines(p.apartments);
  const kite = wvLines(p.kite);
  const homeText = home.join(' ');
  const aptText = apts.join(' ');
  const kiteText = kite.join(' ');
  const engine = parseWvEngine(p.home);
  const types = parseWvTypes(p.apartments);
  const kiteDistance = kiteText.match(/kite boarding area of .{0,20}Porto Pollo is (\d+) meters/i)?.[1] ?? '900';
  const seasonSpan = engine.seasons.length ? `${engine.seasons[0].start} to ${engine.seasons[engine.seasons.length - 1].end}` : null;

  const summary = [
    'Windsurf Village - Baia dei Delfini is a complex of furnished holiday apartments in Porto Pollo near Palau in northern Sardinia, Italy, with views of Corsica and the La Maddalena islands; a short path through the dunes leads to the beach with a sports center, beach bar-restaurant and kids area.',
    `The apartments (types A, B and C for 1 to 6 people) have a living room, equipped kitchen, one or two bedrooms and a private terrace; they are let Saturday to Saturday with a 7-night minimum through the site's booking engine${seasonSpan ? ` (season ${seasonSpan})` : ''}.`,
    `The Porto Pollo kite area is ${kiteDistance} m away as the crow flies; guests can store or rent gear at the Porto Pollo Pro Center, where instructors teach, and a shuttle runs daily from June to September.`,
  ].join(' ');

  const imageUrls = wvImages([p.apartments, p.home, p.kite]);

  return {
    kind: 'accommodation',
    title: 'Windsurf Village - Baia dei Delfini',
    summary,
    continent: 'Europe',
    country: 'Italy',
    region: 'Porto Pollo, Sardinia',
    spot: 'Porto Pollo',
    itinerarySpots: [],
    durationDays: null,
    skillLevels: [],
    kiteLessons: /instructors/i.test(kiteText) ? true : null,
    equipmentRental: /rent/i.test(kiteText),
    beginnerFriendly: null,
    includedServices: [
      'Wi-Fi in all apartments', '43" smart TV', 'Ceiling fans', 'Private equipped terrace',
      'Final cleaning (fee included in the weekly price of the booking engine)',
      ...(/shuttle/i.test(kiteText) ? ['Daily shuttle to the Porto Pollo kite / windsurf center (June to September)'] : []),
    ],
    optionalServices: [
      'Kite and windsurf lessons, rental and gear storage at the Porto Pollo Pro Center (900 m)',
      'Air conditioning on request',
      'Beach bar-restaurant, sun beds and umbrellas',
    ],
    accommodation: 'self-catering holiday apartments (types A, B, C) for 1-6 people',
    mealPlan: 'self_catering',
    languages: ['it', 'en', 'de', 'fr'],
    rooms: types,
    imageUrls: imageUrls.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: WV_HOME_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      `home: ${homeText}`,
      `apartments: ${aptText}`,
      `kitesurf: ${kiteText}`,
      `engine seasons: ${engine.seasons.map(s => `${s.seasonId} ${s.start}..${s.end}`).join('; ')}; check-in weekdays ${engine.checkInDays.join(',')}, minimum stay ${engine.minStay}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export async function fetchWvSlots(ctx: FetchContext, today = todayIso()): Promise<Slot[]> {
  const engine = parseWvEngine(await fetchText(WV_HOME_URL, { accept: 'text/html' }));
  if (!engine.pageId) throw new Error('windsurf-village: HBook booking form not found on the home page (layout changed?)');
  if (!engine.seasons.some(s => s.end > today)) {
    ctx.note(`no HBook season after ${today} loaded yet (last ${engine.seasons.map(s => s.end).sort().reverse()[0] ?? 'none'}) - price on request`);
    return [];
  }
  const results: WvSampleResult[] = [];
  for (const stay of wvSampleStays(engine, today)) {
    const json = await fetchText(WV_AJAX_URL, {
      method: 'POST',
      body: wvSearchBody(engine, stay.checkIn, stay.checkOut),
      contentType: 'application/x-www-form-urlencoded; charset=UTF-8',
      accept: 'application/json, text/javascript, */*; q=0.01',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    });
    results.push({ stay, accoms: parseWvSearch(json) });
  }
  return buildWvSlots(engine, results, today);
}

export const windsurfVillagePortoPollo: OfferAdapter = {
  key: 'windsurf-village-porto-pollo',
  name: 'Windsurf Village Porto Pollo',
  kind: 'accommodation',
  operator: {
    name: 'Windsurf Village (MARE srls)',
    websiteUrl: SITE,
    rootDomain: 'windsurfvillage.it',
    contactEmail: 'info@windsurfvillage.it',
    phone: '+390789704075',
  },
  url: WV_HOME_URL,
  slotMethod: 'booking_engine',
  instantBooking: true,
  liveAvailability: true,
  fetchBudget: 4 + MAX_SAMPLES,
  async fetchContent() {
    const [home, apartments, kite] = [
      await fetchText(WV_HOME_URL, { accept: 'text/html' }),
      await fetchText(APTS_URL, { accept: 'text/html' }),
      await fetchText(KITE_URL, { accept: 'text/html' }),
    ];
    return parseWindsurfVillageContent({ home, apartments, kite });
  },
  fetchSlots: ctx => fetchWvSlots(ctx),
};
