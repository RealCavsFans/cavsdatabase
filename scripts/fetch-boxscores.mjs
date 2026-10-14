// Builds box.json: { "YYYY-MM-DD": { url, status, score } } for every Cavs game
// (preseason + regular season) from NBA.com's public schedule feed.
// On any failure it keeps the existing box.json and exits 0.
import { readFile, writeFile } from 'node:fs/promises';
const FEED = 'https://cdn.nba.com/static/json/staticData/scheduleLeagueV2.json';
let prev = {};
try { prev = JSON.parse(await readFile('box.json', 'utf8')); } catch {}
try {
  const r = await fetch(FEED, { headers: { 'User-Agent': 'Mozilla/5.0 cavsdatabase.com', 'Accept': 'application/json' } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const data = await r.json();
  const out = { ...prev };
  for (const day of data.leagueSchedule.gameDates) {
    for (const g of day.games) {
      const h = g.homeTeam?.teamTricode, a = g.awayTeam?.teamTricode;
      if (h !== 'CLE' && a !== 'CLE') continue;
      const d = (g.gameCode || '').slice(0, 8);
      if (!/^\d{8}$/.test(d)) continue;
      const date = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
      const url = `https://www.nba.com/game/${a.toLowerCase()}-vs-${h.toLowerCase()}-${g.gameId}/box-score`;
      const fin = g.gameStatus === 3;
      const cle = h === 'CLE' ? g.homeTeam.score : g.awayTeam.score;
      const opp = h === 'CLE' ? g.awayTeam.score : g.homeTeam.score;
      out[date] = { url, status: fin ? 'final' : 'scheduled', ...(fin ? { score: `${cle}-${opp}`, result: cle > opp ? 'W' : 'L' } : {}) };
    }
  }
  const sorted = Object.fromEntries(Object.entries(out).sort(([x], [y]) => x.localeCompare(y)));
  await writeFile('box.json', JSON.stringify(sorted, null, 1) + '\n');
  console.log('box.json:', Object.keys(sorted).length, 'games');
} catch (e) {
  console.warn('Box score feed unavailable, keeping existing box.json:', e.message);
  await writeFile('box-status.txt', new Date().toISOString() + ' ' + String(e.message || e) + (e.cause ? ' / ' + String(e.cause.code || e.cause.message || e.cause) : '') + '\n');
}
