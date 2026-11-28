// Referees (Nov 21, Luka). Every regular-season game since 2020-21, from the NBA's own game files (the 'nba-data' branch):
// each official's games, home teams' record, fouls and free throws per game, and the Cavs' record with him.
//   NBA_DIR=nba-data node scripts/refs.mjs            -> pdata/refs.json
// Tonight's crew is already in box.json (fetch-boxscores reads the NBA's referee assignments); the game page joins it to this file.
// Writes { updated, since, how, lg:{g,pf,fta,hw}, r:{ <personId>: [name, games, homeWins, fouls, fta, cavsW, cavsL, crewChiefGames, seasons{se:games}] } }
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { CUR_SEASON } from './season.mjs';   // Nov 21: the season from one place
const NBA_DIR = process.env.NBA_DIR || 'nba-data', FIRST = '2020-21';
const seasons = fs.readdirSync(NBA_DIR).filter(s => /^\d{4}-\d\d$/.test(s) && s >= FIRST && s <= CUR_SEASON).sort();
const R = {}, lg = { g: 0, pf: 0, fta: 0, hw: 0 };
let n = 0;
for (const se of seasons) {
  for (const f of fs.readdirSync(path.join(NBA_DIR, se)).filter(f => /^002\d{7}\.json\.gz$/.test(f))) {
    let j; try { j = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(NBA_DIR, se, f)))) } catch { continue }
    const b = j.box; if (!b || b.gameStatus !== 3 || !(b.officials || []).length) continue;
    const H = b.homeTeam, A = b.awayTeam, hs = H.statistics || {}, as = A.statistics || {};
    const pf = (hs.foulsPersonal || 0) + (as.foulsPersonal || 0), fta = (hs.freeThrowsAttempted || 0) + (as.freeThrowsAttempted || 0);
    const hw = H.score > A.score ? 1 : 0, cle = H.teamTricode === 'CLE' ? H : A.teamTricode === 'CLE' ? A : null, cw = cle ? (cle.score > (cle === H ? A : H).score ? 1 : 0) : null;
    lg.g++; lg.pf += pf; lg.fta += fta; lg.hw += hw; n++;
    for (const o of b.officials) {
      const id = String(o.personId); if (!id || id === '0') continue;
      const x = R[id] = R[id] || [o.name || (o.firstName + ' ' + o.familyName), 0, 0, 0, 0, 0, 0, 0, {}];
      x[1]++; x[2] += hw; x[3] += pf; x[4] += fta; if (cle) { if (cw) x[5]++; else x[6]++; } if (o.assignment === 'OFFICIAL1') x[7]++; x[8][se] = (x[8][se] || 0) + 1;
    }
  }
}
const out = { updated: new Date().toISOString(), since: FIRST, how: 'NBA game files (official box scores), regular season only, every team since 2020-21. Fouls and free throws are both teams combined.', lg, r: R };
fs.writeFileSync('pdata/refs.json', JSON.stringify(out));
console.log('refs:', n, 'games,', Object.keys(R).length, 'officials,', fs.statSync('pdata/refs.json').size, 'bytes');
