// ---------------------------------------------------------------------------
// Exit code of an offers ingest run (the daily "Refresh offer slots" cron step).
// One-off failures rotate from day to day (timeouts, "fetch failed", a single
// 5xx / 404) and recover on their own; a real break (new layout, retired page)
// fails every run. So the run turns red only for an adapter whose previous
// recorded run (offer_sources.history) failed too, or is unknown. A first
// failure after an ok run is listed in the log and the step summary, exit 0.
// Blocked hosts never turn the run red: they need the provider, not a code fix.
// ---------------------------------------------------------------------------
import type { AdapterReport } from './ingest.js';

type Report = Pick<AdapterReport, 'key' | 'status' | 'error' | 'prevFailed'>;

export interface RunVerdict<R extends Report = Report> {
  exitCode: 0 | 1;
  /** failed now and on the previous recorded run, or no previous run is known: these turn the run red */
  repeated: R[];
  /** failed now after an ok previous run: listed, exit 0; red if the same adapter fails again next run */
  first: R[];
  blocked: R[];
}

export function runVerdict<R extends Report>(reports: R[]): RunVerdict<R> {
  const failed = reports.filter(r => r.status === 'error');
  const repeated = failed.filter(r => r.prevFailed !== false);
  return {
    exitCode: repeated.length > 0 ? 1 : 0,
    repeated,
    first: failed.filter(r => r.prevFailed === false),
    blocked: reports.filter(r => r.status === 'blocked'),
  };
}

/** offer_sources.history is newest first; an entry with `error` was a failed or a blocked run. */
export function prevFailedFrom(history: unknown): boolean | undefined {
  const last = Array.isArray(history) ? (history[0] as { error?: unknown } | undefined) : undefined;
  return last ? Boolean(last.error) : undefined;
}

export function previousRun(r: Pick<Report, 'prevFailed'>): string {
  return r.prevFailed === true ? 'failed too' : r.prevFailed === false ? 'ok' : 'unknown';
}

export function countLine(reports: Report[]): string {
  const bad = reports.filter(r => r.status === 'error').length;
  const blocked = reports.filter(r => r.status === 'blocked').length;
  return `${reports.length - bad - blocked}/${reports.length} ok${blocked ? `, ${blocked} blocked by host` : ''}${bad ? `, ${bad} failed` : ''}`;
}

/** One line for the log: why the run is red or stays green. */
export function verdictLine(v: RunVerdict): string {
  if (v.repeated.length > 0) {
    return `exit 1: ${v.repeated.length} adapter(s) failed on their previous run too (or it is unknown): ${v.repeated.map(r => r.key).join(', ')}`;
  }
  if (v.first.length > 0) return `exit 0: ${v.first.length} first failure(s) after an ok run; red if the same adapter fails again next run`;
  return 'exit 0: no adapter failed';
}

const cell = (s: string) => s.replace(/\s+/g, ' ').replace(/\|/g, '\\|').slice(0, 300);

/** GitHub step summary: every failure and every block, also when the run stays green. */
export function runSummaryMarkdown(reports: Report[]): string {
  const v = runVerdict(reports);
  const lines = ['## Offer slots', '', `**${countLine(reports)}**`, '', verdictLine(v), ''];
  const listed = [...v.repeated, ...v.first, ...v.blocked];
  if (listed.length > 0) {
    lines.push('| Adapter | Status | Previous run | Error |', '| --- | --- | --- | --- |');
    for (const r of listed) {
      const status = r.status === 'blocked' ? 'blocked' : v.repeated.includes(r) ? '**error (red)**' : 'error';
      lines.push(`| ${cell(r.key)} | ${status} | ${previousRun(r)} | ${cell(r.error ?? '')} |`);
    }
  }
  return lines.join('\n') + '\n';
}
