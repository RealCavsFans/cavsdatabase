// Charge game share cards (Nov 22, Luka): the data for each finished Charge game's card, drawn on the live page
// (/live.html?chargecard=<ESPN game id>, same banner and terminal window as the other share cards).
// From index.html (CHARGE games, TWOWAY, CH_ROSTER and PLAYERS ids for headshots) and pdata/charge-box.json (every Charge player's line).
// Writes pdata/charge-cards.json { <ESPN game id>: { date, opp, ha, wl, cs, os, rec, C: [Cavs players], lead: [5 categories] } }.
// G League free throws: one shot worth 2 or 3, so TS% counts each FTA as a full trip (pts / 2 / (FGA + FTA)).
//   node scripts/charge-cards.mjs
import fs from 'node:fs';
const html = fs.readFileSync('index.html', 'utf8');
let CH, TW; try { CH = Function('return ' + /const CHARGE=(\{record:[\s\S]*?\]\]\});/.exec(html)[1])(); TW = Function('return ' + /const TWOWAY=(\[[^;]*\]);/.exec(html)[1])().map(x => x[0]); } catch (e) { console.log('charge-cards: CHARGE not found'); process.exit(0); }
const HS = {};
{ const r = /const CH_ROSTER=\[([\s\S]*?)\];/.exec(html); if (r) for (const m of r[1].matchAll(/\[\d+, "([^"]+)",[^\]]*?(\d{6,8})\]/g)) HS[m[1]] = m[2];
  const P = /const PLAYERS=\[([\s\S]*?)\];\n/.exec(html); if (P) for (const m of P[1].matchAll(/\['[^']*','([^']+)'[^\n]*?,(\d{6,8})\],?\s*$/gm)) HS[m[1]] = HS[m[1]] || m[2]; }
let box = {}; try { box = JSON.parse(fs.readFileSync('pdata/charge-box.json', 'utf8')); } catch {}
const out = {};
for (const g of CH.games) {
  const m = /gameId\/(\d+)/.exec(g[6] || ''); if (!g[4] || !m || !box[m[1]]) continue;
  const L = box[m[1]].lines.map(r => ({ n: r[0], min: r[1], pts: r[2], reb: r[3], ast: r[4], stl: r[5], blk: r[6], fgm: r[7], fga: r[8], tpm: r[9], tpa: r[10], ftm: r[11], fta: r[12], hs: HS[r[0]] && fs.existsSync('img/h/' + HS[r[0]] + '.png') ? HS[r[0]] : null }));
  const [wl, sc] = g[4].split(' '), [cs, os] = sc.split('–').map(Number);
  const done = CH.games.filter(x => x[4] && x[0] <= g[0]), rec = done.filter(x => x[4][0] === 'W').length + '–' + done.filter(x => x[4][0] === 'L').length;
  const cav = new Set([...TW, ...(g[7] || []).map(x => x[0])]);
  const C = L.filter(l => cav.has(l.n)).sort((a, b) => b.pts - a.pts).map(l => ({ ...l, tag: TW.includes(l.n) ? 'TWO-WAY' : 'ASSIGNMENT' }));
  const cats = [['PTS', l => l.pts], ['REB', l => l.reb], ['STOCKS', l => l.stl + l.blk], ['AST', l => l.ast], ['3PM', l => l.tpm]];
  const lead = cats.map(([k, f]) => { const mx = Math.max(...L.map(f)); return { k, v: mx, who: L.filter(l => f(l) === mx).map(l => ({ n: l.n, hs: l.hs })) }; });
  out[m[1]] = { date: g[0], opp: g[1], ha: g[2], wl, cs, os, rec, C, lead };
}
const s = JSON.stringify(out); let old = ''; try { old = fs.readFileSync('pdata/charge-cards.json', 'utf8'); } catch {}
if (s !== old) fs.writeFileSync('pdata/charge-cards.json', s);
console.log(`charge-cards: ${Object.keys(out).length} games`);
