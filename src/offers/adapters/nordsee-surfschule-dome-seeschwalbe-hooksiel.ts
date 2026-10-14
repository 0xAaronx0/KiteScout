// ---------------------------------------------------------------------------
// Nordsee Surfschule / Nordsee Academy, Wangerland (East Frisia, German North Sea) - the kite school's own lodging: a
// Glamping Dome at its mooi Strandhaus station in Hooksiel ("zweiter Hauptstandort unserer Kiteschule", "Keine 200 Meter
// von hier entfernt befindet sich die einzige Kitezone Hooksiels") and the holiday apartments of Haus Seeschwalbe in
// Schillig, "nur wenige Minuten von unserer Kite- und Windsurfstation in Schillig". Both are run by Surf In GmbH (school
// imprint and Seeschwalbe imprint: Lange Drift 108, 26434 Wangerland).
//
// Data path (checked 2026-10-14):
//   content  nordsee-surfschule.de (WordPress): /unterkuenfte/ (dome + apartments), / (season notice "Die Saison 2027
//            wird bereits Ostern beginnen", "Unsere Ferienunterkünfte in Schillig sind ganzjährig buchbar"),
//            /kitekurse/ (VDWS school, Core + Flysurfer, spots Hooksiel / Schillig / Harlesiel), /mooi-strandhaus-hooksiel/
//            (dome location next to the Hooksiel kite zone).
//            seeschwalbe-schillig.com is a Sitelio site: the HTML is a shell, the page content is a JSON data file
//            (var SiteFilesMap {"page-<id>": "https://storage.googleapis.com/te-sitelio-sites/.../<hash>.js"}, content
//            "PagesStructures['<id>'] = {...}") - read with two plain GETs, no headless browser needed. It carries the
//            apartment names + capacities, the 2026 season periods, extra costs, minimum stay, the Google map position
//            and the gallery photos.
//   slots    none: the dome has no printed price, the apartment price table on the Seeschwalbe page is not text (only the
//            seasons and extras are; the price element between them is an image - inferred from the page structure, not
//            read), and both book through Smoobu (login.smoobu.com booking-tool iframe 249133), which we do not use (bot
//            challenge, see docs/offer-adapters.md). fetchSlots returns [] -> "price on request".
// robots.txt (2026-10-14): nordsee-surfschule.de 404 (= allow all); seeschwalbe-schillig.com "Allow: /";
//   storage.googleapis.com 404 (= allow all).
// Requests per run: content 6, slots 0.
// Known limits: no coordinates for the dome; the Seeschwalbe map position (Schillig) is kept in the room text, not used
//   as the pin (the listing's spot is Hooksiel). The school's e-mail address is obfuscated on its site -> none stored.
// ---------------------------------------------------------------------------
import { fetchText } from '../http.js';
import { clean, collapse, imageCandidates, parse } from '../parse.js';
import type { ContentRoom, OfferAdapter, OfferContent, Slot } from '../types.js';

const SITE = 'https://www.nordsee-surfschule.de';
export const NS_LODGING_URL = `${SITE}/unterkuenfte/`;
export const NS_HOME_URL = `${SITE}/`;
export const NS_KITE_URL = `${SITE}/kitekurse/`;
export const NS_STRANDHAUS_URL = `${SITE}/mooi-strandhaus-hooksiel/`;
export const SS_HOME_URL = 'https://seeschwalbe-schillig.com/';

const memo = new Map<string, { at: number; p: Promise<string> }>();
function page(url: string, accept = 'text/html'): Promise<string> {
  const hit = memo.get(url);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.p;
  const p = fetchText(url, { accept });
  memo.set(url, { at: Date.now(), p });
  p.catch(() => memo.delete(url));
  return p;
}

/** Visible text of a WordPress page's content (header / footer / scripts dropped), block boundaries as spaces. */
export function nsText(html: string): string {
  const root = parse(html.replace(/<(?=\/?(?:p|div|li|ul|ol|h[1-6]|br|section|figure|span|a|td|th|tr)\b)/gi, ' <'));
  for (const el of root.querySelectorAll('script, style, noscript, svg, header, footer, nav, .qodef-page-footer')) el.remove();
  return collapse((root.querySelector('.content') ?? root.querySelector('main') ?? root.querySelector('body') ?? root).text);
}

// --- Sitelio (seeschwalbe-schillig.com) -------------------------------------------------------
/** Home page data file from the shell's `var SiteFilesMap` + `"defaultAjaxPageID"`. */
export function sitelioPageFileUrl(html: string): string | null {
  const map = html.match(/var SiteFilesMap = (\{[^;]*?\});/)?.[1];
  const id = html.match(/"defaultAjaxPageID":"([^"]+)"/)?.[1];
  if (!map || !id) return null;
  try { return (JSON.parse(map) as Record<string, string>)[`page-${id}`] ?? null; } catch { return null; }
}

interface SitelioEl { type: string; text: string | null; top: number | null; left: number | null; mapPosition: [number, number] | null; gallery: Array<{ url: string; title: string | null }> }

/** Flatten the PagesStructures JSON into elements (document order) with their text, position, map and gallery data. */
export function sitelioElements(js: string): SitelioEl[] {
  const start = js.indexOf('= ');
  const data = JSON.parse(js.slice(start + 2).trim().replace(/;\s*$/, '')) as unknown;
  const out: SitelioEl[] = [];
  const walk = (x: unknown): void => {
    if (Array.isArray(x)) { x.forEach(walk); return; }
    if (!x || typeof x !== 'object') return;
    const o = x as Record<string, unknown>;
    if (typeof o.type === 'string' && o.elementProperties && typeof o.elementProperties === 'object') {
      const ep = o.elementProperties as Record<string, unknown>;
      const pos = ((o.metaData as Record<string, unknown> | undefined)?.position ?? null) as { top?: number; left?: number } | null;
      const ft = typeof ep.formattedText === 'string' ? ep.formattedText : null;
      const text = ft ? clean(ft.replace(/<br\s*\/?>|<\/(?:div|p|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/[​‎‏‬]/g, '').split('\n').map(s => s.trim()).filter(Boolean).join(' | ')) : null;
      const cur = ((ep.dataInfo as Record<string, unknown> | undefined)?.currentData ?? null) as Record<string, Record<string, unknown>> | null;
      const gallery = cur ? Object.values(cur)
        .sort((a, b) => Number(a.index ?? 0) - Number(b.index ?? 0))
        .map(it => ({ url: String(((it.image as Record<string, unknown> | undefined)?.imageUrl as Record<string, unknown> | undefined)?.imagePath ?? ''), title: typeof it.title === 'string' ? it.title : null }))
        .filter(g => /^https:\/\//.test(g.url)) : [];
      const mp = ep.mapPosition;
      out.push({
        type: o.type, text, top: typeof pos?.top === 'number' ? pos.top : null, left: typeof pos?.left === 'number' ? pos.left : null,
        mapPosition: Array.isArray(mp) && mp.length === 2 && mp.every(n => typeof n === 'number') ? [mp[0] as number, mp[1] as number] : null,
        gallery,
      });
    }
    for (const v of Object.values(o)) if (v && typeof v === 'object') walk(v);
  };
  walk(data);
  return out;
}

export interface SsApartment { name: string; maxPersons: number | null }
export interface Seeschwalbe {
  apartments: SsApartment[];
  seasons: string[];
  extras: string[];
  minStay: string | null;
  map: { lat: number; lng: number } | null;
  images: string[];
  intro: string | null;
}

/** Apartment names (one-word texts between "UNSERE WOHNUNGEN" and "UNSERE PREISE") get the capacity line just above them. */
export function parseSeeschwalbe(js: string): Seeschwalbe {
  const els = sitelioElements(js);
  const texts = els.filter(e => e.type === 'freeText' && e.text && e.top !== null) as Array<SitelioEl & { text: string; top: number }>;
  const from = texts.find(e => /^UNSERE WOHNUNGEN/i.test(e.text))?.top ?? null;
  const to = texts.find(e => /^UNSERE PREISE/i.test(e.text))?.top ?? null;
  const capacity = texts.filter(e => /^Diese Wohnung/i.test(e.text));
  const apartments: SsApartment[] = [];
  if (from !== null && to !== null) {
    for (const e of texts.filter(t => t.top > from && t.top < to && /^[A-ZÄÖÜ][a-zäöüß]+$/.test(t.text)).sort((a, b) => a.top - b.top || (a.left ?? 0) - (b.left ?? 0))) {
      const cap = capacity.filter(c => c.top <= e.top).sort((a, b) => b.top - a.top)[0];
      const own = cap?.text.match(new RegExp(`(\\d+)\\s*Personen\\s*\\(${e.text}\\)`))?.[1];
      const any = cap?.text.match(/bis zu\s*(\d+)\s*Person/)?.[1];
      apartments.push({ name: e.text, maxPersons: Number(own ?? any) || null });
    }
  }
  const seasons = texts.filter(e => /^(Haupt|Neben|Winter)saison/i.test(e.text)).map(e => e.text);
  const costs = texts.find(e => /Sonstige Kosten/i.test(e.text))?.text ?? '';
  const stay = texts.find(e => /Mindestaufenthalt/i.test(e.text))?.text ?? '';
  const extras = [
    ...costs.split(' | ').filter(s => /Euro|Kostenfrei/i.test(s) && !/^Sonstige Kosten/i.test(s)),
    ...stay.split(' | ').filter(s => /Endreinigung/i.test(s)),
  ];
  const map = els.find(e => e.mapPosition)?.mapPosition ?? null;
  const images: string[] = [];
  for (const e of els) for (const g of e.gallery) if (!images.includes(g.url)) images.push(g.url);
  return {
    apartments, seasons, extras,
    minStay: stay.split(' | ').find(s => /Mindestaufenthalt/i.test(s)) ?? null,
    map: map ? { lat: Math.round(map[0] * 1e6) / 1e6, lng: Math.round(map[1] * 1e6) / 1e6 } : null,
    images,
    intro: texts.find(e => /^Der ideale Ort für Erholung/i.test(e.text))?.text ?? null,
  };
}

/** Seeschwalbe "Sonstige Kosten" lines in English (free items are in includedServices; unknown lines stay German). */
export function ssExtraEn(line: string): string | null {
  const eur = line.match(/(\d+(?:,\d+)?)\s*Euro/)?.[1]?.replace(',', '.') ?? null;
  if (/Kostenfrei/i.test(line)) return null;
  if (/Kinderreisepaket/i.test(line) && eur) return `Child package (cot and high chair): EUR ${eur}`;
  if (/Haustiere/i.test(line) && eur) return `Pets: EUR ${eur} per animal per night`;
  if (/Wäschepaket/i.test(line) && eur) return `Linen package (bed linen + 2 towels): EUR ${eur} per person`;
  if (/Endreinigung/i.test(line) && eur) return `Final cleaning: EUR ${eur} per stay`;
  return line;
}

// --- nordsee-surfschule.de ------------------------------------------------------------------------
export interface NsPages { lodging: string; home: string; kite: string; strandhaus: string; seeschwalbe: string }

export function parseNordseeContent(p: NsPages): OfferContent {
  const lodging = nsText(p.lodging);
  const home = nsText(p.home);
  const kite = nsText(p.kite);
  const strand = nsText(p.strandhaus);
  const ss = parseSeeschwalbe(p.seeschwalbe);
  const dome = lodging.match(/Du hast Lust, mit Meerblick zu wohnen[\s\S]*?glücklich ein\./)?.[0] ?? null;
  const domeKit = lodging.match(/Ihr findet dort einen Wasserkocher[^.]*\./)?.[0] ?? null;
  const flats = lodging.match(/Wünscht du dir ein Ferienappartment in Schillig[\s\S]*?zusammenzukommen\./)?.[0] ?? null;
  const season = home.match(/Für die Saison 2026[\s\S]*?online buchbar\./)?.[0] ?? null;
  const yearRound = home.match(/Unsere Ferienunterkünfte in Schillig sind ganzjährig buchbar\./)?.[0] ?? null;
  const school = kite.match(/An unseren Top-Revieren Hooksiel, Schillig und Harlesiel[^.]*\./)?.[0] ?? null;
  const strandKite = strand.match(/Im mooi Strandhaus in Hooksiel befindet sich nicht nur der zweite Hauptstandort unserer Kiteschule[^.]*\./)?.[0] ?? null;
  const zone = strand.match(/Keine 200 Meter von hier entfernt befindet sich die einzige Kitezone Hooksiels[^.]*\./)?.[0] ?? null;
  const caps = ss.apartments.map(a => a.maxPersons).filter((n): n is number => !!n);
  const capRange = caps.length ? `${Math.min(...caps)}-${Math.max(...caps)}` : '1-4';

  const rooms: ContentRoom[] = [
    {
      name: 'Glamping Dome (Hooksiel)',
      description: 'Dome tent with sea view at the school\'s mooi Strandhaus station in Hooksiel: 180 cm double bed, extra blankets and hot-water bottles, heating, armchairs, a small kitchen corner; WC and shower next door in the Strandhaus (own key).',
      features: ['Kettle, Senseo coffee machine, fridge, standard crockery', 'Bed linen and two large towels', 'Safe, clothes rail', 'Less than 200 m to the Hooksiel kite zone', 'Price on request (online booking)'],
    },
    ...ss.apartments.map(a => ({
      name: `Apartment ${a.name} (Haus Seeschwalbe, Schillig)`,
      description: `Holiday apartment${a.maxPersons ? ` for up to ${a.maxPersons} persons` : ''} in Haus Seeschwalbe, Jadestraße 4, Schillig, behind the dike a few minutes' walk from the sea.`,
      features: [
        'Pets welcome on request',
        'Electricity, water, heating, rubbish, internet and TV included in the rent',
        'One parking space per apartment',
        ...(ss.minStay ? [ss.minStay.replace('Mindestaufenthalt sind 3 Nächte.', 'Minimum stay 3 nights.').replace('In den Sommerferien vermieten wir wochenweise ab samstags.', 'Weekly from Saturday in the summer holidays.')] : []),
        ...(ss.map ? [`Map position (Seeschwalbe site): ${ss.map.lat}, ${ss.map.lng}`] : []),
      ],
    })),
  ];

  const imgs: string[] = [];
  const seen = new Set<string>();
  for (const u of [...imageCandidates(p.lodging, NS_LODGING_URL, null, 60), ...ss.images]) {
    if (/logo|favicon|Bildschirmfoto|\.svg|\.png$/i.test(u)) continue;
    if (/nordsee-surfschule\.de/.test(u) && !/\/wp-content\/uploads\//.test(u)) continue;
    const k = u.replace(/-(?:\d+x\d+|scaled)(?=\.[a-z]+$)/i, '');
    if (seen.has(k)) continue;
    seen.add(k); imgs.push(u);
  }

  const summary = [
    'The Nordsee Academy (Nordsee Surfschule), a VDWS kite and windsurf school in Wangerland on the East Frisian North Sea coast, rents its own accommodation:',
    'a glamping dome with a 180 cm double bed, heating and a small kitchen corner at its mooi Strandhaus station in Hooksiel, less than 200 m from the Hooksiel kite zone,',
    `and ${ss.apartments.length || 'several'} holiday apartments for ${capRange} people in Haus Seeschwalbe in Schillig, behind the dike a few minutes from its Schillig kite station.`,
    'The apartments are bookable all year (minimum stay 3 nights, final cleaning EUR 70); prices are on request.',
    'The school teaches kitesurfing with Core and Flysurfer equipment at Hooksiel, Schillig and Harlesiel; its 2027 season starts at Easter.',
  ].join(' ');

  return {
    kind: 'accommodation',
    title: 'Nordsee Surfschule Glamping Dome & Haus Seeschwalbe',
    summary,
    continent: 'Europe',
    country: 'Germany',
    region: 'Hooksiel, Wangerland',
    spot: 'Hooksiel',
    itinerarySpots: [],
    durationDays: null,
    skillLevels: ['beginner', 'intermediate', 'advanced'],
    kiteLessons: school ? true : null,
    equipmentRental: /Vermietung/i.test(kite) ? true : null,
    beginnerFriendly: true,
    includedServices: [
      'Dome: bed linen and towels, kitchen corner, heating, sanitary facilities in the Strandhaus next door',
      'Apartments: utilities, internet and TV, one parking space, bike garage, barbecue area and handcart',
    ],
    optionalServices: [
      'Kitesurfing courses (VDWS) and rental at the Nordsee Academy stations in Hooksiel and Schillig',
      ...ss.extras.map(ssExtraEn).filter((x): x is string => !!x).map(x => `Haus Seeschwalbe: ${x}`),
    ],
    accommodation: 'glamping dome at the kite station + holiday apartments',
    mealPlan: 'self_catering',
    languages: ['de'],
    rooms,
    imageUrls: imgs.slice(0, 30),
    heroVideoUrl: null,
    sourceUrl: NS_LODGING_URL,
    bookingUrl: NS_LODGING_URL,
    sourceText: [
      `dome: ${dome ?? ''} ${domeKit ?? ''}`,
      `apartments: ${flats ?? ''}`,
      `home: ${season ?? ''} | ${yearRound ?? ''}`,
      `kite school: ${school ?? ''}`,
      `mooi Strandhaus Hooksiel: ${strandKite ?? ''} ${zone ?? ''}`,
      `Seeschwalbe: ${ss.intro ?? ''}`,
      `Seeschwalbe apartments: ${ss.apartments.map(a => `${a.name} (max ${a.maxPersons ?? '?'})`).join(', ')}`,
      `Seeschwalbe seasons: ${ss.seasons.join(' / ')}`,
      `Seeschwalbe extras: ${ss.extras.join('; ')} | ${ss.minStay ?? ''}`,
    ].join('\n'),
  };
}

export const nordseeSurfschuleDomeSeeschwalbeHooksiel: OfferAdapter = {
  key: 'nordsee-surfschule-dome-seeschwalbe-hooksiel',
  name: 'Nordsee Surfschule Glamping Dome & Haus Seeschwalbe',
  kind: 'accommodation',
  operator: {
    name: 'Nordsee Academy (Surf In GmbH)',
    websiteUrl: SITE,
    rootDomain: 'nordsee-surfschule.de',
    phone: '+491638460040',
  },
  url: NS_LODGING_URL,
  slotMethod: 'price_table',
  fetchBudget: 7,
  confidence: 'low', // no prices readable
  async fetchContent() {
    const lodging = await page(NS_LODGING_URL);
    const home = await page(NS_HOME_URL);
    const kite = await page(NS_KITE_URL);
    const strandhaus = await page(NS_STRANDHAUS_URL);
    const shell = await page(SS_HOME_URL);
    const file = sitelioPageFileUrl(shell);
    if (!file) throw new Error('nordsee-surfschule: Sitelio SiteFilesMap / defaultAjaxPageID not found on seeschwalbe-schillig.com');
    const seeschwalbe = await page(file, '*/*');
    if (!/Glamping Dome/i.test(lodging)) throw new Error('nordsee-surfschule: Glamping Dome text missing on /unterkuenfte/');
    return parseNordseeContent({ lodging, home, kite, strandhaus, seeschwalbe });
  },
  async fetchSlots(ctx) {
    ctx.note('nordsee-surfschule: no readable prices (dome unpriced, Seeschwalbe table not text, Smoobu not used) - price on request');
    return [] as Slot[];
  },
};
