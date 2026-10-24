// /pbp: backup play-by-play for the live page when ESPN's feed fails.
// GET /pbp?d=YYYYMMDD returns the Cavs game that day in ESPN's summary shape, from StatMuse, then CBS, then Yahoo.
// One shared cached copy serves every visitor (15 seconds while live), so each source sees about four requests a minute.
// Tests: &away=PHI&home=NYK picks another game; &src=statmuse|yahoo|cbs forces one source; &sm=<statmuse game slug>.
import { fromStatMuse, fromText, yahooRows, cbsRows, teamCode, shell } from '../scripts/pbp-sources.mjs';

const UA = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36', 'accept-language': 'en-US,en;q=0.9' };
const FULL = { ATL: 'atlanta-hawks', BOS: 'boston-celtics', BKN: 'brooklyn-nets', CHA: 'charlotte-hornets', CHI: 'chicago-bulls', CLE: 'cleveland-cavaliers', DAL: 'dallas-mavericks', DEN: 'denver-nuggets', DET: 'detroit-pistons', GSW: 'golden-state-warriors', HOU: 'houston-rockets', IND: 'indiana-pacers', LAC: 'clippers', LAL: 'lakers', MEM: 'memphis-grizzlies', MIA: 'miami-heat', MIL: 'milwaukee-bucks', MIN: 'minnesota-timberwolves', NOP: 'new-orleans-pelicans', NYK: 'new-york-knicks', OKC: 'oklahoma-city-thunder', ORL: 'orlando-magic', PHI: 'philadelphia-76ers', PHX: 'phoenix-suns', POR: 'portland-trail-blazers', SAC: 'sacramento-kings', SAS: 'san-antonio-spurs', TOR: 'toronto-raptors', UTA: 'utah-jazz', WAS: 'washington-wizards' };
const CBS = { GSW: 'GS', NYK: 'NY', NOP: 'NO', SAS: 'SA', UTA: 'UTAH', PHX: 'PHO' };
const get = async (u, ttl = 0) => { const r = await fetch(u, { headers: UA, cf: ttl ? { cacheTtl: ttl, cacheEverything: true } : { cacheTtl: 0 } }); if (!r.ok) throw new Error(u.split('/')[2] + ' ' + r.status); return r.text() };
const secs = c => { const [m, s] = String(c).split(':'); return +m * 60 + parseFloat(s || 0) };
// rows may arrive newest first: put periods in order and each period oldest first
const order = rows => { const by = {}; rows.forEach(r => (by[r.per] = by[r.per] || []).push(r)); return Object.keys(by).map(Number).sort((a, b) => a - b).flatMap(p => { const g = by[p]; return g.length > 1 && secs(g[0].clock) < secs(g[g.length - 1].clock) ? g.reverse() : g }) };

async function cavsGame(ctx, d) {
  // the site's own calendar knows the opponent and home or away
  const ics = await (await ctx.env.ASSETS.fetch(new URL('/cavs.ics', ctx.request.url))).text();
  const ev = ics.split('BEGIN:VEVENT').find(b => b.includes('cavs-' + d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6) + '@'));
  if (!ev) return null;
  // upcoming games read "Cavs vs X"; finished ones read "W 114–106 vs X" (see scripts/prerender.mjs)
  const sum = (ev.match(/SUMMARY:[^\n]*?(?:Cavs|\d+[–-]\d+) (vs|at) ([^\r\n]+)/) || []); const opp = cityCode(sum[2]);
  const start = ((ev.match(/DTSTART:(\d{8}T\d{6}Z)/) || [])[1] || '').replace(/(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z/, '$1-$2-$3T$4:$5:$6Z') || null;
  return opp ? (sum[1] === 'vs' ? { home: 'CLE', away: opp, start } : { home: opp, away: 'CLE', start }) : null;
}
const CITY = { 'LA Clippers': 'LAC', 'L.A. Clippers': 'LAC', 'LA Lakers': 'LAL', 'L.A. Lakers': 'LAL', 'Los Angeles': 'LAL', Atlanta: 'ATL', Boston: 'BOS', Brooklyn: 'BKN', Charlotte: 'CHA', Chicago: 'CHI', Dallas: 'DAL', Denver: 'DEN', Detroit: 'DET', 'Golden State': 'GSW', Houston: 'HOU', Indiana: 'IND', Memphis: 'MEM', Miami: 'MIA', Milwaukee: 'MIL', Minnesota: 'MIN', 'New Orleans': 'NOP', 'New York': 'NYK', 'Oklahoma City': 'OKC', Orlando: 'ORL', Philadelphia: 'PHI', Phoenix: 'PHX', Portland: 'POR', Sacramento: 'SAC', 'San Antonio': 'SAS', Toronto: 'TOR', Utah: 'UTA', Washington: 'WAS' };
const cityCode = s => { if (!s) return null; s = s.trim(); for (const k of Object.keys(CITY).sort((a, b) => b.length - a.length)) if (s.startsWith(k)) return CITY[k]; return teamCode(s) };
const iso = d => d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6);

const SRC = {
  async statmuse(g, d, q) {
    let slug = q.get('sm');
    if (!slug) {
      const md = d.slice(4, 6) + '-' + d.slice(6) + '-' + d.slice(0, 4); const yr = +d.slice(0, 4) + (+d.slice(4, 6) >= 8 ? 1 : 0);
      const sched = await get('https://www.statmuse.com/nba/team/cleveland-cavaliers-42/schedule/' + yr, 21600);
      slug = [...sched.matchAll(new RegExp('/nba/game/(' + md + '-([a-z]+)-at-([a-z]+)-\\d+)', 'g'))].filter(m => teamCode(m[2]) === g.away && teamCode(m[3]) === g.home).map(m => m[1])[0];
      if (!slug) throw new Error('statmuse: game not found');
    }
    return fromStatMuse(await get('https://www.statmuse.com/nba/game/' + slug));
  },
  async yahoo(g, d) {
    const sb = await get('https://sports.yahoo.com/nba/scoreboard/?confId=&schedState=&dateRange=' + iso(d), 300);
    const slug = [...new Set([...sb.matchAll(/\/nba\/([a-z0-9-]+-\d{10,12})\//g)].map(m => m[1]))].find(s => s.includes(FULL[g.home]) && s.includes(FULL[g.away]) && s.includes(d));
    if (!slug) throw new Error('yahoo: game not found');
    const html = await get('https://sports.yahoo.com/nba/' + slug + '/?section=plays');
    const { rows, shots } = yahooRows(html); if (!rows.length) throw new Error('yahoo: no plays');
    const ord = order(rows).map(r => { const side = teamCode(r.teamName) === g.home ? 'home' : teamCode(r.teamName) === g.away ? 'away' : null; const s = shots[r.per + '|' + r.clock + '|' + r.text]; const o = { per: r.per, clock: r.clock, team: side, text: r.text };
      if (s) { const left = /left/i.test(r.text) ? -1 : 1; o.x = Math.round((25 + left * s[1] * 50) * 10) / 10; o.y = Math.round(s[0] * 94 * 10) / 10 } return o });
    const t = (html.match(/og:title" content="([^"]*)"/) || [])[1] || ''; const st = /: Final/i.test(t) ? 'post' : 'in';
    const sc = t.match(/^(.+?) (\d+) - (.+?) (\d+):/); const score = sc && teamCode(sc[1]) === g.away ? [+sc[4], +sc[2]] : null;
    return fromText('Yahoo Sports', g.home, g.away, ord, st, g.start, score);
  },
  async cbs(g, d) {
    const code = c => CBS[c] || c;
    const html = await get('https://www.cbssports.com/nba/gametracker/playbyplay/NBA_' + d + '_' + code(g.away) + '@' + code(g.home) + '/');
    const raw = cbsRows(html); if (!raw.length) throw new Error('cbs: no plays');
    let pa = 0, ph = 0, last = null; const ord = order(raw.map(r => Object.assign({}, r, { per: r.per || 1 }))).map(r => { let side = r.team ? (teamCode(r.team) === g.home ? 'home' : teamCode(r.team) === g.away ? 'away' : null) : null; let as, hs;
      if (r.score) { [as, hs] = r.score.split('-').map(Number); if (!side) side = hs > ph ? 'home' : as > pa ? 'away' : null;
        // a corrected play comes in as a second row with the same score: keep only the newer one
        if (last && last.as === as && last.hs === hs && last.clock === r.clock && last.per === r.per) last.drop = true; pa = as; ph = hs }
      const o = { per: r.per, clock: r.clock, team: side, text: r.text, hs, as }; if (r.score) last = o; return o }).filter(r => !r.drop);
    const st = /Final/.test((html.match(/<title>([^<]*)/) || [])[1] || '') ? 'post' : 'in';
    return fromText('CBS Sports', g.home, g.away, ord, st, g.start);
  }
};

export async function onRequestGet(ctx) {
  const u = new URL(ctx.request.url), q = u.searchParams;
  const d = q.get('d') || ''; if (!/^\d{8}$/.test(d)) return json({ error: 'd=YYYYMMDD' }, 400);
  for (const k of ['away', 'home']) if (q.get(k) && !teamCode(q.get(k))) return json({ error: 'team' }, 400);
  if (q.get('sm') && !/^[a-z0-9-]{10,80}$/.test(q.get('sm'))) return json({ error: 'sm' }, 400);
  const only = q.get('src'); if (only && !SRC[only]) return json({ error: 'src' }, 400);
  const key = new Request(u.origin + '/pbp?' + ['d', 'away', 'home', 'src', 'sm'].map(k => k + '=' + (q.get(k) || '')).join('&'));
  const cache = caches.default; const hit = await cache.match(key); if (hit) return hit;
  let g = q.get('home') && q.get('away') ? { home: teamCode(q.get('home')), away: teamCode(q.get('away')) } : await cavsGame(ctx, d).catch(() => null);
  if (!g) return json({ error: 'no Cavs game that day' }, 404, 600, key, ctx);
  const errs = [];
  for (const s of only ? [only] : ['statmuse', 'cbs', 'yahoo']) {
    try { const out = await SRC[s](g, d, q); if (!out.plays.length && out.header.competitions[0].status.type.state !== 'pre') throw new Error(s + ': empty'); out.tried = errs; const fin = out.header.competitions[0].status.type.state === 'post'; return json(out, 200, fin ? 600 : 15, key, ctx) }
    catch (e) { errs.push(String(e.message || e).slice(0, 120)) }
  }
  // nothing has the game yet: before tip-off, hand back the matchup from the calendar so the page can show it
  if (!only && g.start && Date.now() < Date.parse(g.start) + 15 * 60e3) {
    const out = shell(g.home, g.away, g.start); out.tried = errs; return json(out, 200, 60, key, ctx);
  }
  return json({ error: 'all backups failed', tried: errs }, 502, 15, key, ctx);
}
function json(o, status, ttl = 0, key, ctx) {
  const r = new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=' + Math.min(ttl, 15) } });
  if (status === 200 && ttl && key && ctx) ctx.waitUntil(caches.default.put(key, new Response(r.clone().body, { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=' + ttl } })));
  return r;
}
