// Layout check (Nov 22, Luka): before a build goes out, open the main pages on a phone (390 wide) and a desktop (1366 wide)
// and look for the problems we've had to fix by hand: the page scrolling sideways, something sticking out past the screen
// edge, text spilling out of its box, and a page suddenly much shorter or taller than the last build (a section that
// vanished or blew up). Saves a screenshot of each page (for the job's artifact) and data/visual-check.json with page heights,
// so the next run compares against this one. Exits 0 always; prints ::warning:: lines and writes data/visual-alert.txt when
// something is off, so the build still goes out and Luka gets one push.
//   node scripts/visual-check.mjs [--source] [--shots <dir>]
import { launch } from './launch.mjs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { extname } from 'node:path';
const require = createRequire(import.meta.url);
const pw = (() => { for (const m of ['playwright', 'playwright-core']) { try { return require(m); } catch {} } return null; })();
if (!pw) { console.log('visual-check: playwright not available, skipped'); process.exit(0); }
const root = new URL('../', import.meta.url);
const SRC = process.argv.includes('--source'), si = process.argv.indexOf('--shots'), SHOTS = si > 0 ? process.argv[si + 1] : null;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/home';
  const tries = extname(p) ? [p] : SRC ? ['/index.html'] : [p + '.html', p + '/index.html'];
  for (const t of tries) { try { const b = await readFile(new URL('.' + t, root)); res.writeHead(200, { 'content-type': TYPES[extname(t)] || 'application/octet-stream' }); return res.end(b); } catch {} }
  res.writeHead(404); res.end();
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
const opts = { headless: true }; if (process.env.CHROME_PATH) opts.executablePath = process.env.CHROME_PATH;
const browser = await launch(pw, opts);
const ROUTES = ['/', '/schedule', '/roster', '/staff', '/cap', '/assets', '/moves', '/charge', '/history', '/media', '/resources', '/about', '/draft-picks', '/trade-exceptions', '/injury-report', '/players/donovan-mitchell', '/players/donovan-mitchell/2025-26', '/games/2026-10-22-phi'];
const SIZES = [['phone', { width: 390, height: 844 }], ['desktop', { width: 1366, height: 900 }]];
let last = {}; try { last = JSON.parse(await readFile(new URL('data/visual-check.json', root), 'utf8')).h || {}; } catch {}
const H = {}, warn = [];
if (SHOTS) await mkdir(SHOTS, { recursive: true });
for (const [dev, vp] of SIZES) {
  const ctx = await browser.newContext({ viewport: vp, reducedMotion: 'reduce' });
  await ctx.addInitScript(() => { try { localStorage.setItem('cdb-intro', '1'); sessionStorage.setItem('cdb-nl-seen', '1'); } catch {} });
  await ctx.route(u => !u.href.startsWith(base), r => r.request().resourceType() === 'image' ? r.fulfill({ status: 200, contentType: 'image/gif', body: Buffer.from('R0lGODlhAQABAAAAACw=', 'base64') }) : r.abort());
  for (const r of ROUTES) {
    const page = await ctx.newPage();
    try {
      await page.goto(base + r, { waitUntil: 'load', timeout: 30000 }); await page.waitForTimeout(2500);
      const m = await page.evaluate(() => {
        const W = document.documentElement.clientWidth, out = [], seen = new Set();
        const main = [...document.querySelectorAll('main')].find(x => !x.hidden) || document.body;
        const scrolls = e => { for (let a = e; a && a !== document.body; a = a.parentElement) { const s = getComputedStyle(a); if (/(auto|scroll|hidden)/.test(s.overflowX) || /(auto|scroll)/.test(s.overflow)) return true; } return false; };
        for (const e of main.querySelectorAll('*')) {
          const b = e.getBoundingClientRect(); if (!b.width || !b.height) continue;
          const s = getComputedStyle(e); if (s.position === 'fixed' || s.visibility === 'hidden' || e.closest('.sr,[aria-hidden="true"]') || s.clipPath === 'inset(50%)' || s.clip === 'rect(0px, 0px, 0px, 0px)') continue;
          if ((b.right > W + 2 || b.left < -2) && !scrolls(e.parentElement)) { const k = e.tagName + '.' + String(e.className).split(' ')[0]; if (!seen.has(k)) { seen.add(k); out.push('sticks out past the screen: ' + k); } }
          if (e.children.length === 0 && e.textContent.trim() && e.scrollWidth > e.clientWidth + 4 && s.overflow === 'visible' && s.whiteSpace === 'nowrap' && !scrolls(e)) { const k = 'spill ' + e.tagName + '.' + String(e.className).split(' ')[0]; if (!seen.has(k)) { seen.add(k); out.push('text spills out of its box: ' + e.textContent.trim().slice(0, 30)); } }
        }
        return { sw: document.documentElement.scrollWidth, W, h: Math.round(main.getBoundingClientRect().height), out: out.slice(0, 4) };
      });
      const key = dev + ' ' + r; H[key] = m.h;
      if (m.sw > m.W + 2) warn.push(`${key}: the page scrolls sideways (${m.sw}px wide on a ${m.W}px screen)`);
      m.out.forEach(x => warn.push(`${key}: ${x}`));
      if (last[key] && m.h && last[key] >= 400 && (m.h < last[key] * 0.65 || m.h > last[key] * 1.6)) warn.push(`${key}: page height went from ${last[key]}px to ${m.h}px since the last build`);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/${dev}-${r.replace(/\//g, '_') || '_'}.png`, fullPage: true });
    } catch (e) { warn.push(`${dev} ${r}: ${e.message.split('\n')[0]}`); }
    await page.close();
  }
  await ctx.close();
}
await browser.close(); server.close();
/* heights rounded to 100px and only rewritten when they change, so the file doesn't change on every build; the alert is pushed
   only when it differs from the last one pushed (no repeat pushes every 30 minutes for the same problem) */
let prev = {}; try { prev = JSON.parse(await readFile(new URL('data/visual-check.json', root), 'utf8')); } catch {}
for (const k of Object.keys(H)) H[k] = Math.round(H[k] / 100) * 100;
const sig = warn.map(w => w.replace(/\d+px/g, '')).sort().join('|');
const next = { h: H, alert: sig || '' };
if (JSON.stringify({ h: prev.h, alert: prev.alert || '' }) !== JSON.stringify(next)) await writeFile(new URL('data/visual-check.json', root), JSON.stringify(next) + '\n');
if (warn.length) { warn.forEach(w => console.log('::warning::' + w)); if (sig !== (prev.alert || '')) await writeFile(new URL('data/visual-alert.txt', root), warn.slice(0, 15).join('\n') + '\n'); }
else console.log(`visual-check: ${ROUTES.length} pages on phone and desktop, nothing off`);
