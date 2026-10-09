// Post-deployment verification: is the live site serving the exact approved bundle?
//
//   node scripts/smoke.mjs <baseUrl> [--manifest dist/release-manifest.json]
//                                    [--expect-release <id>] [--expect-protected]
//
// --manifest          compare every public file's SHA-256 with the local manifest
// --expect-release    fail unless the live release ID matches
// --expect-protected  the URL must NOT be publicly readable (Access boundary test)
//
// For an Access-protected URL, set CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET
// (a Cloudflare Access service token) to authenticate the check.
import { pathToFileURL } from 'node:url';
import { readJson, sha256, urlPathFor, MANIFEST_FILE, fail } from './lib.mjs';

const ok = (m) => console.log(`✓ ${m}`);

function accessHeaders() {
  const id = process.env.CF_ACCESS_CLIENT_ID, secret = process.env.CF_ACCESS_CLIENT_SECRET;
  return id && secret ? { 'CF-Access-Client-Id': id, 'CF-Access-Client-Secret': secret } : {};
}

async function get(url, headers = {}) {
  const res = await fetch(url, { redirect: 'manual', headers: { 'cache-control': 'no-cache', ...headers } });
  const body = Buffer.from(await res.arrayBuffer());
  return { res, body };
}

const isAccessChallenge = (res) =>
  (res.status >= 300 && res.status < 400 && /cloudflareaccess\.com|\/cdn-cgi\/access\//.test(res.headers.get('location') ?? '')) ||
  res.status === 401 || res.status === 403;

export async function smoke(base, { manifestPath, expectRelease, expectProtected } = {}) {
  base = base.replace(/\/+$/, '');
  const before = process.exitCode;
  process.exitCode = 0;

  if (expectProtected) {
    const { res } = await get(`${base}/${MANIFEST_FILE}`);
    if (isAccessChallenge(res)) ok(`${base} is not public: unauthenticated request got HTTP ${res.status} (Access challenge)`);
    else fail(`${base} is publicly readable (HTTP ${res.status}) — expected an Access challenge`);
    const failed = process.exitCode === 1;
    process.exitCode = before || (failed ? 1 : 0);
    return !failed;
  }

  const auth = accessHeaders();
  const { res: mres, body: mbody } = await get(`${base}/${MANIFEST_FILE}`, auth);
  if (isAccessChallenge(mres)) {
    fail(`${base} requires Access authentication — set CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET`);
    process.exitCode = 1; return false;
  }
  if (mres.status !== 200) { fail(`GET /${MANIFEST_FILE} returned HTTP ${mres.status}`); return false; }
  const live = JSON.parse(mbody.toString('utf8'));
  const ray = mres.headers.get('cf-ray');
  ok(`Live release ${live.releaseId} · digest ${live.bundleDigest.slice(0, 16)}…${ray ? ` · cf-ray ${ray}` : ''}`);

  if (expectRelease) {
    if (live.releaseId === expectRelease) ok(`Release ID matches the approved release`);
    else fail(`Live release is ${live.releaseId}, expected ${expectRelease}`);
  }

  // Compare against the local, approved manifest when we have one.
  let files = live.files;
  if (manifestPath) {
    const local = await readJson(manifestPath);
    if (local.bundleDigest === live.bundleDigest) ok('Live manifest digest = approved bundle digest');
    else fail(`Live digest ${live.bundleDigest.slice(0, 12)}… ≠ approved ${local.bundleDigest.slice(0, 12)}…`);
    files = local.files;
  }

  let checked = 0;
  for (const [file, hash] of Object.entries(files)) {
    const path = urlPathFor(file);
    if (!path) continue;
    const { res, body } = await get(base + path, auth);
    if (res.status !== 200) { fail(`${path} returned HTTP ${res.status}`); continue; }
    if (sha256(body) !== hash) fail(`${path} content differs from the approved bundle`);
    else checked++;
  }
  ok(`${checked} public files byte-identical to the approved bundle`);

  // Header policy on one market page and one fingerprinted asset.
  const market = Object.keys(files).find((f) => /^[a-z]{2}\/[a-z]{2}\/index\.html$/.test(f));
  if (market) {
    const { res } = await get(base + urlPathFor(market), auth);
    const cc = res.headers.get('cache-control') ?? '';
    if (/max-age=0/.test(cc) && /must-revalidate/.test(cc)) ok(`HTML revalidates (${urlPathFor(market)}: ${cc})`);
    else fail(`HTML Cache-Control is "${cc}" — expected revalidation`);
    if (res.headers.get('x-release-id') === live.releaseId) ok('X-Release-Id header matches');
    else fail(`X-Release-Id header is "${res.headers.get('x-release-id')}"`);
    if (res.headers.get('content-security-policy')) ok('Content-Security-Policy present');
    else fail('Content-Security-Policy header missing');
  }
  const css = Object.keys(files).find((f) => f.startsWith('assets/'));
  if (css) {
    const { res } = await get(base + urlPathFor(css), auth);
    const cc = res.headers.get('cache-control') ?? '';
    if (/immutable/.test(cc)) ok(`Hashed asset cached long-term (${cc})`);
    else fail(`Asset Cache-Control is "${cc}" — expected immutable`);
  }
  const { res: nf } = await get(`${base}/no-such-page-${Date.now()}`, auth);
  if (nf.status === 404) ok('Unknown path returns 404 page');
  else fail(`Unknown path returned HTTP ${nf.status}`);

  const failed = process.exitCode === 1;
  process.exitCode = before || (failed ? 1 : 0);
  return !failed;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const base = args.find((a) => /^https?:\/\//.test(a));
  const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  if (!base) { console.error('usage: node scripts/smoke.mjs <baseUrl> [--manifest file] [--expect-release id] [--expect-protected]'); process.exit(2); }
  const passed = await smoke(base, {
    manifestPath: opt('--manifest'), expectRelease: opt('--expect-release'), expectProtected: args.includes('--expect-protected'),
  });
  console.log(passed ? '\nVerification passed.' : '\nVerification FAILED.');
}
