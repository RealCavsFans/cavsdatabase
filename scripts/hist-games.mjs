// Every Cavs regular-season result since 1970-71, compact, for the schedule page's season pace, the season page's
// "Through N games" and the scouting report's record on this date (Nov 16). Built from data/hist-old.json (1970-2000)
// and data/hist-cle.json (2000-01 on). Past seasons don't change; rerun after a season ends.
// Writes pdata/hist-games.json { from, to, s: { '1970-71': [[mmdd, opp, cavs pts, opp pts, cavs threes made (2000-01 on, else null),
//   rebounds, assists, steals (1973-74 on, else null), blocks (1973-74 on, else null), turnovers (2000-01 on, else null)], ...] } } in date order.
// Nov 17 (Luka): rebounds, assists, steals, blocks and turnovers are the sums of the player lines in each game (pl: name, pts, reb, ast, 3pm, stl, blk).
import fs from 'fs';
const O = JSON.parse(fs.readFileSync('data/hist-old.json', 'utf8')).games, H = JSON.parse(fs.readFileSync('data/hist-cle.json', 'utf8')).games;
const s = {};
const sum = (g, i) => (g.pl || []).reduce((a, r) => a + (+r[i] || 0), 0);
const stlBlk = k => k >= '1973-74';
for (const g of [...O, ...H]) (s[g.s] = s[g.s] || []).push([g.d, g.o, g.p, g.op, g.tpm != null ? g.tpm : null, sum(g, 2), g.ast != null ? g.ast : sum(g, 3), stlBlk(g.s) ? sum(g, 5) : null, stlBlk(g.s) ? sum(g, 6) : null, g.to != null ? g.to : null]);
for (const k in s) s[k] = s[k].sort((a, b) => a[0].localeCompare(b[0])).map(([d, ...r]) => [d.slice(5, 7) + d.slice(8, 10), ...r]);
const ks = Object.keys(s).sort();
fs.writeFileSync('pdata/hist-games.json', JSON.stringify({ from: ks[0], to: ks[ks.length - 1], s: Object.fromEntries(ks.map(k => [k, s[k]])) }));
console.log('hist-games:', ks.length, 'seasons', Object.values(s).reduce((a, x) => a + x.length, 0), 'games');
