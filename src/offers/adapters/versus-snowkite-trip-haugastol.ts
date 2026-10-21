// ---------------------------------------------------------------------------
// Versus Snowkite Trip, Hardangervidda (Norway) - an 11-day SNOWKITE trip (kiting on snow, not water) run every winter
// since about 2011 by the Dutch kite shop Versus (Scheveningen; "The 16th edition is now available for booking!").
// The group stays 10 nights at a small hotel in Haugastøl on the edge of the plateau (run by snowkite pro Bjørn Kaupang)
// with breakfast, packed lunch and dinner; guides take everyone out daily (1:5), from first meters to 20-100 km
// backcountry tours. Optional: one night in a staffed mountain hut, one night winter camping, gear rental.
//
// Data path (checked 2026-10-19): Odoo website, server-rendered; the booking block #skt-calc is static HTML + an inline
//   script the shop edits by hand:
//   slots    the script's text table (p1_d / p2_d: "Friday 12 February to Monday 22 February 2027", "Thursday 4 March to
//            Sunday 14 March 2027"), the base package input (data-key="basis" data-price="1899"), the room upgrades
//            (verb_std 0 / verb_gedeeld 435 / verb_prive 575) and the places-left table
//            "var PLEKKEN = { '1': 15, '2': 15 }" ("Pas hier de getallen aan als er geboekt is" = edited when people book;
//            the page shows "15 places left", "1 place left" or "Full").
//            One slot per period x room option, EUR per person ("Totaalbedrag per persoon"), base + upgrade.
//   content  the same page (FAQ, inclusions from the script's text table, options and photos).
// Booking: "Send request" mails a booking request (Odoo website form) -> request-only, instantBooking false;
//   availability from the places-left number (not a booking engine -> liveAvailability unset).
// robots.txt (2026-10-19): "User-agent: *  Allow: *"; it disallows GPTBot and anthropic-ai only (our token is
//   KiteScoutBot, a catalog crawler) - flagged to Aaron in the build report.
// Requests per run: 1 (content + slots share one memoised page fetch).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, imageCandidates, iso, monthOf, parse, todayIso, type HTMLElement } from '../parse.js';
import type { Availability, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.versusshop.nl';
export const VERSUS_URL = `${SITE}/en/snowkitetrip`;

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
const txt = (el: HTMLElement | null | undefined): string => collapse(el?.text ?? '');
const unq = (s: string): string => s.replace(/\\(['"])/g, '$1');

// --- pure parsers -----------------------------------------------------------------------------
/** The booking script's text table: key: ['Dutch', 'English'] -> English text per key. */
export function versusTexts(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([A-Za-z_][\w]*)\s*:\s*\[\s*(['"])((?:\\.|(?!\2)[^\\])*)\2\s*,\s*(['"])((?:\\.|(?!\4)[^\\])*)\4\s*\]/g;
  for (const m of html.matchAll(re)) if (!(m[1] in out)) out[m[1]] = collapse(unq(m[5]));
  return out;
}

export interface VersusPeriod { n: number; start: string; end: string; label: string; placesLeft: number | null }

/** "Friday 12 February to Monday 22 February 2027" (p1_d, p2_d, ...) + the PLEKKEN places table. */
export function parseVersusPeriods(html: string): VersusPeriod[] {
  const t = versusTexts(html);
  const places: Record<string, number> = {};
  const pl = html.match(/PLEKKEN\s*=\s*\{([^}]*)\}/);
  if (pl) for (const m of pl[1].matchAll(/['"]?(\d+)['"]?\s*:\s*(-?\d+)/g)) places[m[1]] = Number(m[2]);
  const out: VersusPeriod[] = [];
  for (const [k, v] of Object.entries(t)) {
    const km = k.match(/^p(\d+)_d$/);
    if (!km) continue;
    const m = v.match(/(\d{1,2})\s+([A-Za-z]+)\s+to\s+\w+\s+(\d{1,2})\s+([A-Za-z]+)\s+(20\d{2})/);
    if (!m || !monthOf(m[2]) || !monthOf(m[4])) continue;
    const y = Number(m[5]);
    const m1 = monthOf(m[2])!;
    const m2 = monthOf(m[4])!;
    const n = Number(km[1]);
    out.push({
      n,
      start: iso(m1 > m2 ? y - 1 : y, m1, Number(m[1])),
      end: iso(y, m2, Number(m[3])),
      label: v,
      placesLeft: n in places ? places[n] : null,
    });
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

export interface VersusOption { key: string; group: string | null; price: number; label: string; desc: string }

/** Every priced input of the booking block (data-key + data-price), English labels from the text table. */
export function parseVersusOptions(html: string): VersusOption[] {
  const t = versusTexts(html);
  const out: VersusOption[] = [];
  for (const inp of parse(html).querySelectorAll('#skt-calc input[data-key][data-price]')) {
    const key = inp.getAttribute('data-key')!;
    if (out.some(o => o.key === key)) continue; // the block is rendered twice (desktop / mobile)
    const price = Number(inp.getAttribute('data-price'));
    if (!Number.isFinite(price)) continue;
    out.push({ key, group: inp.getAttribute('name') ?? null, price, label: t[key] ?? key, desc: t[`${key}_d`] ?? '' });
  }
  return out;
}

export function versusAvailability(placesLeft: number | null): { availability: Availability; text: string } {
  if (placesLeft === null) return { availability: 'on_request', text: 'Booking request form' };
  if (placesLeft <= 0) return { availability: 'sold_out', text: 'Full' };
  if (placesLeft === 1) return { availability: 'limited', text: '1 place left (booking request form)' };
  return { availability: placesLeft <= 4 ? 'limited' : 'available', text: `${placesLeft} places left (booking request form)` };
}

const ROOMS: Array<{ key: string; slug: string; unit: string }> = [
  { key: 'verb_std', slug: 'standard', unit: 'Standard: 4-bed room in an 8-person apartment' },
  { key: 'verb_gedeeld', slug: 'shared', unit: 'Luxury room, shared: twin room in a 4-person apartment' },
  { key: 'verb_prive', slug: 'private', unit: 'Luxury room, private: own bedroom in a 4-person apartment' },
];

export function buildVersusSlots(periods: VersusPeriod[], options: VersusOption[], today: string): Slot[] {
  const base = options.find(o => o.key === 'basis');
  if (!base) return [];
  const out: Slot[] = [];
  for (const p of periods) {
    if (p.start < today) continue;
    const a = versusAvailability(p.placesLeft);
    for (const r of ROOMS) {
      const o = options.find(x => x.key === r.key);
      if (!o) continue;
      out.push({
        key: `${p.start}|${r.slug}`,
        startDate: p.start,
        endDate: p.end,
        unit: r.unit,
        price: base.price + o.price,
        currency: 'EUR',
        priceUnit: 'package',
        priceBasis: 'person',
        occupancy: null,
        availability: a.availability,
        availabilityText: a.text,
        spotsLeft: p.placesLeft !== null && p.placesLeft >= 0 ? p.placesLeft : null,
      });
    }
  }
  return out;
}

export function parseVersusContent(html: string, today = todayIso()): OfferContent {
  const t = versusTexts(html);
  const periods = parseVersusPeriods(html);
  const options = parseVersusOptions(html);
  const base = options.find(o => o.key === 'basis');
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, svg, header, footer, nav, form')) el.remove();
  const main = root.querySelector('main') ?? root.querySelector('#wrap') ?? root;
  const text = txt(main);
  const fmt = (n: number): string => n.toLocaleString('en-US');
  const day = (d: string): string => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', timeZone: 'UTC' });
  const future = periods.filter(p => p.start >= today);
  const year = (future[0] ?? periods[periods.length - 1])?.end.slice(0, 4);
  const opt = (k: string): VersusOption | undefined => options.find(o => o.key === k);
  const edition = text.match(/The (\d+)(?:st|nd|rd|th) edition/i)?.[1];

  const includes = Object.keys(t).filter(k => /^incl_\d+$/.test(k)).map(k => t[k].replace(/^Fantastic food!\s*/i, '')).filter(Boolean);
  const optional: string[] = [];
  for (const [k, label] of [['verb_gedeeld', null], ['verb_prive', null], ['hut', null], ['wk1', null], ['kite_periode', null], ['ski', null], ['ski_sch', null], ['snb', null], ['snb_sch', null], ['bagage', null]] as const) {
    const o = opt(k);
    if (o && o.price > 0) optional.push(`${label ?? o.label}${o.desc ? ` (${o.desc})` : ''}: +EUR ${fmt(o.price)}`);
  }
  if (t.kite_dag && t.kite_dag_n) optional.push(`${t.kite_dag}: ${t.kite_dag_n}, settled on location`);

  const summary = [
    `Versus, a Dutch kite shop, runs an 11-day snowkiting trip - kiting on snow with skis or a snowboard, not on water - on the Hardangervidda plateau in Norway every winter${edition ? ` (the ${edition}th edition)` : ''}.`,
    'The group stays 10 nights at a small hotel in Haugastøl on the edge of the plateau with breakfast, packed lunch and dinner; guides take everyone out daily, from first meters near the hotel to backcountry tours of 20 to 100 km, and luggage travels from the Netherlands with the team.',
    base ? `The base package costs EUR ${fmt(base.price)} per person in a 4-bed room${opt('verb_gedeeld') && opt('verb_prive') ? `, with upgrades to a shared (+EUR ${fmt(opt('verb_gedeeld')!.price)}) or private (+EUR ${fmt(opt('verb_prive')!.price)}) bedroom in a 4-person apartment` : ''}; kite rental, a mountain-hut night and winter camping are extras.` : '',
    future.length
      ? `Dates ${year}: ${future.map(p => `${day(p.start)} to ${day(p.end)}`).join(' and ')}; booking is by request form.`
      : periods.length ? `The ${year} dates are over; the next trip dates are not published yet.` : 'Booking is by request form.',
  ].filter(Boolean).join(' ');

  const imageUrls = imageCandidates(html, VERSUS_URL, null, 60)
    .filter(u => /\/web\/image\//.test(u) && !/logo|icon|badge|klarna|payment|flag|Schermafbeelding|collage|\.svg/i.test(u))
    .slice(0, 30);

  return {
    kind: 'camp',
    title: 'Versus Snowkite Trip, Hardangervidda',
    summary,
    continent: 'Europe',
    country: 'Norway',
    region: 'Hardangervidda',
    spot: 'Haugastøl, Hardangervidda',
    spotCoords: null,
    itinerarySpots: [],
    durationDays: 11,
    // "This trip is suitable for all levels, but we do expect that you can kite independently back and forth."
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: false, // "You won't have a traditional lesson week" - guiding and clinics instead
    equipmentRental: !!opt('kite_periode'),
    beginnerFriendly: /suitable for all levels/i.test(text),
    includedServices: includes,
    optionalServices: optional,
    accommodation: 'Small hotel in Haugastøl (apartments: 4-bed rooms in an 8-person apartment, or twin / private rooms in a 4-person apartment)',
    mealPlan: 'full_board',
    languages: ['nl', 'en'],
    rooms: [],
    imageUrls,
    heroVideoUrl: null,
    sourceUrl: VERSUS_URL,
    bookingUrl: `${VERSUS_URL}#skt-form`,
    sourceText: [
      `periods: ${periods.map(p => `${p.label} (places left ${p.placesLeft ?? '?'})`).join(' | ')}`,
      `options: ${options.map(o => `${o.key} ${o.label} ${o.price}`).join(' | ')}`,
      `excluded: ${Object.keys(t).filter(k => /^excl_\d+$/.test(k)).map(k => t[k]).filter(Boolean).join('; ')}`,
      `page: ${text}`,
    ].join('\n'),
  };
}

export async function fetchVersusSlots(today: string, ctx?: Pick<FetchContext, 'note'>): Promise<Slot[]> {
  const html = await page(VERSUS_URL);
  const periods = parseVersusPeriods(html);
  const options = parseVersusOptions(html);
  if (!periods.length) throw new Error('versus-snowkite-trip: no trip periods (p1_d ...) found (booking block changed?)');
  if (!options.some(o => o.key === 'basis')) throw new Error('versus-snowkite-trip: base package price (data-key="basis") not found');
  const slots = buildVersusSlots(periods, options, today);
  if (!slots.length) ctx?.note(`all trip periods are past (${periods.map(p => p.start).join(', ')}); next dates not published yet`);
  return slots;
}

// --- adapter ----------------------------------------------------------------------------------
export const versusSnowkiteTripHaugastol: OfferAdapter = {
  key: 'versus-snowkite-trip-haugastol',
  name: 'Versus Snowkite Trip, Hardangervidda (Haugastøl)',
  kind: 'camp',
  disciplines: ['snowkite'],
  operator: {
    name: 'Versus Kiteboarding (Versusshop)',
    websiteUrl: `${SITE}/en`,
    rootDomain: 'versusshop.nl',
    contactEmail: 'daan@versusshop.nl',
    phone: '+31 70 322 0540',
  },
  url: VERSUS_URL,
  slotMethod: 'html_dates',
  instantBooking: false,
  fetchBudget: 2,
  async fetchContent() {
    return parseVersusContent(await page(VERSUS_URL));
  },
  fetchSlots: ctx => fetchVersusSlots(todayIso(), ctx),
};
