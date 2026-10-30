// For each Cavs draft pick: position from the Basketball Reference player page (or the draft page for players who never played),
// and class year from the Sports Reference college page (seasons played before the draft).
import fs from 'fs';
fs.mkdirSync('scratch-out', { recursive: true });
const H = JSON.parse(fs.readFileSync('pdata/history.json', 'utf8'));
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const get = async u => { for (let i = 0; i < 3; i++) { try { const r = await fetch(u, { headers: UA }); if (r.status === 429) { await sleep(60000); continue; } if (r.ok) return await r.text(); return null; } catch { await sleep(3000); } } return null; };
const out = {};
let prev = {}; try { prev = JSON.parse(fs.readFileSync('scratch-out/draft-extra.json', 'utf8')); } catch {}
for (const [y, r, p, n, sch] of H.draft) {
  const k = `${y}|${p}|${n}`; if (prev[k] && prev[k].pos) { out[k] = prev[k]; continue; }
  const id = (H.bbd || {})[k]; const o = { sch };
  if (id) {
    const t = await get(`https://www.basketball-reference.com/players/${id[0]}/${id}.html`); await sleep(3300);
    if (t) {
      const m = t.match(/<strong>\s*Position:\s*<\/strong>\s*([^<\n]+)/); if (m) o.pos = m[1].replace(/&#9642;|▪/g, '').replace(/\s+/g, ' ').trim();
      const c = t.match(/href="(https:\/\/www\.sports-reference\.com\/cbb\/players\/[^"]+)"/); if (c) o.cbb = c[1];
    }
    if (o.cbb) {
      const t2 = await get(o.cbb); await sleep(3300);
      if (t2) { const yrs = [...t2.matchAll(/data-stat="year_id"[^>]*>(?:<a[^>]*>)?(\d{4})-\d{2}/g)].map(x => +x[1]); const seasons = [...new Set(yrs.filter(v => v < y))]; o.ns = seasons.length;
        const cl = [...t2.matchAll(/data-stat="class"[^>]*>([A-Z][A-Za-z]*)</g)].map(x => x[1]); if (cl.length) o.cls = cl[cl.length - 1]; }
    }
  }
  out[k] = o; console.log(k, JSON.stringify(o));
  fs.writeFileSync('scratch-out/draft-extra.json', JSON.stringify(out, null, 1));
}
fs.writeFileSync('scratch-out/draft-extra.json', JSON.stringify(out, null, 1));
