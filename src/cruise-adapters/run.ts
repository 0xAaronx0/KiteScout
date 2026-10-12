// Adapter phase of the daily monitor: run every cruise adapter and feed its states into
// the observation state machine (src/pipeline/observe.ts). A blocked host or a parser
// error never stops the other adapters.
import { supabase } from '../lib/supabase.js';
import { BlockedByHost, RobotsDisallowed } from '../offers/http.js';
import { observeAdapterStates, type ObserveCtx, type ProviderRef } from '../pipeline/observe.js';
import { CRUISE_ADAPTERS } from './registry.js';
import type { CruiseAdapter, CruiseAdapterItem } from './types.js';

export async function runCruiseAdapters(ctx: ObserveCtx, only?: string): Promise<{ ok: number; failed: string[] }> {
  const adapters = CRUISE_ADAPTERS.filter(a => !only || a.key === only || a.domain === only);
  console.log(`\nAdapter phase: ${adapters.map(a => a.key).join(', ')}`);
  let ok = 0;
  const failed: string[] = [];
  for (const a of adapters) {
    try {
      const provider = await providerFor(a);
      if (!provider) { failed.push(`${a.key}: provider ${a.domain} missing or hidden`); continue; }
      const items = await a.fetchStates();
      const { matched, unmatched } = await observeAdapterStates(provider, `adapter:${a.key}`, items, ctx, a.datesMode);
      console.log(`  ${a.key}: ${items.length} page state(s), ${matched} matched to offers${unmatched.length ? `, unmatched: ${unmatched.join('; ')}` : ''}`);
      ok++;
    } catch (err) {
      const blocked = err instanceof BlockedByHost || err instanceof RobotsDisallowed;
      const msg = err instanceof Error ? err.message.slice(0, 200) : String(err);
      console[blocked ? 'log' : 'error'](`  ${a.key}: ${blocked ? 'blocked (never bypassed)' : 'FAILED'} - ${msg}`);
      failed.push(`${a.key}: ${msg}`);
    }
  }
  return { ok, failed };
}

async function providerFor(a: CruiseAdapter): Promise<ProviderRef | null> {
  const { data, error } = await supabase.from('cruise_providers')
    .select('id, name, root_domain, website_url, status').eq('root_domain', a.domain).maybeSingle();
  if (error) throw new Error(`provider read failed: ${error.message}`);
  if (!data || ['dead', 'duplicate'].includes(String(data.status))) return null;
  return data as ProviderRef;
}

/** Live read without any DB access (development / `cruise-adapters probe`). */
export async function probeAdapter(a: CruiseAdapter): Promise<CruiseAdapterItem[]> {
  return a.fetchStates();
}
