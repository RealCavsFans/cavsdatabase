// Game archive for the live game page.
// Saves every finished Cavs game (index.json also carries each game's labeled recap for the site's game pages)
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
if (!sched) console.log('No schedule from ESPN; trying the backup feed for missing games.');
const finals = ((sched && sched.events) || []).filter(e => {
  const st = e.competitions && e.competitions[0] && e.competitions[0].status && e.competitions[0].status.type;
  return st && st.completed;
}).map(e => e.id);
console.log(`${SEASON}: ${finals.length} final Cavs games on ESPN`);

/* 2) archive any game we don't have yet (and refresh games from the last 2 days, in case ESPN corrected them) */
const recent = new Set(((sched && sched.events) || []).filter(e => Date.now() - Date.parse(e.date) < 2 * 864e5).map(e => e.id));
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

/* 2b) backup: a finished game ESPN never delivered comes from the site's /pbp backup (StatMuse, which has substitutions),
   saved as b<YYYYMMDD>.json with players matched to their ESPN ids by name. An ESPN copy, once it exists, replaces it. */
if (SEASON === '2026-27' && !process.env.SKIP_FETCH) {
  const etOf = t => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(t));
  const espnFiles = fs.readdirSync(DIR).filter(f => /^\d+\.json$/.test(f));
  const have = new Set(), byName = {};
  for (const f of espnFiles) { const g = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')); have.add(etOf(g.header.competitions[0].date));
    for (const tb of (g.boxscore && g.boxscore.players) || []) for (const a of tb.statistics[0].athletes) byName[C.normName(a.athlete.displayName)] = a.athlete.id; }
  let ics = ''; try { ics = fs.readFileSync('cavs.ics', 'utf8'); } catch { console.log('no cavs.ics; skipping the backup check'); }
  const past = [...ics.matchAll(/UID:cavs-(\d{4}-\d\d-\d\d)@[\s\S]*?DTSTART:(\d{8}T\d{6}Z)/g)].filter(m => Date.now() - Date.parse(m[2].replace(/(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z/, '$1-$2-$3T$4:$5:$6Z')) > 4 * 36e5 && etOf(m[2].replace(/(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z/, '$1-$2-$3T$4:$5:$6Z')) >= SEASON.slice(0, 4) + '-10-01').map(m => m[1]);
  for (const d of past) {
    const bf = path.join(DIR, 'b' + d.replace(/-/g, '') + '.json');
    if (have.has(d)) { if (fs.existsSync(bf)) { fs.unlinkSync(bf); console.log('ESPN copy replaces backup', d); } continue; }
    if (fs.existsSync(bf) && Date.now() - Date.parse(d) > 3 * 864e5) continue;
    const j = await get('https://cavsdatabase.com/pbp?d=' + d.replace(/-/g, '') + '&src=statmuse');
    if (!j || !j.plays || !j.plays.length || j.header.competitions[0].status.type.state !== 'post') { console.log('backup: no final copy for', d); continue; }
    const map = {}; for (const tb of j.boxscore.players) for (const a of tb.statistics[0].athletes) { const e = byName[C.normName(a.athlete.displayName)]; if (e) map[a.athlete.id] = e; }
    for (const tb of j.boxscore.players) for (const a of tb.statistics[0].athletes) a.athlete.id = map[a.athlete.id] || a.athlete.id;
    for (const q of j.plays) for (const x of q.participants || []) x.athlete.id = map[x.athlete.id] || x.athlete.id;
    const s = C.slimSummary(j); const D = C.prep(s), R = C.deriveCore(D, D.plays, 'all'); s.recap = C.recap(D, R); s.src = 'StatMuse';
    const next = JSON.stringify(s); if (!fs.existsSync(bf) || fs.readFileSync(bf, 'utf8') !== next) { fs.writeFileSync(bf, next); console.log('backup game saved', d); }
  }
}

/* 3) season totals from every archived game */
const files = fs.readdirSync(DIR).filter(f => /^(\d+|b\d{8})\.json$/.test(f));
/* season files: the whole game (season.json) plus one per period, so the live page's quarter, half and clutch buttons load one small file */
function build(per, file) {
  const games = [];
  const P = {}, B = {}, gp = {}, L = { 2: {}, 3: {}, 4: {}, 5: {} }, shots = [], oshots = [], asts = [], pz = {};
  const T = { cle: null, opp: null }, pc = {}, pcO = {}, cx = { cle: { t: [0, 0], h: [0, 0] }, opp: { t: [0, 0], h: [0, 0] } };
  const isT = q => (q.how === 'stl' || q.how === 'dreb' || q.how === 'to') && q.first != null && q.first <= 7;
  const addObj = (a, b) => { for (const k in b) { if (typeof b[k] === 'number') a[k] = (a[k] || 0) + b[k]; } };
  const zT = () => ({ z: C.ZN.map(() => [0, 0]) });
  T.cle = zT(); T.opp = zT();
  for (const f of files) {
    const s = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
    const D = C.prep(s); const R0 = C.deriveCore(D, D.plays, 'all'); const R = per === 'all' ? R0 : C.deriveCore(D, D.plays, per);
    if (D.focus.id !== '5') continue;
    const gi = games.length;
    const opp = D.other;
    const etd = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(D.date));
    games.push({ id: f.slice(0, -5), date: D.date, et: etd, opp: opp.abbr, ha: D.focus.ha, cle: D.focus.ha === 'home' ? R0.hs : R0.as, os: D.focus.ha === 'home' ? R0.as : R0.hs, recap: s.recap || [], rc: C.recapL ? C.recapL(D, R0) : [] });
    for (const id of D.roster['5']) {
      const p = D.P[id], b = R.B[id];
      P[id] = { name: p.name, short: p.short, last: p.last, pos: p.pos };
      if (!(b.min > 0)) continue;
      gp[id] = (gp[id] || 0) + 1; B[id] = B[id] || {}; addObj(B[id], { min: b.min, pts: b.pts, fgm: b.fgm, fga: b.fga, tpm: b.tpm, tpa: b.tpa, ftm: b.ftm, fta: b.fta, oreb: b.oreb, dreb: b.dreb, ast: b.ast, stl: b.stl, blk: b.blk, to: b.to, pf: b.pf, pm: b.pm });
      if (p.starter) B[id].gs = (B[id].gs || 0) + 1;
    }
    for (const n of [2, 3, 4, 5]) for (const [k, l] of Object.entries(R.L['5'][n])) {
      const o = L[n][k] = L[n][k] || { ids: l.ids, sec: 0, pf: 0, pa: 0, o: {}, d: {}, g: 0 };
      o.sec += l.sec; o.pf += l.pf; o.pa += l.pa; o.g++; for (const x in l.o) { o.o[x] = (o.o[x] || 0) + l.o[x]; o.d[x] = (o.d[x] || 0) + (l.d[x] || 0); }
    }
    /* opponents' shots too, so the season Shots tab can show what the Cavs allow */
    for (const q of R.shots) if (q.t !== '5') oshots.push([q.hasXY ? q.x : null, q.hasXY ? q.y : null, q.m ? 1 : 0, q.three ? 1 : 0, q.zi, q.pt, q.ast ? 1 : 0, gi]);
    for (const q of R.shots) if (q.t === '5') {
      shots.push([q.id, q.hasXY ? q.x : null, q.hasXY ? q.y : null, q.m ? 1 : 0, q.three ? 1 : 0, q.zi, q.pt, q.ast ? 1 : 0, gi]);
      if (q.hasXY) { const z = (pz[q.id] = pz[q.id] || {}); const g = (z[gi] = z[gi] || C.ZN.map(() => [0, 0])); g[q.zi][1]++; if (q.m) g[q.zi][0]++; }
    }
    for (const a of R.asts) if (a.t === '5') asts.push([a.p, a.s, a.v, gi, a.z]);
    const tc = R.T['5'], to = R.T[opp.id];
    /* per-game rows for the Season tab (trends and splits): team box totals for both sides, and every 5-man unit's minutes and possessions */
    const tr = t => [t.pts, t.fgm, t.fga, t.tpm, t.tpa, t.ftm, t.fta, t.oreb, t.toreb || 0, t.dreb, t.to, Math.round(t.sec || 0)];
    games[gi].t = tr(tc); games[gi].u = tr(to);
    /* possession timing, after timeouts, quarter starts (full game, both sides: [cle, opp]) */
    { const X = C.extras(D, R0); games[gi].x = { tim: [X.tim['5'], X.tim[opp.id]], ato: [X.ato['5'], X.ato[opp.id]], qs: [X.qs['5'], X.qs[opp.id]] }; }
    games[gi].l5 = Object.entries(R.L['5'][5]).filter(([, l]) => l.sec >= 1).map(([k, l]) => [k, Math.round(l.sec), l.pf, l.pa, l.o.fga, l.o.oreb, l.o.to, l.o.fta, l.d.fga, l.d.oreb, l.d.to, l.d.fta, l.o.np || 0, l.d.np || 0]);
    for (const [dst, src] of [[T.cle, tc], [T.opp, to]]) { for (const k in src) if (typeof src[k] === 'number') dst[k] = (dst[k] || 0) + src[k]; src.z.forEach((v, i) => { dst.z[i][0] += v[0]; dst.z[i][1] += v[1]; }); }
    for (const [h, v] of Object.entries(R.pc['5'])) { pc[h] = pc[h] || { n: 0, pts: 0 }; pc[h].n += v.n; pc[h].pts += v.pts; }
    /* how possessions started, for the opponents too, plus transition vs halfcourt for both sides */
    for (const [h, v] of Object.entries(R.pc[opp.id] || {})) { pcO[h] = pcO[h] || { n: 0, pts: 0 }; pcO[h].n += v.n; pcO[h].pts += v.pts; }
    for (const [key, tid] of [['cle', '5'], ['opp', opp.id]]) for (const q of (R.PL || []).filter(q => q.team === tid)) { const k = isT(q) ? 't' : q.how !== 'oreb' ? 'h' : null; if (k) { cx[key][k][0]++; cx[key][k][1] += q.pts; } }
  }
  games.forEach(g => { g.d = g.date; });
  // keep game order by date
  const order = games.map((g, i) => [g.date, i]).sort().map(x => x[1]);
  const remap = {}; order.forEach((old, ni) => remap[old] = ni);
  const gs = order.map(i => games[i]);
  shots.forEach(s => s[8] = remap[s[8]]); oshots.forEach(s => s[7] = remap[s[7]]); asts.forEach(a => a[3] = remap[a[3]]);
  const pz2 = {}; for (const [id, z] of Object.entries(pz)) { pz2[id] = {}; for (const [g, v] of Object.entries(z)) pz2[id][remap[g]] = v; }
  const out = { season: SEASON, per, updated: new Date().toISOString(), games: gs.map(({ recap, rc, ...g }) => g), P, B, gp, L, shots, oshots, asts, pz: pz2, T, pc, pcO, cx };
  fs.writeFileSync(path.join(DIR, file), JSON.stringify(out));
  if (per === 'all') fs.writeFileSync(path.join(DIR, 'index.json'), JSON.stringify(gs.map(g => ({ id: g.id, date: g.date, et: g.et, opp: g.opp, ha: g.ha, cle: g.cle, os: g.os, rc: g.rc }))));
  console.log(`${file}: ${gs.length} games, ${shots.length} shots, ${Object.keys(L[5]).length} five-man lineups`);
}
build('all', 'season.json');
for (const [key, per] of [['h1', [1, 2]], ['h2', [3, 4]], ['q1', [1]], ['q2', [2]], ['q3', [3]], ['q4', [4]], ['clutch', 'clutch']]) build(per, 'season-p-' + key + '.json');
