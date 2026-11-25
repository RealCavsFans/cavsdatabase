// Nov 16 (Luka): every NBA player's rate stats counted on the floor, the same way the Cavs' are (live-core.js five-man units),
// from the NBA's own play-by-play in the NBA game store (nba-data branch). Replaces the Basketball Reference style estimates
// (minute share of team totals) in the league percentiles, so a Cav's number and the pool he's ranked in are counted alike.
// Each game is read once and its per-player sums cached in data/league-rates-cache.json; the store re-checks the last 7 days,
// so a game whose saved copy changed is read again. Writes pdata/league-rates.json:
//   { season, updated, games, cols, p: { "<NBA person id>": [name, team, ...cols] } }   (sums for the season, regular season only)
// Usage: node scripts/league-rates.mjs <nba-data dir>. Exits 0 on any problem and leaves the old file alone.
import { CUR_SEASON } from './season.mjs';   // Nov 21: the season from one place
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { createRequire } from 'module';
import { loadFixes, applyFixes } from './nba-fixes.mjs';
const C = createRequire(import.meta.url)('../live-core.js');
const SEASON = process.env.SEASON || CUR_SEASON, ROOT = process.argv[2] || 'nba-data', DIR = path.join(ROOT, SEASON);
const OUT = 'pdata/league-rates.json', CACHE = 'data/league-rates-cache.json';
// per player per game: his own numbers, then what his team and the opponent did while he was on the floor
const COLS = ['g', 'sec', 'fgm', 'fga', 'fta', 'to', 'ast', 'stl', 'blk', 'oreb', 'dreb', 'tFGM', 'tFGA', 'tFTA', 'tTO', 'tORB', 'tDRB', 'oORB', 'oDRB', 'o2A', 'po', 'pd'];
let idx; try { idx = JSON.parse(fs.readFileSync(path.join(DIR, 'index.json'), 'utf8')); } catch { console.log('league-rates: no NBA store here'); process.exit(0); }
let cache = {}; try { const c = JSON.parse(fs.readFileSync(CACHE, 'utf8')); if (c.season === SEASON && c.v === 2) cache = c.g || {}; /* v2 (Nov 24): rebound chances with team rebounds */ } catch {}
const FIX = loadFixes(ROOT);
let read = 0, failed = 0;
for (const [gid, row] of Object.entries(idx)) {
  if (!/^002/.test(gid)) continue;                        // regular season (NBA Cup group games included); no preseason, play-in or playoffs
  const stamp = String(row[5] || ''), hit = cache[gid];
  if (hit && hit.s === stamp && hit.t && hit.z && hit.dk) continue;
  try {
    const raw = applyFixes(JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(DIR, gid + '.json.gz')))), FIX[gid]);
    const D = C.prep(C.slimSummary(C.fromNBA({ game: raw.box }, { game: raw.pbp }))); if (!D.plays.length) continue;
    const R = C.deriveCore(D, D.plays, 'all'), out = {};
    for (const t of D.teams) {
      const L5 = Object.values((R.L[t.id] || {})[5] || {});
      for (const id of D.roster[t.id]) {
        const b = R.B[id]; if (!b || !(b.min > 0)) continue;
        const on = L5.filter(l => l.ids.includes(id)), sm = (sd, k) => on.reduce((s, l) => s + ((l[sd] || {})[k] || 0), 0);
        out[id] = [D.P[id].name, t.abbr, 1, Math.round(b.min), b.fgm, b.fga, b.fta, b.to, b.ast, b.stl, b.blk, b.oreb, b.dreb,
          sm('o', 'fgm'), sm('o', 'fga'), sm('o', 'fta'), sm('o', 'to'), sm('o', 'oreb'), sm('o', 'dreb'), sm('d', 'oreb'), sm('d', 'dreb') /* Nov 24 audit: rebound chances include team rebounds, as NBA.com */, sm('d', 'fga') - sm('d', 'tpa'),
          Math.round(on.reduce((s, l) => s + C.poss(l.o), 0) * 10) / 10, Math.round(on.reduce((s, l) => s + C.poss(l.d), 0) * 10) / 10];
      }
    }
    /* Nov 16 (Luka): each team's counted possessions too (offense and defense), so team ratings, net rating ranks and tiers use the same count */
    const tm = {}; const d8 = String(row[0] || ''), day = d8.slice(0, 4) + '-' + d8.slice(4, 6) + '-' + d8.slice(6, 8);
    for (const t of D.teams) { const o = D.teams.find(x => x !== t), A = R.T[t.id], B = R.T[o.id]; if (!(A.np > 0) || !(B.np > 0)) continue; tm[t.abbr] = [day, A.np, B.np, A.pts, B.pts, A.sec || 2880]; }
    /* Nov 16 (Luka): every player's makes and attempts in the site's five shot zones (same zone lines as the shot charts and the NBA average), for the zone rank card */
    const zz = {}; for (const sh of R.shots || []) { if (!sh.id || sh.zi == null || !out[sh.id]) continue; const v = zz[sh.id] || (zz[sh.id] = Array(10).fill(0)); v[2 * sh.zi + 1]++; if (sh.m) v[2 * sh.zi]++; }
    /* Nov 16 (Luka): made dunks for every player (the NBA's own shot type), so a Cav's dunk total can be compared with the league */
    const dk = {}; for (const q of D.plays) { if (!q.sc || !/dunk/i.test(String(q.type || '') + ' ' + String(q.text || ''))) continue; const a = (q.ids || [])[0]; if (a && out[a]) dk[a] = (dk[a] || 0) + 1; }
    cache[gid] = { s: stamp, p: out, t: tm, z: zz, dk }; read++;
  } catch (e) { failed++; console.log('league-rates: could not read', gid, String(e).slice(0, 120)); }
}
for (const g of Object.keys(cache)) if (!idx[g]) delete cache[g];
const P = {};
for (const { p } of Object.values(cache)) for (const [id, r] of Object.entries(p)) {
  const o = P[id] || (P[id] = [r[0], r[1], ...COLS.map(() => 0)]); o[0] = r[0]; o[1] = r[1];   // latest team
  for (let i = 0; i < COLS.length; i++) o[2 + i] = Math.round((o[2 + i] + r[2 + i]) * 10) / 10;
}
const DK = {}; for (const { dk } of Object.values(cache)) for (const [id, v] of Object.entries(dk || {})) DK[id] = (DK[id] || 0) + v;
const Z = {}; for (const { z } of Object.values(cache)) for (const [id, v] of Object.entries(z || {})) { const o = Z[id] || (Z[id] = Array(10).fill(0)); v.forEach((x, i) => o[i] += x); }
fs.mkdirSync('data', { recursive: true }); fs.writeFileSync(CACHE, JSON.stringify({ season: SEASON, v: 2, g: cache }));
const TM = {}; for (const { t } of Object.values(cache)) for (const [ab, r] of Object.entries(t || {})) (TM[ab] = TM[ab] || []).push(r);
for (const k in TM) TM[k].sort((a, b) => a[0] < b[0] ? -1 : 1);
fs.writeFileSync(OUT, JSON.stringify({ season: SEASON, updated: new Date().toISOString(), games: Object.keys(cache).length, cols: COLS, p: P, zcols: 'makes, attempts for at rim, short mid, long mid, corner 3, above the break 3', z: Z, dk: DK, tcols: ['d', 'poss', 'opp_poss', 'pts', 'opp_pts', 'sec'], t: TM }));
console.log(`league-rates: ${read} games read${failed ? ', ' + failed + ' failed' : ''}; ${Object.keys(cache).length} games, ${Object.keys(P).length} players`);
