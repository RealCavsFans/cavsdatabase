// Corrections to the NBA's own play-by-play (Nov 3). Two files, both applied wherever stored NBA games are read:
//   pdata/nba-fixes.json        hand-checked corrections (in the site repo)
//   <nba-data>/fixes.json       corrections the nightly fix finder found (scripts/nba-fixfind.mjs), saved with the games
// Each entry: {gameId: [{action: actionNumber, set: {fields to overwrite}} | {action, drop: true} | {player: personId, set: {box stats}}]}
import fs from 'fs';
import path from 'path';
const read = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return {}; } };
export function loadFixes(nbaDir) {
  const a = read(new URL('../pdata/nba-fixes.json', import.meta.url)), b = nbaDir ? read(path.join(nbaDir, 'fixes.json')) : {}, out = {};
  for (const src of [a, b]) for (const [g, l] of Object.entries(src)) { const have = out[g] || (out[g] = []); for (const f of l) if (!have.some(h => h.action === f.action && h.player === f.player)) have.push(f); }
  return out;
}
export function applyFixes(raw, list, log = () => {}) {
  for (const f of list || []) {
    if (f.action != null) { const i = raw.pbp.actions.findIndex(a => a.actionNumber === f.action); if (i < 0) { log('fix: no action ' + f.action); continue; } if (f.drop) raw.pbp.actions.splice(i, 1); else Object.assign(raw.pbp.actions[i], f.set || {}); }
    else if (f.player != null) { const p = [raw.box.homeTeam, raw.box.awayTeam].flatMap(t => t.players || []).find(p => p.personId === f.player); if (p) Object.assign(p.statistics, f.set || {}); else log('fix: no player ' + f.player); }
  }
  return raw;
}
