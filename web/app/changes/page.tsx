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
  details: {
    status?: string;
    surgical?: { note?: string; updates?: Array<{ slug: string; fields: string[] }>; resolved_at?: string };
    applied_at?: string;
  } | null;
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

// Lifecycle of a detected change (stored in details.status):
//   pending      → needs a human call (approve / dismiss / discuss)
//   auto_applied → dates/price surgically written to the DB, no approval needed
//   approved     → queued; the daily cron runs a full re-extraction
//   applied      → full re-extraction done
//   dismissed    → deliberately not applied
const STATUS_META: Record<string, { label: string; color: string }> = {
  pending:      { label: 'Needs review', color: 'bg-amber-100 text-amber-800' },
  auto_applied: { label: 'Auto-applied', color: 'bg-emerald-100 text-emerald-800' },
  approved:     { label: 'Approved — applying', color: 'bg-sky-100 text-sky-800' },
  applied:      { label: 'Applied',      color: 'bg-emerald-50 text-emerald-700' },
  dismissed:    { label: 'Dismissed',    color: 'bg-slate-100 text-slate-500' },
};

function effectiveStatus(c: Change): string {
  return c.details?.status ?? (c.significant ? 'pending' : 'none');
}

function badge(changeType: string) {
  const meta = CHANGE_TYPE_LABELS[changeType] ?? { label: changeType, color: 'bg-slate-100 text-slate-600' };
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${meta.color}`}>
      {meta.label}
    </span>
  );
}

function statusBadge(status: string) {
  const meta = STATUS_META[status] ?? { label: status, color: 'bg-slate-100 text-slate-500' };
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${meta.color}`}>
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

function ActionButtons({ change, adminKey }: { change: Change; adminKey: string | null }) {
  const status = effectiveStatus(change);
  if (!['pending', 'approved', 'dismissed'].includes(status)) return null;

  if (!adminKey) {
    return <p className="text-xs text-slate-400 mt-1">append <code className="bg-slate-100 px-1 rounded">?key=…</code> to enable actions</p>;
  }

  const btn = 'rounded-md px-2.5 py-1 text-xs font-medium border transition-colors';
  return (
    <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
      {status === 'pending' && (
        <>
          <form method="post" action="/api/changes/resolve">
            <input type="hidden" name="id" value={change.id} />
            <input type="hidden" name="action" value="approve" />
            <input type="hidden" name="key" value={adminKey} />
            <button type="submit" className={`${btn} border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100`}>
              ✓ Approve → re-extract
            </button>
          </form>
          <form method="post" action="/api/changes/resolve">
            <input type="hidden" name="id" value={change.id} />
            <input type="hidden" name="action" value="dismiss" />
            <input type="hidden" name="key" value={adminKey} />
            <button type="submit" className={`${btn} border-slate-200 bg-white text-slate-500 hover:bg-slate-50`}>
              ✕ Dismiss
            </button>
          </form>
        </>
      )}
      {(status === 'approved' || status === 'dismissed') && (
        <form method="post" action="/api/changes/resolve">
          <input type="hidden" name="id" value={change.id} />
          <input type="hidden" name="action" value="reopen" />
          <input type="hidden" name="key" value={adminKey} />
          <button type="submit" className={`${btn} border-slate-200 bg-white text-slate-500 hover:bg-slate-50`}>
            ↩ Reopen
          </button>
        </form>
      )}
      {status === 'pending' && (
        <details className="inline-block">
          <summary className={`${btn} border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100 cursor-pointer list-none inline-block`}>
            💬 Discuss
          </summary>
          <div className="absolute z-10 mt-1 max-w-sm rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-600 shadow-lg">
            Paste into a Claude Code session in the KiteScout repo:
            <code className="block mt-1.5 bg-slate-100 rounded p-2 select-all break-all">
              Bespreche cruise_change {change.id} ({change.provider?.root_domain}): „{change.summary.slice(0, 120)}…" — prüfe per cruise-diff, was sich wirklich ändert, und schlag vor, wie wir es übernehmen.
            </code>
          </div>
        </details>
      )}
    </div>
  );
}

function ChangeRow({ change, adminKey, highlight }: { change: Change; adminKey: string | null; highlight: boolean }) {
  const p = Array.isArray(change.provider) ? change.provider[0] : change.provider;
  const providerName = p?.name ?? p?.root_domain ?? '—';
  const providerUrl = p?.website_url ?? (p?.root_domain ? `https://${p.root_domain}` : null);
  const status = effectiveStatus(change);
  const surgical = change.details?.surgical;

  return (
    <tr className={`border-b border-slate-50 ${highlight ? 'bg-amber-50/40' : 'bg-white'}`}>
      <td className="px-4 py-3 font-medium text-slate-900 max-w-[160px] align-top">
        {providerUrl ? (
          <a href={providerUrl} target="_blank" rel="noopener noreferrer" className="hover:text-sky-600 truncate block" title={providerName}>
            {providerName}
          </a>
        ) : (
          <span className="truncate block" title={providerName}>{providerName}</span>
        )}
        <div className="mt-1">{badge(change.change_type)}</div>
      </td>
      <td className="px-4 py-3 text-slate-600 align-top">
        <span className="block">{change.summary}</span>
        {change.url && (
          <a href={change.url} target="_blank" rel="noopener noreferrer" className="text-xs text-sky-500 hover:underline block mt-0.5 truncate max-w-md">
            {change.url}
          </a>
        )}
        {surgical?.note && (
          <p className="text-xs mt-1.5 text-emerald-700 bg-emerald-50 rounded px-2 py-1 inline-block">
            ⚙ {surgical.note}
          </p>
        )}
        <ActionButtons change={change} adminKey={adminKey} />
      </td>
      <td className="px-4 py-3 text-slate-500 whitespace-nowrap text-xs align-top">{fmt(change.detected_at)}</td>
      <td className="px-4 py-3 align-top">{statusBadge(status)}</td>
    </tr>
  );
}

export default async function ChangesPage({
  searchParams,
}: {
  searchParams: Promise<{ key?: string }>;
}) {
  const supabase = getSupabase();
  const { key } = await searchParams;
  // The key is only honoured when it matches the server-side secret — a wrong
  // key renders the page read-only (the API rejects it anyway).
  const adminKey = key && process.env.CHANGES_ADMIN_KEY && key === process.env.CHANGES_ADMIN_KEY ? key : null;

  const [changesRes, statsRes] = await Promise.all([
    supabase
      .from('cruise_changes')
      .select(`
        id, detected_at, change_type, summary, url, significant, seen, details,
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

  const changes = ((changesRes.data ?? []) as unknown as Change[]).filter(c => c.significant);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const watchRows = (statsRes.data ?? []) as Array<{ last_checked_at: string | null; consecutive_failures: number }>;
  const watchStats: WatchStats = {
    total: watchRows.length,
    checked_today: watchRows.filter(r => r.last_checked_at && new Date(r.last_checked_at) >= today).length,
    failures: watchRows.filter(r => r.consecutive_failures > 0).length,
  };

  const pending = changes.filter(c => effectiveStatus(c) === 'pending');
  const autoApplied = changes.filter(c => effectiveStatus(c) === 'auto_applied');
  const rest = changes.filter(c => !['pending', 'auto_applied'].includes(effectiveStatus(c)));

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <a href="/" className="text-2xl">🪁</a>
          <div>
            <h1 className="font-bold text-slate-900 text-lg leading-tight">KiteScout — Cruise Provider Monitor</h1>
            <p className="text-xs text-slate-500">Daily change detection · dates/prices auto-applied · the rest needs your call</p>
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
            <div className={`font-bold ${pending.length > 0 ? 'text-amber-600' : 'text-slate-400'}`}>
              {pending.length}
            </div>
            <div className="text-slate-500 text-xs">need review</div>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        {/* Needs review — the actionable queue */}
        <section className="mb-10">
          <h2 className="text-sm font-semibold text-amber-700 uppercase tracking-wide mb-3">
            Needs review ({pending.length})
          </h2>
          {pending.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-400">
              <p className="font-medium">Nothing waiting on you. 🎉</p>
              <p className="text-sm mt-1">Dates/price changes are applied automatically; anything else lands here.</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-amber-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-xs text-slate-500 uppercase tracking-wide">
                    <th className="text-left px-4 py-3 font-medium">Provider</th>
                    <th className="text-left px-4 py-3 font-medium">Change</th>
                    <th className="text-left px-4 py-3 font-medium">Detected</th>
                    <th className="text-left px-4 py-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {pending.map(c => <ChangeRow key={c.id} change={c} adminKey={adminKey} highlight />)}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* History */}
        <section>
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">
            Handled ({autoApplied.length + rest.length})
          </h2>
          {autoApplied.length + rest.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-400 text-sm">
              No handled changes yet.
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-xs text-slate-500 uppercase tracking-wide">
                    <th className="text-left px-4 py-3 font-medium">Provider</th>
                    <th className="text-left px-4 py-3 font-medium">Change</th>
                    <th className="text-left px-4 py-3 font-medium">Detected</th>
                    <th className="text-left px-4 py-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {[...autoApplied, ...rest].map(c => <ChangeRow key={c.id} change={c} adminKey={adminKey} highlight={false} />)}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* How it works */}
        <section className="mt-10">
          <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wide mb-3">How this works</h2>
          <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100 text-sm">
            <div className="px-4 py-3 flex gap-3 items-start">
              <span className="mt-0.5">⚙️</span>
              <p className="text-slate-600"><span className="font-medium text-slate-900">Dates &amp; price changes are applied automatically</span> — only the volatile offer fields (departures, pricing, season) are updated surgically. Titles, images, spots and manual edits are never touched.</p>
            </div>
            <div className="px-4 py-3 flex gap-3 items-start">
              <span className="mt-0.5">🔎</span>
              <p className="text-slate-600"><span className="font-medium text-slate-900">Everything else waits here</span> — new offers, removed offers and content rewrites need your call: <em>Approve</em> queues a full re-extraction (runs with the next daily monitor cron), <em>Dismiss</em> archives it, <em>Discuss</em> gives you a ready-made prompt for a Claude session.</p>
            </div>
            <div className="px-4 py-3 flex gap-3 items-start">
              <span className="mt-0.5">🔐</span>
              <p className="text-slate-600">The dashboard is public read-only; actions require the admin key (<code className="bg-slate-100 px-1 rounded text-xs">/changes?key=…</code>, server env <code className="bg-slate-100 px-1 rounded text-xs">CHANGES_ADMIN_KEY</code>).</p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
