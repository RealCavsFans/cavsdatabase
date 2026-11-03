// NBA data checks (Nov 2). Runs after the NBA game store each night and holds every stored game to rules that are always
// true, so a mistake in the NBA's files or in our own code shows up the next morning instead of quietly on the site.
//
//   NBA's own box score adds up    player points = team points = final score = sum of the quarters; minutes = 5 x game length;
//                                  plus-minus totals 5 x the margin; assists never exceed made shots
//   Our play-by-play build         every player's minutes, points, rebounds, assists and plus-minus match the NBA box score;
//                                  lineup time = game time; shot chart makes = field goals made
//   Possessions                    our count within 5 of the NBA's own possession markers, both teams within 4 of each other
//   Second source (Cavs games)     the NBA's box score against ESPN's (saved in live-archive/<season>/espn/), player by player
//
//   node scripts/nba-check.mjs <nba-data dir> [out.json]     SEASON=2025-26 for a past season; DAYS=7 to check only recent games
// Writes a report (default <nba-data dir>/checks/<season>.json). Never fails the job; problems are listed, not thrown.
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const C = require('../live-core.js');
import { loadFixes, applyFixes } from './nba-fixes.mjs';

const ND = process.argv[2] || 'nba-data';
const CUR = (() => { const d = new Date(), y = d.getUTCFullYear(), m = d.getUTCMonth() + 1; const s = m >= 8 ? y : y - 1; return s + '-' + String(s + 1).slice(2); })();
const SEASON = process.env.SEASON || CUR;
const OUT = process.argv[3] || path.join(ND, 'checks', SEASON + '.json');
const DAYS = +process.env.DAYS || 0;
const idx = JSON.parse(fs.readFileSync(path.join(ND, SEASON, 'index.json'), 'utf8'));
const FIX = loadFixes(ND);   // Nov 3: games are checked with the NBA's play-by-play corrections applied
const secOf = iso => { const m = /PT(\d+)M([\d.]+)S/.exec(iso || ''); return m ? +m[1] * 60 + +m[2] : 0; };
const ESPN_AB = { GSW: 'GS', NOP: 'NO', NYK: 'NY', SAS: 'SA', UTA: 'UTAH', WAS: 'WSH' };
const norm = n => String(n).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\b/g, '').replace(/[^a-z]/g, '');

/* ESPN copies of Cavs games, by Eastern date */
const espn = {};
try { const ed = path.join('live-archive', SEASON, 'espn'); for (const f of fs.readdirSync(ed)) { const s = JSON.parse(fs.readFileSync(path.join(ed, f), 'utf8')); const d = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(s.header.competitions[0].date)); espn[d.replace(/-/g, '')] = s; } } catch {}

const games = {}, tally = { games: 0, clean: 0, nba: 0, ours: 0, poss: 0, espn: 0 };
const cutoff = DAYS ? new Date(Date.now() - DAYS * 864e5).toISOString().slice(0, 10).replace(/-/g, '') : '';
for (const [gid, row] of Object.entries(idx)) {
  if (cutoff && row[0] < cutoff) continue;
  let raw; try { raw = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(ND, SEASON, gid + '.json.gz')))); } catch (e) { games[gid] = { d: row[0], ours: ['unreadable: ' + e.message] }; continue; }
  applyFixes(raw, FIX[gid]); tally.games++;
  const B = raw.box, nba = [], ours = [], poss = [], esp = [];
  const per = Math.max(4, B.period || 4), gameSec = 4 * 720 + (per - 4) * 300;
  /* 1) the NBA's own box score adds up */
  for (const t of [B.homeTeam, B.awayTeam]) {
    const P = t.players || [], sum = k => P.reduce((a, p) => a + ((p.statistics || {})[k] || 0), 0), tr = t.teamTricode;
    const pts = sum('points'), qs = (t.periods || []).reduce((a, q) => a + (q.score || 0), 0);
    if (pts !== t.score) nba.push(`${tr}: player points ${pts} vs score ${t.score}`);
    if (qs !== t.score) nba.push(`${tr}: quarter scores ${qs} vs score ${t.score}`);
    const mins = P.reduce((a, p) => a + secOf((p.statistics || {}).minutes), 0);
    if (Math.abs(mins - 5 * gameSec) > 12) nba.push(`${tr}: player minutes ${(mins / 60).toFixed(1)} vs ${(5 * gameSec / 60)}`);
    const margin = t.score - (t === B.homeTeam ? B.awayTeam : B.homeTeam).score;
    if (sum('plusMinusPoints') !== 5 * margin) nba.push(`${tr}: plus-minus total ${sum('plusMinusPoints')} vs 5 x margin ${5 * margin}`);
    if (sum('assists') > sum('fieldGoalsMade')) nba.push(`${tr}: assists ${sum('assists')} > made shots ${sum('fieldGoalsMade')}`);
  }
  /* 2) our play-by-play build against the box score */
  let D, R;
  try { const out = C.fromNBA({ game: raw.box }, { game: raw.pbp }); D = C.prep(out); R = C.deriveCore(D, D.plays, 'all'); }
  catch (e) { ours.push('build failed: ' + String(e.message || e).slice(0, 120)); }
  if (R) {
    for (const t of [B.homeTeam, B.awayTeam]) for (const p of t.players || []) {
      const q = p.statistics || {}, b = R.B[String(p.personId)], bs = secOf(q.minutes);
      if (!b) { if (bs > 0) ours.push(`${p.nameI}: in the box score (${(bs / 60).toFixed(1)} min) but not in our build`); continue; }
      const diffs = [];
      if (Math.abs(b.min - bs) > 36) diffs.push(`min ${(bs / 60).toFixed(1)}/${(b.min / 60).toFixed(1)}`);
      for (const [k, ok] of [['points', 'pts'], ['assists', 'ast'], ['foulsPersonal', 'pf'], ['fieldGoalsAttempted', 'fga'], ['plusMinusPoints', 'pm']]) if ((q[k] || 0) !== (b[ok] || 0)) diffs.push(`${ok} ${q[k] || 0}/${b[ok] || 0}`);
      if ((q.reboundsTotal || 0) !== (b.oreb || 0) + (b.dreb || 0)) diffs.push(`reb ${q.reboundsTotal || 0}/${(b.oreb || 0) + (b.dreb || 0)}`);
      if (diffs.length) ours.push(`${p.nameI} (${t.teamTricode}): ${diffs.join(', ')} (NBA/ours)`);
    }
    for (const t of D.teams) {
      const L5 = Object.values(((R.L[t.id] || {})[5]) || {}), sec = L5.reduce((a, l) => a + l.sec, 0);
      if (Math.abs(sec - gameSec) > 2) ours.push(`${t.abbr}: lineup time ${(sec / 60).toFixed(1)} min vs game ${(gameSec / 60)}`);
      const made = R.shots.filter(s => s.t === t.id && s.m).length, box = [B.homeTeam, B.awayTeam].find(x => (ESPN_AB[x.teamTricode] || x.teamTricode) === t.abbr);
      const fgm = box ? (box.players || []).reduce((a, p) => a + ((p.statistics || {}).fieldGoalsMade || 0), 0) : null;
      if (fgm != null && made !== fgm) ours.push(`${t.abbr}: shot chart makes ${made} vs field goals made ${fgm}`);
    }
    /* 3) possessions: ours against the NBA's own possession markers */
    const acts = raw.pbp.actions.slice().sort((x, y) => x.period - y.period || x.orderNumber - y.orderNumber), cnt = {};
    let cur = null, pp = 0; for (const a of acts) { if (!a.possession) continue; if (a.possession !== cur || a.period !== pp) { cnt[a.possession] = (cnt[a.possession] || 0) + 1; cur = a.possession; pp = a.period; } }
    const np = {};
    for (const t of [B.homeTeam, B.awayTeam]) { const tid = D.teams.find(x => x.abbr === (ESPN_AB[t.teamTricode] || t.teamTricode)); if (!tid) continue; const o = R.T[tid.id].np || 0; np[t.teamTricode] = o; const n = cnt[t.teamId] || 0; if (Math.abs(o - n) > 5) poss.push(`${t.teamTricode}: ${o} possessions vs NBA's ${n}`); }
    const v = Object.values(np); if (v.length === 2 && Math.abs(v[0] - v[1]) > 4) poss.push(`teams ${v.join(' vs ')} possessions (more than 4 apart)`);
  }
  /* 4) Cavs games: the NBA's box score against ESPN's */
  const E = (B.homeTeam.teamTricode === 'CLE' || B.awayTeam.teamTricode === 'CLE') && espn[row[0]];
  if (E) {
    const e = C.prep(E), byName = {}; for (const id in e.P) byName[norm(e.P[id].name)] = e.P[id];
    for (const t of [B.homeTeam, B.awayTeam]) for (const p of t.players || []) {
      const q = p.statistics || {}; if (!secOf(q.minutes)) continue;
      const x = byName[norm(p.name)]; if (!x) { esp.push(`${p.nameI}: not in ESPN's box score`); continue; }
      const s = x.espn || {}, num = v => +String(v ?? '').split('-')[0] || 0, att = v => +String(v ?? '').split('-')[1] || 0, diffs = [];
      if (num(s.PTS) !== q.points) diffs.push(`pts ${q.points}/${num(s.PTS)}`);
      if (num(s.REB) !== q.reboundsTotal) diffs.push(`reb ${q.reboundsTotal}/${num(s.REB)}`);
      if (num(s.AST) !== q.assists) diffs.push(`ast ${q.assists}/${num(s.AST)}`);
      if (s.FG && (num(s.FG) !== q.fieldGoalsMade || att(s.FG) !== q.fieldGoalsAttempted)) diffs.push(`FG ${q.fieldGoalsMade}-${q.fieldGoalsAttempted}/${s.FG}`);
      if (s['3PT'] && (num(s['3PT']) !== q.threePointersMade || att(s['3PT']) !== q.threePointersAttempted)) diffs.push(`3PT ${q.threePointersMade}-${q.threePointersAttempted}/${s['3PT']}`);
      if (s.FT && (num(s.FT) !== q.freeThrowsMade || att(s.FT) !== q.freeThrowsAttempted)) diffs.push(`FT ${q.freeThrowsMade}-${q.freeThrowsAttempted}/${s.FT}`);
      if (s.MIN != null && Math.abs(num(s.MIN) - secOf(q.minutes) / 60) > 1.01) diffs.push(`min ${(secOf(q.minutes) / 60).toFixed(1)}/${s.MIN}`);
      if (diffs.length) esp.push(`${p.nameI}: ${diffs.join(', ')} (NBA/ESPN)`);
    }
  }
  const g = { d: row[0], m: `${row[1]}@${row[2]}` };
  if (nba.length) { g.nba = nba; tally.nba++; } if (ours.length) { g.ours = ours; tally.ours++; } if (poss.length) { g.poss = poss; tally.poss++; } if (esp.length) { g.espn = esp; tally.espn++; }
  if (!nba.length && !ours.length && !poss.length && !esp.length) tally.clean++; else games[gid] = g;
}
const report = { season: SEASON, checked: new Date().toISOString(), tally,
  how: 'nba = the NBA box score does not add up on its own; ours = our play-by-play build differs from the NBA box score; poss = possession count off from the NBA markers; espn = the NBA and ESPN box scores disagree (Cavs games)', games };
fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT, JSON.stringify(report, null, 1));
console.log(`${SEASON}: ${tally.games} games checked, ${tally.clean} clean · NBA box doesn't add up: ${tally.nba} · ours differs from NBA box: ${tally.ours} · possessions off: ${tally.poss} · NBA vs ESPN (Cavs): ${tally.espn}`);
for (const [id, g] of Object.entries(games)) console.log(id, g.d, g.m || '', JSON.stringify({ nba: g.nba, ours: g.ours, poss: g.poss, espn: g.espn }).slice(0, 400));
