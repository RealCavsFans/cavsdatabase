// Weekly outside-link check. Collects every outside link on the site (index.html, pdata/history.json and the
// Basketball Reference player/coach links built from IDs) and checks each one. Writes links-status.json:
// { checked: ISO time, total, broken: [[url, status]], unsure: [[url, status]] }.
// "broken" = the site answered 404/410 or the domain is gone; "unsure" = blocked, rate-limited or timed out (not alerted).
// Run weekly by .github/workflows/links.yml; the daily health check reads the result.
import { readFile, writeFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const html = await readFile(new URL('index.html', root), 'utf8');
const histTxt = await readFile(new URL('pdata/history.json', root), 'utf8');
const H = JSON.parse(histTxt);
const SKIP = ['cdn.nba.com', 'fonts.g', 'schema.org', 'w3.org', 'youtube-nocookie', 'cavsdatabase.com', 'x.com/', 'twitter.com', 'instagram.com', 'buymeacoffee.com'];
const urls = new Set();
for (const m of (html + histTxt).matchAll(/https?:\/\/[^\s'"<>)\\`]+/g)) {
  const u = m[0].replace(/[.,;]+$/, '');
  if (SKIP.some(s => u.includes(s)) || u.includes('+') || u.includes('${') || /[=?&]$/.test(u)) continue;
  urls.add(u);
}
const BR = 'https://www.basketball-reference.com';
for (const id of [...Object.values(H.bbd || {}), ...Object.values(H.bbl || {})]) if (id) urls.add(`${BR}/players/${id[0]}/${id}.html`);
for (const id of Object.values(H.bbc || {})) if (id) urls.add(`${BR}/coaches/${id}.html`);
const list = [...urls].sort();
const UA = 'Mozilla/5.0 (compatible; cavsdatabase-linkcheck/1.0; +https://cavsdatabase.com)';
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function check(u) {
  for (const method of ['HEAD', 'GET']) {
    try {
      const r = await fetch(u, { method, redirect: 'follow', headers: { 'user-agent': UA }, signal: AbortSignal.timeout(20000) });
      if (r.ok) return [u, r.status, 'ok'];
      if (method === 'HEAD' && [400, 403, 404, 405, 501].includes(r.status)) continue;  // some sites refuse HEAD
      return [u, r.status, [404, 410].includes(r.status) ? 'broken' : 'unsure'];
    } catch (e) {
      if (method === 'GET') return [u, String(e.cause?.code || e.name), /ENOTFOUND|EAI_AGAIN/.test(String(e.cause?.code)) ? 'broken' : 'unsure'];
    }
  }
}
// Basketball Reference blocks more than ~20 requests a minute, so its links go one at a time, 3.5 s apart.
const slow = list.filter(u => u.includes('basketball-reference.com')), fast = list.filter(u => !u.includes('basketball-reference.com'));
const out = [];
const worker = async q => { while (q.length) out.push(await check(q.shift())); };
const fq = [...fast]; await Promise.all(Array.from({ length: 6 }, () => worker(fq)));
for (const u of slow) { out.push(await check(u)); await sleep(3500); }
const broken = out.filter(x => x[2] === 'broken').map(x => x.slice(0, 2)), unsure = out.filter(x => x[2] === 'unsure').map(x => x.slice(0, 2));
await writeFile(new URL('links-status.json', root), JSON.stringify({ checked: new Date().toISOString(), total: list.length, broken, unsure }, null, 1) + '\n');
console.log(`links: ${list.length} checked, ${broken.length} broken, ${unsure.length} unsure`);
broken.forEach(([u, s]) => console.log('BROKEN', s, u));
