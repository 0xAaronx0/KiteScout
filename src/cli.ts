import 'dotenv/config';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { seedQueries } from './pipeline/seed-queries.js';
import { runSearch } from './pipeline/search.js';
import { runExtract } from './pipeline/extract.js';
import { runReextract } from './pipeline/reextract.js';
import { runDedupe } from './pipeline/dedupe.js';
import { generateMap } from './pipeline/map.js';
import { runVerify } from './pipeline/verify.js';
import { runExtractCruiseLocations } from './pipeline/extract-cruise-locations.js';
import { runExtractCruiseOffers, runReviewCruiseOffers } from './pipeline/extract-cruise-offers.js';
import { runExtractCruiseReviews, recomputeAllAvgRatings } from './pipeline/extract-cruise-reviews.js';
import { runCollectMediaCandidates, runApplySelectedMedia } from './pipeline/media-candidates.js';
import { runRegionConditions } from './pipeline/region-conditions.js';
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

    case 'map':
      await generateMap(args[0] ?? 'map.html');
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

    case 'region-conditions': {
      const { regions } = await runRegionConditions();
      console.log(`Done: conditions built for ${regions} countries.`);
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
      console.log('  reextract [n]             Re-extract providers missing location data (batch n, default 20)');
      console.log('  blocklist-candidates [n]  Show top n most-rejected domains (default 50)');
      console.log('  map [file]                Generate provider map HTML (default: map.html)');
      console.log('  verify [n]                Re-verify all providers + fill contact gaps (batch n, default 20)');
      console.log('  cruise-locations          Extract validated cruise-only locations for all cruise providers');
      console.log('  cruise-offers             Extract structured cruise offers (+ curated images) for all cruise providers');
      console.log('  cruise-diff               Review: show what a fresh extraction WOULD change vs the DB (no writes); --domain to scope');
      console.log('  cruise-reviews            Match bstoked/TripAdvisor review links (domain-corroborated; --all to re-check)');
      console.log('  region-conditions         Build per-country water/wind conditions consensus from extracted offers');
      console.log('  monitor [n]               Detect changes on cruise provider sites (flags: --loop --all --baseline-only --interval-days <d>)');
      console.log('  changes [n]               Show recent detected provider changes (default 20; --unseen for new only)');
  console.log('  restore <domain> [...]    Restore wrongly-rejected providers back to status=new');
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
