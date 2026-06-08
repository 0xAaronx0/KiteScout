import { anthropic } from '@ai-sdk/anthropic';
import { generateObject } from 'ai';
import { z } from 'zod';
import { matchCruiseLocations } from '../../../lib/match-cruise';

export async function POST(req: Request) {
  const { destination, country } = await req.json() as { destination?: string; country?: string };

  // Country chip: deterministic exact-country match, no AI expansion and no cap,
  // so the number of cards equals the count shown on the start page.
  if (country?.trim()) {
    const providers = await matchCruiseLocations({ countries: [country.trim()] });
    return Response.json(providers);
  }

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

  // Free-text search: AI-parsed countries + regions, also uncapped.
  const providers = await matchCruiseLocations({
    countries: object.countries,
    regions: object.regions,
  });

  return Response.json(providers);
}
