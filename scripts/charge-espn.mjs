// Cleveland Charge results from ESPN (Nov 11, 2026, Luka). For every Charge game on or before today with no result yet,
// reads ESPN's G League scoreboard for that date, and when the game is final writes into CHARGE.games in index.html:
//   [4] result from the Charge's side ('W 118–110'), [6] the ESPN game link, [7] the lines of Cavs two-way and assignment players
//   who played ([[name, pts, reb, ast, min]]), and the Charge record.
// Also fills a missing box link or player lines for games that already have a result. Exits 0 on any problem.
//   node scripts/charge-espn.mjs            FORCE=1 to also re-check finished games
import fs from 'node:fs';
const IDX = new URL('../index.html', import.meta.url);
const html = fs.readFileSync(IDX, 'utf8');
const m = /const CHARGE=\{record:'([^']*)'[\s\S]*?games:(\[[\s\S]*?\]\])\};?/.exec(html);
if (!m) { console.log('charge-espn: CHARGE not found'); process.exit(0); }
const games = Function('return ' + m[2])();
const names = [];
for (const k of ['TWOWAY', 'INJ_ASSIGN']) { const r = new RegExp('const ' + k + '=(\\[[^;]*\\]);').exec(html); if (r) Function('return ' + r[1])().forEach(x => names.push(x[0])); }
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
const ours = new Set(names.map(norm));
const get = async u => { for (let i = 0; i < 3; i++) { try { const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 (cavsdatabase.com)' }, signal: AbortSignal.timeout(30000) }); if (r.ok) return await r.json(); console.log('HTTP', r.status, u); } catch (e) { console.log(String(e).slice(0, 100)); } await new Promise(r => setTimeout(r, 3000)); } return null; };
const API = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba-development';
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
const isCharge = c => /charge/i.test(((c.team || {}).displayName || '') + ' ' + ((c.team || {}).name || '')) && /cleveland/i.test(((c.team || {}).displayName || '') + ' ' + ((c.team || {}).location || ''));
let changed = 0;
for (const g of games) {
  if (g[0] > today) continue;
  const recent = (Date.parse(today) - Date.parse(g[0])) / 864e5 <= 3;
  const need = !g[4] || !g[6] || !g[7] || (recent && !(g[7] || []).length) || process.env.FORCE;
  if (!need) continue;
  const sb = await get(`${API}/scoreboard?dates=${g[0].replace(/-/g, '')}`);
  const ev = ((sb && sb.events) || []).find(e => ((e.competitions || [])[0] || {}).competitors?.some(isCharge));
  if (!ev) { console.log('charge-espn: no ESPN game for', g[0]); continue; }
  const c = ev.competitions[0], st = (c.status || ev.status || {}).type || {};
  if (!st.completed) { console.log('charge-espn:', g[0], 'not final'); continue; }
  const me = c.competitors.find(isCharge), op = c.competitors.find(x => x !== me), a = +me.score?.value || +me.score || 0, b = +op.score?.value || +op.score || 0;
  const res = (a > b ? 'W ' : 'L ') + a + '–' + b;
  while (g.length < 6) g.push('');
  const link = `https://www.espn.com/nba-g-league/game/_/gameId/${ev.id}`;
  /* the Cavs players' lines from the box score */
  let lines = [];
  const sum = await get(`${API}/summary?event=${ev.id}`);
  for (const tp of ((sum && sum.boxscore && sum.boxscore.players) || [])) {
    if (!isCharge({ team: tp.team })) continue;
    for (const grp of tp.statistics || []) {
      const lab = (grp.labels || grp.names || []).map(x => String(x).toUpperCase()), ix = k => lab.indexOf(k);
      for (const ath of grp.athletes || []) {
        const nm = (ath.athlete || {}).displayName; if (!ours.has(norm(nm)) || !ath.stats || !ath.stats.length) continue;
        const v = k => { const i = ix(k); return i < 0 ? 0 : parseInt(ath.stats[i], 10) || 0; };
        lines.push([nm, v('PTS'), v('REB'), v('AST'), v('MIN')]);
      }
    }
  }
  if (!lines.length) { const seen = []; for (const tp of ((sum && sum.boxscore && sum.boxscore.players) || [])) seen.push(((tp.team || {}).displayName || '?') + ': ' + (tp.statistics || []).flatMap(s => (s.athletes || []).map(a => (a.athlete || {}).displayName)).slice(0, 18).join(', ')); console.log('charge-espn: box score players seen ->', seen.join(' | ') || 'none', '· looking for', names.join(', ')); }
  const before = JSON.stringify(g);
  g[4] = res; if (!g[5]) g[5] = ''; g[6] = g[6] || link; g[7] = lines;
  if (JSON.stringify(g) !== before) { changed++; console.log('charge-espn:', g[0], g[1], res, lines.length ? JSON.stringify(lines) : '(no Cavs players listed)'); }
}
if (!changed) { console.log('charge-espn: nothing new'); process.exit(0); }
const w = games.filter(g => /^W/.test(g[4] || '')).length, l = games.filter(g => /^L/.test(g[4] || '')).length;
const q = s => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
const ser = v => Array.isArray(v) ? '[' + v.map(ser).join(',') + ']' : typeof v === 'number' ? String(v) : q(v);
const rows = []; for (let i = 0; i < games.length; i += 3) rows.push('  ' + games.slice(i, i + 3).map(ser).join(','));
let out = html.slice(0, m.index) + m[0].replace(m[2], '[\n' + rows.join(',\n') + ']').replace(/record:'[^']*'/, `record:'${w}–${l}'`) + html.slice(m.index + m[0].length);
fs.writeFileSync(IDX, out);
console.log(`charge-espn: ${changed} game(s) updated · record ${w}–${l}`);
