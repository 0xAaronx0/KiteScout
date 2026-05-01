import 'dotenv/config';
import { seedQueries } from './pipeline/seed-queries.js';
import { runSearch } from './pipeline/search.js';
import { runExtract } from './pipeline/extract.js';
import { runReextract } from './pipeline/reextract.js';
import { runDedupe } from './pipeline/dedupe.js';
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
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
