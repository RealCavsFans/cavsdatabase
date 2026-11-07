// NBA game IDs for every game this season (Nov 2), from the league's own schedule file:
//   https://nba-prod-us-east-1-mediaops-stats.s3.amazonaws.com/NBA/staticData/scheduleLeagueV2_1.json (7.4 MB, no compression)
// Writes pdata/nba-games.json: {season, updated, d:{YYYYMMDD:{TRICODE:"00226xxxxx", ...}}}. The worker (/nba) reads it to find a
// game's ID by date and team, so the live page can pull the NBA's play-by-play and box score. Runs in the morning job.
// The NBA base address lives in one place (NBA_BASE) because the feed moved without notice once (Oct 28, 2026).
import fs from 'node:fs';
export const NBA_BASE = 'https://nba-prod-us-east-1-mediaops-stats.s3.amazonaws.com/NBA';
const OUT = new URL('../pdata/nba-games.json', import.meta.url);
async function get(u) {
  for (let i = 0; i < 3; i++) {
    try { const r = await fetch(u, { signal: AbortSignal.timeout(60000) }); if (r.ok) return JSON.parse(await r.text()); console.log('HTTP', r.status, u); }
    catch (e) { console.log(String(e)); }
    await new Promise(r => setTimeout(r, 5000));
  }
  return null;
}
const j = await get(NBA_BASE + '/staticData/scheduleLeagueV2_1.json');
if (!j || !j.leagueSchedule) { console.log('nba-ids: no schedule; keeping the last file'); process.exit(0); }
const d = {};
for (const day of j.leagueSchedule.gameDates || []) for (const g of day.games || []) {
  if (!/^00[24]/.test(g.gameId)) continue;   // regular season and playoffs (00 = NBA, 2 = regular season, 4 = playoffs)
  const et = String(g.gameDateEst || g.gameDateTimeEst || '').slice(0, 10).replace(/-/g, ''); if (!et) continue;
  const o = d[et] = d[et] || {};
  for (const t of [g.homeTeam, g.awayTeam]) if (t && t.teamTricode) o[t.teamTricode] = g.gameId;
}
const out = { season: j.leagueSchedule.seasonYear, updated: new Date().toISOString().slice(0, 10), d };
let prev = null; try { prev = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch {}
if (prev && JSON.stringify(prev.d) === JSON.stringify(d)) { console.log('nba-ids: no changes'); process.exit(0); }
fs.writeFileSync(OUT, JSON.stringify(out));
console.log('nba-ids: saved', Object.keys(d).length, 'game days');
