// ---------------------------------------------------------------------------
// Kite Fun Tarifa Surf House, Tarifa (Cadiz, Andalusia, Spain) - the kite school Kite Fun Tarifa's own surf house in
// Tarifa's town centre (1 minute from the beach, 2-3 minutes from the old town), sold as "kitesurf course +
// accommodation" packs: any group or private course plus a double room for 2 people.
//
// Kind 'camp': the site prices the house only together with a course ("Prices for a kitesurfing course with
// accommodation", "Everything for 2 people") and prints no stay-only price; the FAQ adds that companions who do not
// kite can stay "depending on the accommodation option" - the stay is not sold on its own.
//
// Data path (checked 2026-10-12): static HTML site, ONE page
//   https://kitefuntarifa.com/en/kitesurf-courses-tarifa/kitesurf-courses-accommodation-tarifa.html
//   slots    <div id="tabladesktop"> table: columns "June / October" | "July / September" | "August", rows "9h Kite
//            Course" / "12h Kite Course" / "Private Kite Course", cells "520€" or "Contact"; the note below says the
//            prices are "with accommodation (double room) for 3 nights plus a kitesurfing course. Everything for 2
//            people." Year: the table has none; we take it from the page's own article:modified_time (2026-06-10 on
//            2026-10-12), like the other year-less tables (docs/offer-adapters.md).
//   content  the same page (surf house text, FAQ, JSON-LD SportsActivityLocation of the school).
// No booking engine: "Contact us!" (e-mail, phone, WhatsApp) -> 'on_request'.
// robots.txt (2026-10-12): "User-agent: * / Allow: /*.css / Allow: /*.js / Disallow:" (allow all).
// Requests per run: 1 (content and slots share one memoised fetch).
// Parsed: slot = course row x month of the table year ("9h-kite-course|2026-10"), priceUnit 'package' for the 3-night
//   pack, price per person (= the printed total for 2 people / 2; priceTotal keeps the total), occupancy 2,
//   datePrecision 'month' (arrival any day of the month), availability 'on_request'; "Contact" cells (August) are
//   price-on-request slots.
// Known limits: no live availability; the house's room count, address and photos larger than 400 px are not on the
//   site; the JSON-LD geo is the school's beach base (Carril Playa, N-340 km 80), not the house, so no spotCoords.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, imageCandidates, iso, ldOfType, monthOf, parse, parseAmount } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://kitefuntarifa.com';
export const KF_URL = `${SITE}/en/kitesurf-courses-tarifa/kitesurf-courses-accommodation-tarifa.html`;
const CONTACT_URL = `${SITE}/en/contact.html`;

const keyPart = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const lastDay = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate();

const memo = new Map<string, { at: number; p: Promise<string> }>();
/** one fetch per page per 10 minutes: fetchContent + fetchSlots in the same run share it */
function page(url: string): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept: 'text/html' });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

function mainText(html: string): string {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, svg, header, footer, nav')) el.remove();
  return collapse((root.querySelector('body') ?? root).text);
}

// --- pure parsers -------------------------------------------------------------------------------------
export interface KfColumn { label: string; months: number[] }
export interface KfRow { course: string; prices: Array<number | null> }
export interface KfTable { columns: KfColumn[]; rows: KfRow[]; nights: number | null; persons: number | null }

/** "June / October" -> [6, 10]; "August" -> [8]. */
export function kfMonths(label: string): number[] {
  return (label.match(/[A-Za-z]+/g) ?? []).map(monthOf).filter((m): m is number => m !== null);
}

/** The course + accommodation price table (#tabladesktop) and the "3 nights ... for 2 people" note under it. */
export function parseKfTable(html: string): KfTable | null {
  const root = parse(html);
  const table = root.querySelector('#tabladesktop table') ?? root.querySelector('table');
  if (!table) return null;
  const head = table.querySelectorAll('thead th').map(th => collapse(th.text));
  const columns = head.slice(1).map(label => ({ label, months: kfMonths(label) }));
  const rows: KfRow[] = [];
  for (const tr of table.querySelectorAll('tbody tr')) {
    const cells = tr.querySelectorAll('td').map(td => collapse(td.text));
    if (cells.length < 2 || !cells[0]) continue;
    rows.push({ course: cells[0], prices: cells.slice(1, columns.length + 1).map(c => (/\d/.test(c) ? parseAmount(c) : null)) });
  }
  const text = mainText(html);
  const nights = text.match(/for (\d+) nights? plus a kitesurfing course/i)?.[1];
  const persons = text.match(/Everything for (\d+) people/i)?.[1];
  return { columns, rows, nights: nights ? Number(nights) : null, persons: persons ? Number(persons) : null };
}

/** Year of the year-less table: the page's own last edit (article:modified_time). */
export function kfTableYear(html: string): number | null {
  const d = html.match(/article:modified_time" content="(\d{4})-\d{2}-\d{2}/)?.[1];
  return d ? Number(d) : null;
}

export function buildKfSlots(t: KfTable, year: number): Slot[] {
  const persons = t.persons ?? 2;
  const nights = t.nights ?? 3;
  const out: Slot[] = [];
  for (const r of t.rows) {
    t.columns.forEach((c, i) => {
      const total = r.prices[i] ?? null;
      for (const m of c.months) {
        out.push({
          key: `${keyPart(r.course)}|${year}-${String(m).padStart(2, '0')}`,
          startDate: iso(year, m, 1),
          endDate: iso(year, m, lastDay(year, m)),
          unit: `${r.course} + ${nights} nights in a double room`,
          price: total !== null ? Math.round((total / persons) * 100) / 100 : null,
          currency: total !== null ? 'EUR' : null,
          priceUnit: total !== null ? 'package' : null,
          priceBasis: 'person',
          occupancy: persons,
          availability: 'on_request',
          availabilityText: total !== null ? 'Prices depend on season and availability' : 'Contact',
          spotsLeft: null,
          datePrecision: 'month',
          priceTotal: total,
          packageNights: nights,
        });
      }
    });
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

export function parseKitefunContent(html: string): OfferContent {
  const text = mainText(html);
  const t = parseKfTable(html);
  const school = ldOfType(html, 'SportsActivityLocation')[0] as Record<string, unknown> | undefined;
  const addr = (school?.address ?? {}) as Record<string, unknown>;
  const houseText = text.match(/Our Surf-House in Tarifa (Located .+?make new friends!)/)?.[1] ?? '';
  const faq = text.match(/What is included in a kitesurf course with accommodation package\? (.+?\.) Who are/)?.[1] ?? '';
  const brands = text.match(/We work with top brands such as ([^.]+)\./)?.[1] ?? null;
  const nights = t?.nights ?? 3;
  const persons = t?.persons ?? 2;
  const priced = (t?.rows ?? []).flatMap(r => r.prices.filter((p): p is number => p !== null));
  const min = priced.length ? Math.min(...priced) : null;
  const max = priced.length ? Math.max(...priced) : null;

  const rooms: ContentRoom[] = [{
    name: 'Double room',
    description: `Double room in the Kite Fun Tarifa Surf House, sold with a kite course: ${nights} nights for ${persons} people.`,
    features: (t?.rows ?? []).map(r => `${r.course}: ${t!.columns.map((c, i) => `${c.label} ${r.prices[i] !== null ? `EUR ${r.prices[i]}` : 'on request'}`).join(', ')} (${nights} nights, ${persons} people)`),
  }];

  const imageUrls = imageCandidates(html, KF_URL, null, 40)
    .filter(u => !/navigation-links|banderitas|logo|\/w1\.webp|whatsapp|\.svg/i.test(u));

  const summary = [
    `The Kite Fun Tarifa Surf House is the kite school's own guest house in a quiet street of Tarifa's town centre, Spain, a few minutes' walk from the beach and the old town; most guests come to learn or practise kitesurfing.`,
    `It is sold as a pack: any group or private kite course plus ${nights} nights in a double room for ${persons} people${min !== null ? `, from EUR ${min} to ${max} for both (June/October and July/September; August on request)` : ''}.`,
    `Lessons include a certified instructor, full equipment${brands ? ` (${brands})` : ''}, radio helmets and insurance; the school also offers surf, SUP and wing foil courses and rental.`,
  ].join(' ');

  return {
    kind: 'camp',
    title: 'Kite Fun Tarifa Surf House',
    summary,
    continent: 'Europe',
    country: 'Spain',
    region: 'Tarifa town',
    spot: 'Tarifa',
    itinerarySpots: [],
    durationDays: nights + 1,
    // FAQ: "Courses are adapted to all levels, from complete beginners to advanced riders"
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: true,
    equipmentRental: /Kitesurf Rentals/i.test(text),
    beginnerFriendly: /complete beginners/i.test(text),
    includedServices: faq
      ? ['Kite lessons with a certified instructor', 'Full kitesurf equipment', 'Radio helmets', 'Liability and accident insurance', `Accommodation (double room, ${nights} nights)`]
      : [`Accommodation (double room, ${nights} nights)`, 'Kite course'],
    optionalServices: ['Group, private, advanced, strapless, foil and kids kite courses', 'Wing foil lessons', 'Kitesurf rental and supervision', 'Surf, SUP and longboard courses'],
    accommodation: 'surf house (guest house) of the kite school, double rooms',
    mealPlan: null,
    languages: [],
    rooms,
    imageUrls,
    heroVideoUrl: null,
    sourceUrl: KF_URL,
    bookingUrl: CONTACT_URL,
    sourceText: [
      `surf house: ${houseText}`,
      `package: ${faq}`,
      `table: ${(t?.rows ?? []).map(r => `${r.course}: ${r.prices.map(p => p ?? 'Contact').join(' / ')}`).join(' | ')} (${t?.columns.map(c => c.label).join(' | ') ?? ''}); ${nights} nights, ${persons} people`,
      `school: ${String(school?.name ?? '')}, ${String(addr.streetAddress ?? '')}, ${String(addr.addressLocality ?? '')}`,
      `page: ${text.slice(0, 4000)}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------------
export const kitefunSurfHouseTarifa: OfferAdapter = {
  key: 'kitefun-surf-house-tarifa',
  name: 'Kite Fun Tarifa Surf House',
  kind: 'camp',
  operator: {
    name: 'Kite Fun Tarifa',
    websiteUrl: `${SITE}/en/`,
    rootDomain: 'kitefuntarifa.com',
    contactEmail: 'info@kitefuntarifa.com',
    phone: '+34661094260',
  },
  url: KF_URL,
  slotMethod: 'price_table',
  fetchBudget: 2,
  confidence: 'medium', // year-less table, year from the page's last edit
  async fetchContent() {
    return parseKitefunContent(await page(KF_URL));
  },
  async fetchSlots(ctx) {
    const html = await page(KF_URL);
    const t = parseKfTable(html);
    if (!t || t.rows.length === 0 || t.columns.length === 0) throw new Error('kitefun-surf-house: course + accommodation price table not found (layout changed?)');
    const year = kfTableYear(html);
    if (!year) { ctx.note('no article:modified_time: the year-less table cannot be dated, price on request'); return []; }
    if (!t.nights || !t.persons) ctx.note('package note ("3 nights ... for 2 people") not found: assumed 3 nights, 2 people');
    return buildKfSlots(t, year);
  },
};
