// RAPM, regularized adjusted plus-minus (Nov 25, Luka). The published method: Rosenbaum's adjusted plus-minus (2004) with the ridge
// regularization and out-of-sample choice of the penalty from Joe Sill, "Improved NBA Adjusted +/- Using Regularization and
// Out-of-Sample Testing" (MIT Sloan Sports Analytics Conference, 2010). Nothing of our own is added to the model.
//
// Data: every regular season game in the NBA game store (nba-data branch), read with live-core.js like every other stat on the site.
// Each possession carries the five on offense and the five on defense when it started (a possession continues through its offensive
// rebounds, so its points include second chances). Possessions with the same ten players are added up into one row (a stint).
//
// Model, per stint i with n_i possessions and points per 100 possessions y_i:
//   y_i = mu + h * (offense is the home team) + sum of the five offensive players' O - sum of the five defensive players' D + error,
// weighted by n_i, solved by ridge regression (penalty lambda on every player's O and D, none on mu and h). O is points per 100
// possessions a player adds on offense, D is points per 100 he takes away on defense (higher is better for both), RAPM = O + D.
// lambda is the one that best predicts held-out games: games are split into 5 groups, the model is fit on 4 and scored on the 5th
// (possession-weighted squared error), for each lambda on a grid.
//
//   NBA_DIR=nba-data node scripts/rapm.mjs 2025-26                 -> pdata/rapm-2025-26.json
//   NBA_DIR=nba-data node scripts/rapm.mjs 2023-24 2024-25 2025-26  -> pdata/rapm-2023-24-to-2025-26.json (one fit over all three)
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { loadFixes, applyFixes } from './nba-fixes.mjs';
const C = createRequire(import.meta.url)('../live-core.js');
const NBA_DIR = process.env.NBA_DIR || 'nba-data', FIX = loadFixes(NBA_DIR);
const SEASONS = process.argv.slice(2).filter(a => /^\d{4}-\d\d$/.test(a));
if (!SEASONS.length) { console.log('usage: node scripts/rapm.mjs <season> [season ...]'); process.exit(1); }
const LAMBDAS = (process.env.LAMBDAS || '250,500,1000,1500,2000,3000,4000,6000,9000').split(',').map(Number);
const AB = { GSW: 'GS', NOP: 'NO', NYK: 'NY', SAS: 'SA', UTA: 'UTAH', WAS: 'WSH' };

/* ---------- stints ---------- */
const NAME = {}, TEAM = {}, PIDX = new Map(), pid = id => { if (!PIDX.has(id)) PIDX.set(id, PIDX.size); return PIDX.get(id); };
const stints = [];   // { o:[5 idx], d:[5 idx], h:0/1, n, pts, g }
let games = 0, skipped = 0;
for (const SEASON of SEASONS) {
  const dir = path.join(NBA_DIR, SEASON); if (!fs.existsSync(dir)) { console.log(`rapm: no store for ${SEASON}`); continue; }
  for (const f of fs.readdirSync(dir).filter(f => /^002\d+\.json\.gz$/.test(f)).sort()) {
    const gid = f.slice(0, 10); let raw;
    try { raw = applyFixes(JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, f)))), FIX[gid]); } catch { skipped++; continue; }
    const B = raw.box; if (!B || B.gameStatus !== 3) { skipped++; continue; }
    let D, R; try { D = C.prep(C.slimSummary(C.fromNBA({ game: B }, { game: raw.pbp }))); R = C.deriveCore(D, D.plays, 'all'); } catch { skipped++; continue; }
    for (const t of [B.awayTeam, B.homeTeam]) for (const p of t.players || []) { NAME[p.personId] = (p.firstName + ' ' + p.familyName).trim(); TEAM[p.personId] = AB[t.teamTricode] || t.teamTricode; }
    const homeId = D.home && D.home.id, gi = games, M = new Map(); let cur = null;
    for (const q of R.PL || []) {
      const on = (q.on || '').split(',').filter(Boolean), od = (q.od || '').split(',').filter(Boolean);
      if (q.how === 'oreb' && cur && cur.team === q.team) { cur.row.pts += q.pts || 0; continue; }   // second chance: same possession
      if (on.length !== 5 || od.length !== 5) { cur = null; continue; }
      const key = q.team + '|' + on.join(',') + '|' + od.join(',');
      let row = M.get(key); if (!row) { row = { o: on.map(x => pid(String(x))), d: od.map(x => pid(String(x))), h: q.team === homeId ? 1 : 0, n: 0, pts: 0, g: gi }; M.set(key, row); }
      row.n++; row.pts += q.pts || 0; cur = { team: q.team, row };
    }
    for (const row of M.values()) stints.push(row);
    games++;
  }
}
const P = PIDX.size, K = 2 * P + 1;   // columns: O for each player, D for each player, home
const ids = [...PIDX.keys()];
const totN = stints.reduce((a, s) => a + s.n, 0), totPts = stints.reduce((a, s) => a + s.pts, 0);
console.log(`rapm ${SEASONS.join(', ')}: ${games} games (${skipped} skipped), ${stints.length} stints, ${totN} possessions, ${P} players, ${(100 * totPts / totN).toFixed(1)} pts/100`);

/* ---------- ridge fit: (X'WX + lambda I) b = X'W(y - mu), mu = weighted mean, home column not penalized ---------- */
function normal(rows) {
  const A = new Float64Array(K * K), b = new Float64Array(K); let sw = 0, swy = 0;
  for (const s of rows) { if (!s.n) continue; sw += s.n; swy += s.pts * 100; }
  const mu = swy / sw;
  const cols = s => { const c = [], v = []; for (const i of s.o) { c.push(i); v.push(1); } for (const i of s.d) { c.push(P + i); v.push(-1); } if (s.h) { c.push(2 * P); v.push(1); } return [c, v]; };
  for (const s of rows) {
    if (!s.n) continue; const w = s.n, y = 100 * s.pts / s.n - mu, [c, v] = cols(s);
    for (let a = 0; a < c.length; a++) { b[c[a]] += w * v[a] * y; const ra = c[a] * K; for (let z = 0; z < c.length; z++) A[ra + c[z]] += w * v[a] * v[z]; }
  }
  return { A, b, mu };
}
function solve(N, lambda) {   // Cholesky on a copy with the ridge added
  const A = Float64Array.from(N.A), b = Float64Array.from(N.b);
  for (let i = 0; i < 2 * P; i++) A[i * K + i] += lambda;
  A[(K - 1) * K + K - 1] += 1e-6;
  for (let j = 0; j < K; j++) {
    let s = A[j * K + j]; for (let k = 0; k < j; k++) s -= A[j * K + k] * A[j * K + k];
    const d = Math.sqrt(Math.max(s, 1e-12)); A[j * K + j] = d;
    for (let i = j + 1; i < K; i++) { let t = A[i * K + j]; for (let k = 0; k < j; k++) t -= A[i * K + k] * A[j * K + k]; A[i * K + j] = t / d; }
  }
  const y = new Float64Array(K); for (let i = 0; i < K; i++) { let t = b[i]; for (let k = 0; k < i; k++) t -= A[i * K + k] * y[k]; y[i] = t / A[i * K + i]; }
  const x = new Float64Array(K); for (let i = K - 1; i >= 0; i--) { let t = y[i]; for (let k = i + 1; k < K; k++) t -= A[k * K + i] * x[k]; x[i] = t / A[i * K + i]; }
  return x;
}
const pred = (x, mu, s) => { let v = mu + (s.h ? x[2 * P] : 0); for (const i of s.o) v += x[i]; for (const i of s.d) v -= x[P + i]; return v; };

/* ---------- lambda by 5-fold cross-validation over games ---------- */
const FOLDS = 5, foldOf = g => (g * 2654435761 >>> 0) % FOLDS;   // games spread over the folds evenly, the same way every run
const cvErr = {}; LAMBDAS.forEach(l => cvErr[l] = 0); let cvN = 0;
for (let k = 0; k < FOLDS; k++) {
  const tr = stints.filter(s => foldOf(s.g) !== k), te = stints.filter(s => foldOf(s.g) === k && s.n);
  const N = normal(tr);
  for (const l of LAMBDAS) { const x = solve(N, l); let e = 0; for (const s of te) { const r = 100 * s.pts / s.n - pred(x, N.mu, s); e += s.n * r * r; } cvErr[l] += e; }
  cvN += te.reduce((a, s) => a + s.n, 0);
}
const best = LAMBDAS.reduce((a, l) => cvErr[l] < cvErr[a] ? l : a, LAMBDAS[0]);
console.log('rapm cross-validation (possession-weighted RMSE, pts/100): ' + LAMBDAS.map(l => `${l}: ${Math.sqrt(cvErr[l] / cvN).toFixed(3)}`).join(' · ') + ` -> lambda ${best}`);

/* ---------- final fit on every game ---------- */
const N = normal(stints), x = solve(N, best);
const poss = new Float64Array(P), dposs = new Float64Array(P);
for (const s of stints) { for (const i of s.o) poss[i] += s.n; for (const i of s.d) dposs[i] += s.n; }
const r1 = v => Math.round(v * 100) / 100;
const players = {};
ids.forEach((id, i) => { players[id] = { n: NAME[id] || id, t: TEAM[id] || '', o: r1(x[i]), d: r1(x[P + i]), rapm: r1(x[i] + x[P + i]), op: Math.round(poss[i]), dp: Math.round(dposs[i]) }; });
const label = SEASONS.length === 1 ? SEASONS[0] : SEASONS[0] + '-to-' + SEASONS[SEASONS.length - 1];
const out = { seasons: SEASONS, updated: new Date().toISOString(), method: 'Ridge-regularized adjusted plus-minus (Sill, MIT Sloan 2010): stints of the same ten players, points per 100 possessions weighted by possessions, offense and defense apart, home court in the model, penalty chosen by 5-fold cross-validation over games', lambda: best, cv: Object.fromEntries(LAMBDAS.map(l => [l, r1(Math.sqrt(cvErr[l] / cvN))])), mu: r1(N.mu), home: r1(x[2 * P]), games, stints: stints.length, possessions: totN, players };
const file = process.env.OUT || `pdata/rapm-${label}.json`;
fs.writeFileSync(file, JSON.stringify(out));
const top = Object.values(players).filter(p => p.op + p.dp > 3000).sort((a, b) => b.rapm - a.rapm);
console.log(`rapm -> ${file}: lambda ${best}, home ${out.home}. Top: ` + top.slice(0, 10).map(p => `${p.n} ${p.rapm > 0 ? '+' : ''}${p.rapm}`).join(', '));
