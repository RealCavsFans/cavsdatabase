// Builds box.json: { "YYYY-MM-DD": { url, status, score, top } } for every Cavs game
// (top = the best Cavs stat line, from ESPN's public box score, for recent finals; used by the site's final-score alert)
// (preseason + regular season) from NBA.com's public schedule feed.
// On any failure it keeps the existing box.json and exits 0.
import { readFile, writeFile } from 'node:fs/promises';
const FEED = 'https://cdn.nba.com/static/json/staticData/scheduleLeagueV2.json';
let prev = {};
try { prev = JSON.parse(await readFile('box.json', 'utf8')); } catch {}
try {
  const r = await fetch(FEED, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36', 'Accept': 'application/json, text/plain, */*', 'Accept-Language': 'en-US,en;q=0.9', 'Referer': 'https://www.nba.com/', 'Origin': 'https://www.nba.com' } });
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
      out[date] = { url, status: fin ? 'final' : 'scheduled', ...(fin ? { score: `${cle}-${opp}`, result: cle > opp ? 'W' : 'L' } : {}), ...(fin && prev[date]?.top ? { top: prev[date].top } : {}) };
    }
  }
  // best Cavs stat line for finals in the last 3 days (ESPN box score)
  const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
  for (const [date, g] of Object.entries(out)) {
    if (g.status !== 'final' || g.top || Date.now() - Date.parse(date + 'T12:00:00Z') > 3 * 864e5) continue;
    try {
      const sb = await (await fetch(`${ESPN}/scoreboard?dates=${date.replace(/-/g, '')}`)).json();
      const ev = (sb.events || []).find(e => e.competitions?.[0]?.competitors?.some(c => c.team?.abbreviation === 'CLE'));
      if (!ev) continue;
      const sum = await (await fetch(`${ESPN}/summary?event=${ev.id}`)).json();
      const t = (sum.boxscore?.players || []).find(p => p.team?.abbreviation === 'CLE');
      const st = t?.statistics?.[0]; if (!st) continue;
      const keys = (st.names || st.labels || []).map(x => String(x).toUpperCase());
      const n = (a, k) => parseFloat(a.stats[keys.indexOf(k)]) || 0;
      const best = (st.athletes || []).filter(a => a.stats?.length).sort((x, y) => ['PTS', 'REB', 'AST', 'STL', 'BLK'].reduce((s2, k) => s2 + n(y, k) - n(x, k), 0))[0];
      if (best) g.top = `${best.athlete.displayName}: ${n(best, 'PTS')} pts, ${n(best, 'REB')} reb, ${n(best, 'AST')} ast`;
    } catch (e) { console.warn('top line unavailable for', date, e.message); }
  }
  const sorted = Object.fromEntries(Object.entries(out).sort(([x], [y]) => x.localeCompare(y)));
  await writeFile('box.json', JSON.stringify(sorted, null, 1) + '\n');
  console.log('box.json:', Object.keys(sorted).length, 'games');
  await writeFile('box-status.txt', new Date().toISOString() + ' ok\n');
} catch (e) {
  console.warn('Box score feed unavailable, keeping existing box.json:', e.message);
  await writeFile('box-status.txt', new Date().toISOString() + ' ' + String(e.message || e) + (e.cause ? ' / ' + String(e.cause.code || e.cause.message || e.cause) : '') + '\n');
}
