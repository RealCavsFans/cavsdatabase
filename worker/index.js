// cavsdatabase.com Worker: the site is static files; only /pbp (the live page's backup play-by-play) and
// /live.html?g=… (each game's own link preview tags) run code.
import { onRequestGet } from './pbp.js';
import { liveMeta } from './live-meta.js';
import { nbaGame } from './nba.js';
import { probe } from './probe.js';
export default {
  async fetch(request, env, ctx) {
    const u = new URL(request.url);
    if (u.pathname === '/pbp' && request.method === 'GET') {
      try { return await onRequestGet({ request, env, waitUntil: p => ctx.waitUntil(p) }) }
      catch (e) { return new Response(JSON.stringify({ error: 'backup feed error' }), { status: 502, headers: { 'content-type': 'application/json' } }) }
    }
    /* Nov 2: the NBA's own live feed (box score + play-by-play), proxied because the NBA's bucket sends no CORS headers */
    if (u.pathname === '/probe-stats' && request.method === 'GET') return probe();   // one-off test (Nov 3), removed after
    if (u.pathname === '/nba' && request.method === 'GET') {
      try { return await nbaGame({ request, env, waitUntil: p => ctx.waitUntil(p) }) }
      catch (e) { return new Response(JSON.stringify({ error: 'nba feed error' }), { status: 502, headers: { 'content-type': 'application/json' } }) }
    }
    /* single-game links on the live page get that game's own link preview */
    if ((u.pathname === '/live.html' || u.pathname === '/live') && request.method === 'GET') {
      try { return await liveMeta(request, env); } catch (e) { return env.ASSETS.fetch(request); }
    }
    return env.ASSETS.fetch(request);
  }
};
