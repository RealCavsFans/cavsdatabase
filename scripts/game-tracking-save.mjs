// Merges a per-game hustle and tracking pull (scripts/game-tracking-pull.js, run in the browser) into pdata/game-tracking.json.
//   node scripts/game-tracking-save.mjs <file holding window.__GTK, joined from its slices>
// Checks the shape first and changes nothing if it looks wrong. Prints "no change" when only the date would move.
import fs from 'node:fs';
const f = process.argv[2]; if (!f) { console.error('usage: node scripts/game-tracking-save.mjs <file>'); process.exit(2) }
let raw = fs.readFileSync(f, 'utf8').trim(); if (raw.startsWith('"')) raw = JSON.parse(raw);
const j = JSON.parse(raw); const bad = [];
if (!/^\d{4}-\d\d$/.test(j.season || '')) bad.push('season');
for (const k of ['hu', 'to', 'dr', 'pa']) if (!Array.isArray(j.cols?.[k])) bad.push('cols ' + k);
for (const [gid, G] of Object.entries(j.g || {})) {
  if (!/^\d{10}$/.test(gid)) bad.push('game id ' + gid);
  const P = Object.entries(G.p || {}); if (P.length < 5) bad.push(gid + ': ' + P.length + ' players');
  /* Nov 24 audit: a player can be missing one group for a night (no hustle row after a short stint), so each row needs a name and at least one group, and every group it has must be the right length */
  for (const [, x] of P) { const ks = ['hu', 'to', 'dr', 'pa'].filter(k => x[k] != null); if (!x.n || !ks.length || ks.some(k => !Array.isArray(x[k]) || x[k].length !== j.cols[k].length)) bad.push(gid + ': player row ' + (x.n || '?')) }
}
if (bad.length) { console.error('game-tracking-save: not saved:', bad.slice(0, 8).join('; ')); process.exit(1) }
const out = 'pdata/game-tracking.json';
let old = null; try { old = JSON.parse(fs.readFileSync(out, 'utf8')) } catch {}
const keep = old && old.season === j.season ? old.g || {} : {};
const g = { ...keep, ...j.g };
const next = { season: j.season, updated: new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }), source: 'NBA.com (stats.nba.com): hustle stats and Second Spectrum player tracking, one game at a time (date filter, Cavs only)', cols: j.cols, g: Object.fromEntries(Object.entries(g).sort()) };
if (old && JSON.stringify({ ...old, updated: '' }) === JSON.stringify({ ...next, updated: '' })) { console.log('no change'); process.exit(0) }
fs.writeFileSync(out, JSON.stringify(next));
console.log(`game tracking: ${Object.keys(next.g).length} games saved (${Object.keys(j.g).length} pulled now), ${fs.statSync(out).size} bytes`);
