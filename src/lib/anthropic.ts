import Anthropic from '@anthropic-ai/sdk';
import 'dotenv/config';

export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Cheap fast model: pre-screening URLs (snippet only, no page fetch)
// and full structured extraction. Handles JSON extraction very reliably.
export const SCREENING_MODEL = 'claude-haiku-4-5-20251001' as const;

// Same cheap model for full structured extraction once a URL passes screening
export const EXTRACTION_MODEL = 'claude-haiku-4-5-20251001' as const;

// More capable model reserved for tasks needing nuanced reasoning (dedupe analysis)
export const ANALYSIS_MODEL = 'claude-sonnet-4-6' as const;
