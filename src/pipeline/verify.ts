import pLimit from 'p-limit';
import { supabase } from '../lib/supabase.js';
import { anthropic, EXTRACTION_MODEL } from '../lib/anthropic.js';
import { extract as tavilyExtract } from '../lib/tavily.js';
import { withRetry } from '../lib/retry.js';
import type { TripType } from '../types.js';

const CONCURRENCY = 3;
const MAX_CONTENT_CHARS = 14000;

const VERIFY_PROMPT = `You are re-verifying a business already in a kite travel database.

A VALID kite provider must offer AT LEAST ONE of these specifically:
- Kite camps (multi-day packages that include kitesurfing or kiteboarding)
- Kite safaris, kite cruises, kite tours
- Kite schools / kitesurfing or kiteboarding lessons
- Kite equipment rental (kites, bars, boards — for kitesurfing/kiteboarding)

Mark isKiteProvider = false if the business is ONLY:
- A surf camp with no kite offering (surfing, SUP, or windsurfing only)
- A boat charter with no kite-specific programme
- A general watersports / dive / snorkel / fishing operation with no kite services
- A hotel or guesthouse with no dedicated kite services
- A general travel agency not specialising in kite travel
- A news site, blog, directory, or aggregator

Extract as strict JSON (no markdown, no prose):
{
  "isKiteProvider": boolean,
  "notKiteReason": "short explanation if false, else null",
  "tripTypes": ["camp"|"safari"|"cruise"|"tour"|"school"|"lessons"|"rental"|"equipment_rental"],
  "contactEmail": "email address found on the page, or null",
  "contactFormUrl": "full URL of a contact form, or null",
  "whatsapp": "wa.me link or WhatsApp number, or null",
  "phone": "phone number, or null",
  "description": "one sentence: what kite services this provider offers, or null if not a kite provider",
  "primaryCountry": "country where primarily based, or null",
  "primaryRegion": "main city/region, or null"
}

Rules for contact info — search the full text carefully:
- Look for @ symbols anywhere in the text for email addresses.
- Look for wa.me links or any mention of WhatsApp followed by a number.
- Look for phone numbers in any format.`;

interface VerifyResult {
  isKiteProvider: boolean;
  notKiteReason: string | null;
  tripTypes?: TripType[];
  contactEmail?: string | null;
  contactFormUrl?: string | null;
  whatsapp?: string | null;
  phone?: string | null;
  description?: string | null;
  primaryCountry?: string | null;
  primaryRegion?: string | null;
}

export async function runVerify(batchSize = 20): Promise<{ processed: number; remaining: number; rejected: number }> {
  const { data: providers, error } = await supabase
    .from('providers')
    .select('id, name, website_url, root_domain, contact_email, contact_form_url, whatsapp, phone, description, trip_types, primary_country, primary_region, status')
    .not('status', 'in', '("dead","duplicate")')
    .not('website_url', 'is', null)
    .order('created_at')
    .limit(batchSize);

  if (error) throw error;
  if (!providers || providers.length === 0) return { processed: 0, remaining: 0, rejected: 0 };

  console.log(`Verifying ${providers.length} providers…`);

  const limit = pLimit(CONCURRENCY);
  let done = 0;
  let rejected = 0;

  await Promise.all(
    providers.map(provider =>
      limit(async () => {
        const url = provider.website_url as string;
        const domain = provider.root_domain as string;

        const [mainContent, contactContent] = await Promise.all([
          tavilyExtract(url),
          tavilyExtract(`https://${domain}/contact`),
        ]);

        let content = mainContent ?? '';
        if (contactContent) content += '\n\n--- Contact page ---\n\n' + contactContent;

        if (!content.trim()) {
          // Can't fetch — leave as-is, don't mark dead
          done++;
          process.stdout.write(`\r  ${done}/${providers.length} done (${rejected} rejected)`);
          return;
        }

        const truncated = content.slice(0, MAX_CONTENT_CHARS);

        let text: string;
        try {
          const msg = await withRetry(() =>
            anthropic.messages.create({
              model: EXTRACTION_MODEL,
              max_tokens: 512,
              messages: [{
                role: 'user',
                content: `${VERIFY_PROMPT}\n\nURL: ${url}\n\nPage content:\n${truncated}`,
              }],
            }),
          );
          text = msg.content[0].type === 'text' ? msg.content[0].text : '';
        } catch (err) {
          console.error(`\n  Claude error for ${url}:`, err);
          done++;
          return;
        }

        const json = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
        let parsed: VerifyResult;
        try {
          parsed = JSON.parse(json);
        } catch {
          console.error(`\n  JSON parse failed for ${url}:`, json.slice(0, 200));
          done++;
          return;
        }

        if (!parsed.isKiteProvider) {
          await supabase
            .from('providers')
            .update({ status: 'dead' })
            .eq('id', provider.id);
          rejected++;
        } else {
          // Only fill in fields that are currently empty — never overwrite existing data
          const updates: Record<string, unknown> = {};
          if (!provider.contact_email && parsed.contactEmail) updates.contact_email = parsed.contactEmail;
          if (!provider.contact_form_url && parsed.contactFormUrl) updates.contact_form_url = parsed.contactFormUrl;
          if (!provider.whatsapp && parsed.whatsapp) updates.whatsapp = parsed.whatsapp;
          if (!provider.phone && parsed.phone) updates.phone = parsed.phone;
          if (!provider.description && parsed.description) updates.description = parsed.description;
          if ((!provider.primary_country) && parsed.primaryCountry) updates.primary_country = parsed.primaryCountry;
          if ((!provider.primary_region) && parsed.primaryRegion) updates.primary_region = parsed.primaryRegion;
          const existingTypes = provider.trip_types as TripType[] | null;
          if ((!existingTypes || existingTypes.length === 0) && parsed.tripTypes?.length) {
            updates.trip_types = parsed.tripTypes;
          }

          if (Object.keys(updates).length > 0) {
            await supabase.from('providers').update(updates).eq('id', provider.id);
          }
        }

        done++;
        process.stdout.write(`\r  ${done}/${providers.length} done (${rejected} rejected)`);
      }),
    ),
  );

  console.log();

  const { count: remaining } = await supabase
    .from('providers')
    .select('*', { count: 'exact', head: true })
    .not('status', 'in', '("dead","duplicate")');

  return { processed: providers.length, remaining: remaining ?? 0, rejected };
}
