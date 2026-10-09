// Artifact integrity: does this directory contain exactly the files the manifest
// lists, byte for byte? Run before every deployment so an altered bundle cannot ship.
//
//   node scripts/verify-bundle.mjs dist [--expect-digest <sha256>] [--expect-release <id>]
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readJson, hashBundle, MANIFEST_FILE, fail } from './lib.mjs';

export async function verifyBundle(dir, { expectDigest, expectRelease } = {}) {
  const problems = [];
  let manifest;
  try { manifest = await readJson(join(dir, MANIFEST_FILE)); }
  catch { return { ok: false, problems: [`${MANIFEST_FILE} is missing or unreadable`] }; }

  const actual = await hashBundle(dir);
  for (const [p, h] of Object.entries(manifest.files)) {
    if (!(p in actual.files)) problems.push(`missing file: ${p}`);
    else if (actual.files[p] !== h) problems.push(`modified file: ${p}`);
  }
  for (const p of Object.keys(actual.files)) {
    if (!(p in manifest.files)) problems.push(`unexpected file: ${p}`);
  }
  if (actual.digest !== manifest.bundleDigest) problems.push('bundle digest does not match the manifest');
  if (expectDigest && manifest.bundleDigest !== expectDigest) {
    problems.push(`bundle digest ${manifest.bundleDigest.slice(0, 12)}… is not the approved build ${expectDigest.slice(0, 12)}…`);
  }
  if (expectRelease && manifest.releaseId !== expectRelease) {
    problems.push(`release ${manifest.releaseId} is not the expected release ${expectRelease}`);
  }
  return { ok: problems.length === 0, problems, manifest, digest: actual.digest };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const dir = args.find((a) => !a.startsWith('--')) ?? 'dist';
  const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
  const r = await verifyBundle(dir, { expectDigest: opt('--expect-digest'), expectRelease: opt('--expect-release') });
  if (r.ok) {
    console.log(`✓ Bundle intact: ${r.manifest.releaseId} · ${Object.keys(r.manifest.files).length} files · digest ${r.digest}`);
  } else {
    r.problems.forEach(fail);
    console.error('\nPromotion blocked: this is not the approved bundle.');
  }
}
