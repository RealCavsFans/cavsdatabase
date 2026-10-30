import fs from 'fs';
fs.mkdirSync('scratch-out', { recursive: true });
const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36' };
const urls = {
  realgm: 'https://basketball.realgm.com/nba/teams/Cleveland-Cavaliers/5/Draft-History',
  wiki: 'https://en.wikipedia.org/w/index.php?title=Cleveland_Cavaliers_draft_history&action=raw',
};
for (const [k, u] of Object.entries(urls)) {
  try { const r = await fetch(u, { headers: UA }); const t = await r.text(); fs.writeFileSync('scratch-out/' + k + '.txt', t); console.log(k, r.status, t.length); }
  catch (e) { console.log(k, String(e)); fs.writeFileSync('scratch-out/' + k + '.err', String(e)); }
}
