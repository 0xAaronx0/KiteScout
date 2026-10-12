import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BlockedByHost, fetchText } from '../../src/offers/http.js';

// A bot challenge must never be returned as page content (kitehi.com, SiteGround, 2026-10-09).
test('fetchText: SiteGround captcha (HTTP 202) and 403 throw BlockedByHost', async () => {
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith('/robots.txt')) return new Response('', { status: 404 });
    if (url.includes('captcha.example')) {
      return new Response('<html><head><meta http-equiv="refresh" content="0;/.well-known/sgcaptcha/?r=%2Fabout%2F"></meta></head></html>',
        { status: 202, headers: { 'sg-captcha': 'challenge', 'content-type': 'text/html' } });
    }
    if (url.includes('forbidden.example')) return new Response('nope', { status: 403 });
    return new Response('<html><body>' + 'x'.repeat(3000) + '</body></html>', { status: 200 });
  }) as typeof fetch;
  try {
    await assert.rejects(fetchText('https://captcha.example/about/'), (e: unknown) => e instanceof BlockedByHost && /SiteGround/.test(e.message));
    await assert.rejects(fetchText('https://forbidden.example/x'), (e: unknown) => e instanceof BlockedByHost && /403/.test(e.message));
    assert.ok((await fetchText('https://fine.example/page')).length > 3000);
  } finally {
    globalThis.fetch = real;
  }
});
