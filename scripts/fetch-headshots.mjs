// Keeps same-site copies of the photos the "save as image" button needs.
// NBA.com and most photo hosts don't allow other sites to read their images from the browser,
// so images made in the browser would come out without photos. The pages themselves still show the originals.
//  - Cavs player headshots: img/h/<NBA id>.png
//  - Drafted-player card photos (RIGHTS_CARD): img/x/<short hash>.<ext>, listed in img/x/map.json
// Runs from .github/workflows/videos.yml. Node 20+, no dependencies. Never fails the job.
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const root = new URL('../', import.meta.url);
const html = await readFile(new URL('index.html', root), 'utf8');
const UA = { headers: { 'user-agent': 'Mozilla/5.0 (compatible; cavsdatabase.com)' } };
const have = async u => { try { await stat(u); return true; } catch { return false; } };
const warn = m => console.log(`::warning::${m}`);

// 1. headshots
const ids = new Set();
const block = (html.match(/const PLAYERS\s*=\s*\[([\s\S]*?)\n\];/) || [])[1] || '';
for (const m of block.matchAll(/,(\d{6,8})\]/g)) ids.add(m[1]);
for (const m of html.matchAll(/headshots\/nba\/latest\/260x190\/(\d+)\.png/g)) ids.add(m[1]);
await mkdir(new URL('img/h/', root), { recursive: true });
let got = 0;
for (const id of ids) {
  const out = new URL(`img/h/${id}.png`, root);
  if (await have(out)) continue;
  try {
    const res = await fetch(`https://cdn.nba.com/headshots/nba/latest/260x190/${id}.png`, UA);
    if (!res.ok) { warn(`headshot ${id}: HTTP ${res.status}`); continue; }
    await writeFile(out, Buffer.from(await res.arrayBuffer())); got++;
  } catch (e) { warn(`headshot ${id}: ${e.message}`); }
}
console.log(`headshots: ${ids.size} players, ${got} added`);

// 2. drafted-player card photos
const cardSrc = (html.match(/const RIGHTS_CARD\s*=\s*(\{[^\n]*\});/) || [])[1];
const urls = new Set();
if (cardSrc) { try { for (const c of Object.values(JSON.parse(cardSrc))) if (c && c.img) urls.add(c.img); } catch (e) { warn('RIGHTS_CARD did not parse: ' + e.message); } }
await mkdir(new URL('img/x/', root), { recursive: true });
const mapUrl = new URL('img/x/map.json', root);
let map = {}; try { map = JSON.parse(await readFile(mapUrl, 'utf8')); } catch {}
let added = 0;
for (const u of urls) {
  if (map[u] && await have(new URL(map[u].replace(/^\//, ''), root))) continue;
  try {
    const res = await fetch(u, UA);
    if (!res.ok) { warn(`photo ${u}: HTTP ${res.status}`); continue; }
    const type = res.headers.get('content-type') || '';
    const ext = /png/.test(type) ? 'png' : /webp/.test(type) ? 'webp' : /jpe?g/.test(type) ? 'jpg' : (u.match(/\.(png|jpe?g|webp)(\?|$)/i) || [, 'jpg'])[1].toLowerCase();
    const name = createHash('sha1').update(u).digest('hex').slice(0, 12) + '.' + ext;
    await writeFile(new URL('img/x/' + name, root), Buffer.from(await res.arrayBuffer()));
    map[u] = '/img/x/' + name; added++;
  } catch (e) { warn(`photo ${u}: ${e.message}`); }
}
for (const k of Object.keys(map)) if (!urls.has(k)) delete map[k];
await writeFile(mapUrl, JSON.stringify(map, null, 1) + '\n');
console.log(`card photos: ${urls.size}, ${added} added`);
