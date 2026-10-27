// cavsdatabase.com Worker: the site is static files; only /pbp (the live page's backup play-by-play) and
// /live.html?g=… (each game's own link preview tags) run code.
import { onRequestGet } from './pbp.js';
import { liveMeta } from './live-meta.js';
export default {
  async fetch(request, env, ctx) {
    const u = new URL(request.url);
    if (u.pathname === '/pbp' && request.method === 'GET') {
      try { return await onRequestGet({ request, env, waitUntil: p => ctx.waitUntil(p) }) }
      catch (e) { return new Response(JSON.stringify({ error: 'backup feed error' }), { status: 502, headers: { 'content-type': 'application/json' } }) }
    }
    /* single-game links on the live page get that game's own link preview */
    if ((u.pathname === '/live.html' || u.pathname === '/live') && u.searchParams.has('g') && request.method === 'GET') {
      try { return await liveMeta(request, env); } catch (e) { return env.ASSETS.fetch(request); }
    }
    return env.ASSETS.fetch(request);
  }
};
