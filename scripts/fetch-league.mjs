// League-wide player stats for the player pages (position ranks, percentiles, league averages).
// Reads ESPN's public scoreboard and box scores (the same feed fetch-boxscores uses), one regular season game at a time,
// and keeps running season totals per player in data/league.json. Safe to run every 30 minutes: finished games are
// remembered by id, so each run only reads new finals (at most MAX per run, so a backfill spreads over a few runs).
//   data/league.json = { season, updated, games: [espn event ids], players: { espnId: { n, t, p, g, gs, min, pts, reb, oreb, ast, stl, blk, tov, fgm, fga, tpm, tpa, ftm, fta, dd, b2b } } }
import { readFile, writeFile } from 'node:fs/promises';

const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
const FILE = new URL('../data/league.json', import.meta.url);
const SEASON = '2026-27', START = '2026-10-21', MAX = 40;
const etDate = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d);

let L = { season: SEASON, updated: null, games: [], players: {} };
try { const prev = JSON.parse(await readFile(FILE, 'utf8')); if (prev.season === SEASON) L = prev; } catch {}
const done = new Set(L.games);
const today = etDate();
if (today < START) { console.log('league feed: season has not started'); process.exit(0); }

const get = async u => { for (let i = 0; i < 3; i++) { try { const r = await fetch(u, { headers: { 'User-Agent': 'cavsdatabase.com (fan reference site)' } }); if (r.ok) return r.json(); } catch {} await new Promise(r => setTimeout(r, 1500 * (i + 1))); } throw new Error('fetch failed ' + u); };

// dates from opening night through yesterday (ET); today's games are read once they're final
const dates = [];
for (let d = new Date(START + 'T12:00:00Z'); etDate(d) <= today; d = new Date(d.getTime() + 864e5)) dates.push(etDate(d));

let read = 0, failed = 0;
for (const date of dates.reverse()) {               // newest first, so a long backfill never delays last night's games
  if (read >= MAX) break;
  let sb; try { sb = await get(`${ESPN}/scoreboard?dates=${date.replace(/-/g, '')}`); } catch { failed++; continue; }
  for (const ev of sb.events || []) {
    if (read >= MAX) break;
    if (done.has(ev.id)) continue;
    if (ev.season && ev.season.type !== 2) continue;                       // regular season only
    if (!ev.status?.type?.completed) continue;
    let sum; try { sum = await get(`${ESPN}/summary?event=${ev.id}`); } catch { failed++; continue; }
    for (const team of sum.boxscore?.players || []) {
      const st = team.statistics?.[0]; if (!st) continue;
      const keys = (st.names || st.labels || []).map(x => String(x).toUpperCase());
      const v = (a, k) => { const i = keys.indexOf(k); return i < 0 ? 0 : parseFloat(a.stats[i]) || 0; };
      const ma = (a, k) => { const i = keys.indexOf(k); const m = i < 0 ? null : String(a.stats[i] || '').match(/^(\d+)-(\d+)$/); return m ? [+m[1], +m[2]] : [0, 0]; };
      for (const a of st.athletes || []) {
        if (!a.stats?.length || a.didNotPlay) continue;
        const id = a.athlete?.id; if (!id) continue;
        const P = L.players[id] || (L.players[id] = { n: a.athlete.displayName, t: '', p: '', g: 0, gs: 0, min: 0, pts: 0, reb: 0, oreb: 0, ast: 0, stl: 0, blk: 0, tov: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, dd: 0 });
        P.n = a.athlete.displayName; P.t = team.team?.abbreviation || P.t; P.p = a.athlete.position?.abbreviation || P.p;
        const [fgm, fga] = ma(a, 'FG'), [tpm, tpa] = ma(a, '3PT'), [ftm, fta] = ma(a, 'FT');
        const pts = v(a, 'PTS'), reb = v(a, 'REB'), ast = v(a, 'AST'), stl = v(a, 'STL'), blk = v(a, 'BLK');
        P.g++; if (a.starter) P.gs++;
        P.min += v(a, 'MIN'); P.pts += pts; P.reb += reb; P.oreb += v(a, 'OREB'); P.ast += ast; P.stl += stl; P.blk += blk; P.tov += v(a, 'TO');
        P.fgm += fgm; P.fga += fga; P.tpm += tpm; P.tpa += tpa; P.ftm += ftm; P.fta += fta;
        if ([pts, reb, ast, stl, blk].filter(x => x >= 10).length >= 2) P.dd++;
      }
    }
    L.games.push(ev.id); done.add(ev.id); read++;
  }
}
L.updated = new Date().toISOString();
await writeFile(FILE, JSON.stringify(L) + '\n');
console.log(`league feed: read ${read} games (${L.games.length} total, ${Object.keys(L.players).length} players)${failed ? `, ${failed} requests failed` : ''}`);
