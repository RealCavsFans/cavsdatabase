// Past seasons' team net ratings (Nov 25, Luka): the season stats "opponent strength" filter ranks opponents by net rating. A finished
// season never changes, so this writes pdata/net-<season>.json once from that season's league-rates file (our own possession count of
// every regular season game's NBA play-by-play, scripts/league-rates.mjs), the same numbers the current season uses.
//   node scripts/net-past.mjs 2024-25 [2023-24 ...]
import fs from 'node:fs';
for (const se of process.argv.slice(2)) {
  const f = `pdata/league-rates-${se}.json`; if (!fs.existsSync(f)) { console.log(`net-past ${se}: no ${f}`); continue; }
  const LR = JSON.parse(fs.readFileSync(f, 'utf8')); const net = {};
  for (const [ab, rows] of Object.entries(LR.t || {})) { let po = 0, pd = 0, pf = 0, pa = 0; for (const r of rows) { po += r[1]; pd += r[2]; pf += r[3]; pa += r[4]; } if (po > 0 && pd > 0) net[ab] = Math.round((100 * pf / po - 100 * pa / pd) * 10) / 10; }
  fs.writeFileSync(`pdata/net-${se}.json`, JSON.stringify({ season: se, source: `Our count of every ${se} regular season game's NBA play-by-play (same possession count as this season and NBA.com); net = ORTG - DRTG`, net }));
  console.log(`net-past ${se}: ${Object.keys(net).length} teams, top ${Object.entries(net).sort((a, b) => b[1] - a[1]).slice(0, 3).map(x => x.join(' ')).join(', ')}`);
}
