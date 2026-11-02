// NBA game store (Nov 2). Keeps a copy of every finished NBA game's box score and play-by-play from the NBA's own files,
// so the game archive and the league-wide numbers (ranks, scouting, strength of schedule) can all be built from one
// official source with one set of player and game ids. The copies live on the 'nba-data' branch (not on the site):
//   <season>/<gameId>.json.gz   {gameId, box, pbp}   the NBA's 'game' objects, untouched
//   <season>/index.json         {gameId: [YYYYMMDD (Eastern), away tricode, home tricode, away pts, home pts, saved at]}
//
//   node scripts/nba-store.mjs <dir>                          the current season: new finals, plus re-checks of the last 7 days
//   SEASON=2025-26 node scripts/nba-store.mjs <dir>          a past season, by walking its game ids (regular season + play-in + playoffs)
//   TEAM=CLE ...                                             only one team's games (quick backfills)
// The NBA bucket answers 403 for "not there"; that is never retried. Four downloads at a time, so it's gentle on their server.
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

const BASE = (process.env.NBA_BASE || 'https://nba-prod-us-east-1-mediaops-stats.s3.amazonaws.com/NBA').replace(/\/$/, '');
const OUT = process.argv[2] || 'nba-data';
const CUR = (() => { const d = new Date(), y = d.getUTCFullYear(), m = d.getUTCMonth() + 1; const s = m >= 8 ? y : y - 1; return s + '-' + String(s + 1).slice(2); })();
const SEASON = process.env.SEASON || CUR;
const TEAM = (process.env.TEAM || '').toUpperCase();
const DIR = path.join(OUT, SEASON); fs.mkdirSync(DIR, { recursive: true });
const IDX = path.join(DIR, 'index.json');
const idx = fs.existsSync(IDX) ? JSON.parse(fs.readFileSync(IDX, 'utf8')) : {};

async function get(p) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(BASE + p, { signal: AbortSignal.timeout(45000) });
      if (r.status === 403 || r.status === 404) return null;            // not there (yet)
      if (r.ok) return JSON.parse(await r.text());                       // the scoreboard and schedule say text/plain
      console.log('HTTP', r.status, p);
    } catch (e) { console.log(String(e), p); }
    await new Promise(r => setTimeout(r, 4000 * (i + 1)));
  }
  throw new Error('NBA feed unreachable: ' + p);
}
const et = t => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(t)).replace(/-/g, '');

async function save(id, force) {
  const f = path.join(DIR, id + '.json.gz');
  if (!force && fs.existsSync(f)) return 'have';
  const box = await get(`/liveData/boxscore/boxscore_${id}.json`);
  if (!box || !box.game) return 'none';
  const g = box.game;
  if (g.gameStatus !== 3) return 'live';
  if (TEAM && g.homeTeam.teamTricode !== TEAM && g.awayTeam.teamTricode !== TEAM) return 'other';
  const pbp = await get(`/liveData/playbyplay/playbyplay_${id}.json`);
  if (!pbp || !pbp.game || !(pbp.game.actions || []).length) return 'none';
  const body = zlib.gzipSync(JSON.stringify({ gameId: id, box: g, pbp: pbp.game }), { level: 9 });
  const prev = fs.existsSync(f) ? fs.readFileSync(f) : null;
  const same = prev && zlib.gunzipSync(prev).equals(zlib.gunzipSync(body));
  if (!same) fs.writeFileSync(f, body);
  idx[id] = [et(g.gameTimeUTC), g.awayTeam.teamTricode, g.homeTeam.teamTricode, g.awayTeam.score, g.homeTeam.score, same && idx[id] ? idx[id][5] : new Date().toISOString().slice(0, 16)];
  return same ? 'same' : 'saved';
}

async function pool(ids, force) {
  const tally = {}; let i = 0, miss = 0;
  const work = async () => { while (i < ids.length) { const [id, f] = ids[i++]; const r = await save(id, f || force); tally[r] = (tally[r] || 0) + 1; if (r === 'none') miss++; } };
  await Promise.all([work(), work(), work(), work()]);
  return tally;
}

let ids = [];
if (SEASON === CUR) {
  // this season: the NBA's schedule says which games are final; games from the last 7 days are re-checked for corrections
  const sch = await get('/staticData/scheduleLeagueV2_1.json');
  const games = ((sch && sch.leagueSchedule && sch.leagueSchedule.gameDates) || []).flatMap(d => d.games || []);
  const recent = Date.now() - 7 * 864e5;   // the NBA sometimes fixes a play days later
  for (const g of games) {
    if (!/^00[24]/.test(g.gameId) || g.gameStatus !== 3) continue;
    if (TEAM && g.homeTeam.teamTricode !== TEAM && g.awayTeam.teamTricode !== TEAM) continue;
    ids.push([g.gameId, Date.parse(g.gameDateTimeUTC || g.gameDateUTC || 0) > recent]);
  }
  console.log(`${SEASON}: ${ids.length} final games on the NBA schedule`);
} else {
  // a past season: regular season (and play-in) ids run 1..1230 (+ a few); playoffs are 004<yy>00<round><series><game>
  const yy = SEASON.slice(2, 4);
  for (let n = 1; n <= 1320; n++) ids.push(['002' + yy + String(n).padStart(5, '0'), false]);
  for (let r = 1; r <= 4; r++) for (let s = 0; s < 8 >> (r - 1); s++) for (let g = 1; g <= 7; g++) ids.push([`004${yy}00${r}${s}${g}`, false]);
  for (let n = 1; n <= 10; n++) ids.push(['005' + yy + String(n).padStart(5, '0'), false]);   // play-in
  console.log(`${SEASON}: walking ${ids.length} possible game ids`);
}
const t = await pool(ids);
fs.writeFileSync(IDX, JSON.stringify(Object.fromEntries(Object.entries(idx).sort())));
console.log(SEASON, JSON.stringify(t), Object.keys(idx).length, 'games in the store');
