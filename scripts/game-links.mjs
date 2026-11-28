// Box score link for every Cavs game (Nov 22, Luka): the vs pages' last 10 meetings, the playoff series games and the game finder
// link each game to the cavsdb box score when we have one, otherwise to Basketball Reference's.
//   cavsdb: this season -> /games/<date>-<opp> ('g'); 2020-21 on -> the archived game on the live page ('a:<season>:<id>')
//   Basketball Reference: 1970-2000 from data/hist-old.json (its box ids); 2000-01 to 2019-20 from data/bbref-away-2000-2020.txt
//   (the away games with the home team's code, read from Basketball Reference's season schedules; every other game was at home)
// Writes pdata/game-links.json { l: { 'YYYY-MM-DD': 'g' | 'a:<season>:<id>' | 'b:<bbref box id>' }, po: { <season>: [[date, opp, cavs, opp pts, link]] } }
//   node scripts/game-links.mjs
import fs from 'node:fs';
import { CUR_SEASON } from './season.mjs';
const J = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const L = {}, PO = {}; let bad = 0;
for (const g of J('data/hist-old.json').games) if (g.box) L[g.d] = 'b:' + g.box;
const away = {}; for (const t of fs.readFileSync('data/bbref-away-2000-2020.txt', 'utf8').trim().split(',')) { const d = '20' + t.slice(0, 2) + '-' + t.slice(2, 4) + '-' + t.slice(4, 6); away[d] = t.slice(6); }
const BB = (o, se) => ({ BKN: 'BRK', PHX: 'PHO', CHA: se >= '2014-15' ? 'CHO' : 'CHA' })[o] || o;
for (const g of J('data/hist-cle.json').games) { if (g.s >= '2020-21') continue; const ymd = g.d.replace(/-/g, '');
  if (away[g.d]) { if (away[g.d] !== BB(g.o, g.s)) { bad++; console.log('::warning::game-links: ' + g.d + ' away code ' + away[g.d] + ' vs ' + g.o); } L[g.d] = 'b:' + ymd + '0' + away[g.d]; }
  else L[g.d] = 'b:' + ymd + '0CLE'; }
for (const se of fs.readdirSync('live-archive').filter(s => /^\d{4}-\d\d$/.test(s)).sort()) {
  const ix = (() => { try { return J(`live-archive/${se}/index.json`); } catch { return []; } })();
  for (const g of ix) if (g.id && g.et) L[g.et] = se === CUR_SEASON ? 'g' : 'a:' + se + ':' + g.id;
  let po = []; try { po = J(`live-archive/${se}/po/index.json`); } catch {}
  if (po.length) PO[se] = po.filter(g => g.id && g.et).sort((a, b) => a.et.localeCompare(b.et)).map(g => { const k = 'a:' + se + ':' + g.id; L[g.et] = k; return [g.et, g.opp, g.cle, g.os, k]; });
}
const out = JSON.stringify({ l: Object.fromEntries(Object.entries(L).sort()), po: PO });
fs.writeFileSync('pdata/game-links.json', out);
console.log(`game-links: ${Object.keys(L).length} games (${Object.values(L).filter(v => v[0] !== 'b').length} cavsdb), ${Object.values(PO).flat().length} playoff games, ${bad} code mismatches, ${(out.length / 1024).toFixed(0)} KB`);
