// Time to first byte, measured honestly: a fresh connection per run (DNS + TCP + TLS
// included), median and range reported, Cloudflare colo shown where present.
//
//   node scripts/ttfb.mjs <url> [<url> ...] [--runs 5] [--markdown]
import http from 'node:http';
import https from 'node:https';
import { pathToFileURL } from 'node:url';

function once(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https:') ? https : http;
    const t0 = process.hrtime.bigint();
    const req = lib.get(url, { agent: false, headers: { 'cache-control': 'no-cache', 'user-agent': 'aurevia-ttfb/1' } }, (res) => {
      const ttfb = Number(process.hrtime.bigint() - t0) / 1e6;
      res.resume();
      res.on('end', () => resolve({ ttfb, status: res.statusCode, ray: res.headers['cf-ray'] ?? '' }));
    });
    req.setTimeout(15000, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

export async function measure(url, runs = 5) {
  const samples = [];
  let status, colo = '';
  for (let i = 0; i < runs; i++) {
    const r = await once(url);
    samples.push(r.ttfb); status = r.status;
    colo = r.ray.split('-')[1] ?? colo;
  }
  return { url, runs, status, colo, median: median(samples), min: Math.min(...samples), max: Math.max(...samples) };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const ri = args.indexOf('--runs');
  const runs = ri >= 0 ? Number(args[ri + 1]) : 5;
  const urls = args.filter((a) => /^https?:\/\//.test(a));
  const md = args.includes('--markdown');
  if (!urls.length) { console.error('usage: node scripts/ttfb.mjs <url> [<url> ...] [--runs 5] [--markdown]'); process.exit(2); }
  const rows = [];
  for (const u of urls) rows.push(await measure(u, runs));
  const fmt = (n) => `${n.toFixed(0)} ms`;
  if (md) {
    console.log('| URL | Served from (colo) | Runs | Median TTFB | Range |');
    console.log('|---|---|---|---|---|');
    for (const r of rows) console.log(`| ${r.url} | ${r.colo || 'n/a'} | ${r.runs} | ${fmt(r.median)} | ${fmt(r.min)}–${fmt(r.max)} |`);
    console.log('\nFresh connection per run (DNS + TCP + TLS included). Probe location = where this command ran.');
  } else {
    for (const r of rows) {
      console.log(`${r.url}\n  HTTP ${r.status} · colo ${r.colo || 'n/a'} · ${r.runs} runs · median ${fmt(r.median)} · range ${fmt(r.min)}–${fmt(r.max)}`);
    }
    console.log('Fresh connection per run (DNS + TCP + TLS included).');
  }
}
