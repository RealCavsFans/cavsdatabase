// cavsdatabase.com Worker: the site is static files; only /pbp (the live page's backup play-by-play) and
// /live.html?g=… (each game's own link preview tags) run code.
import { onRequestGet } from './pbp.js';
import { liveMeta, seasonPage } from './live-meta.js';
import { nbaGame } from './nba.js';
import { runTimer } from './timer.js';
export default {
  /* Nov 14 (Luka): every 5 minutes, start the GitHub jobs that are due (worker/timer.js) */
  async scheduled(event, env, ctx) { ctx.waitUntil(runTimer(event, env)); },
  async fetch(request, env, ctx) {
    const u = new URL(request.url);
    /* Nov 3: short sign-up links for Cavs & Coffee */
    /* Nov 22 (Luka): cavsdatabase.com/records -> the franchise records on the History page */
    /* Nov 22 (Luka): the injury report page was dropped; the injury report lives on the home page */
    if (/^\/injury-report\/?$/i.test(u.pathname)) return Response.redirect(u.origin + '/', 301);
    if (/^\/records\/?$/i.test(u.pathname)) return Response.redirect(u.origin + '/history#hx-rec', 301);
    if (u.pathname === '/coffee' || u.pathname === '/newsletter') return Response.redirect('https://buttondown.com/cavscoffee', 302);
    /* Nov 9 (Luka): cavsdatabase.com/stats -> this season's stats. Nov 22: each season has its own address that search
       engines can index, /stats/2026-27 (the live page, told its season by the path; see seasonPage in live-meta.js) */
    if (/^\/stats\/?$/i.test(u.pathname)) { const d = new Date(), y = d.getUTCMonth() >= 7 ? d.getUTCFullYear() : d.getUTCFullYear() - 1; return Response.redirect(u.origin + '/stats/' + y + '-' + String(y + 1).slice(2) + u.search, 302); }
    if (/^\/stats\/\d{4}-\d\d\/?$/.test(u.pathname) && request.method === 'GET') {
      try { return await seasonPage(request, env); } catch (e) { return env.ASSETS.fetch(new Request(u.origin + '/live.html', request)); }
    }
    /* Nov 22: a season link on the live page (/live?g=s2026-27) points search engines and previews at /stats/2026-27 */
    /* Nov 22 (Luka): pages report their own script errors here; one phone alert per error per day (client-error.yml) */
    if (u.pathname === '/err' && request.method === 'POST') { ctx.waitUntil(pageError(request, env).catch(() => {})); return new Response(null, { status: 204 }); }
    if (u.pathname === '/pbp' && request.method === 'GET') {
      try { return await onRequestGet({ request, env, waitUntil: p => ctx.waitUntil(p) }) }
      catch (e) { return new Response(JSON.stringify({ error: 'backup feed error' }), { status: 502, headers: { 'content-type': 'application/json' } }) }
    }
    /* Nov 2: the NBA's own live feed (box score + play-by-play), proxied because the NBA's bucket sends no CORS headers */
    if (u.pathname === '/nba' && request.method === 'GET') {
      try { return await nbaGame({ request, env, waitUntil: p => ctx.waitUntil(p) }) }
      catch (e) { return new Response(JSON.stringify({ error: 'nba feed error' }), { status: 502, headers: { 'content-type': 'application/json' } }) }
    }
    /* single-game links on the live page get that game's own link preview */
    if ((u.pathname === '/live.html' || u.pathname === '/live') && request.method === 'GET') {
      try { return await liveMeta(request, env); } catch (e) { return env.ASSETS.fetch(request); }
    }
    /* Nov 22 (Luka): a player page for someone no longer on the roster (no longer in the sitemap) sends people to the roster; 302 so a player who comes back gets his page again right away */
    if (request.method === 'GET' && /^\/players\/[a-z0-9-]+\/?$/.test(u.pathname)) {
      try { const s = u.pathname.split('/')[2]; if (!(await sitemapSlugs(env, u)).has(s)) return Response.redirect(u.origin + '/roster', 302); } catch (e) {}
      return env.ASSETS.fetch(request);
    }
    /* Nov 3: vanity links for share images: cavsdatabase.com/tyson, /jaylontyson or /jtyson -> that player's page (players from the sitemap) */
    if (request.method === 'GET' && /^\/[a-z][a-z.'-]{2,40}\/?$/i.test(u.pathname)) {
      const res = await env.ASSETS.fetch(request);
      if (res.status !== 404) return res;
      try { const slug = (await vanity(env, u)).get(u.pathname.replace(/\//g, '').toLowerCase().replace(/[^a-z]/g, '')); if (slug) return Response.redirect(u.origin + '/players/' + slug, 301); } catch (e) {}
      return res;
    }
    return env.ASSETS.fetch(request);
  }
};
let VAN = null, VAN_T = 0, SLUGS = null;
async function sitemapSlugs(env, u) {
  if (SLUGS && Date.now() - VAN_T < 36e5) return SLUGS;
  await vanity(env, u); return SLUGS;
}
async function vanity(env, u) {
  if (VAN && Date.now() - VAN_T < 36e5) return VAN;
  const xml = await (await env.ASSETS.fetch(new Request(u.origin + '/sitemap.xml'))).text();
  const slugs = [...new Set([...xml.matchAll(/\/players\/([a-z0-9-]+)<\/loc>/g)].map(m => m[1]))];
  if (slugs.length < 8) throw new Error('sitemap unreadable');
  SLUGS = new Set(slugs);
  const m = new Map(), lastCount = {};
  const parts = s => s.split('-').filter(x => !/^(jr|sr|ii|iii|iv)$/.test(x));
  slugs.forEach(s => { const p = parts(s); const l = p[p.length - 1]; lastCount[l] = (lastCount[l] || 0) + 1; });
  slugs.forEach(s => { const p = parts(s); const l = p[p.length - 1]; m.set(s.replace(/-/g, ''), s); m.set(p.join(''), s); m.set(p[0][0] + l, s); if (lastCount[l] === 1) m.set(l, s); });
  VAN = m; VAN_T = Date.now(); return m;
}

async function pageError(request, env) {
  if (!env.GH_TOKEN) return;
  const ct = +(request.headers.get('content-length') || 0); if (ct > 4000) return;
  let j; try { j = JSON.parse(await request.text()); } catch { return; }
  const s = v => String(v || '').replace(/[\u0000-\u001f]/g, ' ').slice(0, 300);
  const msg = s(j.m), page = s(j.p), where = s(j.w), ua = s(j.ua);
  if (!msg || !/^https:\/\/(www\.)?cavsdatabase\.com\//.test(page)) return;
  if (/Script error\.?$|ResizeObserver loop|AbortError|Load failed|Failed to fetch|NetworkError|chrome-extension|moz-extension|safari-extension/i.test(msg + ' ' + where)) return;
  /* once a day per error and page */
  const sig = msg.replace(/\d+/g, '#').slice(0, 120) + '|' + new URL(page).pathname.split('/').slice(0, 2).join('/');
  const key = new Request('https://cache.cavsdatabase.com/err/' + encodeURIComponent(sig).slice(0, 400));
  const cache = caches.default; if (await cache.match(key)) return;
  await cache.put(key, new Response('1', { headers: { 'cache-control': 'max-age=86400' } }));
  await fetch('https://api.github.com/repos/RealCavsFans/cavsdatabase/actions/workflows/client-error.yml/dispatches', {
    method: 'POST', headers: { authorization: 'Bearer ' + env.GH_TOKEN, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'cavsdatabase-err', 'content-type': 'application/json' },
    body: JSON.stringify({ ref: 'main', inputs: { msg, page, where, ua } }) });
}
