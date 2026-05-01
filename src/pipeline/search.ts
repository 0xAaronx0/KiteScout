import pLimit from 'p-limit';
import { supabase } from '../lib/supabase.js';
import { search } from '../lib/tavily.js';
import { withRetry } from '../lib/retry.js';
import { BLOCKED_DOMAINS } from '../config.js';

const CONCURRENCY = 3;

export async function runSearch(batchSize = 50): Promise<{ ran: number; remaining: number }> {
  const { data: queries, error } = await supabase
    .from('discovery_queries')
    .select('id, query, language')
    .is('executed_at', null)
    .order('created_at')
    .limit(batchSize);

  if (error) throw error;
  if (!queries || queries.length === 0) return { ran: 0, remaining: 0 };

  console.log(`Running ${queries.length} queries (concurrency ${CONCURRENCY})…`);

  const limit = pLimit(CONCURRENCY);
  let done = 0;

  await Promise.all(
    queries.map(q =>
      limit(async () => {
        try {
          const results = await withRetry(() => search(q.query, 20, BLOCKED_DOMAINS));

          await supabase
            .from('discovery_queries')
            .update({ executed_at: new Date().toISOString(), num_results: results.length })
            .eq('id', q.id);

          if (results.length > 0) {
            await supabase.from('raw_search_results').upsert(
              results.map(r => ({
                query_id: q.id,
                url: r.url,
                title: r.title,
                snippet: r.content,
              })),
              { onConflict: 'query_id,url', ignoreDuplicates: true },
            );
          }
        } catch (err) {
          console.error(`\n  Error on "${q.query}":`, err);
          // Mark as executed with 0 results so we don't retry forever
          await supabase
            .from('discovery_queries')
            .update({ executed_at: new Date().toISOString(), num_results: 0 })
            .eq('id', q.id);
        }

        done++;
        process.stdout.write(`\r  ${done}/${queries.length} done`);
      }),
    ),
  );

  console.log();

  const { count: remaining } = await supabase
    .from('discovery_queries')
    .select('*', { count: 'exact', head: true })
    .is('executed_at', null);

  return { ran: queries.length, remaining: remaining ?? 0 };
}
