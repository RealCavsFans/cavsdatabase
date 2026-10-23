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
      out[date] = { url, status: fin ? 'final' : 'scheduled', ...(fin ? { score: `${cle}-${opp}`, result: cle > opp ? 'W' : 'L' } : {}), ...(fin && prev[date]?.top ? { top: prev[date].top } : {}), ...(fin && prev[date]?.out ? { out: prev[date].out } : {}), ...(fin && prev[date]?.box ? { box: prev[date].box } : {}), ...(fin && prev[date]?.qs ? { qs: prev[date].qs } : {}), ...(prev[date]?.refs ? { refs: prev[date].refs } : {}) };
    }
  }
  // the site's injury report (index.html INJURIES): names listed Out, Doubtful, Questionable or Game-time decision
  let injuredNow = [];
  try { const html = await readFile('index.html', 'utf8'); const m = html.match(/\nconst INJURIES=(\[[\s\S]*?\]);/); if (m) injuredNow = Function('return ' + m[1])().map(r => r[0]); } catch {}
  // best Cavs stat line for finals in the last 3 days (ESPN box score)
  const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
  for (const [date, g] of Object.entries(out)) {
    // the last two days are re-read on every run, so stat corrections the league makes after a game get picked up
    const recent = Date.now() - Date.parse(date + 'T12:00:00Z') < 2 * 864e5;
    if (g.status !== 'final' || (!recent && g.top && g.out && g.box && g.qs) || Date.now() - Date.parse(date + 'T12:00:00Z') > 3 * 864e5) continue;
    try {
      const sb = await (await fetch(`${ESPN}/scoreboard?dates=${date.replace(/-/g, '')}`)).json();
      const ev = (sb.events || []).find(e => e.competitions?.[0]?.competitors?.some(c => c.team?.abbreviation === 'CLE'));
      if (!ev) continue;
      const sum = await (await fetch(`${ESPN}/summary?event=${ev.id}`)).json();
      // quarter-by-quarter line score: { cle: [28, 31, 27, 32], opp: [...] } (overtimes add entries)
      if (!g.qs) { const cs = sum.header?.competitions?.[0]?.competitors || []; const ls = c => (c?.linescores || []).map(q => +(q.value ?? q.displayValue)).filter(n => !isNaN(n));
        const me = cs.find(c => c.team?.abbreviation === 'CLE'), op = cs.find(c => c.team?.abbreviation !== 'CLE');
        if (ls(me).length >= 4 && ls(op).length === ls(me).length) g.qs = { cle: ls(me), opp: ls(op) }; }
      const t = (sum.boxscore?.players || []).find(p => p.team?.abbreviation === 'CLE');
      const st = t?.statistics?.[0]; if (!st) continue;
      // players out for injury or illness: inactive / did not play for any reason other than a coach's decision, plus anyone listed Out on ESPN's injury report for that game
      if (!g.out || (recent && !g.out.length)) { const o = new Set((st.athletes || []).filter(a => (a.didNotPlay || a.active === false) && a.reason && !/coach/i.test(a.reason)).map(a => a.athlete.displayName));
        const ij = (sum.injuries || []).find(x => x.team?.abbreviation === 'CLE'); (ij?.injuries || []).filter(i => /^out$/i.test(i.status || '')).forEach(i => { const nm = i.athlete?.displayName; if (nm && !(st.athletes || []).some(a => a.athlete?.displayName === nm && !a.didNotPlay && a.active !== false)) o.add(nm); });
        // ESPN often leaves inactive players out of the box score entirely: anyone on our injury report that night who never appeared counts as out
        if (recent) for (const nm of injuredNow) if (!(st.athletes || []).some(a => a.athlete?.displayName === nm && !a.didNotPlay)) o.add(nm);
        g.out = [...o]; }
      const keys = (st.names || st.labels || []).map(x => String(x).toUpperCase());
      const n = (a, k) => parseFloat(a.stats[keys.indexOf(k)]) || 0;
      const best = (st.athletes || []).filter(a => a.stats?.length).sort((x, y) => ['PTS', 'REB', 'AST', 'STL', 'BLK'].reduce((s2, k) => s2 + n(y, k) - n(x, k), 0))[0];
      // Cavs box score for the game page: [name, min, pts, reb, ast, +/-, starter, fg, 3pt, ft, stl, blk, to]
      if (!g.box || recent) g.box = (st.athletes || []).filter(a => a.stats?.length && !a.didNotPlay).map(a => [a.athlete.displayName, String(a.stats[keys.indexOf('MIN')] ?? ''), String(n(a, 'PTS')), String(n(a, 'REB')), String(n(a, 'AST')), String(a.stats[keys.indexOf('+/-')] ?? ''), a.starter ? 1 : 0, ...['FG', '3PT', 'FT'].map(k => { const i = keys.indexOf(k); return i < 0 ? '' : String(a.stats[i] ?? ''); }), String(n(a, 'STL')), String(n(a, 'BLK')), String(n(a, 'TO'))]).sort((x, y) => y[6] - x[6] || (parseFloat(y[1]) || 0) - (parseFloat(x[1]) || 0));
      // officials from ESPN, if the NBA page wasn't caught on game day
      if (!g.refs && sum.gameInfo?.officials?.length) g.refs = sum.gameInfo.officials.map(o => [o.position?.displayName || 'Official', o.displayName || o.fullName, String(o.jerseyNumber || '')]).filter(x => x[1]);
      if (best && (!g.top || recent)) g.top = `${best.athlete.displayName}: ${n(best, 'PTS')} pts, ${n(best, 'REB')} reb, ${n(best, 'AST')} ast`;
    } catch (e) { console.warn('top line unavailable for', date, e.message); }
  }
  // game-day officials: official.nba.com posts the crews around 9 AM ET ("Away @ Home" rows, "Name (#12)" cells)
  try {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
    if (out[today] && !out[today].refs) {
      const html = await (await fetch('https://official.nba.com/referee-assignments/', { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36' } })).text();
      const txt = s => s.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#0?39;|&rsquo;/g, "'").replace(/\s+/g, ' ').trim();
      const hd = (txt(html).match(/NBA Referee Assignments\s+((?:January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, \d{4})/) || [])[1];
      const day = hd && new Date(hd + ' 12:00 UTC').toISOString().slice(0, 10);
      if (day === today) {
        const nbaPart = html.split(/WNBA Referee Assignments/i)[0];
        for (const row of nbaPart.split(/<tr[\s>]/i).slice(1)) {
          const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => txt(m[1]));
          if (!cells.length || !/\bCleveland\b/.test(cells[0])) continue;
          const refs = cells.slice(1, 5).map((c, k) => [['Crew chief', 'Referee', 'Umpire', 'Alternate'][k], c.replace(/\s*\(#?\d+\)\s*$/, '').trim(), (c.match(/#\s*(\d+)/) || [])[1] || '']).filter(x => x[1]);
          if (refs.length) { out[today].refs = refs; console.log('officials:', refs.map(r => r[1]).join(', ')); }
          break;
        }
      }
    }
  } catch (e) { console.warn('officials unavailable:', e.message); }
  const sorted = Object.fromEntries(Object.entries(out).sort(([x], [y]) => x.localeCompare(y)));
  await writeFile('box.json', JSON.stringify(sorted, null, 1) + '\n');
  console.log('box.json:', Object.keys(sorted).length, 'games');
  await writeFile('box-status.txt', new Date().toISOString() + ' ok\n');
} catch (e) {
  console.warn('Box score feed unavailable, keeping existing box.json:', e.message);
  await writeFile('box-status.txt', new Date().toISOString() + ' ' + String(e.message || e) + (e.cause ? ' / ' + String(e.cause.code || e.cause.message || e.cause) : '') + '\n');
}
