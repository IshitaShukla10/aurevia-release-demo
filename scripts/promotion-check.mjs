// Re-check approval validity at the moment of promotion, not only at build time.
// An approval can expire while a candidate waits at the gate.
//
//   node scripts/promotion-check.mjs dist
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readJson, fail } from './lib.mjs';

export function promotionProblems(release, today = new Date().toISOString().slice(0, 10)) {
  const p = [];
  if (release.approval?.contentVersion !== release.contentVersion) {
    p.push(`approval covers v${release.approval?.contentVersion}, release contains v${release.contentVersion}`);
  }
  if (release.validFrom > today) p.push(`content is not valid until ${release.validFrom}`);
  if (release.validUntil < today) p.push(`content approval expired on ${release.validUntil}`);
  return p;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = process.argv[2] ?? 'dist';
  const release = await readJson(join(dir, 'release.json'));
  const problems = promotionProblems(release);
  if (problems.length) {
    problems.forEach(fail);
    console.error('\nPromotion blocked: content approval is not valid today.');
  } else {
    console.log(`✓ Approval ${release.approval.reference} still valid for v${release.contentVersion} (until ${release.validUntil})`);
  }
}
