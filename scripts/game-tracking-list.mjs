// Prints the Cavs regular-season games whose hustle and tracking numbers still need pulling (Nov 23, Luka):
// every archived game not yet in pdata/game-tracking.json, plus the last 3 days (NBA.com sometimes revises a box).
//   node scripts/game-tracking-list.mjs <season>   ->  JSON [[gameId, "MM/DD/YYYY"], ...]  (or [] when nothing is due)
import fs from 'node:fs';
const S = process.argv[2]; if (!/^\d{4}-\d\d$/.test(S || '')) { console.error('usage: node scripts/game-tracking-list.mjs 2026-27'); process.exit(2) }
let idx = []; try { idx = JSON.parse(fs.readFileSync(`live-archive/${S}/index.json`, 'utf8')) } catch {}
let have = {}; try { const j = JSON.parse(fs.readFileSync('pdata/game-tracking.json', 'utf8')); if (j.season === S) have = j.g || {} } catch {}
const today = new Date(new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }) + 'T12:00:00Z');
const out = idx.filter(g => /^002/.test(g.id) && g.et && g.cle != null).filter(g => !have[g.id] || (today - new Date(g.et + 'T12:00:00Z')) / 864e5 <= 3)
  .map(g => { const [y, m, d] = g.et.split('-'); return [g.id, `${m}/${d}/${y}`] });
console.log(JSON.stringify(out));
