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

// Cheap fast model: pre-screening URLs (snippet only, no page fetch)
export const SCREENING_MODEL = model('SCREENING', 'anthropic/claude-haiku-4.5');

// Same cheap model for full structured extraction once a URL passes screening
export const EXTRACTION_MODEL = model('EXTRACTION', 'anthropic/claude-haiku-4.5');

// More capable model for tasks needing nuanced reasoning (dedupe, monitoring diffs, vision QC)
export const ANALYSIS_MODEL = model('ANALYSIS', 'anthropic/claude-sonnet-4.6');

// Cabin-type extraction from cruise texts (cruise-rooms)
export const CABIN_MODEL = model('CABIN', 'anthropic/claude-opus-5.5');
