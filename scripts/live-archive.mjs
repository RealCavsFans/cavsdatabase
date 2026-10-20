// Game archive for the live game page.
// Saves every finished Cavs game of a season (a trimmed copy of ESPN's game summary, plus a numbers-only recap)
// to live-archive/<season>/<espn id>.json, then rebuilds live-archive/<season>/season.json: season totals for
// players, lineups (5-, 3- and 2-man), on/off, shots, assists and possessions, and each player's shooting by zone
// game by game. Uses the same code as /live.html (live-core.js), so the numbers match the page.
//
// SEASON=2026-27 node scripts/live-archive.mjs          (default: the current season)
// SEASON=2025-26 node scripts/live-archive.mjs          (backfill a past season)
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const C = require('../live-core.js');

const SEASON = process.env.SEASON || '2026-27';
const ESPN_YEAR = +SEASON.slice(0, 4) + 1;           // ESPN names a season by the year it ends
const DIR = path.join('live-archive', SEASON);
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/';
fs.mkdirSync(DIR, { recursive: true });

async function get(u) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 (cavsdatabase.com)' }, signal: AbortSignal.timeout(30000) });
      if (r.ok) return r.json();
      console.log('HTTP', r.status, u);
    } catch (e) { console.log(String(e), u); }
    await new Promise(r => setTimeout(r, 3000));
  }
  return null;
}

/* 1) which Cavs regular-season games are final */
const sched = process.env.SKIP_FETCH ? { events: [] } : await get(`${ESPN}teams/5/schedule?season=${ESPN_YEAR}&seasontype=2`);
if (!sched) { console.log('No schedule from ESPN; stopping.'); process.exit(0); }
const finals = (sched.events || []).filter(e => {
  const st = e.competitions && e.competitions[0] && e.competitions[0].status && e.competitions[0].status.type;
  return st && st.completed;
}).map(e => e.id);
console.log(`${SEASON}: ${finals.length} final Cavs games on ESPN`);

/* 2) archive any game we don't have yet (and refresh games from the last 2 days, in case ESPN corrected them) */
const recent = new Set((sched.events || []).filter(e => Date.now() - Date.parse(e.date) < 2 * 864e5).map(e => e.id));
let added = 0;
for (const id of finals) {
  const f = path.join(DIR, id + '.json');
  if (fs.existsSync(f) && !recent.has(id)) continue;
  const d = await get(`${ESPN}summary?event=${id}`);
  if (!d || !d.plays || !d.plays.length) { console.log('skip (no play-by-play yet)', id); continue; }
  const s = C.slimSummary(d);
  const D = C.prep(s), R = C.deriveCore(D, D.plays, 'all');
  s.recap = C.recap(D, R);
  const prev = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
  const next = JSON.stringify(s);
  if (prev !== next) { fs.writeFileSync(f, next); added++; }
}
console.log(`${added} game file(s) written`);

/* 3) season totals from every archived game */
const files = fs.readdirSync(DIR).filter(f => /^\d+\.json$/.test(f));
const games = [];
const P = {}, B = {}, gp = {}, L = { 2: {}, 3: {}, 4: {}, 5: {} }, shots = [], asts = [], pz = {};
const T = { cle: null, opp: null }, pc = {};
const addObj = (a, b) => { for (const k in b) { if (typeof b[k] === 'number') a[k] = (a[k] || 0) + b[k]; } };
const zT = () => ({ z: C.ZN.map(() => [0, 0]) });
T.cle = zT(); T.opp = zT();
for (const f of files) {
  const s = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  const D = C.prep(s); const R = C.deriveCore(D, D.plays, 'all');
  if (D.focus.id !== '5') continue;
  const gi = games.length;
  const opp = D.other;
  games.push({ id: f.slice(0, -5), date: D.date, opp: opp.abbr, ha: D.focus.ha, cle: D.focus.ha === 'home' ? R.hs : R.as, os: D.focus.ha === 'home' ? R.as : R.hs, recap: s.recap || [] });
  for (const id of D.roster['5']) {
    const p = D.P[id], b = R.B[id];
    P[id] = { name: p.name, short: p.short, last: p.last, pos: p.pos };
    if (!(b.min > 0)) continue;
    gp[id] = (gp[id] || 0) + 1; B[id] = B[id] || {}; addObj(B[id], { min: b.min, pts: b.pts, fgm: b.fgm, fga: b.fga, tpm: b.tpm, tpa: b.tpa, ftm: b.ftm, fta: b.fta, oreb: b.oreb, dreb: b.dreb, ast: b.ast, stl: b.stl, blk: b.blk, to: b.to, pf: b.pf, pm: b.pm });
    if (p.starter) B[id].gs = (B[id].gs || 0) + 1;
  }
  for (const n of [2, 3, 4, 5]) for (const [k, l] of Object.entries(R.L['5'][n])) {
    const o = L[n][k] = L[n][k] || { ids: l.ids, sec: 0, pf: 0, pa: 0, o: { fga: 0, oreb: 0, to: 0, fta: 0 }, d: { fga: 0, oreb: 0, to: 0, fta: 0 }, g: 0 };
    o.sec += l.sec; o.pf += l.pf; o.pa += l.pa; o.g++; for (const x of ['fga', 'oreb', 'to', 'fta']) { o.o[x] += l.o[x]; o.d[x] += l.d[x]; }
  }
  for (const q of R.shots) if (q.t === '5') {
    shots.push([q.id, q.hasXY ? q.x : null, q.hasXY ? q.y : null, q.m ? 1 : 0, q.three ? 1 : 0, q.zi, q.pt, q.ast ? 1 : 0, gi]);
    if (q.hasXY) { const z = (pz[q.id] = pz[q.id] || {}); const g = (z[gi] = z[gi] || C.ZN.map(() => [0, 0])); g[q.zi][1]++; if (q.m) g[q.zi][0]++; }
  }
  for (const a of R.asts) if (a.t === '5') asts.push([a.p, a.s, a.v, gi]);
  const tc = R.T['5'], to = R.T[opp.id];
  for (const [dst, src] of [[T.cle, tc], [T.opp, to]]) { for (const k in src) if (typeof src[k] === 'number') dst[k] = (dst[k] || 0) + src[k]; src.z.forEach((v, i) => { dst.z[i][0] += v[0]; dst.z[i][1] += v[1]; }); }
  for (const [h, v] of Object.entries(R.pc['5'])) { pc[h] = pc[h] || { n: 0, pts: 0 }; pc[h].n += v.n; pc[h].pts += v.pts; }
}
games.forEach(g => { g.d = g.date; });
// keep game order by date
const order = games.map((g, i) => [g.date, i]).sort().map(x => x[1]);
const remap = {}; order.forEach((old, ni) => remap[old] = ni);
const gs = order.map(i => games[i]);
shots.forEach(s => s[8] = remap[s[8]]); asts.forEach(a => a[3] = remap[a[3]]);
const pz2 = {}; for (const [id, z] of Object.entries(pz)) { pz2[id] = {}; for (const [g, v] of Object.entries(z)) pz2[id][remap[g]] = v; }
const out = { season: SEASON, updated: new Date().toISOString(), games: gs.map(({ recap, ...g }) => g), P, B, gp, L, shots, asts, pz: pz2, T, pc };
fs.writeFileSync(path.join(DIR, 'season.json'), JSON.stringify(out));
fs.writeFileSync(path.join(DIR, 'index.json'), JSON.stringify(gs.map(g => ({ id: g.id, date: g.date, opp: g.opp, ha: g.ha, cle: g.cle, os: g.os }))));
console.log(`season.json: ${gs.length} games, ${shots.length} shots, ${Object.keys(L[5]).length} five-man lineups`);
