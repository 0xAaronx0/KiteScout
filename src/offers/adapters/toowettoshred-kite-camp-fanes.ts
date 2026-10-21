// ---------------------------------------------------------------------------
// Too Wet to Shred - Kite Camp Greece, Fanes (Rhodes): one late-summer group week (8 nights) at Club Meltemi's
// kite station and the basic hotel next door, breakfast and dinner, airport transfers, clinics and coaching, day trips
// to Prasonisi and Rhodes old town; focus on intermediate / independent riders (beginner lessons as add-on).
// Same operator as toowettoshred-brazil (separate product, separate listing).
// Brand: "Too Wet to Shred" (page title, body, logo). "Never Too Wet to Shred" is only the WordPress site name in
//   the feed links and the mail address never@ - not the operator's public name (#267 verifier, 2026-10-21).
//
// Data path (checked 2026-10-19): ONE WordPress (Divi) page, https://www.toowettoshred.com/camps/kite-camp-greece/
//   - dates: Divi text modules with a date line ("28 August to 5 September 2027"). The page <title>, og:title and
//     JSON-LD still say "Kitesurf Camp Greece : 22-30 August 2026" (stale SEO text from the 2026 edition); we read only
//     the visible text modules and keep dates that have not started.
//   - rooms: Divi blurbs "Twin room (standard)" ("2 Single beds / EUR 1150 p.p. / Private upgrade + EUR 150") and
//     "Triple room (standard)" ("3 Single beds / EUR 1075 p.p."). The twin blurb's hover text says "Private Upgrade =
//     + EUR 250" while the visible text says "+ EUR 150" -> no private-room slot; both figures go to the slot text.
//   - lists: "included" / "Not included" / "Add-ons" text modules (ul).
// Booking runs on Bookinglayer (bookings.toowettoshred.com, robots "Disallow: /" on its API, see toowettoshred-brazil)
//   -> not called; availability 'unknown' (the page has no status badge, "Limited availability" is sales copy, "A total
//   of 13 spots" is the group size). Flags unset (instant booking on Bookinglayer not confirmed, 2026-10-14 check).
// robots.txt www.toowettoshred.com (2026-10-19): only /wp-admin/ disallowed.
// Requests per run: 1 (memoised page).
// State 2026-10-19: 1 dated week 28.08.-05.09.2027 x 2 room types = 2 slots.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, imageCandidates, iso, monthOf, parse, parseAmount, todayIso, type HTMLElement } from '../parse.js';
import type { ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

export const TWTS_GR_URL = 'https://www.toowettoshred.com/camps/kite-camp-greece/';
const BOOKING_URL = 'https://bookings.toowettoshred.com/en/product/kite-camp-greece/';

const memo = new Map<string, { at: number; p: Promise<string> }>();
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url);
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}
const txt = (el: HTMLElement | null | undefined): string => collapse(el?.text ?? '');

function body(html: string): HTMLElement {
  const root = parse(html);
  for (const el of root.querySelectorAll('head, script, style, noscript, template')) el.remove();
  return root.querySelector('body') ?? root;
}

// --- dates ------------------------------------------------------------------------------------------------------------
export interface TwtsGrDate { start: string; end: string; raw: string }

/** Date lines of the visible text modules: "28 August to 5 September 2027", "22-30 August 2026", "22 - 30 Aug 2026". */
export function parseTwtsGrDates(html: string): TwtsGrDate[] {
  const out: TwtsGrDate[] = [];
  for (const el of body(html).querySelectorAll('.et_pb_text_inner p, .et_pb_text_inner h1, .et_pb_text_inner h2, .et_pb_text_inner h3, .et_pb_text_inner')) {
    const raw = txt(el);
    if (raw.length > 60) continue;
    const t = raw.replace(/[–—]/g, '-');
    let m = t.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(?:to|-)\s+(\d{1,2})\s+([A-Za-z]+)\s+(20\d{2})$/i);
    let r: TwtsGrDate | null = null;
    if (m && monthOf(m[2]) && monthOf(m[4])) {
      const y2 = +m[5], m1 = monthOf(m[2])!, m2 = monthOf(m[4])!;
      r = { start: iso(m2 < m1 ? y2 - 1 : y2, m1, +m[1]), end: iso(y2, m2, +m[3]), raw };
    }
    m = t.match(/^(\d{1,2})\s*(?:to|-)\s*(\d{1,2})\s+([A-Za-z]+)\s+(20\d{2})$/i);
    if (!r && m && monthOf(m[3])) r = { start: iso(+m[4], monthOf(m[3])!, +m[1]), end: iso(+m[4], monthOf(m[3])!, +m[2]), raw };
    if (r && !out.some(o => o.start === r!.start)) out.push(r);
  }
  return out;
}

// --- rooms ------------------------------------------------------------------------------------------------------------
export interface TwtsGrRoom { name: string; key: string; beds: string | null; price: number; currency: string; occupancy: number | null; note: string | null; hover: string | null }

export function parseTwtsGrRooms(html: string): TwtsGrRoom[] {
  const out: TwtsGrRoom[] = [];
  for (const b of body(html).querySelectorAll('.et_pb_blurb')) {
    const name = txt(b.querySelector('.et_pb_module_header'));
    if (!/room/i.test(name)) continue;
    const descEl = b.querySelector('.et_pb_blurb_description');
    const desc = txt(descEl);
    const pm = desc.match(/€\s*([\d.,]+)\s*p\.?\s*p\.?/i);
    if (!pm || !parseAmount(pm[1])) continue;
    const beds = desc.match(/(\d)\s+Single beds?/i);
    const upgrade = desc.match(/Private upgrade\s*\+\s*€\s*([\d.,]+)/i);
    // hover variant of the description (Divi data-et-multi-view JSON)
    let hover: string | null = null;
    const mv = descEl?.getAttribute('data-et-multi-view');
    if (mv) {
      try {
        const h = (JSON.parse(mv) as { schema?: { content?: { hover?: string } } }).schema?.content?.hover;
        if (h) hover = collapse(parse(`<div>${h}</div>`).text);
      } catch { /* not JSON: ignore */ }
    }
    const hoverUpgrade = hover?.match(/Private Upgrade\s*=?\s*\+\s*€\s*([\d.,]+)/i);
    out.push({
      name: name.replace(/\s*\(standard\)\s*$/i, ''),
      key: name.toLowerCase().replace(/\(standard\)/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
      beds: beds ? `${beds[1]} single beds` : null,
      price: parseAmount(pm[1])!,
      currency: 'EUR',
      occupancy: beds ? +beds[1] : null,
      note: upgrade
        ? `private upgrade + EUR ${parseAmount(upgrade[1])}${hoverUpgrade && parseAmount(hoverUpgrade[1]) !== parseAmount(upgrade[1]) ? ` (the room's hover text says + EUR ${parseAmount(hoverUpgrade[1])})` : ''}`
        : (/booked per bed/i.test(desc) ? 'booked per bed' : null),
      hover,
    });
  }
  return out;
}

export function buildTwtsGrSlots(dates: TwtsGrDate[], rooms: TwtsGrRoom[], today: string): Slot[] {
  const slots: Slot[] = [];
  for (const d of dates) {
    if (d.start < today) continue;
    for (const r of rooms) {
      slots.push({
        key: `${r.key}|${d.start}`,
        startDate: d.start,
        endDate: d.end,
        unit: `${r.name}${r.beds ? ` (${r.beds})` : ''}`,
        price: r.price,
        currency: r.currency,
        priceUnit: 'package',
        priceBasis: 'person',
        occupancy: r.occupancy,
        availability: 'unknown',
        availabilityText: `EUR ${r.price} p.p.${r.note ? `; ${r.note}` : ''}; booked online via Bookinglayer (not read); the page says "Limited availability", 13 spots in total`,
        spotsLeft: null,
      });
    }
  }
  return slots;
}

export async function fetchTwtsGrSlots(ctx: FetchContext, today = todayIso()): Promise<Slot[]> {
  const html = await page(TWTS_GR_URL);
  const dates = parseTwtsGrDates(html);
  const rooms = parseTwtsGrRooms(html);
  if (dates.length === 0) throw new Error('toowettoshred-greece: no dated week in the visible text (layout changed?)');
  if (rooms.length === 0) throw new Error('toowettoshred-greece: no room blurbs with a p.p. price (layout changed?)');
  const past = dates.filter(d => d.start < today);
  if (past.length) ctx.note(`past date(s) dropped: ${past.map(d => d.raw).join('; ')}`);
  const slots = buildTwtsGrSlots(dates, rooms, today);
  if (slots.length === 0) ctx.note('no future camp week printed yet');
  return slots;
}

// --- content ----------------------------------------------------------------------------------------------------------
/** Lists that follow the "included" / "Not included" / "Add-ons" heading modules. */
export function parseTwtsGrLists(html: string): { included: string[]; excluded: string[]; addons: string[] } {
  const mods = body(html).querySelectorAll('.et_pb_text_inner');
  const out = { included: [] as string[], excluded: [] as string[], addons: [] as string[] };
  for (let i = 0; i + 1 < mods.length; i++) {
    const head = txt(mods[i]);
    if (head.length > 40 || mods[i].querySelector('ul')) continue;
    const items = mods[i + 1].querySelectorAll('li').map(li => txt(li)).filter(Boolean);
    if (!items.length) continue;
    if (/not included$/i.test(head)) out.excluded = items;
    else if (/included$/i.test(head)) out.included = items;
    else if (/add-ons$/i.test(head)) out.addons = items;
  }
  return out;
}

export function parseTwtsGrContent(html: string, today = todayIso()): OfferContent {
  const b = body(html);
  const text = txt(b);
  const dates = parseTwtsGrDates(html);
  const rooms = parseTwtsGrRooms(html);
  const lists = parseTwtsGrLists(html);
  const future = dates.filter(d => d.start >= today);
  const nights = future[0] ? Math.round((Date.parse(future[0].end) - Date.parse(future[0].start)) / 86400000) : (Number(text.match(/(\d+) nights in a beachfront/i)?.[1]) || 8);
  const fmt = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const summary = [
    `Too Wet to Shred runs a one-week kite camp in Fanes on the west coast of Rhodes, staying in a basic hotel right behind the beach next to Club Meltemi's kite station, with daily Meltemi wind of 15 to 25 knots and no wetsuit needed.`,
    `The ${nights} nights include breakfast and dinner, airport transfers, kite storage and rescue, two clinics with coaching, day trips to Prasonisi and Rhodes old town, two Greek dinners in town and yoga; the focus is on intermediate and independent riders, beginners can add a lesson pack.`,
    rooms.length ? `Per person: ${rooms.map(r => `${r.name.toLowerCase()} EUR ${r.price}`).join(', ')}; gear rental and lessons are add-ons.` : '',
    future.length
      ? `Next camp: ${future.map(d => `${fmt(d.start)} - ${fmt(d.end)}`).join(', ')} (13 spots).`
      : `Runs every summer; the next dates are not published yet${dates.length ? ` (${dates.map(d => d.raw).join(', ')})` : ''}.`,
  ].filter(Boolean).join(' ');

  const rms: ContentRoom[] = rooms.map(r => ({ name: r.name, description: r.hover, features: [r.beds, 'Own shower and toilet', 'Towels', 'Cleaning'].filter((x): x is string => !!x) }));
  const imageUrls = imageCandidates(html, TWTS_GR_URL, null, 40).filter(u => !/logo|icon|favicon|flag|sweater|t-shirt|shirt|unsplash/i.test(u));
  return {
    kind: 'camp',
    title: 'Too Wet to Shred Kite Camp Greece, Fanes (Rhodes)',
    summary,
    continent: 'Europe',
    country: 'Greece',
    region: 'Dodecanese',
    spot: 'Fanes, Rhodes',
    // no spotCoords: the site prints none (michaels-kite-vacancies-rhodes pins "Fanes, Rhodes" by hand; the ingest may need the same pin)
    itinerarySpots: [],
    durationDays: nights + 1,
    skillLevels: ['intermediate', 'advanced'],
    kiteLessons: true,
    equipmentRental: true,
    beginnerFriendly: /lessons for beginners/i.test(text),
    includedServices: lists.included.filter(i => !/fun\b|baby|kite kite/i.test(i)), // drop the playful filler lines
    optionalServices: lists.addons,
    accommodation: 'basic beachfront kite hotel next to Club Meltemi (twin or triple rooms with own bathroom)',
    mealPlan: 'half_board',
    languages: ['en'],
    rooms: rms,
    imageUrls,
    heroVideoUrl: null,
    sourceUrl: TWTS_GR_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      `page: ${text}`,
      `not included: ${lists.excluded.join(' | ')}`,
      `parsed dates: ${dates.map(d => `${d.start}..${d.end}`).join(', ')}; rooms: ${rooms.map(r => `${r.name} EUR ${r.price}${r.note ? ` (${r.note})` : ''}`).join('; ')}`,
    ].join('\n'),
  };
}

export const toowettoshredKiteCampFanes: OfferAdapter = {
  key: 'toowettoshred-kite-camp-fanes',
  name: 'Too Wet to Shred - Kite Camp Greece (Fanes, Rhodes)',
  kind: 'camp',
  operator: {
    name: 'Too Wet to Shred',
    websiteUrl: 'https://www.toowettoshred.com',
    rootDomain: 'toowettoshred.com',
    contactEmail: 'never@toowettoshred.com',
    phone: '+31633023099',
  },
  url: TWTS_GR_URL,
  slotMethod: 'html_dates',
  fetchBudget: 2,
  async fetchContent() {
    return parseTwtsGrContent(await page(TWTS_GR_URL));
  },
  fetchSlots: ctx => fetchTwtsGrSlots(ctx),
};
