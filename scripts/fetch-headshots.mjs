// Keeps same-site copies of the photos the "save as image" button needs.
// NBA.com and most photo hosts don't allow other sites to read their images from the browser,
// so images made in the browser would come out without photos. The pages themselves still show the originals.
//  - Cavs player headshots: img/h/<NBA id>.png
//  - Every other photo on the page (drafted players, staff): img/x/<short hash>.<ext>, listed in img/x/map.json
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
const staff = (html.match(/const STAFF\s*=\s*\[([\s\S]*?)\n\];/) || [])[1] || '';
for (const m of staff.matchAll(/',(\d{5,8})\]/g)) ids.add(m[1]);
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
// every other photo the page shows (drafted-player cards, staff, Charge staff)
const urls = new Set();
for (const m of html.matchAll(/https:\/\/[^'"\s)]+\.(?:png|jpe?g|webp)/gi)) { const u = m[0]; if (/headshots\/nba\/latest\/260x190|cavsdatabase\.com/.test(u)) continue; urls.add(u); }
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
console.log(`other photos: ${urls.size}, ${added} added`);

// 3. team logos for the live page (img/tl/<espn abbreviation>.png), so the scoreboard keeps its logos if ESPN's image server is down
const TL = ['atl', 'bos', 'bkn', 'cha', 'chi', 'cle', 'dal', 'den', 'det', 'gs', 'hou', 'ind', 'lac', 'lal', 'mem', 'mia', 'mil', 'min', 'no', 'ny', 'okc', 'orl', 'phi', 'phx', 'por', 'sac', 'sa', 'tor', 'utah', 'wsh'];
await mkdir(new URL('img/tl/', root), { recursive: true });
let tl = 0;
for (const a of TL) {
  const out = new URL(`img/tl/${a}.png`, root);
  if (await have(out)) continue;
  try {
    const res = await fetch(`https://a.espncdn.com/combiner/i?img=/i/teamlogos/nba/500/${a}.png&h=96&w=96`, UA);
    if (!res.ok) { warn(`logo ${a}: HTTP ${res.status}`); continue; }
    await writeFile(out, Buffer.from(await res.arrayBuffer())); tl++;
  } catch (e) { warn(`logo ${a}: ${e.message}`); }
}
console.log(`team logos: ${tl} added`);
