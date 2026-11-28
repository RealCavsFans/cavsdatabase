// Player careers from the NBA's own game files (Nov 20, Luka). For every player with a page on the site, every regular-season
// game he played since 2020-21 (any team), counted the same way as this season's numbers: the NBA box score for his own
// line (the NBA's box first, always), and our play-by-play counting for what happened while he was on the floor
// (on/off, usage and rates) and where his shots came from (zones).
//   NBA_DIR=nba-data node scripts/player-careers.mjs      (nba-data = the 'nba-data' branch checked out)
// Writes pdata/careers-pbp.json:
//   { updated, how, seasons:[...], players: { <NBA person id>: { n: name, s: { <season>: { <team>: line } } } } }
// line = { gp, gs, sec, pts, fgm, fga, tpm, tpa, ftm, fta, oreb, dreb, ast, stl, blk, tov, pf, pm,       (NBA box)
//          on: { sec, pf, pa, po, pd, o:{fga,fta,to,fgm,oreb,dreb}, d:{fga,tpa,oreb,dreb} },               (his five-man units)
//          tm: { sec, pf, pa, po, pd },                                                                     (his team, games he played)
//          z: [[fgm,fga] x 5] }                                                                             (rim, short mid, long mid, corner 3, above-the-break 3)
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { loadFixes, applyFixes } from './nba-fixes.mjs';
const require = createRequire(import.meta.url);
const C = require('../live-core.js');
const NBA_DIR = process.env.NBA_DIR || 'nba-data';
const FIRST = process.env.FIRST || '2020-21';
const html = fs.readFileSync('index.html', 'utf8');
const pl = html.slice(html.indexOf('const PLAYERS=['), html.indexOf('];', html.indexOf('const PLAYERS=[')));
const want = new Map([...pl.matchAll(/^\s*\['[^']*','([^']+)'.*?,(\d{4,8})\],?\s*$/gm)].map(m => [m[2], m[1]]));
if (!want.size) { console.log('player-careers: no players found'); process.exit(0); }
const FIX = loadFixes(NBA_DIR);
const seasons = fs.readdirSync(NBA_DIR).filter(s => /^\d{4}-\d\d$/.test(s) && s >= FIRST).sort();
const out = { updated: new Date().toISOString(), how: 'NBA box score for each player’s own line; on-floor numbers and shot zones counted from the NBA play-by-play the same way as this season. Regular season only.', seasons, players: {} };
const add = (a, b) => { for (const k in b) { if (typeof b[k] === 'number') a[k] = (a[k] || 0) + b[k]; else if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k])) add(a[k] = a[k] || {}, b[k]); } return a };
const sec = m => { const x = /PT(\d+)M([\d.]+)S/.exec(m || ''); return x ? +x[1] * 60 + +x[2] : 0 };
let games = 0;
for (const se of seasons) {
  const dir = path.join(NBA_DIR, se); let n = 0;
  for (const f of fs.readdirSync(dir).filter(f => /^002\d+\.json\.gz$/.test(f)).sort()) {
    let raw; try { raw = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(dir, f)))) } catch { continue }
    if (!raw.box || raw.box.gameStatus !== 3) continue;
    const teams = [raw.box.homeTeam, raw.box.awayTeam];
    const hit = teams.flatMap(t => (t.players || []).filter(p => want.has(String(p.personId)) && sec((p.statistics || {}).minutes) > 0).map(p => [p, t]));
    if (!hit.length) continue;
    applyFixes(raw, FIX[f.slice(0, 10)]);
    let D, R; try { const o = C.fromNBA({ game: raw.box }, { game: raw.pbp }); if (!o.plays.length) continue; D = C.prep(C.slimSummary(o)); R = C.deriveCore(D, D.plays, 'all') } catch (e) { console.log('skip', f, String(e)); continue }
    n++;
    for (const [p, t] of hit) {
      const id = String(p.personId), q = p.statistics || {}, ab = t.teamTricode;
      /* his team: the one whose roster lists him (team abbreviations differ between feeds, e.g. UTA / UTAH) */
      const T = D.teams.find(x => (D.roster[x.id] || []).includes(id)) || D.teams.find(x => x.abbr === ab);
      if (!T) continue;
      const O = D.teams.find(x => x !== T);
      const P = out.players[id] = out.players[id] || { n: want.get(id), s: {} };
      const L = (P.s[se] = P.s[se] || {})[ab] = P.s[se][ab] || { gp: 0, gs: 0, sec: 0, z: [[0, 0], [0, 0], [0, 0], [0, 0], [0, 0]] };
      add(L, { gp: 1, gs: p.starter === '1' ? 1 : 0, sec: Math.round(sec(q.minutes)), pts: q.points, fgm: q.fieldGoalsMade, fga: q.fieldGoalsAttempted, tpm: q.threePointersMade, tpa: q.threePointersAttempted, ftm: q.freeThrowsMade, fta: q.freeThrowsAttempted, oreb: q.reboundsOffensive, dreb: q.reboundsDefensive, ast: q.assists, stl: q.steals, blk: q.blocks, tov: q.turnovers, pf: q.foulsPersonal, pm: q.plusMinusPoints });
      const on = { sec: 0, pf: 0, pa: 0, po: 0, pd: 0, o: {}, d: {} };
      Object.values((R.L[T.id] || {})[5] || {}).forEach(u => { if (!u.ids.includes(id)) return; on.sec += u.sec; on.pf += u.pf; on.pa += u.pa; on.po += (u.o.np || 0); on.pd += (u.d.np || 0);
        for (const k of ['fga', 'fta', 'to', 'fgm', 'oreb', 'dreb', 'tpa', 'poreb', 'pdreb']) { on.o[k] = (on.o[k] || 0) + (u.o[k] || 0); on.d[k] = (on.d[k] || 0) + (u.d[k] || 0) } });
      add(L, { on });
      const tt = R.T[T.id] || {}, oo = R.T[O.id] || {};
      add(L, { tm: { sec: tt.sec || 0, pf: tt.pts || 0, pa: oo.pts || 0, po: tt.np || 0, pd: oo.np || 0 } });
      R.shots.forEach(s => { if (s.id !== id || s.zi == null || !L.z[s.zi]) return; L.z[s.zi][1]++; if (s.m) L.z[s.zi][0]++ });
    }
  }
  games += n; console.log('player-careers:', se, n, 'games');
}
fs.writeFileSync('pdata/careers-pbp.json', JSON.stringify(out));
console.log('player-careers:', games, 'games,', Object.keys(out.players).length, 'players,', fs.statSync('pdata/careers-pbp.json').size, 'bytes');
