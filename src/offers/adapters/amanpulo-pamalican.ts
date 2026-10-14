// ---------------------------------------------------------------------------
// Amanpulo, Pamalican Island (Cuyo Archipelago, Palawan, Philippines) - Aman's private-island resort (casitas and
// one- to four-bedroom villas) with its own Kite & Surf Centre on the island's shallow lagoon, IKO-certified
// instructors and Naish equipment, kite season December to March (amihan).
//
// Kite link (own site, 2026-10-12): /resorts/amanpulo/kite-surf-centre ("Kite & Surf Centre at Amanpulo", lagoon,
//   IKO instructors, facilities) and /resorts/amanpulo/experiences ("our newly opened Kite Surf Centre ... Available
//   between December and March").
// Liveness (2026-10-12): the kite page's article:modified_time is 2026-09-01; footer "Copyright 2026, Aman Group";
//   casita/villa cards link a live reservation engine. Verdict LIVE (season Dec-Mar, next one 2026/27).
// Data path (checked 2026-10-12): www.aman.com (Drupal), English pages:
//   content  /resorts/amanpulo (overview, getting here; JSON-LD Hotel: phone, e-mail), /accommodation/casitas and
//            /accommodation/villas (cards: <p.subtitle> type, <h3> name, intro <p>; "All stays include" list),
//            /kite-surf-centre, /experiences.
//   slots    none. Rates exist only in Aman's reservation engine (cards link /aman/reservation?room=..&chain=16840&
//            hotel=62470, a SynXis hand-off, rel=nofollow) - not a public read we use -> fetchSlots returns []
//            ("price on request").
// robots.txt (2026-10-12): "Crawl-delay: 1", disallows only /core/ and /profiles/ (assets); pages allowed.
// Requests per run: content 5, slots 0.
// Known limits: no coordinates in the JSON-LD (address text only); villa sizes only where the intro states them.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, ldOfType, meta, parse } from '../parse.js';
import type { ContentRoom, FetchContext, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.aman.com';
const BASE = `${SITE}/resorts/amanpulo`;
export const AMP_URLS = {
  overview: BASE,
  casitas: `${BASE}/accommodation/casitas`,
  villas: `${BASE}/accommodation/villas`,
  kite: `${BASE}/kite-surf-centre`,
  experiences: `${BASE}/experiences`,
};

/** Visible text blocks of <main> (headings, paragraphs, list items) in document order, de-duplicated. */
export function ampLines(html: string): string[] {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, svg, nav, footer')) el.remove();
  const scope = root.querySelector('main') ?? root;
  const out: string[] = [];
  for (const el of scope.querySelectorAll('h1, h2, h3, h4, h5, h6, p, li')) {
    const t = collapse(el.text);
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

// --- pure parsers -----------------------------------------------------------------------------
export interface AmpUnit { type: string; name: string; intro: string | null; url: string | null }

/** Accommodation cards (article.node--accommodation): subtitle = Casita / Villa, <h3> = name, intro paragraph. */
export function parseAmpUnits(html: string): AmpUnit[] {
  const out: AmpUnit[] = [];
  for (const card of parse(html).querySelectorAll('article.node--accommodation')) {
    const name = collapse(card.querySelector('h3')?.text ?? '');
    if (!name || out.some(u => u.name === name)) continue;
    out.push({
      type: collapse(card.querySelector('.subtitle')?.text ?? ''),
      name,
      intro: collapse(card.querySelector('.hgroup__intro')?.text ?? '') || null,
      url: card.querySelector('a.card__link')?.getAttribute('href') ?? null,
    });
  }
  return out;
}

/** The "All stays include" list of an accommodation page. */
export function parseAmpIncludes(html: string): string[] {
  const lines = ampLines(html);
  const i = lines.indexOf('All stays include');
  if (i < 0) return [];
  const out: string[] = [];
  for (const t of lines.slice(i + 1)) {
    if (t.length > 160 || /^(Featured offer|Casita Collection|Villa Collection|Casita|Villa)$/.test(t)) break;
    out.push(t);
  }
  return out;
}

/** Largest Amanpulo photo per file: Drupal image-style URLs grouped by the original path, the 2x / widest style wins. */
export function ampImages(html: string): string[] {
  const best = new Map<string, { url: string; score: number }>();
  const og = meta(html, 'og:image');
  const re = /\/sites\/default\/files\/styles\/([a-z0-9_]+)\/public\/([^"'?\s]+)\?itok=[A-Za-z0-9_-]+/g;
  for (const m of html.matchAll(re)) {
    const [, style, path] = m;
    if (!/amanpulo/i.test(decodeURIComponent(path))) continue;
    const score = (style.endsWith('_2x') ? 1000 : 0) + (/xwide|extra_large|masonry/.test(style) ? 100 : /tablet|plus/.test(style) ? 50 : 0);
    const prev = best.get(path);
    if (!prev || score > prev.score) best.set(path, { url: `${SITE}${m[0]}`, score });
  }
  const out = og && /amanpulo/i.test(og) ? [og] : [];
  for (const { url } of best.values()) if (!out.includes(url)) out.push(url);
  return out;
}

export interface AmpPages { overview: string; casitas: string; villas: string; kite: string; experiences: string }

export function parseAmanpuloContent(p: AmpPages): OfferContent {
  const hotel = ldOfType(p.overview, 'Hotel')[0] ?? {};
  const overview = ampLines(p.overview);
  const kite = ampLines(p.kite);
  const exp = ampLines(p.experiences);
  const units = [...parseAmpUnits(p.casitas), ...parseAmpUnits(p.villas)];
  const includes = parseAmpIncludes(p.casitas).length ? parseAmpIncludes(p.casitas) : parseAmpIncludes(p.villas);
  const villaIntro = ampLines(p.villas).find(t => /Villas offer consummate privacy/.test(t)) ?? null;
  const intro = overview.find(t => /^Blissfully placed in the Cuyo Archipelago/.test(t)) ?? (typeof hotel.description === 'string' ? hotel.description : null);
  const flight = overview.find(t => /^From Clark International Airport/.test(t)) ?? null;
  const lagoon = kite.find(t => /kite surfer’s paradise|kite surfer's paradise/.test(t)) ?? null;
  const wind = kite.find(t => /amihan/i.test(t)) ?? null;
  const instructors = kite.find(t => /International Kite Surfing Organization/.test(t)) ?? null;
  const headsets = kite.find(t => /radio headsets/.test(t)) ?? null;
  const facIdx = kite.indexOf('Facilities');
  const facilities = facIdx >= 0 ? kite.slice(facIdx + 1).filter(t => t.length < 80 && !/^(Amanpulo|Pamalican Island|Cuyo|Palawan|Philippines|Tel:|Email:|For reservations:)/.test(t)).slice(0, 8) : [];
  const season = exp.find(t => /Kite Surf Centre/.test(t) && /Available between/.test(t))?.match(/Available between ([A-Z][a-z]+ and [A-Z][a-z]+)/)?.[1] ?? null;
  const casitas = units.filter(u => /casita/i.test(u.type));
  const villas = units.filter(u => /villa/i.test(u.type));

  const rooms: ContentRoom[] = units.map(u => ({
    name: u.name,
    description: u.intro,
    features: [
      u.intro?.match(/(\d+) square metres/)?.[0] ?? null,
      /villa/i.test(u.type) ? 'Private chef and butler, club car per bedroom (all villas)' : null,
      /pool/i.test(u.name) ? 'Private pool' : null,
    ].filter((x): x is string => !!x),
  }));

  const imageUrls = [...new Set([...ampImages(p.kite), ...ampImages(p.overview), ...ampImages(p.casitas), ...ampImages(p.villas)])].slice(0, 30);

  const summary = [
    'Amanpulo is an Aman resort on the private Pamalican Island in the Cuyo Archipelago of northern Palawan, Philippines, reached by a 90-minute flight from Clark International Airport to the resort\'s own airstrip.',
    `Its Kite & Surf Centre teaches all levels on a shallow lagoon with a sandy bottom, launching from the beach, with instructors certified by the International Kite Surfing Organization, radio headsets, video review and Naish equipment; kiting runs ${season ? `between ${season}` : 'from December to March'} with the amihan wind.`,
    `Guests stay in ${casitas.length || ''} types of casitas (beach, treetop and hillside, some with private pools) or in one- to four-bedroom villas with pools, a private chef and butler${includes.some(i => /breakfast/i.test(i)) ? '; daily breakfast and afternoon tea are included' : ''}.`,
    'Rates are only shown in Aman\'s booking engine, so prices are on request.',
  ].join(' ').replace(/ {2,}/g, ' ');

  return {
    kind: 'accommodation',
    title: 'Amanpulo',
    summary,
    continent: 'Asia',
    country: 'Philippines',
    region: 'Palawan (Cuyo Islands)',
    spot: 'Pamalican Island',
    itinerarySpots: [],
    durationDays: null,
    // "from complete beginners to seasoned riders" (/kite-surf-centre)
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: !!instructors,
    equipmentRental: null, // lessons use Naish equipment; independent rental is not stated
    beginnerFriendly: kite.some(t => /easy to walk around and learn how to kite/.test(t)),
    includedServices: includes,
    optionalServices: [
      'Kite surfing lessons at the Kite & Surf Centre (December to March)',
      ...facilities.map(f => `Kite centre: ${f}`),
      'PADI dive centre, snorkelling, sailing and boat trips',
      'Aman Spa and wellness programmes',
    ],
    accommodation: 'private-island resort casitas and pool villas',
    mealPlan: 'breakfast',
    languages: ['en'],
    rooms,
    imageUrls,
    heroVideoUrl: null,
    sourceUrl: AMP_URLS.kite,
    bookingUrl: AMP_URLS.casitas,
    sourceText: [
      `overview: ${intro ?? ''} ${flight ?? ''}`,
      `kite: ${[lagoon, wind, headsets, instructors].filter(Boolean).join(' ')}`,
      `kite facilities: ${facilities.join('; ')}`,
      `season (experiences): ${season ?? ''}`,
      `villas: ${villaIntro ?? ''}`,
      `all stays include: ${includes.join('; ')}`,
      `units: ${units.map(u => `${u.type} ${u.name}: ${u.intro ?? ''}`).join(' | ')}`,
      `casitas ${casitas.length}, villas ${villas.length}`,
      `contact (JSON-LD): ${String(hotel.address ?? '').replace(/\s+/g, ' ')} ${JSON.stringify(hotel.telephone ?? '')} ${JSON.stringify(hotel.email ?? '')}`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const amanpuloPamalican: OfferAdapter = {
  key: 'amanpulo-pamalican',
  name: 'Amanpulo (Pamalican Island)',
  kind: 'accommodation',
  operator: {
    name: 'Amanpulo',
    websiteUrl: BASE,
    rootDomain: 'aman.com',
    contactEmail: 'amanpulores@aman.com', // JSON-LD Hotel, 2026-10-12
    phone: '+63279765200',
  },
  url: AMP_URLS.kite,
  slotMethod: 'booking_engine',
  instantBooking: true,
  fetchBudget: 5,
  confidence: 'low', // no public rates
  async fetchContent() {
    const overview = await fetchText(AMP_URLS.overview, { accept: 'text/html' });
    const casitas = await fetchText(AMP_URLS.casitas, { accept: 'text/html' });
    const villas = await fetchText(AMP_URLS.villas, { accept: 'text/html' });
    const kite = await fetchText(AMP_URLS.kite, { accept: 'text/html' });
    const experiences = await fetchText(AMP_URLS.experiences, { accept: 'text/html' });
    return parseAmanpuloContent({ overview, casitas, villas, kite, experiences });
  },
  async fetchSlots(ctx: FetchContext): Promise<Slot[]> {
    ctx.note('rates only in Aman\'s reservation engine (SynXis hand-off, not a public read): price on request');
    return [];
  },
};
