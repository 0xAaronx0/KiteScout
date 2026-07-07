import 'dotenv/config';
import { appendFileSync } from 'node:fs';
import { seedQueries } from './pipeline/seed-queries.js';
import { runSearch } from './pipeline/search.js';
import { runExtract } from './pipeline/extract.js';
import { runReextract } from './pipeline/reextract.js';
import { runDedupe } from './pipeline/dedupe.js';
import { generateMap } from './pipeline/map.js';
import { runVerify } from './pipeline/verify.js';
import { runExtractCruiseLocations } from './pipeline/extract-cruise-locations.js';
import { runExtractCruiseOffers, runReviewCruiseOffers } from './pipeline/extract-cruise-offers.js';
import { runExtractCruiseReviews } from './pipeline/extract-cruise-reviews.js';
import { runRegionConditions } from './pipeline/region-conditions.js';
import { runMonitor, showChanges, applyApprovedChanges, type DetectedChange } from './pipeline/monitor.js';
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
  opts: { intervalDays: number; all: boolean; baselineOnly: boolean; loop: boolean },
): Promise<void> {
  const allChanges: DetectedChange[] = [];
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

  console.log(`\nMonitoring complete. ${totalChecked} page(s) checked, ${totalSignificant} significant change(s) detected.`);
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

    case 'cruise-reviews': {
      const { providers, matched } = await runExtractCruiseReviews({
        all: args.includes('--all'),
        domain: flagStr('--domain'),
        limit: positionalLimit(),
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
      });
      break;
    }

    case 'changes': {
      const changesLimit = parseInt((args[0] && !args[0].startsWith('-') ? args[0] : '20'), 10);
      await showChanges(changesLimit, args.includes('--unseen'));
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
