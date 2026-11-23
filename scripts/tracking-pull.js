// Play types, hustle and tracking (Nov 21, Luka). stats.nba.com only answers a real browser on an nba.com page, so the
// nightly scheduled task opens https://www.nba.com/stats/players/hustle in the built-in browser on Luka's computer,
// replaces SEASON below with the season string ('2026-27'), runs this whole file with the javascript tool, then reads
// window.__TRK in 15,000-character slices (poll until window.__TRK or window.__TRKerr is set; about a minute) and saves it as pdata/tracking.json (key order as built here).
// Everything is regular season, NBA.com: Synergy play types, hustle stats, and Second Spectrum tracking.
// Player ranks are per game, among players with 15+ minutes a game in at least half of the most games anyone has played.
window.__TRK = null; window.__TRKerr = null;
(async () => { try {
  const S = 'SEASON';
  const get = async u => { for (let k = 0; k < 3; k++) { try { const c = new AbortController(), tm = setTimeout(() => c.abort(), 20000); const r = await fetch(u, { signal: c.signal }); clearTimeout(tm); if (r.ok) return (await r.json()).resultSets } catch (e) {} await new Promise(r => setTimeout(r, 5000 * (k + 1))) } throw new Error('stats.nba.com failed: ' + u.split('?')[0].split('/').pop()) };
  const rows = rs => { const H = rs.headers; return rs.rowSet.map(r => Object.fromEntries(H.map((h, i) => [h, r[i]]))) };
  const r1 = x => x == null ? null : Math.round(x * 10) / 10;
  const rd = (c, x) => /^AVG_/.test(c) ? Math.round((x ?? 0) * 100) / 100 : r1(x ?? 0); // averages (sec and dribbles a touch) keep 2 decimals
  const OFF = ['Isolation','Transition','PRBallHandler','PRRollman','Postup','Spotup','Handoff','Cut','OffScreen','OffRebound','Misc'];
  const DEF = ['Isolation','PRBallHandler','PRRollman','Postup','Spotup','Handoff','OffScreen'];
  // play types: [gp, poss, pts, fgm, fga, tov% of poss, ft% of poss, score% of poss, percentile 0-100]
  const pv = r => [r.GP, r.POSS, r.PTS, r.FGM, r.FGA, r1(r.TOV_POSS_PCT * 100), r1(r.FT_POSS_PCT * 100), r1(r.SCORE_POSS_PCT * 100), Math.round(r.PERCENTILE * 100)];
  const pt = { cols: ['gp','poss','pts','fgm','fga','tov','ft','score','pctile'], p: { off: {}, def: {} }, t: { off: {}, def: {} } };
  for (const [grp, L] of [['offensive', OFF], ['defensive', DEF]]) {
    const k = grp === 'offensive' ? 'off' : 'def';
    for (const t of L) for (const who of ['P', 'T']) {
      const R = rows((await get(`https://stats.nba.com/stats/synergyplaytypes?LeagueID=00&PerMode=Totals&PlayType=${t}&PlayerOrTeam=${who}&SeasonType=Regular%20Season&SeasonYear=${S}&TypeGrouping=${grp}`))[0]);
      if (who === 'T') pt.t[k][t] = Object.fromEntries(R.map(r => [r.TEAM_ABBREVIATION, pv(r)]));
      else R.forEach(r => { if (r.TEAM_ABBREVIATION !== 'CLE') return; const o = pt.p[k][r.PLAYER_ID] = pt.p[k][r.PLAYER_ID] || { n: r.PLAYER_NAME }; o[t] = pv(r) });
    }
  }
  const Q = 'College=&Conference=&Country=&DateFrom=&DateTo=&Division=&DraftPick=&DraftYear=&GameScope=&GameSegment=&Height=&ISTRound=&LastNGames=0&LeagueID=00&Location=&Month=0&OpponentTeamID=0&Outcome=&PORound=0&PerMode=Totals&Period=0&PlayerExperience=&PlayerPosition=&Season=' + S + '&SeasonSegment=&SeasonType=Regular%20Season&StarterBench=&TeamID=0&VsConference=&VsDivision=&Weight=';
  // totals per group, in this column order
  const C = {
    hu: ['CONTESTED_SHOTS','CONTESTED_SHOTS_3PT','DEFLECTIONS','CHARGES_DRAWN','SCREEN_ASSISTS','SCREEN_AST_PTS','LOOSE_BALLS_RECOVERED','BOX_OUTS','DEF_BOXOUTS'],
    dr: ['DRIVES','DRIVE_FGM','DRIVE_FGA','DRIVE_FTA','DRIVE_PTS','DRIVE_PASSES','DRIVE_AST','DRIVE_TOV','DRIVE_PF','DRIVE_FTM'],
    cs: ['CATCH_SHOOT_FGM','CATCH_SHOOT_FGA','CATCH_SHOOT_FG3M','CATCH_SHOOT_FG3A','CATCH_SHOOT_PTS'],
    pu: ['PULL_UP_FGM','PULL_UP_FGA','PULL_UP_FG3M','PULL_UP_FG3A','PULL_UP_PTS'],
    to: ['TOUCHES','FRONT_CT_TOUCHES','TIME_OF_POSS','ELBOW_TOUCHES','POST_TOUCHES','PAINT_TOUCHES','POINTS','AVG_SEC_PER_TOUCH','AVG_DRIB_PER_TOUCH'],
    pa: ['PASSES_MADE','POTENTIAL_AST','AST_PTS_CREATED','SECONDARY_AST','AST'],
    // Nov 23 (Luka): what happens on elbow, post and paint touches
    el: ['ELBOW_TOUCHES','ELBOW_TOUCH_FGM','ELBOW_TOUCH_FGA','ELBOW_TOUCH_FTA','ELBOW_TOUCH_PTS','ELBOW_TOUCH_PASSES','ELBOW_TOUCH_AST','ELBOW_TOUCH_TOV','ELBOW_TOUCH_FOULS','ELBOW_TOUCH_FTM'],
    po: ['POST_TOUCHES','POST_TOUCH_FGM','POST_TOUCH_FGA','POST_TOUCH_FTA','POST_TOUCH_PTS','POST_TOUCH_PASSES','POST_TOUCH_AST','POST_TOUCH_TOV','POST_TOUCH_FOULS','POST_TOUCH_FTM'],
    pn: ['PAINT_TOUCHES','PAINT_TOUCH_FGM','PAINT_TOUCH_FGA','PAINT_TOUCH_FTA','PAINT_TOUCH_PTS','PAINT_TOUCH_PASSES','PAINT_TOUCH_AST','PAINT_TOUCH_TOV','PAINT_TOUCH_FOULS','PAINT_TOUCH_FTM']
  };
  const M = { dr: 'Drives', cs: 'CatchShoot', pu: 'PullUpShot', to: 'Possessions', pa: 'Passing', el: 'ElbowTouch', po: 'PostTouch', pn: 'PaintTouch' };
  const src = { hu: [rows((await get('https://stats.nba.com/stats/leaguehustlestatsplayer?' + Q))[0]), rows((await get('https://stats.nba.com/stats/leaguehustlestatsteam?' + Q))[0])] };
  for (const [k, m] of Object.entries(M)) src[k] = [rows((await get('https://stats.nba.com/stats/leaguedashptstats?' + Q + '&PlayerOrTeam=Player&PtMeasureType=' + m))[0]), rows((await get('https://stats.nba.com/stats/leaguedashptstats?' + Q + '&PlayerOrTeam=Team&PtMeasureType=' + m))[0])];
  const ab = {}; src.dr[1].forEach(r => ab[r.TEAM_ID] = r.TEAM_ABBREVIATION);
  const P = {}, T = {};
  for (const k of Object.keys(C)) {
    src[k][0].forEach(r => { const x = P[r.PLAYER_ID] = P[r.PLAYER_ID] || { n: r.PLAYER_NAME, t: r.TEAM_ABBREVIATION, gp: 0, min: 0 }; x.gp = Math.max(x.gp, r.GP ?? r.G ?? 0); x.min = Math.max(x.min, Math.round(r.MIN || 0)); x[k] = C[k].map(c => rd(c, r[c])) });
    src[k][1].forEach(r => { const id = r.TEAM_ABBREVIATION || ab[r.TEAM_ID]; if (!id) return; const x = T[id] = T[id] || { gp: 0 }; x.gp = Math.max(x.gp, r.GP || 0); x[k] = C[k].map(c => rd(c, r[c])) });
  }
  // player ranks, per game, among qualified players (1 = most)
  const RK = { con: ['hu', 0], dfl: ['hu', 2], chg: ['hu', 3], scr: ['hu', 4], lb: ['hu', 6], box: ['hu', 7], drv: ['dr', 0], drp: ['dr', 4], csp: ['cs', 4], pup: ['pu', 4], tch: ['to', 0], top: ['to', 2], pot: ['pa', 1], apc: ['pa', 2] };
  const top = Math.max(...Object.values(P).map(x => x.gp));
  const Qd = Object.entries(P).filter(([, x]) => x.gp >= Math.ceil(top / 2) && x.min / x.gp >= 15);
  const cle = {};
  for (const [id, x] of Object.entries(P)) if (x.t === 'CLE') { x.rk = {}; cle[id] = x }
  for (const [key, [g, i]] of Object.entries(RK)) {
    const v = Qd.filter(([, x]) => x[g]).map(([id, x]) => [id, x[g][i] / x.gp]).sort((a, b) => b[1] - a[1]);
    v.forEach(([id], j) => { if (cle[id]) cle[id].rk[key] = j + 1 });
  }
  for (const x of Object.values(cle)) { delete x.t; x.rk = Object.keys(x.rk).length ? x.rk : undefined }
  window.__TRK = JSON.stringify({ season: S, updated: '', source: 'NBA.com (stats.nba.com), regular season: Synergy play types, hustle stats and Second Spectrum player tracking', cols: C, q: Qd.length, pt, p: cle, t: T });
} catch (e) { window.__TRKerr = String(e) } })();
'started';
