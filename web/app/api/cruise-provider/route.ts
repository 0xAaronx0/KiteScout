import { matchCruiseLocations } from '../../../lib/match-cruise';

// Returns a single cruise provider's card (with all its cruise locations),
// used for deep-linking a specific provider from the cruise map.
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get('id');
  if (!id) {
    return Response.json({ error: 'id is required' }, { status: 400 });
  }

  const results = await matchCruiseLocations({ providerId: id, limit: 1 });
  if (!results.length) {
    return Response.json({ error: 'not found' }, { status: 404 });
  }

  return Response.json(results[0]);
}
