// Every Cavs regular-season result since 1970-71, compact, for the schedule page's season pace, the season page's
// "Through N games" and the scouting report's record on this date (Nov 16). Built from data/hist-old.json (1970-2000)
// and data/hist-cle.json (2000-01 on). Past seasons don't change; rerun after a season ends.
// Writes pdata/hist-games.json { from, to, s: { '1970-71': [[mmdd, opp, cavs pts, opp pts, cavs threes made (2000-01 on)], ...] } } in date order.
import fs from 'fs';
const O = JSON.parse(fs.readFileSync('data/hist-old.json', 'utf8')).games, H = JSON.parse(fs.readFileSync('data/hist-cle.json', 'utf8')).games;
const s = {};
for (const g of [...O, ...H]) (s[g.s] = s[g.s] || []).push(g.tpm != null ? [g.d, g.o, g.p, g.op, g.tpm] : [g.d, g.o, g.p, g.op]);
for (const k in s) s[k] = s[k].sort((a, b) => a[0].localeCompare(b[0])).map(([d, o, p, op, t]) => t == null ? [d.slice(5, 7) + d.slice(8, 10), o, p, op] : [d.slice(5, 7) + d.slice(8, 10), o, p, op, t]);
const ks = Object.keys(s).sort();
fs.writeFileSync('pdata/hist-games.json', JSON.stringify({ from: ks[0], to: ks[ks.length - 1], s: Object.fromEntries(ks.map(k => [k, s[k]])) }));
console.log('hist-games:', ks.length, 'seasons', Object.values(s).reduce((a, x) => a + x.length, 0), 'games');
