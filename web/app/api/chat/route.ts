import { anthropic } from '@ai-sdk/anthropic';
import { streamText, tool } from 'ai';
import { z } from 'zod';
import { matchProviders } from '../../../lib/match';

const SYSTEM = `You are KiteScout, an AI travel assistant specialising in kitesurfing and kiteboarding trips worldwide.

Your job: help users find the perfect kite travel provider from our curated database — kite camps, cruises, liveaboards, schools, lessons, equipment rental, and snowkite operations.

Workflow:
1. When the user describes what they're looking for, immediately call searchProviders with the right parameters. Do not ask clarifying questions first — search with reasonable assumptions and refine if needed.
2. After the tool returns results, write ONE short sentence only (e.g. "Here are the best matches for kite camps in Morocco — swipe to explore!"). Do NOT list providers, names, descriptions, or contact details in text — the cards display all of that.
3. If the search returns nothing, say so honestly and suggest they broaden their criteria.

Tone: warm, knowledgeable, concise — like a well-travelled kite friend helping another friend.`;

const tripTypeEnum = z.enum(['camp', 'safari', 'cruise', 'tour', 'school', 'lessons', 'rental', 'equipment_rental', 'snowkite']);

export async function POST(req: Request) {
  const { messages } = await req.json();

  const result = streamText({
    model: anthropic('claude-sonnet-4-6'),
    system: SYSTEM,
    messages,
    maxSteps: 5,
    tools: {
      searchProviders: tool({
        description: 'Search the KiteScout provider database. Call this whenever the user is looking for kite travel options.',
        parameters: z.object({
          countries: z.array(z.string()).optional().describe('Country names to filter by, e.g. ["Morocco", "Egypt"]. Omit for worldwide.'),
          regions: z.array(z.string()).optional().describe('Specific regions or spots, e.g. ["Dakhla", "Tarifa"]. Omit if not specified.'),
          tripTypes: z.array(tripTypeEnum).optional().describe('Types of kite services. Omit to return all types.'),
          limit: z.number().int().min(1).max(20).optional().describe('Max results to return. Default 12.'),
        }),
        execute: async (params) => matchProviders(params),
      }),
    },
  });

  return result.toDataStreamResponse();
}
