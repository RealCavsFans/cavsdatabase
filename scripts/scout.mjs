// Scouting report for the next Cavs opponent, shown on the site's game preview.
// Finds the next Cavs regular-season game on ESPN, then rebuilds the opponent's last 5 finished games from
// ESPN play-by-play with the same code as /live.html (live-core.js): results, pace, ratings, top scorers,
// most-used five and shot locations against the NBA average. Writes pdata/scout.json. Exits 0 on any problem.
import fs from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const C = require('../live-core.js');
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/';
const OUT = 'pdata/scout.json';
async function get(u) {
  for (let i = 0; i < 3; i++) {
    try { const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 (cavsdatabase.com)' }, signal: AbortSignal.timeout(30000) }); if (r.ok) return r.json(); console.log('HTTP', r.status, u); }
    catch (e) { console.log(String(e), u); }
    await new Promise(r => setTimeout(r, 3000));
  }
  return null;
}
const now = new Date();
const YR = now.getUTCMonth() >= 7 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();   // ESPN names a season by the year it ends
const etDay = d => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(d));
const done = e => e.competitions?.[0]?.status?.type?.completed;

/* 1) next Cavs game */
let next = null;
for (const y of [YR, YR + 1]) {
  const s = await get(`${ESPN}teams/5/schedule?season=${y}&seasontype=2`);
  next = (s?.events || []).find(e => !done(e) && Date.parse(e.date) > Date.now() - 6 * 36e5);
  if (next) break;
}
if (!next) { console.log('scout: no upcoming Cavs game'); process.exit(0); }
const opp = next.competitions[0].competitors.find(c => c.team.id !== '5').team;
console.log('next game', next.id, etDay(next.date), 'vs', opp.abbreviation);

/* 2) their last 5 finished regular-season games: this season as soon as they've played once, else last season */
let ids = [], from = '';
for (const y of [YR, YR - 1]) {
  const s = await get(`${ESPN}teams/${opp.id}/schedule?season=${y}&seasontype=2`);
  ids = (s?.events || []).filter(done).sort((a, b) => Date.parse(a.date) - Date.parse(b.date)).map(e => e.id);
  from = (y - 1) + '-' + String(y).slice(2);
  if (ids.length >= 1) break;   // once the season has started, this season's games only (Luka, Oct 23)
}
ids = ids.slice(-5);
const games = [], T = {}, O = {}, P = {}, L5 = {}, Z = C.ZN.map(() => [0, 0]), CN = [0, 0];
const add = (d, x) => { for (const k in x) if (typeof x[k] === 'number') d[k] = (d[k] || 0) + x[k]; };
for (const id of ids) {
  const d = await get(`${ESPN}summary?event=${id}`);
  if (!d || !d.plays || !d.plays.length) continue;
  const G = C.prep(C.slimSummary(d));
  const me = G.teams.find(t => t.id === opp.id), op = G.teams.find(t => t.id !== opp.id); if (!me || !op) continue;
  G.focus = me; G.other = op;
  const R = C.deriveCore(G, G.plays, 'all');
  const a = me.ha === 'home' ? R.hs : R.as, b = me.ha === 'home' ? R.as : R.hs;
  games.push({ d: etDay(G.date), ha: me.ha, op: op.abbr, a, b });
  add(T, R.T[me.id]); add(O, R.T[op.id]);
  G.roster[me.id].forEach(i => { const x = R.B[i]; if (!(x.min > 0)) return; const p = P[G.P[i].name] = P[G.P[i].name] || { n: G.P[i].name, gp: 0, min: 0, pts: 0, reb: 0, ast: 0 }; p.gp++; p.min += x.min; p.pts += x.pts; p.reb += x.oreb + x.dreb; p.ast += x.ast; });
  Object.values(R.L[me.id][5]).forEach(l => { const k = l.ids.slice().sort().join(); const o = L5[k] = L5[k] || { n: l.ids.map(i => G.P[i].last), sec: 0, pm: 0, g: 0, pf: 0, pa: 0, po: 0 }; o.sec += l.sec; o.pm += l.pf - l.pa; o.g++; o.pf += l.pf; o.pa += l.pa; o.po += (C.poss(l.o) + C.poss(l.d)) / 2; });
  R.shots.filter(q => q.t === me.id && q.hasXY).forEach(q => { Z[q.zi][1]++; if (q.m) Z[q.zi][0]++; if (q.zi === 3) CN[q.x < 25 ? 0 : 1]++; });
}
if (!games.length) { console.log('scout: no games to scout'); process.exit(0); }
games.sort((x, y) => x.d < y.d ? -1 : 1);
const P2 = t => C.poss({ fga: t.fga, oreb: (t.oreb || 0) + (t.toreb || 0), to: t.to, fta: t.fta });
const r1 = x => Math.round(x * 10) / 10;
const n = games.length;
/* shot shares: rim, midrange (short + long), corner 3, above-the-break 3 */
const share = z => { const t = z.reduce((s, v) => s + v[1], 0) || 1; return [z[0][1], z[1][1] + z[2][1], z[3][1], z[4][1]].map(v => r1(100 * v / t)); };
let lgZ = C.ZN.map(([k]) => [C.LG[k][0] * 1000, C.LG[k][1] * 1000]);
try { const b = JSON.parse(fs.readFileSync('live-base.json', 'utf8')); if (b.lg && b.lg.length === 5) lgZ = b.lg.map(([m, a]) => [m, a]); } catch {}
const zt = Z.reduce((s, v) => s + v[1], 0) || 1;
const top5 = Object.values(L5).sort((a, b) => b.sec - a.sec)[0];
const out = {
  updated: now.toISOString(), game: { id: next.id, d: etDay(next.date), opp: opp.abbreviation, name: opp.shortDisplayName || opp.name }, from,
  games,
  pace: r1((P2(T) + P2(O)) / 2 / (T.sec || 1) * 2880), off: r1(100 * T.pts / P2(T)), def: r1(100 * O.pts / P2(O)), tpr: Math.round(100 * T.tpa / (T.fga || 1)),
  who: Object.values(P).map(p => ({ n: p.n, gp: p.gp, pts: r1(p.pts / p.gp), reb: r1(p.reb / p.gp), ast: r1(p.ast / p.gp) })).sort((a, b) => b.pts - a.pts).slice(0, 4),
  five: top5 ? { n: top5.n, min: Math.round(top5.sec / 60), pm: top5.pm, g: top5.g, ...(top5.po >= 1 ? { o: r1(100 * top5.pf / top5.po), d: r1(100 * top5.pa / top5.po) } : {}) } : null,
  corners: CN.map(v => r1(100 * v / zt)),
  zones: share(Z), lg: share(lgZ)
};
fs.mkdirSync('data', { recursive: true });
/* only rewrite when something other than the timestamp changed, so quiet days don't redeploy the site */
let prev = null; try { prev = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch {}
if (prev && JSON.stringify({ ...prev, updated: 0 }) === JSON.stringify({ ...out, updated: 0 })) { console.log('scout: no changes'); process.exit(0); }
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`scout: ${opp.abbreviation}, ${n} games (${from})`);
