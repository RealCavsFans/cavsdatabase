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
//   node scripts/box-check.mjs live         the Cavs game in progress, from ESPN (a check at each quarter break)
//
// Writes data/box-check.json. Exits 2 when something is off (the workflow turns that into a phone alert).
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const C = require('../live-core.js');

const SEASON = process.env.SEASON || '2026-27';
const DIR = path.join('live-archive', SEASON);
const MODE = process.argv[2] || 'recent';
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/';
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
      const P = D.P[id], e = P && P.espn; if (!e || P.dnp) continue; const b = R.B[id] || {};
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

/* the live page's own source first: the NBA's files through the site's /nba route, then ESPN */
async function nbaLive() {
  const d = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(Date.now() - 4 * 3600e3)).replace(/-/g, '');
  try { const r = await fetch(`https://cavsdatabase.com/nba?d=${d}&t=CLE`, { signal: AbortSignal.timeout(30000) }); if (!r.ok) return null; const j = await r.json();
    const w = x => x && (x.game ? x : { game: x }), box = w(j.box), pbp = w(j.pbp), g = box && box.game; if (!g || g.gameStatus !== 2) return null;
    return { J: C.fromNBA(box, pbp), label: `${g.awayTeam.teamTricode} @ ${g.homeTeam.teamTricode} · live, ${g.gameStatusText || ''} (NBA feed)` }; } catch { return null; }
}
async function espnLive() {
  const get = async u => { const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 (cavsdatabase.com)' }, signal: AbortSignal.timeout(30000) }); if (!r.ok) throw new Error(r.status + ' ' + u); return r.json(); };
  const yr = +SEASON.slice(0, 4) + 1, s = await get(`${ESPN}teams/5/schedule?season=${yr}`);
  const ev = (s.events || []).find(e => ((((e.competitions || [])[0] || {}).status || {}).type || {}).state === 'in');
  if (!ev) return null;
  const J = await get(`${ESPN}summary?event=${ev.id}`), st = ((J.header || {}).competitions || [{}])[0].status || {};
  return { J, label: `${ev.shortName} · live, ${(st.type || {}).shortDetail || ''}` };
}

const games = [];
if (MODE === 'live') { const g = (await nbaLive()) || (await espnLive().catch(e => { console.log('box-check: ESPN unavailable (' + e.message + ')'); return null; })); if (!g) { console.log('box-check: no Cavs game in progress'); process.exit(0); } games.push(g); }
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
