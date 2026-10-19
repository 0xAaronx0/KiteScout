// ---------------------------------------------------------------------------
// Polite fetch layer for offer adapters (ported from kiezkind src/sources/http.ts):
//   - honest User-Agent with contact (never a spoofed browser UA)
//   - robots.txt checked before every request (24 h cache, 1 h on fetch errors)
//   - per-host throttle (min 1.5 s between requests)
//   - retry with backoff on 429 / 5xx, size cap, timeout
//   - fixture mode: OFFERS_FIXTURE_DIR replays saved responses (tests),
//     OFFERS_RECORD_DIR saves every response (building an adapter)
// ---------------------------------------------------------------------------
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const OFFERS_USER_AGENT =
  process.env.OFFERS_USER_AGENT ??
  'KiteScoutBot/0.1 (+https://kitescout.tech; kite travel catalog)';

const MIN_INTERVAL_MS = 1500;
const MAX_CHARS = 5_000_000;
const ROBOTS_TTL_MS = 24 * 3600_000;
const ROBOTS_ERROR_TTL_MS = 3600_000;

export class RobotsDisallowed extends Error {
  constructor(url: string) { super(`robots.txt disallows ${url}`); }
}
export class HttpStatusError extends Error {
  constructor(public readonly status: number, url: string) { super(`HTTP ${status} for ${url}`); }
}
/** The host refused us on purpose (403, captcha / bot challenge). Never bypass: ask the provider. */
export class BlockedByHost extends Error {
  constructor(public readonly reason: string, url: string) { super(`blocked by host (${reason}): ${url}`); }
}

const CHALLENGE_RE = /sgcaptcha|captcha|cf-chl|just a moment|challenge-platform|access denied|are you a (human|robot)/i;
function challengeReason(res: Response, body: string): string | null {
  if (res.headers.get('sg-captcha')) return 'SiteGround captcha';
  if (res.headers.get('cf-mitigated')) return 'Cloudflare challenge';
  if (body.length < 2000 && CHALLENGE_RE.test(body)) return res.status === 202 ? 'bot challenge (HTTP 202)' : 'bot challenge page';
  return null;
}

// --- fixtures ---------------------------------------------------------------
function fixtureName(method: string, url: string, body?: string): string {
  const u = new URL(url);
  const tail = (u.pathname + u.search).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80) || '_';
  const h = createHash('sha1').update(`${method} ${url} ${body ?? ''}`).digest('hex').slice(0, 8);
  return `${u.hostname}${tail}.${h}.txt`;
}
function replay(method: string, url: string, body?: string): string | null {
  const dir = process.env.OFFERS_FIXTURE_DIR;
  if (!dir) return null;
  const f = join(dir, fixtureName(method, url, body));
  if (!existsSync(f)) throw new Error(`fixture missing for ${method} ${url} (${f})`);
  return readFileSync(f, 'utf8');
}
function record(method: string, url: string, text: string, body?: string): void {
  const dir = process.env.OFFERS_RECORD_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, fixtureName(method, url, body)), text);
}

// --- robots.txt ---------------------------------------------------------------
interface RobotsGroup { agents: string[]; rules: Array<{ allow: boolean; path: string }> }
const robotsCache = new Map<string, { groups: RobotsGroup[]; until: number }>();

export function parseRobots(txt: string): RobotsGroup[] {
  const groups: RobotsGroup[] = [];
  let cur: RobotsGroup | null = null;
  let lastWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const field = m[1].toLowerCase();
    const value = m[2].trim();
    if (field === 'user-agent') {
      if (!cur || !lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((field === 'allow' || field === 'disallow') && cur) {
      if (value !== '') cur.rules.push({ allow: field === 'allow', path: value });
      lastWasAgent = false;
    } else {
      lastWasAgent = false;
    }
  }
  return groups;
}

function ruleMatches(rulePath: string, path: string): boolean {
  const anchored = rulePath.endsWith('$');
  const body = anchored ? rulePath.slice(0, -1) : rulePath;
  const re = new RegExp('^' + body.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + (anchored ? '$' : ''));
  return re.test(path);
}

/** Longest match wins, Allow wins ties; our product token beats `*` (groups with the same agent are merged). */
export function robotsAllows(groups: RobotsGroup[], path: string, token = 'kitescoutbot'): boolean {
  const own = groups.filter(g => g.agents.some(a => a !== '*' && token.startsWith(a)));
  const pick = own.length > 0 ? own : groups.filter(g => g.agents.includes('*'));
  let best: { allow: boolean; len: number } | null = null;
  for (const g of pick) {
    for (const r of g.rules) {
      if (!ruleMatches(r.path, path)) continue;
      const len = r.path.length;
      if (!best || len > best.len || (len === best.len && r.allow)) best = { allow: r.allow, len };
    }
  }
  return best ? best.allow : true;
}

async function robotsFor(origin: string): Promise<RobotsGroup[]> {
  const hit = robotsCache.get(origin);
  if (hit && hit.until > Date.now()) return hit.groups;
  let groups: RobotsGroup[] = [];
  let ttl = ROBOTS_TTL_MS;
  try {
    const res = await throttled(origin, () =>
      fetch(`${origin}/robots.txt`, { headers: { 'User-Agent': OFFERS_USER_AGENT }, signal: AbortSignal.timeout(15000) }));
    if (res.ok) groups = parseRobots(await res.text());
    else if (res.status >= 500 || res.status === 429) ttl = ROBOTS_ERROR_TTL_MS; // 4xx = no robots = allow all
  } catch {
    ttl = ROBOTS_ERROR_TTL_MS;
  }
  robotsCache.set(origin, { groups, until: Date.now() + ttl });
  return groups;
}

/** robots.txt verdict for one URL and our bot token (same cache as fetchText); used by lib/images downloads */
export async function robotsAllowsUrl(url: string): Promise<boolean> {
  const u = new URL(url);
  return robotsAllows(await robotsFor(u.origin), u.pathname + u.search);
}

// --- throttle -------------------------------------------------------------------
const hostChain = new Map<string, Promise<unknown>>();
const hostLast = new Map<string, number>();
function throttled<T>(origin: string, fn: () => Promise<T>): Promise<T> {
  const prev = hostChain.get(origin) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(async () => {
    const wait = (hostLast.get(origin) ?? 0) + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    try { return await fn(); } finally { hostLast.set(origin, Date.now()); }
  });
  hostChain.set(origin, next);
  return next;
}

// --- request counting -------------------------------------------------------------
// Global per host, plus per adapter run: the ingest wraps each adapter in
// countRequests() so parallel workers do not count each other's requests.
const requestCount = new Map<string, number>();
const runCounter = new AsyncLocalStorage<{ n: number }>();
export function requestsSoFar(host?: string): number {
  if (host) return requestCount.get(host) ?? 0;
  let n = 0; for (const v of requestCount.values()) n += v; return n;
}
export function resetRequestCount(): void { requestCount.clear(); }
export async function countRequests<T>(fn: () => Promise<T>): Promise<{ result: T; requests: number }> {
  const box = { n: 0 };
  const result = await runCounter.run(box, fn);
  return { result, requests: box.n };
}

// --- public API -----------------------------------------------------------------
export interface FetchOpts {
  method?: 'GET' | 'POST';
  body?: string;
  contentType?: string;
  accept?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

/** Fetch text politely. Throws RobotsDisallowed / HttpStatusError; retries 429/5xx twice. */
export async function fetchText(url: string, opts: FetchOpts = {}): Promise<string> {
  const method = opts.method ?? 'GET';
  const replayed = replay(method, url, opts.body);
  if (replayed !== null) return replayed;

  const u = new URL(url);
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error(`not http(s): ${url}`);
  if (!robotsAllows(await robotsFor(u.origin), u.pathname + u.search)) throw new RobotsDisallowed(url);

  const headers: Record<string, string> = {
    ...(opts.headers ?? {}),
    'User-Agent': OFFERS_USER_AGENT,
    // no JSON in the default: some site builders (Duda) answer HTML pages with JSON when it is accepted
    Accept: opts.accept ?? 'text/html,application/xhtml+xml,*/*;q=0.8',
    'Accept-Language': 'en;q=0.9,de;q=0.8',
  };
  if (opts.contentType) headers['Content-Type'] = opts.contentType;

  for (let attempt = 0; ; attempt++) {
    requestCount.set(u.host, (requestCount.get(u.host) ?? 0) + 1);
    const box = runCounter.getStore();
    if (box) box.n++;
    const res = await throttled(u.origin, () => fetch(url, {
      method, headers, body: opts.body, redirect: 'follow',
      signal: AbortSignal.timeout(opts.timeoutMs ?? 30000),
    }));
    if ((res.status === 429 || res.status >= 500) && attempt < 2) {
      const retryAfter = Number(res.headers.get('retry-after'));
      await new Promise(r => setTimeout(r, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 4000 * (attempt + 1)));
      continue;
    }
    if (res.status === 403) throw new BlockedByHost('HTTP 403', url);
    if (!res.ok) throw new HttpStatusError(res.status, url);
    const text = await res.text();
    const challenge = challengeReason(res, text);
    if (challenge) throw new BlockedByHost(challenge, url);
    if (text.length > MAX_CHARS) throw new Error(`response too large (${text.length} chars): ${url}`);
    record(method, url, text, opts.body);
    return text;
  }
}

export async function fetchJson<T = unknown>(url: string, opts: FetchOpts = {}): Promise<T> {
  const text = await fetchText(url, { accept: 'application/json', ...opts });
  return JSON.parse(text) as T;
}
