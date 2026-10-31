// Remaining strength of schedule for all 30 teams -> pdata/sos.json (shown small on the home season tracker).
// Schedule: every team's regular-season games from ESPN, cached in data/league-schedule.json and refreshed weekly.
// Records: TSTATS in index.html (written by team-stats.mjs just before this runs).
// SOS = average current win % of the opponents left on the schedule, one entry per game. Rank 1 = hardest.
// Writes only when the numbers change, so quiet runs don't trigger a page rebuild.
import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const CACHE = new URL('data/league-schedule.json', root), OUT = new URL('pdata/sos.json', root);
const FIX = { GS: 'GSW', NY: 'NYK', NO: 'NOP', SA: 'SAS', UTAH: 'UTA', WSH: 'WAS', BRK: 'BKN', PHO: 'PHX', CHO: 'CHA' };
const ab = a => FIX[a] || a;
const warn = m => console.log(`::warning::sos: ${m}`);
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
const getJ = async u => { for (let i = 0; i < 3; i++) { try { const r = await fetch(u, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; cavsdatabase.com)' } }); if (r.ok) return await r.json(); } catch {} await new Promise(r => setTimeout(r, 1500 * (i + 1))); } return null; };

let cache = null; try { cache = JSON.parse(await readFile(CACHE, 'utf8')); } catch {}
const stale = !cache || !cache.fetched || Date.now() - Date.parse(cache.fetched) > 7 * 864e5;
if (stale) {
  const T = await getJ('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams');
  const teams = T?.sports?.[0]?.leagues?.[0]?.teams?.map(x => x.team) || [];
  const out = {};
  for (const t of teams) {
    const S = await getJ(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${t.id}/schedule?seasontype=2`);
    const me = ab(t.abbreviation);
    const g = (S?.events || []).map(e => { const c = e.competitions?.[0]; const o = c?.competitors?.find(x => x.team?.abbreviation !== t.abbreviation); return o ? [new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(e.date)), ab(o.team.abbreviation)] : null; }).filter(Boolean);
    if (g.length >= 60) out[me] = g; else warn(`${me}: only ${g.length} games`);
  }
  if (Object.keys(out).length === 30) { cache = { fetched: new Date().toISOString(), teams: out }; await writeFile(CACHE, JSON.stringify(cache) + '\n'); console.log('league schedule refreshed'); }
  else if (!cache) { warn(`schedule incomplete (${Object.keys(out).length} teams); skipping`); process.exit(0); }
}

const html = await readFile(new URL('index.html', root), 'utf8');
const m = html.match(/const TSTATS=(\{.*?\});/);
if (!m) { warn('no TSTATS'); process.exit(0); }
const TS = JSON.parse(m[1]);
const pct = a => { const r = TS[a]; return r && r[0] + r[1] ? r[0] / (r[0] + r[1]) : null; };
const rows = Object.entries(cache.teams).map(([t, g]) => { const left = g.filter(([d]) => d > today); const v = left.map(([, o]) => pct(o)).filter(x => x != null); return [t, v.length ? v.reduce((a, b) => a + b, 0) / v.length : null, left.length]; }).filter(r => r[1] != null);
if (rows.length < 30) { warn(`only ${rows.length} teams with records`); process.exit(0); }
rows.sort((a, b) => b[1] - a[1]);
const t = {}; rows.forEach(([a, v, n], i) => { t[a] = [Math.round(v * 1000) / 1000, i + 1, n]; });
const next = JSON.stringify({ d: today, t }) + '\n';
let prev = ''; try { prev = await readFile(OUT, 'utf8'); } catch {}
const body = s => s.replace(/"d":"[^"]*",?/, '');
if (body(prev) === body(next)) { console.log('sos unchanged'); process.exit(0); }
await writeFile(OUT, next);
console.log(`::notice::sos: CLE ${t.CLE ? t.CLE[1] + ' of 30' : 'n/a'}`);
