// Share images for finished games: og/g/<date>-<opp>.jpg (1200x630), used as the link preview for /games/<date>-<opp>.
// Reads the schedule, scores and results baked into index.html. Only draws games that don't have an image yet.
// Needs playwright-core and Chrome (CHROME_PATH), same as the prerender step. Safe to skip: pages fall back to the schedule image.
import { readFile, stat, mkdir } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const html = await readFile(new URL('index.html', root), 'utf8');
const grab = re => { const m = html.match(re); return m ? Function('return ' + m[1])() : null; };
const S = grab(/const SCHEDULE=(\[[\s\S]*?\]);\n/) || [], SC = grab(/const SCORES=(\{[^;]*\});/) || {};
const R = (html.match(/const SEASON=\{results:'([WL]*)'/) || [])[1] || '';
const NK = {ATL:'Hawks',BOS:'Celtics',BKN:'Nets',CHA:'Hornets',CHI:'Bulls',DAL:'Mavericks',DEN:'Nuggets',DET:'Pistons',GSW:'Warriors',HOU:'Rockets',IND:'Pacers',LAC:'Clippers',LAL:'Lakers',MEM:'Grizzlies',MIA:'Heat',MIL:'Bucks',MIN:'Timberwolves',NOP:'Pelicans',NYK:'Knicks',OKC:'Thunder',ORL:'Magic',PHI:'76ers',PHX:'Suns',POR:'Trail Blazers',SAC:'Kings',SAS:'Spurs',TOR:'Raptors',UTA:'Jazz',WAS:'Wizards'};
const exists = async u => { try { await stat(u); return true; } catch { return false; } };
const todo = [];
let w = 0, l = 0;
S.forEach((g, i) => { const [d, o, ha] = g, sc = SC[d], r = R[i]; if (!r || !sc) return; r === 'W' ? w++ : l++; todo.push({ d, o, ha, sc, r, rec: w + '–' + l }); });
const need = [];
for (const t of todo) if (!(await exists(new URL(`og/g/${t.d}-${t.o.toLowerCase()}.jpg`, root)))) need.push(t);
if (!need.length) { console.log('og-games: nothing new'); process.exit(0); }
let pw; try { pw = await import('playwright-core'); } catch { console.log('og-games: playwright-core missing, skipped'); process.exit(0); }
const opts = { headless: true }; if (process.env.CHROME_PATH) opts.executablePath = process.env.CHROME_PATH;
const browser = await pw.chromium.launch(opts); const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await mkdir(new URL('og/g/', root), { recursive: true });
const card = t => { const [c, o] = t.sc.split('-'), dl = new Date(t.d + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  return `<!doctype html><html><head><link href="https://fonts.googleapis.com/css2?family=Saira+Condensed:wght@700;800&family=Geist+Mono:wght@600;700&family=Archivo:wght@600;800&display=swap" rel="stylesheet">
<style>*{margin:0;box-sizing:border-box}body{width:1200px;height:630px;background:radial-gradient(1200px 700px at 15% 0%,#9b0a45,#5c0027 70%);color:#fff;font-family:Archivo,Arial,sans-serif;position:relative;overflow:hidden}
.k{position:absolute;left:72px;top:64px;font:700 26px 'Geist Mono',monospace;letter-spacing:4px;color:#F2B231}.k b{background:${t.r === 'W' ? '#F2B231' : 'rgba(255,255,255,.18)'};color:${t.r === 'W' ? '#5c0027' : '#fff'};padding:4px 14px;margin-right:16px;letter-spacing:2px}
.row{position:absolute;left:72px;right:72px;top:150px;display:grid;grid-template-columns:1fr 1fr;gap:40px}.t{font:800 52px 'Saira Condensed',sans-serif;text-transform:uppercase;letter-spacing:1px;opacity:.85}.s{font:800 220px/0.9 'Saira Condensed',sans-serif}.lose{opacity:.55}
.f{position:absolute;left:72px;right:72px;bottom:56px;display:flex;justify-content:space-between;align-items:flex-end;font:600 28px Archivo,sans-serif}.f small{display:block;font:700 22px 'Geist Mono',monospace;color:#F2B231;letter-spacing:2px;margin-bottom:6px}.m{font:800 34px 'Geist Mono',monospace}.m em{color:#F2B231;font-style:normal}</style></head><body>
<div class="k"><b>${t.r === 'W' ? 'WIN' : 'LOSS'}</b>FINAL · ${t.ha === 'H' ? 'ROCKET ARENA' : 'AT ' + NK[t.o].toUpperCase()}</div>
<div class="row"><div class="${t.r === 'W' ? '' : 'lose'}"><div class="t">Cavaliers</div><div class="s">${c}</div></div><div class="${t.r === 'W' ? 'lose' : ''}"><div class="t">${NK[t.o]}</div><div class="s">${o}</div></div></div>
<div class="f"><div><small>RECORD</small>${t.rec} · ${dl}</div><div class="m">&gt; cavs<em>_db</em></div></div></body></html>`; };
for (const t of need) { await page.setContent(card(t), { waitUntil: 'networkidle' }).catch(() => {}); await page.waitForTimeout(150);
  await page.screenshot({ path: new URL(`og/g/${t.d}-${t.o.toLowerCase()}.jpg`, root).pathname, type: 'jpeg', quality: 86 }); }
await browser.close(); console.log('og-games: drew', need.length);
