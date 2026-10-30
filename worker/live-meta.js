// Link previews for single games on the live page: /live.html?g=<game> gets that game's own title,
// description and share image (og/g/<date>-<opp>.jpg, the same picture as its /games page) instead of the
// generic "live tracker" card. Only the <head> tags change; the page itself is the same static file.
const NICK = { ATL: 'Hawks', BOS: 'Celtics', BKN: 'Nets', CHA: 'Hornets', CHI: 'Bulls', DAL: 'Mavericks', DEN: 'Nuggets', DET: 'Pistons', GSW: 'Warriors', HOU: 'Rockets', IND: 'Pacers', LAC: 'Clippers', LAL: 'Lakers', MEM: 'Grizzlies', MIA: 'Heat', MIL: 'Bucks', MIN: 'Timberwolves', NOP: 'Pelicans', NYK: 'Knicks', OKC: 'Thunder', ORL: 'Magic', PHI: '76ers', PHX: 'Suns', POR: 'Trail Blazers', SAC: 'Kings', SAS: 'Spurs', TOR: 'Raptors', UTA: 'Jazz', WAS: 'Wizards',
  GS: 'Warriors', NO: 'Pelicans', NY: 'Knicks', SA: 'Spurs', UTAH: 'Jazz', WSH: 'Wizards' };
const SITE_AB = { GS: 'GSW', NO: 'NOP', NY: 'NYK', SA: 'SAS', UTAH: 'UTA', WSH: 'WAS' };

async function lookup(env, base, g) {
  // which season's index to read, and which game id
  let se = '2026-27', id = g;
  let m = /^a(\d{4}-\d\d):(\d{6,12})$/.exec(g); if (m) { se = m[1]; id = m[2]; }
  else if ((m = /^r(\d{6,12})$/.exec(g))) { se = '2025-26'; id = m[1]; }
  else if ((m = /^s(\d{4}-\d\d)$/.exec(g))) return { season: m[1] };
  else if (!/^\d{6,12}$/.test(g)) return null;
  const r = await env.ASSETS.fetch(new Request(base + '/live-archive/' + se + '/index.json'));
  if (!r.ok) return null;
  const list = await r.json().catch(() => null);
  const x = Array.isArray(list) && list.find(e => e.id === id);
  if (!x) return null;
  const ab = SITE_AB[x.opp] || x.opp, slug = x.et + '-' + ab.toLowerCase();
  const img = await env.ASSETS.fetch(new Request(base + '/og/g/' + slug + '.jpg', { method: 'HEAD' }));
  return { x, ab, slug, img: img.ok ? '/og/g/' + slug + '.jpg' : null };
}

/* the live page with no game picked (or a game still in progress): the Cavs' current game from ESPN,
   so a shared link reads "LIVE: Bucks 54, Cavs 50 · 3rd 4:12", "Final: …" or "Cavs at Bucks · Sat 8:00 PM ET" (Oct 30) */
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/';
async function espn(path) {
  const cache = caches.default, key = new Request('https://cache.cavsdatabase.com/espn/' + path);
  const hit = await cache.match(key); if (hit) return hit.json();
  const r = await fetch(ESPN + path, { headers: { 'User-Agent': 'cavsdatabase.com' } }); if (!r.ok) return null;
  const j = await r.json(); await cache.put(key, new Response(JSON.stringify(j), { headers: { 'content-type': 'application/json', 'cache-control': 'max-age=60' } })); return j;
}
function gameInfo(comp, date) {
  if (!comp) return null; const cs = comp.competitors || []; const me = cs.find(c => (c.team || {}).abbreviation === 'CLE'), op = cs.find(c => c !== me); if (!me || !op) return null;
  const st = (comp.status || {}).type || {}, ab = op.team.abbreviation, nick = NICK[ab] || op.team.shortDisplayName || ab;
  const sc = c => +((c.score && (c.score.value != null ? c.score.value : c.score.displayValue)) ?? c.score ?? 0);
  return { state: st.state, detail: (comp.status || {}).type ? st.shortDetail || st.detail : '', cle: sc(me), os: sc(op), nick, ab, home: me.homeAway === 'home', date: date || comp.date };
}
async function currentGame(g) {
  if (g && /^\d{6,12}$/.test(g)) { const j = await espn('summary?event=' + g); const c = j && j.header && j.header.competitions && j.header.competitions[0]; return gameInfo(c, c && c.date); }
  const y = new Date(Date.now() - 5 * 3600e3), yr = y.getUTCMonth() >= 7 ? y.getUTCFullYear() + 1 : y.getUTCFullYear();
  const j = await espn('teams/5/schedule?season=' + yr); const ev = (j && j.events) || []; const now = Date.now();
  const live = ev.find(e => ((((e.competitions || [])[0] || {}).status || {}).type || {}).state === 'in');
  const recent = ev.filter(e => { const s = (((e.competitions || [])[0] || {}).status || {}).type || {}; return s.state === 'post' && now - Date.parse(e.date) < 14 * 3600e3; }).pop();
  const next = ev.find(e => Date.parse(e.date) > now - 3 * 3600e3 && ((((e.competitions || [])[0] || {}).status || {}).type || {}).state === 'pre');
  const e = live || recent || next; if (!e) return null;
  /* the schedule feed can lag on live scores: read the game itself while it's on */
  if (e === live) { const s = await espn('summary?event=' + e.id); const c = s && s.header && s.header.competitions && s.header.competitions[0]; if (c) return Object.assign(gameInfo(c, e.date) || {}, { id: e.id }); }
  return Object.assign(gameInfo(e.competitions[0], e.date) || {}, { id: e.id });
}
function liveTags(gi) {
  const vs = (gi.home ? 'vs ' : 'at ') + gi.nick, lead = gi.cle >= gi.os ? 'Cavs ' + gi.cle + ', ' + gi.nick + ' ' + gi.os : gi.nick + ' ' + gi.os + ', Cavs ' + gi.cle;
  const when = new Date(gi.date).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) + ' ET';
  if (gi.state === 'in') return { title: 'LIVE: ' + lead + ' · ' + gi.detail + ' · cavs_db', desc: 'Follow Cavaliers ' + vs + ' live: box score, shot chart, lineups, runs and win probability, updated every 30 seconds.' };
  if (gi.state === 'post') return { title: 'Final: ' + lead + ' · cavs_db', desc: 'Cavaliers ' + vs + ': box score, shot chart, lineups, on/off, assists and win probability.' };
  return { title: 'Cavs ' + vs + ' · ' + when + ' · cavs_db', desc: 'The live tracker for Cavaliers ' + vs + ': box score, shot chart, lineups and win probability from tip to final.' };
}
async function liveNow(request, env, page, g) {
  const u = new URL(request.url); let gi = null; try { gi = await currentGame(g); } catch { gi = null; }
  if (!gi || !gi.state) return page;
  const { title, desc } = liveTags(gi);
  /* picture: the game's own card (final) or its preview card (before and during) when the site has made one */
  const et = new Date(new Date(gi.date).getTime() - 4 * 3600e3).toISOString().slice(0, 10), ab = (SITE_AB[gi.ab] || gi.ab).toLowerCase();
  let img = null; for (const pth of gi.state === 'post' ? ['/og/g/' + et + '-' + ab + '.jpg', '/og/gp/' + et + '-' + ab + '.jpg'] : ['/og/gp/' + et + '-' + ab + '.jpg']) { const r = await env.ASSETS.fetch(new Request(u.origin + pth, { method: 'HEAD' })); if (r.ok) { img = pth; break; } }
  const set = (attr, val) => ({ element(e) { e.setAttribute(attr, val); } });
  let rw = new HTMLRewriter().on('title', { element(e) { e.setInnerContent(title); } }).on('meta[property="og:title"]', set('content', title))
    .on('meta[name="twitter:title"]', set('content', title)).on('meta[name="description"]', set('content', desc)).on('meta[property="og:description"]', set('content', desc));
  if (img) rw = rw.on('meta[property="og:image"]', set('content', u.origin + img)).on('meta[name="twitter:image"]', set('content', u.origin + img)).on('meta[property="og:image:alt"]', set('content', title));
  const out = rw.transform(page); const h = new Headers(out.headers); h.set('cache-control', 'public, max-age=60'); return new Response(out.body, { status: out.status, headers: h });
}

export async function liveMeta(request, env) {
  const u = new URL(request.url), g = u.searchParams.get('g');
  const page = await env.ASSETS.fetch(request);
  if (!page.ok || !(page.headers.get('content-type') || '').includes('text/html')) return page;
  if (!g) return liveNow(request, env, page, null);
  let info = null;
  try { info = await lookup(env, u.origin, g.slice(0, 40)); } catch { info = null; }
  if (!info) return /^\d{6,12}$/.test(g) ? liveNow(request, env, page, g) : page;
  let title, desc, img = null;
  if (info.season) {
    title = 'Cavs ' + info.season.replace('-', '–') + ' season stats · cavs_db';
    desc = 'Every Cavaliers game this season in one place: team and player stats, lineups, on/off, shot charts and the four factors.';
  } else {
    const { x, ab } = info, nick = NICK[ab] || NICK[x.opp] || ab, won = x.cle > x.os;
    const d = new Date(x.et + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    title = (won ? 'Cavs ' + x.cle + ', ' + nick + ' ' + x.os : nick + ' ' + x.os + ', Cavs ' + x.cle) + ' (' + d + ') · cavs_db';
    desc = 'Final: box score, shot chart, lineups, on/off, assists and win probability for Cavaliers ' + (x.ha === 'home' ? 'vs ' : 'at ') + nick + ', ' + d + '.';
    img = info.img;
  }
  const full = u.origin + '/live?g=' + encodeURIComponent(g);
  const set = (attr, val) => ({ element(e) { e.setAttribute(attr, val); } });
  let rw = new HTMLRewriter()
    .on('title', { element(e) { e.setInnerContent(title); } })
    .on('meta[property="og:title"]', set('content', title))
    .on('meta[name="description"]', set('content', desc))
    .on('meta[property="og:description"]', set('content', desc))
    .on('meta[property="og:url"]', set('content', full));
  if (img) rw = rw.on('meta[property="og:image"]', set('content', u.origin + img))
    .on('meta[name="twitter:image"]', set('content', u.origin + img))
    .on('meta[property="og:image:alt"]', set('content', title));
  const out = rw.transform(page);
  return out;
}
