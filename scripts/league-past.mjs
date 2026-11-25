// League files for past seasons (Nov 25, Luka): the season stats page's Percentiles view needs every NBA player's season line
// and every team's game lines for the season being shown. The current season's live in pdata/league.json (fetch-league.mjs);
// a finished season never changes, so this builds pdata/league-players-<season>.json once from the NBA game store (nba-data branch),
// in the same shape: { season, updated, src, players: { nbaId: { n, t, p, g, gs, min, pts, reb, oreb, ast, stl, blk, tov, fgm, fga,
// tpm, tpa, ftm, fta, pf, dd } }, tg: { n<gameId>: { d, per, t: [away line, home line] } } }, with possessions and rebound chances
// counted from the play-by-play by live-core.js, like the current season's file.
//   NBA_DIR=nba-data node scripts/league-past.mjs 2025-26 [2024-25 ...]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { loadFixes, applyFixes } from './nba-fixes.mjs';
const C = createRequire(import.meta.url)('../live-core.js');
const NBA_DIR = process.env.NBA_DIR || 'nba-data', FIX = loadFixes(NBA_DIR);
const AB = { GSW: 'GS', NOP: 'NO', NYK: 'NY', SAS: 'SA', UTA: 'UTAH', WAS: 'WSH' };
const POS = p => /C/.test(p || '') ? 'C' : /F/.test(p || '') ? 'F' : /G/.test(p || '') ? 'G' : '';
const secOf = iso => { const m = /PT(\d+)M([\d.]+)S/.exec(iso || ''); return m ? +m[1] * 60 + +m[2] : 0; };
for (const SEASON of process.argv.slice(2)) {
  const dir = path.join(NBA_DIR, SEASON), out = `pdata/league-players-${SEASON}.json`;
  if (!fs.existsSync(dir)) { console.log(`league-past ${SEASON}: no NBA store`); continue; }
  const P = {}, tg = {}, pos = {}; let n = 0;
  for (const f of fs.readdirSync(dir).filter(f => /^002\d+\.json\.gz$/.test(f)).sort()) {
    const gid = f.slice(0, 10); let raw;
    try { raw = applyFixes(JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, f)))), FIX[gid]); } catch { continue; }
    const B = raw.box; if (!B || B.gameStatus !== 3) continue;
    const S2 = t => t.statistics || {}, ab = t => AB[t.teamTricode] || t.teamTricode;
    const line = (t, o) => { const a = S2(t), b = S2(o); return { ab: ab(t), pts: t.score, fgm: a.fieldGoalsMade, fga: a.fieldGoalsAttempted, tpm: a.threePointersMade, tpa: a.threePointersAttempted, ftm: a.freeThrowsMade, fta: a.freeThrowsAttempted,
      orb: a.reboundsOffensive, drb: a.reboundsDefensive, tov: a.turnoversTotal ?? a.turnovers, ast: a.assists, stl: a.steals, blk: a.blocks, pf: a.foulsPersonal, paint: a.pointsInThePaint, pot: b.pointsFromTurnovers, fb: a.pointsFastBreak }; };
    const d = (B.gameEt || B.gameTimeUTC || '').slice(0, 10);
    const g = tg['n' + gid] = { d, per: Math.max(4, (B.homeTeam.periods || []).length), t: [line(B.awayTeam, B.homeTeam), line(B.homeTeam, B.awayTeam)], cupFinal: 0, src: 'NBA' };
    try { const D = C.prep(C.slimSummary(C.fromNBA({ game: B }, { game: raw.pbp }))); const R = C.deriveCore(D, D.plays, 'all'), ids = [D.away && D.away.id, D.home && D.home.id];
      g.t.forEach((ln, i) => { const T = ids[i] && R.T[ids[i]]; if (T && T.np > 0) { ln.np = T.np; ln.forb = T.forb || 0; ln.fdrb = T.fdrb || 0; } }); } catch {}
    for (const t of [B.awayTeam, B.homeTeam]) for (const p of t.players || []) {
      const q = p.statistics || {}, sec = secOf(q.minutes); if (!(sec > 0)) continue;
      const x = P[p.personId] || (P[p.personId] = { n: (p.firstName + ' ' + p.familyName).trim(), t: '', p: '', g: 0, gs: 0, min: 0, pts: 0, reb: 0, oreb: 0, ast: 0, stl: 0, blk: 0, tov: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, pf: 0, dd: 0, src: 'NBA' });
      x.t = ab(t); if (x.t === 'CLE') x.cle = 1; x.g++; if (p.starter === '1' || p.starter === 1) x.gs++; x.min += sec / 60;
      const v = { pts: q.points, reb: q.reboundsTotal, oreb: q.reboundsOffensive, ast: q.assists, stl: q.steals, blk: q.blocks, tov: q.turnovers, fgm: q.fieldGoalsMade, fga: q.fieldGoalsAttempted, tpm: q.threePointersMade, tpa: q.threePointersAttempted, ftm: q.freeThrowsMade, fta: q.freeThrowsAttempted, pf: q.foulsPersonal };
      for (const [k, val] of Object.entries(v)) x[k] += val || 0;
      if ([v.pts, v.reb, v.ast, v.stl, v.blk].filter(z => (z || 0) >= 10).length >= 2) x.dd++;
      const ps = POS(p.position); if (ps) { const c = pos[p.personId] || (pos[p.personId] = {}); c[ps] = (c[ps] || 0) + 1; }
    }
    n++;
  }
  for (const [id, x] of Object.entries(P)) { x.min = Math.round(x.min * 100) / 100; const c = pos[id]; if (c) x.p = Object.entries(c).sort((a, b) => b[1] - a[1])[0][0]; }
  fs.writeFileSync(out, JSON.stringify({ season: SEASON, updated: new Date().toISOString(), src: 'NBA game store (nba-data), regular season', games: [], players: P, tg }));
  console.log(`league-past ${SEASON}: ${n} games, ${Object.keys(P).length} players, ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
}
