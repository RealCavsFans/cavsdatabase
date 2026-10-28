// Season baselines for the live game page (/live.html): team and player shooting by zone,
// plus player per-game averages, from pbpstats. Writes /live-base.json once the season has games.
// The page compares tonight's shooting with these numbers; replays of older games keep the
// 2025–26 numbers built into the page.
import fs from 'fs';
const SEASON = process.env.SEASON || '2026-27';
const Z = ['AtRim', 'ShortMidRange', 'LongMidRange', 'Corner3', 'Arc3'];
const ESPN_ABBR = { SAS: 'SA', NYK: 'NY', GSW: 'GS', UTA: 'UTAH', WAS: 'WSH', NOP: 'NO' };
const norm = n => n.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\b/g, '').replace(/[^a-z]/g, '');
async function rows(type) {
  const u = `https://api.pbpstats.com/get-totals/nba?Season=${SEASON}&SeasonType=Regular%20Season&Type=${type}`;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 (cavsdatabase.com)' }, signal: AbortSignal.timeout(60000) });
      if (r.ok) { const j = await r.json(); return j.multi_row_table_data || []; }
      console.log(type, 'HTTP', r.status);
    } catch (e) { console.log(type, String(e)); }
    await new Promise(r => setTimeout(r, 5000));
  }
  return null;
}
const teams = await rows('Team');
if (!teams || !teams.length) { console.log(`No ${SEASON} team data yet; leaving live-base.json as is.`); process.exit(0); }
const players = (await rows('Player')) || [];
const zones = r => Z.map(z => [r[z + 'FGM'] || 0, r[z + 'FGA'] || 0]);
const t = {}; teams.forEach(r => { t[ESPN_ABBR[r.Name] || r.Name] = zones(r); });
const p = {}, s = {};
const r1 = x => Math.round(x * 10) / 10;
players.forEach(r => {
  const k = norm(r.Name || ''); if (!k) return;
  p[k] = zones(r);
  const g = r.GamesPlayed || 0; if (!g) return;
  const f = key => r1((r[key] || 0) / g);
  s[k] = [g, f('Minutes'), f('Points'), f('Rebounds'), f('Assists'), f('Steals'), f('Blocks'), f('Turnovers'), f('FG3M'), Math.round((r.TsPct || 0) * 1000) / 1000];
});
const lg = Z.map((z, i) => { let m = 0, a = 0; Object.values(t).forEach(v => { m += v[i][0]; a += v[i][1]; }); return [m, a]; });
const games = Math.max(...teams.map(r => r.GamesPlayed || 0));
fs.writeFileSync('live-base.json', JSON.stringify({ season: SEASON, updated: new Date().toISOString(), games, lg, t, p, s }));
// every team's full pbpstats totals, its own and what opponents did against it, for NBA ranks on the live page's play-by-play stats
{ const opp = (await rows('Opponent')) || [];
  const keep = r => Object.fromEntries(Object.entries(r).filter(([k, v]) => typeof v === 'number'));
  const T = {}, O = {}; teams.forEach(r => { T[ESPN_ABBR[r.Name] || r.Name] = keep(r); }); opp.forEach(r => { O[ESPN_ABBR[r.Name] || r.Name] = keep(r); });
  fs.mkdirSync('pdata', { recursive: true }); fs.writeFileSync('pdata/pbp-teams.json', JSON.stringify({ season: SEASON, updated: new Date().toISOString(), T, O }));
  // possessions by how they started (pbpstats StartType filter), own offense and opponents, for ranks on How possessions started
  const Zs = ['AtRim', 'ShortMidRange', 'LongMidRange', 'Corner3', 'Arc3', 'FT'];
  const ST = ['OffLiveBallTurnover', 'OffDeadball', 'OffTimeout', ...Zs.map(z => 'Off' + z + 'Miss'), ...Zs.map(z => 'Off' + z + 'Make'), ...Zs.slice(0, 5).map(z => 'Off' + z + 'Block')];
  const S2 = {};
  for (const st of ST) { for (const ty of ['Team', 'Opponent']) {
    const u = `https://api.pbpstats.com/get-totals/nba?Season=${SEASON}&SeasonType=Regular%20Season&Type=${ty}&StartType=${st}`;
    let r = null; for (let k = 0; k < 4; k++) { try { r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 (cavsdatabase.com)' }, signal: AbortSignal.timeout(60000) }); if (r.ok) break; console.log(st, ty, 'HTTP', r.status); } catch (e) { console.log(st, ty, String(e)); r = null; } await new Promise(w => setTimeout(w, 10000 * (k + 1))); }
    try { if (!r || !r.ok) continue;
      const j = await r.json(); const out = {}; (j.multi_row_table_data || []).forEach(x => { out[ESPN_ABBR[x.Name] || x.Name] = [x.OffPoss || 0, x.Points || 0, x.FG3A || 0, x.SecondsPerPossOff || null]; });
      (S2[st] = S2[st] || {})[ty] = out; console.log(st, ty, Object.keys(out).length, JSON.stringify(out.CLE)); } catch (e) { console.log(st, ty, String(e)); }
    await new Promise(r => setTimeout(r, 5000)); } }
  fs.writeFileSync('pdata/pbp-starts.json', JSON.stringify({ season: SEASON, updated: new Date().toISOString(), S: S2 }));
  console.log(`pdata/pbp-teams.json: ${Object.keys(T).length} teams, ${Object.keys(O).length} opponent rows, ${Object.keys(Object.values(T)[0] || {}).length} fields`); }
console.log(`live-base.json: ${SEASON}, ${Object.keys(t).length} teams, ${Object.keys(p).length} players, up to ${games} games`);
