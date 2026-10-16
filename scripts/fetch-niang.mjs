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
  if (!ev || Date.now() - Date.parse(ev.date) > 3 * 864e5) { console.log('niang: no recent completed LSU game'); process.exit(0); }
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
  if (JSON.stringify(out) !== JSON.stringify(prev)) { await writeFile('niang.json', JSON.stringify(out, null, 1) + '\n'); console.log('niang.json:', out); }
} catch (e) { console.warn('Niang feed unavailable, keeping existing niang.json:', e.message); }
