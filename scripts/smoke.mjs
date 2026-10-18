// Safety check: opens the main pages in headless Chrome from the files on disk and fails (exit 1) if any page throws a
// script error or comes up empty. Run before publishing: the 30-minute Action runs it after the build and skips the commit
// if it fails, so a broken edit never goes live. Needs playwright or playwright-core + Chrome (CHROME_PATH); skips if missing.
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { extname } from 'node:path';
const require = createRequire(import.meta.url);
const pw = (() => { for (const m of ['playwright', 'playwright-core']) { try { return require(m); } catch {} } return null; })();
if (!pw) { console.log('smoke: playwright not available, skipped'); process.exit(0); }
const root = new URL('../', import.meta.url);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
const server = createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/home';
  const tries = extname(p) ? [p] : [p + '.html', p + '/index.html'];
  for (const t of tries) { try { const b = await readFile(new URL('.' + t, root)); res.writeHead(200, { 'content-type': TYPES[extname(t)] || 'application/octet-stream' }); return res.end(b); } catch {} }
  res.writeHead(404); res.end();
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = 'http://127.0.0.1:' + server.address().port;
const opts = { headless: true }; if (process.env.CHROME_PATH) opts.executablePath = process.env.CHROME_PATH;
const browser = await pw.chromium.launch(opts);
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
await ctx.addInitScript(() => { try { localStorage.setItem('cdb-intro', '1'); sessionStorage.setItem('cdb-nl-seen', '1'); } catch {} });
await ctx.route(u => !u.href.startsWith(base), r => r.abort());
const ROUTES = ['/', '/schedule', '/roster', '/staff', '/cap', '/assets', '/moves', '/charge', '/history', '/history/2015-16', '/media', '/resources', '/players/donovan-mitchell', '/games/2026-10-22-phi'];
const bad = [];
for (const r of ROUTES) {
  const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  try {
    const res = await page.goto(base + r, { waitUntil: 'load', timeout: 30000 });
    if (!res || !res.ok()) bad.push(`${r}: HTTP ${res && res.status()}`);
    await page.waitForTimeout(1500);
    const len = await page.evaluate(() => { const m = document.querySelector('main:not([hidden])'); return m ? m.innerText.trim().length : 0; });
    if (len < 200) bad.push(`${r}: page came up empty (${len} characters)`);
  } catch (e) { bad.push(`${r}: ${e.message.split('\n')[0]}`); }
  errs.forEach(e => bad.push(`${r}: script error: ${e}`));
  await page.close();
}
await browser.close(); server.close();
if (bad.length) { console.log('::error::Safety check failed, not publishing:\n' + bad.join('\n')); process.exit(1); }
console.log('smoke: ' + ROUTES.length + ' pages OK');
