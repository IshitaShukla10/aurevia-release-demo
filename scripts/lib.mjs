// Shared helpers for the release scripts. No third-party dependencies.
import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

export const MANIFEST_FILE = 'release-manifest.json';
export const STATUSES = ['recruiting', 'enrollment-paused'];

export function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

export async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

// Every file under dir, as forward-slash paths relative to dir, sorted.
export async function listFiles(dir) {
  const out = [];
  async function walk(d) {
    for (const name of await readdir(d)) {
      const full = join(d, name);
      if ((await stat(full)).isDirectory()) await walk(full);
      else out.push(relative(dir, full).split(sep).join('/'));
    }
  }
  await walk(dir);
  return out.sort();
}

// Hash every file except the manifest itself, then hash the sorted list.
export async function hashBundle(dir) {
  const files = {};
  for (const p of await listFiles(dir)) {
    if (p === MANIFEST_FILE) continue;
    files[p] = sha256(await readFile(join(dir, p)));
  }
  const digest = sha256(Object.entries(files).map(([p, h]) => `${p}:${h}`).join('\n'));
  return { files, digest };
}

// Map a bundle path to the public URL path Workers Static Assets serves it at.
// Returns null for files that are configuration, not content.
export function urlPathFor(file) {
  if (file === '_headers' || file === '_redirects' || file === '404.html') return null;
  if (file === 'index.html') return '/';
  if (file.endsWith('/index.html')) return '/' + file.slice(0, -'index.html'.length);
  return '/' + file;
}

export function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exitCode = 1;
}
