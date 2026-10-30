import Anthropic from '@anthropic-ai/sdk';
import 'dotenv/config';

// ---------------------------------------------------------------------------
// All pipeline LLM calls go through OpenRouter (Aaron, 2026-09-30): one key, one
// credit balance, models switchable in one place. OpenRouter accepts the Anthropic
// Messages format (base URL https://openrouter.ai/api, key as Bearer token), so the
// SDK and every call site stay as they are.
//
// Model per role: env OPENROUTER_MODEL_<ROLE> overrides the default below. Point it
// at an OpenRouter preset ("@preset/kitescout-analysis") to switch models in the
// OpenRouter dashboard without a code change or deploy.
//
// Budget (Aaron 2026-10-30): ideally <= USD 5 per month for all of KiteScout, at most 10.
// Simple tasks run on DeepSeek; Sonnet only for the few complex ones (COMPLEX_MODEL). The
// judgement calls of the QS inbox are made in Claude Code, not here. Once the key's
// spend this month reaches OPENROUTER_BUDGET_SOFT_USD (5), every call is downgraded to
// the cheap model (OPENROUTER_ALLOW_OVER_BUDGET=1 lifts it for one run). Nothing is
// blocked: the monitor stores a page's new hash before it reads it, so a refused read
// would lose that change for good, and a cheap read costs a fraction of a cent.
// ---------------------------------------------------------------------------
if (!process.env.OPENROUTER_API_KEY) {
  console.warn('⚠ OPENROUTER_API_KEY is not set: LLM calls will fail');
}

export const anthropic = new Anthropic({
  baseURL: 'https://openrouter.ai/api',
  apiKey: null, // never send an Anthropic key (x-api-key) to OpenRouter
  authToken: process.env.OPENROUTER_API_KEY ?? null,
  defaultHeaders: {
    'X-Title': process.env.OPENROUTER_APP_TITLE || 'kitescout',
    ...(process.env.OPENROUTER_APP_URL ? { 'HTTP-Referer': process.env.OPENROUTER_APP_URL } : {}),
  },
});

const model = (role: string, fallback: string): string => process.env[`OPENROUTER_MODEL_${role}`] || fallback;

// Cheap model for everything simple: reading, extracting, classifying (USD 0.045 / 0.50 per M
// tokens in/out on 2026-10-30, image input supported; Sonnet 4.6 is 3 / 15).
export const CHEAP_MODEL = model('CHEAP', 'deepseek/deepseek-v4.1-flash');

// Capable model, only where a wrong answer is expensive to undo: full offer extraction, dedupe.
export const COMPLEX_MODEL = model('COMPLEX', 'anthropic/claude-sonnet-4.6');

// Pre-screening URLs (snippet only, no page fetch)
export const SCREENING_MODEL = model('SCREENING', CHEAP_MODEL);

// Structured extraction once a URL passes screening; also the monitor's page reads
export const EXTRACTION_MODEL = model('EXTRACTION', CHEAP_MODEL);

// Reviews matching, spot/region texts, seasons, locations, vision QC of images
export const ANALYSIS_MODEL = model('ANALYSIS', CHEAP_MODEL);

// Cabin-type extraction from cruise texts (cruise-rooms); was Opus until 2026-10-30
export const CABIN_MODEL = model('CABIN', COMPLEX_MODEL);

// --- budget guard ----------------------------------------------------------------------------

const SOFT_USD = Number(process.env.OPENROUTER_BUDGET_SOFT_USD ?? 5);
const RECHECK_MS = 10 * 60_000;
let spend: { at: number; usd: number | null } | null = null;
let warned = false;

/** This calendar month's spend on the key (OpenRouter /api/v1/key), cached 10 min; null when unknown. */
export async function monthlySpendUsd(): Promise<number | null> {
  if (spend && Date.now() - spend.at < RECHECK_MS) return spend.usd;
  let usd: number | null = null;
  try {
    const r = await fetch('https://openrouter.ai/api/v1/key', {
      headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY ?? ''}` },
      signal: AbortSignal.timeout(10_000),
    });
    const j = await r.json() as { data?: { usage_monthly?: number } };
    usd = typeof j.data?.usage_monthly === 'number' ? j.data.usage_monthly : null;
  } catch { /* unknown spend: no downgrade */ }
  spend = { at: Date.now(), usd };
  return usd;
}

const rawCreate = anthropic.messages.create.bind(anthropic.messages);
anthropic.messages.create = (async (body: Anthropic.MessageCreateParams, options?: Anthropic.RequestOptions) => {
  if (body.model !== CHEAP_MODEL && !process.env.OPENROUTER_ALLOW_OVER_BUDGET) {
    const usd = await monthlySpendUsd();
    if (usd !== null && usd >= SOFT_USD) {
      if (!warned) console.warn(`⚠ OpenRouter spend this month USD ${usd.toFixed(2)} >= ${SOFT_USD}: ${body.model} downgraded to ${CHEAP_MODEL}`);
      warned = true;
      body = { ...body, model: CHEAP_MODEL };
    }
  }
  const msg = await rawCreate(body as Anthropic.MessageCreateParamsNonStreaming, options);
  // DeepSeek answers with a thinking block first; every call site reads content[0] as the text.
  msg.content = msg.content.filter(b => b.type !== 'thinking' && b.type !== 'redacted_thinking');
  return msg;
}) as typeof anthropic.messages.create;
