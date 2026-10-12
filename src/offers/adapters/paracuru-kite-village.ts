// ---------------------------------------------------------------------------
// Paracuru Kite Village, Paracuru (Ceará, Brazil) - family-run pousada with 16 units on a 2,500 m2 plot at the foot
// of the Paracuru dunes, next to a protected natural park; an area to store, wash and repair kite gear, taxis to the
// Paracuru kite spot, IKO lessons, downwinders and kite trips arranged with partner instructors.
//
// Inclusion: Aaron's decision of 2026-10-12 (weak liveness: content only, confidence 'low'). Kite link on the own
//   site: "Em nossa pousada oferecemos uma área para armazenamento, manutenção e lavagem de seu material esportivo.
//   Além disso organizamos táxis para levar você ao kite spot" (/kitesurf/); every rate includes "Área para limpeza,
//   Suporte, Manutenção e Reparos de Equipamentos de Kite" (/acomodacoes/). Newest sign of life: footer "© 2026
//   Paracuru Kite Village" (the WordPress uploads date from 2020; no dated season, price or calendar).
//
// Data path (checked 2026-10-12): paracurukitevillage.com.br (WordPress/Elementor, Portuguese only):
//   content  /a-pousada/ (plot, park, awards), /acomodacoes/ (included services, 4 unit categories with counts and
//            features), /servicos/ (check-in/out, extra services), /kitesurf/ (wind season, spot, services for kiters).
//   slots    none: no page prints a price ("Demais serviços extras, consulte disponibilidade e valores"); booking by
//            WhatsApp / e-mail. fetchSlots re-reads /acomodacoes/ (memoised) and returns [] (offer = "price on
//            request"); it notes when a price shows up.
// robots.txt (2026-10-12): only /wp-admin/ disallowed (admin-ajax allowed).
// Requests per run: content 4, slots 1 (0 extra when content ran in the same process).
// Known limits: the Google map is a name query (no coordinates) -> no spotCoords. Stock photos on /kitesurf/ and
//   /servicos/ (Pixabay "_960_720" files: taxi, massage, kiting; a credited "by-sam-schofield" photo) are dropped. "10 anos de mercado" on /servicos/
//   is undated text, not used.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { collapse, parse } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://paracurukitevillage.com.br';
export const PKV_ABOUT_URL = `${SITE}/a-pousada/`;
export const PKV_ROOMS_URL = `${SITE}/acomodacoes/`;
export const PKV_SERVICES_URL = `${SITE}/servicos/`;
export const PKV_KITE_URL = `${SITE}/kitesurf/`;
const WHATSAPP = '+5585987908984';

// --- local helpers ----------------------------------------------------------------------------
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

/** Visible block lines of the page content, up to the guest reviews / booking footer. */
export function pkvLines(html: string): string[] {
  const root = parse(html);
  for (const el of root.querySelectorAll('script, style, noscript, svg, header, footer, nav, [data-elementor-type="header"], [data-elementor-type="footer"]')) el.remove();
  const lines = (root.querySelector('main') ?? root.querySelector('body') ?? root).structuredText.split('\n').map(l => collapse(l)).filter(Boolean);
  const end = lines.findIndex(l => /^Pousada muito agradável|^Faça sua reserva$/i.test(l));
  return (end > 0 ? lines.slice(0, end) : lines).filter(l => !/^(Ir para o conteúdo|Menu principal|INÍCIO|A POUSADA|ACOMODAÇÕES|SERVIÇOS|KITESURF|O QUE FAZER|CONTATO|SABER \+)$/.test(l));
}

const FEATURE_EN: Array<[RegExp, string]> = [
  [/^Ar Condicionado$/i, 'Air conditioning'], [/^Frigobar$/i, 'Minibar'], [/^Ducha Quente$/i, 'Hot shower'],
  [/^TV LED (\d+)″?\s*(SKY)?$/i, 'TV'], [/^Varanda com Rede$/i, 'Veranda with hammock'], [/^Andar Térreo$/i, 'Ground floor'],
  [/^Unidade Privativa$/i, 'Private unit'], [/^Ventilador$/i, 'Fan'], [/^Varanda Compartilhada$/i, 'Shared veranda'],
  [/^Andar Superior$/i, 'Upper floor'], [/^Varanda Privativa com Rede e Vista para Dunas$/i, 'Private veranda with hammock and dune view'],
  [/^Capacidade Máxima: (\d+) Pessoas?$/i, 'Up to $1 guests'],
];
export function featureEn(f: string): string {
  const tv = f.match(/^TV LED (\d+)″?\s*(SKY)?$/i);
  if (tv) return `${tv[1]}" LED TV${tv[2] ? ' (Sky)' : ''}`;
  for (const [re, en] of FEATURE_EN) if (re.test(f)) return f.replace(re, en);
  return f;
}
const UNIT_EN: Array<[RegExp, string]> = [
  [/^Garden Suíte VIP$/i, 'Garden Suite VIP'], [/^Chalés Suítes$/i, 'Chalet Suite'], [/^Standards?$/i, 'Standard Room'], [/^Dunas Suíte$/i, 'Dunas Suite'],
];
const unitEn = (n: string): string => UNIT_EN.find(([re]) => re.test(n))?.[1] ?? n;
const listEn = (xs: string[]): string => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs.join(''));

const INCLUDED_EN: Array<[RegExp, string]> = [
  [/Café da Manh/i, 'Breakfast (varied menu)'], [/Internet Wi-?fi/i, 'Wi-Fi'], [/Uso da Piscina/i, 'Pool'],
  [/Estacionamento/i, 'Parking (subject to availability)'], [/Segurança 24/i, '24-hour security'], [/Sala de TV/i, 'TV and video room'],
  [/Equipamentos de Kite/i, 'Area to clean, maintain and repair kite equipment'],
];

// --- pure parsers -----------------------------------------------------------------------------
export interface PkvUnit { count: number; name: string; features: string[] }

/** /acomodacoes/: "01 – Garden Suíte VIP" headings followed by feature lines. */
export function parsePkvUnits(html: string): PkvUnit[] {
  const out: PkvUnit[] = [];
  let cur: PkvUnit | null = null;
  for (const l of pkvLines(html)) {
    const h = l.match(/^(\d{1,2})\s*[–-]\s*(.+)$/);
    if (h) { cur = { count: Number(h[1]), name: unitEn(h[2].trim()), features: [] }; out.push(cur); continue; }
    if (cur && l.length <= 60 && !/Incluso/i.test(l)) cur.features.push(featureEn(l));
    else if (cur) cur = null;
  }
  return out;
}

/** "Incluso em Todas as Diárias" list (Portuguese), translated. */
export function parsePkvIncluded(html: string): string[] {
  const lines = pkvLines(html);
  const a = lines.findIndex(l => /^Incluso em Todas as Diárias$/i.test(l));
  if (a < 0) return [];
  const out: string[] = [];
  for (const l of lines.slice(a + 1)) {
    const en = INCLUDED_EN.find(([re]) => re.test(l))?.[1];
    if (!en) break;
    out.push(en);
  }
  return out;
}

/** Own photos (wp-content/uploads originals; PNG badges, avatars, guest portraits and Pixabay stock dropped). */
export function pkvImages(pages: string[], max = 30): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const html of pages) {
    for (const m of html.matchAll(/https:\/\/paracurukitevillage\.com(?:\.br)?\/wp-content\/uploads\/[^"' )?,]+\.jpe?g/gi)) {
      const raw = m[0].replace(/-\d+x\d+(\.[a-z]+)$/i, '$1');
      if (/_960_720|\/by-|avatar|rafael-f|mari-r|cezar|logo|icon|image\d+/i.test(raw)) continue;
      const name = raw.split('/').pop()!.toLowerCase();
      if (seen.has(name)) continue;
      seen.add(name);
      out.push(new URL(raw.replace('://paracurukitevillage.com/', '://paracurukitevillage.com.br/')).toString());
    }
  }
  return out.slice(0, max);
}

export function pkvVisiblePrices(html: string): string[] {
  return [...pkvLines(html).join(' ').matchAll(/R\$\s?\d[\d.,]*/g)].map(m => m[0]);
}

export interface PkvPages { about: string; rooms: string; services: string; kite: string }

export function parseParacuruContent(p: PkvPages): OfferContent {
  const about = pkvLines(p.about).join(' ');
  const services = pkvLines(p.services).join(' ');
  const kite = pkvLines(p.kite).join(' ');
  const units = parsePkvUnits(p.rooms);
  const included = parsePkvIncluded(p.rooms);
  const total = units.reduce((n, u) => n + u.count, 0);
  const area = about.match(/área de ([\d.]+) m²/)?.[1] ?? null;
  const wind = kite.match(/ventos constantes de (\d+) a (\d+) nós durante os meses de (\w+) a (\w+)/);
  const PT: Record<string, string> = { janeiro: 'January', fevereiro: 'February', março: 'March', abril: 'April', maio: 'May', junho: 'June', julho: 'July', agosto: 'August', setembro: 'September', outubro: 'October', novembro: 'November', dezembro: 'December' };
  const checkIn = services.match(/Check In A partir das (\d+) Horas/i)?.[1] ?? null;
  const checkOut = services.match(/Check Out Até as (\d+) Horas/i)?.[1] ?? null;
  const iko = /instrutores altamente qualificados com IKO/i.test(kite);
  const lessonLangs = /Aulas disponíveis em inglês, francês, português, italiano e espanhol/i.test(kite);

  const rooms: ContentRoom[] = units.map(u => ({
    name: u.name,
    description: `${u.count} unit${u.count > 1 ? 's' : ''}.`,
    features: u.features,
  }));
  const guests = units.map(u => Number(u.features.map(f => f.match(/^Up to (\d+) guests$/)?.[1]).find(Boolean))).filter(n => n > 0);

  const summary = [
    `Paracuru Kite Village is a pousada with ${total || 16} units${area ? ` on a ${area.replace('.', ',')} m2 plot crossed by a river` : ''} at the foot of the Paracuru dunes in Ceará, Brazil, next to a protected natural park and close to the town centre and the beach.`,
    units.length
      ? `It has ${listEn(units.map(u => `${u.count} ${u.name}${u.count > 1 && !/s$/.test(u.name) ? 's' : ''}`))}${guests.length ? ` for ${Math.min(...guests)} to ${Math.max(...guests)} guests` : ''}, all with hot shower; breakfast, Wi-Fi and the pool are included.`
      : 'Breakfast, Wi-Fi and the pool are included.',
    `For kiters the pousada has an area to store, wash and repair gear, books taxis to the Paracuru kite spot and arranges${iko ? ' IKO' : ''} lessons, downwinders and kite trips${wind ? `; the wind blows ${wind[1]} to ${wind[2]} knots from ${PT[wind[3].toLowerCase()] ?? wind[3]} to ${PT[wind[4].toLowerCase()] ?? wind[4]}, with waves at high tide and flat water at low tide` : ''}.`,
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Paracuru Kite Village',
    summary,
    continent: 'South America',
    country: 'Brazil',
    region: 'Paracuru, Ceará',
    spot: 'Paracuru',
    spotCoords: null, // the site's Google map is a name query, no coordinates
    itinerarySpots: [],
    durationDays: null,
    // kitesurf page: "ideal para todos os níveis, inclusive iniciantes"
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: /Aulas de Kite/i.test(kite),
    equipmentRental: null, // rental is at the spot's schools, not the pousada
    beginnerFriendly: /inclusive iniciantes/i.test(kite) ? true : null,
    includedServices: included.length ? included : ['Breakfast', 'Wi-Fi', 'Pool', 'Area to clean, maintain and repair kite equipment'],
    optionalServices: [
      `Kite lessons with ${iko ? 'IKO-certified ' : ''}partner instructors${lessonLangs ? ' (English, French, Portuguese, Italian, Spanish)' : ''}`,
      'Downwinders and kite trips with buggy or 4x4 support',
      'Taxi to the Paracuru kite spot',
      'Kite repair pick-up service',
      'Sports and relaxing massage',
      'Airport transfer from Fortaleza',
      'Car and motorbike rental',
      'Buggy and 4x4 tours',
      'Group lunches and dinners',
    ],
    accommodation: 'suites, chalets and rooms in a tropical garden',
    mealPlan: 'breakfast',
    languages: ['pt', 'en', 'es'], // "ATENDIMENTO EM INGLÊS E ESPANHOL"
    rooms,
    imageUrls: pkvImages([p.rooms, p.about, p.kite]),
    heroVideoUrl: null,
    sourceUrl: PKV_ROOMS_URL,
    bookingUrl: `https://wa.me/${WHATSAPP.slice(1)}`,
    sourceText: [
      `a pousada: ${about}`,
      `acomodacoes: ${pkvLines(p.rooms).join(' ')}`,
      `servicos: ${services}`,
      `kitesurf: ${kite}`,
      `check-in ${checkIn ?? '-'}h, check-out ${checkOut ?? '-'}h`,
    ].join('\n'),
  };
}

// --- adapter ----------------------------------------------------------------------------------
export const paracuruKiteVillage: OfferAdapter = {
  key: 'paracuru-kite-village',
  name: 'Paracuru Kite Village',
  kind: 'accommodation',
  operator: {
    name: 'Paracuru Kite Village',
    websiteUrl: SITE,
    rootDomain: 'paracurukitevillage.com.br',
    contactEmail: 'info@paracurukitevillage.com.br',
    phone: '+558533441502',
    whatsapp: WHATSAPP,
  },
  url: PKV_ROOMS_URL,
  slotMethod: 'price_table',
  fetchBudget: 5,
  confidence: 'low', // Aaron 2026-10-12: weak liveness (footer year only), content only, no prices on the site
  async fetchContent() {
    const [about, rooms, services, kite] = [await page(PKV_ABOUT_URL), await page(PKV_ROOMS_URL), await page(PKV_SERVICES_URL), await page(PKV_KITE_URL)];
    return parseParacuruContent({ about, rooms, services, kite });
  },
  async fetchSlots(ctx): Promise<Slot[]> {
    const html = await page(PKV_ROOMS_URL);
    if (parsePkvUnits(html).length === 0) throw new Error('paracuru-kite-village: unit list missing on /acomodacoes/ (layout changed?)');
    const prices = pkvVisiblePrices(html);
    if (prices.length) ctx.note(`prices appeared on /acomodacoes/ (${prices.slice(0, 5).join(', ')}): extend the adapter`);
    return [];
  },
};
