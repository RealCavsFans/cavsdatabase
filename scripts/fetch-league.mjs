// League-wide player stats for the player pages (position ranks, percentiles, league averages).
// Reads ESPN's public scoreboard and box scores (the same feed fetch-boxscores uses), one regular season game at a time,
// and keeps running season totals per player in pdata/league.json. Safe to run every 30 minutes: finished games are
// remembered by id, so each run only reads new finals (at most MAX per run, so a backfill spreads over a few runs).
//   pdata/league.json = { season, updated, games: [espn event ids], players: { espnId: { n, t, p, g, gs, min, pts, reb, oreb, ast, stl, blk, tov, fgm, fga, tpm, tpa, ftm, fta, dd, b2b } } }
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
// every team's shots by type and zone, game by game (pdata/league-shots.json), sorted with the live page's own code,
// so the game page can compare the opponent with its own season, not just with what Cavs opponents do
const C = createRequire(import.meta.url)('../live-core.js');
const SFILE = new URL('../pdata/league-shots.json', import.meta.url);

const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
const FILE = new URL('../pdata/league.json', import.meta.url);
const SEASON = '2026-27', START = '2026-10-21', MAX = 40;
const etDate = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d);

let L = { season: SEASON, updated: null, games: [], players: {} };
try { const prev = JSON.parse(await readFile(FILE, 'utf8')); if (prev.season === SEASON) L = prev; } catch {}
const done = new Set(L.games);
// SH.g[eventId] = { d, t: { ABBR: [a, axy, ...per type [m, a, pts, ast] x8, ...per zone [m, a] x5] }, x: { ABBR: { q: [[pf, pa, poss, opp poss, sec] x4], c: clutch same, b: [starter pts, bench pts, starter sec, bench sec] } } }
let SH = { season: SEASON, g: {} };
try { const prev = JSON.parse(await readFile(SFILE, 'utf8')); if (prev.season === SEASON) SH = prev; } catch {}
function shotsOf(sum) {
  if (!sum.plays?.length) return null;
  const D = C.prep(C.slimSummary(sum)), R = C.deriveCore(D, D.plays, 'all'), out = {};
  for (const tm of D.teams) {
    const v = [0, 0, ...Array(C.PT.length * 4).fill(0), ...Array(C.ZN.length * 2).fill(0)], P0 = 2, Z0 = 2 + C.PT.length * 4;
    for (const q of R.shots) { if (q.t !== tm.id) continue; v[0]++; const pts = q.m ? (q.three ? 3 : 2) : 0;
      if (q.pt != null) { const k = P0 + q.pt * 4; v[k + 1]++; if (q.m) { v[k]++; v[k + 2] += pts; if (q.ast) v[k + 3]++; } }
      if (q.hasXY) { v[1]++; if (q.zi != null) { const k = Z0 + q.zi * 2; v[k + 1]++; if (q.m) v[k]++; } } }
    out[tm.abbr] = v;
  }
  /* extras for the season page's NBA ranks: each quarter and the clutch (points for/against, counted possessions, seconds), and starters vs bench */
  const x = {};
  const part = f => { const Rf = C.deriveCore(D, D.plays, f); return Object.fromEntries(D.teams.map(t => { const o = D.teams.find(u => u !== t), a = Rf.T[t.id] || {}, b = Rf.T[o.id] || {}; return [t.abbr, [a.pts || 0, b.pts || 0, Math.round((a.np || 0) * 10) / 10, Math.round((b.np || 0) * 10) / 10, Math.round(a.sec || 0)]]; })); };
  const Q = [[1], [2], [3], [4]].map(part), CL = part('clutch');
  for (const t of D.teams) { const a = R.T[t.id] || {}; x[t.abbr] = { q: Q.map(q => q[t.abbr]), c: CL[t.abbr], b: [a.stPts || 0, a.bnPts || 0, Math.round(a.stSec || 0), Math.round(a.bnSec || 0)] }; }
  return { v: out, x };
}
let shBack = 0;
const today = etDate();
if (today < START) { console.log('league feed: season has not started'); process.exit(0); }

const get = async u => { for (let i = 0; i < 3; i++) { try { const r = await fetch(u, { headers: { 'User-Agent': 'cavsdatabase.com (fan reference site)' } }); if (r.ok) return r.json(); } catch {} await new Promise(r => setTimeout(r, 1500 * (i + 1))); } throw new Error('fetch failed ' + u); };

// dates from opening night through yesterday (ET); today's games are read once they're final
const dates = [];
for (let d = new Date(START + 'T12:00:00Z'); etDate(d) <= today; d = new Date(d.getTime() + 864e5)) dates.push(etDate(d));

// one game's player lines: { espnId: { n, t, p, g, gs, min, pts, ... } }
function linesOf(sum) {
  const out = {};
  for (const team of sum.boxscore?.players || []) {
    const st = team.statistics?.[0]; if (!st) continue;
    const keys = (st.names || st.labels || []).map(x => String(x).toUpperCase());
    const v = (a, k) => { const i = keys.indexOf(k); return i < 0 ? 0 : parseFloat(a.stats[i]) || 0; };
    const ma = (a, k) => { const i = keys.indexOf(k); const m = i < 0 ? null : String(a.stats[i] || '').match(/^(\d+)-(\d+)$/); return m ? [+m[1], +m[2]] : [0, 0]; };
    for (const a of st.athletes || []) {
      if (!a.stats?.length || a.didNotPlay) continue;
      const id = a.athlete?.id; if (!id) continue;
      const [fgm, fga] = ma(a, 'FG'), [tpm, tpa] = ma(a, '3PT'), [ftm, fta] = ma(a, 'FT');
      const x = { n: a.athlete.displayName, t: team.team?.abbreviation || '', p: a.athlete.position?.abbreviation || '', g: 1, gs: a.starter ? 1 : 0,
        min: v(a, 'MIN'), pts: v(a, 'PTS'), reb: v(a, 'REB'), oreb: v(a, 'OREB'), ast: v(a, 'AST'), stl: v(a, 'STL'), blk: v(a, 'BLK'), tov: v(a, 'TO'), fgm, fga, tpm, tpa, ftm, fta };
      x.dd = [x.pts, x.reb, x.ast, x.stl, x.blk].filter(z => z >= 10).length >= 2 ? 1 : 0;
      out[id] = x;
    }
  }
  return out;
}
/* one game's team lines for scripts/team-stats.mjs: points, shooting, rebounds (no team rebounds), turnovers (incl. team) and periods */
function teamsOf(sum, ev) {
  const comp = sum.header?.competitions?.[0]; if (!comp) return null;
  const sc = Object.fromEntries((comp.competitors || []).map(c => [c.id, +c.score]));
  const per = Math.max(4, (comp.competitors?.[0]?.linescores || []).length);
  const sv = (t, n) => (t.statistics || []).find(x => x.name === n)?.displayValue;
  const ma = s => { const m = String(s || '').match(/(\d+)-(\d+)/); return m ? [+m[1], +m[2]] : [0, 0]; };
  const t = (sum.boxscore?.teams || []).map(x => { const [fgm, fga] = ma(sv(x, 'fieldGoalsMade-fieldGoalsAttempted')), [tpm, tpa] = ma(sv(x, 'threePointFieldGoalsMade-threePointFieldGoalsAttempted')), [ftm, fta] = ma(sv(x, 'freeThrowsMade-freeThrowsAttempted'));
    return { ab: x.team?.abbreviation, pts: sc[x.team?.id] || 0, fgm, fga, tpm, tpa, ftm, fta, orb: +sv(x, 'offensiveRebounds') || 0, drb: +sv(x, 'defensiveRebounds') || 0, tov: +(sv(x, 'totalTurnovers') ?? sv(x, 'turnovers')) || 0,
      /* for the live page's NBA ranks: passing, defense, fouls and where points came from (pot = points the other team scored off this team's turnovers) */
      ast: +sv(x, 'assists') || 0, stl: +sv(x, 'steals') || 0, blk: +sv(x, 'blocks') || 0, pf: +sv(x, 'fouls') || 0, paint: +sv(x, 'pointsInPaint') || 0, pot: +sv(x, 'turnoverPoints') || 0, fb: +sv(x, 'fastBreakPoints') || 0 }; });
  /* the NBA Cup championship counts for nothing in the standings or season stats */
  const c0 = ev.competitions?.[0] || {}, cupFinal = c0.type?.abbreviation === 'CC' || /Cup Championship/i.test(JSON.stringify(c0.notes || [])) ? 1 : 0;
  return t.length === 2 ? { per, t, cupFinal } : null;
}
const NUM = ['g', 'gs', 'min', 'pts', 'reb', 'oreb', 'ast', 'stl', 'blk', 'tov', 'fgm', 'fga', 'tpm', 'tpa', 'ftm', 'fta', 'dd'];
const apply = (lines, sign) => { for (const [id, x] of Object.entries(lines)) {
  const P = L.players[id] || (L.players[id] = Object.fromEntries([['n', x.n], ['t', x.t], ['p', x.p], ...NUM.map(k => [k, 0])]));
  if (sign > 0) { P.n = x.n; if (x.t) P.t = x.t; if (x.p) P.p = x.p; }
  for (const k of NUM) P[k] = Math.round((P[k] + sign * (x[k] || 0)) * 10) / 10;
} };
L.recent = L.recent || {};
L.tg = L.tg || {};   // team game lines by event id, for team-stats.mjs   // the last few nights' lines, kept so a stat correction can replace them

let read = 0, failed = 0, fixed = 0;
for (const date of dates.reverse()) {               // newest first, so a long backfill never delays last night's games
  if (read >= MAX) break;
  const fresh = (Date.parse(today) - Date.parse(date)) / 864e5 <= 2;
  let sb; try { sb = await get(`${ESPN}/scoreboard?dates=${date.replace(/-/g, '')}`); } catch { failed++; continue; }
  for (const ev of sb.events || []) {
    if (read >= MAX) break;
    if (ev.season && ev.season.type !== 2) continue;                       // regular season only
    if (!ev.status?.type?.completed) continue;
    const seen = done.has(ev.id);
    const oldTg = seen && L.tg[ev.id] && L.tg[ev.id].t && L.tg[ev.id].t[0] && L.tg[ev.id].t[0].ast == null;   // saved before Oct 25: re-read once for the extra team stats
    const needSh = (!SH.g[ev.id] || !SH.g[ev.id].x) && shBack < 60;
    if (seen && !oldTg && !needSh && !(fresh && L.recent[ev.id] && Date.now() - (L.recent[ev.id].at || 0) > 4 * 36e5)) continue;  // re-check recent games every 4 hours; older ones are final for good
    let sum; try { sum = await get(`${ESPN}/summary?event=${ev.id}`); } catch { failed++; continue; }
    const tg = teamsOf(sum, ev); if (tg) L.tg[ev.id] = { d: date, ...tg };
    try { const sh = shotsOf(sum); if (sh) { if (!SH.g[ev.id] || !SH.g[ev.id].x) shBack++; SH.g[ev.id] = { d: date, t: sh.v, x: sh.x }; } } catch (e) { console.log('shots: could not sort', ev.id, String(e)); }
    if (seen && needSh && !oldTg && !(fresh && L.recent[ev.id])) continue;   // only came back for the shots
    const lines = tg?.cupFinal ? {} : linesOf(sum);   // the Cup final doesn't count toward season stats
    if (seen && oldTg && !L.recent[ev.id]) continue;                       // team lines refreshed; player lines were already counted
    if (seen) {                                                            // re-read: swap in corrected lines if anything changed
      if (JSON.stringify(lines) !== JSON.stringify(L.recent[ev.id].lines)) { apply(L.recent[ev.id].lines, -1); apply(lines, 1); fixed++; }
    } else { apply(lines, 1); L.games.push(ev.id); done.add(ev.id); read++; }
    L.recent[ev.id] = { d: date, at: Date.now(), lines };
  }
}
for (const [id, r] of Object.entries(L.recent)) if ((Date.parse(today) - Date.parse(r.d)) / 864e5 > 3) delete L.recent[id];
L.updated = new Date().toISOString();
await writeFile(FILE, JSON.stringify(L) + '\n');
SH.updated = L.updated; await writeFile(SFILE, JSON.stringify(SH) + '\n');
console.log(`league feed: read ${read} new games, corrected ${fixed} (${L.games.length} total, ${Object.keys(L.players).length} players)${failed ? `, ${failed} requests failed` : ''}`);
