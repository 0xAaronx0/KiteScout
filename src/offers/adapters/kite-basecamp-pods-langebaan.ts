// ---------------------------------------------------------------------------
// Kite Basecamp PODS, Langebaan (Western Cape, South Africa) - container pods for kiters in the boat yard of The
// Farmhouse Hotel (Myburgh Park), 2 beds per pod, private deck with BBQ, shared ablution pod, kite drying space and a
// cliff path down to Shark Bay; "No wind - no pay" cancellation for kitesurfers.
//
// Liveness (checked 2026-10-12): the rate table names the years 2026 and 2027 (periods up to "1 Oct - 17 Dec" 2027);
//   WordPress page modified 2026-09-17T08:31:49 (wp-json); photo uploads 2025/12 and 2026/04; footer
//   "Copyright (c) Kite Basecamp 2026".
// Kite link: "our PODS are clean, well equipped and set up with kiters in mind", "ample kite drying space and close
//   proximity to Langebaans best kiting spots", "Cliff Path that leads directly to Shark Bay (our favourite kite spot)",
//   No Wind - No Pay policy for kitesurfer bookings.
//
// Data path (checked 2026-10-12): kitebasecamp.com is a one-page WordPress site (Revolution Slider).
//   content  / : intro, "STAY" block, "Enjoy:" list, No Wind - No Pay block, contact; photos are slider
//            data-lazyload attributes (not <img src>), read locally.
//   slots    / : <table> "Year | Period | Room Type | Rate (ZAR)" - the year cell spans its rows (rowspan); periods are
//            "PEAK", "All Periods" or a day range ("1 May till 30 Sep", "4 Jan - 30 Apr"); room types "Single" / "Double"
//            (= 1 or 2 guests in a pod) or "ALL" (peak). Rates are ZAR per pod per night ("From R275 per person
//            sharing" = R550 / 2).
// Booking: "BOOK NOW" goes to Airbnb (a platform, not used); direct bookings by mail / phone -> 'on_request'.
// robots.txt (2026-10-12): only /wp-admin/ disallowed.
// Requests per run: content 1, slots 1.
// Parsed: one slot per year x period x occupancy with real date limits; periods that ended before today are dropped.
//   Inferred (the table gives no dates for them): "PEAK" = the days of that year after the last dated period
//   (19-31 Dec 2026, 18-31 Dec 2027) plus a short gap before the first dated period (1-3 Jan 2027); "All Periods" =
//   any other undated days of that year (only 1 Jan - 30 Apr 2026, already past).
// Known limits: no live availability; no minimum stay stated; the pod count is not stated on the page; the No Wind
//   policy also calls Easter and some long weekends "peak periods", which the rate table does not date, so those days
//   keep the normal period rate here.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, iso, monthOf, parseAmount, todayIso } from '../parse.js';
import type { ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://kitebasecamp.com';
export const KBC_URL = `${SITE}/`;

/** Visible text split at block tags (script/style bodies dropped). */
export function kbcLines(html: string): string[] {
  return html
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .split(/<\/?(?:p|li|td|th|tr|h\d|div|br|ul|section|article|header|footer|nav|table)\b[^>]*>/i)
    .map(s => clean(s.replace(/<[^>]+>/g, ' ')))
    .filter(Boolean);
}

// --- pure parsers -----------------------------------------------------------------------------
export interface KbcRate { year: number; period: string; roomType: string; amount: number }

/** Rows of the rate table; the year cell (rowspan) carries over to the following rows. */
export function parseKbcRates(html: string): KbcRate[] {
  const table = html.match(/<table\b[\s\S]*?<\/table>/i)?.[0];
  if (!table || !/Rate \(ZAR\)/i.test(table)) return [];
  const out: KbcRate[] = [];
  let year: number | null = null;
  for (const row of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(c => clean(c[1].replace(/<[^>]+>/g, ' ')));
    if (cells.length === 0) continue;
    if (cells.length === 4) {
      const y = Number(cells[0].match(/\b(20\d{2})\b/)?.[1]);
      if (!y) continue;
      year = y;
      cells.shift();
    }
    if (cells.length !== 3 || !year) continue;
    const amount = parseAmount(cells[2].replace(/^R\s*/i, ''));
    if (!amount) continue;
    out.push({ year, period: cells[0], roomType: cells[1], amount });
  }
  return out;
}

/** "1 May till 30 Sep", "1 Oct – 18 Dec", "4 Jan - 30 Apr" -> ISO range inside `year`. */
export function kbcRange(period: string, year: number): { start: string; end: string } | null {
  const m = period.replace(/[–—]/g, '-').match(/(\d{1,2})\s+([A-Za-z]+)\.?\s*(?:-|till|to|until)\s*(\d{1,2})\s+([A-Za-z]+)/i);
  if (!m || !monthOf(m[2]) || !monthOf(m[4])) return null;
  return { start: iso(year, monthOf(m[2])!, +m[1]), end: iso(year, monthOf(m[4])!, +m[3]) };
}

const addDays = (d: string, n: number): string => new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10);

/** Bands per year: dated periods as printed; PEAK / All Periods fill the undated days of that year (see header). */
export function buildKbcSlots(rates: KbcRate[], today: string): Slot[] {
  const out: Slot[] = [];
  for (const year of [...new Set(rates.map(r => r.year))].sort()) {
    const rows = rates.filter(r => r.year === year);
    const dated = rows.map(r => kbcRange(r.period, year)).filter((x): x is { start: string; end: string } => !!x)
      .sort((a, b) => a.start.localeCompare(b.start));
    const gaps: Array<{ start: string; end: string }> = [];
    let cursor = iso(year, 1, 1);
    for (const r of dated) {
      if (r.start > cursor) gaps.push({ start: cursor, end: addDays(r.start, -1) });
      if (addDays(r.end, 1) > cursor) cursor = addDays(r.end, 1);
    }
    if (cursor <= iso(year, 12, 31)) gaps.push({ start: cursor, end: iso(year, 12, 31) });
    const yearEnd = (g: { end: string }) => g.end === iso(year, 12, 31);
    const shortLead = (g: { start: string; end: string }) => g.start === iso(year, 1, 1) && g.end < iso(year, 1, 10);
    const peakGaps = gaps.filter(g => yearEnd(g) || shortLead(g));
    const otherGaps = gaps.filter(g => !peakGaps.includes(g));

    for (const r of rows) {
      const occ = /^single$/i.test(r.roomType) ? 1 : /^double$/i.test(r.roomType) ? 2 : null;
      const range = kbcRange(r.period, year);
      const bands = range ? [range] : /^peak$/i.test(r.period) ? peakGaps : /all periods/i.test(r.period) ? otherGaps : [];
      for (const b of bands) {
        if (b.end < today) continue;
        out.push({
          key: `pod${occ ? `-${occ}p` : ''}|${b.start}`,
          startDate: b.start,
          endDate: b.end,
          unit: 'Pod',
          price: r.amount,
          currency: 'ZAR',
          priceUnit: 'per_night',
          priceBasis: 'room',
          occupancy: occ,
          availability: 'on_request',
          availabilityText: /^peak$/i.test(r.period) ? 'Peak period' : null,
          spotsLeft: null,
        });
      }
    }
  }
  return out.sort((a, b) => (a.startDate ?? '').localeCompare(b.startDate ?? '') || a.key.localeCompare(b.key));
}

/** Slider photos: data-lazyload="//kitebasecamp.com/wp-content/uploads/..." (no logos). */
export function kbcImages(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/data-lazyload="(\/\/kitebasecamp\.com\/wp-content\/uploads\/[^"]+\.(?:jpe?g|webp))"/gi)) {
    const u = `https:${m[1]}`;
    if (/logo|mobi|cropped-|icon/i.test(u) || out.includes(u)) continue;
    out.push(u);
  }
  // newest shoot first (2026/04 pod photos, 2025/12 drone/containers), then the older slider shots
  return out.sort((a, b) => (b.match(/uploads\/(\d{4}\/\d{2})/)?.[1] ?? '').localeCompare(a.match(/uploads\/(\d{4}\/\d{2})/)?.[1] ?? ''));
}

export function parseKbcContent(html: string): OfferContent {
  const lines = kbcLines(html);
  const text = lines.join(' ');
  const rates = parseKbcRates(html);
  const enjoyAt = lines.findIndex(l => /^Enjoy:?$/i.test(l));
  const enjoyList: string[] = [];
  for (const l of enjoyAt >= 0 ? lines.slice(enjoyAt + 1, enjoyAt + 8) : []) {
    if (/^If you want|@|^\+?\d/.test(l)) break;
    enjoyList.push(l);
  }
  const fromPp = text.match(/From (R\s?\d+) per person sharing/i)?.[1] ?? null;
  const years = [...new Set(rates.map(r => r.year))];

  const rooms: ContentRoom[] = [{
    name: 'Pod',
    description: 'Container pod for 2 in the boat yard of The Farmhouse Hotel, double bed or 2 single beds.',
    features: [
      'Sleeps 2 (double bed or 2 single beds)',
      /mini fridge/i.test(text) ? 'Mini fridge' : null,
      /deck with BBQ/i.test(text) ? 'Private deck with BBQ' : null,
      /dedicated toilet and shower cubicle/i.test(text) ? 'Dedicated toilet and shower cubicle in the shared ablution pod' : null,
      fromPp ? `From ${fromPp.replace(/\s/g, ' ')} per person sharing` : null,
      ...rates.filter(r => /^peak$/i.test(r.period)).map(r => `${r.year} peak period: R${r.amount.toLocaleString('en-US')} per pod per night`),
    ].filter((x): x is string => !!x),
  }];

  const summary = [
    'Kite Basecamp is a set of container pods for kitesurfers in the boat yard of The Farmhouse Hotel in Langebaan, on South Africa\'s West Coast, with secure parking, kite drying space and a cliff path down to Shark Bay.',
    'Each pod sleeps two in a double or two single beds and has a mini fridge and a private deck with a BBQ; toilets and showers are in a shared ablution pod, and guests use the Basecamp chill zone and basic cooking facilities.',
    `Rates are per pod per night in rand${years.length ? ` and are published for ${years.join(' and ')}` : ''}, with a "no wind - no pay" policy that lets kitesurfers cancel 24 hours before check-in without losing the deposit when less than 13 knots are forecast (not at peak times).`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Kite Basecamp PODS',
    summary,
    continent: 'Africa',
    country: 'South Africa',
    region: 'Western Cape',
    spot: 'Langebaan',
    itinerarySpots: [],
    durationDays: null,
    skillLevels: [],
    kiteLessons: null,
    equipmentRental: null,
    beginnerFriendly: null,
    includedServices: enjoyList.length ? enjoyList : ['Basecamp chill zone', 'BBQ and basic cooking facilities', 'Towel and bed linen'],
    optionalServices: [/No Wind-No Pay/i.test(text) ? 'No Wind - No Pay cancellation for kitesurfer bookings (24 h before check-in, forecast below 13 knots; not at peak periods)' : null]
      .filter((x): x is string => !!x),
    accommodation: 'container pods for 2 with shared ablution pod',
    mealPlan: 'self_catering',
    languages: ['en'],
    rooms,
    imageUrls: kbcImages(html).slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: KBC_URL,
    bookingUrl: KBC_URL,
    sourceText: [
      `page: ${lines.filter(l => l.length > 20 && !/^(Copyright|Home|Select Page)/i.test(l)).join(' | ')}`,
      `rates: ${rates.map(r => `${r.year} ${r.period} ${r.roomType} R${r.amount}`).join('; ')}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const kiteBasecampPodsLangebaan: OfferAdapter = {
  key: 'kite-basecamp-pods-langebaan',
  name: 'Kite Basecamp PODS',
  kind: 'accommodation',
  operator: {
    name: 'Kite Basecamp',
    websiteUrl: SITE,
    rootDomain: 'kitebasecamp.com',
    contactEmail: 'bookings@kitebasecamp.com',
    phone: '+27723966038',
  },
  url: KBC_URL,
  slotMethod: 'price_table',
  fetchBudget: 2,
  confidence: 'medium', // dated rate table, no inventory; peak dates inferred
  async fetchContent() {
    return parseKbcContent(await fetchText(KBC_URL, { accept: 'text/html' }));
  },
  async fetchSlots(ctx: FetchContext): Promise<Slot[]> {
    const rates = parseKbcRates(await fetchText(KBC_URL, { accept: 'text/html' }));
    if (rates.length === 0) throw new Error('kite-basecamp-pods-langebaan: rate table "Rate (ZAR)" not found (layout changed?)');
    const slots = buildKbcSlots(rates, todayIso());
    if (slots.length === 0) ctx.note('rate table has no period ending today or later (new year not published yet?)');
    return slots;
  },
};
