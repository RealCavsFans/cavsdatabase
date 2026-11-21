// Box score check (Nov 7, 2026): makes sure the numbers the live page builds from the play-by-play match the
// official box score, so a drift is caught the same night instead of by a reader.
//
// For each game it rebuilds every stat from the play-by-play alone (the same live-core.js code the page uses,
// without the page's official-box corrections) and compares, player by player and team by team:
//   points, field goals, threes, free throws, rebounds, assists, steals, blocks, turnovers, fouls,
//   and each quarter's score against the official line score.
//
//   node scripts/box-check.mjs              the newest 3 archived games of the season
//   node scripts/box-check.mjs all          every archived game of the season
//   node scripts/box-check.mjs live         the Cavs game in progress, from the NBA's own box score and play-by-play (what the live page uses)
//
// Writes data/box-check.json. Exits 2 when something is off (the workflow turns that into a phone alert).
import { CUR_SEASON } from './season.mjs';   // Nov 21: the season from one place
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const C = require('../live-core.js');

const SEASON = process.env.SEASON || CUR_SEASON;
const DIR = path.join('live-archive', SEASON);
const MODE = process.argv[2] || 'recent';
const STATS = [['PTS', 'pts'], ['FG', 'fgm', 'fga'], ['3PT', 'tpm', 'tpa'], ['FT', 'ftm', 'fta'], ['OREB', 'oreb'], ['DREB', 'dreb'], ['AST', 'ast'], ['STL', 'stl'], ['BLK', 'blk'], ['TO', 'to'], ['PF', 'pf']];
/* stats the page already takes from the official box for a full game: a gap there is reported but doesn't alert */
const CORRECTED = new Set(['OREB', 'DREB', 'AST', 'STL', 'BLK']);

const num = v => { const x = parseFloat(v); return isFinite(x) ? x : 0; };
const pair = v => { const m = String(v || '').match(/(\d+)-(\d+)/); return m ? [+m[1], +m[2]] : [0, 0]; };

function check(J, label) {
  const D = C.prep(J);
  const R = C.deriveCore(D, D.plays.slice(), 'all');   // a copy of the plays: the raw play-by-play count, no corrections
  const out = { game: label, issues: [], notes: [] };
  for (const t of [D.focus, D.other]) {
    const tot = {}, off = {};
    for (const id of D.roster[t.id] || []) {
      const P = D.P[id], e = P && P.espn; if (!e || P.dnp) continue; const b = R.B[id] || {};   /* P.espn = the box score line; for NBA-built games it is the NBA box score (fromNBA keeps ESPN field names) */
      for (const [k, f, g] of STATS) {
        let want, have;
        if (g) { const [m, a] = pair(e[k]); want = [m, a]; have = [b[f] || 0, b[g] || 0]; }
        else { want = [num(e[k])]; have = [b[f] || 0]; }
        want.forEach((w, i) => { const key = k + (g ? (i ? 'A' : 'M') : ''); tot[key] = (tot[key] || 0) + w; off[key] = (off[key] || 0) + have[i]; });
        if (want.some((w, i) => w !== have[i])) (CORRECTED.has(k) ? out.notes : out.issues).push(`${t.abbr} ${P.name}: ${k} ${have.join('-')} counted, ${want.join('-')} official`);
      }
    }
    for (const k of Object.keys(tot)) if (tot[k] !== off[k]) (CORRECTED.has(k.replace(/[MA]$/, '')) ? out.notes : out.issues).push(`${t.abbr} team ${k}: ${off[k]} counted, ${tot[k]} official`);
    /* each quarter's score against the line score */
    const comp = ((J.header || {}).competitions || [])[0] || {}, me = (comp.competitors || []).find(c => String(c.id) === String(t.id));
    ((me && me.linescores) || []).forEach((ls, i) => { const q = R.TQ && R.TQ[i + 1] && R.TQ[i + 1][t.id]; const want = num(ls.displayValue ?? ls.value); if (q && q.pts !== want) out.issues.push(`${t.abbr} ${i < 4 ? 'Q' + (i + 1) : 'OT' + (i - 3)} score: ${q.pts} counted, ${want} official`); });
  }
  return out;
}

/* Nov 8 (Luka): NBA.com only: the NBA's box score and play-by-play through the site's /nba route, the same files the live page reads */
async function nbaLive() {
  const d = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(Date.now() - 4 * 3600e3)).replace(/-/g, '');
  /* Nov 19 audit: straight from the NBA's S3 bucket (GitHub can reach it; Cloudflare blocks GitHub from cavsdatabase.com, so the old
     /nba route returned nothing and every run said "no game in progress"). When the schedule says the Cavs play today but the
     feed can't be read, that is an alert, not a quiet pass. */
  const S3 = 'https://nba-prod-us-east-1-mediaops-stats.s3.amazonaws.com/NBA';
  const get = async u => { const r = await fetch(u, { signal: AbortSignal.timeout(30000) }); if (r.status === 403 || r.status === 404) return null; if (!r.ok) throw new Error('NBA ' + r.status + ' ' + u.split('/').pop()); return JSON.parse(await r.text()); };
  let id = null; try { id = JSON.parse(fs.readFileSync('pdata/nba-games.json', 'utf8')).d[d].CLE; } catch {}
  try {
    const sb = await get(S3 + '/liveData/scoreboard/todaysScoreboard_00.json');
    if (!sb && id) throw new Error('scoreboard unreadable');
    const x = sb && sb.scoreboard && (sb.scoreboard.games || []).find(x => (x.homeTeam.teamTricode === 'CLE' || x.awayTeam.teamTricode === 'CLE'));
    if (!id && x && String(x.gameCode || '').startsWith(d)) id = x.gameId;
    if (!id) return null;
    const live = x && x.gameId === id && x.gameStatus === 2;
    const [box, pbp] = await Promise.all([get(S3 + '/liveData/boxscore/boxscore_' + id + '.json'), get(S3 + '/liveData/playbyplay/playbyplay_' + id + '.json')]);
    if (live && (!box || !pbp)) throw new Error('game is live on the scoreboard but its box score or play-by-play is unreadable');
    const g = box && box.game; if (!g || g.gameStatus !== 2) return null;
    return { J: C.fromNBA(box, pbp), label: `${g.awayTeam.teamTricode} @ ${g.homeTeam.teamTricode} · live, ${g.gameStatusText || ''} (NBA feed)` };
  } catch (e) { if (id) { fs.mkdirSync('data', { recursive: true }); fs.writeFileSync('data/box-check-alert.txt', `Live check could not read the NBA feed for today's Cavs game (${id}): ${e.message}`); console.log('box-check: NBA feed unreadable for', id, e.message); process.exit(2); } return null; }
}
const games = [];
if (MODE === 'live') { const g = await nbaLive(); if (!g) { console.log('box-check: no Cavs game in progress'); process.exit(0); } games.push(g); }
else {
  const ix = JSON.parse(fs.readFileSync(path.join(DIR, 'index.json'), 'utf8')).slice().sort((a, b) => a.date < b.date ? 1 : -1);
  for (const g of (MODE === 'all' ? ix : ix.slice(0, 3))) { const f = path.join(DIR, g.id + '.json'); if (fs.existsSync(f)) games.push({ J: JSON.parse(fs.readFileSync(f, 'utf8')), label: `${g.et} ${g.ha === 'home' ? 'vs' : '@'} ${g.opp}` }); }
}
const res = games.map(g => { try { return check(g.J, g.label); } catch (e) { return { game: g.label, issues: ['check failed: ' + e.message], notes: [] }; } });
let bad = 0;
for (const r of res) {
  console.log(`${r.issues.length ? 'OFF' : 'ok '} ${r.game}${r.notes.length ? ` (${r.notes.length} gaps the page already corrects)` : ''}`);
  r.issues.forEach(x => console.log('    ' + x)); bad += r.issues.length;
}
fs.mkdirSync('data', { recursive: true });
fs.writeFileSync('data/box-check.json', JSON.stringify({ checked: new Date().toISOString(), mode: MODE, games: res }, null, 1) + '\n');
fs.rmSync('data/box-check-alert.txt', { force: true });
if (bad) { fs.writeFileSync('data/box-check-alert.txt', res.filter(r => r.issues.length).map(r => r.game + ': ' + r.issues.slice(0, 4).join('; ') + (r.issues.length > 4 ? ` (+${r.issues.length - 4} more)` : '')).join('\n')); process.exit(2); }
