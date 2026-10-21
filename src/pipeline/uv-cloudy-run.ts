// `pnpm cli climate-uv-cloudy [--wait-min N]` - one-off fill of climate_points.uv_cloudy_months
// (CAMS all-sky UV) for the cells of every country and region point that lack it.
// ADS jobs queue for hours (~4 h each, 2026-10-21), so this submits ALL missing box x year jobs
// at once and collects them in later runs (Aaron's choice "alle Jobs auf einmal"). State
// (job ids, box points, partial daily maxima) lives in a JSON file that the workflow keeps in
// the GitHub Actions cache between runs (CAMS_JOBS_FILE). Each run: check jobs -> download the
// finished ones -> store every box whose years are all in -> submit jobs for uncovered cells ->
// optionally keep polling for --wait-min minutes. Rerun until it reports nothing left.
// The country/region rows pick the values up on the next `pnpm cli climate-stats`.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { supabase } from '../lib/supabase.js';
import { findCell } from './climate.js';
import { CAMS_DATASET, CAMS_YEARS, UV_CLOUDY_SOURCE, camsBoxes, camsDailyMax, camsRequest, uvCloudyMonths } from './cams-uv.js';
import { jobResult, jobStatus, normalizeToken, submitJob } from './copernicus.js';

type Cell = { lat10: number; lng10: number; sample_lat: number; sample_lng: number; sources: string; uv_cloudy_months: number[] | null };
interface BoxPoint { key: string; lat: number; lng: number; lat10: number; lng10: number }
interface BoxState { points: BoxPoint[]; area: number[]; leadtimes: number[]; yearsDone: number[]; days: Record<string, [string, number][]> }
interface JobState { box: string; year: number; jobId: string; submitted: string }
interface State { boxes: Record<string, BoxState>; jobs: JobState[] }

const FAILED = new Set(['failed', 'rejected', 'dismissed', 'gone']);

export async function runUvCloudy(opts: { waitMin?: number } = {}) {
  const raw = process.env.ADSAPI_KEY || process.env.CDSAPI_KEY || process.env.CDS_API_KEY;
  if (!raw) throw new Error('climate-uv-cloudy needs CDSAPI_KEY / CDS_API_KEY');
  const token = normalizeToken(raw).token;
  const file = process.env.CAMS_JOBS_FILE || join(homedir(), '.cache', 'kitescout', 'cams-uv-jobs.json');
  const state: State = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { boxes: {}, jobs: [] };
  const save = () => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify(state)); };
  const deadline = Date.now() + (opts.waitMin ?? 0) * 60_000;
  console.log(`state ${file}: ${Object.keys(state.boxes).length} boxes, ${state.jobs.length} jobs`);

  const get = async <T>(table: string, cols: string) => {
    const { data, error } = await supabase.from(table).select(cols).range(0, 9999);
    if (error) throw new Error(`${table}: ${error.message}`);
    return data as T[];
  };
  const cells = (await get<Cell>('climate_points', 'lat10,lng10,sample_lat,sample_lng,sources,uv_cloudy_months'))
    .filter(c => c.sources.startsWith('Copernicus'));
  const pts = [
    ...await get<{ lat: number; lng: number }>('climate_country_points', 'lat,lng'),
    ...await get<{ lat: number; lng: number }>('climate_region_points', 'lat,lng'),
  ];
  const todo = [...new Set(pts.map(p => findCell(cells, p.lat, p.lng)).filter((c): c is Cell => !!c && !c.uv_cloudy_months))];
  const todoKeys = new Set(todo.map(c => `${c.lat10}:${c.lng10}`));
  console.log(`${todo.length} cells still need UV with clouds`);

  const storeBox = async (key: string) => {
    const box = state.boxes[key];
    for (const p of box.points) {
      if (!todoKeys.has(p.key)) continue;
      try {
        const uv = uvCloudyMonths(box.days[p.key] ?? []);
        const { error } = await supabase.from('climate_points').update({ uv_cloudy_months: uv, uv_cloudy_source: UV_CLOUDY_SOURCE })
          .eq('lat10', p.lat10).eq('lng10', p.lng10);
        if (error) throw new Error(error.message);
        todoKeys.delete(p.key);
      } catch (e) { console.log(`  store ${p.key} failed: ${(e as Error).message}`); }
    }
    delete state.boxes[key];
    save();
    console.log(`  box ${key} stored (${box.points.length} points)`);
  };

  const collect = async () => {
    for (const job of [...state.jobs]) {
      const box = state.boxes[job.box];
      if (!box) { state.jobs = state.jobs.filter(j => j !== job); continue; }
      let status: string;
      try { status = await jobStatus('ads', job.jobId, token); } catch (e) { console.log(`  job ${job.jobId}: ${(e as Error).message}`); continue; }
      if (status === 'successful') {
        const started = Date.now();
        let buf: Buffer;
        try { buf = await jobResult('ads', job.jobId, token); } catch (e) { console.log(`  job ${job.jobId} download: ${(e as Error).message}`); continue; }
        const days = await camsDailyMax(buf, box.points, console.log);
        for (const [k, d] of days) (box.days[k] ??= []).push(...d);
        box.yearsDone.push(job.year);
        state.jobs = state.jobs.filter(j => j !== job);
        save();
        console.log(`  job ${job.jobId} box ${job.box} ${job.year}: ${Math.round(buf.length / 1024)} KB (${Math.round((Date.now() - started) / 1000)} s, queued since ${job.submitted})`);
        if (CAMS_YEARS.every(y => box.yearsDone.includes(y))) await storeBox(job.box);
      } else if (FAILED.has(status)) {
        console.log(`  job ${job.jobId} box ${job.box} ${job.year}: ${status} -> box dropped, cells resubmitted`);
        state.jobs = state.jobs.filter(j => j.box !== job.box);
        delete state.boxes[job.box];
        save();
      }
    }
  };

  await collect();

  // submit every year of every box for cells that no box covers yet
  const covered = new Set(Object.values(state.boxes).flatMap(b => b.points.map(p => p.key)));
  const uncovered = todo.filter(c => todoKeys.has(`${c.lat10}:${c.lng10}`) && !covered.has(`${c.lat10}:${c.lng10}`))
    .map(c => ({ key: `${c.lat10}:${c.lng10}`, lat: c.sample_lat, lng: c.sample_lng, lat10: c.lat10, lng10: c.lng10 }));
  const boxes = camsBoxes(uncovered);
  const stamp = new Date().toISOString().slice(0, 16);
  for (const [i, b] of boxes.entries()) {
    const key = `${stamp}#${i}`;
    state.boxes[key] = { points: b.points, area: b.area, leadtimes: b.leadtimes, yearsDone: [], days: {} };
    for (const year of CAMS_YEARS) {
      try {
        const jobId = await submitJob('ads', CAMS_DATASET, camsRequest(b, year), token);
        state.jobs.push({ box: key, year, jobId, submitted: new Date().toISOString() });
        console.log(`  submitted ${jobId}: box ${key} ${year} [${b.area}] ${b.points.length} points`);
      } catch (e) { console.log(`  submit box ${key} ${year} failed: ${(e as Error).message}`); }
    }
    if (!state.jobs.some(j => j.box === key)) delete state.boxes[key];
    save();
  }

  while (state.jobs.length && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 5 * 60_000));
    await collect();
  }
  console.log(`done for now: ${todoKeys.size} cells still missing, ${state.jobs.length} ADS jobs pending (${[...new Set(state.jobs.map(j => j.box))].length} boxes)`);
}
