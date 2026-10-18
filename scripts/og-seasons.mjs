// Share images for season pages: og/h/<YYYY-YY>.jpg (1200x630), used as the link preview for /history/<YYYY-YY>.
// Also draws og/history.jpg for the History page. Past seasons never change, so each card is drawn once. Usage: node scripts/og-seasons.mjs [outDir] [season,season]
import { readFile, stat, mkdir, writeFile, unlink } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const H = JSON.parse(await readFile(new URL('pdata/history.json', root), 'utf8'));
const out = process.argv[2] ? new URL(process.argv[2].replace(/\/?$/, '/'), 'file://' + process.cwd() + '/') : new URL('og/h/', root);
const only = process.argv[3] ? process.argv[3].split(',') : null;
const slug = s => { const [a, b] = s.split('–'); return a + '-' + b.slice(-2); };
const exists = async u => { try { await stat(u); return true; } catch { return false; } };
const L = { missed: 0, playin: 1, round1: 2, round2: 3, conf: 4, finals: 5, title: 6 };
const TAG = { missed: 'Missed playoffs', playin: 'Play-in', round1: 'First round', round2: 'Second round', conf: 'Conference finals', finals: 'NBA Finals', title: 'NBA champions' };
const seasons = H.seasons;
const need = [];
for (const [i, x] of seasons.entries()) { if (only && !only.includes(slug(x.s))) continue; if (only || !(await exists(new URL(slug(x.s) + '.jpg', out)))) need.push([i, x]); }
if (!need.length && !(!only && !process.argv[2] && !(await exists(new URL('og/history.jpg', root))))) { console.log('og-seasons: nothing new'); process.exit(0); }
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const pw = (() => { for (const m of ['playwright-core', 'playwright']) { try { return require(m); } catch {} } return null; })();
if (!pw) { console.log('og-seasons: playwright missing, skipped'); process.exit(0); }
const opts = { headless: true }; if (process.env.CHROME_PATH) opts.executablePath = process.env.CHROME_PATH;
const browser = await pw.chromium.launch(opts); const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await mkdir(out, { recursive: true });
const esc = t => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const card = (i, x) => {
  const lv = L[x.poLevel] ?? 0, gold = lv === 6, pct = (x.w / (x.w + x.l)).toFixed(3).replace(/^0/, '');
  const strip = seasons.map((y, j) => { const v = L[y.poLevel] ?? 0, h = 14 + v * 9;
    return `<i style="height:${h}px;background:${v === 6 ? '#F2B231' : 'rgba(255,255,255,' + (0.16 + v * 0.12) + ')'};${j === i ? 'outline:3px solid #F2B231;outline-offset:3px;' : ''}"></i>`; }).join('');
  const ld = x.lead || {}, lead = [['pts', 'PPG'], ['reb', 'RPG'], ['ast', 'APG']].filter(([k]) => ld[k]).map(([k, u]) => `<div><small>${u}</small>${esc(ld[k][0])} <b>${ld[k][1].toFixed(1)}</b></div>`).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:Archivo;src:url(../fonts/archivo-latin-wdth-normal.woff2);font-weight:100 900;font-stretch:62% 125%}
@font-face{font-family:'Geist Mono';src:url(../fonts/geist-mono-latin-wght-normal.woff2);font-weight:100 900}
@font-face{font-family:'Saira Condensed';src:url(../fonts/saira-condensed-latin-800-normal.woff2);font-weight:800}
@font-face{font-family:'Saira Condensed';src:url(../fonts/saira-condensed-latin-700-normal.woff2);font-weight:700}
*{margin:0;box-sizing:border-box}body{width:1200px;height:630px;background:radial-gradient(1200px 700px at 15% 0%,#9b0a45,#5c0027 70%);color:#fff;font-family:Archivo,Arial,sans-serif;position:relative;overflow:hidden}
.k{position:absolute;left:72px;top:60px;font:700 24px 'Geist Mono',monospace;letter-spacing:4px;color:#F2B231;display:flex;align-items:center;gap:18px}
.k b{background:${gold ? '#F2B231' : 'rgba(255,255,255,.16)'};color:${gold ? '#5c0027' : '#fff'};padding:5px 14px 4px;letter-spacing:2px}
.s{position:absolute;left:66px;top:108px;font:800 150px/1 'Saira Condensed',sans-serif;letter-spacing:1px}
.r{position:absolute;left:72px;top:262px;font:800 64px/1 'Geist Mono',monospace}.r em{font-style:normal;color:#F2B231;font-size:30px;margin-left:16px;letter-spacing:2px}
.p{position:absolute;left:72px;top:344px;width:640px;font:600 27px/1.3 Archivo,sans-serif;opacity:.92}
.ld{position:absolute;right:72px;top:118px;width:380px;display:grid;gap:18px}.ld div{font:600 26px Archivo,sans-serif;border-left:4px solid #F2B231;padding-left:16px}.ld small{display:block;font:700 16px 'Geist Mono',monospace;color:#F2B231;letter-spacing:3px;margin-bottom:2px}.ld b{font-family:'Geist Mono',monospace}
.st{position:absolute;left:72px;right:72px;bottom:96px;height:70px;display:flex;align-items:flex-end;gap:5px}.st i{flex:1}
.f{position:absolute;left:72px;right:72px;bottom:40px;display:flex;justify-content:space-between;font:700 18px 'Geist Mono',monospace;letter-spacing:3px;color:rgba(255,255,255,.6)}.f .m{font:800 30px 'Geist Mono',monospace;color:#fff;letter-spacing:0}.f .m em{color:#F2B231;font-style:normal}
</style></head><body>
<div class="k"><b>${esc(TAG[x.poLevel] || '').toUpperCase()}</b>SEASON ${i + 1} OF ${seasons.length}</div>
<div class="s">${esc(x.s)}</div>
<div class="r">${x.w}–${x.l}<em>${pct} · ${esc((x.div || '').toUpperCase())}</em></div>
<div class="p">${esc(x.poLevel === 'missed' && x.note ? x.note.split(/(?<=\.)\s/)[0].slice(0, 120) : x.po)}</div>
<div class="ld">${lead}</div>
<div class="st">${strip}</div>
<div class="f"><span>1970–71 &nbsp;·&nbsp; EVERY CAVS SEASON &nbsp;·&nbsp; ${esc(seasons.at(-1).s)}</span><span class="m">&gt; cavs<em>_db</em></span></div>
</body></html>`; };
const tmp = new URL('og/_season.html', root);
const hist = new URL('og/history.jpg', root), drawHist = !only && !process.argv[2] && !(await exists(hist));
const overview = () => { const W = seasons.reduce((a, x) => a + x.w, 0), Lo = seasons.reduce((a, x) => a + x.l, 0), po = seasons.filter(x => x.poLevel !== 'missed' && x.poLevel !== 'playin').length;
  return card(seasons.length - 1, seasons.at(-1)).replace(/<div class="k">[\s\S]*<div class="st">/, `<div class="k"><b>THE CAVS</b>EVERY SEASON SINCE 1970</div><div class="s" style="font-size:120px;top:118px">${seasons.length} seasons</div><div class="r">${W}–${Lo}<em>ALL-TIME</em></div><div class="p">${po} playoff trips · ${seasons.filter(x => ['finals', 'title'].includes(x.poLevel)).length} NBA Finals · 2016 champions</div><div class="st">`).replace('outline:3px solid #F2B231;outline-offset:3px;', ''); };
for (const [i, x] of need) { await writeFile(tmp, card(i, x)); await page.goto(tmp.href); await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(100);
  await page.screenshot({ path: new URL(slug(x.s) + '.jpg', out).pathname, type: 'jpeg', quality: 86 }); }
if (drawHist) { await writeFile(tmp, overview()); await page.goto(tmp.href); await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(100); await page.screenshot({ path: hist.pathname, type: 'jpeg', quality: 86 }); }
await unlink(tmp).catch(() => {});
await browser.close(); console.log('og-seasons: drew', need.length + (drawHist ? ' + history' : ''));
