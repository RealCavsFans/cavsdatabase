// "This day in Cavs history" box-score facts (Nov 15, 2026, Luka): the standout individual nights in every Cavs regular-season game
// on record, so the home card can mix eras instead of repeating one storyline. Sources:
//   data/hist-cle.json  2000–01 to 2025–26 (pbpstats game logs, every Cavs player's line)
//   data/hist-old.json  1970–71 to 1999–2000 (Basketball Reference box scores, when that pull has run)
// A night counts if it's 40+ points, a triple-double, 20 and 20, 15+ assists, 20+ rebounds, 8+ blocks, 7+ steals or 8+ threes.
// One fact per game (the biggest feat), at most 4 per calendar day (the best, spread over different seasons).
// Writes HIST_P into index.html: [mmdd, year, text, source url]. Run: node scripts/hist-facts.mjs
import { readFile, writeFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const NICK = { ATL: 'Hawks', BOS: 'Celtics', BKN: 'Nets', NJN: 'Nets', CHA: 'Hornets', CHH: 'Hornets', CHI: 'Bulls', DAL: 'Mavericks', DEN: 'Nuggets', DET: 'Pistons', GSW: 'Warriors', HOU: 'Rockets', IND: 'Pacers', LAC: 'Clippers', LAL: 'Lakers', MEM: 'Grizzlies', VAN: 'Grizzlies', MIA: 'Heat', MIL: 'Bucks', MIN: 'Timberwolves', NOP: 'Pelicans', NOH: 'Hornets', NOK: 'Hornets', NYK: 'Knicks', OKC: 'Thunder', SEA: 'SuperSonics', ORL: 'Magic', PHI: '76ers', PHX: 'Suns', POR: 'Trail Blazers', SAC: 'Kings', SAS: 'Spurs', TOR: 'Raptors', UTA: 'Jazz', WAS: 'Wizards', WSB: 'Bullets', BUF: 'Braves', KCK: 'Kings', SDC: 'Clippers', SDR: 'Rockets', NOJ: 'Jazz', NYN: 'Nets', CAP: 'Bullets', KCO: 'Kings', CIN: 'Royals' };
const FULL = { 'Clar. Weatherspoon': 'Clarence Weatherspoon' };
const games = [];
try { const H = JSON.parse(await readFile(new URL('data/hist-cle.json', root), 'utf8')); for (const g of H.games) games.push({ ...g, src: `https://www.basketball-reference.com/teams/CLE/${+g.s.slice(0, 4) + 1}_games.html` }); } catch (e) { console.log('hist-facts: no hist-cle', e.message) }
try { const O = JSON.parse(await readFile(new URL('data/hist-old.json', root), 'utf8')); for (const g of O.games) games.push({ ...g, src: g.box ? `https://www.basketball-reference.com/boxscores/${g.box}.html` : `https://www.basketball-reference.com/teams/CLE/${+g.s.slice(0, 4) + 1}_games.html` }); } catch { }
const cur = new Date(); const curStart = cur.getMonth() >= 7 ? cur.getFullYear() : cur.getFullYear() - 1;
const rows = [];
for (const g of games) {
  if (+g.s.slice(0, 4) >= curStart) continue;   // this season stays with the game pages
  if (!g.pl || g.p == null) continue;
  const win = g.p > g.op, opp = NICK[g.o] || g.o, res = (/^(8|18)/.test(String(Math.max(g.p, g.op))) ? 'an ' : 'a ') + Math.max(g.p, g.op) + '–' + Math.min(g.p, g.op) + (win ? ' win over the ' : ' loss to the ') + opp;
  let best = null;
  for (const r of g.pl) {
    const [nm0, pts, reb, ast, tpm, stl, blk] = r; const nm = FULL[nm0] || nm0;
    const tens = [pts, reb, ast, stl, blk].filter(x => x >= 10).length;
    const c = [];
    if (pts >= 40) c.push([100 + pts * 2, `${nm} scored ${pts} points${reb >= 10 ? ' with ' + reb + ' rebounds' : ast >= 10 ? ' with ' + ast + ' assists' : ''} in ${res}.`]);
    if (tens >= 3) c.push([120 + pts + reb + ast, `${nm} had a triple-double, ${pts} points, ${reb} rebounds and ${ast} assists${tens > 3 ? ' (plus ' + (stl >= 10 ? stl + ' steals' : blk + ' blocks') + ')' : ''}, in ${res}.`]);
    if (pts >= 20 && reb >= 20) c.push([110 + pts + reb, `${nm} put up ${pts} points and ${reb} rebounds in ${res}.`]);
    else if (reb >= 20) c.push([90 + reb * 2, `${nm} grabbed ${reb} rebounds in ${res}.`]);
    if (ast >= 15) c.push([95 + ast * 2, `${nm} handed out ${ast} assists in ${res}.`]);
    if (blk >= 8) c.push([95 + blk * 3, `${nm} blocked ${blk} shots in ${res}.`]);
    if (stl >= 7) c.push([95 + stl * 3, `${nm} had ${stl} steals in ${res}.`]);
    if (tpm >= 8) c.push([95 + tpm * 3, `${nm} made ${tpm} threes and scored ${pts} points in ${res}.`]);
    for (const x of c) if (!best || x[0] > best[0]) best = [x[0], x[1], nm];
  }
  if (best) rows.push({ md: g.d.slice(5, 7) + g.d.slice(8, 10), y: +g.d.slice(0, 4), d: g.d, sc: best[0], t: best[1], u: g.src, who: best[2], mates: g.pl.map(r => FULL[r[0]] || r[0]).filter(n => n !== best[2]).sort((a, b) => ((g.pl.find(r => (FULL[r[0]] || r[0]) === b) || [])[1] || 0) - ((g.pl.find(r => (FULL[r[0]] || r[0]) === a) || [])[1] || 0)) });
}
/* at most 4 per calendar day, the best ones, different seasons first */
const byDay = {}; for (const r of rows) (byDay[r.md] = byDay[r.md] || []).push(r);
const out = [];
for (const [md, l] of Object.entries(byDay)) { l.sort((a, b) => b.sc - a.sc); const pick = [], ys = new Set(); for (const r of l) { if (pick.length >= 4) break; if (ys.has(r.y)) continue; pick.push(r); ys.add(r.y) } pick.forEach(r => out.push([md, r.y, r.t, r.u])) }
out.sort((a, b) => a[0].localeCompare(b[0]) || a[1] - b[1]);
/* trivia from the same nights (Cavs & Coffee): "Which Cav …", the answer and three teammates from that game */
const MON = ['Jan.', 'Feb.', 'March', 'April', 'May', 'June', 'July', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.'];
const hsh = s2 => [...s2].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7);
const TQ = [];
for (const r of rows) {
  if (!r.who || !r.t.startsWith(r.who) || r.mates.length < 3) continue;
  const wrong = r.mates.slice(0, 3); const at = hsh(r.d + r.who) % 4; const c = wrong.slice(); c.splice(at, 0, r.who);
  const dt = MON[+r.d.slice(5, 7) - 1] + ' ' + (+r.d.slice(8, 10)) + ', ' + r.d.slice(0, 4);
  TQ.push({ md: r.md, y: r.y, q: 'Which Cav' + r.t.slice(r.who.length).replace(/\.$/, '') + ' on ' + dt + '?', c, a: at, src: r.u });
}
TQ.sort((a, b) => a.md.localeCompare(b.md) || a.y - b.y);
await writeFile(new URL('data/trivia-hist.json', root), JSON.stringify(TQ));
console.log('hist-facts:', TQ.length, 'history trivia questions');
const html = await readFile(new URL('index.html', root), 'utf8');
const next = 'const HIST_P=' + JSON.stringify(out) + ';';
const m = /const HIST_P=\[[\s\S]*?\];/.exec(html);
if (!m) { console.log('hist-facts: HIST_P not found in index.html'); process.exit(0); }
if (m[0] === next) { console.log('hist-facts: no change'); process.exit(0); }
await writeFile(new URL('index.html', root), html.replace(m[0], () => next));
console.log('hist-facts:', out.length, 'facts on', Object.keys(byDay).length, 'days from', games.length, 'games');
