import { supabase } from '../lib/supabase.js';
import { anthropic, ANALYSIS_MODEL } from '../lib/anthropic.js';

// Domain-level dedup is enforced by the UNIQUE constraint on providers.root_domain.
// This module handles the harder case: same business, different domains
// (e.g., kiteventure.com and kiteventure.de).

export async function runDedupe(): Promise<void> {
  const { data: providers, error } = await supabase
    .from('providers')
    .select('id, name, root_domain, primary_country')
    .eq('status', 'new')
    .not('name', 'is', null);

  if (error) throw error;
  if (!providers || providers.length === 0) {
    console.log('No providers to deduplicate.');
    return;
  }

  console.log(`Checking ${providers.length} providers for cross-domain duplicates…`);

  // Group by country to keep Claude context manageable
  const byCountry = new Map<string, typeof providers>();
  for (const p of providers) {
    const key = p.primary_country ?? '__unknown__';
    if (!byCountry.has(key)) byCountry.set(key, []);
    byCountry.get(key)!.push(p);
  }

  let totalDuplicates = 0;

  for (const [country, group] of byCountry) {
    if (group.length < 2) continue;

    const list = group
      .map(p => `ID:${p.id}  name:"${p.name}"  domain:${p.root_domain}`)
      .join('\n');

    let text: string;
    try {
      const msg = await anthropic.messages.create({
        model: ANALYSIS_MODEL,
        max_tokens: 512,
        messages: [
          {
            role: 'user',
            content: `The following kite travel providers are all based in ${country}.
Identify any that are clearly the same business under different domains or name variations.

${list}

Respond with ONLY a JSON array (no prose):
[{"keep": "<id to keep>", "markAsDuplicate": "<id to discard>"}]
or [] if no duplicates found.`,
          },
        ],
      });
      text = msg.content[0].type === 'text' ? msg.content[0].text : '[]';
    } catch (err) {
      console.error(`  Claude error for ${country}:`, err);
      continue;
    }

    const json = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    let pairs: Array<{ keep: string; markAsDuplicate: string }>;
    try {
      pairs = JSON.parse(json);
    } catch {
      continue;
    }

    for (const { keep, markAsDuplicate } of pairs) {
      await supabase
        .from('providers')
        .update({ status: 'duplicate', duplicate_of: keep })
        .eq('id', markAsDuplicate);
      totalDuplicates++;
    }
  }

  console.log(`Deduplication complete. Marked ${totalDuplicates} duplicate(s).`);
}
