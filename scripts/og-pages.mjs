// Share images for the main pages (cap, schedule, assets and transactions are drawn live by og-live.mjs): og.jpg (site-wide) and og/<route>.jpg (1200x630). Run by hand when a page title or the brand changes.
import { writeFile, unlink, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const pw = (() => { for (const m of ['playwright-core', 'playwright']) { try { return require(m); } catch {} } return null; })();
if (!pw) { console.log('og-pages: playwright missing, skipped'); process.exit(0); }
const root = new URL('../', import.meta.url);
const mark = (await readFile(new URL('logos/cavs_db-mark.svg', root), 'utf8'));
const PAGES = [
  ['og.jpg', null, 'Everything Cavaliers.', 'Everything you need.', 'cavsdatabase.com'],
  ['og/charge.jpg', 'Cleveland Charge', 'Schedule, roster and staff of the Cavs’ G League team', '', 'charge'],
  ['og/media.jpg', 'Media', 'Press conferences, highlights and RealCavsFans articles', '', 'media'],
  ['og/resources.jpg', 'Resources', 'cavs_db approved sites for NBA and Cavs knowledge', '', 'resources'],
  ['og/roster-tree.jpg', 'How the Roster Was Built', 'Every player by how he arrived, and the trade trees back to 2017', '', 'roster-tree'],
  ['og/roster.jpg', 'Roster & Depth Chart', 'Bios, measurements, the depth chart and player comps', '', 'roster'],
  ['og/staff.jpg', 'Coaches & Front Office', 'Bios, records and career paths', '', 'staff'],
];
const esc = t => t.replace(/&/g, '&amp;');
const page = ([, title, sub, sub2, path]) => `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:Archivo;src:url(../fonts/archivo-latin-wdth-normal.woff2);font-weight:100 900;font-stretch:62% 125%}
@font-face{font-family:'Geist Mono';src:url(../fonts/geist-mono-latin-wght-normal.woff2);font-weight:100 900}
*{margin:0;box-sizing:border-box}body{width:1200px;height:630px;background:radial-gradient(900px 520px at 50% 45%,#9b0a45,#860038 55%,#6a002c);color:#fff;font-family:Archivo,sans-serif;position:relative;overflow:hidden;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 140px}
body:after{content:'';position:absolute;left:0;right:0;bottom:0;height:10px;background:#F2B231}
.wm{display:flex;align-items:center;gap:${title ? 14 : 22}px;font:700 ${title ? 40 : 84}px 'Geist Mono',monospace;letter-spacing:-.02em;margin-bottom:${title ? 22 : 36}px}.wm svg{width:${title ? 56 : 110}px;height:${title ? 56 : 110}px}.wm em{font-style:normal;color:#F2B231}.wm i{display:inline-block;width:.42em;height:.86em;background:#F2B231;margin-left:4px;transform:translateY(-.06em)}
h1{font:800 76px/1.05 Archivo,sans-serif;font-stretch:125%;letter-spacing:-.01em}p{font:500 27px/1.4 Archivo,sans-serif;color:#FBE3B0;margin-top:20px;max-width:760px}
.big{font:800 52px/1.2 Archivo,sans-serif;font-stretch:125%}.big b{display:block;color:#F2B231}
.u{position:absolute;bottom:36px;font:600 18px 'Geist Mono',monospace;letter-spacing:.04em;color:rgba(255,255,255,.85)}
</style></head><body>
<div class="wm">${mark}<span>cavs<em>_db</em><i></i></span></div>
${title ? `<h1>${esc(title)}</h1><p>${esc(sub)}</p>` : `<div class="big">${esc(sub)}<b>${esc(sub2)}</b></div>`}
<div class="u">cavsdatabase.com${title ? '/' + path : ''}</div></body></html>`;
const opts = { headless: true }; if (process.env.CHROME_PATH) opts.executablePath = process.env.CHROME_PATH;
const browser = await pw.chromium.launch(opts); const p = await browser.newPage({ viewport: { width: 1200, height: 630 } });
const tmp = new URL('og/_page.html', root);
for (const d of PAGES) { await writeFile(tmp, page(d)); await p.goto(tmp.href); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(80);
  await p.screenshot({ path: new URL(d[0], root).pathname, type: 'jpeg', quality: 88 }); }
await unlink(tmp).catch(() => {}); await browser.close(); console.log('og-pages: drew', PAGES.length);
