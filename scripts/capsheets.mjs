// League salaries from Capsheets (Nov 22, Luka: weekly refresh). Every team's cap sheet for the season, the roster rows only
// (numbered players, before "Total Payroll"; dead money, cap holds and two-way deals are left out), saved as
// pdata/league-salaries.json { season, updated, source, asOf: {team: date}, teams: {team: {player: salary}} }.
// A team whose page can't be read or looks wrong keeps its last saved sheet and its old date.
//   node scripts/capsheets.mjs
import fs from 'node:fs';
import { CUR_SEASON } from './season.mjs';
const OUT = 'pdata/league-salaries.json';
const T = { ATL: 'atlanta-hawks', BOS: 'boston-celtics', BKN: 'brooklyn-nets', CHA: 'charlotte-hornets', CHI: 'chicago-bulls', CLE: 'cleveland-cavaliers',
  DAL: 'dallas-mavericks', DEN: 'denver-nuggets', DET: 'detroit-pistons', GS: 'golden-state-warriors', HOU: 'houston-rockets', IND: 'indiana-pacers',
  LAC: 'los-angeles-clippers', LAL: 'los-angeles-lakers', MEM: 'memphis-grizzlies', MIA: 'miami-heat', MIL: 'milwaukee-bucks', MIN: 'minnesota-timberwolves',
  NO: 'new-orleans-pelicans', NY: 'new-york-knicks', OKC: 'oklahoma-city-thunder', ORL: 'orlando-magic', PHI: 'philadelphia-76ers', PHX: 'phoenix-suns',
  POR: 'portland-trail-blazers', SAC: 'sacramento-kings', SA: 'san-antonio-spurs', TOR: 'toronto-raptors', UTAH: 'utah-jazz', WSH: 'washington-wizards' };
const [y1, y2] = CUR_SEASON.split('-'), Y = `${y1}-${+y1 + 1}`;
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
const text = s => s.replace(/<[^>]+>/g, '').replace(/&#0?39;|&#8217;|&rsquo;/g, "'").replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
let old = null; try { old = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch {}
const out = { season: CUR_SEASON, updated: today, source: 'Capsheets', asOf: {}, teams: {} };
const bad = [];
for (const [ab, slug] of Object.entries(T)) {
  let sheet = null;
  try {
    const r = await fetch(`https://www.capsheets.com/${slug}-cap-sheet-${Y}-season/`, { headers: { 'user-agent': 'cavsdatabase.com weekly salary check (+https://cavsdatabase.com/about)' }, signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const h = await r.text(), t0 = h.indexOf('<table'), t1 = h.indexOf('</table>', t0);
    if (t0 < 0) throw new Error('no table');
    sheet = {};
    for (const row of h.slice(t0, t1).split(/<\/tr>/i)) {
      const c = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => text(m[1]));
      if (/^Total Payroll/i.test(c[0] || '')) break;
      if (c.length >= 3 && /^\d+$/.test(c[0]) && c[1] && /\$\s*[\d,]+/.test(c[2])) sheet[c[1].normalize('NFD').replace(/[\u0300-\u036f]/g, '')] = +c[2].replace(/[^\d]/g, '');
    }
    const n = Object.keys(sheet).length, sum = Object.values(sheet).reduce((a, b) => a + b, 0);
    if (n < 10 || n > 16 || sum < 1e8 || sum > 4e8) throw new Error(`${n} players, $${Math.round(sum / 1e6)}M`);
  } catch (e) { bad.push(`${ab}: ${e.message}`); sheet = null; }
  if (sheet) { out.teams[ab] = sheet; out.asOf[ab] = today; }
  else if (old && old.season === CUR_SEASON && old.teams && old.teams[ab]) { out.teams[ab] = old.teams[ab]; out.asOf[ab] = (old.asOf && old.asOf[ab]) || old.updated; }
  await new Promise(r => setTimeout(r, 1500));   // polite: one page every second and a half
}
if (bad.length) console.log('::warning::capsheets: kept the last saved sheet for ' + bad.join('; '));
if (bad.length > 10) { console.log('capsheets: too many teams unreadable, nothing saved'); process.exit(0); }
const same = old && JSON.stringify(old.teams) === JSON.stringify(out.teams);
if (same) { console.log('capsheets: no salary changes'); process.exit(0); }
fs.writeFileSync(OUT, JSON.stringify(out));
const ch = old ? Object.keys(out.teams).filter(k => JSON.stringify(out.teams[k]) !== JSON.stringify((old.teams || {})[k])) : Object.keys(out.teams);
console.log(`capsheets: ${Object.keys(out.teams).length} teams saved, changed: ${ch.join(', ') || 'none'}`);
