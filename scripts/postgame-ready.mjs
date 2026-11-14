// Postgame check gate (Nov 13, 2026). After a Cavs final, the full check runs once, as soon as tonight's game is in
// both places the pages read: the game archive (live-archive/<season>/season.json, live game and season pages) and the
// league feed (pdata/league.json, player pages and NBA ranks). Until then the check waits, so a feed that simply hasn't
// caught up yet never looks like a wrong number.
//
//   node scripts/postgame-ready.mjs <NBA game id>
// Prints ready=1 or ready=0 (and done=1 when this game was already checked) for $GITHUB_OUTPUT.
import fs from 'fs';

const id = process.argv[2];
const SEASON = process.env.SEASON || '2026-27';
const read = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } };
if (!id) { console.log('ready=0'); process.exit(0); }
const done = read('data/postgame-check.json');
if (done && done.game === id) { console.log('done=1'); console.log('ready=0'); process.exit(0); }
const S = read(`live-archive/${SEASON}/season.json`) || {};
const g = (S.games || []).find(x => x.id === id);
const L = read('pdata/league.json') || {};
const inLeague = g && g.espn && (L.games || []).map(String).includes(String(g.espn));
console.error(`postgame-ready ${id}: archive ${g ? 'yes' : 'no'}, league feed ${inLeague ? 'yes' : 'no'}`);
console.log(`ready=${g && inLeague ? 1 : 0}`);
