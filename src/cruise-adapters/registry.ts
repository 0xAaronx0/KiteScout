// Registered cruise adapters (see ./types.ts). Add new ones here; the monitor skips its
// LLM read for every URL listed by an adapter and the adapter phase observes them daily.
import { normUrl } from '../pipeline/cruise-state.js';
import type { CruiseAdapter } from './types.js';
import { kiteAndIslands } from './adapters/kite-and-islands.js';
import { kiteSafariSeason } from './adapters/kite-safari-season.js';
import { kite2sail } from './adapters/kite2sail.js';

export const CRUISE_ADAPTERS: CruiseAdapter[] = [kiteAndIslands, kiteSafariSeason, kite2sail];

const covered = new Set(CRUISE_ADAPTERS.flatMap(a => a.urls.map(normUrl)));
export function isAdapterUrl(url: string): boolean {
  return covered.has(normUrl(url));
}
