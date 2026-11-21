// Cleveland Charge player season stats (Nov 14, 2026, Luka): fills CH_STATS in index.html for the /charge Leaders section.
// For every Charge game that has a result and an ESPN game link (charge-espn.mjs writes both), reads ESPN's G League box score once
// and keeps every Charge player's line in pdata/charge-box.json (keyed by ESPN game id, so later runs only read new games).
// Then adds them up into per-game averages:
//   CH_STATS rows: [name, games, minutes, points, rebounds, assists, steals, blocks, FGM, FGA, 3PM, 3PA, FTM, FTA, PER] (FTM and FTA added Nov 18)
// (PER is left empty: the Leaders section skips a category with no numbers.) Writes index.html only when the numbers change.
// Exits 0 on any problem and leaves the old numbers alone.
//   node scripts/charge-stats.mjs            FORCE=1 to re-read every game
import fs from 'node:fs';
const IDX = new URL('../index.html', import.meta.url);
const BOX = new URL('../pdata/charge-box.json', import.meta.url);
const API = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba-development';
try {
  const html = fs.readFileSync(IDX, 'utf8');
  const m = /const CHARGE=\{record:'([^']*)'[\s\S]*?games:(\[[\s\S]*?\]\])\};?/.exec(html);
  if (!m) { console.log('charge-stats: CHARGE not found'); process.exit(0); }
  const games = Function('return ' + m[2])();
  let box = {}; try { box = JSON.parse(fs.readFileSync(BOX, 'utf8')); } catch {}
  const get = async u => { for (let i = 0; i < 3; i++) { try { const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 (cavsdatabase.com)' }, signal: AbortSignal.timeout(30000) }); if (r.ok) return await r.json(); console.log('HTTP', r.status, u); } catch (e) { console.log(String(e).slice(0, 100)); } await new Promise(r => setTimeout(r, 3000)); } return null; };
  const isCharge = t => /charge/i.test(((t || {}).displayName || '') + ' ' + ((t || {}).name || '')) && /cleveland/i.test(((t || {}).displayName || '') + ' ' + ((t || {}).location || ''));
  const pair = s => { const x = /^(\d+)\s*-\s*(\d+)$/.exec(String(s || '').trim()); return x ? [+x[1], +x[2]] : [0, 0]; };
  let read = 0;
  for (const g of games) {
    if (!/^[WL] /.test(g[4] || '') || !g[6]) continue;
    const id = (/gameId\/(\d+)/.exec(g[6]) || [])[1]; if (!id) continue;
    if (box[id] && box[id].lines.every(l => l.length >= 13) && !process.env.FORCE) continue;
    const sum = await get(`${API}/summary?event=${id}`);
    const lines = [];
    for (const tp of ((sum && sum.boxscore && sum.boxscore.players) || [])) {
      if (!isCharge(tp.team)) continue;
      for (const grp of tp.statistics || []) {
        const lab = (grp.labels || grp.names || []).map(x => String(x).toUpperCase()), ix = k => lab.indexOf(k);
        for (const ath of grp.athletes || []) {
          const nm = (ath.athlete || {}).displayName; if (!nm || !ath.stats || !ath.stats.length || ath.didNotPlay) continue;
          const n = k => { const i = ix(k); return i < 0 ? 0 : parseInt(ath.stats[i], 10) || 0; };
          const p = k => { const i = ix(k); return i < 0 ? [0, 0] : pair(ath.stats[i]); };
          const mn = n('MIN'); if (!mn && !n('PTS') && !p('FG')[1]) continue;
          const [fgm, fga] = p('FG'), [tpm, tpa] = p('3PT'), [ftm, fta] = p('FT');
          lines.push([nm, mn, n('PTS'), n('REB'), n('AST'), n('STL'), n('BLK'), fgm, fga, tpm, tpa, ftm, fta]);
        }
      }
    }
    if (!lines.length) { console.log('charge-stats: no Charge box score yet for', g[0], id); continue; }
    box[id] = { date: g[0], lines }; read++;
    console.log('charge-stats:', g[0], g[1], lines.length, 'players');
  }
  if (read) { fs.mkdirSync(new URL('../pdata/', import.meta.url), { recursive: true }); fs.writeFileSync(BOX, JSON.stringify(box)); }
  /* season per-game averages, every Charge player who played */
  const T = {};
  for (const { lines } of Object.values(box)) for (const [nm, ...v] of lines) { const t = T[nm] || (T[nm] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]); t[0]++; v.forEach((x, i) => t[i + 1] += x); }
  const r1 = x => Math.round(x * 10) / 10;
  const rows = Object.entries(T).map(([nm, t]) => { const g = t[0]; return [nm, g, ...t.slice(1).map(x => r1(x / g)), null]; }).sort((a, b) => b[3] - a[3]);
  const ser = r => '[' + r.map(v => v == null ? 'null' : typeof v === 'number' ? String(v) : JSON.stringify(v)).join(',') + ']';
  const next = 'const CH_STATS=[' + rows.map(ser).join(',') + '];';
  const cur = /const CH_STATS=\[[\s\S]*?\];/.exec(html);
  if (!cur) { console.log('charge-stats: CH_STATS not found'); process.exit(0); }
  if (cur[0] === next) { console.log('charge-stats: nothing new'); process.exit(0); }
  fs.writeFileSync(IDX, html.replace(cur[0], next));
  console.log(`charge-stats: ${rows.length} players over ${Object.keys(box).length} game(s)`);
} catch (e) { console.log('charge-stats:', String(e).slice(0, 200)); }
process.exit(0);
