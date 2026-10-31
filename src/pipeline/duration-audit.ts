// READ-ONLY audit (Aaron 2026-10-31): which cruises in the app view have a duration_days that the stored data
// contradicts under the nights + 1 rule. Writes nothing; prints a markdown table (or --out <file>).
import { writeFileSync } from 'node:fs';
import { supabase } from '../lib/supabase.js';
import { proposeTripDuration } from './trip-duration.js';

interface AuditRow {
  id: string; title: string; duration_days: number | null; dates: unknown; summary: string | null; price_basis_note: string | null;
  pricing: { raw?: string | null } | null; source_text: string | null;
}

export async function runDurationAudit(opts: { days?: number; out?: string } = {}): Promise<{ rows: number; proposals: Record<string, number> }> {
  const { data: view, error: viewError } = await supabase.from('app_cruise_offer_cards').select('offer_id');
  if (viewError) throw new Error(`app_cruise_offer_cards: ${viewError.message}`);
  const visible = new Set((view ?? []).map(r => r.offer_id as string));
  let query = supabase.from('cruise_offers').select('id, title, duration_days, dates, summary, price_basis_note, pricing, source_text');
  query = opts.days === undefined ? query : query.eq('duration_days', opts.days);
  const { data, error } = await query;
  if (error) throw new Error(`cruise_offers: ${error.message}`);
  const rows = ((data ?? []) as AuditRow[]).filter(r => visible.has(r.id)).sort((a, b) => a.title.localeCompare(b.title));
  const proposals: Record<string, number> = {};
  const lines = ['| offer_id | Titel | duration_days | Vorschlag | Basis | Beleg |', '|---|---|---|---|---|---|'];
  for (const r of rows) {
    const p = proposeTripDuration({ durationDays: r.duration_days, dates: r.dates,
      texts: [r.title, r.summary, r.price_basis_note, r.pricing?.raw ?? null, r.source_text] });
    const verdict = p.days === null ? 'unclear' : p.days === r.duration_days ? 'keep' : String(p.days);
    proposals[verdict] = (proposals[verdict] ?? 0) + 1;
    lines.push(`| ${r.id} | ${r.title.replace(/\|/g, '/')} | ${r.duration_days ?? '-'} | ${verdict} | ${p.basis} | ${p.note} |`);
  }
  const table = lines.join('\n') + '\n';
  if (opts.out) writeFileSync(opts.out, table); else process.stdout.write(table);
  return { rows: rows.length, proposals };
}
