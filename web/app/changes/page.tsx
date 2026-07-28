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
    applied_slugs?: string[];
    rerun_requested_at?: string;
    rerun?: {
      at?: string;
      mode?: 'surgical' | 'full' | 'error' | string;
      review?: {
        error?: string;
        unchanged?: number;
        added?: Array<{ title: string; country: string | null; region: string | null; price: number | null; duration: number | null }>;
        removed?: Array<{ title: string }>;
        changed?: Array<{ slug: string; current_slug?: string; title: string; fields: Array<{ field: string; before: unknown; after: unknown }> }>;
      };
      updates?: Array<{ slug: string; set: Record<string, unknown> }>;
    };
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
  pending:       { label: 'Needs review', color: 'bg-amber-100 text-amber-800' },
  rerun_running: { label: 'Re-run läuft…', color: 'bg-violet-100 text-violet-800' },
  rerun_done:    { label: 'Diff bereit',  color: 'bg-sky-100 text-sky-800' },
  auto_applied:  { label: 'Auto-applied', color: 'bg-emerald-100 text-emerald-800' },
  approved:      { label: 'Approved — applying', color: 'bg-sky-100 text-sky-800' },
  applied:       { label: 'Applied',      color: 'bg-emerald-50 text-emerald-700' },
  dismissed:     { label: 'Dismissed',    color: 'bg-slate-100 text-slate-500' },
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

function ActionForm({ action, id, adminKey, className, children, endpoint = '/api/changes/resolve' }: {
  action: string; id: string; adminKey: string; className: string; children: React.ReactNode; endpoint?: string;
}) {
  return (
    <form method="post" action={endpoint}>
      <input type="hidden" name="id" value={id} />
      {action && <input type="hidden" name="action" value={action} />}
      <input type="hidden" name="key" value={adminKey} />
      <button type="submit" className={className}>{children}</button>
    </form>
  );
}

function ActionButtons({ change, adminKey }: { change: Change; adminKey: string | null }) {
  const status = effectiveStatus(change);
  if (!['pending', 'rerun_running', 'rerun_done', 'approved', 'dismissed'].includes(status)) return null;

  if (!adminKey) {
    return <p className="text-xs text-slate-400 mt-1">append <code className="bg-slate-100 px-1 rounded">?key=…</code> to enable actions</p>;
  }

  const btn = 'rounded-md px-2.5 py-1 text-xs font-medium border transition-colors';
  const rerunBtn = `${btn} border-violet-300 bg-violet-50 text-violet-800 hover:bg-violet-100`;
  const dismissBtn = `${btn} border-slate-200 bg-white text-slate-500 hover:bg-slate-50`;
  const rerunMode = change.details?.rerun?.mode;
  // A running re-run without a result for >15 min counts as stuck — offer a retry.
  const requestedAt = change.details?.rerun_requested_at ? Date.parse(change.details.rerun_requested_at) : null;
  const rerunStuck = status === 'rerun_running' && requestedAt !== null && Date.now() - requestedAt > 15 * 60_000;

  return (
    <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
      {status === 'pending' && (
        <>
          <ActionForm action="" id={change.id} adminKey={adminKey} endpoint="/api/changes/rerun" className={rerunBtn}>
            ⟳ Re-run — Diff erzeugen
          </ActionForm>
          <ActionForm action="dismiss" id={change.id} adminKey={adminKey} className={dismissBtn}>✕ Dismiss</ActionForm>
        </>
      )}
      {status === 'rerun_running' && (
        <>
          <span className="text-xs text-violet-700">Re-Extraktion läuft (~2–4 min) — Seite gleich neu laden.</span>
          {rerunStuck && (
            <ActionForm action="" id={change.id} adminKey={adminKey} endpoint="/api/changes/rerun" className={rerunBtn}>
              ⟳ Hängt? Erneut starten
            </ActionForm>
          )}
        </>
      )}
      {status === 'rerun_done' && (
        <>
          {rerunMode === 'surgical' && (
            <ActionForm action="apply-rerun" id={change.id} adminKey={adminKey} className={`${btn} border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100`}>
              ✓ Approve — jetzt anwenden
            </ActionForm>
          )}
          {rerunMode === 'full' && (
            <ActionForm action="approve" id={change.id} adminKey={adminKey} className={`${btn} border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100`}>
              ✓ Approve — volle Re-Extraktion (Nacht-Cron)
            </ActionForm>
          )}
          <ActionForm action="" id={change.id} adminKey={adminKey} endpoint="/api/changes/rerun" className={rerunBtn}>⟳ Re-run erneut</ActionForm>
          <ActionForm action="dismiss" id={change.id} adminKey={adminKey} className={dismissBtn}>✕ Dismiss</ActionForm>
        </>
      )}
      {(status === 'approved' || status === 'dismissed') && (
        <ActionForm action="reopen" id={change.id} adminKey={adminKey} className={dismissBtn}>↩ Reopen</ActionForm>
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

// Truncate long field values for the diff table without hiding the change.
function fmtVal(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > 220 ? s.slice(0, 220) + '…' : s;
}

// Before/after result of a re-run, rendered inline under the change summary.
function RerunDiff({ change }: { change: Change }) {
  const rerun = change.details?.rerun;
  if (!rerun?.review) return null;
  const r = rerun.review;
  const when = rerun.at ? fmt(rerun.at) : '';

  if (r.error) {
    return (
      <div className="mt-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
        Re-run fehlgeschlagen ({when}): {r.error}
      </div>
    );
  }
  const nothing = !r.added?.length && !r.removed?.length && !r.changed?.length;
  return (
    <div className="mt-2 rounded-lg border border-sky-200 bg-sky-50/50 p-3 text-xs space-y-2">
      <p className="text-slate-500">
        Re-run vom {when} · Vergleich frische Extraktion ↔ Live-DB
        {typeof r.unchanged === 'number' ? ` · ${r.unchanged} Offer(s) unverändert` : ''}
        {rerun.mode === 'full' && <span className="text-amber-700"> · enthält neue/entfernte Offers → Approve läuft als volle Re-Extraktion</span>}
      </p>
      {nothing && (
        <p className="text-emerald-700 font-medium">Keine inhaltlichen Unterschiede — die Live-Daten sind aktuell. (Dismiss ist hier die richtige Aktion.)</p>
      )}
      {(r.added?.length ?? 0) > 0 && (
        <div>
          <p className="font-semibold text-emerald-700">+ Neue Offers ({r.added!.length})</p>
          <ul className="ml-4 list-disc text-slate-700">
            {r.added!.map((a, i) => (
              <li key={i}>„{a.title}" · {[a.country, a.region].filter(Boolean).join(' / ') || '?'}{a.price ? ` · ab ${a.price}` : ''}{a.duration ? ` · ${a.duration} Tage` : ''}</li>
            ))}
          </ul>
        </div>
      )}
      {(r.removed?.length ?? 0) > 0 && (
        <div>
          <p className="font-semibold text-red-700">− Nicht mehr gelistet ({r.removed!.length})</p>
          <ul className="ml-4 list-disc text-slate-700">
            {r.removed!.map((x, i) => <li key={i}>„{x.title}"</li>)}
          </ul>
        </div>
      )}
      {(r.changed?.length ?? 0) > 0 && r.changed!.map((c, i) => (
        <div key={i}>
          <p className="font-semibold text-slate-800">~ „{c.title}"</p>
          <table className="mt-1 w-full border-collapse">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-slate-400">
                <th className="pr-2 py-0.5 w-28">Feld</th>
                <th className="pr-2 py-0.5">Vorher (live)</th>
                <th className="py-0.5">Nachher (Re-run)</th>
              </tr>
            </thead>
            <tbody>
              {c.fields.map((f, j) => (
                <tr key={j} className="align-top border-t border-sky-100">
                  <td className="pr-2 py-1 font-medium text-slate-600">
                    {f.field}
                    {f.field === 'spots' && <span className="block text-[10px] text-amber-600">nur per voller Re-Extraktion (Geocoding)</span>}
                  </td>
                  <td className="pr-2 py-1 text-slate-500 break-words">{fmtVal(f.before)}</td>
                  <td className="py-1 text-slate-900 break-words">{fmtVal(f.after)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
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
        <RerunDiff change={change} />
        <ActionButtons change={change} adminKey={adminKey} />
      </td>
      <td className="px-4 py-3 text-slate-500 whitespace-nowrap text-xs align-top">{fmt(change.detected_at)}</td>
      <td className="px-4 py-3 align-top">{statusBadge(status)}</td>
    </tr>
  );
}

const ERROR_BANNERS: Record<string, string> = {
  'no-token': 'Re-run braucht ein GitHub-Token: Fine-grained PAT für 0xAaronx0/KiteScout mit "Actions: read and write" erstellen und als GITHUB_ACTIONS_TOKEN in die Server-Env setzen (VPS-Compose + web/.env.local).',
};

export default async function ChangesPage({
  searchParams,
}: {
  searchParams: Promise<{ key?: string; error?: string }>;
}) {
  const supabase = getSupabase();
  const { key, error: errorParam } = await searchParams;
  const errorBanner = errorParam
    ? (ERROR_BANNERS[errorParam] ?? `Aktion fehlgeschlagen (${errorParam}) — Details im Server-Log.`)
    : null;
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
      .limit(400),

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

  const OPEN_STATUSES = ['pending', 'rerun_running', 'rerun_done'];
  const pending = changes.filter(c => OPEN_STATUSES.includes(effectiveStatus(c)));
  const autoApplied = changes.filter(c => effectiveStatus(c) === 'auto_applied');
  const rest = changes.filter(c => ![...OPEN_STATUSES, 'auto_applied'].includes(effectiveStatus(c)));

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
        {errorBanner && (
          <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            ⚠ {errorBanner}
          </div>
        )}
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
              <p className="text-slate-600"><span className="font-medium text-slate-900">Everything else waits here</span> — <em>Re-run</em> re-extrahiert den Provider als Vorschau (~2–4 min, schreibt nichts) und zeigt den Vorher/Nachher-Diff. Erst dein <em>Approve</em> macht ihn live: Feld-Änderungen sofort, neue/entfernte Offers per voller Re-Extraktion im Nacht-Cron. <em>Dismiss</em> archiviert, <em>Discuss</em> liefert einen Claude-Prompt.</p>
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
