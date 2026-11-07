// Builds niang.json: Saliou Niang's most recent LSU game (score and his stat line) from ESPN's public
// college basketball feed, for the site's "final" game alert. On any failure it keeps the existing file.
import { readFile, writeFile } from 'node:fs/promises';
const BASE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball';
const LSU = +(process.env.TEAM || 99), NAME = new RegExp(process.env.PLAYER || 'niang', 'i'), SEASON = process.env.SEASON ? `?season=${process.env.SEASON}` : '';
const get = async u => { const r = await fetch(u, { headers: { 'user-agent': 'cavsdatabase.com' } }); if (!r.ok) throw new Error(r.status + ' ' + u); return r.json(); };
let prev = null; try { prev = JSON.parse(await readFile('niang.json', 'utf8')); } catch {}
try {
  const sch = await get(`${BASE}/teams/${LSU}/schedule${SEASON}`);
  const done = (sch.events || []).filter(e => e.competitions?.[0]?.status?.type?.completed);
  const ev = done.sort((a, b) => a.date < b.date ? 1 : -1)[0];
  if (!ev) { console.log('niang: no completed LSU game yet'); process.exit(0); }
  const comp = ev.competitions[0];
  const side = c => [c.team.location || c.team.shortDisplayName || c.team.displayName, c.score?.displayValue ?? c.score];
  const [us, them] = [comp.competitors.find(c => +c.team.id === LSU), comp.competitors.find(c => +c.team.id !== LSU)].map(side);
  const sum = await get(`${BASE}/summary?event=${ev.id}`);
  let line = null;
  for (const t of sum.boxscore?.players || []) for (const st of t.statistics || []) {
    const keys = (st.labels || st.names || []).map(x => String(x).toUpperCase());
    const a = (st.athletes || []).find(x => /niang/i.test(x.athlete?.displayName || ''));
    if (!a) continue;
    if (a.didNotPlay || !a.stats?.length) { line = ''; continue; }
    const v = k => a.stats[keys.indexOf(k)];
    line = `${v('PTS')} pts, ${v('REB')} reb, ${v('AST')} ast · ${v('FG')} FG in ${v('MIN')} min`;
  }
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(ev.date));
  const out = { date: day, score: `${us[0]} ${us[1]}, ${them[0]} ${them[1]}`, line, url: `https://www.espn.com/mens-college-basketball/game/_/gameId/${ev.id}` };
  /* season totals: every completed LSU game he played (exhibitions left out), for his draft-rights card. Each game's line is kept in
     pdata/niang-games.json so a finished game is read once. */
  const G = await readFile('pdata/niang-games.json', 'utf8').then(JSON.parse).catch(() => ({}));
  for (const e of done) {
    if (G[e.id]) continue;
    const st = e.seasonType?.type ?? e.season?.type; if (st != null && +st !== 2 && +st !== 3) continue;   // regular season and postseason only
    let su; try { su = await get(`${BASE}/summary?event=${e.id}`); } catch { continue; }
    let g = { d: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(e.date)), opp: (e.competitions[0].competitors.find(c => +c.team.id !== LSU)?.team?.abbreviation) || '', dnp: true };
    /* Oct 31: also team and opponent totals (for his offensive/defensive rating, usage and rate stats) and his shots
       (spot, make, three, assisted) from the play-by-play, for the shot map on his draft-rights card */
    const line = (keys, arr) => { const v = k => arr[keys.indexOf(k)], n = k => +v(k) || 0, ma = k => String(v(k) || '0-0').split('-').map(Number);
      const [fgm, fga] = ma('FG'), [tpm, tpa] = ma('3PT'), [ftm, fta] = ma('FT');
      return { min: n('MIN'), pts: n('PTS'), reb: n('REB'), oreb: n('OREB'), dreb: n('DREB'), ast: n('AST'), stl: n('STL'), blk: n('BLK'), to: n('TO'), pf: n('PF'), fgm, fga, tpm, tpa, ftm, fta }; };
    let pid = null; const TT = {};
    for (const t of su.boxscore?.players || []) for (const s2 of t.statistics || []) {
      const keys = (s2.labels || s2.names || []).map(x => String(x).toUpperCase());
      const side = +t.team?.id === LSU ? 'tm' : 'op';
      if (s2.totals?.length) { const tot = line(keys, s2.totals); tot.min = (s2.athletes || []).reduce((a3, x) => a3 + (+x.stats?.[keys.indexOf('MIN')] || 0), 0); TT[side] = tot; }
      const a = (s2.athletes || []).find(x => NAME.test(x.athlete?.displayName || '')); if (!a || a.didNotPlay || !a.stats?.length) continue;
      pid = a.athlete?.id; g = { ...g, dnp: false, ...line(keys, a.stats) };
    }
    if (!g.dnp) { if (TT.tm && TT.op) { g.tm = TT.tm; g.op = TT.op; }
      g.sh = (su.plays || []).filter(p => p.shootingPlay && !/free throw/i.test(p.text || '') && String(p.participants?.[0]?.athlete?.id) === String(pid) && p.coordinate && p.coordinate.x != null)
        .map(p => { let x = +p.coordinate.x, y = +p.coordinate.y; if (y > 47) { y = 94 - y; x = 50 - x; } return [x, y, p.scoringPlay ? 1 : 0, /three point/i.test(p.text || '') ? 1 : 0, (p.scoringPlay && (/assist/i.test(p.text || '') || (p.participants || []).length > 1)) ? 1 : 0]; }); }
    G[e.id] = g;
  }
  await writeFile('pdata/niang-games.json', JSON.stringify(G) + '\n');
  const pl = Object.values(G).filter(g => !g.dnp); const sum2 = k => pl.reduce((s3, g) => s3 + (g[k] || 0), 0);
  const K = ['min', 'pts', 'reb', 'oreb', 'dreb', 'ast', 'stl', 'blk', 'to', 'pf', 'fgm', 'fga', 'tpm', 'tpa', 'ftm', 'fta'];
  if (pl.length) { out.season = { season: process.env.SEASON ? `${process.env.SEASON - 1}–${String(process.env.SEASON).slice(2)}` : '2026–27', gp: pl.length, ...Object.fromEntries(K.map(k => [k, sum2(k)])) };
    /* team and opponent totals over the games he played (for ratings), every shot, and his latest game */
    const both = pl.filter(g => g.tm && g.op); if (both.length) out.season.gpt = both.length, ['tm', 'op'].forEach(sd => { out.season[sd] = Object.fromEntries(K.map(k => [k, both.reduce((a3, g) => a3 + (g[sd][k] || 0), 0)])); });
    out.shots = pl.flatMap(g => g.sh || []);
    const last = Object.entries(G).filter(([, g]) => !g.dnp).sort((a3, b3) => a3[1].d < b3[1].d ? 1 : -1)[0];
    if (last) { const { sh, tm, op, ...rest } = last[1]; out.last = { ...rest, id: last[0] }; } }
  if (JSON.stringify(out) !== JSON.stringify(prev)) { await writeFile('niang.json', JSON.stringify(out, null, 1) + '\n'); console.log('niang.json:', out); }
} catch (e) { console.warn('Niang feed unavailable, keeping existing niang.json:', e.message); }
