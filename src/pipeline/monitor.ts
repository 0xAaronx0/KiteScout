import pLimit from 'p-limit';
import { supabase } from '../lib/supabase.js';
import { extract as tavilyExtract } from '../lib/tavily.js';
import { runExtractCruiseOffers } from './extract-cruise-offers.js';
import { fetchPageConditional } from '../lib/fetchPage.js';
import { htmlToText, collapse, contentHash } from '../lib/content.js';
import { factsKey, normUrl, siteLossSignal } from './cruise-state.js';
import { newCtx, observePage, observeSiteLoss, recordSourceGone, type ObserveCtx } from './observe.js';
import { isAdapterUrl } from '../cruise-adapters/registry.js';

const CONCURRENCY = 3;
// Stored snapshot = what the next run's facts filter compares against. As long as the
// LLM read (60k chars) so a price far down a long page is not invisible to the filter.
const SNAPSHOT_CHARS = 60000;

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
  status: string | null;
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
/** Tavily watches retry the direct path once a week (spread by watch id): one transient
 *  failure used to pin a page on Tavily forever (108/200 watches by 2026-10-12), and
 *  Tavily's render variants caused daily flip-flop "changes". */
function directRetryDue(watch: WatchRow): boolean {
  let h = 0;
  for (const c of watch.id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return (Math.floor(Date.now() / 86_400_000) + h) % 7 === 0;
}

async function getReadable(watch: WatchRow): Promise<
  | { kind: 'not_modified' }
  | { kind: 'ok'; readable: string; etag: string | null; lastModified: string | null; method: 'direct' | 'tavily' }
  | { kind: 'fail'; httpStatus?: number }
> {
  if (watch.fetch_method === 'direct' || directRetryDue(watch)) {
    const r = await fetchPageConditional(watch.url, { etag: watch.etag, lastModified: watch.last_modified });
    if (r.status === 'not_modified') return { kind: 'not_modified' };
    if (r.status === 'ok' && r.html) {
      const readable = htmlToText(r.html);
      if (readable.length >= 200) {
        return { kind: 'ok', readable, etag: r.etag ?? null, lastModified: r.lastModified ?? null, method: 'direct' };
      }
    }
    // A page that is really gone must not be resurrected by Tavily's cache/soft-404 text.
    if (r.httpStatus === 404 || r.httpStatus === 410) return { kind: 'fail', httpStatus: r.httpStatus };
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
  opts: { intervalDays?: number; all?: boolean; baselineOnly?: boolean; cutoffISO?: string; ctx?: ObserveCtx } = {},
): Promise<MonitorResult> {
  const intervalDays = opts.intervalDays ?? 7;
  const ctx = opts.ctx ?? newCtx();
  const eventsStart = ctx.events.length;

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
  const { data: providerRows, error: provErr } = await supabase
    .from('cruise_providers')
    .select('id, name, website_url, root_domain, status')
    .in('id', providerIds);
  if (provErr) throw provErr;
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
        // Hidden providers (dead/duplicate) aren't checked; touch the row so the --all loop drains.
        if (provider.status === 'dead' || provider.status === 'duplicate') {
          await touchUnchanged(watch, null, null);
          result.checked++; result.unchanged++; // counted, or a batch of only these would end the --loop
          return;
        }

        const fetched = await getReadable(watch);

        if (fetched.kind === 'not_modified') {
          result.checked++; result.unchanged++;
          await touchUnchanged(watch, null, null);
          return;
        }
        if (fetched.kind === 'fail') {
          result.checked++; result.failed++;
          await recordFailure(watch);
          // An offer's source page answering 404/410 for a week → "offer gone?" review.
          if (fetched.httpStatus === 404 || fetched.httpStatus === 410) {
            try {
              await recordSourceGone(provider, watch.url, fetched.httpStatus, (watch.consecutive_failures ?? 0) + 1, ctx);
            } catch (err) {
              console.error(`  gone-check failed for ${watch.url}:`, err instanceof Error ? err.message : err);
            }
          }
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

        // Homepage taken over / parked / unrelated → hidden after a 2nd sighting (observe.ts).
        // Checked on EVERY homepage read (cheap regex): a hijacked page that then stays
        // stable never changes its hash again (kitesurfcamp.net, 2026-09).
        const isHome = normUrl(watch.url) === normUrl(providerUrl(provider));
        const homeSignal = isHome && !opts.baselineOnly && siteLossSignal(readable) !== null;

        // Unchanged content → cheap path, no LLM.
        if (watch.content_hash === hash) {
          await touchUnchanged(watch, etag, lastModified);
          result.checked++; result.unchanged++;
          if (homeSignal) {
            try { await observeSiteLoss(provider, watch.url, readable, ctx); }
            catch (err) { console.error(`  site-loss check failed for ${watch.url}:`, err instanceof Error ? err.message : err); }
          }
          return;
        }

        // Content changed.
        result.checked++; result.changed++;
        await saveWatch(watch.id, { hash, snapshot, etag, lastModified, method, changed: true });

        if (opts.baselineOnly) return;

        // The page text changed. Instead of asking an LLM whether the TEXT diff is
        // "significant" (→ /changes flood), observe the listing FACTS (observe.ts):
        try {
          // 1. Homepage changed: site-loss check (also closes an open alarm when the site is back).
          if (isHome && await observeSiteLoss(provider, watch.url, readable, ctx)) return;
          // 2. Testimonials, CTAs, countdowns, render variants: no price/date/availability
          //    token changed → nothing a listing shows can have changed.
          if (factsKey((watch.content_snapshot ?? '').slice(0, SNAPSHOT_CHARS)) === factsKey(snapshot)) return;
          // 3. Pages an adapter reads deterministically are observed in the adapter phase.
          if (isAdapterUrl(watch.url)) return;
          // 4. One structured read → per-offer proposals + new products.
          const before = ctx.events.length;
          await observePage(provider, watch.url, readable, ctx);
          result.significant += ctx.events.length - before;
        } catch (err) {
          console.error(`  observe failed for ${watch.url}:`, err instanceof Error ? err.message : err);
        }
      }),
    ),
  );
  for (const e of ctx.events.slice(eventsStart)) {
    result.changes.push({ name: e.provider, url: e.url, changeType: e.kind, summary: e.summary });
  }

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

// ---------------------------------------------------------------------------
// On-demand re-run preview for one /changes entry (triggered from the admin UI
// via the rerun-change.yml workflow): re-extract the provider WITHOUT writing
// any offer, store the before/after diff + a surgical apply-plan on the change
// row. The admin then approves on /changes — surgical diffs apply instantly in
// the web route; adds/removals fall back to the proven full re-extraction path.
// ---------------------------------------------------------------------------
export async function rerunChangePreview(changeId: string): Promise<void> {
  const { reviewProviderWithPlan } = await import('./extract-cruise-offers.js');
  const { closeRenderer } = await import('../lib/render.js');

  const { data: change, error } = await supabase
    .from('cruise_changes')
    .select('id, cruise_provider_id, details, cruise_providers!inner(id, name, root_domain, website_url)')
    .eq('id', changeId)
    .single();
  if (error || !change) throw new Error(`change ${changeId} not found: ${error?.message ?? ''}`);

  const provider = (change as unknown as {
    cruise_providers: { id: string; name: string | null; root_domain: string; website_url: string | null };
  }).cruise_providers;
  console.log(`Re-running extraction preview for ${provider.root_domain} (change ${changeId})…`);

  const plan = await reviewProviderWithPlan(provider);

  // Media: collect fresh image/video candidates for this provider (purely
  // additive — the admin's selected/applied curation is never touched) and
  // report how many NEW candidates appeared per offer, so the admin knows
  // there is something new to curate. Best-effort: a collect failure must not
  // fail the diff.
  let mediaNotice: Array<{ offer_id: string; slug: string; new_images: number; new_videos: number }> = [];
  try {
    const { runCollectMediaCandidates } = await import('./media-candidates.js');
    const { data: provOffers } = await supabase
      .from('cruise_offers').select('id, slug').eq('cruise_provider_id', provider.id);
    const ids = (provOffers ?? []).map(o => o.id as string);
    const countByOffer = async (): Promise<Map<string, { i: number; v: number }>> => {
      const m = new Map<string, { i: number; v: number }>();
      if (ids.length === 0) return m;
      const { data } = await supabase
        .from('offer_media_candidates').select('cruise_offer_id, kind').in('cruise_offer_id', ids).limit(20000);
      for (const c of data ?? []) {
        const e = m.get(c.cruise_offer_id as string) ?? { i: 0, v: 0 };
        if (c.kind === 'image') e.i++; else e.v++;
        m.set(c.cruise_offer_id as string, e);
      }
      return m;
    };
    const before = await countByOffer();
    await runCollectMediaCandidates({ domain: provider.root_domain });
    const after = await countByOffer();
    for (const o of provOffers ?? []) {
      const b = before.get(o.id as string) ?? { i: 0, v: 0 };
      const a = after.get(o.id as string) ?? { i: 0, v: 0 };
      const ni = a.i - b.i, nv = a.v - b.v;
      if (ni > 0 || nv > 0) mediaNotice.push({ offer_id: o.id as string, slug: o.slug as string, new_images: ni, new_videos: nv });
    }
  } catch (err) {
    console.error(`  media collect during rerun failed (diff unaffected): ${err instanceof Error ? err.message.slice(0, 120) : err}`);
  }
  await closeRenderer();

  const details = ((change.details as Record<string, unknown>) ?? {});
  const hasStructural = plan.review.added.length > 0 || plan.review.removed.length > 0;
  const rerun = {
    at: new Date().toISOString(),
    review: plan.review,
    updates: plan.updates,
    media: { new_candidates: mediaNotice },
    // surgical → approve applies the stored field values instantly in the web
    // route; full → approve queues the existing cron re-extraction (new/removed
    // offers need slugs, geocoding and image curation).
    mode: plan.review.error ? 'error' : hasStructural ? 'full' : 'surgical',
  };
  const status = plan.review.error ? (details.status ?? 'pending') : 'rerun_done';

  const { error: upErr } = await supabase
    .from('cruise_changes')
    .update({ details: { ...details, rerun, status } })
    .eq('id', changeId);
  if (upErr) throw upErr;

  // The fresh diff compares CURRENT site ↔ CURRENT DB, so it subsumes every
  // older open change of this provider — fold them into this one.
  let superseded = 0;
  if (!plan.review.error) {
    const { data: siblings } = await supabase
      .from('cruise_changes')
      .select('id, details')
      .eq('cruise_provider_id', provider.id)
      .neq('id', changeId);
    for (const sib of siblings ?? []) {
      const sd = ((sib.details as Record<string, unknown>) ?? {});
      const st = (sd.status as string) ?? 'pending';
      if (st !== 'pending' && st !== 'rerun_done') continue;
      // Observation rows (details.kind, observe.ts) are specific decisions, not text diffs.
      if (sd.kind) continue;
      await supabase.from('cruise_changes').update({
        details: { ...sd, status: 'superseded', superseded_by: changeId, superseded_at: new Date().toISOString() },
        seen: true,
      }).eq('id', sib.id);
      superseded++;
    }
  }

  const r = plan.review;
  console.log(r.error
    ? `✗ extraction error stored: ${r.error}`
    : `✓ stored: ${r.changed.length} changed · ${r.added.length} new · ${r.removed.length} removed · ${r.unchanged} unchanged · mode=${rerun.mode} · ${plan.updates.length} surgical update(s) · neue Medien-Kandidaten auf ${mediaNotice.length} Offer(s) · ${superseded} ältere Change(s) zusammengefaltet`);
}
