// Live, laptop-only proof of the hard gates (no cloud needed). Each case MUST be blocked.
//
//   npm run demo:blocked
import { mkdtemp, writeFile, readFile, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readJson } from './lib.mjs';
import { validateContent } from './validate.mjs';
import { build } from './build.mjs';
import { verifyBundle } from './verify-bundle.mjs';
import { promotionProblems } from './promotion-check.mjs';

const env = { ...process.env, SOURCE_DATE_EPOCH: '1791504000', GITHUB_SHA: 'demo000000000000000000000000000000000000' };
const line = () => console.log('─'.repeat(72));
let allBlocked = true;
const expectBlocked = (name, problems) => {
  line();
  console.log(`CASE: ${name}`);
  if (problems.length) {
    console.log(`  BLOCKED ✓  ${problems[0]}`);
  } else {
    console.log('  NOT BLOCKED ✗  (this is a control failure)');
    allBlocked = false;
  }
};

const work = await mkdtemp(join(tmpdir(), 'aurevia-demo-'));
try {
  // 1. Status changed, but the MLR approval still covers the previous version.
  const unapproved = await readJson('demo/trial.unapproved.json');
  expectBlocked('Content changed without a matching MLR approval', validateContent(unapproved));

  // 2. Someone edits the approved bundle after the build (e.g. in transit to production).
  const dist = join(work, 'dist');
  const built = await build({ contentPath: 'demo/trial.enrollment-paused.json', outDir: dist, env });
  const page = join(dist, 'sg/en/index.html');
  await writeFile(page, (await readFile(page, 'utf8')).replace('Enrollment paused', 'Recruiting'));
  const tampered = await verifyBundle(dist, { expectDigest: built.digest });
  expectBlocked('Approved bundle altered after build (sg/en page edited)', tampered.problems);

  // 3. A different, valid build is presented at the gate instead of the approved one.
  const other = join(work, 'other');
  await cp('content', join(work, 'content'), { recursive: true });
  await build({ contentPath: 'content/trial.json', outDir: other, env });
  const swapped = await verifyBundle(other, { expectDigest: built.digest });
  expectBlocked('A different (unapproved) bundle presented for promotion', swapped.problems);

  // 4. Approval expires while the candidate waits at the gate.
  const release = await readJson(join(work, 'other', 'release.json'));
  expectBlocked('Approval expired while waiting at the release gate',
    promotionProblems(release, '2027-04-01'));

  line();
  console.log(allBlocked ? 'All 4 unsafe releases were blocked.' : 'CONTROL FAILURE: an unsafe release was not blocked.');
  if (!allBlocked) process.exitCode = 1;
} finally {
  await rm(work, { recursive: true, force: true });
}
