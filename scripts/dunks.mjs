// Made dunks this season for every player, counted from the play-by-play saved in live-archive/<season>/<game>.json
// (the NBA's own feed: each made shot's text says "dunk"). Writes pdata/dunks.json {season, games, p:{nbaId: dunks}} for the player pages.
import { readFile, writeFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const se = '2026-27';
let ix = []; try { ix = JSON.parse(await readFile(new URL(`live-archive/${se}/index.json`, root), 'utf8')); } catch {}
const p = {}; let games = 0;
for (const g of ix) {
  let d; try { d = JSON.parse(await readFile(new URL(`live-archive/${se}/${g.id}.json`, root), 'utf8')); } catch { continue; }
  if (!Array.isArray(d.plays)) continue; games++;
  for (const q of d.plays) { const ty = String(q[1] || ''), tx = String(q[2] || ''); if (!/\bdunk/i.test(ty + ' ' + tx) || !/ makes /i.test(tx)) continue;
    const id = String(q[6] || '').split(',')[0]; if (id) p[id] = (p[id] || 0) + 1; }
}
const out = JSON.stringify({ season: se, games, p });
let prev = ''; try { prev = await readFile(new URL('pdata/dunks.json', root), 'utf8'); } catch {}
if (prev.trim() !== out) { await writeFile(new URL('pdata/dunks.json', root), out); console.log('dunks:', games, 'games,', Object.keys(p).length, 'players'); } else console.log('dunks: no changes');
