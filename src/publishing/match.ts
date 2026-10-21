// ---------------------------------------------------------------------------
// Deterministic matchers: is this exact value (name, number + currency, date) printed on the page?
// Every hit returns where it was found (zone + character offset in the zone) and a short excerpt, so
// the evidence sidecar can point at it. Matching is accent- and case-insensitive, nothing else is fuzzy.
// ---------------------------------------------------------------------------
import type { EvidencePage, Zone } from './evidence-page.js';

export interface Hit { zone: Zone; offset: number; excerpt: string; matched: string }

// --- folding with an offset map back to the original text ---------------------------------------
interface Folded { text: string; map: number[] }
const foldCache = new WeakMap<object, Map<Zone, Folded>>();
function foldChar(c: string): string {
  return c.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[‘’´`]/g, "'").replace(/[“”«»]/g, '"').replace(/[‐-―−]/g, '-')
    .replace(/[   ]/g, ' ');
}
export function fold(s: string): string { return [...s].map(foldChar).join(''); }
function folded(page: EvidencePage, zone: Zone): Folded {
  let byZone = foldCache.get(page);
  if (!byZone) { byZone = new Map(); foldCache.set(page, byZone); }
  const hit = byZone.get(zone);
  if (hit) return hit;
  const src = page.zones[zone];
  let text = '';
  const map: number[] = [];
  let i = 0;
  for (const c of src) {
    const f = foldChar(c);
    for (let k = 0; k < f.length; k++) map.push(i);
    text += f;
    i += c.length;
  }
  map.push(src.length);
  const out = { text, map };
  byZone.set(zone, out);
  return out;
}
const ZONES: Zone[] = ['visible', 'meta', 'jsonld'];

function excerptAt(page: EvidencePage, zone: Zone, start: number, end: number): string {
  const src = page.zones[zone];
  const a = Math.max(0, start - 50);
  const b = Math.min(src.length, end + 50);
  return `${a > 0 ? '...' : ''}${src.slice(a, b)}${b < src.length ? '...' : ''}`.slice(0, 200);
}

/** First match of a regex (built against folded text) across zones, visible text first. */
export function findPattern(page: EvidencePage, re: RegExp, zones: Zone[] = ZONES): Hit | null {
  for (const zone of zones) {
    const f = folded(page, zone);
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
    const m = g.exec(f.text);
    if (!m) continue;
    const start = f.map[m.index];
    const end = f.map[m.index + m[0].length] ?? page.zones[zone].length;
    return { zone, offset: start, matched: page.zones[zone].slice(start, end), excerpt: excerptAt(page, zone, start, end) };
  }
  return null;
}

const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Whole-phrase match (word boundaries on letters/digits), case- and accent-insensitive, flexible whitespace. */
export function findPhrase(page: EvidencePage, phrase: string, zones?: Zone[]): Hit | null {
  const parts = fold(phrase).trim().split(/\s+/).filter(Boolean).map(esc);
  if (!parts.length) return null;
  return findPattern(page, new RegExp(`(?<![\\p{L}\\p{N}])${parts.join('[\\s\\-]+')}(?![\\p{L}\\p{N}])`, 'u'), zones);
}

/** Exact quote check for LLM-returned excerpts: the quote must occur on the page (whitespace/case/accent-insensitive). */
export function findQuote(page: EvidencePage, quote: string): Hit | null {
  const q = fold(quote).replace(/\s+/g, ' ').trim();
  if (q.length < 3) return null;
  return findPattern(page, new RegExp(q.split(' ').map(esc).join('\\s*')));
}

// --- names -------------------------------------------------------------------------------------
const LEGAL = /\b(gmbh|ltd|llc|inc|s\.?l\.?|sarl|s\.?a\.?s?|bv|b\.v\.|oy|ab|as|aps|pty|co)\b\.?/gi;
/** Operator name variants: full, without a parenthetical, the parenthetical alone, without legal suffixes. */
export function nameVariants(name: string): string[] {
  const out = new Set<string>([name.trim()]);
  const paren = name.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (paren) { out.add(paren[1].trim()); out.add(paren[2].trim()); }
  for (const v of [...out]) {
    const bare = v.replace(LEGAL, ' ').replace(/\s+/g, ' ').trim();
    if (bare.length >= 3) out.add(bare);
    for (const part of v.split(/\s[-|\u2013]\s/)) if (part.trim().length >= 4) out.add(part.trim());
  }
  return [...out].filter(v => v.length >= 3);
}

// --- numbers + currency --------------------------------------------------------------------------
/** Regex source for an integer amount printed with any thousands separator, optional zero decimals. */
export function amountSource(amount: number): string {
  const digits = String(Math.round(amount));
  const groups: string[] = [];
  for (let i = digits.length; i > 0; i -= 3) groups.unshift(digits.slice(Math.max(0, i - 3), i));
  const body = groups.length > 1 ? groups.join("[.,' ]?") : digits;
  return `(?<![\\d.,])${body}(?:[.,](?:00|-|\u2013)(?!\\d))?(?![\\d]|[.,]\\d)`;
}

const CURRENCY_TOKENS: Record<string, string[]> = {
  EUR: ['€', 'eur', 'euro', 'euros'], USD: ['$', 'usd', 'us$', 'dollars?'], AUD: ['\\$', 'aud', 'a\\$', 'au\\$'],
  NZD: ['\\$', 'nzd', 'nz\\$'], CAD: ['\\$', 'cad', 'c\\$'], CHF: ['chf', 'fr\\.', 'sfr'], GBP: ['£', 'gbp'],
  NOK: ['nok', 'kr\\.?', ',-'], SEK: ['sek', 'kr\\.?'], DKK: ['dkk', 'kr\\.?'], COP: ['cop', '\\$'], MXN: ['mxn', '\\$'],
  BRL: ['brl', 'r\\$'], JPY: ['jpy', '¥', '円'], PHP: ['php', '₱'], ZAR: ['zar', 'r'], MAD: ['mad', 'dh', 'dhs'],
  TND: ['tnd', 'dt'], VND: ['vnd', '₫'], THB: ['thb', '฿'], IDR: ['idr', 'rp'],
};
function currencySource(currency: string): string {
  const toks = CURRENCY_TOKENS[currency.toUpperCase()] ?? [esc(currency.toLowerCase())];
  return `(?:${toks.map(t => (t === '$' ? '\\$' : t)).join('|')})`;
}

/** Amount with its currency token right before or after it (a few characters apart at most). */
export function findPrice(page: EvidencePage, amount: number, currency: string | null): Hit | null {
  const a = amountSource(amount);
  if (!currency) return findPattern(page, new RegExp(a));
  const c = currencySource(currency);
  const b = '(?![\\p{L}])';
  return findPattern(page, new RegExp(`${c}${b}\\s{0,2}(?:from\\s|ab\\s|des\\s|desde\\s|a partir de\\s)?${a}|${a}\\s{0,2}(?:,-\\s?)?${c}${b}`, 'u'));
}

const NUMBER_WORDS: Record<string, string[]> = {
  1: ['one', 'a single'], 2: ['two', 'zwei', 'deux', 'dos', 'duas', 'dois', 'due', 'twee'], 3: ['three', 'drei', 'trois', 'tres', 'três', 'tre', 'drie'],
  4: ['four', 'vier', 'quatre', 'cuatro', 'quatro', 'quattro'], 5: ['five', 'fünf', 'cinq', 'cinco', 'cinque', 'vijf'],
  6: ['six', 'sechs', 'seis', 'sei', 'zes'], 7: ['seven', 'sieben', 'sept', 'siete', 'sete', 'sette', 'zeven'],
  8: ['eight', 'acht', 'huit', 'ocho', 'oito', 'otto'], 9: ['nine', 'neun', 'neuf', 'nueve', 'nove', 'negen'],
  10: ['ten', 'zehn', 'dix', 'diez', 'dez', 'dieci', 'tien'], 11: ['eleven', 'elf', 'onze', 'once', 'undici'],
  12: ['twelve', 'zwölf', 'douze', 'doce', 'dodici', 'twaalf'], 14: ['fourteen', 'vierzehn'], 21: ['twenty-one'],
};
/** Any appearance of a number on the page (digits with any grouping, or the number word). */
export function findNumber(page: EvidencePage, n: number): Hit | null {
  const words = NUMBER_WORDS[n]?.map(w => fold(w)) ?? [];
  const alts = [amountSource(n)];
  if (words.length) alts.push(`(?<![\\p{L}])(?:${words.map(esc).join('|')})(?![\\p{L}])`);
  // inside numeric dates: day "25.4.2026" / "24. - 31.10", month "7.2.", year "25.4.2026"
  if (n >= 1 && n <= 31) alts.push(`(?<![\\d.])0?${n}\\.(?=\\s?\\d)`, `(?<=\\d\\.)0?${n}(?=\\.|\\s|$)`);
  if (n >= 1900 && n <= 2100) alts.push(`(?<!\\d)${n}(?!\\d)`);
  const src = alts.join('|');
  return findPattern(page, new RegExp(src, 'u'));
}

/** Numbers stated in our own text (ignores digits inside words such as "4x4" ordinal suffixes kept). */
export function numbersIn(text: string): number[] {
  const out = new Set<number>();
  for (const m of text.matchAll(/(?<![\p{L}\d])(\d{1,3}(?:[,.' ]\d{3})+|\d+)(?:[.,]\d+)?/gu)) {
    const n = Number(m[1].replace(/[,.' ]/g, ''));
    if (Number.isFinite(n)) out.add(n);
  }
  return [...out];
}

// --- dates ---------------------------------------------------------------------------------------
const MONTHS: string[][] = [
  ['january', 'jan', 'januar', 'janvier', 'enero', 'janeiro', 'gennaio', 'januari', 'jänner', 'ene'],
  ['february', 'feb', 'februar', 'fevrier', 'février', 'febrero', 'fevereiro', 'febbraio', 'februari', 'fev'],
  ['march', 'mar', 'marz', 'märz', 'mars', 'marzo', 'marco', 'março', 'maart', 'mrz'],
  ['april', 'apr', 'avril', 'abril', 'aprile', 'abr', 'avr'],
  ['may', 'mai', 'mayo', 'maio', 'maggio', 'mei'],
  ['june', 'jun', 'juni', 'juin', 'junio', 'junho', 'giugno'],
  ['july', 'jul', 'juli', 'juillet', 'julio', 'julho', 'luglio', 'juil'],
  ['august', 'aug', 'aout', 'août', 'agosto', 'augustus', 'ago'],
  ['september', 'sep', 'sept', 'septembre', 'septiembre', 'setembro', 'settembre', 'set'],
  ['october', 'oct', 'oktober', 'octobre', 'octubre', 'outubro', 'ottobre', 'okt', 'out'],
  ['november', 'nov', 'novembre', 'noviembre', 'novembro'],
  ['december', 'dec', 'dezember', 'decembre', 'décembre', 'diciembre', 'dezembro', 'dicembre', 'dez', 'dic'],
];
const MONTH_WORDS = new Set(MONTHS.flat().map(m => fold(m)));
const monthSrc = (m: number): string => `(?:${MONTHS[m].map(x => esc(fold(x))).join('|')})\\.?`;
const dayNum = (d: number): string => `0?${d}(?:st|nd|rd|th|er|º|ª)?\\.?`;
const SEP = '\\s*(?:-|to|bis|au|al|a|till|until|\u2013)\\s*';

/** A departure as printed on the page: start and end day-month (year optional), ranges in the usual layouts. */
export function findDateRange(page: EvidencePage, startIso: string, endIso: string | null): Hit | null {
  const s = new Date(`${startIso}T00:00:00Z`);
  const e = endIso ? new Date(`${endIso}T00:00:00Z`) : null;
  const sd = s.getUTCDate(), sm = s.getUTCMonth(), sy = s.getUTCFullYear();
  const B = '(?<![\\d])', A = '(?![\\d])';
  const de = '(?:\\s*de)?\\s*';
  const numeric = (d: Date): string => {
    const dd = d.getUTCDate(), mm = d.getUTCMonth() + 1, yy = d.getUTCFullYear();
    return `(?:${B}0?${dd}[./]0?${mm}[./]?(?:${yy}|${String(yy).slice(2)})?${A}|${yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')})`;
  };
  const dm = (d: Date): string => `(?:${B}${dayNum(d.getUTCDate())}${de}${monthSrc(d.getUTCMonth())}|${monthSrc(d.getUTCMonth())}\\s*${dayNum(d.getUTCDate())}${A}|${numeric(d)})`;
  if (!e || e.getTime() === s.getTime()) return findPattern(page, new RegExp(dm(s), 'u'));
  const ed = e.getUTCDate(), em = e.getUTCMonth();
  const alts = [
    `${dm(s)}(?:\\s*,?\\s*${sy})?${SEP}${dm(e)}`, // 24 Oct - 3 Nov / 24.10. - 03.11.2026
  ];
  if (sm === em) {
    alts.push(`${B}${dayNum(sd)}${SEP}${dayNum(ed)}${de}${monthSrc(em)}`); // 12-19 April / 12. bis 19. April
    alts.push(`${monthSrc(sm)}\\s*${dayNum(sd)}${SEP}${dayNum(ed)}${A}`); // April 12-19
    alts.push(`${B}0?${sd}\\.?${SEP}0?${ed}[./]0?${sm + 1}(?:[./]|(?!\\d))`); // 12.-19.04. / 24. - 31.10
  } else {
    alts.push(`${B}${dayNum(sd)}${de}${monthSrc(sm)}${SEP}${dayNum(ed)}${de}${monthSrc(em)}`);
  }
  return findPattern(page, new RegExp(alts.map(x => `(?:${x})`).join('|'), 'u'));
}

// --- text reuse ------------------------------------------------------------------------------------
/** Longest prose run of consecutive words our text shares verbatim with the page (folded, punctuation ignored). */
export function longestSharedRun(ours: string, page: EvidencePage): { words: number; run: string } {
  const words = (s: string): string[] => fold(s).replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  const a = words(ours);
  const pageWords = words(`${page.zones.visible} ${page.zones.meta}`);
  const grams = new Set<string>();
  const K = 6;
  for (let i = 0; i + K <= pageWords.length; i++) grams.add(pageWords.slice(i, i + K).join(' '));
  const pageText = ` ${pageWords.join(' ')} `;
  let best = { words: 0, run: '' };
  for (let i = 0; i + K <= a.length; i++) {
    if (!grams.has(a.slice(i, i + K).join(' '))) continue;
    let j = i + K;
    while (j < a.length && pageText.includes(` ${a.slice(i, j + 1).join(' ')} `)) j++;
    // a shared list of dates/numbers is facts, not prose: only count runs that are mostly words
    const run = a.slice(i, j);
    const factual = run.filter(w => /^\d+$/.test(w) || MONTH_WORDS.has(w)).length;
    if (factual / run.length <= 0.4 && run.length > best.words) best = { words: run.length, run: run.join(' ') };
  }
  return best;
}
