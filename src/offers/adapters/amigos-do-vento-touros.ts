// ---------------------------------------------------------------------------
// Amigos do Vento Chalés & Kitepoint, Touros (Rio Grande do Norte, Brazil) - beachfront chalets with a pool, an
// on-site restaurant and its own kitepoint (lessons with instructors) in front of the pousada, next to São Miguel
// do Gostoso.
//
// Inclusion (rule 5): kite link on the own site = "kitepoint estruturado em frente à pousada. Oferecemos aulas com
//   instrutores" (/contact/ FAQ) and the "Kitepoint & Aulas" block of the home page. Current operation: guest
//   reviews dated 2026-01-25 and 2026-02-26 on the home page, Yoast dateModified 2026-06-24 (home) /
//   2026-03-03 (/sobre/), photo uploads 2026/01 and 2026/02, footer "© 2026".
//
// Data path (checked 2026-10-12): amigosdovento.com (WordPress/Elementor, Portuguese):
//   content  / (intro, chalets / kitepoint / restaurant teasers, Touros wind "cerca de 10 dos 12 meses do ano",
//            reviews), /sobre/ (facilities list, chalet gallery, check-in rules), /contact/ (e-mail, phone, address,
//            FAQ: what the stay includes, how the kitepoint works).
//   slots    none: the site prints no prices; bookings go through WhatsApp ("gostaria de saber sobre datas
//            disponíveis") or e-mail. fetchSlots re-reads the home page (memoised) and returns [] (offer = "price on
//            request"); it notes when an amount shows up there so the adapter can be extended.
// robots.txt (2026-10-12): Yoast default "Disallow:" (allow all).
// Requests per run: content 3, slots 0 extra (1 when run alone).
// Known limits: no chalet count, room sizes, prices or season dates on the site; the Google Maps embed is a name
//   query without coordinates, so no spotCoords; confidence 'low' (content only).
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, findPrices, imageCandidates } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://amigosdovento.com';
export const ADV_PAGES = { home: `${SITE}/`, about: `${SITE}/sobre/`, contact: `${SITE}/contact/` } as const;

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

/** Block-level visible lines, de-duplicated (Elementor renders desktop and mobile copies of each section). */
export function advLines(html: string): string[] {
  const seen = new Set<string>();
  return html
    .replace(/<(script|style|noscript|select|svg|header|footer|nav|form)\b[\s\S]*?<\/\1>/gi, ' ')
    .split(/<\/?(?:p|li|td|th|tr|h\d|div|br|ul|section|button)\b[^>]*>/i)
    .map(s => clean(s.replace(/<[^>]+>/g, ' ')))
    .filter(l => l && !seen.has(l) && (seen.add(l), true));
}

/** FAQ of /contact/: question -> answer. */
export function parseAdvFaq(contactHtml: string): Array<{ q: string; a: string }> {
  const lines = advLines(contactHtml);
  const out: Array<{ q: string; a: string }> = [];
  for (let i = 0; i < lines.length - 1; i++) if (/\?$/.test(lines[i]) && !/\?$/.test(lines[i + 1])) out.push({ q: lines[i], a: lines[i + 1] });
  return out;
}

/** Facilities list of /sobre/ ("Tudo o que você encontra aqui:" ... up to the booking button). */
export function parseAdvFacilities(aboutHtml: string): string[] {
  const lines = advLines(aboutHtml);
  const at = lines.findIndex(l => /^encontra aqui:?$/i.test(l));
  const out: string[] = [];
  for (let i = at + 1; at >= 0 && i < lines.length && !/^Faça sua re/i.test(lines[i]); i++) out.push(lines[i]);
  return out;
}

/** Guest review dates on the home page (YYYY-MM-DD lines). */
export function advReviewDates(homeHtml: string): string[] {
  return [...new Set(advLines(homeHtml).filter(l => /^20\d\d-\d\d-\d\d$/.test(l)))].sort();
}

const FACILITY_EN: Record<string, string> = {
  'Chalés completos': 'Fully equipped chalets', 'Acesso a praia': 'Beach access', 'Ar-condicionado nos quartos': 'Air conditioning',
  'Banheiro privativo': 'Private bathroom', Varanda: 'Veranda', 'Wi-Fi': 'Wi-Fi', 'Café da manhã': 'Breakfast',
  'Piscina ao ar livre': 'Outdoor pool', 'Restaurante no local': 'Restaurant on site', 'Kitepoint estruturado': 'Kitepoint',
};

export interface AdvPages { home: string; about: string; contact: string }

export function parseAmigosContent(p: AdvPages): OfferContent {
  const home = advLines(p.home);
  const faq = parseAdvFaq(p.contact);
  const facilities = parseAdvFacilities(p.about);
  const kiteFaq = faq.find(f => /kitepoint/i.test(f.q))?.a ?? '';
  const included = faq.find(f => /incluso na reserva/i.test(f.q))?.a ?? '';
  const windMonths = home.join(' ').match(/cerca de (\d+) dos 12 meses/)?.[1] ?? null;
  const reviews = advReviewDates(p.home);

  const rooms: ContentRoom[] = [{
    name: 'Beachfront chalet',
    description: 'Chalet a few steps from the sea, with air conditioning, private bathroom and veranda; breakfast included.',
    features: facilities.filter(f => /Ar-condicionado|Banheiro|Varanda|Wi-Fi/.test(f)).map(f => FACILITY_EN[f] ?? f),
  }];

  const seen = new Set<string>();
  const imgs: string[] = [];
  for (const [html, base] of [[p.about, ADV_PAGES.about], [p.home, ADV_PAGES.home]] as const) {
    for (const cand of imageCandidates(html, base, null, 80)) {
      const u = cand.replace(/^http:/, 'https:');
      if (!/\/wp-content\/uploads\/.+\.(?:jpe?g|webp)$/i.test(u) || /logo|icon/i.test(u)) continue;
      const k = u.replace(/-\d+x\d+(?=\.[a-z]+$)/i, '');
      if (seen.has(k)) continue;
      seen.add(k); imgs.push(k);
    }
  }

  const summary = [
    'Amigos do Vento Chalés & Kitepoint is a small set of beachfront chalets in Touros (Rio Grande do Norte, Brazil), next to São Miguel do Gostoso and a few hours by car from Natal.',
    'The chalets have air conditioning, a private bathroom and a veranda, with Wi-Fi and breakfast included; an outdoor pool and a restaurant are on site.',
    `Its own kitepoint in front of the pousada offers lessons with instructors and support for guests who want to learn, progress or already kite (booked separately)${windMonths ? `, and the site says Touros has strong, steady wind about ${windMonths} months a year` : ''}. Stays are booked by WhatsApp or e-mail; the site publishes no prices.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Amigos do Vento Chalés & Kitepoint',
    summary,
    continent: 'South America',
    country: 'Brazil',
    region: 'Touros, Rio Grande do Norte',
    spot: 'Touros',
    spotCoords: null,
    itinerarySpots: [],
    durationDays: null,
    // FAQ: "estrutura para quem deseja aprender, evoluir ou já pratica kitesurf"
    skillLevels: /aprender, evoluir ou já pratica/i.test(kiteFaq) ? ['beginner', 'intermediate', 'advanced'] : [],
    kiteLessons: /aulas com instrutores/i.test(kiteFaq),
    equipmentRental: null,
    beginnerFriendly: /aprender/i.test(kiteFaq) ? true : null,
    includedServices: /café da manhã/i.test(included) ? ['Breakfast', 'Wi-Fi', 'Air conditioning'] : ['Wi-Fi', 'Air conditioning'],
    optionalServices: ['Kite lessons with instructors at the kitepoint (booked separately)', 'Restaurant meals'],
    accommodation: 'beachfront chalets',
    mealPlan: /café da manhã/i.test(included) ? 'breakfast' : null,
    languages: ['pt'],
    rooms,
    imageUrls: imgs.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: ADV_PAGES.about,
    bookingUrl: 'https://wa.me/5584994686352',
    sourceText: [
      `home: ${home.join(' ').slice(0, 5000)}`,
      `facilities: ${facilities.join(', ')}`,
      `faq: ${faq.map(f => `${f.q} ${f.a}`).join(' | ')}`,
      `review dates: ${reviews.join(', ')}`,
    ].join('\n'),
  };
}

/** No published price: [] (price on request). Returns the amounts if the home page starts printing some. */
export function advVisiblePrices(homeHtml: string): string[] {
  return findPrices(advLines(homeHtml).join(' ')).map(p => p.raw);
}

// --- adapter ----------------------------------------------------------------------------------
export const amigosDoVentoTouros: OfferAdapter = {
  key: 'amigos-do-vento-touros',
  name: 'Amigos do Vento Chalés & Kitepoint Touros',
  kind: 'accommodation',
  operator: {
    name: 'Amigos do Vento Chalés & Kitepoint',
    websiteUrl: SITE,
    rootDomain: 'amigosdovento.com',
    contactEmail: 'reservas@amigosdovento.com',
    phone: '+5584994686352',
    whatsapp: '+5584994686352',
  },
  url: ADV_PAGES.about,
  slotMethod: 'price_table',
  fetchBudget: 4,
  confidence: 'low', // no prices or dates on the site; WhatsApp / e-mail booking only
  async fetchContent() {
    const [home, about, contact] = [await page(ADV_PAGES.home), await page(ADV_PAGES.about), await page(ADV_PAGES.contact)];
    return parseAmigosContent({ home, about, contact });
  },
  async fetchSlots(ctx): Promise<Slot[]> {
    const html = await page(ADV_PAGES.home);
    if (!/kitepoint/i.test(html)) throw new Error('amigos-do-vento: kitepoint text missing on the home page (layout changed?)');
    const prices = advVisiblePrices(html);
    if (prices.length) ctx.note(`prices appeared on the home page (${prices.slice(0, 5).join(', ')}): extend the adapter`);
    return [];
  },
};
