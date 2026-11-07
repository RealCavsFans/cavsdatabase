// "Last time this happened": for every finished Cavs game this season, the box-score feats that hadn't
// happened in a long time (most points since…, first 40-point game by a Cav since…, longest win streak since…).
// History: data/hist-cle.json (Cavs regular-season game logs back to 2000–01 from pbpstats, one-time pull,
// pulled once in Oct 2026; players' lines checked to add up to the team's points in every game) plus this season's archived games. Writes data/last-time.json, read by the
// game page (Team tab, under the Recap) and the newsletter.
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const C = require('../live-core.js');
const root = new URL('../', import.meta.url);
const SEASON = process.env.SEASON || '2026-27';
const NBA = { NY: 'NYK', GS: 'GSW', SA: 'SAS', NO: 'NOP', UTAH: 'UTA', WSH: 'WAS' };
const MIN_GAP = +(process.env.MIN_GAP || 60);   // only report a feat if it last happened at least this many games ago
const H = JSON.parse(await readFile(new URL('data/hist-cle.json', root), 'utf8'));
const FIRST = H.from;   // first season in the logs, e.g. 2000-01

// history games, oldest first: {d, s, o, home?, p, op, tpm, ast, reb, to, pl:[[name, pts, reb, ast, tpm, stl, blk]]}
const DEMO = process.env.DEMO;   // e.g. DEMO=2025-26 replays a past season from the logs (for testing)
const G = H.games.filter(g => !DEMO || g.s < DEMO);
let idx = []; try { idx = JSON.parse(await readFile(new URL(`live-archive/${SEASON}/index.json`, root), 'utf8')); } catch {}
if (DEMO) idx = [];
idx.sort((a, b) => a.et < b.et ? -1 : 1);
const cur = [];
for (const g of idx) {
  try {
    const s = JSON.parse(await readFile(new URL(`live-archive/${SEASON}/${g.id}.json`, root), 'utf8'));
    const D = C.prep(s), R = C.deriveCore(D, D.plays, 'all'); const o = Object.keys(R.T).find(k => k !== '5');
    const a = R.T['5'], b = R.T[o];
    const pl = Object.entries(R.B).filter(([id]) => D.P[id] && D.P[id].team === '5' && R.B[id].played).map(([id, x]) => [D.P[id].name, x.pts, x.oreb + x.dreb, x.ast, x.tpm, x.stl, x.blk]);
    cur.push({ id: g.id, d: g.et, s: SEASON, o: NBA[g.opp] || g.opp, p: a.pts, op: b.pts, tpm: a.tpm, ast: a.ast, reb: a.oreb + a.dreb + (a.toreb || 0) + (a.tdreb || 0), to: a.to, pl });
  } catch (e) { console.log('last-time: could not rebuild', g.id, String(e)); }
}

const fmtD = d => { const [y, m, dd] = d.split('-').map(Number); return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1] + ' ' + dd + ', ' + y; };
const seasonLab = s => s.replace('-', '–');
const out = {};
if (DEMO) H.games.filter(g => g.s === DEMO).forEach((g, i) => cur.push(Object.assign({ id: DEMO + '-' + i }, g)));
const all = G.concat(cur);
for (const g of cur) {
  const i = all.indexOf(g), past = all.slice(0, i).reverse();   // most recent first
  const notes = [];
  // a feat: value v for game g; find the most recent past game that matched or beat it
  // a feat: value v; find the most recent past game that matched or beat it. Each note = {n: big number, l: label, t: the sentence}
  const ag = p => (p.o ? 'against ' + p.o + ', ' : '') + fmtD(p.d);
  const href = p => p.s === SEASON ? 'games/' + p.d + '-' + String(p.o).toLowerCase() : 'history/' + p.s;
  const lk = p => ({ h: href(p), a: ag(p) });
  const feat = (score, v, better, n, l, prevTxt) => {
    if (v == null) return;
    let k = 0, hit = null;
    for (const p of past) { const pv = score(p); if (pv != null && (better > 0 ? pv >= v : pv <= v)) { hit = { p, pv }; break; } k++; }
    if (k < MIN_GAP) return;
    notes.push({ gap: hit ? k : 1e6, n, l, ...(hit ? lk(hit.p) : {}), t: hit ? prevTxt(hit.p, hit.pv) : 'The ' + (better > 0 ? 'most' : 'fewest') + ' in any Cavs game since at least ' + seasonLab(FIRST) + ', as far back as these logs go' });
  };
  const win = g.p > g.op, m = g.p - g.op;
  feat(p => p.p, g.p, 1, g.p, 'points', (p, v) => `Most since scoring ${v} ${ag(p)}`);
  feat(p => p.op, g.op, -1, g.op, 'points allowed', (p, v) => `Fewest since allowing ${v} ${ag(p)}`);
  feat(p => p.op, g.op, 1, g.op, 'points allowed', (p, v) => `Most since allowing ${v} ${ag(p)}`);
  if (win) feat(p => p.p - p.op, m, 1, '+' + m, 'win margin', (p, v) => `Biggest win since a ${v}-point win ${ag(p)}`);
  else feat(p => p.op - p.p, -m, 1, '−' + (-m), 'loss margin', (p, v) => `Worst loss since a ${v}-point loss ${ag(p)}`);
  feat(p => p.tpm, g.tpm, 1, g.tpm, 'threes', (p, v) => `Most since making ${v} ${ag(p)}`);
  feat(p => p.ast, g.ast, 1, g.ast, 'assists', (p, v) => `Most since ${v} ${ag(p)}`);
  feat(p => p.to, g.to, -1, g.to, 'turnovers', (p, v) => `Fewest since ${v} ${ag(p)}`);
  // players: best single-game number by any Cav
  const cats = [[1, 'points'], [2, 'rebounds'], [3, 'assists'], [4, 'threes'], [5, 'steals'], [6, 'blocks']];
  for (const [c, lab] of cats) {
    const best = g.pl.reduce((a, r) => (!a || r[c] > a[c] ? r : a), null); if (!best || !best[c]) continue;
    feat(p => Math.max(...(p.pl || []).map(r => r[c]), -1), best[c], 1, best[c], best[0].split(' ').slice(-1)[0] + ' ' + lab,
      (p, v) => { const r = p.pl.find(x => x[c] === v); return `${best[0]}: most by a Cav since ${r[0] === best[0] ? 'his own' : r[0] + '’s'} ${v} ${ag(p)}`; });
  }
  // triple-doubles
  const td = g.pl.filter(r => [r[1], r[2], r[3], r[5], r[6]].filter(x => x >= 10).length >= 3);
  for (const r of td) { let k = 0, hit = null; for (const p of past) { const q = (p.pl || []).find(x => [x[1], x[2], x[3], x[5], x[6]].filter(y => y >= 10).length >= 3); if (q) { hit = { p, q }; break; } k++; }
    if (k >= MIN_GAP) notes.push({ gap: hit ? k : 1e6, ...(hit ? lk(hit.p) : {}), n: r[1] + '-' + r[2] + '-' + r[3], l: r[0].split(' ').slice(-1)[0] + ' triple-double', t: `${r[0]}: first Cavs triple-double since ${hit ? (hit.q[0] === r[0] ? 'his own ' : hit.q[0] + '’s ') + ag(hit.p) : 'at least ' + seasonLab(FIRST)}` }); }
  // streaks
  let st = 0; for (const p of [g].concat(past)) { if ((p.p > p.op) === win) st++; else break; }
  if (st >= 4) { let run = 0, k = 0, hit = null; const ord = past.slice().reverse(); const runs = [];
    ord.forEach(p => { if ((p.p > p.op) === win) run++; else run = 0; runs.push(run); });
    for (let j = runs.length - 1; j >= 0; j--) { if (runs[j] >= st) { hit = ord[j]; hit.run = runs[j]; break; } k++; }
    if (k >= MIN_GAP) notes.push({ gap: hit ? k : 1e6, ...(hit ? { h: href(hit), a: fmtD(hit.d) } : {}), n: st, l: win ? 'wins in a row' : 'losses in a row', t: `Longest ${win ? 'winning' : 'losing'} streak since ${hit ? 'the ' + hit.run + (win ? ' straight wins' : ' straight losses') + ' through ' + fmtD(hit.d) : 'at least ' + seasonLab(FIRST)}` }); }
  out[g.id] = { d: g.d, o: g.o, notes: notes.sort((a, b) => b.gap - a.gap).slice(0, 4).map(({ n, l, t, h, a }) => ({ n: String(n), l, t, h, a })) };
}
if (!DEMO) await writeFile(new URL('data/last-time.json', root), JSON.stringify({ season: SEASON, from: FIRST, games: out }, null, 1) + '\n');
for (const [id, x] of Object.entries(out)) console.log(x.d, x.o, x.notes);
