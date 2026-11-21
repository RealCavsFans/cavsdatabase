// Postgame check gate (Nov 13, 2026). After a Cavs final, the full check runs once, as soon as tonight's game is in
// both places the pages read: the game archive (live-archive/<season>/season.json, live game and season pages) and the
// league feed (pdata/league.json, player pages and NBA ranks). Until then the check waits, so a feed that simply hasn't
// caught up yet never looks like a wrong number.
//
//   node scripts/postgame-ready.mjs <NBA game id>
// Prints ready=1 or ready=0 (and done=1 when this game was already checked) for $GITHUB_OUTPUT.
import { CUR_SEASON } from './season.mjs';   // Nov 21: the season from one place
import fs from 'fs';

const id = process.argv[2];
const SEASON = process.env.SEASON || CUR_SEASON;
const read = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } };
if (!id) { console.log('ready=0'); process.exit(0); }
const done = read('data/postgame-check.json');
if (done && done.game === id) { console.log('done=1'); console.log('ready=0'); process.exit(0); }
const S = read(`live-archive/${SEASON}/season.json`) || {};
const g = (S.games || []).find(x => x.id === id);
const L = read('pdata/league.json') || {};
const inLeague = g && g.espn && (L.games || []).map(String).includes(String(g.espn));
/* Nov 21: the league feed lists tonight's game before the NBA's player season totals catch up (Harden's 51 vs IND was
   missing from his line for over an hour), so also wait until every Cavs player who played tonight has the same number of
   games in the league feed as in the archive. */
const P = L.players || {};
const behind = g && inLeague ? (g.pl || []).filter(pid => { const nm = ((S.P || {})[pid] || {}).name; const all = Object.values(P); const l = P[pid] || all.find(x => x.n === nm && x.t === 'CLE') || all.find(x => x.n === nm); if (!l) return false; const n = (S.games || []).filter(x => (x.pl || []).includes(pid)).length; return (l.g || 0) < n; }) : [];
console.error(`postgame-ready ${id}: archive ${g ? 'yes' : 'no'}, league feed ${inLeague ? 'yes' : 'no'}, player totals ${behind.length ? behind.length + ' players a game behind' : 'in step'}`);
console.log(`ready=${g && inLeague && !behind.length ? 1 : 0}`);
