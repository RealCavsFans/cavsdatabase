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

export async function liveMeta(request, env) {
  const u = new URL(request.url), g = u.searchParams.get('g');
  const page = await env.ASSETS.fetch(request);
  if (!g || !page.ok || !(page.headers.get('content-type') || '').includes('text/html')) return page;
  let info = null;
  try { info = await lookup(env, u.origin, g.slice(0, 40)); } catch { info = null; }
  if (!info) return page;
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
