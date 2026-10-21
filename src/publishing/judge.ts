// ---------------------------------------------------------------------------
// LLM judge for the yes/no question "is this statement supported by this page?". It never supplies
// a value: values come from our row and are matched deterministically first (match.ts). Every "yes"
// must come with a verbatim quote from the page, and the caller re-finds that quote in the fetched
// text; a "yes" whose quote is not on the page counts as "no".
// ---------------------------------------------------------------------------
import { anthropic } from '../lib/anthropic.js';
import type { EvidencePage } from './evidence-page.js';

// Cheap pinned model (Aaron 2026-10-21: a full run must stay under USD 0.30). The judge only answers
// yes/no with a quote that we re-check, so a small model is enough; a pinned id keeps verifiedBy reproducible.
export const VERIFIER_MODEL = process.env.OPENROUTER_MODEL_VERIFIER || 'deepseek/deepseek-v4.1-flash';
/** Hard spend cap per geo-verify run, in USD (OpenRouter list price of VERIFIER_MODEL). */
export const VERIFIER_BUDGET_USD = Number(process.env.GEO_VERIFY_MAX_USD ?? '0.30');
const MAX_OUTPUT_TOKENS = 8000;

// --- spend guard -----------------------------------------------------------------------------------
export class BudgetExceeded extends Error {}
let price: { in: number; out: number } | null = null;
let spentUsd = 0;
export const verifierSpendUsd = (): number => spentUsd;
async function modelPrice(): Promise<{ in: number; out: number }> {
  if (price) return price;
  const res = await fetch('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(20000) });
  const { data } = await res.json() as { data: Array<{ id: string; pricing: { prompt: string; completion: string } }> };
  const m = data.find(x => x.id === VERIFIER_MODEL);
  if (!m) throw new Error(`verifier model ${VERIFIER_MODEL} not listed on OpenRouter: no price, refusing to run`);
  price = { in: Number(m.pricing.prompt), out: Number(m.pricing.completion) };
  return price;
}

export interface Verdict { supported: boolean; quote: string | null; note?: string }
export interface SentenceVerdict extends Verdict { index: number; unsupported?: string[] }
export interface JudgeResult {
  model: string;
  verdicts: Partial<Record<'title' | 'type' | 'location' | 'price', Verdict>>;
  sentences: SentenceVerdict[];
}
export interface JudgeQuestions {
  title?: string;
  type?: string;
  location?: string;
  price?: string;
  sentences?: string[];
}

const PAGE_CHARS = 45_000;

const SYSTEM = `You verify facts for a travel catalog against ONE web page of the operator.
You get the page text and statements written by the catalog (our own wording). For each statement decide
only: is it supported by THIS page? Rules:
- Supported means the page states it, or it follows directly from what the page states (e.g. a town the page
  names lies in the stated region/country; "7 nights" when the page says "8 days / 7 nights").
- Our wording may differ from the page; judge the facts, not the phrasing.
- Bookkeeping in our price notes ("as of <date>" = when we read the page, "cheapest bookable: <room>, <date>") is
  not a page fact; judge only the amount, currency, unit and basis.
- A statement with any fact the page does not support (a number, place, service, date, price basis) is NOT supported.
- For every supported statement give "quote": an exact, contiguous excerpt copied character for character from the
  page text (5 to 25 words) that carries the main evidence. Never paraphrase a quote. Use null when unsupported.
- Answer with JSON only, no prose.`;

export async function judge(page: EvidencePage, q: JudgeQuestions): Promise<JudgeResult> {
  const text = `${page.zones.meta}\n\n${page.zones.visible}`.slice(0, PAGE_CHARS)
    + (page.zones.jsonld ? `\n\n[structured data]\n${page.zones.jsonld.slice(0, 8000)}` : '');
  const items: string[] = [];
  if (q.title) items.push(`"title": the page offers a product that this name fairly describes: ${JSON.stringify(q.title)}`);
  if (q.type) items.push(`"type": ${q.type}`);
  if (q.location) items.push(`"location": the product takes place in ${JSON.stringify(q.location)}`);
  if (q.price) items.push(`"price": ${q.price}`);
  const sentences = q.sentences ?? [];
  const shape = `{${[
    ...(['title', 'type', 'location', 'price'] as const).filter(k => q[k]).map(k => `"${k}": {"supported": bool, "quote": string|null, "note": string}`),
    sentences.length ? `"sentences": [{"index": int, "supported": bool, "quote": string|null, "unsupported": [string]}]` : '',
  ].filter(Boolean).join(', ')}}`;
  const user = `PAGE (${page.url}):\n"""\n${text}\n"""\n\nSTATEMENTS:\n${items.join('\n')}${sentences.length
    ? `\n"sentences": judge each sentence of our description separately; list in "unsupported" each fact the page does not back:\n${sentences.map((s, i) => `${i}. ${s}`).join('\n')}`
    : ''}\n\nReturn JSON exactly in this shape: ${shape}`;

  // reserve the worst case (about 3 chars per token, full output) before calling; refuse past the cap
  const p = await modelPrice();
  const reserve = ((SYSTEM.length + user.length) / 3) * p.in + MAX_OUTPUT_TOKENS * p.out;
  if (spentUsd + reserve > VERIFIER_BUDGET_USD)
    throw new BudgetExceeded(`verifier budget USD ${VERIFIER_BUDGET_USD} reached (spent ${spentUsd.toFixed(4)})`);
  spentUsd += reserve;
  let res;
  try {
    res = await anthropic.messages.create({
      model: VERIFIER_MODEL, max_tokens: MAX_OUTPUT_TOKENS, system: SYSTEM,
      // no reasoning: on long pages the model otherwise spends the whole output budget thinking and never answers
      // (budget_tokens / reasoning.effort are ignored for it on OpenRouter). Safety comes from the re-checked quote.
      thinking: { type: 'disabled' },
      messages: [{ role: 'user', content: user }],
    });
  } catch (e) { spentUsd -= reserve; throw e; }
  // OpenRouter reports the charged cost; fall back to list price x tokens
  const cost = (res.usage as { cost?: number }).cost;
  spentUsd += (typeof cost === 'number' ? cost : res.usage.input_tokens * p.in + res.usage.output_tokens * p.out) - reserve;
  const raw = res.content.map(b => (b.type === 'text' ? b.text : '')).join('');
  const json = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(json) as Record<string, unknown>; } catch (e) {
    throw new Error(`judge answer is not JSON (stop_reason ${res.stop_reason}, ${res.usage.output_tokens} output tokens): ${(e as Error).message}`);
  }
  const verdict = (v: unknown): Verdict | undefined => {
    if (!v || typeof v !== 'object') return undefined;
    const o = v as Record<string, unknown>;
    return { supported: o.supported === true, quote: typeof o.quote === 'string' ? o.quote : null, note: typeof o.note === 'string' ? o.note : undefined };
  };
  return {
    model: res.model || VERIFIER_MODEL,
    verdicts: { title: verdict(parsed.title), type: verdict(parsed.type), location: verdict(parsed.location), price: verdict(parsed.price) },
    sentences: Array.isArray(parsed.sentences) ? parsed.sentences.flatMap(s => {
      const v = verdict(s);
      const o = s as Record<string, unknown>;
      return v && typeof o.index === 'number'
        ? [{ ...v, index: o.index, unsupported: Array.isArray(o.unsupported) ? o.unsupported.filter((x): x is string => typeof x === 'string') : [] }]
        : [];
    }) : [],
  };
}

/** Split our summary into sentences (no abbreviations in our templates besides "e.g." / "approx."). */
export function sentencesOf(text: string): string[] {
  return text.replace(/\b(e\.g|i\.e|approx|incl|ca|min|max|no|nr)\./gi, '$1․')
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"(])/).map(s => s.replace(/․/g, '.').trim()).filter(Boolean);
}
