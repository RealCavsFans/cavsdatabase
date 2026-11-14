// Season stats check (Nov 8, 2026): once a day, the season totals the site shows are held to three independent sources.
//
//   1. Every saved Cavs game against the NBA's latest box score (nba-data branch): if the NBA corrected a game after we
//      saved it, the saved copy is stale and the season totals with it.
//   2. Season totals (live-archive/<season>/season.json, which the stats page and season cards read) against the sum of
//      the official box score lines of every saved game, player by player and for the team and opponents.
//   3. The same totals against the league feed (pdata/league.json, which the player pages and NBA ranks read).
//
//   node scripts/season-check.mjs [nba-data dir]
// Writes data/season-check.json. Exits 2 when something is off (the workflow turns that into a phone alert).
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

const SEASON = process.env.SEASON || '2026-27';
const ND = process.argv[2] || 'nba-data';
const DIR = path.join('live-archive', SEASON);
const S = JSON.parse(fs.readFileSync(path.join(DIR, 'season.json'), 'utf8'));
const L = JSON.parse(fs.readFileSync('pdata/league.json', 'utf8'));
const K = ['sec', 'pts', 'fgm', 'fga', 'tpm', 'tpa', 'ftm', 'fta', 'oreb', 'dreb', 'ast', 'stl', 'blk', 'to', 'pf', 'pm'];
const issues = [], name = id => (S.P[id] || {}).name || id;

/* 1 · saved games vs the NBA's latest box score */
let fresh = 0;
for (const g of S.games) {
  const J = JSON.parse(fs.readFileSync(path.join(DIR, g.id + '.json'), 'utf8')), f = path.join(ND, SEASON, g.id + '.json.gz');
  if (!J.nb || !fs.existsSync(f)) continue;
  const raw = JSON.parse(zlib.gunzipSync(fs.readFileSync(f))); fresh++;
  for (const t of [raw.box.homeTeam, raw.box.awayTeam]) for (const p of t.players || []) {
    const q = p.statistics || {}, have = J.nb[p.personId]; if (!have) continue;
    const want = [q.points, q.fieldGoalsMade, q.fieldGoalsAttempted, q.threePointersMade, q.threePointersAttempted, q.freeThrowsMade, q.freeThrowsAttempted, q.reboundsOffensive, q.reboundsDefensive, q.assists, q.steals, q.blocks, q.turnovers, q.foulsPersonal];
    const diff = K.slice(1, 15).filter((k, i) => (have[i + 1] || 0) !== (want[i] || 0));
    if (diff.length) issues.push(`${g.et} ${g.opp}: saved game is stale for ${p.name} (${diff.join(', ')}); the NBA changed it after we saved`);
  }
}

/* 2 · season totals vs the sum of the box score lines */
const sum = {};
for (const g of S.games) {
  const J = JSON.parse(fs.readFileSync(path.join(DIR, g.id + '.json'), 'utf8'));
  for (const [pid, row] of Object.entries(J.nb || {})) { if (!S.B[pid]) continue; const t = sum[pid] || (sum[pid] = Object.fromEntries(K.map(k => [k, 0]))); K.forEach((k, i) => t[k] += row[i] || 0); }
}
for (const [pid, b] of Object.entries(S.B)) {
  const t = sum[pid]; if (!t) { issues.push(`${name(pid)}: season totals but no box score lines`); continue; }
  if (Math.abs((b.min || 0) - t.sec) > 60) issues.push(`${name(pid)} minutes: site ${(b.min / 60).toFixed(1)}, box scores ${(t.sec / 60).toFixed(1)}`);
  for (const k of K.slice(1)) if ((b[k] || 0) !== t[k]) issues.push(`${name(pid)} ${k}: site ${b[k] || 0}, box scores ${t[k]}`);
}

/* 3 · against the league feed (team, opponents, each player) */
const MAP = { pts: 'pts', fgm: 'fgm', fga: 'fga', tpm: 'tpm', tpa: 'tpa', ftm: 'ftm', fta: 'fta', orb: 'oreb', drb: 'dreb', tov: 'to', ast: 'ast', stl: 'stl', blk: 'blk', pf: 'pf', paint: 'paint' };
const feed = { cle: {}, opp: {} }; let fg = 0;
for (const g of Object.values(L.tg || {})) { const i = (g.t || []).findIndex(t => t.ab === 'CLE'); if (i < 0) continue; fg++; for (const [side, t] of [['cle', g.t[i]], ['opp', g.t[1 - i]]]) for (const k of Object.keys(MAP)) feed[side][k] = (feed[side][k] || 0) + (t[k] || 0); }
if (fg !== S.games.length) issues.push(`games: site has ${S.games.length}, league feed has ${fg}`);
for (const side of ['cle', 'opp']) for (const [k, s] of Object.entries(MAP)) if ((S.T[side] || {})[s] !== feed[side][k]) issues.push(`${side === 'cle' ? 'Cavs' : 'Opponents'} ${s}: site ${(S.T[side] || {})[s]}, league feed ${feed[side][k]}`);
for (const [pid, b] of Object.entries(S.B)) {
  const l = (L.players || {})[pid] || Object.values(L.players || {}).find(x => x.n === name(pid) && x.t === 'CLE') || Object.values(L.players || {}).find(x => x.n === name(pid)); if (!l) { issues.push(`${name(pid)}: not in the league feed`); continue; }
  for (const [k, lk] of [['pts', 'pts'], ['ast', 'ast'], ['stl', 'stl'], ['blk', 'blk'], ['to', 'tov'], ['fgm', 'fgm'], ['fga', 'fga'], ['tpm', 'tpm'], ['tpa', 'tpa'], ['ftm', 'ftm'], ['fta', 'fta'], ['oreb', 'oreb'], ['pf', 'pf']]) if ((b[k] || 0) !== (l[lk] || 0)) issues.push(`${name(pid)} ${k}: site ${b[k] || 0}, league feed ${l[lk] || 0}`);
  if ((b.oreb || 0) + (b.dreb || 0) !== (l.reb || 0)) issues.push(`${name(pid)} reb: site ${(b.oreb || 0) + (b.dreb || 0)}, league feed ${l.reb || 0}`);
}

console.log(`season-check ${SEASON}: ${S.games.length} games (${fresh} checked against the NBA's latest), ${Object.keys(S.B).length} players, ${issues.length} issue${issues.length === 1 ? '' : 's'}`);
issues.forEach(x => console.log('  ' + x));
fs.mkdirSync('data', { recursive: true });
fs.writeFileSync('data/season-check.json', JSON.stringify({ checked: new Date().toISOString(), season: SEASON, games: S.games.length, issues }, null, 1) + '\n');
fs.rmSync('data/season-check-alert.txt', { force: true });
if (issues.length) { fs.writeFileSync('data/season-check-alert.txt', issues.slice(0, 6).join('\n') + (issues.length > 6 ? `\n(+${issues.length - 6} more)` : '')); process.exit(2); }
