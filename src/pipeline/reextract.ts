import pLimit from 'p-limit';
import { supabase } from '../lib/supabase.js';
import { anthropic, EXTRACTION_MODEL } from '../lib/anthropic.js';
import { extract as tavilyExtract } from '../lib/tavily.js';
import { withRetry } from '../lib/retry.js';
import type { ProviderExtraction, TripType } from '../types.js';

const CONCURRENCY = 3;
const MAX_CONTENT_CHARS = 12000;

const EXTRACTION_PROMPT = `You are analyzing web page content for a kite travel provider.

Extract the following as strict JSON (no markdown, no prose):
{
  "primaryCountry": "The country where this provider is primarily based, or null",
  "primaryRegion": "The main city/region, or null",
  "operatesIn": [
    { "country": string, "region": string | null, "spotName": string | null }
  ],
  "tripTypes": ["camp" | "safari" | "cruise" | "tour" | "school" | "lessons" | "rental" | "equipment_rental" | "snowkite"],
  "contactEmail": "Any email address found on the page, or null",
  "contactFormUrl": "Full URL of a contact form if present, or null",
  "whatsapp": "WhatsApp number or wa.me link if found, or null",
  "phone": "Phone number if found, or null",
  "languages": ["ISO 639-1 codes of languages the site is available in"],
  "description": "One concise sentence describing what this provider offers",
  "name": string | null
}

Rules for operatesIn:
- List EVERY country, region, and named spot where the provider offers services.
- A provider running camps in Egypt AND Morocco AND Brazil should have three entries.
- Include specific spot names (e.g. Dakhla, Cabarete, Mui Ne) wherever mentioned.
- Do not limit to the primary location — capture all of them.

Rules for contact info:
- Search the full text carefully for email addresses (look for @ symbols).
- Look for WhatsApp links (wa.me/...) or any mention of WhatsApp with a number.
- Look for phone numbers in any format.`;

export async function runReextract(batchSize = 20): Promise<{ processed: number; remaining: number }> {
  // Find providers with no location rows at all
  const { data: providers, error } = await supabase
    .from('providers')
    .select('id, website_url, root_domain, name')
    .not('status', 'in', '("dead","duplicate")')
    .not('website_url', 'is', null)
    .limit(batchSize);

  if (error) throw error;
  if (!providers || providers.length === 0) return { processed: 0, remaining: 0 };

  // Filter to those with no location rows
  const { data: existingLocs } = await supabase
    .from('provider_locations')
    .select('provider_id')
    .in('provider_id', providers.map(p => p.id));

  const hasLocations = new Set((existingLocs ?? []).map(l => l.provider_id as string));
  const toReextract = providers.filter(p => !hasLocations.has(p.id));

  if (toReextract.length === 0) {
    console.log('All providers in this batch already have location data.');
    return { processed: 0, remaining: 0 };
  }

  console.log(`Re-extracting ${toReextract.length} providers missing location data…`);

  const limit = pLimit(CONCURRENCY);
  let done = 0;

  await Promise.all(
    toReextract.map(provider =>
      limit(async () => {
        const domain = provider.root_domain as string;
        const url = provider.website_url as string;

        const [mainContent, contactContent] = await Promise.all([
          tavilyExtract(url),
          tavilyExtract(`https://${domain}/contact`),
        ]);

        let content = mainContent ?? '';
        if (contactContent) content += '\n\n--- Contact page ---\n\n' + contactContent;
        if (!content.trim()) {
          done++;
          process.stdout.write(`\r  ${done}/${toReextract.length} done`);
          return;
        }

        const truncated = content.slice(0, MAX_CONTENT_CHARS);

        let text: string;
        try {
          const msg = await withRetry(() =>
            anthropic.messages.create({
              model: EXTRACTION_MODEL,
              max_tokens: 1024,
              system: [{ type: 'text', text: EXTRACTION_PROMPT, cache_control: { type: 'ephemeral' } }],
              messages: [{ role: 'user', content: `URL: ${url}\n\nPage content:\n${truncated}` }],
            }),
          );
          text = msg.content[0].type === 'text' ? msg.content[0].text : '';
        } catch (err) {
          console.error(`\n  Claude error for ${url}:`, err);
          done++;
          return;
        }

        const json = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

        let parsed: Partial<ProviderExtraction>;
        try {
          parsed = JSON.parse(json);
        } catch {
          console.error(`\n  JSON parse failed for ${url}:`, json.slice(0, 200));
          done++;
          return;
        }

        // Update provider fields that may now be richer
        await supabase
          .from('providers')
          .update({
            primary_country: parsed.primaryCountry ?? undefined,
            primary_region: parsed.primaryRegion ?? undefined,
            contact_email: parsed.contactEmail ?? undefined,
            contact_form_url: parsed.contactFormUrl ?? undefined,
            whatsapp: parsed.whatsapp ?? undefined,
            phone: parsed.phone ?? undefined,
            languages: parsed.languages ?? undefined,
            trip_types: (parsed.tripTypes ?? undefined) as TripType[] | undefined,
            description: parsed.description ?? undefined,
            ...(parsed.name && !provider.name ? { name: parsed.name } : {}),
          })
          .eq('id', provider.id);

        // Insert fresh location rows
        const locations = (parsed.operatesIn ?? []).filter(l => l.country);
        if (locations.length > 0) {
          await supabase.from('provider_locations').insert(
            locations.map(l => ({
              provider_id: provider.id,
              country: l.country,
              region: l.region ?? null,
              spot_name: l.spotName ?? null,
            })),
          );
        }

        done++;
        process.stdout.write(`\r  ${done}/${toReextract.length} done`);
      }),
    ),
  );

  console.log();

  // Count remaining providers still missing locations
  const { count: totalProviders } = await supabase
    .from('providers')
    .select('*', { count: 'exact', head: true })
    .not('status', 'in', '("dead","duplicate")');

  const { count: withLocs } = await supabase
    .from('provider_locations')
    .select('provider_id', { count: 'exact', head: true });

  const remaining = Math.max(0, (totalProviders ?? 0) - (withLocs ?? 0));
  return { processed: toReextract.length, remaining };
}
