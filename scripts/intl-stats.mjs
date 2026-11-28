// Overseas draft rights: this season's league line from Basketball Reference's international pages (Nov 25, Luka: "why isn't
// his data filling up like Niang's?"). Niang's LSU games come from ESPN's college feed (fetch-niang.mjs); players abroad have no
// such feed, so each morning this reads their Basketball Reference international page and refreshes their RIGHTS_CARD line in
// index.html (games, points, rebounds, assists, FG%, minutes, steals, blocks, FT%). Only the current season's domestic-league
// row is used; the note keeps everything after its first sentence. Changes nothing if the page can't be read or looks wrong.
//   node scripts/intl-stats.mjs
import fs from 'node:fs';
import { CUR_SEASON } from './season.mjs';
const PLAYERS = { 'Ismael Kamagate': 'https://www.basketball-reference.com/international/players/ismael-kamagate-1.html' };
const LEAGUE = { LBA: 'Italian LBA', BSL: 'Turkish BSL', ACB: 'Spanish ACB', 'LNB Pro A': 'French LNB', BBL: 'German BBL' };
const f1 = v => Math.round(v * 10) / 10;
let html = fs.readFileSync('index.html', 'utf8'); const i0 = html.indexOf('const RIGHTS_CARD='), i1 = html.indexOf('\n', i0);
if (i0 < 0) { console.log('intl-stats: no RIGHTS_CARD'); process.exit(0); }
const lineSrc = html.slice(i0, i1), json = lineSrc.replace(/^const RIGHTS_CARD=/, '').replace(/;\s*$/, '');
let RC; try { RC = JSON.parse(json); } catch (e) { console.log('intl-stats: RIGHTS_CARD did not parse'); process.exit(0); }
let changed = 0;
for (const [name, url] of Object.entries(PLAYERS)) {
  const C = RC[name]; if (!C || !Array.isArray(C.s)) continue;
  let page; try { const r = await fetch(url, { headers: { 'user-agent': 'cavsdatabase.com (fan reference site)' } }); if (!r.ok) throw new Error(r.status); page = (await r.text()).replace(/<!--|-->/g, ''); } catch (e) { console.log(`intl-stats: ${name}: ${e.message}`); continue; }
  const tb = (page.match(/<table[^>]*id="player-stats-per_game-league-"[\s\S]*?<\/table>/) || [])[0]; if (!tb) { console.log(`intl-stats: ${name}: no league table`); continue; }
  const rows = [...tb.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map(m => Object.fromEntries([...m[1].matchAll(/data-stat="([^"]+)"[^>]*>([\s\S]*?)<\/t[dh]>/g)].map(x => [x[1], x[2].replace(/<[^>]+>/g, '').trim()])));
  const row = rows.filter(r => r.season === CUR_SEASON && +r.g > 0).pop(); if (!row) { console.log(`intl-stats: ${name}: no ${CUR_SEASON} row yet`); continue; }
  const n = k => row[k] === '' || row[k] == null ? null : +row[k];
  if (!(n('g') >= 1 && n('pts_per_g') != null)) { console.log(`intl-stats: ${name}: row looks wrong`); continue; }
  const pct = k => n(k) == null ? null : f1(n(k) * 100);
  const date = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' });
  const rest = String(C.s[9] || '').replace(/^[^.]*\(Basketball Reference\)\.\s*/, '');
  const s = [CUR_SEASON.replace('-', '–'), row.team || C.s[1], LEAGUE[row.league] || row.league || C.s[2], n('g'), f1(n('pts_per_g')), f1(n('trb_per_g')), f1(n('ast_per_g')), pct('fg_pct'), C.s[8] ?? null, `Through ${date} (Basketball Reference).${rest ? ' ' + rest : ''}`];
  const x = { ...(C.x || {}), mpg: f1(n('mp_per_g')), spg: f1(n('stl_per_g')), bpg: f1(n('blk_per_g')), ft: pct('ft_pct') };
  if (JSON.stringify(s.slice(0, 9)) === JSON.stringify(C.s.slice(0, 9)) && JSON.stringify(x) === JSON.stringify(C.x)) { console.log(`intl-stats: ${name}: no change`); continue; }
  C.s = s; C.x = x; changed++; console.log(`intl-stats: ${name}: ${s[3]} games, ${s[4]} pts, ${s[5]} reb, ${s[6]} ast (${s[1]}, ${s[2]})`);
}
if (changed) { html = html.slice(0, i0) + 'const RIGHTS_CARD=' + JSON.stringify(RC) + ';' + html.slice(i1); fs.writeFileSync('index.html', html); }
