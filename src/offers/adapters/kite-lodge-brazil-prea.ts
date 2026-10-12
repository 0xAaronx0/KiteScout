// ---------------------------------------------------------------------------
// Kite Lodge Brazil, Preá (Ceará, Brazil) - lodge with 8 studio / apartment units, pool, La Praia
// restaurant and its own kite school with launch and landing service, a few meters from the beach.
//
// Data path (checked 2026-10-12):
//   content  kitelodgebrasil.com (WordPress/Elementor, English): home (Preá, kite and wing conditions,
//            downwinders), /the-lodge/ (lodge, restaurant, kite school), /accommodations/ (unit cards),
//            /accommodations/mar/ (unit details + the site-wide note "All prices are for two persons
//            including breakfast"), /kite-school-prices/ (semi-private and private course tables).
//   slots    /accommodations/: one Elementor card per unit (.acc-wrapper: name, size m2, max persons,
//            bedrooms, "book now from R$ 690,00") - "from" prices per unit and night for two persons
//            incl. breakfast, no dates, no year.
// Booking engine: Cloudbeds immersive widget (property code P5midr) on /bookingengine; Cloudbeds'
//   /booking/* endpoints answer 403 to non-browser clients (see keros-blue-limnos.ts), so we do not
//   call them: no live availability, slots stay 'unknown'.
// robots.txt (2026-10-12): Yoast default, nothing disallowed.
// Requests per run: content 5, slots 1.
// Parsed: 8 slots = unit ("superior"), BRL per unit per night for 2 persons (priceUnit per_night,
//   basis room), startDate/endDate null.
// Known limits: undated "from" prices; WordPress dates the accommodations page 2025-02-20 (page sitemap),
//   the site names no 2026/27 season. /the-lodge/ shows older teaser prices (Mar / Ocean "From 670R$")
//   than /accommodations/ (690 / 830) - the accommodations page is the source.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, imageCandidates, parse, parseAmount } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://kitelodgebrasil.com';
export const KL_PAGES = {
  home: `${SITE}/`,
  lodge: `${SITE}/the-lodge/`,
  accommodations: `${SITE}/accommodations/`,
  mar: `${SITE}/accommodations/mar/`,
  school: `${SITE}/kite-school-prices/`,
} as const;
const BOOKING_URL = `${SITE}/bookingengine`;

export interface KlUnit { name: string; url: string | null; sizeM2: number | null; maxPersons: number | null; bedrooms: number | null; fromPrice: number | null; currency: string | null }

const keyPart = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Unit cards of /accommodations/ (and the home page teaser grid). */
export function parseKlUnits(html: string): KlUnit[] {
  const out: KlUnit[] = [];
  for (const card of parse(html).querySelectorAll('.acc-wrapper')) {
    const name = collapse(card.querySelector('.one-third-child-header')?.text ?? '');
    if (!name) continue;
    const facts = new Map<string, number>();
    for (const box of card.querySelectorAll('.one-third-child')) {
      const n = Number(collapse(box.querySelector('.number-info')?.text ?? ''));
      const label = collapse(box.querySelector('.number-text')?.text ?? '').toLowerCase();
      if (Number.isFinite(n) && label) facts.set(label.replace(/\s+/g, ' '), n);
    }
    const priceLink = card.querySelectorAll('a').find(a => /from\s*R\$/i.test(a.text));
    const priceText = collapse(priceLink?.text ?? '');
    const fromPrice = priceText ? parseAmount(priceText.replace(/^[^R]*R\$/, '')) : null;
    out.push({
      name,
      url: priceLink?.getAttribute('href') ?? null,
      sizeM2: facts.get('size m2') ?? null,
      maxPersons: facts.get('max persons') ?? null,
      bedrooms: facts.get('bed rooms') ?? null,
      fromPrice,
      currency: fromPrice !== null ? 'BRL' : null,
    });
  }
  return out;
}

/** "All prices are for two persons including breakfast" (site-wide note on every unit page). */
export function parseKlPriceBasis(unitHtml: string): { persons: number | null; breakfast: boolean } {
  const t = collapse(parse(unitHtml).text);
  const m = t.match(/All prices are for (\w+) persons?( including breakfast)?/i);
  const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4 };
  return { persons: m ? (words[m[1].toLowerCase()] ?? (Number(m[1]) || null)) : null, breakfast: !!m?.[2] };
}

export function buildKlSlots(units: KlUnit[], persons: number | null): Slot[] {
  return units.filter(u => u.fromPrice !== null).map(u => ({
    key: keyPart(u.name),
    startDate: null,
    endDate: null,
    unit: u.name,
    price: u.fromPrice,
    currency: u.currency,
    priceUnit: 'per_night',
    priceBasis: 'room',
    occupancy: persons,
    availability: 'unknown',
    availabilityText: null,
    spotsLeft: null,
  }));
}

/** Course price tables: first price of each table (1 day) with its hours. */
export function parseKlCourses(html: string): Array<{ course: string; fromPrice: number; hours: string | null }> {
  const out: Array<{ course: string; fromPrice: number; hours: string | null }> = [];
  const t = collapse(parse(html).text);
  for (const m of t.matchAll(/(Semi private course|Private course)[\s\S]*?1 day[\s\S]*?More days\s*(\d+h)[\s\S]*?Prices\s*(\d[\d.,]*)R\$/gi)) {
    const n = parseAmount(m[3]);
    if (n) out.push({ course: m[1], fromPrice: n, hours: m[2] });
  }
  return out;
}

function pageText(html: string): string {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, header, footer, nav, form')) el.remove();
  return collapse((root.querySelector('main') ?? root.querySelector('body') ?? root).text);
}

const IMG_JUNK = /logo|Element-\d|best-rates|pillow|square|towels|bell-white|Kite-Lodge-ico|herz-mit|\/p\d\.|\.png|\.svg/i;

export interface KlPages { home: string; lodge: string; accommodations: string; mar: string; school: string }

export function parseKiteLodgeContent(p: KlPages): OfferContent {
  const home = pageText(p.home);
  const lodge = pageText(p.lodge);
  const units = parseKlUnits(p.accommodations);
  const basis = parseKlPriceBasis(p.mar);
  const courses = parseKlCourses(p.school);
  const windSeason = home.match(/wind guarantee from (\w+) to (\w+)/i);
  const prices = units.map(u => u.fromPrice).filter((x): x is number => x !== null);
  const brl = (n: number) => `R$ ${n.toLocaleString('en-US')}`;

  const rooms: ContentRoom[] = units.map(u => ({
    name: u.name,
    description: null,
    features: [
      u.sizeM2 ? `${u.sizeM2} m2` : null,
      u.maxPersons ? `Up to ${u.maxPersons} guests` : null,
      u.bedrooms ? `${u.bedrooms} bedroom${u.bedrooms > 1 ? 's' : ''}` : null,
      u.fromPrice !== null ? `From ${brl(u.fromPrice)} per night${basis.persons ? ` for ${basis.persons} persons` : ''}${basis.breakfast ? ' incl. breakfast' : ''}` : null,
    ].filter((x): x is string => !!x),
  }));

  const seen = new Set<string>();
  const imageUrls: string[] = [];
  for (const [html, base] of [[p.lodge, KL_PAGES.lodge], [p.home, KL_PAGES.home], [p.mar, KL_PAGES.mar], [p.accommodations, KL_PAGES.accommodations]] as const) {
    const cands = imageCandidates(html, base, null, 60);
    // a resized copy ("-1024x576.jpg") listed before its original: take the original
    for (const u of cands.map(c => { const o = c.replace(/-\d+x\d+(?=\.[a-z]+$)/i, ''); return o !== c && cands.includes(o) ? o : c; })) {
      if (!u.startsWith(`${SITE}/wp-content/uploads/`) || IMG_JUNK.test(u)) continue;
      const k = u.split('/').pop()!.replace(/-(?:\d+x\d+|scaled)(?=[.-])/gi, '').replace(/-[a-z0-9]{40,}(?=\.[a-z]+$)/i, '').replace(/\.[a-z]+$/i, '');
      if (seen.has(k)) continue;
      seen.add(k); imageUrls.push(u);
    }
  }

  const summary = [
    `Kite Lodge Brazil is a small lodge in Preá, a fishing village on the coast of Ceará, Brazil, a few meters from the sea, with a pool, the La Praia restaurant and its own kite school with a launch and landing service.`,
    `It rents ${units.length || 8} studios and apartments of ${Math.min(...units.map(u => u.sizeM2 ?? 99))}-${Math.max(...units.map(u => u.sizeM2 ?? 0))} m2 for 2 to 4 guests${prices.length ? `, from ${brl(Math.min(...prices))} to ${brl(Math.max(...prices))} per night for two persons with breakfast` : ''}.`,
    `The school teaches semi-private and private kite courses with radio helmets${windSeason ? `; Preá is known for reliable wind from ${windSeason[1]} to ${windSeason[2]}` : ''}, and the coast suits wingfoiling and downwinders.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Kite Lodge Brazil',
    summary,
    continent: 'South America',
    country: 'Brazil',
    region: 'Ceará',
    spot: 'Preá',
    itinerarySpots: [],
    durationDays: null,
    // home: "Beginners find optimal, safe conditions ... Intermediates and experts appreciate the pressure" (2026-10-12)
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: courses.length > 0 || /Kite School/i.test(lodge),
    equipmentRental: /\bRental\b/.test(pageText(p.mar)) ? true : null,
    beginnerFriendly: /Beginners find optimal, safe conditions/i.test(home) ? true : null,
    includedServices: basis.breakfast ? ['Breakfast', 'Pool towels'] : ['Pool towels'],
    optionalServices: [
      ...courses.map(c => `${c.course === 'Private course' ? 'Private kite course (1 student per instructor)' : 'Semi-private kite course (2 students per instructor)'} with radio helmet: 1 day (${c.hours}) R$ ${c.fromPrice.toLocaleString('en-US')}`),
      'Kite launch and landing service',
      'Massages, excursions, rental (unit page "Services")',
      'La Praia restaurant (lunch and dinner)',
    ],
    accommodation: 'studios and apartments at a kite lodge',
    mealPlan: basis.breakfast ? 'breakfast' : null,
    languages: ['en', 'pt'], // site language switch English / Portuguese (2026-10-12)
    rooms,
    imageUrls: imageUrls.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: KL_PAGES.accommodations,
    bookingUrl: BOOKING_URL,
    sourceText: [
      `home: ${home.slice(0, 4000)}`,
      `the lodge: ${lodge.slice(0, 3000)}`,
      `units: ${units.map(u => `${u.name} ${u.sizeM2 ?? '-'} m2, max ${u.maxPersons ?? '-'}, ${u.bedrooms ?? '-'} bedrooms, from R$ ${u.fromPrice ?? '-'}`).join('; ')}`,
      `price basis: ${basis.persons ?? '-'} persons${basis.breakfast ? ', breakfast included' : ''}`,
      `courses: ${courses.map(c => `${c.course} 1 day ${c.hours} R$ ${c.fromPrice}`).join('; ')}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const kiteLodgeBrazilPrea: OfferAdapter = {
  key: 'kite-lodge-brazil-prea',
  name: 'Kite Lodge Brazil Preá',
  kind: 'accommodation',
  operator: {
    name: 'Kite Lodge Brazil',
    websiteUrl: SITE,
    rootDomain: 'kitelodgebrasil.com',
    whatsapp: '+5588981653192',
    phone: '+5588981653192',
  },
  url: KL_PAGES.accommodations,
  slotMethod: 'price_table',
  confidence: 'medium',
  fetchBudget: 6,
  async fetchContent() {
    const home = await fetchText(KL_PAGES.home, { accept: 'text/html' });
    const lodge = await fetchText(KL_PAGES.lodge, { accept: 'text/html' });
    const accommodations = await fetchText(KL_PAGES.accommodations, { accept: 'text/html' });
    const mar = await fetchText(KL_PAGES.mar, { accept: 'text/html' });
    const school = await fetchText(KL_PAGES.school, { accept: 'text/html' });
    return parseKiteLodgeContent({ home, lodge, accommodations, mar, school });
  },
  async fetchSlots() {
    const units = parseKlUnits(await fetchText(KL_PAGES.accommodations, { accept: 'text/html' }));
    if (units.filter(u => u.fromPrice !== null).length < 4) throw new Error(`kite-lodge-brazil: only ${units.length} unit cards with a price on /accommodations/ (layout changed?)`);
    // the price basis note lives on the unit pages; the run reads it in fetchContent, slots assume its value of 2026-10-12
    return buildKlSlots(units, 2);
  },
};
