// Cleveland Charge East rank for the /charge record tracker (Nov 4). Reads ESPN's G League standings and writes
// pdata/charge.json { east, w, l, saved }. Rank = playoff seed when ESPN gives one, else order by win% in the East.
// Exits 0 on any problem and leaves the old file alone.
import fs from 'fs';
const OUT = 'pdata/charge.json';
const U = 'https://site.api.espn.com/apis/v2/sports/basketball/nba-development/standings';
try {
  const r = await fetch(U, { headers: { 'User-Agent': 'Mozilla/5.0 (cavsdatabase.com)' }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) { console.log('HTTP', r.status); process.exit(0); }
  const j = await r.json();
  const groups = [];
  const walk = g => { if (g?.standings?.entries) groups.push(g); (g?.children || []).forEach(walk); };
  walk(j);
  const east = groups.find(g => /east/i.test(g.name || g.abbreviation || ''));
  if (!east) { console.log('no East group'); process.exit(0); }
  const st = (e, n) => { const s = (e.stats || []).find(x => x.name === n || x.type === n); return s ? +s.value : null; };
  const rows = east.standings.entries.map(e => ({ n: e.team?.displayName || '', w: st(e, 'wins') || 0, l: st(e, 'losses') || 0, seed: st(e, 'playoffSeed'), pct: st(e, 'winPercent') }));
  const me = rows.find(x => /charge/i.test(x.n));
  if (!me) { console.log('Charge not found'); process.exit(0); }
  let east_rank = null;
  if (me.w + me.l > 0) {
    if (me.seed) east_rank = me.seed;
    else { const p = x => x.w + x.l ? x.w / (x.w + x.l) : 0; east_rank = 1 + rows.filter(x => p(x) > p(me)).length; }
  }
  const out = { east: east_rank, w: me.w, l: me.l, saved: new Date().toISOString() };
  fs.writeFileSync(OUT, JSON.stringify(out) + '\n');
  console.log(out);
} catch (e) { console.log(String(e)); }
