import { topCruiseDestinations } from '../../../lib/cruise-destinations';

// Must be dynamic: the route queries Supabase at request time. Static
// prerendering at build would run it with no env vars (supabaseUrl is required).
export const dynamic = 'force-dynamic';

export async function GET() {
  const destinations = await topCruiseDestinations(8);
  return Response.json(destinations, {
    headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' },
  });
}
