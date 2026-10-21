// ---------------------------------------------------------------------------
// Surf House Chałupy 3 (Chałupy, Hel Peninsula, Poland) - container rooms built in 2025 next to the office of the
// Kite Zone kite school (in Chałupy 3 since 1999) on the Chałupy 3 campsite, a few steps from Puck Bay: 2 double
// and 2 four-bed rooms, bookable whole or per bed (hostel style), covered common area. Kite link: the school next
// door (kitesurf, wing and surf courses, North / Naish / Cabrinha rental); courses include free nights.
//
// Liveness (2026-10-12): the home page (dateModified 2026-02-16) promotes the Surf House ("NOCLEG ZAREZERWUJ",
//   "DARMOWY NOCLEG do kursu") next to "obozów na sezon 2026"; other 2026 edits (Rekrutacja 2026, Pro Camp 2026-03).
//   The Surf House page itself was last edited 2025-02-17.
// Data path (checked 2026-10-12): WordPress / Elementor, Polish only.
//   slots    /surf-house/: "CENNIK LOW SEASON" (subtitle "MAJ, CZERWIEC *z wyłączeniem terminu 04-07.06 (Boże
//            Ciało)") and "CENNIK HIGH SEASON" ("LIPIEC, SIERPIEŃ, WRZESIEŃ 20% rabatu dla kursantów Kite Zone &
//            Paliki Surf"); per unit an <h4> name ("ŁÓŻKO", "POKÓJ 2-OSOBOWY", "POKÓJ 4-OSOBOWY") followed by an <h4>
//            price ("100 ZŁ / DOBA", "<del>150 ZŁ</del> 120 ZŁ / DOBA" = regular price struck through, course
//            participants' price after it).
//   content  /surf-house/ (rooms, rules, check-in, what the price includes, parking, free-night promotion) and the
//            home page (school facts, the Surf House teaser, its dateModified).
// Booking engine: the ZAREZERWUJ buttons open mobile-calendar.com/booking-engine/ - robots.txt disallows
//   /booking-engine/ (and /widget/) -> not called, availability 'unknown'.
// robots.txt (2026-10-12): kitesurf.pl disallows only WooCommerce upload folders and /wp-admin/.
// Requests per run: 2 (surf-house + home, memoised; content and slots share them).
// Year: the price table has no year. Like other year-less tables (docs/offer-adapters.md) its months are anchored on
//   a dateModified: the Surf House page's own, or the home page's when that is newer and still shows the Surf House
//   (2026-02-16 on 2026-10-12, inferred: the unchanged table was the live offer of that season). One 12-month cycle
//   from the season that contains or follows the anchor.
// Parsed: slot = unit x season band ("bed|2026-07-01"), PLN per night ("DOBA"); the bed is priced per person, the
//   rooms per room; price = the regular (struck-through) price, the 20% course-participant price goes into the room
//   features (inferred from the subtitle). Corpus Christi 04-07.06 has no price and no band.
// Known limits: all 2026 bands ended by 2026-10-12 ("price on request" until the page or the home page is edited for
//   2027); no map pin on the site (the contact page embeds a Google My Maps without coordinates).
// Uses the Polish date-range helpers exported by kite-pl-caravans-chalupy.
// ---------------------------------------------------------------------------
import { clean, imageCandidates, iso, jsonLd, parseAmount, runsOf } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot, SlotPriceBasis } from '../types.js';
import { eachDay, getPage, inRange, plLines, plRanges } from './kite-pl-caravans-chalupy.js';

const SITE = 'https://www.kitesurf.pl';
export const SH_PAGE_URL = `${SITE}/surf-house/`;
export const SH_HOME_URL = `${SITE}/`;
const BOOKING_URL = 'https://www.mobile-calendar.com/booking-engine/?id=764923052f2d769744ea244f848a6140522f9&view=kalendarz';

const MIESIAC: Record<string, number> = {
  'styczeń': 1, luty: 2, marzec: 3, 'kwiecień': 4, maj: 5, czerwiec: 6, lipiec: 7, 'sierpień': 8, 'wrzesień': 9, 'październik': 10, listopad: 11, 'grudzień': 12,
};
const MONTH_EN = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const lastDay = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate();

export interface ShUnit { key: string; name: string; basis: SlotPriceBasis; occupancy: number; price: number; reduced: number | null; raw: string }
export interface ShSeason { label: 'low' | 'high'; months: number[]; exclusions: string[]; note: string; units: ShUnit[] }

const UNIT: Array<[RegExp, Omit<ShUnit, 'price' | 'reduced' | 'raw'>]> = [
  [/^ŁÓŻKO$/i, { key: 'bed', name: 'Bed in a shared room', basis: 'person', occupancy: 1 }],
  [/^POKÓJ 2-OSOBOWY$/i, { key: 'double', name: 'Double room', basis: 'room', occupancy: 2 }],
  [/^POKÓJ 4-OSOBOWY$/i, { key: 'quad', name: 'Four-bed room', basis: 'room', occupancy: 4 }],
];

/** The two "CENNIK ... SEASON" blocks: months from the subtitle, units from the <h4> pairs. */
export function parseShSeasons(html: string): ShSeason[] {
  const out: ShSeason[] = [];
  const marks = [...html.matchAll(/CENNIK (LOW|HIGH) SEASON/g)];
  marks.forEach((m, i) => {
    const end = marks[i + 1]?.index ?? html.indexOf('>INFO<', m.index);
    const seg = html.slice(m.index, end > m.index ? end : undefined);
    const sub = seg.match(/<span class="section-title-post[^>]*>([\s\S]*?)<\/span>/)?.[1] ?? '';
    const subLines = sub.split(/<br\s*\/?>/i).map(s => clean(s.replace(/<[^>]+>/g, ' ')));
    const months = (subLines[0] ?? '').toLowerCase().split(/[,\s]+/).map(w => MIESIAC[w]).filter((x): x is number => !!x);
    const exclusions = subLines.slice(1).filter(l => /wyłączeniem/i.test(l));
    const heads = [...seg.matchAll(/<h4[^>]*>([\s\S]*?)<\/h4>/g)].map(h => h[1]);
    const units: ShUnit[] = [];
    for (let j = 0; j < heads.length - 1; j++) {
      const name = clean(heads[j].replace(/<[^>]+>/g, ' '));
      const def = UNIT.find(([re]) => re.test(name))?.[1];
      if (!def || !/ZŁ/i.test(heads[j + 1])) continue;
      const del = heads[j + 1].match(/<del>([\s\S]*?)<\/del>/i);
      const after = del ? heads[j + 1].slice(heads[j + 1].indexOf(del[0]) + del[0].length) : heads[j + 1];
      const current = parseAmount(clean(after.replace(/<[^>]+>/g, ' ')));
      const regular = del ? parseAmount(clean(del[1])) : current;
      if (!regular) continue;
      units.push({ ...def, price: regular, reduced: del && current && current < regular ? current : null, raw: clean(heads[j + 1].replace(/<[^>]+>/g, ' ')) });
      j++;
    }
    out.push({ label: m[1].toLowerCase() as 'low' | 'high', months, exclusions, note: subLines.slice(1).join(' '), units });
  });
  return out;
}

/** dateModified of the page's WebPage JSON-LD (Yoast). */
export function shModified(html: string): string | null {
  const page = jsonLd(html).find(o => o['@type'] === 'WebPage' && typeof o.dateModified === 'string');
  return page ? String(page.dateModified).slice(0, 10) : null;
}

/** Year anchor: the Surf House page's edit, or the home page's when newer and it still shows the Surf House. */
export function shAnchor(page: string, home: string | null): string | null {
  const own = shModified(page);
  const h = home && /Surf House/i.test(home) ? shModified(home) : null;
  return [own, h].filter((x): x is string => !!x).sort().reverse()[0] ?? null;
}

export interface ShBand { season: ShSeason; start: string; end: string }

/** Month seasons -> dated bands (exclusions cut out) for one 12-month cycle from the season containing/after `anchor`. */
export function shBands(seasons: ShSeason[], anchor: string): ShBand[] {
  const y0 = Number(anchor.slice(0, 4));
  const all: ShBand[] = [];
  for (const s of seasons) {
    if (!s.months.length) continue;
    for (const y of [y0, y0 + 1]) {
      const ex = s.exclusions.flatMap(e => plRanges(e, y));
      const days = s.months.flatMap(m => eachDay(iso(y, m, 1), iso(y, m, lastDay(y, m))))
        .filter(d => !ex.some(r => inRange(d, r))).map(date => ({ date }));
      for (const r of runsOf(days, () => s.label)) all.push({ season: s, start: r.start, end: r.end });
    }
  }
  all.sort((a, b) => a.start.localeCompare(b.start));
  const first = all.find(b => b.end >= anchor);
  if (!first) return [];
  const cycleEnd = iso(Number(first.start.slice(0, 4)) + 1, Number(first.start.slice(5, 7)), 1);
  return all.filter(b => b.start >= first.start && b.start < cycleEnd);
}

export function buildShSlots(seasons: ShSeason[], anchor: string): Slot[] {
  return shBands(seasons, anchor).flatMap(b => b.season.units.map(u => ({
    key: `${u.key}|${b.start}`,
    startDate: b.start,
    endDate: b.end,
    unit: u.name,
    price: u.price,
    currency: 'PLN',
    priceUnit: 'per_night' as const,
    priceBasis: u.basis,
    occupancy: u.occupancy,
    availability: 'unknown' as const,
    availabilityText: null,
    spotsLeft: null,
  })));
}

export function parseSurfHouseContent(page: string, home: string): OfferContent {
  const t = plLines(page).join('\n');
  const h = plLines(home).join('\n');
  const seasons = parseShSeasons(page);
  const low = seasons.find(s => s.label === 'low');
  const high = seasons.find(s => s.label === 'high');
  const built = t.match(/zbudowane w (20\d{2}) roku/i)?.[1] ?? null;
  const since = h.match(/od (19\d{2}|20\d{2})\s*r\./i)?.[1] ?? null;
  const n2 = Number(t.match(/(\d)x pokój 2-osobowy/i)?.[1] ?? NaN) || null;
  const n4 = Number(t.match(/(\d)x pokój 4-osobowy/i)?.[1] ?? NaN) || null;
  const cleaning = t.match(/mniej niż (\d+) doby doliczamy \+(\d+) zł/i);
  const free1 = t.match(/WARIANT I\s*[–-]\s*darmowy nocleg do kursu za min\. (\d+)zł \(max\. (\d+) noce\)/i);
  const free2 = t.match(/WARIANT II\s*[–-]\s*darmowy nocleg do kursu za min\. (\d+)zł \(max\. (\d+) nocy\)/i);
  const discount = high?.note.match(/(\d+)% rabatu dla kursantów ([^<]+)/i);
  const months = (s?: ShSeason) => (s ? s.months.map(m => MONTH_EN[m]).join(', ').replace(/, ([^,]*)$/, ' and $1') : '');
  const prices = (s?: ShSeason) => (s ? s.units.map(u => `PLN ${u.price} for a ${u.name.toLowerCase()}`).join(', ') : '');
  const fmt = (n: number) => n.toLocaleString('en-US');

  const rooms: ContentRoom[] = UNIT.map(([, def]) => {
    const lo = low?.units.find(u => u.key === def.key);
    const hi = high?.units.find(u => u.key === def.key);
    const count = def.key === 'double' ? n2 : def.key === 'quad' ? n4 : null;
    return {
      name: def.name,
      description: def.key === 'bed'
        ? 'Single bed in one of the rooms, shared with other guests like a hostel.'
        : `${count ? `${count} ${def.occupancy === 2 ? 'double' : 'four-bed'} rooms` : 'Room'} in the Surf House containers, bookable as a whole.`,
      features: [
        'Comfortable beds, locker, bedside lamp, heater',
        'Covered common area',
        ...(lo ? [`Low season (${months(low)}): PLN ${lo.price} per night${def.basis === 'person' ? ' per bed' : ''}`] : []),
        ...(hi ? [`High season (${months(high)}): PLN ${hi.price} per night${hi.reduced ? `, PLN ${hi.reduced} for ${discount ? 'Kite Zone and Paliki Surf course participants' : 'course participants'}` : ''}`] : []),
      ],
    };
  }).filter(r => r.features.length > 2);

  const imageUrls: string[] = [];
  for (const u of imageCandidates(page, SH_PAGE_URL, null, 60)) {
    if (!/surf-house|Nocleg/i.test(u) || /logo|\.svg|icon/i.test(u)) continue;
    if (!imageUrls.includes(u)) imageUrls.push(u);
  }

  const summary = [
    `Surf House Chałupy 3 is the guest accommodation of the Kite Zone kite school${since ? ` (on the Chałupy 3 campsite since ${since})` : ''} on the Hel Peninsula: modern containers${built ? ` built in ${built}` : ''} next to the school office, a few steps from the Puck Bay kite spot, with ${n2 ?? 2} double and ${n4 ?? 2} four-bed rooms that can be booked whole or per bed like a hostel, plus a covered common area.`,
    low && high ? `Per night it costs ${prices(low)} in ${months(low)} (except Corpus Christi) and ${prices(high)} in ${months(high)}${discount ? `, ${discount[1]}% less for the school's course participants` : ''}; climate and campsite fees are included, parking is not${cleaning ? `, and stays under ${cleaning[1]} nights pay PLN ${cleaning[2]} for cleaning` : ''}.` : null,
    `Kite Zone teaches kitesurfing, wingfoiling and surfing from May to September and rents North, Naish and Cabrinha kites${free1 && free2 ? `; a course from PLN ${fmt(Number(free1[1]))} includes up to ${free1[2]} free nights here (from PLN ${fmt(Number(free2[1]))}: up to ${free2[2]}) in May, June and September` : ''}.`,
  ].filter(Boolean).join(' ');

  return {
    kind: 'accommodation',
    title: 'Surf House Chałupy 3 (Kite Zone)',
    summary,
    continent: 'Europe',
    country: 'Poland',
    region: 'Chałupy, Hel Peninsula',
    spot: 'Chałupy',
    itinerarySpots: [],
    durationDays: null,
    skillLevels: /na wszystkich poziomach zaawansowania/i.test(h) ? ['beginner', 'intermediate', 'advanced'] : [],
    kiteLessons: /kursy kitesurfingu/i.test(h),
    equipmentRental: /wypożyczalnia sprzętu kite/i.test(h),
    beginnerFriendly: null,
    includedServices: ['Bed or whole room', 'Climate and campsite fees', 'Sanitary facilities', 'Electricity'],
    optionalServices: [
      'Kitesurf, wingfoil and surf courses at Kite Zone (Paliki Surf)',
      'Kite, surf and wing equipment rental (North, Naish, Cabrinha)',
      ...(free1 ? [`Free nights with a course from PLN ${free1[1]} (max ${free1[2]} nights${free2 ? `; from PLN ${free2[1]}: max ${free2[2]} nights` : ''}), May, June and September`] : []),
      'Guarded parking near beach access no. 10 (paid, not on site in July-August)',
    ],
    accommodation: 'container rooms and hostel beds next to the kite school',
    mealPlan: 'self_catering',
    languages: ['pl'],
    rooms,
    imageUrls: imageUrls.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: SH_PAGE_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      `surf house: ${(t.match(/Nowa baza noclegowa[\s\S]*?szkola@kitesurf\.pl/) ?? [t.slice(0, 6000)])[0]}`,
      `home (Surf House + school): ${(h.match(/NASZA OFERTA[\s\S]*?Nauka Surfingu/) ?? [''])[0]}`,
      `seasons: ${seasons.map(s => `${s.label} months ${s.months.join('/')} ${s.note} | ${s.units.map(u => `${u.key} ${u.raw}`).join('; ')}`).join(' || ')}`,
      `dateModified: surf-house ${shModified(page)}, home ${shModified(home)}`,
    ].join('\n'),
  };
}

export async function fetchShSlots(): Promise<Slot[]> {
  const [page, home] = [await getPage(SH_PAGE_URL), await getPage(SH_HOME_URL)];
  const seasons = parseShSeasons(page);
  if (seasons.length < 2 || seasons.some(s => !s.units.length || !s.months.length)) {
    throw new Error(`surf-house-kite-zone-chalupy: price blocks changed (${seasons.map(s => `${s.label}:${s.months.length}m/${s.units.length}u`).join(', ') || 'none'})`);
  }
  const anchor = shAnchor(page, home);
  if (!anchor) throw new Error('surf-house-kite-zone-chalupy: no dateModified to anchor the year-less table');
  return buildShSlots(seasons, anchor);
}

export const surfHouseKiteZoneChalupy: OfferAdapter = {
  key: 'surf-house-kite-zone-chalupy',
  name: 'Surf House Chałupy 3 (Kite Zone)',
  kind: 'accommodation',
  disciplines: ['kitesurf', 'wingfoil'],
  operator: {
    name: 'Kite Zone',
    websiteUrl: SITE,
    rootDomain: 'kitesurf.pl',
    contactEmail: 'szkola@kitesurf.pl',
    phone: '+48 602 833 224',
  },
  url: SH_PAGE_URL,
  slotMethod: 'price_table',
  fetchBudget: 3,
  confidence: 'low',
  async fetchContent() {
    const [page, home] = [await getPage(SH_PAGE_URL), await getPage(SH_HOME_URL)];
    return parseSurfHouseContent(page, home);
  },
  async fetchSlots() {
    return fetchShSlots();
  },
};
