import pLimit from 'p-limit';
import { supabase } from '../lib/supabase.js';
import { anthropic, EXTRACTION_MODEL } from '../lib/anthropic.js';
import { extract as tavilyExtract } from '../lib/tavily.js';
import { applySurgicalToChange } from './surgical.js';
import { runExtractCruiseOffers } from './extract-cruise-offers.js';
import { withRetry } from '../lib/retry.js';
import { fetchPageConditional } from '../lib/fetchPage.js';
import { htmlToText, collapse, contentHash } from '../lib/content.js';

const CONCURRENCY = 3;
const SNAPSHOT_CHARS = 18000; // stored snapshot used for the next diff
const DIFF_CHARS = 9000;      // how much old/new text we feed the diff model

// ---------------------------------------------------------------------------
// Diff prompt — only runs when the content hash actually changed.
// ---------------------------------------------------------------------------
const DIFF_PROMPT = `You compare two snapshots of a kite-cruise / liveaboard travel provider's web page (OLD vs NEW) and report only the changes that matter to a traveler.

Treat these as SIGNIFICANT:
- A new kite cruise / liveaboard / safari / trip / lessons package being offered
- An offer, trip, or departure that has been removed or sold out
- A price change (up or down), a discount, or a last-minute deal
- New dates, a new season, or availability opening/closing
- A new bookable product or "book now" for kite/snowkite services

Treat these as NOT significant (significant=false):
- Navigation, footer, cookie/consent banners, legal text
- Blog posts, news, social feeds, photo galleries, testimonials
- Cosmetic wording, layout, or whitespace changes

Return STRICT JSON only (no markdown, no prose):
{
  "significant": boolean,
  "changeType": "new_offer" | "price_change" | "dates_change" | "removed_offer" | "content_update" | "none",
  "summary": "max 160 chars, what changed for a traveler",
  "offers": [
    { "name": string|null, "price": string|null, "dates": string|null, "type": string|null, "location": string|null }
  ],
  "changes": ["short bullet of each concrete change"]
}

"offers" = the bookable kite-cruise offers currently visible in the NEW snapshot (best effort; [] if none).
If nothing traveler-relevant changed, set significant=false and changeType="none".`;

interface DiffResult {
  significant: boolean;
  changeType: string;
  summary: string;
  offers?: Array<{ name?: string | null; price?: string | null; dates?: string | null; type?: string | null; location?: string | null }>;
  changes?: string[];
}

interface WatchRow {
  id: string;
  cruise_provider_id: string;
  url: string;
  content_hash: string | null;
  content_snapshot: string | null;
  etag: string | null;
  last_modified: string | null;
  fetch_method: 'direct' | 'tavily';
  consecutive_failures: number;
}

interface ProviderRow {
  id: string;
  name: string | null;
  website_url: string | null;
  root_domain: string;
}

export interface DetectedChange {
  name: string | null;
  url: string;
  changeType: string;
  summary: string;
}

export interface MonitorResult {
  checked: number;
  baselines: number;
  unchanged: number;
  changed: number;
  significant: number;
  failed: number;
  remaining: number;
  changes: DetectedChange[];
}

// Build the page URL to watch: full website_url when present, else the domain.
function providerUrl(p: { website_url: string | null; root_domain: string }): string {
  return p.website_url ?? `https://${p.root_domain}`;
}

// ---------------------------------------------------------------------------
// Make sure every monitorable cruise provider has a homepage watch row.
// Idempotent + cheap relative to the network work that follows.
// ---------------------------------------------------------------------------
async function ensureWatches(): Promise<void> {
  const { data: providers } = await supabase
    .from('cruise_providers')
    .select('id, website_url, root_domain')
    .not('status', 'in', '("dead","duplicate")')
    .not('root_domain', 'is', null);

  if (!providers?.length) return;
  const domainById = new Map(providers.map(p => [p.id as string, (p.root_domain as string).toLowerCase()]));

  // One watch per provider homepage…
  const toInsert = providers.map(p => ({
    cruise_provider_id: p.id as string,
    url: providerUrl(p as { website_url: string | null; root_domain: string }),
  }));

  // …plus every offer's source page — exactly the subpages that carry the
  // cruise/date/price data (self-maintaining: new offers add their page on the
  // next run). Same-domain guard; trailing slash normalized to match UNIQUE.
  const { data: offers } = await supabase
    .from('cruise_offers')
    .select('cruise_provider_id, source_url')
    .not('source_url', 'is', null);
  const seen = new Set(toInsert.map(r => `${r.cruise_provider_id}|${r.url.replace(/\/$/, '')}`));
  for (const o of offers ?? []) {
    const pid = o.cruise_provider_id as string;
    const domain = domainById.get(pid);
    const url = (o.source_url as string).replace(/\/$/, '');
    if (!domain || !url) continue;
    try { if (!new URL(url).hostname.toLowerCase().replace(/^www\./, '').endsWith(domain.replace(/^www\./, ''))) continue; }
    catch { continue; }
    const key = `${pid}|${url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    toInsert.push({ cruise_provider_id: pid, url });
  }

  for (let i = 0; i < toInsert.length; i += 500) {
    await supabase
      .from('cruise_watch')
      .upsert(toInsert.slice(i, i + 500), { onConflict: 'cruise_provider_id,url', ignoreDuplicates: true });
  }
}

// ---------------------------------------------------------------------------
// LLM diff (only on real content change)
// ---------------------------------------------------------------------------
async function runDiff(oldText: string, newText: string): Promise<DiffResult | null> {
  try {
    const msg = await withRetry(() =>
      anthropic.messages.create({
        model: EXTRACTION_MODEL,
        max_tokens: 700,
        system: [{ type: 'text', text: DIFF_PROMPT, cache_control: { type: 'ephemeral' } }],
        messages: [{
          role: 'user',
          content: `OLD snapshot:\n${oldText.slice(0, DIFF_CHARS)}\n\n---\n\nNEW snapshot:\n${newText.slice(0, DIFF_CHARS)}`,
        }],
      }),
    );
    const text = msg.content[0].type === 'text' ? msg.content[0].text : '';
    const json = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    return JSON.parse(json) as DiffResult;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Persist watch state after a check.
// ---------------------------------------------------------------------------
async function saveWatch(
  watchId: string,
  fields: {
    hash: string;
    snapshot: string;
    etag: string | null;
    lastModified: string | null;
    method: 'direct' | 'tavily';
    changed: boolean;
  },
): Promise<void> {
  const now = new Date().toISOString();
  await supabase
    .from('cruise_watch')
    .update({
      content_hash: fields.hash,
      content_snapshot: fields.snapshot,
      etag: fields.etag,
      last_modified: fields.lastModified,
      fetch_method: fields.method,
      last_checked_at: now,
      consecutive_failures: 0,
      ...(fields.changed ? { last_changed_at: now } : {}),
    })
    .eq('id', watchId);
}

async function touchUnchanged(watch: WatchRow, etag: string | null, lastModified: string | null): Promise<void> {
  await supabase
    .from('cruise_watch')
    .update({
      last_checked_at: new Date().toISOString(),
      consecutive_failures: 0,
      // refresh validators if the server returned new ones
      ...(etag ? { etag } : {}),
      ...(lastModified ? { last_modified: lastModified } : {}),
    })
    .eq('id', watch.id);
}

async function recordFailure(watch: WatchRow): Promise<void> {
  await supabase
    .from('cruise_watch')
    .update({
      last_checked_at: new Date().toISOString(),
      consecutive_failures: (watch.consecutive_failures ?? 0) + 1,
    })
    .eq('id', watch.id);
}

// ---------------------------------------------------------------------------
// Fetch readable page text, preferring the cheap direct path and falling back
// to Tavily extract for sites that block bots.
// ---------------------------------------------------------------------------
async function getReadable(watch: WatchRow): Promise<
  | { kind: 'not_modified' }
  | { kind: 'ok'; readable: string; etag: string | null; lastModified: string | null; method: 'direct' | 'tavily' }
  | { kind: 'fail' }
> {
  if (watch.fetch_method === 'direct') {
    const r = await fetchPageConditional(watch.url, { etag: watch.etag, lastModified: watch.last_modified });
    if (r.status === 'not_modified') return { kind: 'not_modified' };
    if (r.status === 'ok' && r.html) {
      const readable = htmlToText(r.html);
      if (readable.length >= 200) {
        return { kind: 'ok', readable, etag: r.etag ?? null, lastModified: r.lastModified ?? null, method: 'direct' };
      }
    }
    // blocked/error/too-thin → Tavily fallback
    const t = await tavilyExtract(watch.url);
    if (t && collapse(t).length >= 200) {
      return { kind: 'ok', readable: collapse(t), etag: null, lastModified: null, method: 'tavily' };
    }
    return { kind: 'fail' };
  }

  // Already known to need Tavily
  const t = await tavilyExtract(watch.url);
  if (t && collapse(t).length >= 200) {
    return { kind: 'ok', readable: collapse(t), etag: null, lastModified: null, method: 'tavily' };
  }
  return { kind: 'fail' };
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------
export async function runMonitor(
  batchSize = 30,
  opts: { intervalDays?: number; all?: boolean; baselineOnly?: boolean; cutoffISO?: string } = {},
): Promise<MonitorResult> {
  const intervalDays = opts.intervalDays ?? 7;

  await ensureWatches();

  // A watch is "due" when it hasn't been checked since `cutoff`.
  //  - explicit cutoffISO (used by the --all loop: rows not touched this sweep)
  //  - --all without a cutoff: every row (single pass)
  //  - default: rows older than the interval
  const cutoff = opts.cutoffISO ?? (opts.all ? null : new Date(Date.now() - intervalDays * 86_400_000).toISOString());
  const dueFilter = cutoff ? `last_checked_at.is.null,last_checked_at.lt.${cutoff}` : null;

  // Select due watches
  let query = supabase
    .from('cruise_watch')
    .select('id, cruise_provider_id, url, content_hash, content_snapshot, etag, last_modified, fetch_method, consecutive_failures')
    .order('last_checked_at', { nullsFirst: true })
    .limit(batchSize);

  if (dueFilter) query = query.or(dueFilter);

  const { data: watches, error } = await query;
  if (error) throw error;
  if (!watches || watches.length === 0) {
    return { checked: 0, baselines: 0, unchanged: 0, changed: 0, significant: 0, failed: 0, remaining: 0, changes: [] };
  }

  // Load the cruise providers for these watches
  const providerIds = [...new Set(watches.map(w => w.cruise_provider_id as string))];
  const { data: providerRows } = await supabase
    .from('cruise_providers')
    .select('id, name, website_url, root_domain')
    .in('id', providerIds);
  const providerMap = new Map<string, ProviderRow>(
    (providerRows ?? []).map(p => [p.id as string, p as ProviderRow]),
  );

  console.log(`Monitoring ${watches.length} cruise provider page(s)…`);

  const limit = pLimit(CONCURRENCY);
  const result: MonitorResult = {
    checked: 0, baselines: 0, unchanged: 0, changed: 0, significant: 0, failed: 0, remaining: 0, changes: [],
  };

  await Promise.all(
    (watches as WatchRow[]).map(watch =>
      limit(async () => {
        const provider = providerMap.get(watch.cruise_provider_id);
        if (!provider) return;

        const fetched = await getReadable(watch);

        if (fetched.kind === 'not_modified') {
          result.checked++; result.unchanged++;
          await touchUnchanged(watch, null, null);
          return;
        }
        if (fetched.kind === 'fail') {
          result.checked++; result.failed++;
          await recordFailure(watch);
          return;
        }

        const { readable, etag, lastModified, method } = fetched;
        const hash = contentHash(readable);
        const snapshot = readable.slice(0, SNAPSHOT_CHARS);

        // First time we see this page → establish a baseline, no LLM.
        if (!watch.content_hash) {
          await saveWatch(watch.id, { hash, snapshot, etag, lastModified, method, changed: true });
          result.checked++; result.baselines++;
          return;
        }

        // Unchanged content → cheap path, no LLM.
        if (watch.content_hash === hash) {
          await touchUnchanged(watch, etag, lastModified);
          result.checked++; result.unchanged++;
          return;
        }

        // Content changed.
        result.checked++; result.changed++;
        await saveWatch(watch.id, { hash, snapshot, etag, lastModified, method, changed: true });

        if (opts.baselineOnly) return;

        const diff = await runDiff(watch.content_snapshot ?? '', readable);
        if (diff?.significant) {
          const { data: inserted } = await supabase.from('cruise_changes').insert({
            cruise_provider_id: provider.id,
            watch_id: watch.id,
            url: watch.url,
            change_type: diff.changeType,
            summary: diff.summary,
            // status lives in details (no DDL): pending | auto_applied | approved | applied | dismissed
            details: { status: 'pending', offers: diff.offers ?? [], changes: diff.changes ?? [] },
            significant: true,
          }).select('id').single();

          result.significant++;
          result.changes.push({ name: provider.name, url: watch.url, changeType: diff.changeType, summary: diff.summary });
          console.log(`\n  ⚡ ${provider.name ?? watch.url}\n     [${diff.changeType}] ${diff.summary}`);

          // Dates/price-only changes are applied surgically right away (only the
          // volatile offer fields; identity/content/images untouched) — everything
          // else stays pending for the /changes approval queue.
          if (inserted && (diff.changeType === 'dates_change' || diff.changeType === 'price_change')) {
            try {
              const outcome = await applySurgicalToChange(inserted.id as string);
              console.log(`     ↳ surgical: [${outcome.status}] ${outcome.note}`);
            } catch (err) {
              console.error(`     ↳ surgical failed (stays pending):`, err instanceof Error ? err.message : err);
            }
          }
        }
      }),
    ),
  );

  // Remaining due watches (for the loop). Rows we just processed now have a
  // fresh last_checked_at, so they fall outside the due filter automatically.
  let remainingQuery = supabase
    .from('cruise_watch')
    .select('*', { count: 'exact', head: true });
  if (dueFilter) remainingQuery = remainingQuery.or(dueFilter);
  const { count } = await remainingQuery;
  result.remaining = Math.max(0, count ?? 0);

  console.log(
    `\n  ${result.checked} checked · ${result.unchanged} unchanged · ${result.baselines} baselines · ` +
    `${result.changed} changed · ${result.significant} significant · ${result.failed} failed`,
  );

  return result;
}

// ---------------------------------------------------------------------------
// Read the recent changelog (used by the `changes` CLI command).
// ---------------------------------------------------------------------------
export async function showChanges(limit = 20, unseenOnly = false): Promise<void> {
  let query = supabase
    .from('cruise_changes')
    .select('detected_at, change_type, summary, url, seen')
    .order('detected_at', { ascending: false })
    .limit(limit);
  if (unseenOnly) query = query.eq('seen', false);

  const { data, error } = await query;
  if (error) throw error;

  if (!data || data.length === 0) {
    console.log('No cruise provider changes recorded yet.');
    return;
  }

  console.log(`=== ${data.length} most recent cruise provider change(s) ===\n`);
  for (const c of data) {
    const when = new Date(c.detected_at as string).toISOString().slice(0, 16).replace('T', ' ');
    const flag = c.seen ? ' ' : '•';
    console.log(`${flag} ${when}  [${c.change_type}]`);
    console.log(`   ${c.summary}`);
    console.log(`   ${c.url}\n`);
  }
}

// ---------------------------------------------------------------------------
// Apply user-approved changes (from the /changes page) via a full re-extraction
// of the affected provider. Runs in the daily cron before the sweep; capped so
// a pile of approvals can't blow the job timeout.
// ---------------------------------------------------------------------------
export async function applyApprovedChanges(maxProviders = 3): Promise<void> {
  const { data: rows, error } = await supabase
    .from('cruise_changes')
    .select('id, cruise_provider_id, details, cruise_providers!inner(root_domain)')
    .filter('details->>status', 'eq', 'approved')
    .order('detected_at', { ascending: true });
  if (error) throw error;
  if (!rows || rows.length === 0) { console.log('No approved changes queued.'); return; }

  const byDomain = new Map<string, Array<{ id: string; details: Record<string, unknown> }>>();
  for (const r of rows) {
    const domain = (r as unknown as { cruise_providers: { root_domain: string } }).cruise_providers.root_domain;
    (byDomain.get(domain) ?? byDomain.set(domain, []).get(domain)!)
      .push({ id: r.id as string, details: (r.details as Record<string, unknown>) ?? {} });
  }

  const domains = [...byDomain.keys()].slice(0, maxProviders);
  console.log(`Applying ${domains.length} approved provider(s): ${domains.join(', ')}${byDomain.size > domains.length ? ` (+${byDomain.size - domains.length} deferred to next run)` : ''}`);

  for (const domain of domains) {
    try {
      await runExtractCruiseOffers({ domain });
      for (const row of byDomain.get(domain)!) {
        await supabase.from('cruise_changes').update({
          details: { ...row.details, status: 'applied', applied_at: new Date().toISOString() },
          seen: true,
        }).eq('id', row.id);
      }
      console.log(`  ✓ applied ${domain}`);
    } catch (err) {
      console.error(`  ✗ apply failed for ${domain} (stays approved):`, err instanceof Error ? err.message : err);
    }
  }
}
