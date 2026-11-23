// One-time pull (Nov 15, 2026, Luka): every Cavs regular season box score from 1970–71 through 1999–2000 from Basketball Reference,
// for the "This day in Cavs history" facts (scripts/hist-facts.mjs). Resumable: keeps what it already has in data/hist-old.json
// and saves after every season. About 3.5 seconds between requests to stay under Basketball Reference's rate limit.
//   FROM=1971 TO=2000 node scripts/hist-old.mjs      (season end years)
import { readFile, writeFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const OUT = new URL('data/hist-old.json', root);
const UA = 'Mozilla/5.0 (compatible; cavsdatabase-history/1.0; +https://cavsdatabase.com)';
const FROM = +(process.env.FROM || 1971), TO = +(process.env.TO || 2000);
const STOP = Date.now() + (+(process.env.MINUTES || 330)) * 60e3;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const dec = s => String(s || '').replace(/<[^>]*>/g, '').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').trim();
let last = 0;
async function get(u) {
  for (let i = 0; i < 4; i++) {
    const w = 3500 - (Date.now() - last); if (w > 0) await sleep(w); last = Date.now();
    try { const r = await fetch(u, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(30000) }); if (r.ok) return (await r.text()).replace(/<!--|-->/g, ''); console.log('HTTP', r.status, u); if (r.status === 429) await sleep(65 * 60e3); else if (r.status === 404) return null; }
    catch (e) { console.log(String(e).slice(0, 120), u); }
    await sleep(10000);
  }
  return null;
}
const cell = (row, k) => { const m = new RegExp(`data-stat="${k}"[^>]*>([\\s\\S]*?)</t[dh]>`).exec(row); return m ? dec(m[1]) : ''; };
let D = { how: 'Cavs regular season box scores from Basketball Reference (one-time pull, Nov 2026). pl rows: [name, pts, reb, ast, 3pm, stl, blk]', games: [] };
try { D = JSON.parse(await readFile(OUT, 'utf8')); } catch { }
const have = new Set(D.games.map(g => g.box));
for (let yr = FROM; yr <= TO && Date.now() < STOP; yr++) {
  const s = `${yr - 1}-${String(yr).slice(2)}`;
  const html = await get(`https://www.basketball-reference.com/teams/CLE/${yr}_games.html`);
  if (!html) { console.log('hist-old: no schedule for', yr); continue; }
  const tb = /<table[^>]*id="games"[\s\S]*?<\/table>/.exec(html); if (!tb) { console.log('hist-old: no games table', yr); continue; }
  let n = 0;
  for (const m of tb[0].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    if (Date.now() > STOP) break;
    const row = m[1]; const bx = /href="\/boxscores\/([0-9A-Z]+)\.html"/.exec(row); if (!bx || have.has(bx[1])) continue;
    const dt = /data-stat="date_game"[^>]*csk="(\d{4})(\d{2})(\d{2})"/.exec(row) || /boxscores\/(\d{4})(\d{2})(\d{2})/.exec(row);
    const o = (/data-stat="opp_name"[^>]*>.*?\/teams\/([A-Z]{3})\//.exec(row) || [])[1] || '';
    const p = +cell(row, 'pts'), op = +cell(row, 'opp_pts'); if (!dt || !p) continue;
    const page = await get(`https://www.basketball-reference.com/boxscores/${bx[1]}.html`); if (!page) continue;
    const t = /<table[^>]*id="box-CLE-game-basic"[\s\S]*?<\/table>/.exec(page); if (!t) { console.log('hist-old: no CLE box', bx[1]); continue; }
    const pl = [];
    for (const r of t[0].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) { const nm = cell(r[1], 'player'); if (!nm || /^(Starters|Reserves|Team Totals)$/i.test(nm) || !cell(r[1], 'mp') || /Did Not|Not With|Inactive/i.test(cell(r[1], 'reason'))) continue; const v = k => { const x = cell(r[1], k); return x === '' ? 0 : +x || 0; }; pl.push([nm, v('pts'), v('trb'), v('ast'), v('fg3'), v('stl'), v('blk')]); }
    const sum = pl.reduce((a, r) => a + r[1], 0); if (sum !== p) console.log('hist-old: points check off', bx[1], sum, p);
    D.games.push({ d: `${dt[1]}-${dt[2]}-${dt[3]}`, s, o, home: !/@/.test(cell(row, 'game_location')), p, op, box: bx[1], pl }); have.add(bx[1]); n++;
  }
  D.games.sort((a, b) => a.d.localeCompare(b.d)); D.updated = new Date().toISOString();
  await writeFile(OUT, JSON.stringify(D)); console.log('hist-old:', s, n, 'new games, total', D.games.length);
}
process.exit(0);
