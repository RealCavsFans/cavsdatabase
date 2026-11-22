// Player-season pages (Nov 22, Luka): every Cavs player's game log for every season in the game archive (2020-21 on),
// from the NBA box scores saved in live-archive/<season>/<game>.json. Writes:
//   pdata/ps/<season>.json   { season, updated, cols, p: { <slug>: { n, id, g: [[date, opp, H|A, W|L, cle, opp pts, starter, ...cols]] } } }
//   pdata/ps/index.json      { <slug>: { n, s: [seasons, oldest first] } }   (drives the pages, the sitemap and the player-page links)
// Regular season only (the archive's own games). Safe to run any time; only writes files whose content changed.
//   node scripts/player-seasons.mjs
import fs from 'node:fs';
const AR = 'live-archive/', OUT = 'pdata/ps/';
const slug = t => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const COLS = ['min', 'pts', 'fgm', 'fga', 'tpm', 'tpa', 'ftm', 'fta', 'oreb', 'dreb', 'reb', 'ast', 'stl', 'blk', 'to', 'pf', 'pm'];
const mmss = s => { const m = /^(\d+)(?::(\d+))?/.exec(String(s || '')); return m ? +m[1] + (m[2] ? +m[2] / 60 : 0) : 0; };
fs.mkdirSync(OUT, { recursive: true });
const seasons = fs.readdirSync(AR).filter(s => /^\d{4}-\d\d$/.test(s) && fs.existsSync(AR + s + '/index.json')).sort();
const IDX = {}; let wrote = 0;
for (const se of seasons) {
  const ix = JSON.parse(fs.readFileSync(AR + se + '/index.json', 'utf8')).filter(g => g.id && g.et && /^002/.test(g.id)).sort((a, b) => a.et.localeCompare(b.et));
  /* Nov 22 (Luka): playoff games (live-archive/<season>/po) go in each player's po list, never in the regular-season log */
  let pix = []; try { pix = JSON.parse(fs.readFileSync(AR + se + '/po/index.json', 'utf8')).filter(g => g.id && g.et && /^004/.test(g.id)).map(g => ({ ...g, po: 1 })).sort((a, b) => a.et.localeCompare(b.et)); } catch {}
  const P = {};
  for (const g of [...ix, ...pix]) {
    let D; try { D = JSON.parse(fs.readFileSync(AR + se + (g.po ? '/po/' : '/') + g.id + '.json', 'utf8')); } catch { continue; }
    const comp = D.header && D.header.competitions && D.header.competitions[0]; if (!comp || !D.boxscore || !D.boxscore.players) continue;
    const ab = {}; (comp.competitors || []).forEach(c => ab[c.team.id] = c.team.abbreviation);
    const t = D.boxscore.players.find(x => ab[x.team.id] === 'CLE'); if (!t || !t.statistics || !t.statistics[0]) continue;
    const S = t.statistics[0], ix2 = n => S.names.indexOf(n);
    for (const a of S.athletes || []) {
      if (a.didNotPlay || !a.stats || !a.stats.length) continue;
      const v = n => a.stats[ix2(n)], pr = n => String(v(n) || '0-0').split('-').map(Number);
      const min = mmss(v('MIN')); if (!(min > 0)) continue;
      const [fgm, fga] = pr('FG'), [tpm, tpa] = pr('3PT'), [ftm, fta] = pr('FT');
      const row = [g.et, g.opp, g.ha === 'home' ? 'H' : 'A', g.cle > g.os ? 'W' : 'L', g.cle, g.os, a.starter ? 1 : 0,
        Math.round(min * 10) / 10, +v('PTS') || 0, fgm, fga, tpm, tpa, ftm, fta, +v('OREB') || 0, +v('DREB') || 0, +v('REB') || 0, +v('AST') || 0, +v('STL') || 0, +v('BLK') || 0, +v('TO') || 0, +v('PF') || 0, +String(v('+/-') || '0').replace('+', '') || 0];
      const nm = a.athlete.displayName, k = slug(nm);
      const o = (P[k] = P[k] || { n: nm, id: String(a.athlete.id), g: [] }); if (g.po) (o.po = o.po || []).push(row); else o.g.push(row);
    }
  }
  for (const [k, x] of Object.entries(P)) { if (x.g.length) (IDX[k] = IDX[k] || { n: x.n, s: [] }).s.push(se); }
  for (const x of Object.values(P)) if (!x.g.length) x.g = [];
  const out = JSON.stringify({ season: se, cols: ['date', 'opp', 'ha', 'res', 'cle', 'os', 'gs', ...COLS], p: P });
  const f = OUT + se + '.json'; if (!fs.existsSync(f) || fs.readFileSync(f, 'utf8') !== out) { fs.writeFileSync(f, out); wrote++; }
  console.log(`player-seasons ${se}: ${Object.keys(P).length} players, ${ix.length} games, ${pix.length} playoff games`);
}
const io = JSON.stringify(IDX); if (!fs.existsSync(OUT + 'index.json') || fs.readFileSync(OUT + 'index.json', 'utf8') !== io) { fs.writeFileSync(OUT + 'index.json', io); wrote++; }
console.log(`player-seasons: ${Object.keys(IDX).length} players, ${Object.values(IDX).reduce((t, x) => t + x.s.length, 0)} player-seasons, ${wrote} files written`);
