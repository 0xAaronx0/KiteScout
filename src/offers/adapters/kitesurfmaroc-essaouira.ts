// ---------------------------------------------------------------------------
// KitesurfMaroc (Kite Surf Maroc, "KSM"), Essaouira (Morocco) - "1 semaine Cours Kite" / "7 Day Kitesurf
// Camp with Lessons": 6 nights in a riad in the medina (private room with bathroom, Moroccan breakfast),
// 14 hours of kite lessons over 7 days, 4x4 transport to the spots. Replaces the bstoked listing 6980
// "Kite Camp Essaouira With Daily Coaching".
//
// Data path (checked 2026-10-12): WordPress + Kadence blocks, server-rendered, ONE page:
//   https://www.kitesurfmaroc.com/pack-kitesurf-essaouira/ (French; dateModified 2026-07-22). Four package
//   columns, each an <h2> ("4 jours Cours Kite", "1 semaine Cours Kite", "4 jours loc Kite", "1 semaine loc
//   Kite") followed by "Le package inclut" / "Le package n'inclut pas" lists and the prices
//   "chambre single : 800€" / "chambre double : 690€". The English page /en/en-pack-kitesurf-essaouira/
//   carries the same prices but was last modified 2025-03-26, so the French page is the source.
//   No booking engine: "Réservation" links to the contact page (form, e-mail, phone).
// Current operation: footer "© Copyright 2024 – 2026", page dateModified 2026-07-22; no dated season.
// robots.txt www.kitesurfmaroc.com (2026-10-12): no rules (only an llms.txt pointer) -> allowed.
// Requests per run: 1 (content + slots share one memoised page fetch).
// Parsed: 2 slots = the 1-week lessons package per room type, EUR per person for the 6-night package
//   (priceUnit 'package', packageNights 6), no dates, availability 'on_request'.
// Known limits:
//   - "per person" is not printed next to the prices; it is inferred because the double-room price is
//     below the single-room price for every package (a per-room price for two would be higher).
//   - The other packages (4 days with lessons, 4 days / 1 week rental only) are not slots of this offer;
//     the 4-day lessons package goes into optionalServices.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, imageCandidates, parse, parseAmount, type HTMLElement } from '../parse.js';
import type { OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.kitesurfmaroc.com';
export const KSM_PACK_URL = `${SITE}/pack-kitesurf-essaouira/`;
const KSM_PACK_EN_URL = `${SITE}/en/en-pack-kitesurf-essaouira/`;
const KSM_CONTACT_EN_URL = `${SITE}/en/en-contact/`;

// --- local helpers ----------------------------------------------------------------
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
function visible(html: string): HTMLElement {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, template, svg')) el.remove();
  return root;
}

export interface KsmPackage {
  name: string;               // "1 semaine Cours Kite"
  nights: number | null;
  days: number | null;
  lessonHours: number | null; // "14 heures de cours de kite sur 7 jours"
  lessons: boolean;           // "Cours" (lessons) vs "loc" (rental only)
  includes: string[];
  excludes: string[];
  single: number | null;      // EUR
  double: number | null;
  image: string | null;
}

const PACKAGE_RE = /^\d+\s+(?:jours?|semaines?)\s+(?:cours|loc)\b/i;
const priceOf = (text: string, room: 'single' | 'double'): number | null => {
  const m = text.match(new RegExp(`chambre\\s+${room}\\s*:\\s*([\\d.,\\s]+)\\s*(?:€|EUR)`, 'i'));
  return m ? parseAmount(m[1]) : null;
};

/** Package columns: each <h2> package name, climbed up to the column that holds its prices. */
export function parseKsmPackages(html: string): KsmPackage[] {
  const root = visible(html);
  const heads = root.querySelectorAll('h2').filter(h => PACKAGE_RE.test(txt(h)));
  const out: KsmPackage[] = [];
  for (const h of heads) {
    let box: HTMLElement | null = h.parentNode as HTMLElement | null;
    while (box && !/chambre\s+single/i.test(txt(box))) box = box.parentNode as HTMLElement | null;
    if (!box) continue;
    // the climb must stop at this package's own column (one package heading inside)
    if (box.querySelectorAll('h2').filter(x => PACKAGE_RE.test(txt(x))).length !== 1) continue;
    const t = txt(box);
    const lists = box.querySelectorAll('ul');
    const items = (ul: HTMLElement) => ul.querySelectorAll('li').flatMap(li =>
      li.innerHTML.split(/<br\s*\/?>/i).map(s => collapse(parse(s).text))).filter(Boolean);
    const incl = lists[0] ? items(lists[0]) : [];
    const excl = lists[1] ? items(lists[1]) : [];
    const nd = t.match(/(\d+)\s*nuits?\s*[–-]\s*(\d+)\s*jours?/i);
    const hrs = t.match(/(\d+)\s*heures?\s+de\s+cours/i);
    const img = box.querySelector('img')?.getAttribute('src') ?? null;
    const name = txt(h);
    out.push({
      name,
      nights: nd ? Number(nd[1]) : null,
      days: nd ? Number(nd[2]) : null,
      lessonHours: hrs ? Number(hrs[1]) : null,
      lessons: /\bcours\b/i.test(name),
      includes: incl,
      excludes: excl,
      single: priceOf(t, 'single'),
      double: priceOf(t, 'double'),
      image: img ? new URL(img, KSM_PACK_URL).toString() : null,
    });
  }
  return out;
}

/** The offer = the 1-week package with lessons (6 nights). */
export function weekLessons(pkgs: KsmPackage[]): KsmPackage | null {
  return pkgs.find(p => p.lessons && p.nights === 6) ?? null;
}

export function buildKsmSlots(p: KsmPackage): Slot[] {
  const rows: Array<{ room: 'single' | 'double'; unit: string; price: number | null; occ: number }> = [
    { room: 'single', unit: 'Single room', price: p.single, occ: 1 },
    { room: 'double', unit: 'Double room (twin or double bed)', price: p.double, occ: 2 },
  ];
  return rows.filter(r => r.price !== null).map(r => ({
    key: `week-lessons|${r.room}`,
    startDate: null,
    endDate: null,
    unit: r.unit,
    price: r.price,
    currency: 'EUR',
    priceUnit: 'package',
    priceBasis: 'person', // inferred: double < single for every package (see header)
    occupancy: r.occ,
    availability: 'on_request',
    availabilityText: 'Booking request via the contact page, e-mail or phone (no online booking)',
    spotsLeft: null,
    packageNights: p.nights,
  }));
}

/** French inclusion lines -> plain English (fixed phrases; unknown lines are kept out). */
export function englishIncludes(lines: string[]): string[] {
  const out: string[] = [];
  const add = (s: string) => { if (!out.includes(s)) out.push(s); };
  for (const l of lines) {
    let m: RegExpMatchArray | null;
    if (/riad/i.test(l)) add('Riad in the medina of Essaouira');
    else if (/chambre priv/i.test(l)) add('Private room with bathroom');
    else if ((m = l.match(/(\d+)\s*heures?\s+de\s+cours\s+de\s+kite\s+sur\s+(\d+)\s*jours?/i))) add(`${m[1]} hours of kite lessons over ${m[2]} days`);
    else if (/cours de surf/i.test(l)) add('Surf lessons when there is no wind');
    else if (/location illimit.*kitesurf/i.test(l)) add('Unlimited kite and surf equipment rental');
    else if (/location illimit.*surf/i.test(l)) add('Unlimited surf equipment rental');
    else if (/équipements sont inclus/i.test(l)) add('All equipment included (renewed every year)');
    else if (/petit d[ée]jeuner/i.test(l)) add('Moroccan breakfast');
    else if (/transport en 4/i.test(l)) add('4x4 transport to the kite spots');
    else if (/assurance casse/i.test(l)) add(/débutant/i.test(l) ? 'Equipment breakage insurance (beginners and intermediates)' : 'Equipment breakage insurance');
  }
  return out;
}

// --- content ----------------------------------------------------------------------
export function parseKsmContent(html: string): OfferContent {
  const pkgs = parseKsmPackages(html);
  const p = weekLessons(pkgs);
  if (!p) throw new Error('kitesurfmaroc: 1-week lessons package not found (page layout changed?)');
  const root = visible(html);
  const text = txt(root.querySelector('main') ?? root);
  const short = pkgs.find(x => x.lessons && x !== p);
  const fmt = (n: number | null) => (n === null ? '?' : `EUR ${n}`);
  const transfers = [...text.matchAll(/(Essaouira aéroport|Marrakech|Agadir)\s*—+->\s*Essaouira\s+ville\s*:\s*(\d+)\s*euros/gi)]
    .map(m => `Taxi transfer ${m[1].replace(/aéroport/i, 'airport')} - Essaouira: EUR ${m[2]} (max. 4 persons)`);

  const summary = [
    `KitesurfMaroc is a kite school in Essaouira, Morocco, that teaches in semi-private lessons and drives its students by 4x4 to the riding spots around the town.`,
    `Its one-week kite camp includes ${p.nights} nights in a riad in the medina (private room with bathroom, Moroccan breakfast), ${p.lessonHours ?? 14} hours of kite lessons over ${p.days ?? 7} days, all equipment and the 4x4 transport to the spots; surf lessons replace kiting on days without wind.`,
    `The package costs ${fmt(p.single)} in a single room and ${fmt(p.double)} in a double room; flights, airport transfers, lunch and dinner are not included.`,
  ].join(' ');

  const imageUrls = [...new Set([p.image, ...imageCandidates(html, KSM_PACK_URL, null, 40)].filter((u): u is string => !!u))]
    .filter(u => !/logo|icon|flag|\.svg|trustindex|cropped-/i.test(u));

  return {
    kind: 'camp',
    title: 'KitesurfMaroc - 7 Day Kitesurf Camp with Lessons, Essaouira',
    summary,
    continent: 'Africa',
    country: 'Morocco',
    region: 'Marrakech-Safi',
    spot: 'Essaouira',
    itinerarySpots: [],
    durationDays: (p.nights ?? 6) + 1,
    // home page: "Vous êtes débutant, intermédiaire ou confirmé" (2026-10-12)
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: true,
    equipmentRental: true,
    beginnerFriendly: true,
    includedServices: englishIncludes(p.includes),
    optionalServices: [
      ...(short ? [`Shorter package: ${short.nights} nights with ${short.lessonHours ?? '?'} hours of kite lessons (${fmt(short.single)} single room / ${fmt(short.double)} double room)`] : []),
      ...transfers,
    ],
    accommodation: 'Riad in the medina of Essaouira (private rooms with bathroom)',
    mealPlan: 'breakfast',
    languages: ['fr', 'en', 'es'], // site languages (2026-10-12); instruction languages not stated
    rooms: [],
    imageUrls,
    heroVideoUrl: null,
    sourceUrl: KSM_PACK_URL,
    bookingUrl: KSM_CONTACT_EN_URL,
    sourceText: [
      `packages: ${pkgs.map(x => `${x.name}: ${x.nights ?? '?'} nights, ${x.lessonHours ?? 0} h lessons, single ${x.single ?? '-'} / double ${x.double ?? '-'} EUR`).join('; ')}`,
      `included (${p.name}): ${p.includes.join(' | ')}`,
      `not included: ${p.excludes.join(' | ')}`,
      `page: ${text}`,
    ].join('\n'),
  };
}

export const kitesurfmarocEssaouira: OfferAdapter = {
  key: 'kitesurfmaroc-essaouira',
  name: 'KitesurfMaroc - 7 Day Kitesurf Camp with Lessons (Essaouira)',
  kind: 'camp',
  operator: {
    name: 'KitesurfMaroc',
    websiteUrl: `${SITE}/`,
    rootDomain: 'kitesurfmaroc.com',
    contactEmail: 'info@kitesurfmaroc.com', // page footer, 2026-10-12
    phone: '+212659586517',                // page footer "tel:+212659586517", 2026-10-12
  },
  url: KSM_PACK_EN_URL,
  slotMethod: 'price_table',
  fetchBudget: 2,
  async fetchContent() {
    return parseKsmContent(await page(KSM_PACK_URL));
  },
  async fetchSlots() {
    const p = weekLessons(parseKsmPackages(await page(KSM_PACK_URL)));
    if (!p) throw new Error('kitesurfmaroc: 1-week lessons package not found (page layout changed?)');
    const slots = buildKsmSlots(p);
    if (slots.length === 0) throw new Error('kitesurfmaroc: no room prices parsed for the 1-week lessons package');
    return slots;
  },
};
