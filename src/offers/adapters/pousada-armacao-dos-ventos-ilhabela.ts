// ---------------------------------------------------------------------------
// Pousada Armação dos Ventos, Praia da Armação (Ilhabela, São Paulo, Brazil) - pousada with suites and a pool on
// the sailors' beach in the north of Ilhabela, 7 km from the Vila; it is the guest house of the BL3 Escola de
// Iatismo across the road (kitesurf, windsurf and sailing lessons, gear storage "guardaria", rentals).
//
// Inclusion: Aaron's decision of 2026-10-12 (all 18 Brazil stays of round 2, weak liveness built content-only,
//   confidence 'low'). Kite link (rule 5a) on the own site: /bl3-escola-de-iatismo "aulas particulares do básico ao
//   avançado de windsurf, veleiro e kitesurf" + the guest service list "KITE SURF ... GUARDARIA". Liveness (rule 5b,
//   WEAK): the own site (Wix) shows no date at all; "Para Reveillon, em lista de espera" carries no year. The
//   operator's sister site www.bl3.com.br (same operator: the pousada's e-mail is pousada@bl3.com.br) shows
//   "Regatas 2026", "CALENDARIO 2026", "© 2026" and lists the pousada under Hospedagens (checked 2026-10-12, not
//   fetched by this adapter).
//
// Data path (checked 2026-10-12): www.armacaodosventos.com.br (Wix, Portuguese, server-rendered):
//   content  / (location, contacts, suites/chalets teaser, "Chalés Para Locação Anual ESGOTADO", services),
//            /bl3-escola-de-iatismo (BL3 school since 1994, guest services), /suites (Standard, Master, Família
//            with their equipment, photo gallery).
//   slots    none: no prices on the site; "Reservar" leads to a request page / WhatsApp. fetchSlots re-reads /suites
//            (memoised) and returns [] (offer = "price on request"); it notes when an amount shows up there.
// robots.txt (2026-10-12): Wix default - allow all for `*` except `*?lightbox=`.
// Requests per run: content 3, slots 0 extra (1 when run alone).
// Known limits: no prices, dates, room counts or map coordinates (the map link is a goo.gl short link); the nine
//   chalets are let on annual contracts (shown as sold out) and are not listed as rooms; confidence 'low'.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, findPrices, imageCandidates } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.armacaodosventos.com.br';
export const ADVI_PAGES = { home: `${SITE}/`, school: `${SITE}/bl3-escola-de-iatismo`, suites: `${SITE}/suites` } as const;

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

/** Block-level visible lines (scripts, styles, navigation and forms dropped), de-duplicated, Wix gallery filler removed. */
export function avLines(html: string): string[] {
  const seen = new Set<string>();
  return html
    .replace(/<(script|style|noscript|select|svg|header|nav|form)\b[\s\S]*?<\/\1>/gi, ' ')
    .split(/<\/?(?:p|li|td|th|tr|h\d|div|br|ul|section|button|span)\b[^>]*>/i)
    .map(s => clean(s.replace(/<[^>]+>/g, ' ')))
    .filter(l => l && !/^(press to zoom|\d+\/\d+|top of page|bottom of page|​|-->)$/.test(l) && !seen.has(l) && (seen.add(l), true));
}

/** /suites: "Suítes <Type>" heading + the following description lines up to "RESERVAR". */
export function parseAvSuites(suitesHtml: string): Array<{ name: string; text: string }> {
  const lines = avLines(suitesHtml);
  const out: Array<{ name: string; text: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^Suítes (Standard|Master|FAMÍLIA|Família)$/i);
    if (!m) continue;
    const text: string[] = [];
    for (let k = i + 1; k < lines.length && lines[k] !== 'RESERVAR' && !/^Suítes (Standard|Master|Família)$/i.test(lines[k]) && !/^CHALES$/i.test(lines[k]); k++) text.push(lines[k]);
    out.push({ name: `Suíte ${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()}`, text: text.join(' ') });
  }
  return out;
}

/** /bl3-escola-de-iatismo: intro paragraph + the guest service list (KITE SURF, WIND SURF, GUARDARIA, ...). */
export function parseAvSchool(schoolHtml: string): { intro: string | null; services: string[] } {
  const lines = avLines(schoolHtml);
  const intro = lines.find(l => /^Sediada em Ilhabela desde/.test(l)) ?? null;
  const at = lines.findIndex(l => /Serviços disponíveis para hóspedes/i.test(l));
  const services: string[] = [];
  for (let i = at + 1; at >= 0 && i < lines.length && !/^CONTRATE/i.test(lines[i]); i++) services.push(lines[i]);
  return { intro, services };
}

const SUITE_EN: Record<string, string> = {
  'Suíte Standard': 'Ground-floor suite, spacious and airy, with air conditioning, safe and box-spring bed.',
  'Suíte Master': 'Upper-floor suite next to the main lounge, with box-spring bed, centrally heated bathroom and air conditioning.',
  'Suíte Família': 'Family suite with two bathrooms, two single beds and a mezzanine with a double bed, air conditioning; sleeps up to four.',
};

export interface AvPages { home: string; school: string; suites: string }

export function parseArmacaoContent(p: AvPages): OfferContent {
  const home = avLines(p.home);
  const school = parseAvSchool(p.school);
  const suites = parseAvSuites(p.suites);
  const homeText = home.join(' ');
  const since = school.intro?.match(/desde (\d{4})/)?.[1] ?? null;
  const kiteService = school.services.some(s => /KITE ?SURF/i.test(s));
  const storage = school.services.some(s => /GUARDARIA/i.test(s));
  const chaletsAnnual = /Chalés\s+Para Locação Anual\s+ESGOTADO/i.test(homeText);

  const rooms: ContentRoom[] = suites.map(s => ({
    name: s.name,
    description: SUITE_EN[s.name] ?? null,
    features: [
      /Ar Condicionado|ar condicionado/.test(s.text) ? 'Air conditioning' : null,
      /Cofre/.test(s.text) ? 'Safe' : null,
      /até quatro pessoas/.test(s.text) ? 'Up to 4 guests' : null,
      /2 banheiros/.test(s.text) ? 'Two bathrooms' : null,
    ].filter((x): x is string => !!x),
  }));

  const seen = new Set<string>();
  const imgs: string[] = [];
  for (const u of imageCandidates(p.suites, ADVI_PAGES.suites, null, 80)) {
    const id = u.match(/static\.wixstatic\.com\/media\/([^/]+~mv2\.(?:jpe?g|png|webp|avif))/)?.[1];
    if (!id || /\.png$/i.test(id) || seen.has(id)) continue;
    seen.add(id); imgs.push(`https://static.wixstatic.com/media/${id}`);
  }
  // jpg originals first (avif last)
  imgs.sort((a, b) => Number(/\.avif$/.test(a)) - Number(/\.avif$/.test(b)));

  const summary = [
    'Pousada Armação dos Ventos is a pousada with suites and a pool on Praia da Armação in the north of Ilhabela (São Paulo state, Brazil), 7 km from the Vila, facing the Ilhabela channel.',
    `It is the guest house of the BL3 Escola de Iatismo${since ? ` (in Ilhabela since ${since})` : ''} on the same beach, which teaches kitesurf, windsurf and sailing from beginner to advanced${storage ? ' and offers gear storage (guardaria)' : ''}, plus stand-up paddle, kayaks and boat trips for guests.`,
    `Standard, Master and Family suites have air conditioning; a breakfast buffet is served daily and there is a shared TV room${chaletsAnnual ? '; its chalets are let on annual contracts (shown as sold out)' : ''}. The site publishes no prices.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Pousada Armação dos Ventos',
    summary,
    continent: 'South America',
    country: 'Brazil',
    region: 'Ilhabela, São Paulo',
    spot: 'Praia da Armação, Ilhabela',
    spotCoords: null,
    itinerarySpots: [],
    durationDays: null,
    // BL3: "aulas particulares do básico ao avançado de windsurf, veleiro e kitesurf"
    skillLevels: /do básico ao avançado/i.test(school.intro ?? '') ? ['beginner', 'intermediate', 'advanced'] : [],
    kiteLessons: kiteService || /kitesurf/i.test(school.intro ?? ''),
    equipmentRental: school.services.some(s => /ALUGUEL/i.test(s)) ? true : null,
    beginnerFriendly: /do básico/i.test(school.intro ?? '') ? true : null,
    includedServices: ['Breakfast buffet', 'Pool', 'Shared TV room', 'Playground'],
    optionalServices: [
      'Kitesurf and windsurf lessons at BL3 Escola de Iatismo', ...(storage ? ['Gear storage (guardaria) at BL3'] : []),
      'Sailboat rental and trips', 'Stand-up paddle and kayaks', 'Boat crossing São Sebastião - Ilhabela', 'Event space',
    ],
    accommodation: 'pousada suites',
    mealPlan: 'breakfast',
    languages: ['pt'],
    rooms,
    imageUrls: imgs.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: ADVI_PAGES.home,
    bookingUrl: 'https://api.whatsapp.com/send?phone=5512997279683',
    sourceText: [
      `home: ${homeText.slice(0, 4000)}`,
      `bl3 school: ${school.intro ?? '-'} | guest services: ${school.services.join(', ')}`,
      `suites: ${suites.map(s => `${s.name}: ${s.text}`).join(' | ')}`,
    ].join('\n'),
  };
}

/** No published price: [] (price on request). Returns the amounts if the suites page starts printing some. */
export function avVisiblePrices(html: string): string[] {
  return findPrices(avLines(html).join(' ')).map(p => p.raw);
}

// --- adapter ----------------------------------------------------------------------------------
export const pousadaArmacaoDosVentosIlhabela: OfferAdapter = {
  key: 'pousada-armacao-dos-ventos-ilhabela',
  name: 'Pousada Armação dos Ventos Ilhabela',
  kind: 'accommodation',
  operator: {
    name: 'Pousada Armação dos Ventos',
    websiteUrl: SITE,
    rootDomain: 'armacaodosventos.com.br',
    contactEmail: 'pousada@bl3.com.br',
    phone: '+551238966866',
    whatsapp: '+5512997279683',
  },
  url: ADVI_PAGES.home,
  slotMethod: 'price_table',
  fetchBudget: 4,
  confidence: 'low', // Aaron 2026-10-12: content only, liveness only on the sister site bl3.com.br, no prices
  async fetchContent() {
    const [home, school, suites] = [await page(ADVI_PAGES.home), await page(ADVI_PAGES.school), await page(ADVI_PAGES.suites)];
    return parseArmacaoContent({ home, school, suites });
  },
  async fetchSlots(ctx): Promise<Slot[]> {
    const html = await page(ADVI_PAGES.suites);
    if (parseAvSuites(html).length === 0) throw new Error('armacao-dos-ventos: no suite blocks on /suites (layout changed?)');
    const prices = avVisiblePrices(html);
    if (prices.length) ctx.note(`prices appeared on /suites (${prices.slice(0, 5).join(', ')}): extend the adapter`);
    return [];
  },
};
