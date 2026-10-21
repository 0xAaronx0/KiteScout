// ---------------------------------------------------------------------------
// Pallas Kiteweek, Pallastunturi (Finnish Lapland) - a week of SNOWKITING (kiting on snow, not water) organised every
// February by Kiteschool Lappis (Oulu; a kite school since 2006). Everyone stays at Lapland Hotels Pallas, a short walk from the
// launch area, 7 nights with breakfast and dinner and the hotel facilities (sauna, gear rooms). Participants kite on
// their own; lessons, flexible instruction, mountain guidance and gear rental are optional add-ons arranged in advance.
//
// Data path (checked 2026-10-19):
//   slots    pallaskiteweek.com/kiteweek/ (WordPress, server-rendered): the "Pricelist" plans (rpt_plan):
//            "Full Kiteweek (7 nights)" / "13.–20.2.2027" / "Prices per person including accommodation, breakfast, dinner
//            and use of hotel facilities." / "Singleroom 1395€", "2 Person room 895€", "3 Person room 850€",
//            "4 Person room 840€"; plus "Custom duration" per-night prices (optional service).
//            One slot per room type for the dated week, EUR per person (package, 7 nights), occupancy = room size.
//   content  the same page + /portfolio/ (photos) + the shop page lappis.johku.com/en_US/kurssit/pallas-kite-week
//            (Johku webshop: description, deposit wording, photos).
// Booking: the "Book" buttons open the Johku shop, which takes a EUR 50 per person deposit online for a room
//   (rooms "Pallas Kite Week standard 1-22 / single 1-8 / Family 1-3"); availability per room is loaded by the shop's
//   own scripts and not read here -> availability 'unknown', liveAvailability unset. Whether the deposit checkout
//   confirms instantly was not verified -> instantBooking unset (flagged).
// robots.txt (2026-10-19): pallaskiteweek.com only /wp-admin/; lappis.johku.com "Allow: /" except /*/proposal/.
// Requests per run: content 3, slots 1 (memoised: 0 extra when content ran in the same process).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, imageCandidates, iso, parse, parseAmount, todayIso, type HTMLElement } from '../parse.js';
import type { FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.pallaskiteweek.com';
export const PKW_URL = `${SITE}/kiteweek/`;
export const PKW_PORTFOLIO_URL = `${SITE}/portfolio/`;
export const PKW_SHOP_URL = 'https://lappis.johku.com/en_US/kurssit/pallas-kite-week';

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

/** "13.–20.2.2027", "27.2.–6.3.2027" */
export function parseDotRange(text: string): { start: string; end: string } | null {
  const m = text.replace(/[–—]/g, '-').match(/(\d{1,2})\.(?:(\d{1,2})\.)?\s*-\s*(\d{1,2})\.(\d{1,2})\.\s*(20\d{2})/);
  if (!m) return null;
  const y = Number(m[5]);
  const m2 = Number(m[4]);
  const m1 = m[2] ? Number(m[2]) : m2;
  return { start: iso(m1 > m2 ? y - 1 : y, m1, Number(m[1])), end: iso(y, m2, Number(m[3])) };
}

// --- pure parsers -----------------------------------------------------------------------------
export interface PkwRoom { label: string; occupancy: number | null; price: number; currency: string }
export interface PkwPlan { title: string; subtitle: string; description: string; nights: number | null; perNight: boolean; rooms: PkwRoom[]; lines: string[] }

/** The pricing-table plans ("Full Kiteweek (7 nights)", "Custom duration", then rental and lesson extras). */
export function parsePkwPlans(html: string): PkwPlan[] {
  const out: PkwPlan[] = [];
  for (const plan of parse(html).querySelectorAll('.rpt_plan')) {
    const title = txt(plan.querySelector('.rpt_title'));
    const description = txt(plan.querySelector('.rpt_description'));
    const rooms: PkwRoom[] = [];
    const lines = plan.querySelectorAll('.rpt_feature').map(f => txt(f)).filter(Boolean);
    for (const t of lines) {
      const m = t.match(/^(.*?)\s*([\d.,]+)\s*(€|EUR)$/i) ?? t.match(/^(.*?)\s*(?:€|EUR)\s*([\d.,]+)$/i);
      const price = m ? parseAmount(m[2]) : null;
      if (!m || !price) continue;
      const label = collapse(m[1]);
      const occ = /single/i.test(label) ? 1 : Number(label.match(/(\d+)\s*person/i)?.[1] ?? NaN);
      rooms.push({ label, occupancy: Number.isFinite(occ) ? occ : null, price, currency: 'EUR' });
    }
    out.push({
      title,
      subtitle: txt(plan.querySelector('.rpt_subtitle')),
      description,
      nights: Number(title.match(/(\d+)\s*nights?/i)?.[1] ?? NaN) || null,
      perNight: /per night/i.test(description),
      rooms,
      lines,
    });
  }
  return out;
}

const roomUnit = (r: PkwRoom): string => (r.occupancy === 1 ? 'Single room' : r.occupancy ? `${r.occupancy}-person room` : r.label);

export function buildPkwSlots(plans: PkwPlan[], today: string): Slot[] {
  const out: Slot[] = [];
  for (const p of plans) {
    if (p.perNight) continue;
    const r = parseDotRange(p.subtitle);
    if (!r || r.start < today) continue;
    for (const room of p.rooms) {
      out.push({
        key: `${r.start}|${room.occupancy ? `${room.occupancy}p` : room.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        startDate: r.start,
        endDate: r.end,
        unit: `${roomUnit(room)}, breakfast and dinner`,
        price: room.price,
        currency: room.currency,
        priceUnit: 'package',
        priceBasis: /per person/i.test(p.description) ? 'person' : null,
        occupancy: room.occupancy,
        availability: 'unknown',
        availabilityText: 'Booked online in the Lappis shop with a EUR 50 deposit per person; room availability not read',
        spotsLeft: null,
        packageNights: p.nights,
      });
    }
  }
  return out;
}

export interface PkwPages { kiteweek: string; portfolio: string; shop: string }

export function parsePkwContent(p: PkwPages, today = todayIso()): OfferContent {
  const plans = parsePkwPlans(p.kiteweek);
  const week = plans.find(x => !x.perNight && parseDotRange(x.subtitle));
  const range = week ? parseDotRange(week.subtitle) : null;
  const custom = plans.find(x => x.perNight);
  const extras = plans.filter(x => x !== week && x !== custom && x.lines.length);
  const root = parse(p.kiteweek);
  for (const el of root.querySelectorAll('script, style, noscript, svg, header, footer, nav')) el.remove();
  const text = txt(root.querySelector('.entry-content') ?? root.querySelector('main') ?? root);
  const shopRoot = parse(p.shop);
  const shopText = txt(shopRoot.querySelector('.product-content-description'));
  const fmt = (n: number): string => n.toLocaleString('en-US');
  const day = (d: string): string => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  const nights = week?.nights ?? 7;
  const cheapest = week?.rooms.length ? week.rooms.reduce((a, b) => (b.price < a.price ? b : a)) : null;
  const single = week?.rooms.find(r => r.occupancy === 1);

  const imageUrls = [...new Set([
    ...imageCandidates(p.kiteweek, PKW_URL, null, 20),
    ...imageCandidates(p.portfolio, PKW_PORTFOLIO_URL, null, 60),
    ...imageCandidates(p.shop, PKW_SHOP_URL, null, 20),
  ])].filter(u => /\/wp-content\/uploads\/|cdn\.johku\.com\/lappis\/(?:files|largefiles)\/(?!138\/)/.test(u) && !/og_image|logo|favicon|\.png$/i.test(u))
    .slice(0, 30);

  const summary = [
    'Pallas Kiteweek is a week of snowkiting - kiting on snow with skis or a snowboard, not on water - on the fells of Pallastunturi in Finnish Lapland, organised every February by Kiteschool Lappis.',
    `Everyone stays together at Lapland Hotels Pallas, a short walk from the launch area, for ${nights} nights with breakfast, dinner and the hotel's sauna and gear rooms; participants kite on their own, and lessons, mountain guidance and rental gear can be booked as extras.`,
    cheapest ? `Prices per person run from EUR ${fmt(cheapest.price)} in a shared room${single ? ` to EUR ${fmt(single.price)} in a single room` : ''}; shorter stays are priced per night.` : '',
    range && range.start >= today
      ? `Next week: ${day(range.start)} to ${day(range.end)}, booked in the Lappis online shop with a EUR 50 deposit per person.`
      : range ? `The ${range.start.slice(0, 4)} week (${day(range.start)}) is over; the next date is not published yet.` : 'Booking is in the Lappis online shop.',
  ].filter(Boolean).join(' ');

  return {
    kind: 'camp',
    title: 'Pallas Kiteweek, Finnish Lapland',
    summary,
    continent: 'Europe',
    country: 'Finland',
    region: 'Lapland',
    spot: 'Pallastunturi, Lapland',
    spotCoords: null,
    itinerarySpots: [],
    durationDays: nights + 1,
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: true, // optional, arranged in advance
    equipmentRental: /gear rental|rental equipment/i.test(`${text} ${shopText}`),
    beginnerFriendly: /beginners can join/i.test(shopText),
    includedServices: [
      `${nights} nights at Lapland Hotels Pallas`,
      'Breakfast and dinner',
      'Use of the hotel facilities (sauna, gear service rooms, storage)',
    ],
    optionalServices: [
      ...extras.flatMap(x => x.lines.map(l => `${x.title}: ${l.replace(/\s*\*\s*recom+ended\s*\*\s*/i, ' ').replace(/(\d)€/g, '$1 EUR').replace(/\s+/g, ' ')}`)),
      ...(extras.length ? [] : ['Snowkite lessons, mountain guidance and gear rental (arranged in advance)']),
      'No-wind activities (speedriding and other winter activities)',
      ...(custom ? custom.rooms.map(r => `Shorter stay within the week: ${roomUnit(r).toLowerCase()} EUR ${fmt(r.price)} per person per night`) : []),
    ],
    accommodation: 'Lapland Hotels Pallas (single, double, triple or 4-person rooms)',
    mealPlan: 'half_board',
    languages: ['fi', 'en'],
    rooms: [],
    imageUrls,
    heroVideoUrl: null,
    sourceUrl: PKW_URL,
    bookingUrl: PKW_SHOP_URL,
    sourceText: [
      ...plans.map(x => `${x.title} | ${x.subtitle} | ${x.description} | ${x.rooms.map(r => `${r.label} ${r.price} ${r.currency}`).join('; ')}`),
      `kiteweek page: ${text}`,
      `shop: ${shopText}`,
    ].join('\n'),
  };
}

export async function fetchPkwSlots(today: string, ctx?: Pick<FetchContext, 'note'>): Promise<Slot[]> {
  const plans = parsePkwPlans(await page(PKW_URL));
  const week = plans.find(x => !x.perNight && parseDotRange(x.subtitle));
  if (!week || !week.rooms.length) throw new Error(`pallas-kiteweek: dated price plan not found (${plans.length} plans parsed)`);
  const slots = buildPkwSlots(plans, today);
  if (!slots.length) ctx?.note(`the published week (${week.subtitle}) is past; next date not published yet`);
  return slots;
}

// --- adapter ----------------------------------------------------------------------------------
export const pallasKiteweekLappisPallas: OfferAdapter = {
  key: 'pallas-kiteweek-lappis-pallas',
  name: 'Pallas Kiteweek (Kiteschool Lappis), Pallastunturi',
  kind: 'camp',
  disciplines: ['snowkite'],
  operator: {
    name: 'Kiteschool Lappis',
    websiteUrl: 'https://www.lappis.fi/',
    rootDomain: 'lappis.fi',
    contactEmail: 'harri.rautava@lappis.fi',
    phone: '+358 41 433 8602',
    whatsapp: '+358414338602',
  },
  url: PKW_URL,
  slotMethod: 'price_table',
  fetchBudget: 4,
  async fetchContent() {
    const kiteweek = await page(PKW_URL);
    const portfolio = await page(PKW_PORTFOLIO_URL);
    const shop = await page(PKW_SHOP_URL);
    return parsePkwContent({ kiteweek, portfolio, shop });
  },
  fetchSlots: ctx => fetchPkwSlots(todayIso(), ctx),
};
