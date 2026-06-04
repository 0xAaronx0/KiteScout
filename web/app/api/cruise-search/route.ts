import { anthropic } from '@ai-sdk/anthropic';
import { generateObject } from 'ai';
import { z } from 'zod';
import { matchProviders } from '../../../lib/match';

export async function POST(req: Request) {
  const { destination } = await req.json() as { destination: string };

  if (!destination?.trim()) {
    return Response.json({ error: 'destination is required' }, { status: 400 });
  }

  const { object } = await generateObject({
    model: anthropic('claude-haiku-4-5-20251001'),
    schema: z.object({
      countries: z.array(z.string()).describe('Full country names, e.g. ["Philippines", "Indonesia"]'),
      regions: z.array(z.string()).describe('Specific regions, archipelagos, seas, or spots, e.g. ["Grenadines", "Palawan", "Red Sea"]'),
    }),
    prompt: `Extract country names and regions from this kite cruise destination query: "${destination}".
Countries = sovereign nation names. Regions = specific islands, archipelagos, seas, bays, or areas.
If the query is an ocean/sea (e.g. "Red Sea", "Caribbean") put it in regions, not countries.
Return empty arrays if nothing specific is found.`,
  });

  const providers = await matchProviders({
    countries: object.countries,
    regions: object.regions,
    tripTypes: ['cruise'],
    limit: 15,
  });

  return Response.json(providers);
}
