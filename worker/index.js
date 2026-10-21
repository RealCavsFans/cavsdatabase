// cavsdatabase.com Worker: the site is static files; only /pbp (the live page's backup play-by-play) runs code.
import { onRequestGet } from './pbp.js';
export default {
  async fetch(request, env, ctx) {
    const u = new URL(request.url);
    if (u.pathname === '/pbp' && request.method === 'GET') {
      try { return await onRequestGet({ request, env, waitUntil: p => ctx.waitUntil(p) }) }
      catch (e) { return new Response(JSON.stringify({ error: 'backup feed error' }), { status: 502, headers: { 'content-type': 'application/json' } }) }
    }
    return env.ASSETS.fetch(request);
  }
};
