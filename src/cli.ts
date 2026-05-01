import 'dotenv/config';
import { seedQueries } from './pipeline/seed-queries.js';
import { runSearch } from './pipeline/search.js';
import { runExtract } from './pipeline/extract.js';
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

    case 'dedupe':
      await runDedupe();
      break;

    case 'status':
      await status();
      break;

    default:
      console.log('KiteScout Provider Discovery Pipeline');
      console.log('');
      console.log('Usage: pnpm cli <command> [batchSize]');
      console.log('');
      console.log('Commands:');
      console.log('  seed             Generate and insert all seed queries into the DB');
      console.log('  search [n]       Run pending Tavily searches (batch size n, default 50)');
      console.log('  extract [n]      Extract providers from raw URLs (batch size n, default 30)');
      console.log('  dedupe           Identify and mark cross-domain duplicate providers');
      console.log('  status           Show pipeline stats');
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
