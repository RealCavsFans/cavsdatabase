// The Cavs' season rates for the live page's "Tonight vs the season" card, from the site's own team numbers
// (TSTATS and FFR in index.html: this season from the first game). Writes pdata/cle-rates.json.
import { CUR_SEASON, PREV_SEASON } from './season.mjs';   // Nov 21: the season from one place
import { readFile, writeFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const s = await readFile(new URL('index.html', root), 'utf8');
const g = n => { const m = s.match(new RegExp('const ' + n + '=([\\[{][\\s\\S]*?[\\]}]);')); try { return m ? Function('return ' + m[1])() : null; } catch { return null; } };
const T = g('TSTATS') || {}, F = g('FFR') || {}, TP = g('TSTATS_PREV') || {}, FP = g('FFR_PREV') || {};
const cur = T.CLE && F.CLE && T.CLE[0] + T.CLE[1] >= 1;   // Nov 4: this season from game one
const t = cur ? T.CLE : TP.CLE, f = cur ? F.CLE : FP.CLE;
if (!t || !f) { console.log('cle-rates: no data'); process.exit(0); }
const [fgm, fga, tpm, ftm, fta, orb, drb, tov, ofgm, ofga, otpm, oftm, ofta, oorb, odrb, otov] = f;
const r1 = x => Math.round(x * 10) / 10;
const out = { season: cur ? CUR_SEASON : PREV_SEASON, g: t[0] + t[1], pace: t[6], ortg: t[4], drtg: t[5],
  efg: r1(100 * (fgm + 0.5 * tpm) / fga), tov: r1(100 * tov / (f[17] || (t[4] ? t[2] / t[4] * 100 : fga - orb + tov + 0.44 * fta))), orb: r1(100 * orb / (orb + odrb)), ftr: r1(100 * fta / fga),   /* Nov 16 (Luka): NBA.com four factors: TOV% per counted possession, FT rate = FTA / FGA */ oefg: r1(100 * (ofgm + 0.5 * otpm) / ofga) };
/* Nov 20 audit: this season straight from the game archive's totals (the season page's own numbers), so nothing is rounded twice
   (the per-game averages in FFR are rounded to 0.1 first: eFG% came out 55.9 against the page's 55.8) */
try { const A = JSON.parse(await readFile(new URL(`live-archive/${CUR_SEASON}/season.json`, root), 'utf8')); const gs = (A.games || []).filter(g => g.t && g.u);
  if (cur && gs.length === out.g && gs.every(g => g.t[12] > 0 && g.u[12] > 0)) { const S = (k, i) => gs.reduce((t, g) => t + (+g[k][i] || 0), 0), po = S('t', 12), pd = S('u', 12), sec = S('t', 11) || gs.length * 2880;
    const fr = gs.every(g => g.t.length > 14 && g.u.length > 14);
    Object.assign(out, { pace: r1(48 * ((po + pd) / 2) / (sec / 60)), ortg: r1(100 * S('t', 0) / po), drtg: r1(100 * S('u', 0) / pd), efg: r1(100 * (S('t', 1) + 0.5 * S('t', 3)) / S('t', 2)), tov: r1(100 * S('t', 10) / po),
      orb: fr ? r1(100 * S('t', 13) / (S('t', 13) + S('u', 14))) : out.orb, ftr: r1(100 * S('t', 6) / S('t', 2)), oefg: r1(100 * (S('u', 1) + 0.5 * S('u', 3)) / S('u', 2)), src: 'archive' }); } } catch {}
let prev = ''; try { prev = await readFile(new URL('pdata/cle-rates.json', root), 'utf8'); } catch {}
const next = JSON.stringify(out); if (prev.trim() !== next) { await writeFile(new URL('pdata/cle-rates.json', root), next); console.log('cle-rates:', next); } else console.log('cle-rates: no changes');
