import pLimit from 'p-limit';
import { supabase } from '../lib/supabase.js';
import { anthropic, EXTRACTION_MODEL } from '../lib/anthropic.js';
import { extract as tavilyExtract } from '../lib/tavily.js';
import { withRetry } from '../lib/retry.js';
import type { ProviderExtraction, TripType } from '../types.js';

const CONCURRENCY = 3;
const MAX_CONTENT_CHARS = 8000;

function rootDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

const EXTRACTION_PROMPT = `You are analyzing a web page to determine whether it belongs to a kite travel or kite rental provider.

A provider is a business that offers any of:
- Kite camps (multi-day kite travel packages with accommodation)
- Kite safaris
- Kite cruises
- Kite tours
- Kite schools / kite lessons
- Kite equipment rental / kite gear rental

NOT a provider: news articles, blog posts, review aggregators (TripAdvisor, Yelp), directories/marketplaces (unless they are the provider themselves), social media profiles, or Wikipedia pages.

Extract the following as strict JSON (no markdown, no prose):
{
  "isProvider": boolean,
  "name": string | null,
  "primaryCountry": string | null,
  "primaryRegion": string | null,
  "operatesIn": [{ "country": string, "region": string | null, "spotName": string | null }],
  "tripTypes": Array of: "camp" | "safari" | "cruise" | "tour" | "school" | "lessons" | "rental" | "equipment_rental",
  "contactEmail": string | null,
  "contactFormUrl": string | null,
  "languages": string[],
  "description": "One concise sentence describing the provider, or null",
  "notProviderReason": "Why this is not a provider, or null if it is one"
}`;

async function extractFromUrl(
  url: string,
  snippet: string | null,
): Promise<ProviderExtraction | null> {
  // Fetch full page content; fall back to snippet if extraction fails
  let content = await tavilyExtract(url);
  if (!content) content = snippet ?? '';
  if (!content.trim()) return null;

  const truncated = content.slice(0, MAX_CONTENT_CHARS);

  let text: string;
  try {
    const msg = await withRetry(() =>
      anthropic.messages.create({
        model: EXTRACTION_MODEL,
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: `${EXTRACTION_PROMPT}\n\nURL: ${url}\n\nPage content:\n${truncated}`,
          },
        ],
      }),
    );
    text = msg.content[0].type === 'text' ? msg.content[0].text : '';
  } catch (err) {
    console.error(`\n  Claude error for ${url}:`, err);
    return null;
  }

  // Strip accidental markdown fences
  const json = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  try {
    const parsed = JSON.parse(json) as Omit<ProviderExtraction, 'rootDomain'>;
    return { ...parsed, rootDomain: rootDomain(url) };
  } catch {
    console.error(`\n  JSON parse failed for ${url}:`, json.slice(0, 200));
    return null;
  }
}

export async function runExtract(batchSize = 30): Promise<{ processed: number; remaining: number }> {
  // Fetch unprocessed results
  const { data: results, error } = await supabase
    .from('raw_search_results')
    .select('id, url, snippet')
    .eq('processed', false)
    .is('error', null)
    .order('fetched_at')
    .limit(batchSize);

  if (error) throw error;
  if (!results || results.length === 0) return { processed: 0, remaining: 0 };

  // Load already-known domains to skip re-extraction
  const { data: existing } = await supabase.from('providers').select('root_domain');
  const knownDomains = new Set((existing ?? []).map(p => p.root_domain as string));

  // Immediately mark already-known domains as processed
  const alreadyKnown = results.filter(r => knownDomains.has(rootDomain(r.url)));
  if (alreadyKnown.length > 0) {
    await supabase
      .from('raw_search_results')
      .update({ processed: true, error: 'domain_already_known' })
      .in('id', alreadyKnown.map(r => r.id));
  }

  const toProcess = results.filter(r => !knownDomains.has(rootDomain(r.url)));
  console.log(
    `Extracting ${toProcess.length} new URLs (${alreadyKnown.length} already known)…`,
  );

  const limit = pLimit(CONCURRENCY);
  let done = 0;

  await Promise.all(
    toProcess.map(result =>
      limit(async () => {
        const domain = rootDomain(result.url);

        // Double-check: another concurrent extraction may have added this domain
        if (knownDomains.has(domain)) {
          await supabase
            .from('raw_search_results')
            .update({ processed: true, error: 'domain_already_known' })
            .eq('id', result.id);
          done++;
          return;
        }

        const extraction = await extractFromUrl(result.url, result.snippet ?? null);

        if (!extraction) {
          await supabase
            .from('raw_search_results')
            .update({ processed: true, error: 'extraction_failed' })
            .eq('id', result.id);
        } else if (!extraction.isProvider) {
          await supabase
            .from('raw_search_results')
            .update({
              processed: true,
              error: `not_provider: ${extraction.notProviderReason ?? 'unknown'}`,
            })
            .eq('id', result.id);
        } else {
          // Upsert provider (domain is the natural key)
          const { data: provider, error: upsertErr } = await supabase
            .from('providers')
            .upsert(
              {
                root_domain: extraction.rootDomain,
                name: extraction.name,
                website_url: result.url,
                primary_country: extraction.primaryCountry,
                primary_region: extraction.primaryRegion,
                contact_email: extraction.contactEmail,
                contact_form_url: extraction.contactFormUrl,
                languages: extraction.languages,
                trip_types: extraction.tripTypes as TripType[],
                description: extraction.description,
                discovery_source: 'tavily_search',
              },
              { onConflict: 'root_domain' },
            )
            .select('id')
            .single();

          if (upsertErr) {
            console.error(`\n  DB upsert error for ${domain}:`, upsertErr);
          } else if (provider) {
            knownDomains.add(domain);

            // Insert locations
            const locations = extraction.operatesIn.filter(l => l.country);
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

            await supabase
              .from('raw_search_results')
              .update({ processed: true, provider_id: provider.id })
              .eq('id', result.id);
          }
        }

        done++;
        process.stdout.write(`\r  ${done}/${toProcess.length} done`);
      }),
    ),
  );

  console.log();

  const { count: remaining } = await supabase
    .from('raw_search_results')
    .select('*', { count: 'exact', head: true })
    .eq('processed', false);

  return { processed: toProcess.length, remaining: remaining ?? 0 };
}
