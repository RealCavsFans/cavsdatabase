// Nightly accuracy check: our play-by-play possession and point counts for every archived Cavs game,
// side by side with NBA.com's official counts (data/poss-nba.json, copied by hand: GitHub can't reach stats.nba.com) and,
// for games not in that file yet, pbpstats. Writes data/poss-check.json; scripts/health.mjs reports any game more than
// 2 possessions off NBA.com (3 off pbpstats, which itself differs from NBA.com by up to 3) or off on points.
// Nov 6: our side is recounted every run, so a fix to live-core.js shows up the next morning.
// Runs in morning.yml after the game archive. Exits 0 on network problems (the next run catches up).
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const C = require('../live-core.js');
const SEASON = process.env.SEASON || '2026-27';
const root = new URL('../', import.meta.url);
const OUT = new URL('data/poss-check.json', root);
const NBA = { NY: 'NYK', GS: 'GSW', SA: 'SAS', NO: 'NOP', UTAH: 'UTA', WSH: 'WAS' };   // ESPN → NBA abbreviations
const get = async u => { for (let i = 0; i < 4; i++) { try { const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 (cavsdatabase.com)' }, signal: AbortSignal.timeout(45000) }); if (r.ok) return await r.json(); } catch {} await new Promise(r => setTimeout(r, 5000 * (i + 1))); } return null; };
let prev = { season: SEASON, games: {} }; try { prev = JSON.parse(await readFile(OUT, 'utf8')); } catch {}
if (prev.season !== SEASON) prev = { season: SEASON, games: {} };
let idx = []; try { idx = JSON.parse(await readFile(new URL(`live-archive/${SEASON}/index.json`, root), 'utf8')); } catch { console.log('check-poss: no archive'); process.exit(0); }
const list = await get(`https://api.pbpstats.com/get-games/nba?Season=${SEASON}&SeasonType=Regular%20Season`);
if (!list || !list.results) { console.log('check-poss: pbpstats game list unavailable'); process.exit(0); }
let n = 0; const miss = [];
prev.debug = { listed: list.results.length };
for (const g of idx) {
  const opp = NBA[g.opp] || g.opp;
  const pg = list.results.find(x => x.Date === g.et && [x.HomeTeamAbbreviation, x.AwayTeamAbbreviation].includes('CLE') && [x.HomeTeamAbbreviation, x.AwayTeamAbbreviation].includes(opp));
  if (!pg) { miss.push(g.et + ' ' + opp + ': no pbpstats game'); continue; }
  // the game list already carries each side's possessions and points
  const cleSide = pg.HomeTeamAbbreviation === 'CLE' ? 'Home' : 'Away', oppSide = cleSide === 'Home' ? 'Away' : 'Home';
  if (pg[cleSide + 'Possessions'] == null) { miss.push(g.et + ' ' + opp + ': no possessions listed'); continue; }
  const pb = s => [pg[s + 'Possessions'] || 0, pg[s + 'Points'] || 0];
  let ours = null;
  try { const s = JSON.parse(await readFile(new URL(`live-archive/${SEASON}/${g.id}.json`, root), 'utf8')); const D = C.prep(s), Rr = C.deriveCore(D, D.plays, 'all'); const o = Object.keys(Rr.T).find(k => k !== '5');
    ours = { cle: [Rr.T['5'].np || 0, Rr.T['5'].pts], opp: [Rr.T[o].np || 0, Rr.T[o].pts] }; } catch (e) { console.log('check-poss: could not rebuild', g.id, String(e)); continue; }
  prev.games[g.id] = Object.assign(prev.games[g.id] || {}, { et: g.et, opp: g.opp, ours, pb: { cle: pb(cleSide), opp: pb(oppSide) } });
  n++;
}
/* NBA.com's own counts, where we have them */let NBAC = {}; try { NBAC = JSON.parse(await readFile(new URL('data/poss-nba.json', root), 'utf8')).games || {}; } catch {}
for (const [id, x] of Object.entries(prev.games)) { const q = NBAC[id]; if (q) x.nba = { cle: q.cle, opp: q.opp_ }; }
prev.updated = new Date().toISOString(); prev.debug.miss = miss;
await writeFile(OUT, JSON.stringify(prev, null, 1) + '\n');
const off = Object.entries(prev.games).filter(([, x]) => { const r = x.nba || x.pb, tol = x.nba ? 2 : 3; return r && x.ours && (Math.abs(x.ours.cle[0] - r.cle[0]) > tol || Math.abs(x.ours.opp[0] - r.opp[0]) > tol || x.ours.cle[1] !== r.cle[1] || x.ours.opp[1] !== r.opp[1]); });
console.log(`check-poss: compared ${n} new game(s); ${off.length} game(s) off by more than 2 possessions or any points`);
off.forEach(([id, x]) => console.log(' ', x.et, x.opp, 'ours', JSON.stringify(x.ours), x.nba ? 'NBA.com' : 'pbpstats', JSON.stringify(x.nba || x.pb)));
