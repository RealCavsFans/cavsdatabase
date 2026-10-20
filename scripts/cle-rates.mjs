// The Cavs' season rates for the live page's "Tonight vs the season" card, from the site's own team numbers
// (TSTATS and FFR in index.html: this season once the Cavs have 10 games, last season before that). Writes data/cle-rates.json.
import { readFile, writeFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const s = await readFile(new URL('index.html', root), 'utf8');
const g = n => { const m = s.match(new RegExp('const ' + n + '=([\\[{][\\s\\S]*?[\\]}]);')); try { return m ? Function('return ' + m[1])() : null; } catch { return null; } };
const T = g('TSTATS') || {}, F = g('FFR') || {}, TP = g('TSTATS_PREV') || {}, FP = g('FFR_PREV') || {};
const cur = T.CLE && F.CLE && T.CLE[0] + T.CLE[1] >= 10;
const t = cur ? T.CLE : TP.CLE, f = cur ? F.CLE : FP.CLE;
if (!t || !f) { console.log('cle-rates: no data'); process.exit(0); }
const [fgm, fga, tpm, ftm, fta, orb, drb, tov, ofgm, ofga, otpm, oftm, ofta, oorb, odrb, otov] = f;
const r1 = x => Math.round(x * 10) / 10;
const out = { season: cur ? '2026-27' : '2025-26', g: t[0] + t[1], pace: t[6], ortg: t[4], drtg: t[5],
  efg: r1(100 * (fgm + 0.5 * tpm) / fga), tov: r1(100 * tov / (fga + 0.44 * fta + tov)), orb: r1(100 * orb / (orb + odrb)), ftr: r1(100 * ftm / fga), oefg: r1(100 * (ofgm + 0.5 * otpm) / ofga) };
let prev = ''; try { prev = await readFile(new URL('data/cle-rates.json', root), 'utf8'); } catch {}
const next = JSON.stringify(out); if (prev.trim() !== next) { await writeFile(new URL('data/cle-rates.json', root), next); console.log('cle-rates:', next); } else console.log('cle-rates: no changes');
