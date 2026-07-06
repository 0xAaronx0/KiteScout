import { getSupabase } from '../../lib/supabase';

// Query Supabase at request time; never prerender at build (no env vars then).
export const dynamic = 'force-dynamic';

interface Change {
  id: string;
  detected_at: string;
  change_type: string;
  summary: string;
  url: string | null;
  significant: boolean;
  seen: boolean;
  provider: {
    name: string | null;
    website_url: string | null;
    root_domain: string | null;
  } | null;
}

interface WatchStats {
  total: number;
  checked_today: number;
  failures: number;
}

const CHANGE_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  new_offer:      { label: 'New offer',      color: 'bg-emerald-100 text-emerald-800' },
  price_change:   { label: 'Price change',   color: 'bg-amber-100 text-amber-800' },
  dates_change:   { label: 'Dates change',   color: 'bg-sky-100 text-sky-800' },
  removed_offer:  { label: 'Removed offer',  color: 'bg-red-100 text-red-800' },
  content_update: { label: 'Content update', color: 'bg-slate-100 text-slate-700' },
  none:           { label: 'No change',      color: 'bg-slate-50 text-slate-400' },
};

function badge(changeType: string) {
  const meta = CHANGE_TYPE_LABELS[changeType] ?? { label: changeType, color: 'bg-slate-100 text-slate-600' };
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${meta.color}`}>
      {meta.label}
    </span>
  );
}

function fmt(iso: string) {
  return new Date(iso).toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
    timeZone: 'Europe/Berlin',
  });
}

export default async function ChangesPage() {
  const supabase = getSupabase();

  const [changesRes, statsRes] = await Promise.all([
    supabase
      .from('cruise_changes')
      .select(`
        id, detected_at, change_type, summary, url, significant, seen,
        provider:cruise_providers ( name, website_url, root_domain )
      `)
      .order('detected_at', { ascending: false })
      .limit(100),

    supabase
      .from('cruise_watch')
      .select('last_checked_at, consecutive_failures'),
  ]);

  // Surface query failures in the server log so a real outage isn't silently
  // rendered as an empty "no changes yet" state. (Stats assume < ~1000 watch
  // rows — PostgREST's default page size; fine for the current provider set.)
  if (changesRes.error) console.error('[/changes] cruise_changes query failed:', changesRes.error.message);
  if (statsRes.error) console.error('[/changes] cruise_watch query failed:', statsRes.error.message);

  const changes = (changesRes.data ?? []) as unknown as Change[];

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const watchRows = (statsRes.data ?? []) as Array<{ last_checked_at: string | null; consecutive_failures: number }>;
  const watchStats: WatchStats = {
    total: watchRows.length,
    checked_today: watchRows.filter(r => r.last_checked_at && new Date(r.last_checked_at) >= today).length,
    failures: watchRows.filter(r => r.consecutive_failures > 0).length,
  };

  const significant = changes.filter(c => c.significant);
  const unseen = significant.filter(c => !c.seen);

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <a href="/" className="text-2xl">🪁</a>
          <div>
            <h1 className="font-bold text-slate-900 text-lg leading-tight">KiteScout — Cruise Provider Monitor</h1>
            <p className="text-xs text-slate-500">Daily change detection across cruise provider websites</p>
          </div>
        </div>
        <div className="flex gap-4 text-sm">
          <div className="text-center">
            <div className="font-bold text-slate-900">{watchStats.total}</div>
            <div className="text-slate-500 text-xs">pages watched</div>
          </div>
          <div className="text-center">
            <div className="font-bold text-emerald-600">{watchStats.checked_today}</div>
            <div className="text-slate-500 text-xs">checked today</div>
          </div>
          <div className="text-center">
            <div className={`font-bold ${watchStats.failures > 0 ? 'text-red-600' : 'text-slate-400'}`}>
              {watchStats.failures}
            </div>
            <div className="text-slate-500 text-xs">failing</div>
          </div>
          <div className="text-center">
            <div className={`font-bold ${unseen.length > 0 ? 'text-amber-600' : 'text-slate-400'}`}>
              {unseen.length}
            </div>
            <div className="text-slate-500 text-xs">unseen</div>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        {/* Summary row */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="text-2xl font-bold text-slate-900">{changes.length}</div>
            <div className="text-sm text-slate-500 mt-0.5">total changes logged</div>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="text-2xl font-bold text-emerald-700">{significant.length}</div>
            <div className="text-sm text-slate-500 mt-0.5">significant changes</div>
          </div>
          <div className="bg-white rounded-xl border border-amber-200 p-4">
            <div className="text-2xl font-bold text-amber-700">{unseen.length}</div>
            <div className="text-sm text-slate-500 mt-0.5">unseen / new</div>
          </div>
        </div>

        {changes.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-400">
            <div className="text-4xl mb-3">🔍</div>
            <p className="font-medium">No changes detected yet.</p>
            <p className="text-sm mt-1">Run <code className="bg-slate-100 px-1 rounded">pnpm cli monitor --all --loop</code> to do a first sweep.</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-xs text-slate-500 uppercase tracking-wide">
                  <th className="text-left px-4 py-3 font-medium">Provider</th>
                  <th className="text-left px-4 py-3 font-medium">Type</th>
                  <th className="text-left px-4 py-3 font-medium">Summary</th>
                  <th className="text-left px-4 py-3 font-medium">Detected</th>
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {changes.map((c, i) => {
                  const p = Array.isArray(c.provider) ? c.provider[0] : c.provider;
                  const providerName = p?.name ?? p?.root_domain ?? '—';
                  const providerUrl = p?.website_url ?? (p?.root_domain ? `https://${p.root_domain}` : null);

                  return (
                    <tr
                      key={c.id}
                      className={`border-b border-slate-50 ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'} ${!c.seen && c.significant ? 'ring-inset ring-1 ring-amber-200' : ''}`}
                    >
                      <td className="px-4 py-3 font-medium text-slate-900 max-w-[160px]">
                        {providerUrl ? (
                          <a
                            href={providerUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:text-sky-600 truncate block"
                            title={providerName}
                          >
                            {providerName}
                          </a>
                        ) : (
                          <span className="truncate block" title={providerName}>{providerName}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {badge(c.change_type)}
                      </td>
                      <td className="px-4 py-3 text-slate-600 max-w-xs">
                        <span className="line-clamp-2">{c.summary}</span>
                        {c.url && (
                          <a
                            href={c.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-sky-500 hover:underline block mt-0.5 truncate"
                          >
                            {c.url}
                          </a>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-500 whitespace-nowrap text-xs">
                        {fmt(c.detected_at)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {!c.seen && c.significant ? (
                          <span className="inline-block rounded-full px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-700">New</span>
                        ) : (
                          <span className="text-xs text-slate-300">seen</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Activation checklist */}
        <section className="mt-10">
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">Activation checklist</h2>
          <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100 text-sm">
            <div className="px-4 py-3 flex gap-3 items-start">
              <span className="text-slate-400 font-mono mt-0.5">1.</span>
              <div>
                <p className="font-medium text-slate-900">Run monitoring migration</p>
                <p className="text-slate-500 mt-0.5">Execute <code className="bg-slate-100 px-1 rounded text-xs">supabase/migrations/20260614000000_create_cruise_monitoring.sql</code> in your Supabase SQL editor to create the <code className="bg-slate-100 px-1 rounded text-xs">cruise_watch</code> and <code className="bg-slate-100 px-1 rounded text-xs">cruise_changes</code> tables.</p>
              </div>
            </div>
            <div className="px-4 py-3 flex gap-3 items-start">
              <span className="text-slate-400 font-mono mt-0.5">2.</span>
              <div>
                <p className="font-medium text-slate-900">Seed baseline snapshots</p>
                <p className="text-slate-500 mt-0.5">Run <code className="bg-slate-100 px-1 rounded text-xs">pnpm cli monitor --baseline-only --loop</code> once. This visits every cruise provider page, records the current content hash, and sets up watch rows — so the first real run only flags genuine changes.</p>
              </div>
            </div>
            <div className="px-4 py-3 flex gap-3 items-start">
              <span className="text-slate-400 font-mono mt-0.5">3.</span>
              <div>
                <p className="font-medium text-slate-900">Add GitHub repository secrets</p>
                <p className="text-slate-500 mt-0.5">In your repo → Settings → Secrets → Actions, add: <code className="bg-slate-100 px-1 rounded text-xs">ANTHROPIC_API_KEY</code>, <code className="bg-slate-100 px-1 rounded text-xs">TAVILY_API_KEY</code>, <code className="bg-slate-100 px-1 rounded text-xs">SUPABASE_URL</code>, <code className="bg-slate-100 px-1 rounded text-xs">SUPABASE_SERVICE_ROLE_KEY</code>. The daily cron (<code className="bg-slate-100 px-1 rounded text-xs">.github/workflows/monitor.yml</code>) runs automatically after that.</p>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
