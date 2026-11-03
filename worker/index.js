// cavsdatabase.com Worker: the site is static files; only /pbp (the live page's backup play-by-play) and
// /live.html?g=… (each game's own link preview tags) run code.
import { onRequestGet } from './pbp.js';
import { liveMeta } from './live-meta.js';
import { nbaGame } from './nba.js';
export default {
  async fetch(request, env, ctx) {
    const u = new URL(request.url);
    /* Nov 3: short sign-up links for Cavs & Coffee */
    if (u.pathname === '/coffee' || u.pathname === '/newsletter') return Response.redirect('https://buttondown.com/cavscoffee', 302);
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
let VAN = null, VAN_T = 0;
async function vanity(env, u) {
  if (VAN && Date.now() - VAN_T < 36e5) return VAN;
  const xml = await (await env.ASSETS.fetch(new Request(u.origin + '/sitemap.xml'))).text();
  const slugs = [...new Set([...xml.matchAll(/\/players\/([a-z0-9-]+)/g)].map(m => m[1]))];
  const m = new Map(), lastCount = {};
  const parts = s => s.split('-').filter(x => !/^(jr|sr|ii|iii|iv)$/.test(x));
  slugs.forEach(s => { const p = parts(s); const l = p[p.length - 1]; lastCount[l] = (lastCount[l] || 0) + 1; });
  slugs.forEach(s => { const p = parts(s); const l = p[p.length - 1]; m.set(s.replace(/-/g, ''), s); m.set(p.join(''), s); m.set(p[0][0] + l, s); if (lastCount[l] === 1) m.set(l, s); });
  VAN = m; VAN_T = Date.now(); return m;
}
