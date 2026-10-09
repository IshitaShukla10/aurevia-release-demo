// Rehearsal helper: simulates the MLR adapter exporting a newly approved snapshot.
// Bumps the content version, issues the next (fictional) approval reference for that
// exact version, and sets the trial status. Lets you rehearse the demo repeatedly.
//
//   node scripts/demo-change.mjs enrollment-paused
//   node scripts/demo-change.mjs recruiting
import { writeFile } from 'node:fs/promises';
import { readJson, STATUSES } from './lib.mjs';
import { validateContent } from './validate.mjs';

const status = process.argv[2];
if (!STATUSES.includes(status)) {
  console.error(`usage: node scripts/demo-change.mjs <${STATUSES.join('|')}>`);
  process.exit(2);
}
const file = 'content/trial.json';
const c = await readJson(file);
const [maj, min] = c.contentVersion.split('.').map(Number);
const nextVersion = `${maj}.${min + 1}.0`;
const nextRef = Number(c.approval.reference.split('-').pop()) + 1;

c.status = status;
c.contentVersion = nextVersion;
c.approval = {
  ...c.approval,
  reference: `MLR-${c.trialId.replace(/[^A-Za-z0-9]/g, '')}-${String(nextRef).padStart(4, '0')}`,
  contentVersion: nextVersion,
  approvedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
};

const errors = validateContent(c);
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
await writeFile(file, JSON.stringify(c, null, 2) + '\n');
console.log(`✓ ${file}: v${nextVersion} "${status}" approved as ${c.approval.reference} (simulated MLR export)`);
console.log(`  Next: git checkout -b ${status}-v${nextVersion} && git commit -am "AV-301: ${status} (${c.approval.reference})" && git push -u origin HEAD`);
