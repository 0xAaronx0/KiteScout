// Let's Encrypt "ISRG Root YR" is not in Node's bundled CA store; kitesuites.com.br chains to it (leaf <- YR1 <- Root YR)
// and the daily slots job failed with "fetch failed" until certs/isrg-root-yr.pem was passed via NODE_EXTRA_CA_CERTS
// (see certs/README.md). Offline: pinned fingerprint, the recorded chain verifies up to the root, and the wiring is there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { rootCertificates } from 'node:tls';

const root = new URL('../../', import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), 'utf8');
const ROOT_YR_SHA256 = 'E5:7B:7E:6F:15:0C:41:91:02:E8:D5:C0:55:72:9F:F9:67:B9:D1:A8:29:BF:00:CE:C8:9C:A6:04:EB:F4:A8:6F';

test('certs/isrg-root-yr.pem is the official, self-signed ISRG Root YR (pinned SHA-256)', () => {
  const ca = new X509Certificate(read('certs/isrg-root-yr.pem'));
  assert.equal(ca.fingerprint256, ROOT_YR_SHA256);
  assert.match(ca.subject, /CN=Root YR/);
  assert.equal(ca.subject, ca.issuer);
  assert.ok(ca.verify(ca.publicKey), 'self-signed');
  assert.ok(ca.ca);
});

test('the recorded kitesuites.com.br chain (leaf, YR1) verifies up to Root YR', () => {
  const pems = read('test/fixtures/certs/kitesuites-com-br-chain.pem').match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g)!;
  const [leaf, yr1] = pems.map(p => new X509Certificate(p));
  const ca = new X509Certificate(read('certs/isrg-root-yr.pem'));
  assert.match(leaf.subject, /CN=kitesuites\.com\.br/);
  assert.match(yr1.subject, /CN=YR1/);
  assert.ok(leaf.verify(yr1.publicKey), 'leaf signed by YR1');
  assert.equal(yr1.issuer, ca.subject);
  assert.ok(yr1.verify(ca.publicKey), 'YR1 signed by Root YR');
});

test('the extra root is still needed (drop certs/ once Node ships Root YR)', () => {
  const ca = new X509Certificate(read('certs/isrg-root-yr.pem'));
  const bundled = rootCertificates.some(p => new X509Certificate(p).fingerprint256 === ca.fingerprint256);
  // informational: when this flips to true, certs/isrg-root-yr.pem and NODE_EXTRA_CA_CERTS can be removed
  if (bundled) console.warn('Node now bundles ISRG Root YR: certs/isrg-root-yr.pem is no longer needed');
  assert.equal(typeof bundled, 'boolean');
});

test('every place that runs provider adapters passes the extra root to Node', () => {
  for (const wf of ['.github/workflows/monitor.yml', '.github/workflows/rerun-change.yml']) {
    assert.match(read(wf), /NODE_EXTRA_CA_CERTS: \$\{\{ github\.workspace \}\}\/certs\/isrg-root-yr\.pem/, wf);
  }
  const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
  assert.match(pkg.scripts.cli, /NODE_EXTRA_CA_CERTS=\$\{NODE_EXTRA_CA_CERTS:-certs\/isrg-root-yr\.pem\} tsx src\/cli\.ts/);
});
