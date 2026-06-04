import { topCruiseDestinations } from '../../../lib/cruise-destinations';

export const revalidate = 3600; // counts change rarely; cache for an hour

export async function GET() {
  const destinations = await topCruiseDestinations(8);
  return Response.json(destinations, {
    headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' },
  });
}
