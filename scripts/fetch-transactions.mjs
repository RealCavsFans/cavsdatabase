// Builds data/transactions.json: every Cavaliers transaction RealGM lists since Koby Altman took over
// basketball operations (June 2017). On failure it keeps the existing file and exits 0.
import { readFile, writeFile } from 'node:fs/promises';
const BASE = 'https://basketball.realgm.com/nba/teams/Cleveland-Cavaliers/5/Transaction-History/';
const FROM = '2017-06-20';
const now = new Date();
const lastSeason = now.getMonth() >= 6 ? now.getFullYear() + 1 : now.getFullYear();
const MON = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
const strip = s => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#039;|&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const headers = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36', 'Accept': 'text/html', 'Accept-Language': 'en-US,en;q=0.9' };
let prev = [];
try { prev = JSON.parse(await readFile('data/transactions.json', 'utf8')); } catch {}
const out = [];
const errors = [];
for (let y = 2018; y <= lastSeason; y++) {
  try {
    const r = await fetch(BASE + y, { headers });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const html = await r.text();
    const re = /<h3[^>]*>\s*([A-Z][a-z]{2}) (\d{1,2}), (\d{4})\s*<\/h3>\s*<ul[^>]*>([\s\S]*?)<\/ul>/g;
    let m, n = 0;
    while ((m = re.exec(html))) {
      const d = `${m[3]}-${String(MON[m[1]]).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
      if (d < FROM) continue;
      for (const li of m[4].split(/<li[^>]*>/).slice(1)) { const t = strip(li); if (t) { out.push({ d, t }); n++; } }
    }
    console.log(y, n);
    await new Promise(r => setTimeout(r, 1500));
  } catch (e) { errors.push(y + ': ' + e.message); }
}
if (!out.length) { console.warn('No transactions parsed; keeping existing file.', errors.join('; ')); await writeFile('data/transactions-status.txt', new Date().toISOString() + ' ' + errors.join('; ') + '\n'); process.exit(0); }
const seen = new Set();
const uniq = out.filter(x => { const k = x.d + '|' + x.t; if (seen.has(k)) return false; seen.add(k); return true; }).sort((a, b) => b.d.localeCompare(a.d));
await writeFile('data/transactions.json', JSON.stringify(uniq) + '\n');
await writeFile('data/transactions-status.txt', new Date().toISOString() + ' ok ' + uniq.length + (errors.length ? ' errors: ' + errors.join('; ') : '') + '\n');
console.log('wrote', uniq.length);
