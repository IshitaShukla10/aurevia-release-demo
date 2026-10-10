import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readJson, urlPathFor } from '../scripts/lib.mjs';
import { validateContent } from '../scripts/validate.mjs';
import { build } from '../scripts/build.mjs';
import { verifyBundle } from '../scripts/verify-bundle.mjs';
import { promotionProblems } from '../scripts/promotion-check.mjs';

const env = { SOURCE_DATE_EPOCH: '1791504000', GITHUB_SHA: 'abc1234def5678900000000000000000000000000', SITE_URL: 'https://aurevia-trial.example.workers.dev' };
const TODAY = '2026-10-09';

async function tmp() { return mkdtemp(join(tmpdir(), 'aurevia-test-')); }

test('current and demo content snapshots are valid', async () => {
  assert.deepEqual(validateContent(await readJson('content/trial.json'), TODAY), []);
  assert.deepEqual(validateContent(await readJson('demo/trial.enrollment-paused.json'), TODAY), []);
});

test('a change without a matching approval is rejected', async () => {
  const errors = validateContent(await readJson('demo/trial.unapproved.json'), TODAY);
  assert.ok(errors.some((e) => e.includes('not approved')), errors.join('\n'));
});

test('expired content is rejected', async () => {
  const errors = validateContent(await readJson('demo/trial.expired.json'), TODAY);
  assert.ok(errors.some((e) => e.includes('expired')));
});

test('missing translation is rejected', async () => {
  const c = await readJson('content/trial.json');
  delete c.markets['vn-vi'].statusLabel['enrollment-paused'];
  assert.ok(validateContent(c, TODAY).some((e) => e.includes('vn-vi.statusLabel.enrollment-paused')));
});

test('build is deterministic: same inputs give the same digest', async () => {
  const a = await tmp(), b = await tmp();
  try {
    const r1 = await build({ outDir: a, env });
    const r2 = await build({ outDir: b, env });
    assert.equal(r1.digest, r2.digest);
    const content = await readJson('content/trial.json');
    assert.equal(r1.releaseId, `AV301-${content.contentVersion}-20261009-abc1234`);
  } finally { await rm(a, { recursive: true }); await rm(b, { recursive: true }); }
});

test('build renders every market with status, release ID, hreflang and hashed CSS', async () => {
  const d = await tmp();
  try {
    const r = await build({ contentPath: 'demo/trial.enrollment-paused.json', outDir: d, env });
    const sg = await readFile(join(d, 'sg/en/index.html'), 'utf8');
    const id = await readFile(join(d, 'id/id/index.html'), 'utf8');
    const vn = await readFile(join(d, 'vn/vi/index.html'), 'utf8');
    assert.match(sg, /Enrollment paused/);
    assert.match(id, /Pendaftaran dihentikan sementara/);
    assert.match(vn, /Tạm ngừng tuyển người tham gia/);
    assert.match(sg, new RegExp(r.releaseId));
    assert.match(sg, /hreflang="id-ID" href="https:\/\/aurevia-trial\.example\.workers\.dev\/id\/id\/"/);
    assert.match(sg, /hreflang="x-default"/);
    assert.match(sg, /href="\/assets\/styles\.[0-9a-f]{10}\.css"/);
    const headers = await readFile(join(d, '_headers'), 'utf8');
    assert.match(headers, /\/assets\/\*\n {2}Cache-Control: public, max-age=31536000, immutable/);
    assert.match(headers, new RegExp(`X-Release-Id: ${r.releaseId}`));
  } finally { await rm(d, { recursive: true }); }
});

test('build refuses unapproved content', async () => {
  const d = await tmp();
  try {
    await assert.rejects(build({ contentPath: 'demo/trial.unapproved.json', outDir: d, env }), /not approved/);
  } finally { await rm(d, { recursive: true, force: true }); }
});

test('verify-bundle passes an intact bundle and pins the approved digest', async () => {
  const d = await tmp();
  try {
    const r = await build({ outDir: d, env });
    assert.equal((await verifyBundle(d, { expectDigest: r.digest, expectRelease: r.releaseId })).ok, true);
    const wrong = await verifyBundle(d, { expectDigest: '0'.repeat(64) });
    assert.equal(wrong.ok, false);
  } finally { await rm(d, { recursive: true }); }
});

test('verify-bundle detects modified, added and removed files', async () => {
  const d = await tmp();
  try {
    await build({ outDir: d, env });
    const page = join(d, 'sg/en/index.html');
    await writeFile(page, (await readFile(page, 'utf8')) + '\n<!-- test modification -->');
    await writeFile(join(d, 'extra.html'), '<p>injected</p>');
    await rm(join(d, 'vn/vi/index.html'));
    const r = await verifyBundle(d);
    assert.equal(r.ok, false);
    assert.ok(r.problems.includes('modified file: sg/en/index.html'));
    assert.ok(r.problems.includes('unexpected file: extra.html'));
    assert.ok(r.problems.includes('missing file: vn/vi/index.html'));
  } finally { await rm(d, { recursive: true }); }
});

test('promotion check re-validates approval at the gate', () => {
  const release = { contentVersion: '1.4.0', approval: { contentVersion: '1.4.0' }, validFrom: '2026-09-01', validUntil: '2027-03-31' };
  assert.deepEqual(promotionProblems(release, TODAY), []);
  assert.ok(promotionProblems(release, '2027-04-01')[0].includes('expired'));
  assert.ok(promotionProblems({ ...release, approval: { contentVersion: '1.3.0' } }, TODAY).length === 1);
});

test('bundle paths map to the URLs Workers Static Assets serves', () => {
  assert.equal(urlPathFor('index.html'), '/');
  assert.equal(urlPathFor('sg/en/index.html'), '/sg/en/');
  assert.equal(urlPathFor('assets/styles.abc.css'), '/assets/styles.abc.css');
  assert.equal(urlPathFor('_headers'), null);
  assert.equal(urlPathFor('404.html'), null);
});
