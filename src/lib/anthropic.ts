import Anthropic from '@anthropic-ai/sdk';
import 'dotenv/config';

export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Model used for high-volume structured extraction
export const EXTRACTION_MODEL = 'claude-sonnet-4-6' as const;

// Model used for complex analysis tasks (dedupe reasoning, gap analysis)
export const ANALYSIS_MODEL = 'claude-opus-4-7' as const;
