// Builds niang.json: Saliou Niang's most recent LSU game (score and his stat line) from ESPN's public
// college basketball feed, for the site's "final" game alert. On any failure it keeps the existing file.
import { readFile, writeFile } from 'node:fs/promises';
const BASE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball';
const LSU = 99;
const get = async u => { const r = await fetch(u, { headers: { 'user-agent': 'cavsdatabase.com' } }); if (!r.ok) throw new Error(r.status + ' ' + u); return r.json(); };
let prev = null; try { prev = JSON.parse(await readFile('niang.json', 'utf8')); } catch {}
try {
  const sch = await get(`${BASE}/teams/${LSU}/schedule`);
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
    for (const t of su.boxscore?.players || []) for (const s2 of t.statistics || []) {
      const keys = (s2.labels || s2.names || []).map(x => String(x).toUpperCase());
      const a = (s2.athletes || []).find(x => /niang/i.test(x.athlete?.displayName || '')); if (!a || a.didNotPlay || !a.stats?.length) continue;
      const v = k => a.stats[keys.indexOf(k)], n = k => +v(k) || 0, ma = k => String(v(k) || '0-0').split('-').map(Number);
      const [fgm, fga] = ma('FG'), [tpm, tpa] = ma('3PT'), [ftm, fta] = ma('FT');
      g = { ...g, dnp: false, min: n('MIN'), pts: n('PTS'), reb: n('REB'), ast: n('AST'), stl: n('STL'), blk: n('BLK'), to: n('TO'), fgm, fga, tpm, tpa, ftm, fta };
    }
    G[e.id] = g;
  }
  await writeFile('pdata/niang-games.json', JSON.stringify(G) + '\n');
  const pl = Object.values(G).filter(g => !g.dnp); const sum2 = k => pl.reduce((s3, g) => s3 + (g[k] || 0), 0);
  if (pl.length) out.season = { season: '2026–27', gp: pl.length, ...Object.fromEntries(['min', 'pts', 'reb', 'ast', 'stl', 'blk', 'to', 'fgm', 'fga', 'tpm', 'tpa', 'ftm', 'fta'].map(k => [k, sum2(k)])) };
  if (JSON.stringify(out) !== JSON.stringify(prev)) { await writeFile('niang.json', JSON.stringify(out, null, 1) + '\n'); console.log('niang.json:', out); }
} catch (e) { console.warn('Niang feed unavailable, keeping existing niang.json:', e.message); }
