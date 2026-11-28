// Nov 20 audit: the player-page game logs read box.json, whose player rows come from ESPN's box score. When ESPN and the
// NBA disagree (Nov 4 at OKC: a steal and a block credited to different players), the game log didn't add up to the season line,
// which comes from the NBA's own box. This rewrites each archived game's Cavs rows from the NBA's box score saved in the game
// archive (live-archive/<season>/<game>.json, "nb": [seconds, pts, fgm, fga, 3pm, 3pa, ftm, fta, oreb, dreb, ast, stl, blk, to, pf, +/-]).
// Row layout kept: [name, min, pts, reb, ast, +/-, starter, fg, 3pt, ft, stl, blk, to, oreb, pf]. The starter flag is kept from the
// existing row (the NBA box has it too: the five with a starting position in the archive's game file).
//   node scripts/box-nba.mjs            (after fetch-boxscores.mjs)
import { CUR_SEASON } from './season.mjs';   // Nov 21: the season from one place
import fs from 'node:fs';
const SEASON = process.env.SEASON || CUR_SEASON, DIR = `live-archive/${SEASON}`;
const J = p => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const box = J('box.json'), ix = J(`${DIR}/index.json`), S = J(`${DIR}/season.json`);
if (!box || !ix || !S) { console.log('box-nba: missing box.json or the game archive'); process.exit(0); }
let changed = 0, games = 0;
for (const g of ix) {
  const b = box[g.et]; if (!b || b.status !== 'final') continue;
  const s = J(`${DIR}/${g.id}.json`); const sg = (S.games || []).find(x => x.id === g.id);
  if (!s || !s.nb || !sg || !sg.pl) continue;
  const old = Object.fromEntries((b.box || []).map(r => [r[0], r]));
  /* starters from the archived game file (NBA box: players with a starting position) when it has them */
  const starters = new Set(((s.boxscore && s.boxscore.players) || []).flatMap(t => (t.statistics || []).flatMap(st => (st.athletes || []).filter(a => a.starter).map(a => a.athlete && a.athlete.id && String(a.athlete.id)))).filter(Boolean));
  const rows = sg.pl.filter(id => s.nb[id] && s.nb[id][0] > 0).map(id => {
    const n = s.nb[id], name = (S.P[id] || {}).name || (s.P && s.P[id] && s.P[id].name); if (!name) return null;
    const o = old[name], st = o ? o[6] : (starters.has(id) ? 1 : 0);
    return [name, String(Math.round(n[0] / 60)), String(n[1]), String(n[8] + n[9]), String(n[10]), (n[15] > 0 ? "+" : "") + n[15], st, `${n[2]}-${n[3]}`, `${n[4]}-${n[5]}`, `${n[6]}-${n[7]}`, String(n[11]), String(n[12]), String(n[13]), String(n[8]), String(n[14])];
  }).filter(Boolean);
  if (!rows.length) continue;
  /* keep the order the old rows had (starters first, by minutes), new names at the end */
  const ord = Object.keys(old); rows.sort((a, c) => { const ia = ord.indexOf(a[0]), ic = ord.indexOf(c[0]); return (ia < 0 ? 99 : ia) - (ic < 0 ? 99 : ic) || +c[1] - +a[1]; });
  games++;
  if (JSON.stringify(rows) !== JSON.stringify(b.box)) { b.box = rows; b.boxSrc = 'NBA'; changed++; }
  else if (b.boxSrc !== 'NBA') { b.boxSrc = 'NBA'; changed++; }
}
if (changed) fs.writeFileSync('box.json', JSON.stringify(box, null, 1) + '\n');
console.log(`box-nba: ${games} games from the NBA's box, ${changed} updated`);
