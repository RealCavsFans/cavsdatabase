// Per-game hustle and tracking for Cavs players (Nov 23, Luka). Runs in the built-in browser on an nba.com page, like tracking-pull.js.
// The task replaces SEASON with the season string and GAMES_JSON with the output of node scripts/game-tracking-list.mjs <season>,
// runs every line that does not start with //, polls window.__GTK / window.__GTKerr, reads window.__GTK in 15,000-character slices
// and saves it with node scripts/game-tracking-save.mjs <file>. Each game is one date with the Cavs as the team filter.
window.__GTK = null; window.__GTKerr = null;
(async () => { try {
  const S = 'SEASON', GAMES = GAMES_JSON, CLE = '1610612739';
  const get = async u => { for (let k = 0; k < 3; k++) { try { const c = new AbortController(), tm = setTimeout(() => c.abort(), 20000); const r = await fetch(u, { signal: c.signal }); clearTimeout(tm); if (r.ok) return (await r.json()).resultSets } catch (e) {} await new Promise(r => setTimeout(r, 4000 * (k + 1))) } throw new Error('stats.nba.com failed: ' + u.split('?')[0].split('/').pop()) };
  const rows = rs => { const H = rs.headers; return rs.rowSet.map(r => Object.fromEntries(H.map((h, i) => [h, r[i]]))) };
  const r1 = x => x == null ? 0 : Math.round(x * 10) / 10;
  const C = {
    hu: ['CONTESTED_SHOTS','DEFLECTIONS','CHARGES_DRAWN','SCREEN_ASSISTS','SCREEN_AST_PTS','LOOSE_BALLS_RECOVERED','BOX_OUTS'],
    to: ['TOUCHES','TIME_OF_POSS','POINTS'],
    dr: ['DRIVES','DRIVE_PTS','DRIVE_FGM','DRIVE_FGA','DRIVE_PASSES','DRIVE_AST','DRIVE_TOV'],
    pa: ['PASSES_MADE','POTENTIAL_AST','AST_PTS_CREATED']
  };
  const M = { to: 'Possessions', dr: 'Drives', pa: 'Passing' };
  const g = {};
  for (const [gid, day] of GAMES) {
    const D = encodeURIComponent(day);
    const Q = 'College=&Conference=&Country=&DateFrom=' + D + '&DateTo=' + D + '&Division=&DraftPick=&DraftYear=&GameScope=&GameSegment=&Height=&ISTRound=&LastNGames=0&LeagueID=00&Location=&Month=0&OpponentTeamID=0&Outcome=&PORound=0&PerMode=Totals&Period=0&PlayerExperience=&PlayerPosition=&Season=' + S + '&SeasonSegment=&SeasonType=Regular%20Season&StarterBench=&TeamID=' + CLE + '&VsConference=&VsDivision=&Weight=';
    const src = { hu: [rows((await get('https://stats.nba.com/stats/leaguehustlestatsplayer?' + Q))[0]), rows((await get('https://stats.nba.com/stats/leaguehustlestatsteam?' + Q))[0])] };
    for (const [k, m] of Object.entries(M)) src[k] = [rows((await get('https://stats.nba.com/stats/leaguedashptstats?' + Q + '&PlayerOrTeam=Player&PtMeasureType=' + m))[0]), rows((await get('https://stats.nba.com/stats/leaguedashptstats?' + Q + '&PlayerOrTeam=Team&PtMeasureType=' + m))[0])];
    const p = {}, t = {};
    for (const k of Object.keys(C)) {
      src[k][0].forEach(r => { if (String(r.TEAM_ID || CLE) !== CLE && r.TEAM_ABBREVIATION && r.TEAM_ABBREVIATION !== 'CLE') return; const x = p[r.PLAYER_ID] = p[r.PLAYER_ID] || { n: r.PLAYER_NAME, min: 0 }; x.min = Math.max(x.min, r1(r.MIN)); x[k] = C[k].map(c => r1(r[c])) });
      const tr = src[k][1].find(r => String(r.TEAM_ID) === CLE || r.TEAM_ABBREVIATION === 'CLE'); if (tr) t[k] = C[k].map(c => r1(tr[c]));
    }
    if (Object.keys(p).length) g[gid] = { p, t };
  }
  window.__GTK = JSON.stringify({ season: S, cols: C, g });
} catch (e) { window.__GTKerr = String(e) } })();
'started';
