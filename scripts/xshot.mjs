// Nov 16 (Luka): expected shot model with context, after Darryl Blackport's play-by-play shot quality model (pbpstats).
// Each shot is placed by zone (the site's five zones) and by how the play got there:
//   putback (tip or shot within 3 seconds of an offensive rebound), transition (within 7 seconds of a steal or defensive
//   rebound), then the rest by seconds since the play started: 0-10, 11-17, 18+ (a stand-in for the shot clock).
// Its expected make rate = this season's NBA make rate in that zone x how much more or less often that kind of shot goes in
// within the zone (last season and this season pooled, so small cells stay steady; cells under 150 shots lean on the zone rate).
// So the model's league total equals the plain zone model's, and only the mix of shots moves a team up or down.
// Writes pdata/xshot.json: { season, updated, ctx, p: [zone][ctx] make rate, n: [zone][ctx] shots this season,
//   t: { team: [FGA, expected points, points] } offense, o: same for what each team allowed }.
// Usage: node scripts/xshot.mjs <nba-data dir>. Exits 0 on any problem and leaves the old file alone.
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { createRequire } from 'module';
import { loadFixes, applyFixes } from './nba-fixes.mjs';
const C = createRequire(import.meta.url)('../live-core.js');
const ROOT = process.argv[2] || 'nba-data', SEASON = process.env.SEASON || '2026-27';
const PREV = (+SEASON.slice(0, 4) - 1) + '-' + SEASON.slice(2, 4);
const CTX = ['Putback', 'Transition', '0–10 sec into the play', '11–17 sec', '18+ sec'];
const ctxOf = q => q.pt === 0 ? 0 : q.pt === 1 ? 1 : q.dt == null ? null : q.dt <= 10 ? 2 : q.dt <= 17 ? 3 : 4;
const FIX = loadFixes(ROOT), NZ = C.ZN.length, K = 150;
const grid = () => Array.from({ length: NZ }, () => Array.from({ length: CTX.length }, () => [0, 0]));
const pool = grid(), cur = grid(), shotsCur = [];
let games = 0; const AFT = {};   // every NBA possession this season by how the other team's possession before it ended: [possessions, points]
for (const se of [PREV, SEASON]) {
  const DIR = path.join(ROOT, se); if (!fs.existsSync(DIR)) continue;
  for (const f of fs.readdirSync(DIR).filter(f => /^002\d+\.json\.gz$/.test(f))) {
    try {
      const gid = f.slice(0, 10), raw = applyFixes(JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(DIR, f)))), FIX[gid]);
      const D = C.prep(C.slimSummary(C.fromNBA({ game: raw.box }, { game: raw.pbp }))); if (!D.plays.length) continue;
      const R = C.deriveCore(D, D.plays, 'all'), ab = {};
      if (se === SEASON) { let cur = {}; for (const q of R.PL || []) { if (q.how === 'oreb') { if (cur[q.team]) cur[q.team][1] += q.pts || 0; continue; } const k = q.how === 'dreb' ? 'z' + (q.mz == null ? 'x' : q.mz) : q.how, v = AFT[k] = AFT[k] || [0, 0]; v[0]++; v[1] += q.pts || 0; cur[q.team] = v; } }   /* points after an offensive rebound stay with the possession */ D.teams.forEach(t => ab[t.id] = t.abbr);
      for (const q of R.shots) { const c = ctxOf(q); if (c == null || q.zi == null) continue; const cell = pool[q.zi][c]; cell[1]++; if (q.m) cell[0]++;
        if (se === SEASON) { const c2 = cur[q.zi][c]; c2[1]++; if (q.m) c2[0]++; const o = D.teams.find(t => t.id !== q.t); shotsCur.push([ab[q.t], o && o.abbr, q.zi, c, q.m ? 1 : 0]); } }
      if (se === SEASON) games++;
    } catch (e) { console.log('xshot: could not read', f, String(e).slice(0, 80)); }
  }
}
if (games < 20) { console.log('xshot: only', games, 'games, file left alone'); process.exit(0); }
// zone rates this season, and each context's ratio within the zone from both seasons (shrunk toward 1 when the cell is small)
const zr = cur.map(row => { const m = row.reduce((s, x) => s + x[0], 0), a = row.reduce((s, x) => s + x[1], 0); return a ? m / a : 0; });
const zp = pool.map(row => { const m = row.reduce((s, x) => s + x[0], 0), a = row.reduce((s, x) => s + x[1], 0); return a ? m / a : 0; });
let P = pool.map((row, z) => row.map(([m, a]) => { const r = a ? (m + K * zp[z]) / (a + K) / zp[z] : 1; return zr[z] * r; }));
// rescale each zone so the model's expected makes this season equal the real makes (keeps it equal to the plain zone model)
P = P.map((row, z) => { const ex = row.reduce((s, p, c) => s + p * cur[z][c][1], 0), real = cur[z].reduce((s, x) => s + x[0], 0); const k = ex ? real / ex : 1; return row.map(p => +(Math.min(.98, p * k)).toFixed(4)); });
const val = z => z >= 3 ? 3 : 2, T = {}, O = {};
for (const [t, o, z, c, m] of shotsCur) { const xp = P[z][c] * val(z), ap = m * val(z);
  const a = T[t] = T[t] || [0, 0, 0]; a[0]++; a[1] += xp; a[2] += ap; if (o) { const b = O[o] = O[o] || [0, 0, 0]; b[0]++; b[1] += xp; b[2] += ap; } }
const rnd = o => { for (const v of Object.values(o)) { v[1] = Math.round(v[1] * 10) / 10; } return o; };
const out = { season: SEASON, updated: new Date().toISOString(), games, ctx: CTX, zones: C.ZN.map(z => z[1]), p: P, n: cur.map(r => r.map(x => x[1])), t: rnd(T), o: rnd(O), after: AFT };
fs.writeFileSync('pdata/xshot.json', JSON.stringify(out));
console.log(`xshot: ${games} games, ${shotsCur.length} shots; CLE expected eFG ${(T.CLE[1] / (2 * T.CLE[0]) * 100).toFixed(1)}%, actual ${(T.CLE[2] / (2 * T.CLE[0]) * 100).toFixed(1)}%`);
P.forEach((row, z) => console.log('  ' + C.ZN[z][1].padEnd(18), row.map((p, c) => (p * 100).toFixed(0) + '% (' + cur[z][c][1] + ')').join('  ')));
