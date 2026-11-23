// Layout check (Nov 22, Luka): before a build goes out, open the main pages on a phone (390 wide) and a desktop (1366 wide)
// and look for the problems we've had to fix by hand: the page scrolling sideways, something sticking out past the screen
// edge, text spilling out of its box, and a page suddenly much shorter or taller than the last build (a section that
// vanished or blew up). Nov 22 (Luka): also pink (wine faded toward pink, by color or by see-through), the same button
// repeated in one row (the Awards-tab bug), tab and button labels cut off with "…", and all of it again with every drop-down open. Saves a screenshot of each page (for the job's artifact) and data/visual-check.json with page heights,
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
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/home'; if (/^\/stats(\/|$)/.test(p)) p = '/live';  // the Worker serves live.html for /stats/<season>
  const tries = extname(p) ? [p] : p === '/live' ? ['/live.html'] : SRC ? ['/index.html'] : [p + '.html', p + '/index.html'];
  for (const t of tries) { try { const b = await readFile(new URL('.' + t, root)); res.writeHead(200, { 'content-type': TYPES[extname(t)] || 'application/octet-stream' }); return res.end(b); } catch {} }
  res.writeHead(404); res.end();
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
const opts = { headless: true }; if (process.env.CHROME_PATH) opts.executablePath = process.env.CHROME_PATH;
const browser = await launch(pw, opts);
const ROUTES = ['/', '/schedule', '/roster', '/staff', '/cap', '/assets', '/moves', '/charge', '/history', '/media', '/resources', '/about', '/draft-picks', '/trade-exceptions', '/players/donovan-mitchell', '/players/donovan-mitchell/2025-26', '/games/2026-10-22-phi', '/stats/2026-27', '/game-finder'];
const SIZES = [['phone', { width: 390, height: 844 }], ['desktop', { width: 1366, height: 900 }], ['phone-dark', { width: 390, height: 844 }]];
const DARK_ROUTES = ['/', '/schedule', '/cap', '/players/donovan-mitchell', '/stats/2026-27'];  // Nov 22: dark mode on a phone, the main pages only
let last = {}; try { last = JSON.parse(await readFile(new URL('data/visual-check.json', root), 'utf8')).h || {}; } catch {}
const H = {}, warn = [];
if (SHOTS) await mkdir(SHOTS, { recursive: true });
for (const [dev, vp] of SIZES) {
  const ctx = await browser.newContext({ viewport: vp, reducedMotion: 'reduce', colorScheme: dev.endsWith('dark') ? 'dark' : 'light' });
  await ctx.addInitScript(() => { try { localStorage.setItem('cdb-intro', '1'); sessionStorage.setItem('cdb-nl-seen', '1'); } catch {} });
  await ctx.route(u => !u.href.startsWith(base), r => r.request().resourceType() === 'image' ? r.fulfill({ status: 200, contentType: 'image/gif', body: Buffer.from('R0lGODlhAQABAAAAACw=', 'base64') }) : r.abort());
  for (const r of dev.endsWith('dark') ? DARK_ROUTES : ROUTES) {
    const page = await ctx.newPage();
    try {
      await page.goto(base + r, { waitUntil: 'load', timeout: 30000 }); await page.waitForTimeout(2500);
      const scan = () => page.evaluate(() => {
        const W = document.documentElement.clientWidth, out = [], seen = new Set();
        const main = [...document.querySelectorAll('main')].find(x => !x.hidden) || document.body;
        const scrolls = e => { for (let a = e; a && a !== document.body; a = a.parentElement) { const s = getComputedStyle(a); if (/(auto|scroll|hidden)/.test(s.overflowX) || /(auto|scroll)/.test(s.overflow)) return true; } return false; };
        const once = (k, msg) => { if (!seen.has(k)) { seen.add(k); out.push(msg); } };
        /* pink: a color in wine's hue family that comes out light, either as drawn or after see-through (opacity) over the page */
        const rgb = c => { const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/.exec(c || ''); return m ? [+m[1], +m[2], +m[3], m[4] == null ? 1 : +m[4]] : null; };
        const bgPage = rgb(getComputedStyle(document.body).backgroundColor) || [255, 255, 255, 1];
        const op = e => { let o = 1; for (let a = e; a && a.nodeType === 1; a = a.parentElement) o *= +getComputedStyle(a).opacity; return o; };
        const pinkish = (c, o) => { if (!c || c[3] === 0) return false; const a = c[3] * o; const [r, g, b] = [0, 1, 2].map(i => c[i] * a + bgPage[i] * (1 - a));
          const mx = Math.max(r, g, b) / 255, mn = Math.min(r, g, b) / 255, l = (mx + mn) / 2, d = mx - mn; if (d < .12) return false; const s = d / (1 - Math.abs(2 * l - 1));
          let h = mx === r / 255 ? ((g - b) / 255 / d) % 6 : mx === g / 255 ? (b - r) / 255 / d + 2 : (r - g) / 255 / d + 4; h = (h * 60 + 360) % 360;
          return h >= 315 && h <= 352 && s > .25 && l > .45 && l < .93; };  /* wine's hue family only: true reds (minus numbers, hue near 0) are allowed; light or washed-out wine is not */
        const gray = e => { for (let a = e; a && a.nodeType === 1; a = a.parentElement) if (/grayscale\(1\)/.test(getComputedStyle(a).filter)) return true; return false; };
        const label = e => { const t = (e.getAttribute && (e.getAttribute('aria-label') || '')) || (e.textContent || '').trim(); return t.slice(0, 30) || e.tagName.toLowerCase() + '.' + String(e.className.baseVal ?? e.className).split(' ')[0]; };
        for (const e of main.querySelectorAll('*')) {
          const b = e.getBoundingClientRect(); if (!b.width || !b.height) continue;
          const s = getComputedStyle(e); if (s.position === 'fixed' || s.visibility === 'hidden' || e.closest('.sr,[aria-hidden="true"]') || s.clipPath === 'inset(50%)' || s.clip === 'rect(0px, 0px, 0px, 0px)') continue;
          if ((b.right > W + 2 || b.left < -2) && !scrolls(e.parentElement)) once('out ' + e.tagName + '.' + String(e.className).split(' ')[0], 'sticks out past the screen: ' + e.tagName + '.' + String(e.className).split(' ')[0]);
          if (e.children.length === 0 && e.textContent.trim() && e.scrollWidth > e.clientWidth + 4 && s.overflow === 'visible' && s.whiteSpace === 'nowrap' && !scrolls(e)) once('spill ' + e.tagName + '.' + String(e.className).split(' ')[0], 'text spills out of its box: ' + e.textContent.trim().slice(0, 30));
          if (s.textOverflow === 'ellipsis' && e.scrollWidth > e.clientWidth + 1 && e.closest('button,nav,[role=tab],.ppx-tabs,.pgx-tabs')) once('cut ' + e.textContent.trim(), 'label cut off with “…”: ' + e.textContent.trim().slice(0, 30));
          if (!e.closest('img,picture,video,canvas,.secx,.ab-dc') && !gray(e)) { const o = op(e), isSvg = e instanceof SVGElement;
            const cs = isSvg ? [s.fill, s.stroke] : [s.backgroundColor, s.borderTopColor !== s.color && parseFloat(s.borderTopWidth) > 0 ? s.borderTopColor : null, e.children.length === 0 && e.textContent.trim() ? s.color : null];
            if (cs.some(c => pinkish(rgb(c), o))) once('tint ' + label(e), 'faded wine (reads pink): ' + label(e)); }
          /* the same button three or more times in one row */
          if (e.children.length >= 3) { const n = {}; for (const c of e.children) if (c.matches('button,a,[role=tab]')) { const t = (c.textContent || '').trim(); if (t) n[t] = (n[t] || 0) + 1; } for (const [t, k] of Object.entries(n)) if (k >= 3 && !/^\d+$/.test(t)) once('dup ' + t, `the same button ${k} times in one row: “${t.slice(0, 30)}”`); }
        }
        return { sw: document.documentElement.scrollWidth, W, h: Math.round(main.getBoundingClientRect().height), out: out.slice(0, 6) };
      });
      /* Nov 22: a page that keeps rebuilding itself with nobody touching it (two bits of code fighting over a card) */
      const churn = await page.evaluate(() => new Promise(res => { let k = 0; const mo = new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => { if (n.nodeType === 1) k++; }))); mo.observe(document.body, { childList: true, subtree: true }); setTimeout(() => { mo.disconnect(); res(k); }, 3000); })).catch(() => 0);
      const m = await scan();
      if (churn > 150) m.out.unshift(`keeps changing itself (${churn} pieces added in 3 seconds with nobody touching it)`);
      /* then every drop-down open (their insides are built when opened), and look again */
      const nOpen = await page.evaluate(() => { const ds = [...document.querySelectorAll('main:not([hidden]) details:not([open])')].slice(0, 60); ds.forEach(d => { d.open = true; }); return ds.length; }).catch(() => 0);
      if (nOpen) { await page.waitForTimeout(1200); const m2 = await scan(); m2.out.forEach(x => { if (!m.out.includes(x)) m.out.push(x + ' (with drop-downs open)'); }); if (m2.sw > m.sw) m.sw = m2.sw; }
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
