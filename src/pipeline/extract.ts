import pLimit from 'p-limit';
import { supabase } from '../lib/supabase.js';
import { anthropic, SCREENING_MODEL, EXTRACTION_MODEL } from '../lib/anthropic.js';
import { extract as tavilyExtract } from '../lib/tavily.js';
import { withRetry } from '../lib/retry.js';
import type { ProviderExtraction, TripType } from '../types.js';
import { BLOCKED_DOMAINS } from '../config.js';

const CONCURRENCY = 3;
const MAX_CONTENT_CHARS = 12000;

function rootDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

// ---------------------------------------------------------------------------
// Stage 1: cheap pre-screen using snippet only (no page fetch)
// Returns true if the URL is worth a full extraction, false to discard.
// ---------------------------------------------------------------------------
async function preScreen(url: string, title: string | null, snippet: string | null): Promise<boolean> {
  // If we have no signal at all, attempt a full extract anyway
  if (!title && !snippet) return true;

  const msg = await withRetry(() =>
    anthropic.messages.create({
      model: SCREENING_MODEL,
      max_tokens: 16,
      messages: [
        {
          role: 'user',
          content: `Does this search result belong to a business that sells kite travel packages (camps, safaris, cruises, tours) or kite equipment rental / kite schools?
Answer only "yes" or "no".

URL: ${url}
Title: ${title ?? ''}
Snippet: ${snippet ?? ''}`,
        },
      ],
    }),
  );

  const answer = (msg.content[0].type === 'text' ? msg.content[0].text : '').toLowerCase().trim();
  return answer.startsWith('yes');
}

// ---------------------------------------------------------------------------
// Stage 2: full extraction using homepage + /contact page content
// ---------------------------------------------------------------------------
const EXTRACTION_PROMPT = `You are analyzing web page content to determine whether it belongs to a kite travel or kite rental provider.

A provider is a business that offers any of:
- Kite camps (multi-day kite travel packages with accommodation)
- Kite safaris
- Kite cruises
- Kite tours
- Kite schools / kite lessons
- Kite equipment rental / kite gear rental
- Snowkite camps, snowkite tours, snowkite lessons, or snowkite equipment rental

NOT a provider: news articles, blog posts, review aggregators, directories/marketplaces (unless they ARE the provider), social media profiles, weather sites, or encyclopaedia pages.

Extract the following as strict JSON (no markdown, no prose):
{
  "isProvider": boolean,
  "name": string | null,
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
  "notProviderReason": "Why this is not a provider, or null if it is one"
}

Rules for operatesIn:
- List EVERY country, region, and named spot where the provider offers services.
- A provider running camps in Egypt AND Morocco AND Brazil should have three entries.
- Include specific spot names (e.g. Dakhla, Cabarete, Mui Ne) wherever mentioned.

Rules for contact info:
- Search the full text carefully for email addresses (look for @ symbols).
- Look for WhatsApp links (wa.me/...) or any mention of WhatsApp with a number.
- Look for phone numbers in any format.`;

async function fullExtract(url: string, snippet: string | null): Promise<ProviderExtraction | null> {
  const domain = rootDomain(url);

  const [mainContent, contactContent] = await Promise.all([
    tavilyExtract(url),
    tavilyExtract(`https://${domain}/contact`),
  ]);

  let content = mainContent ?? snippet ?? '';
  if (contactContent) content += '\n\n--- Contact page ---\n\n' + contactContent;
  if (!content.trim()) return null;

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
    return null;
  }

  const json = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  try {
    const parsed = JSON.parse(json) as Omit<ProviderExtraction, 'rootDomain'>;
    return { ...parsed, rootDomain: domain };
  } catch {
    console.error(`\n  JSON parse failed for ${url}:`, json.slice(0, 200));
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------
export async function runExtract(batchSize = 30): Promise<{ processed: number; remaining: number }> {
  const { data: results, error } = await supabase
    .from('raw_search_results')
    .select('id, url, title, snippet')
    .eq('processed', false)
    .is('error', null)
    .order('fetched_at')
    .limit(batchSize);

  if (error) throw error;
  if (!results || results.length === 0) return { processed: 0, remaining: 0 };

  // Immediately discard blocked domains
  const blocked = results.filter(r => BLOCKED_DOMAINS.some(d => rootDomain(r.url).endsWith(d)));
  if (blocked.length > 0) {
    await supabase
      .from('raw_search_results')
      .update({ processed: true, error: 'blocked_domain' })
      .in('id', blocked.map(r => r.id));
  }

  // Load known domains to avoid re-processing
  const { data: existing } = await supabase.from('providers').select('root_domain');
  const knownDomains = new Set((existing ?? []).map(p => p.root_domain as string));

  const alreadyKnown = results.filter(r => knownDomains.has(rootDomain(r.url)));
  if (alreadyKnown.length > 0) {
    await supabase
      .from('raw_search_results')
      .update({ processed: true, error: 'domain_already_known' })
      .in('id', alreadyKnown.map(r => r.id));
  }

  const toProcess = results.filter(
    r =>
      !knownDomains.has(rootDomain(r.url)) &&
      !BLOCKED_DOMAINS.some(d => rootDomain(r.url).endsWith(d)),
  );

  console.log(`Processing ${toProcess.length} URLs (${alreadyKnown.length} already known)…`);

  const limit = pLimit(CONCURRENCY);
  let done = 0;
  let screened = 0;
  let extracted = 0;

  await Promise.all(
    toProcess.map(result =>
      limit(async () => {
        const domain = rootDomain(result.url);

        if (knownDomains.has(domain)) {
          await supabase
            .from('raw_search_results')
            .update({ processed: true, error: 'domain_already_known' })
            .eq('id', result.id);
          done++;
          return;
        }

        // ── Stage 1: pre-screen (snippet only, very cheap) ──────────────
        const isCandidate = await preScreen(result.url, result.title ?? null, result.snippet ?? null);
        screened++;

        if (!isCandidate) {
          await supabase
            .from('raw_search_results')
            .update({ processed: true, error: 'not_provider: pre-screen rejected' })
            .eq('id', result.id);
          done++;
          process.stdout.write(`\r  ${done}/${toProcess.length} done (${screened} screened, ${extracted} extracted)`);
          return;
        }

        // ── Stage 2: full extraction (page fetch + Haiku) ────────────────
        const extraction = await fullExtract(result.url, result.snippet ?? null);
        extracted++;

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
                whatsapp: extraction.whatsapp,
                phone: extraction.phone,
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
        process.stdout.write(`\r  ${done}/${toProcess.length} done (${screened} screened, ${extracted} full extracts)`);
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
