// Nov 16 (Luka): sets the leverage buckets (live-core.js LEV_CUT) from every NBA possession in the NBA game store:
// low = the least important half of possessions, medium = the next 30%, high = the next 15%, very high = the top 5%.
// Prints the cut points and the share of possessions in each bucket; examples check the scale against Darryl Blackport's.
// Usage: node scripts/leverage-cut.mjs <nba-data dir> [season]
import fs from 'fs'; import path from 'path'; import zlib from 'zlib'; import { createRequire } from 'module';
import { loadFixes, applyFixes } from './nba-fixes.mjs';
const C = createRequire(import.meta.url)('../live-core.js');
const ROOT = process.argv[2] || 'nba-data', SEASON = process.argv[3] || '2026-27', DIR = path.join(ROOT, SEASON), FIX = loadFixes(ROOT);
const L = [];
for (const f of fs.readdirSync(DIR).filter(f => /^002\d+\.json\.gz$/.test(f))) {
  try { const gid = f.slice(0, 10); const raw = applyFixes(JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(DIR, f)))), FIX[gid]);
    const D = C.prep(C.slimSummary(C.fromNBA({ game: raw.box }, { game: raw.pbp }))); if (!D.plays.length) continue;
    const R = C.deriveCore(D, D.plays, 'all'); for (const p of R.PL || []) if (p.lev != null && p.how !== 'oreb') L.push(p.lev); } catch (e) {}
}
L.sort((a, b) => a - b); const q = x => L[Math.floor(x * (L.length - 1))];
const cut = [q(.5), q(.8), q(.95)].map(x => +x.toFixed(4));
console.log(JSON.stringify({ possessions: L.length, cut }));
const ex = [['up 8, 1:20 left in the 4th (his Low)', 4, 2880 - 80, 8], ['up 1, 10:18 left (his Medium)', 4, 2880 - 618, 1], ['down 5, 7:06 left (his High)', 4, 2880 - 426, -5], ['down 2, 0:41 left (his Very High)', 4, 2880 - 41, -2], ['tied, start of game', 1, 0, 0], ['up 20, 3rd quarter', 3, 1800, 20]];
C.setLevCut(cut); for (const [l, per, t, m] of ex) console.log(l.padEnd(36), C.levOf(per, t, m).toFixed(4), ['Low', 'Medium', 'High', 'Very high'][C.levBucket(C.levOf(per, t, m))]);
