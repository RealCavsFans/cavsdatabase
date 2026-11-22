// Game finder data (Nov 22, Luka, mock): every Cavs regular-season game since 1970-71 with the player lines, so the
// /game-finder page can answer "every 40-point game", "every win by 30", "every triple-double vs Boston".
// From data/hist-old.json (1970-2000), data/hist-cle.json (2000-01 to last season) and pdata/ps/<current season>.json.
// Writes pdata/game-finder.json { cols, n: [player names], g: [[season, date, opp, cavs pts, opp pts, [[name #, pts, reb, ast, 3pm, stl, blk], ...]]] }
// (names are stored once and referred to by number, which keeps the file small)
//   node scripts/game-finder.mjs
import fs from 'node:fs';
import { CUR_SEASON } from './season.mjs';
const J = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const G = [];
for (const g of [...J('data/hist-old.json').games, ...J('data/hist-cle.json').games])
  G.push([g.s, g.d, g.o, g.p, g.op, (g.pl || []).map(r => [r[0], +r[1] || 0, +r[2] || 0, +r[3] || 0, +r[4] || 0, r[5] == null ? null : +r[5], r[6] == null ? null : +r[6]])]);
/* this season from the player game logs (the NBA box scores) */
try { const P = J(`pdata/ps/${CUR_SEASON}.json`), ix = n => P.cols.indexOf(n), by = {};
  for (const p of Object.values(P.p)) for (const r of p.g || []) { const k = r[0]; const g = by[k] = by[k] || [CUR_SEASON, r[0], r[1], r[4], r[5], []];
    g[5].push([p.n, r[ix('pts')], r[ix('reb')], r[ix('ast')], r[ix('tpm')], r[ix('stl')], r[ix('blk')]]); }
  Object.values(by).forEach(g => { g[5].sort((a, b) => b[1] - a[1]); G.push(g); }); } catch (e) { console.log('no current season:', e.message); }
G.sort((a, b) => a[1].localeCompare(b[1]));
const N = [], NI = {}; for (const g of G) g[5] = g[5].map(r => { let i = NI[r[0]]; if (i == null) { i = NI[r[0]] = N.length; N.push(r[0]); } return [i, ...r.slice(1)].map(v => v == null ? -1 : v); });
fs.writeFileSync('pdata/game-finder.json', JSON.stringify({ cols: ['pts', 'reb', 'ast', '3pm', 'stl', 'blk'], n: N, g: G }));
console.log(`game-finder: ${G.length} games, ${G.reduce((t, g) => t + g[5].length, 0)} player lines, ${(fs.statSync('pdata/game-finder.json').size / 1024).toFixed(0)} KB`);
