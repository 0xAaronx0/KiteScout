// ---------------------------------------------------------------------------
// AI verifier for one camp: re-fetch the operator's own page now, check each of the seven gate values
// against it, and record the evidence. Deterministic matching decides every value match (names,
// numbers + currency, dates); the LLM judge only answers "is this statement supported by the page"
// with a quote we re-find in the fetched text. A field that does not pass is not claimed.
// ---------------------------------------------------------------------------
import { appFacts, isPublicUrl, rowDigest, type CardRow, type Field } from './catalog-values.js';
import { fetchEvidencePage, type EvidencePage, type FailedPage } from './evidence-page.js';
import { judge, sentencesOf, type JudgeResult, type Verdict } from './judge.js';
import {
  findDateRange, findNumber, findPattern, findPhrase, findPrice, findQuote, fold, longestSharedRun, nameVariants, numbersIn,
  type Hit,
} from './match.js';

/** Our text shares this many consecutive words with the operator page: treat it as copied, not ours. */
export const COPY_RUN_WORDS = 12;

export interface FieldCheck {
  claimed: boolean;
  reason: string;
  sourceUrl: string | null;
  observedAt: string | null;
  deterministic: Array<{ check: string; hit: Hit | null }>;
  llm?: Verdict & { quoteHit: Hit | null };
}
export interface PageRecord { url: string; fetchedAt: string; ok: boolean; htmlSha256?: string; textSha256?: string; textChars?: number; error?: string }
export interface OfferVerification {
  offerId: string;
  /** the verified app_package_cards columns (public catalog data) */
  row: CardRow;
  rowDigest: string;
  values: Partial<Record<Field, unknown>>;
  pages: PageRecord[];
  complete: boolean;
  incompleteReason: string | null;
  fields: Record<Field, FieldCheck>;
  textReuse: { words: number; run: string } | null;
  verifiedAt: string;
  model: string | null;
}

const pageRecord = (p: EvidencePage | FailedPage): PageRecord => p.ok
  ? { url: p.url, fetchedAt: p.fetchedAt, ok: true, htmlSha256: p.htmlSha256, textSha256: p.textSha256, textChars: p.zones.visible.length }
  : { url: p.url, fetchedAt: p.fetchedAt, ok: false, error: `${p.kind}: ${p.error}` };

const TWO_LEVEL_SUFFIX = /\.(?:com|co|net|org|gov|edu|ac)\.[a-z]{2}$/;
export function registrableDomain(host: string): string {
  const h = host.toLowerCase().replace(/^www\./, '');
  const labels = h.split('.');
  return labels.slice(TWO_LEVEL_SUFFIX.test(h) ? -3 : -2).join('.');
}

const COUNTRY_NAMES: Record<string, string[]> = {
  Brazil: ['Brasil', 'Brasilien', 'Brésil'], Greece: ['Griechenland', 'Grèce', 'Grecia', 'Hellas', 'Griekenland'],
  Cyprus: ['Zypern', 'Chypre', 'Chipre'], Egypt: ['Ägypten', 'Egypte', 'Égypte', 'Egipto', 'Egitto'], Italy: ['Italien', 'Italia', 'Italie'],
  Morocco: ['Marokko', 'Maroc', 'Marruecos', 'Marocco'], Australia: ['Australien', 'Australie'], Philippines: ['Philippinen', 'Filipinas'],
  Denmark: ['Dänemark', 'Danemark', 'Dinamarca', 'Danmark', 'Denemarken'], Norway: ['Norwegen', 'Norvège', 'Noruega', 'Norge', 'Noorwegen'],
  Spain: ['Spanien', 'Espagne', 'España', 'Spanje'], Mexico: ['México', 'Mexiko', 'Mexique'], Germany: ['Deutschland', 'Allemagne', 'Alemania', 'Duitsland'],
  Indonesia: ['Indonesien', 'Indonésie'], Fiji: ['Fidschi', 'Fidji'], 'New Zealand': ['Neuseeland', 'Aotearoa', 'NZ'],
  'United States': ['USA', 'U.S.', 'United States of America'], Colombia: ['Kolumbien', 'Colombie'],
  'Cape Verde': ['Kap Verde', 'Cabo Verde', 'Cap-Vert', 'Kaapverdië'], Sweden: ['Schweden', 'Sverige', 'Suède'],
  'South Africa': ['Südafrika', 'Afrique du Sud', 'Sudáfrica'], Tunisia: ['Tunesien', 'Tunisie', 'Túnez', 'Tunesië'],
  France: ['Frankreich', 'Francia'], Kenya: ['Kenia'], Switzerland: ['Schweiz', 'Suisse', 'Svizzera', 'Zwitserland'],
  Finland: ['Finnland', 'Suomi', 'Finlande'], Japan: ['日本', 'Japon', 'Japón'], Vietnam: ['Viet Nam', 'Việt Nam'],
  Mauritius: ['Maurice', 'Île Maurice'], Portugal: [], Montenegro: ['Crna Gora'], Venezuela: [], 'Cook Islands': [],
};

const PRICE_UNIT_TEXT: Record<string, string> = { package: 'a package price', per_night: 'a price per night', per_day: 'a price per day', other: 'a price' };

export async function verifyOffer(row: CardRow, now: Date): Promise<OfferVerification> {
  const offerId = String(row.offer_id);
  const facts = appFacts(row, now);
  const v = facts.values;
  const fields = {} as Record<Field, FieldCheck>;
  const blank = (reason: string): FieldCheck => ({ claimed: false, reason, sourceUrl: null, observedAt: null, deterministic: [] });
  for (const f of ['title', 'description', 'type', 'operator', 'location', 'price', 'departures'] as Field[])
    fields[f] = blank(facts.invalid[f] ?? 'not checked');

  const sourceUrl = typeof row.source_url === 'string' ? row.source_url.trim() : '';
  const pages: Array<EvidencePage | FailedPage> = [];
  const base = { offerId, row, rowDigest: rowDigest(row), values: v, fields, textReuse: null, model: null };
  if (!sourceUrl) {
    return { ...base, pages: [], complete: false, incompleteReason: 'offer has no source_url', verifiedAt: new Date().toISOString() };
  }
  // a #fragment is client-side only: fetch and cite the document itself (a query string is a different resource)
  const src = await fetchEvidencePage(sourceUrl.replace(/#.*$/, ''));
  pages.push(src);
  if (!src.ok) {
    for (const f of Object.keys(fields) as Field[]) if (v[f] !== undefined) fields[f] = blank(`source page not readable (${src.kind}): ${src.error}`);
    return { ...base, pages: pages.map(pageRecord), complete: false, incompleteReason: `source page not readable (${src.kind})`, verifiedAt: new Date().toISOString() };
  }
  const citeable = isPublicUrl(src.url);
  const cite = (check: FieldCheck, page: EvidencePage): FieldCheck => ({ ...check, sourceUrl: page.url, observedAt: page.fetchedAt });

  // --- operator: name printed on the operator's own page, and the offer page belongs to that operator ---
  const op = v.operator as { id: string; name: string; website: string } | undefined;
  if (op) {
    const variants = nameVariants(op.name);
    const onSource = variants.map(n => findPhrase(src, n)).find(Boolean) ?? null;
    const sameSite = registrableDomain(new URL(op.website).hostname) === registrableDomain(new URL(src.url).hostname);
    const checks: FieldCheck['deterministic'] = [
      { check: `name "${op.name}" on offer page`, hit: onSource },
      { check: `offer page on operator domain ${registrableDomain(new URL(op.website).hostname)}`, hit: sameSite ? { zone: 'meta', offset: 0, matched: new URL(sourceUrl).hostname, excerpt: sourceUrl } : null },
    ];
    let ok = Boolean(onSource && sameSite);
    let used: EvidencePage = src;
    if (!ok && op.website !== sourceUrl) {
      const site = await fetchEvidencePage(op.website);
      pages.push(site);
      if (site.ok) {
        const onSite = variants.map(n => findPhrase(site, n)).find(Boolean) ?? null;
        const offerDomain = registrableDomain(new URL(sourceUrl).hostname);
        const linksOffer = site.linkHosts.some(h => registrableDomain(h) === offerDomain);
        checks.push({ check: `operator website links to ${offerDomain}`, hit: linksOffer ? { zone: 'meta', offset: 0, matched: offerDomain, excerpt: op.website } : null });
        checks.push({ check: `name "${op.name}" on operator website`, hit: onSite });
        if (onSite && (sameSite || linksOffer)) { ok = true; used = site; }
      }
    }
    fields.operator = ok && isPublicUrl(used.url)
      ? cite({ claimed: true, reason: 'operator name printed on the operator\'s own site; offer page is on that site', sourceUrl: null, observedAt: null, deterministic: checks }, used)
      : { ...blank(!onSource ? 'operator name not found on the offer page or operator website' : 'offer page is not on the operator website domain'), deterministic: checks };
  }

  // --- deterministic pre-checks for the judged fields ---
  const title = v.title as string | undefined;
  const titleHit = title ? findPhrase(src, title) : null;
  const loc = v.location as { country: string; destination: string | null } | undefined;
  const countryHit = loc ? [loc.country, ...(COUNTRY_NAMES[loc.country] ?? [])].map(n => findPhrase(src, n)).find(Boolean) ?? null : null;
  const region = typeof row.region === 'string' ? row.region : null;
  const regionHit = region ? region.split(/[,()/]/).map(s => s.trim()).filter(s => s.length >= 4).map(s => findPhrase(src, s)).find(Boolean) ?? null : null;
  const typeHit = findPattern(src, /(?<![\p{L}])(?:kite\s?camps?|camps?|kamp|stage|kite\s?weeks?|retreat|surfari|safari|campamento|acampamento|sejour|kiteurlaub|kitereise|kite\s?trip|kite\s?holiday|package|pakket|pacote|paquete|wochenende|semaine|week)(?![\p{L}])/u);
  const price = v.price as { amount: number; currency: string | null; unit: string | null; basisNote: string | null } | undefined;
  const priceHit = price ? findPrice(src, price.amount, price.currency) : null;
  const summary = v.description as string | undefined;
  const numberChecks = summary ? numbersIn(summary).map(n => ({ check: `number ${n} on page`, hit: findNumber(src, n) })) : [];
  const sentences = summary ? sentencesOf(summary) : [];

  // --- LLM judge (one call for the offer) ---
  let judged: JudgeResult | null = null;
  let judgeError: string | null = null;
  try {
    judged = await judge(src, {
      title,
      type: v.type ? 'the product is a kite camp: a multi-day package (several days or a week or more) that combines kite instruction, coaching or guided kite sessions with accommodation or a fixed camp programme, not a single lesson, a pure accommodation listing or a gear shop' : undefined,
      location: loc ? (loc.destination ?? loc.country) : undefined,
      price: price ? `the page states a price of ${price.amount} ${price.currency ?? ''} for this product as ${PRICE_UNIT_TEXT[price.unit ?? 'other']}${price.basisNote ? `, matching this basis note: ${JSON.stringify(price.basisNote)}` : ''}` : undefined,
      sentences,
    });
  } catch (e) {
    judgeError = (e as Error).message;
  }
  const verifiedAt = new Date().toISOString();
  const llm = (key: 'title' | 'type' | 'location' | 'price'): FieldCheck['llm'] | undefined => {
    const verdict = judged?.verdicts[key];
    if (!verdict) return undefined;
    return { ...verdict, quoteHit: verdict.quote ? findQuote(src, verdict.quote) : null };
  };
  const judgedOk = (l: FieldCheck['llm'] | undefined): boolean => Boolean(l?.supported && l.quoteHit);
  const why = (l: FieldCheck['llm'] | undefined): string => judgeError ? `judge failed: ${judgeError}`
    : !l ? 'judge gave no verdict' : !l.supported ? `judge: not supported${l.note ? ` (${l.note})` : ''}` : 'judge quote not found on the page';
  const decide = (field: Field, ok: boolean, okReason: string, failReason: string, deterministic: FieldCheck['deterministic'], l?: FieldCheck['llm']): void => {
    if (v[field] === undefined) return;
    const pass = ok && citeable;
    fields[field] = {
      ...(pass ? cite(blank(''), src) : blank('')),
      claimed: pass, reason: pass ? okReason : !citeable ? `offer page URL cannot be cited (gate needs https without query): ${src.url}` : failReason,
      deterministic, llm: l,
    };
  };

  const tl = titleHit ? undefined : llm('title');
  decide('title', Boolean(titleHit) || judgedOk(tl), titleHit ? 'title printed on the page' : 'judge: page offers a product this title names (quote found)',
    why(tl), [{ check: 'title phrase on page', hit: titleHit }], tl);

  const ty = llm('type');
  decide('type', Boolean(typeHit) && judgedOk(ty), 'camp keyword on page and judge confirms a multi-day camp package',
    !typeHit ? 'no camp/package keyword on the page' : why(ty), [{ check: 'camp/package keyword', hit: typeHit }], ty);

  const lo = llm('location');
  decide('location', Boolean(countryHit || regionHit) && judgedOk(lo), 'place name on page and judge confirms the destination',
    !(countryHit || regionHit) ? 'neither country nor region named on the page' : why(lo),
    [{ check: 'country on page', hit: countryHit }, { check: 'region on page', hit: regionHit }], lo);

  const pr = llm('price');
  decide('price', Boolean(priceHit) && judgedOk(pr), 'amount with currency printed on the page and judge confirms the basis',
    !priceHit ? `amount ${price?.amount} ${price?.currency ?? ''} not printed on the page` : why(pr),
    [{ check: 'amount + currency on page', hit: priceHit }], pr);

  // departures: deterministic only, every listed departure must be on the page
  if (v.departures !== undefined) {
    const checks = facts.departures.map(d => ({ check: `departure ${d.startDate}..${d.endDate ?? d.startDate}`, hit: findDateRange(src, d.startDate, d.endDate) }));
    const missing = checks.filter(c => !c.hit).length;
    // KCS labels every slot as exact days; a season/month slot would publish false precision
    const coarse = facts.departures.filter(d => d.precision !== 'day');
    decide('departures', missing === 0 && coarse.length === 0, `all ${checks.length} departures printed on the page`,
      coarse.length ? `${coarse.length} slot(s) with date_precision ${[...new Set(coarse.map(d => d.precision))].join('/')}: the app would show an exact-day label` : `${missing} of ${checks.length} departures not found on the page`, checks);
  }

  // description: every number on the page, every sentence supported with a quote that is on the page
  if (summary !== undefined) {
    const badNumbers = numberChecks.filter(c => !c.hit);
    const sentenceChecks = sentences.map((s, i) => {
      const sv = judged?.sentences.find(x => x.index === i);
      const quoteHit = sv?.quote ? findQuote(src, sv.quote) : null;
      return { s, ok: Boolean(sv?.supported && quoteHit), sv, quoteHit };
    });
    const bad = sentenceChecks.filter(c => !c.ok);
    const failReason = judgeError ? `judge failed: ${judgeError}`
      : badNumbers.length ? `numbers not on the page: ${badNumbers.map(c => c.check.replace(/^number | on page$/g, '')).join(', ')}`
        : `${bad.length} of ${sentences.length} sentences not supported: ${bad.map(c => `#${sentences.indexOf(c.s)}${c.sv?.supported && !c.quoteHit ? ' (quote not found)' : c.sv?.unsupported?.length ? ` (${c.sv.unsupported.join('; ')})` : ''}`).join(', ')}`;
    decide('description', !judgeError && badNumbers.length === 0 && bad.length === 0,
      `all ${numberChecks.length} numbers on the page; all ${sentences.length} sentences supported with on-page quotes`, failReason,
      [...numberChecks, ...sentenceChecks.map((c, i) => ({ check: `sentence #${i} quote`, hit: c.quoteHit }))],
      { supported: bad.length === 0, quote: null, note: sentenceChecks.map((c, i) => `#${i}:${c.ok ? 'ok' : 'no'}`).join(' '), quoteHit: null });
  }

  return {
    ...base, pages: pages.map(pageRecord), complete: !judgeError, incompleteReason: judgeError ? `judge failed: ${judgeError}` : null,
    fields, textReuse: summary ? longestSharedRun(summary, src) : null, verifiedAt, model: judged?.model ?? null,
  };
}
