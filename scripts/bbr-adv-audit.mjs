// Advanced stats audit (Nov 15, 2026, Luka): reads Basketball Reference's Cavs team pages (one request per season)
// and keeps each player's Advanced line, so our season page numbers can be checked against them.
// Writes data/bbr-adv.json { updated, seasons: { '2025-26': { normalized name: {name, g, mp, ts, tpar, ftr, orb, drb, trb, ast, stl, blk, tov, usg} } } }.
// Run by hand from .github/workflows/bbr-adv-audit.yml. Exits 0 on any problem and keeps the old file.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const UA = 'Mozilla/5.0 (compatible; cavsdatabase-audit/1.0; +https://cavsdatabase.com)';
const norm = n => n.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\b/g, '').replace(/[^a-z]/g, '');
const dec = s => String(s || '').replace(/<[^>]*>/g, '').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').trim();
const K = { g: 'games', mp: 'mp', ts: 'ts_pct', tpar: 'fg3a_per_fga_pct', ftr: 'fta_per_fga_pct', orb: 'orb_pct', drb: 'drb_pct', trb: 'trb_pct', ast: 'ast_pct', stl: 'stl_pct', blk: 'blk_pct', tov: 'tov_pct', usg: 'usg_pct' };
const years = (process.env.YEARS || '2026,2027').split(',').map(Number);
const out = { updated: new Date().toISOString().slice(0, 10), seasons: {} };
try { const old = JSON.parse(await readFile(new URL('data/bbr-adv.json', root), 'utf8')); Object.assign(out.seasons, old.seasons || {}); } catch {}
for (const yr of years) {
  try {
    const r = await fetch(`https://www.basketball-reference.com/teams/CLE/${yr}.html`, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(30000) });
    if (!r.ok) { console.log('bbr-adv:', yr, 'HTTP', r.status); continue; }
    const html = (await r.text()).replace(/<!--|-->/g, '');
    const m = /<table[^>]*id="advanced"[\s\S]*?<\/table>/.exec(html);
    if (!m) { console.log('bbr-adv:', yr, 'no advanced table'); continue; }
    const P = {};
    for (const row of m[0].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
      const cell = k => { const x = new RegExp(`data-stat="${k}"[^>]*>([\\s\\S]*?)</t[dh]>`).exec(row[1]); return x ? dec(x[1]) : ''; };
      const name = cell('name_display') || cell('player'); if (!name || /^player$/i.test(name) || /team totals/i.test(name)) continue;
      const v = { name }; for (const [k, s] of Object.entries(K)) { const t = cell(s); v[k] = t === '' ? null : parseFloat(t); }
      P[norm(name)] = v;
    }
    const n = Object.keys(P).length; if (n < 8) { console.log('bbr-adv:', yr, 'only', n, 'players'); continue; }
    out.seasons[`${yr - 1}-${String(yr).slice(2)}`] = P; console.log('bbr-adv:', yr, n, 'players');
    await new Promise(r => setTimeout(r, 4000));
  } catch (e) { console.log('bbr-adv:', yr, String(e).slice(0, 200)); }
}
await mkdir(new URL('data/', root), { recursive: true });
await writeFile(new URL('data/bbr-adv.json', root), JSON.stringify(out));
process.exit(0);
