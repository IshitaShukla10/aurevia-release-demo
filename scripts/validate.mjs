// Content validation: is this snapshot well-formed, in date, and bound to an approval
// for this exact content version? This is a quality check, NOT release authority —
// the protected "production" environment in GitHub is the release gate.
import { readJson, STATUSES, fail } from './lib.mjs';
import { pathToFileURL } from 'node:url';

const SEMVER = /^\d+\.\d+\.\d+$/;
const MLR_REF = /^MLR-[A-Z0-9]+-\d{4}$/;
const MARKET_PATH = /^\/[a-z]{2}\/[a-z]{2}\/$/;
const MARKET_KEYS = ['country', 'lang', 'path', 'title', 'statusHeading', 'statusLabel',
  'statusDetail', 'summary', 'approvedLabel', 'releaseLabel', 'marketLabel', 'disclaimer'];

export function validateContent(c, today = new Date().toISOString().slice(0, 10)) {
  const errors = [];
  const need = (cond, msg) => { if (!cond) errors.push(msg); };

  need(c.schema === 'aurevia.trial/v1', 'schema must be aurevia.trial/v1');
  need(typeof c.trialId === 'string' && c.trialId.length > 0, 'trialId is required');
  need(SEMVER.test(c.contentVersion ?? ''), 'contentVersion must be semver (x.y.z)');
  need(STATUSES.includes(c.status), `status must be one of: ${STATUSES.join(', ')}`);

  const a = c.approval ?? {};
  need(MLR_REF.test(a.reference ?? ''), 'approval.reference must look like MLR-<ID>-<4 digits>');
  need(a.contentVersion === c.contentVersion,
    `approval covers content ${a.contentVersion ?? '(none)'}, but this snapshot is ${c.contentVersion} — the change is not approved`);
  need(!Number.isNaN(Date.parse(a.approvedAt ?? '')), 'approval.approvedAt must be an ISO timestamp');

  need(/^\d{4}-\d{2}-\d{2}$/.test(c.validFrom ?? '') && /^\d{4}-\d{2}-\d{2}$/.test(c.validUntil ?? ''),
    'validFrom and validUntil must be YYYY-MM-DD');
  need(!(c.validFrom > today), `content is not valid until ${c.validFrom}`);
  need(!(c.validUntil < today), `content expired on ${c.validUntil}`);

  const markets = Object.entries(c.markets ?? {});
  need(markets.length > 0, 'at least one market is required');
  const paths = new Set();
  for (const [id, m] of markets) {
    for (const k of MARKET_KEYS) need(m[k] !== undefined && m[k] !== '', `markets.${id}.${k} is required`);
    need(MARKET_PATH.test(m.path ?? ''), `markets.${id}.path must look like /sg/en/`);
    need(!paths.has(m.path), `markets.${id}.path ${m.path} is duplicated`);
    paths.add(m.path);
    for (const s of STATUSES) {
      need(!!m.statusLabel?.[s], `markets.${id}.statusLabel.${s} is missing`);
      need(!!m.statusDetail?.[s], `markets.${id}.statusDetail.${s} is missing`);
    }
  }
  return errors;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2] ?? 'content/trial.json';
  const content = await readJson(file);
  const errors = validateContent(content);
  if (errors.length) {
    errors.forEach(fail);
    console.error(`\nContent validation failed for ${file} (${errors.length} problem${errors.length > 1 ? 's' : ''}).`);
  } else {
    console.log(`✓ ${file}: ${content.trialId} v${content.contentVersion} "${content.status}" — approval ${content.approval.reference} matches this version; valid until ${content.validUntil}`);
  }
}
