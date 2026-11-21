// /nba: the NBA's own live game feed for the live page (Nov 2).
// The NBA's files (box score, play-by-play, today's scoreboard) sit in an S3 bucket with no CORS headers and no CDN,
// so the page asks us instead. One shared cached copy serves every visitor (8 seconds while a game is on, 2 minutes for the first hours after the final while the NBA is still correcting, then a day), so the bucket sees a handful of requests a minute no matter how many people are watching.
//
//   GET /nba?d=YYYYMMDD&t=CLE      that team's game that day: {gameId, box, pbp}  (404 before tip-off: the files appear then)
//   GET /nba?id=0022600158         the same, by NBA game ID
// The NBA base address is kept in one place: the feed moved once without notice (Oct 28, 2026).
const NBA_BASE = 'https://nba-prod-us-east-1-mediaops-stats.s3.amazonaws.com/NBA';
const TRI = /^[A-Z]{3}$/;
const json = (o, status, ttl) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=' + Math.min(ttl, 8) } });
async function s3(path, ttl) {
  const r = await fetch(NBA_BASE + path, { cf: { cacheTtl: ttl, cacheEverything: true } });
  if (r.status === 403 || r.status === 404) return null;   // 403 = "not there (yet)", never a block: no retries
  if (!r.ok) throw new Error('NBA ' + r.status);
  return JSON.parse(await r.text());                        // the scoreboard comes back as text/plain
}
async function findGame(ctx, d, t) {
  // 1) the season's IDs (pdata/nba-games.json, saved each morning from the NBA's schedule)
  try { const j = await (await ctx.env.ASSETS.fetch(new URL('/pdata/nba-games.json', ctx.request.url))).json(); const id = j.d && j.d[d] && j.d[d][t]; if (id) return id; } catch {}
  // 2) today's scoreboard
  const sb = await s3('/liveData/scoreboard/todaysScoreboard_00.json', 30);
  const g = sb && sb.scoreboard && (sb.scoreboard.games || []).find(x => (x.homeTeam.teamTricode === t || x.awayTeam.teamTricode === t) && String(x.gameCode || '').startsWith(d));
  return g ? g.gameId : null;
}
export async function nbaGame(ctx) {
  const u = new URL(ctx.request.url), q = u.searchParams;
  let id = q.get('id'); const d = q.get('d'), t = (q.get('t') || '').toUpperCase();
  if (id && !/^\d{10}$/.test(id)) return json({ error: 'id' }, 400, 0);
  if (!id) { if (!/^\d{8}$/.test(d || '') || !TRI.test(t)) return json({ error: 'd=YYYYMMDD&t=TRI or id=' }, 400, 0); id = await findGame(ctx, d, t); }
  if (!id) return json({ error: 'no game that day' }, 404, 300);
  const key = new Request(u.origin + '/nba?id=' + id);
  const hit = await caches.default.match(key); if (hit) return hit;
  const [box, pbp] = await Promise.all([s3('/liveData/boxscore/boxscore_' + id + '.json', 8), s3('/liveData/playbyplay/playbyplay_' + id + '.json', 8)]);
  if (!box || !pbp) return json({ error: 'not started', gameId: id }, 404, 30);
  /* Nov 8 (Luka): the NBA keeps fixing the play-by-play for a while after the final (assists, blocks, rebounds credited
     minutes later; Nov 7 vs NYK: two Cavs assists and a Knicks block came in 4-7 minutes after the buzzer). So a final game
     is held for 2 minutes until its newest edit is 3 hours old, and only then for a day. */
  const acts = (pbp.game && pbp.game.actions) || [], last = acts.reduce((m, a) => { const t = Date.parse(a.edited || a.timeActual || ''); return t > m ? t : m; }, 0);
  const fin = box.game && box.game.gameStatus === 3, ttl = !fin ? 8 : (last && Date.now() - last < 3 * 3600e3 ? 120 : 86400);
  const body = JSON.stringify({ gameId: id, box, pbp });
  ctx.waitUntil(caches.default.put(key, new Response(body, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=' + ttl } })));
  return new Response(body, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=' + Math.min(ttl, 8) } });
}
