// Keeps a same-site copy of each Cavs player's NBA.com headshot in img/h/<id>.png.
// NBA.com doesn't allow other sites to read its images from the browser, so the
// "save as image" button uses these copies. The pages themselves still show NBA.com's.
// Runs from .github/workflows/videos.yml. Node 20+, no dependencies. Never fails the job.
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const html = await readFile(new URL('index.html', root), 'utf8');
const ids = new Set();
const block = (html.match(/const PLAYERS\s*=\s*\[([\s\S]*?)\n\];/) || [])[1] || '';
for (const m of block.matchAll(/,(\d{6,8})\]/g)) ids.add(m[1]);
for (const m of html.matchAll(/headshots\/nba\/latest\/260x190\/(\d+)\.png/g)) ids.add(m[1]);
await mkdir(new URL('img/h/', root), { recursive: true });
let got = 0;
for (const id of ids) {
  const out = new URL(`img/h/${id}.png`, root);
  try { await stat(out); continue; } catch {} // already have it
  try {
    const res = await fetch(`https://cdn.nba.com/headshots/nba/latest/260x190/${id}.png`, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; cavsdatabase.com)' } });
    if (!res.ok) { console.log(`::warning::headshot ${id}: HTTP ${res.status}`); continue; }
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(out, buf); got++;
  } catch (e) { console.log(`::warning::headshot ${id}: ${e.message}`); }
}
console.log(`headshots: ${ids.size} players, ${got} added`);
