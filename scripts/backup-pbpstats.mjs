// Backup for the season team stats if ESPN's feed stops working.
// fetch-league.mjs saves each game's team lines from ESPN into pdata/league.json (L.tg), and team-stats.mjs builds
// standings, ratings and four factors from them. This fills in any finished game ESPN hasn't delivered within a day
// from pbpstats.com instead (key "pb<GameId>"), so the team numbers keep updating. team-stats.mjs prefers ESPN's
// line when both exist. Reads at most MAX games per run and exits 0 on any problem.
import { readFile, writeFile } from 'node:fs/promises';
const FILE = new URL('../pdata/league.json', import.meta.url);
const SEASON = process.env.SEASON || '2026-27', MAX = 40;
let L; try { L = JSON.parse(await readFile(FILE, 'utf8')); } catch { console.log('backup: no league.json yet'); process.exit(0); }
if (L.season !== SEASON) { console.log('backup: league.json is for another season'); process.exit(0); }
L.tg = L.tg || {};
const get = async u => { for (let i = 0; i < 5; i++) { try { const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 (cavsdatabase.com)' }, signal: AbortSignal.timeout(45000) }); if (r.ok) return await r.json(); } catch {} await new Promise(r => setTimeout(r, 4000 * (i + 1))); } return null; };
const ESPN = { NYK: 'NY', GSW: 'GS', SAS: 'SA', NOP: 'NO', UTA: 'UTAH', WAS: 'WSH' };   // match the abbreviations ESPN's lines use
const etDay = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d);
const cutoff = etDay(new Date(Date.now() - 864e5));   // games through yesterday; ESPN normally has these within minutes
const have = new Set(Object.values(L.tg).map(g => g.d + '|' + (g.t || []).map(t => ESPN[t.ab] || t.ab).sort().join('-')));
const list = await get(`https://api.pbpstats.com/get-games/nba?Season=${SEASON}&SeasonType=Regular%20Season`);
if (!list || !list.results) { console.log('backup: pbpstats game list unavailable'); process.exit(0); }
const todo = list.results.filter(g => g.Date < cutoff && !L.tg['pb' + g.GameId] && !have.has(g.Date + '|' + [g.HomeTeamAbbreviation, g.AwayTeamAbbreviation].map(a => ESPN[a] || a).sort().join('-'))).slice(0, MAX);
if (!todo.length) { console.log('backup: nothing missing'); process.exit(0); }
let added = 0;
for (const g of todo) {
  const d = await get(`https://api.pbpstats.com/get-game-stats?GameId=${g.GameId}&Type=Player`);
  const R = d && d.team_results; if (!R || !R.Home || !R.Away) continue;
  const line = (side, ab, pts) => { const x = R[side].FullGame || {}; const fg2m = x.FG2M || 0, fg2a = x.FG2A || 0, tpm = x.FG3M || 0, tpa = x.FG3A || 0;
    return { ab: ESPN[ab] || ab, pts: x.Points ?? pts, fgm: fg2m + tpm, fga: fg2a + tpa, tpm, tpa, ftm: x.FtPoints || 0, fta: x.FTA || 0, orb: x.OffRebounds || 0, drb: x.DefRebounds || 0, tov: x.Turnovers || 0 }; };
  const per = Math.max(4, Object.keys(R.Home).filter(k => /^\d+$/.test(k)).length);
  L.tg['pb' + g.GameId] = { d: g.Date, per, t: [line('Away', g.AwayTeamAbbreviation, g.AwayPoints), line('Home', g.HomeTeamAbbreviation, g.HomePoints)], src: 'pbpstats' };
  added++; await new Promise(r => setTimeout(r, 1500));
}
if (added) await writeFile(FILE, JSON.stringify(L) + '\n');
console.log(`backup: filled ${added} of ${todo.length} missing game(s) from pbpstats`);
