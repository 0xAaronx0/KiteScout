import 'dotenv/config';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { seedQueries } from './pipeline/seed-queries.js';
import { runSearch } from './pipeline/search.js';
import { runExtract } from './pipeline/extract.js';
import { runReextract } from './pipeline/reextract.js';
import { runDedupe } from './pipeline/dedupe.js';
import { runVerify } from './pipeline/verify.js';
import { runExtractCruiseLocations } from './pipeline/extract-cruise-locations.js';
import { runExtractCruiseOffers, runReviewCruiseOffers } from './pipeline/extract-cruise-offers.js';
import { runExtractCruiseReviews, recomputeAllAvgRatings } from './pipeline/extract-cruise-reviews.js';
import { runCollectMediaCandidates, runApplySelectedMedia } from './pipeline/media-candidates.js';
import { runRegionConditions } from './pipeline/region-conditions.js';
import { runSpotConditions } from './pipeline/spot-conditions.js';
import { runMonitor, showChanges, applyApprovedChanges, type DetectedChange } from './pipeline/monitor.js';
import {
  newCtx, confirmOpenObservations, observeBackfill, observeUrl, revertChange,
} from './pipeline/observe.js';
import { runCruiseAdapters } from './cruise-adapters/run.js';
import { isAdapterUrl } from './cruise-adapters/registry.js';
import {
  listBstokedCards, scrapeBstokedListing, seedBstokedListing, packageOffersTableExists,
} from './pipeline/bstoked-packages.js';
import { runCruiseRooms } from './pipeline/cruise-rooms.js';
import { supabase } from './lib/supabase.js';
import { geoVerify } from './publishing/geo-verify.js';

const [command, ...args] = process.argv.slice(2);

async function status(): Promise<void> {
  const [
    { count: totalQueries },
    { count: pendingQueries },
    { count: totalResults },
    { count: unprocessedResults },
    { count: totalProviders },
    { count: verifiedProviders },
    { count: newProviders },
  ] = await Promise.all([
    supabase.from('discovery_queries').select('*', { count: 'exact', head: true }),
    supabase.from('discovery_queries').select('*', { count: 'exact', head: true }).is('executed_at', null),
    supabase.from('raw_search_results').select('*', { count: 'exact', head: true }),
    supabase.from('raw_search_results').select('*', { count: 'exact', head: true }).eq('processed', false),
    supabase.from('providers').select('*', { count: 'exact', head: true }),
    supabase.from('providers').select('*', { count: 'exact', head: true }).eq('status', 'verified'),
    supabase.from('providers').select('*', { count: 'exact', head: true }).eq('status', 'new'),
  ]);

  console.log('=== KiteScout Pipeline Status ===');
  console.log(`Queries  : ${totalQueries ?? 0} total, ${pendingQueries ?? 0} pending`);
  console.log(`URLs     : ${totalResults ?? 0} found, ${unprocessedResults ?? 0} unprocessed`);
  console.log(`Providers: ${totalProviders ?? 0} total  (${newProviders ?? 0} new, ${verifiedProviders ?? 0} verified)`);
}

async function runSearchLoop(batchSize: number, loop: boolean): Promise<void> {
  let total = 0;
  while (true) {
    const { ran, remaining } = await runSearch(batchSize);
    total += ran;
    if (remaining === 0) { console.log(`Search complete. Total queries run: ${total}`); break; }
    if (!loop) { console.log(`Batch done. ${remaining} queries still pending. Run again to continue.`); break; }
    console.log(`  ${remaining} queries still pending…`);
  }
}

async function runExtractLoop(batchSize: number): Promise<void> {
  while (true) {
    const { processed, remaining } = await runExtract(batchSize);
    if (processed === 0 || remaining === 0) break;
    console.log(`  ${remaining} URLs still pending…`);
  }
  console.log('Extraction complete.');
}

async function blocklistCandidates(limit = 50): Promise<void> {
  // Extract root domain from URL using Postgres string functions
  const { data, error } = await supabase.rpc('blocklist_candidates', { row_limit: limit });

  if (error) {
    // RPC doesn't exist yet — fall back to fetching and processing in JS
    const { data: rows } = await supabase
      .from('raw_search_results')
      .select('url, error')
      .or('error.like.not_provider%,error.eq.pre-screen rejected,error.eq.blocked_domain')
      .limit(10000);

    if (!rows || rows.length === 0) {
      console.log('No rejected URLs yet — run extract first.');
      return;
    }

    const counts = new Map<string, number>();
    for (const row of rows) {
      try {
        const host = new URL(row.url).hostname.replace(/^www\./, '');
        counts.set(host, (counts.get(host) ?? 0) + 1);
      } catch { /* skip malformed URLs */ }
    }

    const sorted = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit);

    console.log('=== Blocklist Candidates (most-rejected domains) ===');
    console.log('Add any of these to BLOCKED_DOMAINS in src/config.ts\n');
    for (const [domain, count] of sorted) {
      console.log(`  ${String(count).padStart(4)}x  ${domain}`);
    }
    return;
  }

  console.log('=== Blocklist Candidates (most-rejected domains) ===');
  console.log('Add any of these to BLOCKED_DOMAINS in src/config.ts\n');
  for (const row of (data as Array<{ domain: string; rejections: number }>)) {
    console.log(`  ${String(row.rejections).padStart(4)}x  ${row.domain}`);
  }
}

function flagValue(name: string, fallback: number): number {
  const idx = args.indexOf(name);
  if (idx >= 0 && args[idx + 1]) {
    const n = parseInt(args[idx + 1], 10);
    if (!Number.isNaN(n)) return n;
  }
  return fallback;
}

function flagStr(name: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx >= 0 && args[idx + 1] && !args[idx + 1].startsWith('-')) return args[idx + 1];
  return undefined;
}

// Optional leading positional batch size (ignored when it's a flag like --domain).
function positionalLimit(): number | undefined {
  if (args[0] && !args[0].startsWith('-')) {
    const n = parseInt(args[0], 10);
    if (!Number.isNaN(n)) return n;
  }
  return undefined;
}

// Append a GitHub Actions step summary when running inside CI.
function writeStepSummary(changes: DetectedChange[], totals: { checked: number; significant: number }): void {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  const lines = [
    '## KiteScout cruise provider monitor',
    '',
    `Checked **${totals.checked}** pages · **${totals.significant}** significant change(s).`,
    '',
  ];
  if (changes.length > 0) {
    lines.push('| Provider | Change | Details |', '| --- | --- | --- |');
    for (const c of changes) {
      const name = (c.name ?? c.url).replace(/\|/g, '\\|');
      const summary = c.summary.replace(/\|/g, '\\|');
      lines.push(`| ${name} | ${c.changeType} | ${summary} |`);
    }
  } else {
    lines.push('_No significant changes this run._');
  }
  try { appendFileSync(file, lines.join('\n') + '\n'); } catch { /* best effort */ }
}

async function runMonitorLoop(
  batchSize: number,
  opts: { intervalDays: number; all: boolean; baselineOnly: boolean; loop: boolean; observe: boolean },
): Promise<void> {
  const allChanges: DetectedChange[] = [];
  // One observation context for the sweep + the adapter and confirm phases (src/pipeline/observe.ts).
  const ctx = newCtx();
  let totalChecked = 0;
  let totalSignificant = 0;
  let lastRemaining = 0;

  // For an --all sweep we pin a cutoff at the loop start so each iteration only
  // picks up rows not yet checked this run (otherwise the loop never terminates).
  const cutoffISO = opts.all && opts.loop ? new Date().toISOString() : undefined;

  while (true) {
    const r = await runMonitor(batchSize, {
      intervalDays: opts.intervalDays,
      all: opts.all,
      baselineOnly: opts.baselineOnly,
      cutoffISO,
      ctx,
    });
    totalChecked += r.checked;
    totalSignificant += r.significant;
    lastRemaining = r.remaining;
    allChanges.push(...r.changes);

    if (r.checked === 0) break;
    if (!opts.loop) break;
    if (r.remaining === 0) break;
    console.log(`  ${r.remaining} page(s) still due…`);
  }

  // Adapter phase (deterministic readers, daily) + confirm phase (2nd sighting of open
  // observations whose page did not change again). Both feed the same state machine.
  if (opts.observe && !opts.baselineOnly) {
    const before = ctx.events.length;
    await runCruiseAdapters(ctx);
    await confirmOpenObservations(ctx, isAdapterUrl);
    for (const e of ctx.events.slice(before)) allChanges.push({ name: e.provider, url: e.url, changeType: e.kind, summary: e.summary });
    totalSignificant += ctx.events.length - before;
  }

  console.log(`\nMonitoring complete. ${totalChecked} page(s) checked, ${totalSignificant} observation event(s).`);
  if (!opts.loop && lastRemaining > 0) {
    console.log(`  ${lastRemaining} page(s) still due — run again, or pass --loop to drain them all.`);
  }
  if (totalSignificant > 0) console.log(`Run "pnpm cli changes" to review them.`);
  writeStepSummary(allChanges, { checked: totalChecked, significant: totalSignificant });
}

async function main(): Promise<void> {
  const batchSize = parseInt(args[0] ?? '50', 10);

  switch (command) {
    case 'seed':
      await seedQueries();
      break;

    case 'search': {
      const loop = args.includes('--loop');
      await runSearchLoop(batchSize, loop);
      break;
    }

    case 'extract':
      await runExtractLoop(parseInt(args[0] ?? '30', 10));
      break;

    case 'reextract': {
      const reBatchSize = parseInt(args[0] ?? '20', 10);
      while (true) {
        const { processed, remaining } = await runReextract(reBatchSize);
        if (processed === 0 || remaining === 0) break;
        console.log(`  ${remaining} providers still missing locations…`);
      }
      console.log('Re-extraction complete.');
      break;
    }

    case 'dedupe':
      await runDedupe();
      break;

    case 'status':
      await status();
      break;

    case 'blocklist-candidates':
      await blocklistCandidates(parseInt(args[0] ?? '50', 10));
      break;

    case 'verify': {
      const verifyBatch = parseInt(args[0] ?? '20', 10);
      let totalRejected = 0;
      while (true) {
        const { processed, remaining, rejected } = await runVerify(verifyBatch);
        totalRejected += rejected;
        if (processed === 0 || remaining === 0) break;
        console.log(`  ${remaining} providers still pending…`);
      }
      console.log(`Verification complete. ${totalRejected} providers marked dead (not kite providers).`);
      break;
    }

    case 'cruise-locations': {
      const { providers, locations } = await runExtractCruiseLocations();
      console.log(`Done: ${locations} cruise locations extracted across ${providers} providers.`);
      break;
    }

    case 'cruise-offers': {
      const { providers, offers } = await runExtractCruiseOffers({
        domain: flagStr('--domain'),
        limit: positionalLimit(),
        dryRun: args.includes('--dry-run'),
      });
      console.log(`Done: ${offers} cruise offers extracted across ${providers} providers.`);
      break;
    }

    case 'cruise-diff': {
      // Before/after review: show what a fresh extraction WOULD change vs the
      // live DB, without writing. Apply an approved provider with `cruise-offers
      // --domain <domain>`. Also the retroactive "changed since the sweep" scan.
      await runReviewCruiseOffers({
        domain: flagStr('--domain'),
        limit: positionalLimit(),
      });
      break;
    }

    case 'cruise-media': {
      // Media curation: collect candidates → admin selects on /admin/media → apply.
      const sub = args[0];
      if (sub === 'collect') {
        const lim = flagValue('--limit', 0);
        await runCollectMediaCandidates({ domain: flagStr('--domain'), limit: lim > 0 ? lim : undefined });
      } else if (sub === 'apply') {
        await runApplySelectedMedia({ domain: flagStr('--domain') });
      } else {
        console.log('Usage: cruise-media collect|apply [--domain <root_domain>] [--limit n]');
      }
      break;
    }

    case 'video-loops': {
      // Muted 5 s preview loops (208x160) + stills for every hero video, in the public bucket under loops/.
      const { runVideoLoops } = await import('./pipeline/video-loops.js');
      const dry = args.includes('--dry-run');
      const lim = flagValue('--limit', 0);
      const s = await runVideoLoops({ dryRun: dry, limit: lim > 0 ? lim : undefined });
      console.log(`video-loops: ${s.videos} hero videos, ${s.alreadyLooped} already looped, ${s.missing} missing` +
        (dry ? ' (dry run, nothing written)' : `; ${s.written} written, ${s.failed} failed`));
      for (const f of s.failures) console.log(`  failed: ${f}`);
      if (s.failed) process.exitCode = 1;
      break;
    }
    case 'images-thumbs': {
      // Backfill 160x140 gallery thumbnails (thumb_path) for stored offer images; --dry-run only counts.
      const { runImageThumbs, isThumbTable } = await import('./pipeline/image-thumbs.js');
      const table = flagStr('--table');
      if (table !== undefined && !isThumbTable(table)) {
        console.error('Usage: images-thumbs [--dry-run] [--limit n] [--table cruise|package]');
        process.exit(1);
      }
      const dry = args.includes('--dry-run');
      const lim = flagValue('--limit', 0);
      const stats = await runImageThumbs({ dryRun: dry, limit: lim > 0 ? lim : undefined, table });
      for (const s of stats) {
        console.log(`${s.table}: ${s.rows} rows, ${s.rowsWithImages} with images, ${s.images} images; ` +
          `${s.alreadyThumbed} already thumbed, ${s.missing} missing in ${s.rowsNeedingThumbs} rows, ${s.noPath} without path` +
          (dry ? ' (dry run, nothing written)'
            : `; processed ${s.processedRows} rows: ${s.thumbsWritten} thumbs written, ${s.thumbsFailed} failed, ${s.rowsUpdated} rows updated`));
      }
      break;
    }

    case 'cruise-reviews': {
      if (args.includes('--recompute-avg')) {
        // Backfill/refresh the combined avg_rating column only (no fetching).
        await recomputeAllAvgRatings();
        break;
      }
      const { providers, matched } = await runExtractCruiseReviews({
        all: args.includes('--all'),
        domain: flagStr('--domain'),
        limit: positionalLimit(),
        only: flagStr('--only'), // e.g. --only tripadvisor,google
      });
      console.log(`Done: ${matched} review links matched across ${providers} providers.`);
      break;
    }

    case 'operator-reviews': {
      // Package operators' review links (bstoked, TripAdvisor, Google). Two steps (Aaron 2026-10-30):
      //   --dry-run --out f.json   search, write only the file (for review)
      //   --apply f.json [--skip domain:source,...]   write exactly that reviewed file to public.providers
      const apply = flagStr('--apply');
      if (apply) {
        const { applyOperatorReviews } = await import('./pipeline/extract-cruise-reviews.js');
        const skip = (flagStr('--skip') ?? '').split(',').map(s => s.trim()).filter(Boolean);
        const r = await applyOperatorReviews(JSON.parse(readFileSync(apply, 'utf8')), { skip });
        console.log(`operator-reviews: ${r.written} providers written, ${r.withLinks} with a review link; dropped: ${r.dropped.join(', ') || 'none'}`);
        break;
      }
      if (!args.includes('--dry-run')) { console.error('operator-reviews: pass --dry-run --out f.json (search) or --apply f.json (write a reviewed file).'); process.exitCode = 1; break; }
      const { runOperatorReviewsDryRun } = await import('./pipeline/extract-cruise-reviews.js');
      const results = await runOperatorReviewsDryRun({ domain: flagStr('--domain'), limit: positionalLimit(), only: flagStr('--only') });
      const out = flagStr('--out');
      if (out) writeFileSync(out, JSON.stringify(results, null, 2));
      const by = (k: string) => results.filter(r => r.links[k]).length;
      console.log(`${results.length} operators: ${results.filter(r => r.found).length} with a review link (bstoked ${by('bstoked_url')}, TripAdvisor ${by('tripadvisor_url')}, Google ${by('google_url')}), ${results.filter(r => r.error).length} errors${out ? ` -> ${out}` : ''}`);
      break;
    }

    case 'region-conditions': {
      const { regions } = await runRegionConditions();
      console.log(`Done: conditions built for ${regions} countries.`);
      break;
    }

    case 'spot-conditions': {
      const at = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
      await runSpotConditions({ dryRun: args.includes('--dry-run'), out: at('--out'), from: at('--from') });
      break;
    }

    case 'monitor': {
      if (args.includes('--apply-approved')) {
        // Apply user-approved changes (from /changes) via full re-extraction.
        await applyApprovedChanges(flagValue('--apply-approved-max', 3));
        break;
      }
      const monitorBatch = parseInt((args[0] && !args[0].startsWith('-') ? args[0] : '30'), 10);
      await runMonitorLoop(monitorBatch, {
        intervalDays: flagValue('--interval-days', 7),
        all: args.includes('--all'),
        baselineOnly: args.includes('--baseline-only'),
        loop: args.includes('--loop'),
        observe: !args.includes('--no-observe'),
      });
      break;
    }

    case 'observe': {
      // Structured observation outside the daily sweep (src/pipeline/observe.ts):
      //   observe <url> [--dry-run]                one page → proposals / new products
      //   observe backfill --domain X [--dry-run]  every source page of one provider
      //   observe confirm [--dry-run]              2nd-sighting phase only
      const ctx = newCtx({ dryRun: args.includes('--dry-run') });
      if (ctx.dryRun) console.log('DRY RUN: no DB writes');
      if (args[0] === 'confirm') {
        await confirmOpenObservations(ctx, isAdapterUrl);
      } else if (args[0] === 'backfill') {
        const domain = flagStr('--domain');
        if (!domain) { console.error('Usage: pnpm cli observe backfill --domain <root_domain> [--dry-run]'); process.exit(1); }
        await observeBackfill(domain, ctx);
      } else if (args[0]?.startsWith('http')) {
        await observeUrl(args[0], ctx);
      } else {
        console.error('Usage: pnpm cli observe <url> | backfill --domain X | confirm  [--dry-run]');
        process.exit(1);
      }
      console.log(`\n${ctx.events.length} event(s)`);
      break;
    }

    case 'cruise-adapters': {
      // Deterministic cruise readers (src/cruise-adapters/):
      //   cruise-adapters list | probe [key] (live, no DB) | run [key] [--dry-run]
      const { CRUISE_ADAPTERS } = await import('./cruise-adapters/registry.js');
      const key = args[1] && !args[1].startsWith('-') ? args[1] : undefined;
      if (args[0] === 'list') {
        for (const a of CRUISE_ADAPTERS) console.log(`${a.key.padEnd(22)} ${a.domain.padEnd(24)} ${a.urls.length} page(s)${a.datesMode === 'merge' ? ' · dates merge' : ''}`);
      } else if (args[0] === 'probe') {
        const { probeAdapter } = await import('./cruise-adapters/run.js');
        for (const a of CRUISE_ADAPTERS.filter(x => !key || x.key === key)) {
          for (const it of await probeAdapter(a)) {
            const s = it.state;
            console.log(`${a.key} ${it.sourceUrl}\n   dates: ${(s.departures ?? []).map(d => `${d.start_date}..${d.end_date ?? '?'}${d.status ? ` ${d.status}` : ''}`).join(', ') || '-'}` +
              `\n   p.p.: ${s.pricePP ? `${s.pricePP.amount} ${s.pricePP.currency}` : '-'} · charter: ${s.priceCharter ? `${s.priceCharter.amount} ${s.priceCharter.currency}` : '-'}`);
          }
        }
      } else if (args[0] === 'run') {
        const ctx = newCtx({ dryRun: args.includes('--dry-run') });
        if (ctx.dryRun) console.log('DRY RUN: no DB writes');
        const r = await runCruiseAdapters(ctx, key);
        console.log(`\n${r.ok} adapter(s) ok${r.failed.length ? `, failed: ${r.failed.join(' | ')}` : ''} · ${ctx.events.length} event(s)`);
      } else {
        console.error('Usage: pnpm cli cruise-adapters list | probe [key] | run [key] [--dry-run]');
        process.exit(1);
      }
      break;
    }

    case 'changes': {
      if (args[0] === 'rerun') {
        // On-demand preview re-extraction for one /changes row (admin UI button
        // → rerun-change.yml workflow → here). No offer writes — stores the
        // before/after diff + surgical apply-plan on the change row.
        const changeId = args[1];
        if (!changeId) { console.error('Usage: pnpm cli changes rerun <change-id>'); process.exit(1); }
        const { rerunChangePreview } = await import('./pipeline/monitor.js');
        await rerunChangePreview(changeId);
        break;
      }
      if (args[0] === 'revert') {
        // Undo an auto-applied observation (writes the logged "before" values back).
        const changeId = args[1];
        if (!changeId) { console.error('Usage: pnpm cli changes revert <change-id>'); process.exit(1); }
        await revertChange(changeId);
        break;
      }
      const changesLimit = parseInt((args[0] && !args[0].startsWith('-') ? args[0] : '20'), 10);
      await showChanges(changesLimit, args.includes('--unseen'));
      break;
    }

    case 'cruise-rooms': {
      // Cabin types for cruises → cruise_offers.rooms (see src/pipeline/cruise-rooms.ts).
      const fromFile = flagStr('--from');
      const results = await runCruiseRooms({
        dryRun: args.includes('--dry-run'),
        offerId: flagStr('--offer'),
        from: fromFile ? JSON.parse(readFileSync(fromFile, 'utf8')) : undefined,
        bstokedOnly: args.includes('--bstoked-only'),
      });
      const outFile = flagStr('--out');
      if (outFile) writeFileSync(outFile, JSON.stringify(results, null, 2));
      break;
    }

    case 'data-fixes': {
      // Audit 2026-10-27 data fixes (src/pipeline/cruise-fixes.ts): plan = read-only diff, apply = the reviewed plan.
      const { planDataFixes, applyDataFixes } = await import('./pipeline/cruise-fixes.js');
      if (args[0] === 'apply') {
        const from = flagStr('--from');
        if (!from) { console.error('Usage: pnpm cli data-fixes apply --from <plan.json>'); process.exit(1); }
        await applyDataFixes(from, { revert: args.includes('--revert') });
      } else {
        await planDataFixes({ out: flagStr('--out') });
      }
      break;
    }

    case 'bstoked-packages': {
      // bstoked.net camps/tours/accommodation → package_offers (see src/pipeline/bstoked-packages.ts).
      const sub = args[0];
      const outFile = flagStr('--out');
      const refs = args.slice(1).filter(a => !a.startsWith('-') && a !== outFile);
      if (sub === 'list') {
        const cards = await listBstokedCards();
        for (const c of cards) {
          console.log(`${c.id.padStart(5)}  ${(c.type ?? '?').padEnd(13)} ${c.title.slice(0, 50).padEnd(50)}  ${c.locationLabel}  | ${c.priceLabel ?? '-'}`);
        }
        console.log(`\n${cards.length} listings`);
      } else if ((sub === 'scrape' || sub === 'seed') && refs.length) {
        const cards = new Map((await listBstokedCards()).map(c => [c.id, c]));
        const cardFor = (ref: string) =>
          cards.get(ref) ?? [...cards.values()].find(c => c.path.replace(/\/+$/, '').endsWith(`/${ref}`));
        if (sub === 'seed' && !(await packageOffersTableExists())) {
          console.error('package_offers does not exist yet: apply supabase/migrations/20260925120000_create_package_offers.sql first.');
          process.exit(1);
        }
        const scraped = [];
        for (const ref of refs) {
          const listing = await scrapeBstokedListing(ref, cardFor(ref));
          console.error(`  ${listing.source_listing_id} ${listing.package_type}: ${listing.title} - ${listing.image_urls.length} images`);
          if (sub === 'seed') {
            const res = await seedBstokedListing(listing, { refreshImages: args.includes('--refresh-images') });
            console.error(`    → package_offers ${res.id} (${res.images} images, ${res.roomImages} of them room photos; general photos ${res.generalKept ? 'kept' : 'stored new'})`);
          }
          scraped.push(listing);
        }
        if (sub === 'scrape') {
          const json = JSON.stringify(scraped, null, 2);
          if (outFile) writeFileSync(outFile, json);
          else console.log(json);
        }
      } else {
        console.log('Usage: bstoked-packages list | scrape <id|slug> … [--out file.json] | seed <id|slug> … [--refresh-images]');
      }
      break;
    }

    case 'offers': {
      // provider-site offer adapters → package_offers + slots (see src/offers/ingest.ts).
      const { adapters, adapterByKey } = await import('./offers/registry.js');
      const { runAdapters, slotTablesExist } = await import('./offers/ingest.js');
      const sub = args[0];
      const outArg = flagStr('--out');
      const refs = args.slice(1).filter(a => !a.startsWith('-') && a !== outArg);
      const pick = refs.length === 0 || refs.includes('all') ? adapters
        : refs.map(r => adapterByKey(r) ?? (() => { throw new Error(`unknown adapter: ${r}`); })());
      if (sub === 'list') {
        for (const a of adapters) console.log(`${a.key.padEnd(34)} ${a.kind.padEnd(13)} ${a.slotMethod.padEnd(14)} ${a.url}`);
        console.log(`\n${adapters.length} adapters; slot store: ${(await slotTablesExist()) ? 'offer_slots' : 'package_offers.pricing (migration 20261009120000 not applied)'}`);
      } else if (sub === 'probe' || sub === 'ingest') {
        const reports = await runAdapters(pick, {
          mode: args.includes('--slots') ? 'slots' : 'full',
          dryRun: sub === 'probe' || args.includes('--dry-run'),
          refreshImages: args.includes('--refresh-images'),
        });
        const out = flagStr('--out');
        if (out) writeFileSync(out, JSON.stringify(reports, null, 2));
        for (const r of reports.filter(r => r.slotError)) console.log(`  ${r.key}: listed without slots - ${r.slotError}`);
        const bad = reports.filter(r => r.status === 'error').length;
        const blocked = reports.filter(r => r.status === 'blocked').length;
        console.log(`\n${reports.length - bad - blocked}/${reports.length} ok${blocked ? `, ${blocked} blocked by host` : ''}${bad ? `, ${bad} failed` : ''}`);
        if (bad) process.exitCode = 1;
      } else {
        console.log('Usage: offers list | probe [key…|all] [--slots] [--out f.json] | ingest [key…|all] [--slots] [--dry-run] [--refresh-images] [--out f.json]');
      }
      break;
    }

    case 'climate-uv-cloudy': {
      // One-off: CAMS all-sky UV for country/region cells - submits all ADS jobs, collects in later runs.
      const { runUvCloudy } = await import('./pipeline/uv-cloudy-run.js');
      const wait = flagStr('--wait-min');
      await runUvCloudy({ waitMin: wait ? Number(wait) : undefined });
      break;
    }

    case 'bookable-months': {
      // Daily: known bookable months per offer (season + open future slots) -> offer_bookable_months (KCS map filter).
      const { runBookableMonths } = await import('./pipeline/bookable-months.js');
      const dry = args.includes('--dry-run');
      const r = await runBookableMonths({ dryRun: dry });
      console.log(`${r.offers} offers -> ${r.known} with known months (${Object.entries(r.byBasis).map(([k, v]) => `${k} ${v}`).join(', ')})${dry ? ' (dry run, nothing written)' : `, ${r.written} upserted, ${r.deleted} stale rows deleted`}`);
      break;
    }

    case 'season-extract': {
      // Season months from the provider's own page for offers the map does not know yet. Plan + review table
      // only; `apply --from <plan.json>` writes the approved rows (still-empty months only), --revert undoes.
      const { runSeasonExtract, applySeasonPlan } = await import('./pipeline/season-extract.js');
      const list = (name: string) => flagStr(name)?.split(',').map(s => s.trim()).filter(Boolean);
      if (args[0] === 'region') {
        // Kite season from the spot's climate for offers whose page states none (plan + German review only).
        const { runRegionSeasons } = await import('./pipeline/season-region.js');
        const r = await runRegionSeasons({ outDir: flagStr('--out') ?? 'docs/season-region', pagePlan: flagStr('--plan') });
        console.log(JSON.stringify(r, null, 1));
        break;
      }
      if (args[0] === 'apply') {
        const from = flagStr('--from');
        if (!from) throw new Error('season-extract apply needs --from <plan.json>');
        const r = await applySeasonPlan({ from, only: list('--only'), exclude: list('--exclude'), approve: list('--approve'), includeWind: args.includes('--include-wind'), dryRun: args.includes('--dry-run'), revert: args.includes('--revert'), update: args.includes('--update') });
        console.log(`${r.selected} selected -> ${r.written} ${args.includes('--dry-run') ? 'would be ' : ''}${args.includes('--revert') ? 'reverted' : 'written'}, ${r.skipped} skipped (months no longer empty / changed)`);
        break;
      }
      const types = (list('--types') ?? ['cruise', 'camp', 'tour', 'course', 'accommodation']) as Array<'cruise' | 'camp' | 'tour' | 'course' | 'accommodation'>;
      const limit = flagStr('--limit');
      const r = await runSeasonExtract({ types, limit: limit ? Number(limit) : undefined, fetch: args.includes('--fetch'), recheck: args.includes('--recheck'), outDir: flagStr('--out') ?? 'docs/season-review' });
      console.log(JSON.stringify(r.summary, null, 1));
      console.log(`plan: ${r.planPath}\nreview: ${r.reviewPath}${r.errors ? `\n${r.errors} offers failed (see "error" in the plan)` : ''}`);
      break;
    }

    case 'climate-wind-check': {
      // READ-ONLY: ERA5 kiteable-day shares per country/region point for the Bstoked comparison.
      const { runWindCheck } = await import('./pipeline/wind-check.js');
      await runWindCheck();
      break;
    }

    case 'geo-verify': {
      // GEO P2b evidence manifest for KCS#267: re-fetch operator pages, verify the 7 gate facts, write JSON
      await geoVerify(args);
      break;
    }

    case 'climate-stats': {
      // UV + air/water temperature per offer spot -> offer_climate_stats, and per
      // country kite spot -> country_climate_stats (weekly GitHub Action).
      const { runClimateStats } = await import('./pipeline/climate-stats.js');
      const max = flagStr('--max-fetch'), budget = flagStr('--budget-min');
      const dry = args.includes('--dry-run');
      const r = await runClimateStats({ dryRun: dry, maxFetch: max ? Number(max) : undefined, budgetMin: budget ? Number(budget) : undefined });
      console.log(`${r.offers} offers -> ${r.rowsWritten} rows written${dry ? ' (dry run)' : ''}, ${r.rowsDeleted} stale rows deleted, ${r.cellsFetched} new climate cells fetched via ${r.fetcher}${dry ? ' (not stored)' : ''}`);
      if (r.unknownPorts.length) console.log(`Unknown departure ports (add to climate_port_points; first itinerary spot used meanwhile):\n  ${r.unknownPorts.join('\n  ')}`);
      if (r.noPoint.length) console.log(`No point (no port, no itinerary coordinates):\n  ${r.noPoint.join('\n  ')}`);
      if (r.deferred.length) console.log(`Deferred to next run (${r.deferred.length}):\n  ${r.deferred.join('\n  ')}`);
      console.log(`${r.countries} countries -> ${dry ? `${r.countries - r.countriesDeferred.length} rows computed (dry run)` : `${r.countryRowsWritten} rows written`}`);
      for (const c of r.countrySample) console.log(`  ${c.country} (${c.point_name}): air min ${c.air_temp_min_months.join(' ')} | air max ${c.air_temp_max_months.join(' ')} | water ${c.water_temp_months?.join(' ') ?? 'none'} | uv ${c.uv_months.join(' ')}`);
      if (r.countriesDeferred.length) console.log(`Countries deferred to next run (${r.countriesDeferred.length}):\n  ${r.countriesDeferred.join('\n  ')}`);
      if (r.windFetched) console.log(`${r.windFetched} cells got ERA5 wind`);
      if (r.countriesAdded.length) console.log(`Offer countries given a point (${r.countriesAdded.length}):\n  ${r.countriesAdded.join('\n  ')}`);
      console.log(`${r.regions} regions -> ${dry ? `${r.regions - r.regionsDeferred.length} rows computed (dry run)` : `${r.regionRowsWritten} rows written`}`);
      if (r.regionsDeferred.length) console.log(`Regions deferred to next run: ${r.regionsDeferred.join(', ')}`);
      if (r.failed.length) console.log(`Failed fetches (${r.failed.length}):\n  ${r.failed.join('\n  ')}`);
      if (r.stoppedBy) console.log(`Fetching stopped: ${r.stoppedBy}`);
      break;
    }

    case 'wind-climate': {
      // ERA5 monthly means 2016-2025 -> typical 10 m wind per calendar month (one bundle, 12
      // leaflet-velocity pairs, + .gz) for the map's month animation (wind-climate GitHub
      // Action, on demand + yearly). Needs CDSAPI_KEY / CDS_API_KEY.
      const { runWindClimate } = await import('./pipeline/wind-climate.js');
      const { normalizeToken } = await import('./pipeline/copernicus.js');
      const raw = process.env.CDSAPI_KEY || process.env.CDS_API_KEY;
      const r = await runWindClimate({ out: flagStr('--out') ?? 'out/wind/wind-climate.json', token: raw ? normalizeToken(raw).token : undefined });
      console.log(`ERA5 monthly wind climatology ${r.period} -> ${r.out} ${r.bytes} B, .gz ${r.gzBytes} B`);
      break;
    }
    case 'gfs-wind': {
      // NOAA GFS 10 m u/v -> leaflet-velocity JSON (+ .gz) for the animated map wind layer
      // (gfs-wind GitHub Action, every 6 h). --newer-than <refTime ISO> = the published
      // file's run: nothing newer -> nothing written, exit 0 (keep the published file), but
      // exit 1 once the published run is older than 18 h so the Action goes red.
      const { runGfsWind } = await import('./pipeline/gfs-wind.js');
      const res = (flagStr('--res') ?? '1p00') as '1p00' | '0p50' | '0p25';
      const prev = flagStr('--newer-than');
      const newerThan = prev && !Number.isNaN(Date.parse(prev)) ? new Date(prev) : null;
      const r = await runGfsWind({ out: flagStr('--out') ?? 'out/wind/gfs-10m-latest.json', res, newerThan });
      for (const t of r.tried) console.log(`  ${t}`);
      if (r.skipped) {
        console.log(r.skipped);
        if (!newerThan || Date.now() - newerThan.getTime() > 18 * 3_600_000) process.exitCode = 1;
      } else {
        console.log(`GFS ${r.refTime} +${r.forecastTime}h (valid ${r.validTime}) via ${r.source} -> ${r.out} ${r.bytes} B, .gz ${r.gzBytes} B`);
      }
      break;
    }

    case 'qs': {
      // QS inbox (src/pipeline/qs-inbox.ts, policy docs/qs-inbox.md): open cases + reversible actions.
      const qs = await import('./pipeline/qs-inbox.js');
      const reason = flagStr('--reason');
      const change = flagStr('--change');
      const needReason = (): string => {
        if (!reason) { console.error('--reason "<why>" is required for every QS action'); process.exit(1); }
        return reason;
      };
      const type = args[1] === 'cruise' || args[1] === 'package' ? args[1] : null;
      if (args[0] === 'inbox') {
        const cases = await qs.collectCases();
        console.log(args.includes('--json') ? JSON.stringify(cases, null, 2) : qs.renderCases(cases));
      } else if ((args[0] === 'hide' || args[0] === 'unhide') && type && args[2]) {
        await qs.setActive(type, args[2], args[0] === 'unhide', needReason(), change, args.includes('--aaron-ok'));
      } else if (args[0] === 'resolve' && args[1] && ['approve', 'dismiss', 'apply-rerun', 'revert'].includes(args[2])) {
        await qs.resolveChange(args[1], args[2] as 'approve' | 'dismiss' | 'apply-rerun' | 'revert', needReason(),
          flagStr('--fields')?.split(',').map(f => f.trim()).filter(Boolean));
      } else if (args[0] === 'move' && args[1] && args[2]?.startsWith('http')) {
        await qs.switchSource(args[1], args[2], needReason(), change);
      } else if (args[0] === 'ack' && args[1]) {
        qs.ack(args[1], flagValue('--days', 30), needReason());
      } else if (args[0] === 'log') {
        await qs.showLog(flagValue('--days', 1));
      } else {
        console.error([
          'Usage: pnpm cli qs inbox [--json]',
          '       pnpm cli qs hide|unhide cruise|package <id> --reason ".." [--change <change-id>] [--aaron-ok]',
          '       pnpm cli qs resolve <change-id> approve|dismiss|apply-rerun|revert --reason ".." [--fields dates,price_pp_cabin]',
          '       pnpm cli qs move <cruise-offer-id> <url> --reason ".." [--change <change-id>]',
          '       pnpm cli qs ack <case-id> --days N --reason ".."',
          '       pnpm cli qs log [--days N]',
        ].join('\n'));
        process.exit(1);
      }
      break;
    }

    case 'restore': {
      const domains = args.filter(a => !a.startsWith('-'));
      if (domains.length === 0) {
        console.error('Usage: pnpm cli restore <domain> [domain2 ...]');
        process.exit(1);
      }
      // Normalise: strip https://, www., trailing slashes
      const normalised = domains.map(d =>
        d.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').toLowerCase(),
      );
      const { data, error } = await supabase
        .from('providers')
        .update({ status: 'new', verified_at: null })
        .in('root_domain', normalised)
        .select('root_domain, name');
      if (error) { console.error('DB error:', error); process.exit(1); }
      if (!data || data.length === 0) {
        console.log('No matching providers found for:', normalised.join(', '));
      } else {
        for (const p of data) console.log(`  Restored: ${p.root_domain} (${p.name ?? 'unnamed'})`);
      }
      break;
    }

    default:
      console.log('KiteScout Provider Discovery Pipeline');
      console.log('');
      console.log('Usage: pnpm cli <command> [n]');
      console.log('');
      console.log('Commands:');
      console.log('  seed                      Generate and insert all seed queries into the DB');
      console.log('  search [n]                Run pending Tavily searches (batch n, default 50)');
      console.log('  extract [n]               Extract providers from raw URLs (batch n, default 30)');
      console.log('  dedupe                    Identify and mark cross-domain duplicate providers');
      console.log('  status                    Show pipeline stats');
      console.log('  geo-verify [--offer ids]  Verify pilot camps against operator pages, write publishing/manifest');
      console.log('  reextract [n]             Re-extract providers missing location data (batch n, default 20)');
      console.log('  blocklist-candidates [n]  Show top n most-rejected domains (default 50)');
      console.log('  verify [n]                Re-verify all providers + fill contact gaps (batch n, default 20)');
      console.log('  cruise-locations          Extract validated cruise-only locations for all cruise providers');
      console.log('  cruise-offers             Extract structured cruise offers (+ curated images) for all cruise providers');
      console.log('  cruise-diff               Review: show what a fresh extraction WOULD change vs the DB (no writes); --domain to scope');
      console.log('  images-thumbs             Backfill gallery thumbnails (thumb_path) for stored images (--dry-run --limit n --table cruise|package)');
      console.log('  cruise-reviews            Match bstoked/TripAdvisor review links (domain-corroborated; --all to re-check)');
      console.log('  region-conditions         Build per-country water/wind conditions consensus from extracted offers');
      console.log('  data-fixes plan|apply      Audit 2026-10-27 data fixes: plan [--out f.json] prints the diff (no writes), apply --from f.json writes it');
  console.log('  spot-conditions           Per-spot water/wind/level for stays+camps (clusters offer locations; --dry-run --out f.json, then --from f.json)');
      console.log('  monitor [n]               Detect changes on cruise provider sites (flags: --loop --all --baseline-only --interval-days <d>)');
      console.log('  changes [n]               Show recent detected provider changes (default 20; --unseen for new only)');
  console.log('  restore <domain> [...]    Restore wrongly-rejected providers back to status=new');
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
