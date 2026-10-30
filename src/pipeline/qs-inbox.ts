/**
 * QS inbox: one list of everything the daily monitor and the offer adapters could not decide alone,
 * plus reversible actions to resolve it from the CLI (Aaron 2026-10-30: a scheduled Claude Code run
 * decides these itself and asks only when really unsure; nobody has to open /changes).
 *
 *   pnpm cli qs inbox [--json]                       open cases
 *   pnpm cli qs hide cruise|package <id> --reason ".." [--change <id>]
 *   pnpm cli qs unhide cruise|package <id> --reason ".."
 *   pnpm cli qs resolve <change-id> approve|dismiss|apply-rerun|revert --reason ".."
 *   pnpm cli qs source <cruise-offer-id> <url> --reason ".." [--change <id>]
 *   pnpm cli qs ack <case-id> --days N --reason ".."  known case, keep quiet for N days
 *   pnpm cli qs log [--days N]                       what the inbox and the monitor did
 *
 * Every action appends its before-state to the journal (QS_JOURNAL, default
 * ~/kitescout-backups/qs-journal.jsonl), so each step can be undone. Offers are hidden
 * (is_active=false), never deleted. Policy: docs/qs-inbox.md.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { supabase } from '../lib/supabase.js';
import {
  OPEN_CHANGE_STATUSES, WATCH_FAIL_CHECKS, liveLink, normUrl, recentlyExpired, sourceProblem,
  type SlotHistoryEntry,
} from './qs-rules.js';

export type CaseKind = 'change' | 'source' | 'expired' | 'watch';
export interface QsCase {
  id: string;            // stable: change:<id> | source:<key> | expired:<offer id> | watch:<watch id>
  kind: CaseKind;
  title: string;
  detail: string;
  links: string[];
  data: Record<string, unknown>;
}

// --- journal ---------------------------------------------------------------------------------------

const JOURNAL = process.env.QS_JOURNAL ?? join(homedir(), 'kitescout-backups', 'qs-journal.jsonl');

interface JournalEntry {
  at: string;
  action: string;
  target: string;
  reason: string;
  before?: unknown;
  after?: unknown;
  change_id?: string;
  until?: string;
}

function journal(e: Omit<JournalEntry, 'at'>): void {
  if (!existsSync(dirname(JOURNAL))) mkdirSync(dirname(JOURNAL), { recursive: true });
  appendFileSync(JOURNAL, JSON.stringify({ at: new Date().toISOString(), ...e }) + '\n');
}

function readJournal(): JournalEntry[] {
  if (!existsSync(JOURNAL)) return [];
  return readFileSync(JOURNAL, 'utf8').split('\n').filter(Boolean).flatMap(l => {
    try { return [JSON.parse(l) as JournalEntry]; } catch { return []; }
  });
}

function ackedUntil(now: Date): Map<string, string> {
  const m = new Map<string, string>();
  for (const e of readJournal()) if (e.action === 'ack' && e.until && e.until > now.toISOString()) m.set(e.target, e.until);
  return m;
}

function must<T>(r: { data: T | null; error: { message: string } | null }, what: string): T {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return (r.data ?? ([] as unknown)) as T;
}

// --- collect ---------------------------------------------------------------------------------------

type Details = Record<string, unknown> & { status?: string; kind?: string; offer_id?: string; slug?: string };

export async function collectCases(now = new Date()): Promise<QsCase[]> {
  const today = now.toISOString().slice(0, 10);
  const cases: QsCase[] = [];

  const providers = must(await supabase.from('cruise_providers').select('id, name, root_domain, status'), 'cruise_providers') as
    Array<{ id: string; name: string | null; root_domain: string; status: string | null }>;
  const prov = new Map(providers.map(p => [p.id, p]));
  const offers = must(await supabase.from('cruise_offers')
    .select('id, cruise_provider_id, slug, title, source_url, dates, is_active, is_reseller, duplicate_of'), 'cruise_offers') as
    Array<{ id: string; cruise_provider_id: string; slug: string; title: string; source_url: string | null; dates: unknown; is_active: boolean; is_reseller: boolean | null; duplicate_of: string | null }>;
  const offerById = new Map(offers.map(o => [o.id, o]));
  const offerBySlug = new Map(offers.map(o => [`${o.cruise_provider_id}|${o.slug}`, o]));
  const shown = (o: (typeof offers)[number]) => {
    const st = prov.get(o.cruise_provider_id)?.status;
    return o.is_active && !o.is_reseller && !o.duplicate_of && st !== 'dead' && st !== 'duplicate';
  };

  // 1. change rows waiting for a decision
  const changes = must(await supabase.from('cruise_changes')
    .select('id, cruise_provider_id, url, change_type, summary, details, detected_at')
    .in('details->>status', [...OPEN_CHANGE_STATUSES])
    .order('detected_at', { ascending: true }), 'cruise_changes') as
    Array<{ id: string; cruise_provider_id: string; url: string | null; change_type: string | null; summary: string | null; details: Details; detected_at: string }>;
  const openGoneUrls = new Set<string>();
  for (const c of changes) {
    const d = c.details;
    const p = prov.get(c.cruise_provider_id);
    const removed = ((d.rerun as { review?: { removed?: Array<{ slug: string }> } })?.review?.removed ?? []).map(r => r.slug);
    const slugs = [d.slug as string | undefined, ...removed].filter((s): s is string => !!s);
    const hit = [d.offer_id ? offerById.get(d.offer_id) : undefined, ...slugs.map(s => offerBySlug.get(`${c.cruise_provider_id}|${s}`))]
      .filter((o): o is (typeof offers)[number] => !!o);
    const affected = [...new Map(hit.map(o => [o.id, o])).values()];
    if (d.kind === 'offer_gone' && c.url) openGoneUrls.add(normUrl(c.url));
    const rerun = d.rerun as { updates?: unknown; review?: { changed?: Array<{ fields?: Array<{ field: string; before: unknown; after: unknown }> }> } } | undefined;
    const fields = (rerun?.review?.changed ?? []).flatMap(ch => ch.fields ?? [])
      .filter(f => f.field !== 'dates')
      .map(f => `${f.field}: ${JSON.stringify(f.before)} → ${JSON.stringify(f.after)}`);
    cases.push({
      id: `change:${c.id}`,
      kind: 'change',
      title: `${d.kind ?? c.change_type} · ${p?.name ?? p?.root_domain ?? '?'}`,
      detail: [c.summary ?? '', fields.length ? `Felder: ${fields.join('; ')}` : '',
        affected.length ? `Angebote: ${affected.map(o => `${o.title}${o.is_active ? '' : ' (ausgeblendet)'}`).join(' | ')}` : '']
        .filter(Boolean).join('\n'),
      links: [c.url ?? '', ...affected.map(o => liveLink('cruise_offers', o.id))].filter(Boolean),
      data: {
        change_id: c.id, change_kind: d.kind, status: d.status, detected_at: c.detected_at, url: c.url,
        provider: p?.root_domain, offer_ids: affected.map(o => o.id), has_surgical_rerun: Array.isArray(rerun?.updates),
        name: d.name, dates: d.dates, price: d.price,
      },
    });
  }

  // 2. offer adapters (stays, tours, camps) that stopped delivering
  const sources = must(await supabase.from('offer_sources')
    .select('key, package_offer_id, name, url, active, last_ok_at, last_error, history'), 'offer_sources') as
    Array<{ key: string; package_offer_id: string | null; name: string; url: string; active: boolean; last_ok_at: string | null; last_error: string | null; history: SlotHistoryEntry[] | null }>;
  const pkgIds = [...new Set(sources.map(s => s.package_offer_id).filter((x): x is string => !!x))];
  const pkgs = pkgIds.length
    ? must(await supabase.from('package_offers').select('id, title, is_active').in('id', pkgIds), 'package_offers') as Array<{ id: string; title: string; is_active: boolean }>
    : [];
  const pkgById = new Map(pkgs.map(p => [p.id, p]));
  for (const s of sources) {
    const why = sourceProblem(s, now);
    const pkg = s.package_offer_id ? pkgById.get(s.package_offer_id) : undefined;
    if (!why || (pkg && !pkg.is_active)) continue;
    cases.push({
      id: `source:${s.key}`,
      kind: 'source',
      title: `Adapter · ${s.name}`,
      detail: why,
      links: [s.url, ...(pkg ? [liveLink('package_offers', pkg.id)] : [])],
      data: { key: s.key, package_offer_id: s.package_offer_id, last_ok_at: s.last_ok_at, last_error: s.last_error },
    });
  }

  // 3. shown cruises whose departures all ended recently (next season likely published)
  for (const o of offers) {
    if (!shown(o)) continue;
    const last = recentlyExpired(o.dates, today);
    if (!last) continue;
    cases.push({
      id: `expired:${o.id}`,
      kind: 'expired',
      title: `Termine abgelaufen · ${o.title}`,
      detail: `letzte Abfahrt ${last}, keine künftige gespeichert (${prov.get(o.cruise_provider_id)?.name ?? ''})`,
      links: [o.source_url ?? '', liveLink('cruise_offers', o.id)].filter(Boolean),
      data: { offer_id: o.id, source_url: o.source_url, last_departure: last },
    });
  }

  // 4. watched pages that keep failing without an open change row (homepage down, 5xx, TLS)
  const watches = must(await supabase.from('cruise_watch')
    .select('id, cruise_provider_id, url, consecutive_failures, last_checked_at')
    .gte('consecutive_failures', WATCH_FAIL_CHECKS), 'cruise_watch') as
    Array<{ id: string; cruise_provider_id: string; url: string; consecutive_failures: number; last_checked_at: string | null }>;
  for (const w of watches) {
    const p = prov.get(w.cruise_provider_id);
    if (!p || p.status === 'dead' || p.status === 'duplicate' || openGoneUrls.has(normUrl(w.url))) continue;
    const own = offers.filter(o => o.cruise_provider_id === w.cruise_provider_id && shown(o));
    if (own.length === 0) continue;   // nothing of this provider is shown, nothing can go wrong in the app
    const onPage = own.filter(o => normUrl(o.source_url) === normUrl(w.url));
    cases.push({
      id: `watch:${w.id}`,
      kind: 'watch',
      title: `Seite antwortet nicht · ${p.name ?? p.root_domain}`,
      detail: `${w.url} schlägt seit ${w.consecutive_failures} Checks fehl; ${onPage.length ? `Quellseite von ${onPage.length} Angebot(en)` : `${own.length} sichtbare Angebote des Anbieters`}`,
      links: [w.url, ...(onPage.length ? onPage : own).map(o => liveLink('cruise_offers', o.id))],
      data: { watch_id: w.id, url: w.url, failures: w.consecutive_failures, offer_ids: (onPage.length ? onPage : own).map(o => o.id) },
    });
  }

  const acked = ackedUntil(now);
  return cases.filter(c => !acked.has(c.id));
}

export function renderCases(cases: QsCase[]): string {
  if (cases.length === 0) return 'QS-Inbox: keine offenen Fälle.';
  const order: CaseKind[] = ['change', 'watch', 'source', 'expired'];
  const label: Record<CaseKind, string> = {
    change: 'Monitor-Prüffälle', watch: 'Seiten ohne Antwort', source: 'Adapter', expired: 'Abgelaufene Termine',
  };
  const out: string[] = [`QS-Inbox: ${cases.length} offene Fälle`];
  for (const k of order) {
    const ks = cases.filter(c => c.kind === k);
    if (!ks.length) continue;
    out.push('', `## ${label[k]} (${ks.length})`);
    for (const c of ks) {
      out.push(`- [${c.id}] ${c.title}`);
      for (const l of c.detail.split('\n')) out.push(`    ${l}`);
      for (const l of c.links) out.push(`    ${l}`);
    }
  }
  return out.join('\n');
}

// --- actions ---------------------------------------------------------------------------------------

async function markChange(changeId: string, patch: Record<string, unknown>): Promise<void> {
  const { data, error } = await supabase.from('cruise_changes').select('details').eq('id', changeId).single();
  if (error || !data) throw new Error(`change ${changeId} not found: ${error?.message ?? ''}`);
  const details = { ...(data.details as Details), ...patch, resolved_at: new Date().toISOString() };
  const { error: upErr } = await supabase.from('cruise_changes').update({ details, seen: true }).eq('id', changeId);
  if (upErr) throw new Error(`change ${changeId} update failed: ${upErr.message}`);
}

const TABLE = { cruise: 'cruise_offers', package: 'package_offers' } as const;

export async function setActive(type: 'cruise' | 'package', id: string, active: boolean, reason: string, changeId?: string): Promise<void> {
  const table = TABLE[type];
  const { data, error } = await supabase.from(table).select('id, title, is_active').eq('id', id).single();
  if (error || !data) throw new Error(`${table} ${id} not found: ${error?.message ?? ''}`);
  if (data.is_active === active) {
    console.log(`= ${data.title} is already ${active ? 'shown' : 'hidden'}`);
  } else {
    const { error: upErr } = await supabase.from(table).update({ is_active: active }).eq('id', id);
    if (upErr) throw new Error(`${table} ${id} update failed: ${upErr.message}`);
    journal({ action: active ? 'unhide' : 'hide', target: `${table}:${id}`, reason, before: { is_active: data.is_active, title: data.title }, after: { is_active: active }, change_id: changeId });
    console.log(`✓ ${active ? 'shown' : 'hidden'}: ${data.title} (${liveLink(table, id)})`);
  }
  if (changeId) await markChange(changeId, { status: 'applied', resolved_via: `qs-inbox (${active ? 'unhide' : 'hide'})`, qs_reason: reason });
}

// Mirror of APPLY_FIELDS in web/app/api/changes/resolve/route.ts (surgical re-run apply).
const APPLY_FIELDS = new Set([
  'title', 'country', 'region', 'price_from_eur', 'currency', 'duration_days',
  'season_text', 'vessel_name', 'vessel_type', 'summary', 'booking_modes', 'dates',
  'price_pp_cabin', 'price_pp_cabin_currency', 'price_charter_week', 'price_charter_week_currency',
  'season_start_month', 'season_end_month',
]);

export type ResolveAction = 'approve' | 'dismiss' | 'apply-rerun' | 'revert';

export async function resolveChange(changeId: string, action: ResolveAction, reason: string): Promise<void> {
  const { data: row, error } = await supabase.from('cruise_changes').select('id, cruise_provider_id, details').eq('id', changeId).single();
  if (error || !row) throw new Error(`change ${changeId} not found: ${error?.message ?? ''}`);
  const d = row.details as Details;

  if (action === 'revert') {
    const { revertChange } = await import('./observe.js');
    await revertChange(changeId);
    journal({ action: 'revert', target: `change:${changeId}`, reason, before: (d.applied as unknown) ?? null, change_id: changeId });
    await markChange(changeId, { resolved_via: 'qs-inbox (revert)', qs_reason: reason });
    return;
  }

  if (action === 'apply-rerun') {
    const rerun = d.rerun as { mode?: string; updates?: Array<{ slug: string; set: Record<string, unknown> }> } | undefined;
    if (rerun?.mode !== 'surgical' || !rerun.updates?.length) throw new Error('no surgical re-run preview stored for this change');
    const applied: string[] = [];
    for (const u of rerun.updates) {
      const patch: Record<string, unknown> = {};
      for (const [field, value] of Object.entries(u.set ?? {})) {
        if (!APPLY_FIELDS.has(field)) continue;
        if (value === null || value === '' || (Array.isArray(value) && value.length === 0)) continue;
        patch[field] = value;
      }
      if (!u.slug || Object.keys(patch).length === 0) continue;
      const { data: before, error: bErr } = await supabase.from('cruise_offers').select(['id', ...Object.keys(patch)].join(', '))
        .eq('cruise_provider_id', row.cruise_provider_id).eq('slug', u.slug).single();
      if (bErr || !before) throw new Error(`offer ${u.slug} not found: ${bErr?.message ?? ''}`);
      const { error: upErr } = await supabase.from('cruise_offers').update(patch)
        .eq('cruise_provider_id', row.cruise_provider_id).eq('slug', u.slug);
      if (upErr) throw new Error(`apply failed on "${u.slug}": ${upErr.message}`);
      journal({ action: 'apply-rerun', target: `cruise_offers:${(before as unknown as { id: string }).id}`, reason, before, after: patch, change_id: changeId });
      applied.push(u.slug);
    }
    await markChange(changeId, { status: 'applied', applied_via: 'qs-inbox (surgical re-run apply)', applied_slugs: applied, qs_reason: reason });
    console.log(`✓ applied re-run on ${applied.join(', ') || 'nothing'}`);
    return;
  }

  const status = action === 'approve' ? 'approved' : 'dismissed';
  let before: unknown = { status: d.status };
  if (action === 'approve') {
    // approve = full re-extraction of the provider (rewrites free text, may prune un-curated offers):
    // keep every offer row of the provider so the run can be undone by hand.
    const { data: rows, error: rErr } = await supabase.from('cruise_offers').select('*').eq('cruise_provider_id', row.cruise_provider_id);
    if (rErr) throw new Error(`provider snapshot failed: ${rErr.message}`);
    before = { status: d.status, provider_offers: rows };
  }
  journal({ action, target: `change:${changeId}`, reason, before, after: { status }, change_id: changeId });
  await markChange(changeId, { status, resolved_via: 'qs-inbox', qs_reason: reason });
  console.log(`✓ change ${changeId.slice(0, 8)} → ${status}${action === 'approve' ? ' (the 06:00 UTC cron re-extracts the provider)' : ''}`);
}

/**
 * A cruise offer's page moved: point source_url at the new page (the monitor watches it from the next
 * run on, its LLM read proposes prices/dates through the usual 2-sighting state machine) and read it now.
 */
export async function switchSource(offerId: string, url: string, reason: string, changeId?: string): Promise<void> {
  const { data: o, error } = await supabase.from('cruise_offers').select('id, title, source_url, cruise_provider_id').eq('id', offerId).single();
  if (error || !o) throw new Error(`cruise offer ${offerId} not found: ${error?.message ?? ''}`);
  const { data: p, error: pErr } = await supabase.from('cruise_providers').select('root_domain').eq('id', o.cruise_provider_id).single();
  if (pErr || !p) throw new Error(`provider not found: ${pErr?.message ?? ''}`);
  const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  if (!host.endsWith(String(p.root_domain).replace(/^www\./, ''))) throw new Error(`${url} is not on ${p.root_domain} (original sites only)`);
  const { error: upErr } = await supabase.from('cruise_offers').update({ source_url: url }).eq('id', offerId);
  if (upErr) throw new Error(`source_url update failed: ${upErr.message}`);
  journal({ action: 'source', target: `cruise_offers:${offerId}`, reason, before: { source_url: o.source_url }, after: { source_url: url }, change_id: changeId });
  const { error: wErr } = await supabase.from('cruise_watch')
    .upsert({ cruise_provider_id: o.cruise_provider_id, url: url.replace(/\/$/, '') }, { onConflict: 'cruise_provider_id,url', ignoreDuplicates: true });
  if (wErr) throw new Error(`watch insert failed: ${wErr.message}`);
  console.log(`✓ ${o.title}: source ${o.source_url} → ${url}`);
  if (changeId) await markChange(changeId, { status: 'applied', resolved_via: 'qs-inbox (source moved)', new_source_url: url, qs_reason: reason });
  const { newCtx, observeUrl } = await import('./observe.js');
  const ctx = newCtx({});
  await observeUrl(url, ctx);
  console.log(`  first read: ${ctx.events.length} event(s) (a proposal applies on its 2nd sighting, >= 20 h later)`);
}

export function ack(caseId: string, days: number, reason: string): void {
  const until = new Date(Date.now() + days * 86_400_000).toISOString();
  journal({ action: 'ack', target: caseId, reason, until });
  console.log(`✓ ${caseId} quiet until ${until.slice(0, 10)}`);
}

/** Journal entries plus what the monitor auto-applied, for the run report. */
export async function showLog(days: number): Promise<void> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const entries = readJournal().filter(e => e.at >= since);
  console.log(`QS-Journal seit ${since.slice(0, 10)} (${JOURNAL}): ${entries.length} Einträge`);
  for (const e of entries) {
    console.log(`- ${e.at.slice(0, 16)} ${e.action} ${e.target}${e.until ? ` bis ${e.until.slice(0, 10)}` : ''} · ${e.reason}`);
  }
  const auto = must(await supabase.from('cruise_changes').select('id, summary, detected_at, details')
    .eq('details->>status', 'auto_applied').gte('detected_at', since).order('detected_at', { ascending: true }), 'cruise_changes') as
    Array<{ id: string; summary: string | null; detected_at: string; details: { applied?: { offer_id?: string } } }>;
  console.log(`\nMonitor auto-applied seit ${since.slice(0, 10)}: ${auto.length}`);
  for (const a of auto) {
    const link = a.details.applied?.offer_id ? ` ${liveLink('cruise_offers', a.details.applied.offer_id)}` : '';
    console.log(`- ${a.detected_at.slice(0, 10)} ${a.id.slice(0, 8)} ${(a.summary ?? '').slice(0, 120)}${link}`);
  }
}
