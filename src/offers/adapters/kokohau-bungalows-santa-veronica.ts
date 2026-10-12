// ---------------------------------------------------------------------------
// Kokohau Bungalows, Santa Verónica / Salinas del Rey (Atlántico, Colombia) - Caribbean-style bungalows
// of the IKO kite school KiteSurf Experience Colombia, rented by the night, week or month to kiters only.
//
// Data path (checked 2026-10-12): WordPress/Elementor site kitesurfexperience.co (Spanish/English mix).
//   slots    home page: the three bungalow cards (Elementor "themo-package" <article class="th-package">:
//            <h4> amount, pkg-info "COP/2 PER NIGTH", pre-title "2 People", <h3> name) -> COP per bungalow
//            per night. The same widget type also carries the lesson + stay packages ("10h clase + 5 noches
//            Hotel ... promo pre temporada enero-abril 2027"); those go into the content, not into slots.
//   content  home (season "COLOMBIA 2027 Season December to May", wind, school, packages) + /kokohau_bungalows/
//            (the bungalow page: "accommodation for kitesurfers", photos). That page also prints a second,
//            inconsistent price list (theme demo cards with "25% Off" badges and placeholder text) - not used.
// Booking: Cloudbeds (hotels.cloudbeds.com/reservation/nfUs1k) - its /booking/* data endpoints answer 403 to
//   non-browser clients (Keros Blue, 2026-10-09), so no live availability; slots are 'unknown'.
// robots.txt (2026-10-12): kitesurfexperience.co "User-Agent: * / Disallow:" (everything allowed).
// Requests per run: content 2, slots 1.
// Parsed: 3 slots = bungalow type x guests (2 people 450,000 / group 4-5 people 700,000 / 1 person 250,000
//   COP per night), no dates (the rates carry none), availability 'unknown'.
// Known limits: the long-stay discount ("Get 10% discount for long stay week") is in the room features only.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, imageCandidates, parse, parseAmount } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://kitesurfexperience.co';
export const KSE_HOME_URL = `${SITE}/`;
export const KOKOHAU_URL = `${SITE}/kokohau_bungalows/`;
const BOOKING_URL = 'https://hotels.cloudbeds.com/reservation/nfUs1k';

/** One Elementor "themo-package" card. */
export interface KsePackage { price: number; currency: string; unitText: string; preTitle: string; name: string; text: string }
export interface KseBungalowRate { name: string; guests: number; guestsText: string; price: number; currency: string; text: string }

const keyPart = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
/** "5’800.000" / "1.360.000COP" / "450.000" -> number (Colombian thousands dots, typographic apostrophes). */
const amount = (s: string): number | null => parseAmount(s.replace(/[’'`\s]/g, ''));

// --- pure parsers -----------------------------------------------------------------------------
export function parseKsePackages(html: string): KsePackage[] {
  const out: KsePackage[] = [];
  for (const a of parse(html).querySelectorAll('article.th-package')) {
    const priceText = collapse(a.querySelector('.th-pkg-info h4')?.text ?? a.querySelector('h4')?.text ?? '');
    const info = collapse(a.querySelector('.th-pkg-info')?.text ?? '');
    const price = amount(priceText);
    if (!price) continue;
    const unitText = collapse(info.replace(priceText, ''));
    out.push({
      price,
      currency: /USD|\$/.test(`${priceText} ${unitText}`) ? 'USD' : 'COP',
      unitText,
      preTitle: collapse(a.querySelector('.th-package-pre-title')?.text ?? ''),
      name: collapse(a.querySelector('h3')?.text ?? ''),
      text: collapse(a.querySelector('.th-package-content')?.text ?? ''),
    });
  }
  return out;
}

/** Bungalow cards: price per night ("COP/2 PER NIGTH", "COP/PER NIGTH") + guests in the pre-title. */
export function parseKseBungalows(html: string): KseBungalowRate[] {
  return parseKsePackages(html)
    .filter(p => /per\s*nig(h)?t/i.test(p.unitText) && /bungalow/i.test(p.name))
    .map(p => {
      const nums = [...p.preTitle.matchAll(/\d+/g)].map(m => Number(m[0]));
      return {
        name: /group/i.test(p.name) ? 'Group bungalow' : 'Private bungalow',
        guests: nums.length ? Math.max(...nums) : 2,
        guestsText: p.preTitle.toLowerCase(),
        price: p.price,
        currency: p.currency,
        text: p.text,
      };
    });
}

export function buildKokohauSlots(rates: KseBungalowRate[]): Slot[] {
  return rates.map(r => ({
    key: `${keyPart(r.name)}-${r.guests}p`,
    startDate: null,
    endDate: null,
    unit: `${r.name} (${r.guestsText})`,
    price: r.price,
    currency: r.currency,
    priceUnit: 'per_night',
    priceBasis: 'room',
    occupancy: r.guests,
    availability: 'unknown',
    availabilityText: null,
    spotsLeft: null,
  }));
}

/** Lesson + stay packages (cards that mention a hotel, bungalow or accommodation). */
export function kseStayPackages(html: string): string[] {
  return parseKsePackages(html)
    .filter(p => !/per\s*nig(h)?t/i.test(p.unitText) && /hotel|h[ôo]tel|bungalow|acommodation|accommodation/i.test(`${p.name} ${p.unitText} ${p.text}`))
    .map(p => {
      const head = [p.preTitle, p.name].filter(Boolean).join(': ');
      const per = /persona|person|each/i.test(p.unitText) ? ' per person' : '';
      return `${head} - ${p.currency} ${p.price.toLocaleString('en-US')}${per} (${p.text})`;
    });
}

function pageText(html: string): string {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, svg, header, footer, nav, form')) el.remove();
  return collapse(root.querySelector('body')?.text ?? root.text);
}

/** Content photos of a page: the shared helper scopes to the first <article> (a price card here), so wrap <body> in <main>. */
function photos(html: string, base: string): string[] {
  const body = parse(html).querySelector('body');
  const scoped = body ? `<main>${body.innerHTML}</main>` : html;
  return imageCandidates(scoped, base, null, 80);
}

export interface KokohauPages { home: string; bungalows: string }

export function parseKokohauContent(p: KokohauPages): OfferContent {
  const home = pageText(p.home);
  const bung = pageText(p.bungalows);
  const rates = parseKseBungalows(p.home);
  const packages = kseStayPackages(p.home);
  const season = home.match(/COLOMBIA (20\d\d) Season ([A-Z][a-z]+ to [A-Z][a-z]+)/);
  const w = home.match(/reliable conditions of (\d+)\s?knots\s?[–-]\s?(\d+)\s?knots\s?([A-Z]{1,3})\b/);
  const wind = w ? `${w[1]}-${w[2]} knot ${w[3]}` : null;
  const longStay = home.match(/Get (\d+)% discount for long stay week/i)?.[1] ?? null;
  const fmt = (n: number) => n.toLocaleString('en-US');

  const byName = new Map<string, KseBungalowRate[]>();
  for (const r of rates) byName.set(r.name, [...(byName.get(r.name) ?? []), r]);
  const rooms: ContentRoom[] = [...byName.entries()].map(([name, rs]) => ({
    name,
    description: `Caribbean-style bungalow${name === 'Group bungalow' ? ' for groups' : ''}, rented for days, weeks or months; only for kiters.`,
    features: [
      ...rs.map(r => `${r.guestsText}: ${r.currency} ${fmt(r.price)} per night`),
      ...(longStay ? [`${longStay}% discount for a long stay (week)`] : []),
    ],
  }));

  const seen = new Set<string>();
  const imageUrls: string[] = [];
  for (const [html, base] of [[p.bungalows, KOKOHAU_URL], [p.home, KSE_HOME_URL]] as const) {
    for (const u of photos(html, base)) {
      if (!/\/wp-content\/uploads\//.test(u) || /logo|icon|infografia|cropped-|instagram|\.png$|\.svg/i.test(u)) continue;
      const k = u.replace(/-(?:\d+x\d+|scaled)(?=\.[a-z]+$)/i, '').toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k); imageUrls.push(u);
    }
  }

  const two = rates.find(r => r.guests === 2);
  const summary = [
    'Kokohau Bungalows are the guest bungalows of KiteSurf Experience Colombia, an IKO-certified kite school at Salinas del Rey near Santa Verónica on the Caribbean coast of Atlántico, Colombia; they are rented by the night, week or month to kiters only.',
    `There are private Caribbean-style bungalows for one or two guests and a group bungalow for 4-5${two ? ` (COP ${fmt(two.price)} per night for two)` : ''}, and the school sells lesson and stay packages such as 10 hours of private IKO lessons with a bungalow stay.`,
    `The kite season runs from December to May${wind ? ` with mostly ${wind} wind` : ''}; the school offers private IKO lessons, North kite and wing rental and downwinders.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Kokohau Bungalows',
    summary,
    continent: 'South America',
    country: 'Colombia',
    region: 'Atlántico',
    spot: 'Santa Verónica',
    itinerarySpots: [],
    durationDays: null,
    // home: "perfect for those who want to learn kitesurfing and more advanced riders who like strapless waveriding" (2026-10-12)
    skillLevels: ['beginner', 'advanced'],
    kiteLessons: /KITE LESSONS|clase kitesurf/i.test(home),
    equipmentRental: /RENTAL/i.test(home) ? true : null,
    beginnerFriendly: /Principiantes|want to learn kitesurfing/i.test(home) ? true : null,
    includedServices: [],
    optionalServices: [
      'Private IKO kite lessons (2 h refresh, 3 h, 5 h, 10 h courses)',
      'Kite and wing rental (North)',
      'Downwinders and kite trips to 3 spots in the area',
      ...packages,
    ],
    accommodation: 'Caribbean-style bungalows for kiters',
    mealPlan: null, // breakfast is named only in the packages, not for the bungalow rates
    languages: ['es', 'en'],
    rooms,
    imageUrls: imageUrls.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: KSE_HOME_URL,
    bookingUrl: BOOKING_URL,
    sourceText: [
      `home: ${home}`,
      `bungalows: ${bung}`,
      `season: ${season ? `${season[1]} ${season[2]}` : '-'}`,
      `rates: ${rates.map(r => `${r.name} ${r.guestsText} ${r.currency} ${r.price}/night`).join('; ')}`,
      `packages: ${packages.join(' || ')}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const kokohauBungalowsSantaVeronica: OfferAdapter = {
  key: 'kokohau-bungalows-santa-veronica',
  name: 'Kokohau Bungalows Santa Verónica',
  kind: 'accommodation',
  operator: {
    name: 'KiteSurf Experience Colombia',
    websiteUrl: SITE,
    rootDomain: 'kitesurfexperience.co',
    contactEmail: 'kitesurfexperience@gmail.com',
    phone: '+573108754958',
  },
  url: KSE_HOME_URL,
  slotMethod: 'price_table',
  fetchBudget: 3,
  async fetchContent() {
    const home = await fetchText(KSE_HOME_URL, { accept: 'text/html' });
    const bungalows = await fetchText(KOKOHAU_URL, { accept: 'text/html' });
    return parseKokohauContent({ home, bungalows });
  },
  async fetchSlots() {
    const rates = parseKseBungalows(await fetchText(KSE_HOME_URL, { accept: 'text/html' }));
    if (rates.length < 2) throw new Error(`kokohau: bungalow price cards not found on the home page (${rates.length} parsed)`);
    return buildKokohauSlots(rates);
  },
};
