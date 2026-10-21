// Backup play-by-play sources for the live page, used by functions/pbp.js (Cloudflare) when ESPN's feed fails.
// Each parser turns a public game page into the same shape as ESPN's summary feed (header, boxscore, plays),
// so the live page works unchanged. Order: StatMuse (structured, has substitutions), CBS (every play, no locations), Yahoo (some plays missing, has locations).

// ESPN ids, abbreviations and logos, keyed by the common three-letter code
const TEAMS = { ATL: [1, 'ATL', 'Hawks', 'Atlanta'], BOS: [2, 'BOS', 'Celtics', 'Boston'], BKN: [17, 'BKN', 'Nets', 'Brooklyn'], CHA: [30, 'CHA', 'Hornets', 'Charlotte'], CHI: [4, 'CHI', 'Bulls', 'Chicago'], CLE: [5, 'CLE', 'Cavaliers', 'Cleveland'], DAL: [6, 'DAL', 'Mavericks', 'Dallas'], DEN: [7, 'DEN', 'Nuggets', 'Denver'], DET: [8, 'DET', 'Pistons', 'Detroit'], GSW: [9, 'GS', 'Warriors', 'Golden State'], HOU: [10, 'HOU', 'Rockets', 'Houston'], IND: [11, 'IND', 'Pacers', 'Indiana'], LAC: [12, 'LAC', 'Clippers', 'LA'], LAL: [13, 'LAL', 'Lakers', 'Los Angeles'], MEM: [29, 'MEM', 'Grizzlies', 'Memphis'], MIA: [14, 'MIA', 'Heat', 'Miami'], MIL: [15, 'MIL', 'Bucks', 'Milwaukee'], MIN: [16, 'MIN', 'Timberwolves', 'Minnesota'], NOP: [3, 'NO', 'Pelicans', 'New Orleans'], NYK: [18, 'NY', 'Knicks', 'New York'], OKC: [25, 'OKC', 'Thunder', 'Oklahoma City'], ORL: [19, 'ORL', 'Magic', 'Orlando'], PHI: [20, 'PHI', '76ers', 'Philadelphia'], PHX: [21, 'PHX', 'Suns', 'Phoenix'], POR: [22, 'POR', 'Trail Blazers', 'Portland'], SAC: [23, 'SAC', 'Kings', 'Sacramento'], SAS: [24, 'SA', 'Spurs', 'San Antonio'], TOR: [28, 'TOR', 'Raptors', 'Toronto'], UTA: [26, 'UTAH', 'Jazz', 'Utah'], WAS: [27, 'WSH', 'Wizards', 'Washington'] };
const ALIAS = { NY: 'NYK', GS: 'GSW', SA: 'SAS', NO: 'NOP', UTAH: 'UTA', WSH: 'WAS', PHO: 'PHX', BRK: 'BKN', CHO: 'CHA', NOR: 'NOP' };
const NICK = Object.fromEntries(Object.entries(TEAMS).map(([k, v]) => [v[2].toLowerCase(), k]));
export const teamCode = s => { if (!s) return null; const u = String(s).toUpperCase(); if (TEAMS[u]) return u; if (ALIAS[u]) return ALIAS[u]; const l = String(s).toLowerCase(); for (const n in NICK) if (l.includes(n)) return NICK[n]; return null };
const comp = (code, ha, score) => { const t = TEAMS[code]; return { id: String(t[0]), homeAway: ha, score: String(score ?? 0), record: [], team: { abbreviation: t[1], shortDisplayName: t[2], name: t[2], location: t[3], logos: [{ href: 'https://a.espncdn.com/i/teamlogos/nba/500/' + t[1].toLowerCase() + '.png' }] } } };
const header = (home, away, hs, as, st, per, clock, date) => ({ competitions: [{ competitors: [comp(home, 'home', hs), comp(away, 'away', as)], status: { period: per, displayClock: clock, type: { state: st, completed: st === 'post', shortDetail: st === 'post' ? 'Final' : st === 'in' ? clock + ' - ' + per : '' } }, date, broadcasts: [] }] });
const pad = c => { if (!c) return '0:00'; let [m, s] = String(c).split(':'); m = String(+m); return m + ':' + (s || '00').slice(0, 2).padStart(2, '0') + ((s || '').includes('.') ? (s.slice(2) || '') : '') };
const box = (teams) => ({ players: teams.map(t => ({ team: { id: t.id }, statistics: [{ names: [], athletes: t.ath.map(a => ({ athlete: { id: a.id, displayName: a.name, shortName: a.short || a.name, position: { abbreviation: a.pos || '' } }, starter: !!a.starter, didNotPlay: !!a.dnp, reason: a.reason || '', stats: [] })) }] })), teams: [] });
const short = n => { const p = String(n).split(' '); return p.length > 1 ? p[0][0] + '. ' + p.slice(1).join(' ') : n };
const dec = s => s.replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const stateOf = s => /final|complete|closed/i.test(s || '') ? 'post' : /progress|half|live|end|period|in_/i.test(s || '') ? 'in' : 'pre';

/* shot names in ESPN's words: modifiers first, then the base shot */
const SHOT_WORD = { Stepback: 'Step Back', Fadeaway: 'Fade Away', Pullup: 'Pullup', FingerRoll: 'Finger Roll', AlleyOop: 'Alley Oop' };
export function shotName(t) {
  if (!t) return 'Jump Shot';
  const w = t.replace(/FingerRoll/g, 'Fingerroll').replace(/AlleyOop/g, 'Alleyoop').replace(/([a-z])([A-Z])/g, '$1 $2').split(' ').map(x => x[0].toUpperCase() + x.slice(1)).map(x => x === 'Fingerroll' ? 'Finger Roll' : x === 'Alleyoop' ? 'Alley Oop' : SHOT_WORD[x] || x);
  let base = w[0], i = 1; if (base === 'Jump' && w[1] === 'Shot') { base = 'Jump Shot'; i = 2 }
  const mods = w.slice(i); if (base === 'Layup' || base === 'Dunk' || base === 'Hook') base += ' Shot';
  if (mods.includes('Tip') && /Layup/.test(base)) return 'Tip Shot';
  return [...mods, base].join(' ');
}

/* ---------- StatMuse: structured game state inside the page ---------- */
const rv = v => { if (Array.isArray(v) && v.length >= 2 && typeof v[0] === 'number') { if (v[0] === 1) return v[1].map(rv); if (v[0] === 0) return ro(v[1]); return v[1] } return ro(v) };
const ro = o => { if (o && typeof o === 'object' && !Array.isArray(o)) { const r = {}; for (const k in o) r[k] = rv(o[k]); return r } return o };
export function fromStatMuse(html) {
  const m = [...html.matchAll(/<astro-island[^>]*props="([^"]*playByPlay[^"]*)"/g)][0]; if (!m) throw new Error('statmuse: no game state');
  const G = ro(JSON.parse(dec(m[1]))); const gd = G.gameData, pb = G.playByPlay, pl = G.players || {};
  const ab = {}; for (const x of dec(html).matchAll(/"teamId":\[0,(\d+)\],"seasonYear":\[0,\d+\],"name":\[0,"[^"]*"\],"nickname":\[0,"[^"]*"\],"abbreviation":\[0,"([A-Z]+)"\]/g)) ab[x[1]] = x[2];
  const tm = {}; [['home', gd.homeTeam], ['away', gd.awayTeam]].forEach(([ha, g]) => { tm[g.teamId] = { ha, code: teamCode(ab[g.teamId]) } });
  const H = tm[gd.homeTeam.teamId].code, A = tm[gd.awayTeam.teamId].code;
  if (!H || !A) throw new Error('statmuse: teams');
  const tid = id => tm[id] ? String(TEAMS[tm[id].code][0]) : null;
  const names = {}, pos = {}; for (const k in pl) { const x = pl[k]; if (x && x.longName) { names[k] = x.longName; pos[k] = (x.position || '').split('_').map(w => w[0]).join('').replace(/^PG$|^SG$|^SF$|^PF$|^C$/, y => y) } }
  const pid = id => id == null ? null : 'sm' + id;
  const teamOfP = {}; const ath = [gd.homeTeam, gd.awayTeam].map(g => ({ id: tid(g.teamId), ath: (g.players || []).map(p => { teamOfP[p.playerId] = tid(g.teamId); const nm = names[p.playerId] || 'Player ' + p.playerId; return { id: pid(p.playerId), name: nm, short: (pl[p.playerId] && pl[p.playerId].shortName) || short(nm), pos: pos[p.playerId], starter: p.starter, dnp: p.played === false, reason: p.notPlayedDescription || '' } }) }));
  const N = id => names[id] || 'Player ' + id;
  const plays = []; let seq = 0;
  const add = (e, type, text, team, ids, extra = {}) => plays.push(Object.assign({ id: 'sm' + (e.eventSequence ?? ++seq) + (extra.k || ''), type: { text: type }, text, period: { number: e.period }, clock: { displayValue: pad(e.clock || '0:00') }, team: team ? { id: team } : undefined, participants: ids.filter(x => x != null).map(x => ({ athlete: { id: pid(x) } })), homeScore: e.homePoints, awayScore: e.awayPoints, scoringPlay: false, scoreValue: 0, shootingPlay: false, pointsAttempted: 0 }, extra));
  const ev = pb.events || []; let prevH = 0, prevA = 0;
  for (const e of ev) {
    const team = tid(e.teamId ?? e.turnoverTeamId ?? e.foulTeamId);
    switch (e.type) {
      case 'lineupChange': { const ins = e.subbedInPlayerIds || [], outs = e.subbedOutPlayerIds || []; outs.forEach((o, i) => { if (ins[i] != null) add(e, 'Substitution', N(ins[i]) + ' enters the game for ' + N(o), team, [ins[i], o], { k: '-' + i }) }); break }
      case 'fieldGoal': { const three = !!e.isThreePoint, v = three ? 3 : 2, ty = shotName(e.shotType); const d = e.distanceFeet != null ? Math.round(e.distanceFeet) + '-foot ' : '';
        const txt = N(e.playerId) + (e.isMade ? ' makes ' : ' misses ') + d + (three ? 'three point ' : 'two point ') + ty.toLowerCase() + (e.isMade && e.assistPlayerId ? ' (' + N(e.assistPlayerId) + ' assists)' : '');
        const blk = e.blockPlayerId ?? e.blockedByPlayerId; const c = e.coordinates || {};
        add(e, ty, blk && !e.isMade ? N(blk) + ' blocks ' + N(e.playerId) + "'s " + (three ? 'three point' : 'two point') + ' shot' : txt, team, [e.playerId, e.isMade ? e.assistPlayerId : blk], { scoringPlay: !!e.isMade, scoreValue: e.isMade ? v : 0, shootingPlay: true, pointsAttempted: v, coordinate: c.x != null ? { x: Math.round((25 + c.x / 10) * 10) / 10, y: Math.round(c.y / 10 * 10) / 10 } : undefined }); break }
      case 'freeThrow': { const tech = /tech/i.test(e.freeThrowType || ''); const ty = tech ? 'Free Throw - Technical' : 'Free Throw - ' + (e.attemptNumber || 1) + ' of ' + (e.totalGranted || 1);
        add(e, ty, N(e.playerId) + (e.isMade ? ' makes ' : ' misses ') + 'free throw ' + (e.attemptNumber || 1) + ' of ' + (e.totalGranted || 1), team, [e.playerId], { scoringPlay: !!e.isMade, scoreValue: e.isMade ? 1 : 0, shootingPlay: true, pointsAttempted: 1 }); break }
      case 'rebound': { const off = e.reboundType === 'offensive'; add(e, off ? 'Offensive Rebound' : 'Defensive Rebound', (e.playerId != null ? N(e.playerId) : TEAMS[tm[e.teamId].code][2]) + (off ? ' offensive' : ' defensive') + (e.playerId != null ? ' rebound' : ' team rebound'), team, [e.playerId]); break }
      case 'turnover': { const w = (e.turnoverType || 'turnover').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase()).replace(/ Violation$/, '').replace(/ Of /, ' of ');
        add(e, /^(Turnover|Traveling)$/.test(w) ? w : w + ' Turnover', (e.turnoverPlayerId != null ? N(e.turnoverPlayerId) : TEAMS[tm[e.turnoverTeamId]?.code || H][2]) + ' ' + w.toLowerCase() + (e.stealPlayerId ? ' (' + N(e.stealPlayerId) + ' steals)' : ''), team, [e.turnoverPlayerId, e.stealPlayerId]); break }
      case 'foul': { const ft = e.foulType || 'personal'; const ty = ft === 'looseBall' ? 'Loose Ball Foul' : ft === 'technical' ? 'Technical Foul' : ft === 'flagrant1' || ft === 'flagrant2' ? 'Flagrant Foul Type ' + ft.slice(-1) : (ft[0].toUpperCase() + ft.slice(1).replace(/([a-z])([A-Z])/g, '$1 $2')) + ' Foul';
        add(e, ty, (e.foulPlayerId != null ? N(e.foulPlayerId) : 'Team') + ' ' + ty.toLowerCase() + (e.foulDrawnPlayerId ? ' (' + N(e.foulDrawnPlayerId) + ' draws the foul)' : ''), team, [e.foulPlayerId, e.foulDrawnPlayerId]); break }
      case 'teamTimeout': add(e, 'Full Timeout', TEAMS[tm[e.teamId]?.code || H][2] + ' timeout', team, []); break;
      case 'officialTimeout': add(e, 'Official Timeout', 'Official timeout', null, []); break;
      case 'review': add(e, /overturn/i.test(e.reviewType || '') ? "Coach's Challenge (Overturned)" : /challenge/i.test(e.reviewType || '') ? 'Challenge' : 'Review', 'Review', team, []); break;
      case 'violation': add(e, (e.violationType || 'violation').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase()), (e.violationPlayerId != null ? N(e.violationPlayerId) + ' ' : '') + (e.violationType || 'violation'), team, [e.violationPlayerId]); break;
      case 'openTip': case 'jumpBall': add(e, 'Jumpball', N(e.awayPlayerId) + ' vs. ' + N(e.homePlayerId) + ' (' + N(e.possessionPlayerId) + ' gains possession)', null, [e.awayPlayerId, e.homePlayerId, e.possessionPlayerId]); break;
      case 'endPeriod': add(e, 'End Period', 'End of ' + (e.period > 4 ? 'OT' + (e.period - 4) : 'Q' + e.period), null, [], { clock: { displayValue: '0:00' } }); break;
      default: break;
    }
    prevH = e.homePoints ?? prevH; prevA = e.awayPoints ?? prevA;
  }
  const st = /final|complete/i.test(gd.type + ' ' + gd.gameStatus) ? 'post' : /progress|half|live|end/i.test(gd.type + ' ' + gd.gameStatus) ? 'in' : 'pre';
  const lp = ev[ev.length - 1] || {}; if (st === 'post' && plays.length) { const l = plays[plays.length - 1]; if (l.type.text === 'End Period') l.type.text = 'End Game' }
  return { src: 'StatMuse', header: header(H, A, gd.homeTeam.score ?? prevH, gd.awayTeam.score ?? prevA, st, lp.period || 1, pad(lp.clock || (lp.type === 'endPeriod' ? '0:00' : '12:00')), gd.gameTimestamp), boxscore: box(ath), plays, winprobability: [], gameInfo: { venue: { fullName: (gd.venue && gd.venue.name) || '' } } };
}

/* ---------- text plays (Yahoo, CBS): turn sentences into ESPN-style plays ---------- */
// rows: [{per, clock, team:'home'|'away'|null, text, hs, as, x, y}]. Row team is the team of the player doing the thing.
// Neither feed lists substitutions, so the result carries noSubs and the live page hides lineups.
const TOK = "(?:[A-Z]\\.(?:[A-Z]\\.)?|[A-Z][A-Za-z'\\-]+)";
const NM = '(' + TOK + "(?: (?:" + TOK + "|de|da|van|von|le|la|Jr\\.|Sr\\.|II|III|IV))*)";
const RX = s => new RegExp(s.replace(/NM/g, NM));
const poss = n => n && n.replace(/'s$/, '');
const ORD = { first: 1, second: 2, third: 3 };
const NICKS = Object.values(TEAMS).map(t => t[2].toLowerCase());
const isTeamWord = n => !n || NICKS.includes(n.toLowerCase()) || /^team$/i.test(n) || Object.values(TEAMS).some(t => t[3].toLowerCase() === n.toLowerCase());
function parseText(t) {
  let m;
  const assist = (t.match(RX(' assisted by NM$')) || t.match(RX('\\(NM assists\\)')) || [])[1];
  if ((m = t.match(RX('^(?:[Jj]ump ball\\. )?NM vs\\.? NM')))) return { k: 'jump', a: m[1], b: m[2] };
  if ((m = t.match(RX("^NM blocks NM (two|three) point (.+)$")))) return { k: 'shot', a: poss(m[2]), made: false, three: m[3] === 'three', desc: m[4], blk: m[1], fromBlk: true };
  if ((m = t.match(RX('^NM (makes|misses|hits) (?:regular |technical |flagrant |clear path |away from play )?free throw (\\d) of (\\d)')))) return { k: 'ft', a: m[1], made: m[2] !== 'misses', n: +m[3], of: +m[4], tech: /technical/i.test(t) };
  if ((m = t.match(RX('^NM (hits|makes|misses) (?:the (first|second|third)|a) (technical )?free throw')))) return { k: 'ft', a: m[1], made: m[2] !== 'misses', n: m[3] ? ORD[m[3]] : 1, of: m[3] ? 0 : 1, tech: !!m[4] };
  if ((m = t.match(RX('^NM (offensive|defensive) (?:team )?rebound')) || t.match(/^(\S+) (offensive|defensive) (?:team )?rebound/))) return { k: 'reb', a: isTeamWord(m[1]) ? null : m[1], off: m[2] === 'offensive' };
  if (/^team rebound/i.test(t)) return { k: 'reb', a: null, off: null };
  if ((m = t.match(RX('^NM steals the ball from NM')))) return { k: 'stl', a: m[1], b: m[2] };
  if ((m = t.match(RX('^NM turnover(?: \\(([^)]*)\\))?(?: \\(NM steals\\))?')) || t.match(/^(\S+) turnover(?: \(([^)]*)\))?/))) return { k: 'tov', a: isTeamWord(m[1]) ? null : m[1], why: m[2] || '', stl: m[3] };
  if ((m = t.match(RX('^Turnover: ([^]*?)(?: on NM)?$')))) return { k: 'tov', a: m[2] || null, why: /turnover/i.test(m[1]) ? '' : m[1] };
  if ((m = t.match(RX('^Bad pass by NM')))) return { k: 'tov', a: m[1], why: 'bad pass' };
  if ((m = t.match(RX('^NM goes out of bounds')))) return { k: 'tov', a: m[1], why: 'out of bounds lost ball' };
  if ((m = t.match(RX('^((?:[Rr]unning |[Dd]riving |[Cc]utting |[Rr]everse |[Aa]lley-oop |[Tt]ip |[Pp]utback )*(?:[Ll]ayup|[Dd]unk)) by NM')))) return { k: 'shot', a: m[2], made: true, three: false, desc: m[1], ast: assist };
  if ((m = t.match(RX('^NM (makes|misses|hits|dunks|drives to the hoop) ?(.*)$')) || t.match(/^(\S+) (misses|makes) (.*)$/)) && !/foul|free throw|rebound|turnover|violation|timeout/i.test(m[3])) {
    const made = m[2] !== 'misses'; const blk = (t.match(RX(' blocked by NM')) || [])[1];
    return { k: 'shot', a: isTeamWord(m[1]) ? null : m[1], made, three: /three/i.test(m[3]), dist: +((m[3].match(/(\d+)-foot/) || [])[1] || 0) || null, desc: m[2] === 'dunks' ? 'dunk' : m[2].startsWith('drives') ? 'driving layup' : m[3], ast: made ? assist : null, blk: made ? null : blk };
  }
  if (/foul/i.test(t) && !/free throw/i.test(t.replace(/to shoot \d free throws?/i, ''))) {
    const kind = /shooting/i.test(t) ? 'Shooting Foul' : /offensive|charge/i.test(t) ? 'Offensive Foul' : /loose ball/i.test(t) ? 'Loose Ball Foul' : /technical|three second|delay of game/i.test(t) ? 'Technical Foul' : /flagrant/i.test(t) ? 'Flagrant Foul Type 1' : /take/i.test(t) ? 'Personal Take Foul' : 'Personal Foul';
    const a = (t.match(RX('^NM (?:personal|shooting|offensive|loose ball|technical|flagrant|away|clear|transition|take)')) || t.match(RX(' foul on NM')) || [])[1];
    const drawn = (t.match(RX('\\(NM draws the foul\\)')) || t.match(RX('\\. NM to shoot')) || [])[1]; const shoot = +((t.match(/to shoot (\d)/) || [])[1] || 0);
    return { k: 'foul', a: isTeamWord(a) ? null : a, b: drawn, type: kind, shoot };
  }
  if (/timeout/i.test(t)) return { k: 'to', official: /official/i.test(t) };
  if (/^end of/i.test(t)) return { k: 'end' };
  return { k: 'other' };
}
const shotType = (desc, three) => {
  const d = String(desc || '').toLowerCase(); const kind = /dunk/.test(d) ? 'Dunk Shot' : /layup|finger roll/.test(d) ? 'Layup Shot' : /hook/.test(d) ? 'Hook Shot' : 'Jump Shot';
  const mods = [['alley', 'Alley Oop'], ['putback', 'Putback'], ['cutting', 'Cutting'], ['driving|drives', 'Driving'], ['running', 'Running'], ['turnaround', 'Turnaround'], ['fade', 'Fade Away'], ['pullup|pull-up', 'Pullup'], ['step ?back', 'Step Back'], ['float', 'Floating'], ['finger roll', 'Finger Roll'], ['reverse', 'Reverse'], ['bank', 'Bank']].filter(([r]) => new RegExp(r).test(d)).map(x => x[1]);
  if (/\btip\b/.test(d) && kind !== 'Dunk Shot') return 'Tip Shot';
  return [...mods, kind].join(' ');
};
export function fromText(src, H, A, rows, st, date, score) {
  const tid = { home: String(TEAMS[H][0]), away: String(TEAMS[A][0]) }; const other = s => s === 'home' ? 'away' : s === 'away' ? 'home' : null;
  let P = rows.map(r => Object.assign(parseText(r.text.replace(/\s+/g, ' ').trim()), { r }));
  // CBS writes a block as its own row next to the miss: fold the blocker into the miss
  P.forEach((p, i) => { if (!p.fromBlk) return; for (let j = Math.max(0, i - 3); j <= Math.min(P.length - 1, i + 3); j++) { const q = P[j]; if (j !== i && q.k === 'shot' && !q.made && !q.fromBlk && !q.skip && q.r.per === p.r.per && q.r.clock === p.r.clock && (!q.a || q.a === p.a)) { q.blk = p.blk; q.a = q.a || p.a; if (!q.a) q.r.team = null; p.skip = true; break } } });
  P = P.filter(p => !p.skip);
  // which team each player is on: votes from what the row says, then from assists, blocks, steals and fouls drawn
  const votes = {}; const vote = (n, side, w = 1) => { if (!n || !side) return; const v = votes[n] = votes[n] || { home: 0, away: 0 }; v[side] += w };
  P.forEach(p => { const s = p.r.team; if (!s) return; if (p.fromBlk) { vote(p.blk, s, 2); vote(p.a, other(s)) } else vote(p.a, s, 2) });
  const sideOf = n => { const v = votes[n]; return v ? (v.home > v.away ? 'home' : v.away > v.home ? 'away' : null) : null };
  P.forEach(p => { const s = sideOf(p.a); if (!s) return; if (p.ast) vote(p.ast, s); if (p.blk && !p.fromBlk) vote(p.blk, other(s)); if (p.k === 'stl') vote(p.b, other(s)); if (p.k === 'foul') vote(p.b, other(s)); if (p.stl) vote(p.stl, other(s)) });
  const ids = {}, roster = { home: [], away: [] }; const pid = n => { if (!n) return null; if (!ids[n]) { ids[n] = src.slice(0, 2).toLowerCase() + Object.keys(ids).length; const s = sideOf(n); if (s) roster[s].push(n) } return ids[n] };
  const plays = []; let hs = 0, as = 0, lastMiss = null, toShoot = {}; const key = r => r.per + '|' + r.clock;
  P.forEach((p, i) => {
    const r = p.r; const side = (p.a && sideOf(p.a)) || (p.fromBlk ? other(r.team) : r.team); const team = side ? tid[side] : undefined;
    const base = { id: src.slice(0, 2).toLowerCase() + 'p' + i, type: { text: 'Other' }, text: r.text, period: { number: r.per }, clock: { displayValue: pad(r.clock) }, team: team ? { id: team } : undefined, participants: [], scoringPlay: false, scoreValue: 0, shootingPlay: false, pointsAttempted: 0 };
    const who = (...ns) => { base.participants = ns.filter(Boolean).map(n => ({ athlete: { id: pid(n) } })) };
    if (p.k === 'shot') {
      const v = p.three ? 3 : 2; const ty = shotType(p.desc, p.three);
      who(p.a, p.made ? p.ast : p.blk);
      base.text = p.blk && !p.made ? p.blk + ' blocks ' + p.a + "'s " + (p.three ? 'three' : 'two') + ' point shot' : (p.a || 'Team') + (p.made ? ' makes ' : ' misses ') + (p.dist ? p.dist + '-foot ' : '') + (p.three ? 'three point ' : 'two point ') + ty.toLowerCase() + (p.made && p.ast ? ' (' + p.ast + ' assists)' : '');
      Object.assign(base, { type: { text: ty }, shootingPlay: true, pointsAttempted: v, scoringPlay: p.made, scoreValue: p.made ? v : 0 });
      if (r.x != null) base.coordinate = { x: r.x, y: r.y };
      if (!p.made) lastMiss = side;
    } else if (p.k === 'ft') {
      const of = p.of || toShoot[key(r)] || Math.max(p.n, 2); who(p.a);
      Object.assign(base, { type: { text: p.tech ? 'Free Throw - Technical' : 'Free Throw - ' + p.n + ' of ' + of }, text: p.a + (p.made ? ' makes' : ' misses') + ' free throw ' + p.n + ' of ' + of, shootingPlay: true, pointsAttempted: 1, scoringPlay: p.made, scoreValue: p.made ? 1 : 0 });
      if (!p.made && p.n === of) lastMiss = side;
    } else if (p.k === 'reb') {
      const s = side || null; const off = p.off == null ? (lastMiss && s ? lastMiss === s : lastMiss ? false : false) : p.off;
      let rs = s; if (!rs && p.off == null && lastMiss) rs = other(lastMiss); // "Team rebound" with no side: assume the defense
      if (!base.team && rs) base.team = { id: tid[rs] };
      who(p.a); base.type = { text: off ? 'Offensive Rebound' : 'Defensive Rebound' }; base.text = (p.a || 'Team') + (off ? ' offensive' : ' defensive') + ' rebound';
    } else if (p.k === 'tov' || p.k === 'stl') {
      const vic = p.k === 'stl' ? p.b : p.a, thief = p.k === 'stl' ? p.a : p.stl; const vs = vic ? sideOf(vic) : p.k === 'stl' ? other(side) : side;
      // one turnover per player per moment: a steal row and a turnover row describe the same play
      const prev = plays.find(q => q._tov && q.period.number === r.per && q.clock.displayValue === pad(r.clock) && (p.k === 'stl' ? !q._thief : q._stl && !q._vic || q._vic === vic && !!vic) && q.team && vs && q.team.id === tid[vs]);
      if (prev) { if (thief && !prev._thief) { prev._thief = thief; prev.participants.push({ athlete: { id: pid(thief) } }); prev.text += ' (' + thief + ' steals)' } if (vic && !prev._vic) { prev._vic = vic; prev.participants.unshift({ athlete: { id: pid(vic) } }) } return }
      const why = (p.why || (thief ? 'lost ball' : '')).toLowerCase();
      const ty = /shot clock/.test(why) ? 'Shot Clock Turnover' : /travel/.test(why) ? 'Traveling' : /offensive foul|charge/.test(why) ? 'Offensive Foul Turnover' : /bad pass/.test(why) ? 'Bad Pass Turnover' : /lost ball|out of bounds/.test(why) ? 'Lost Ball Turnover' : /3 sec|three sec/.test(why) ? '3-Second Turnover' : 'Turnover';
      Object.assign(base, { _tov: 1, _vic: vic, _thief: thief, _stl: p.k === 'stl', type: { text: ty }, text: (vic || 'Team') + ' ' + (why || 'turnover') + (thief ? ' (' + thief + ' steals)' : ''), team: vs ? { id: tid[vs] } : base.team }); who(vic, thief);
    } else if (p.k === 'foul') { if (p.shoot) toShoot[key(r)] = p.shoot; who(p.a, p.b); base.type = { text: p.type }; base.text = (p.a || 'Team') + ' ' + p.type.toLowerCase() + (p.b ? ' (' + p.b + ' draws the foul)' : '') }
    else if (p.k === 'jump') { who(p.a, p.b); base.type = { text: 'Jumpball' } }
    else if (p.k === 'to') base.type = { text: p.official ? 'Official Timeout' : 'Full Timeout' };
    else if (p.k === 'end') { base.type = { text: 'End Period' }; base.clock = { displayValue: '0:00' } }
    if (base.scoringPlay) { if (side === 'home') hs += base.scoreValue; else as += base.scoreValue }
    if (r.hs != null && r.as != null) { hs = r.hs; as = r.as }
    base.homeScore = hs; base.awayScore = as; plays.push(base);
  });
  const out = []; plays.forEach((p, i) => { delete p._tov; delete p._vic; delete p._thief; delete p._stl; const nx = plays[i + 1]; out.push(p); if (nx && nx.period.number > p.period.number && p.type.text !== 'End Period') out.push(Object.assign({}, p, { id: p.id + 'e', type: { text: 'End Period' }, text: 'End of period', participants: [], clock: { displayValue: '0:00' }, scoringPlay: false, scoreValue: 0, shootingPlay: false, pointsAttempted: 0, coordinate: undefined })) });
  if (st === 'post') { const l = out[out.length - 1]; if (l && l.type.text === 'End Period') l.type.text = 'End Game'; else if (l) out.push(Object.assign({}, l, { id: l.id + 'g', type: { text: 'End Game' }, participants: [], scoringPlay: false, scoreValue: 0, shootingPlay: false, coordinate: undefined })) }
  const ath = ['home', 'away'].map(s => ({ id: tid[s], ath: roster[s].map(n => ({ id: ids[n], name: n, short: short(n) })) }));
  const lp = out[out.length - 1] || { period: { number: 1 }, clock: { displayValue: '12:00' } };
  return { src, noSubs: true, header: header(H, A, score ? score[0] : lp.homeScore ?? 0, score ? score[1] : lp.awayScore ?? 0, st, lp.period.number, lp.clock.displayValue, date), boxscore: box(ath), plays: out, winprobability: [], gameInfo: { venue: { fullName: '' } } };
}

/* ---------- Yahoo ---------- */
export function yahooRows(html) {
  // shot chart markers carry period, team side and location; the play list carries every play by quarter
  const shots = {}; for (const m of html.matchAll(/<[a-z]+ [^>]*?--ys-x-offset-percent:([\d.]+);--ys-y-offset-percent:([\d.]+)"[^>]*?period="(\d+)"[^>]*?teamKey="(home|away)"[^>]*?aria-label="([\d:.]+) - [^"]*? - ([^"]*)"/g)) shots[m[3] + '|' + m[5] + '|' + dec(m[6])] = [+m[1], +m[2], m[4]];
  const rows = []; let per = 1;
  const re = /(?:>(1st|2nd|3rd|4th|\d(?:st|nd|rd|th)? ?OT|OT\d?|First|Second|Third|Fourth) (?:Quarter|Period|Overtime)<)|(?:alt="([^"]+?) logo"[\s\S]{0,600}?<span[^>]*>(\d{1,2}:\d\d(?:\.\d)?)<\/span>[\s\S]{0,200}?<span[^>]*>([^<]{4,200})<\/span>)/g;
  for (const m of html.matchAll(re)) {
    if (m[1]) { const q = m[1].toLowerCase(); per = /ot/.test(q) ? 4 + (+(q.match(/\d/) || [1])[0]) : { '1st': 1, first: 1, '2nd': 2, second: 2, '3rd': 3, third: 3, '4th': 4, fourth: 4 }[q] || per; continue }
    rows.push({ per, clock: m[3], teamName: dec(m[2]), text: dec(m[4]) });
  }
  return { rows, shots };
}

/* ---------- CBS ---------- */
export function cbsRows(html) {
  const rows = []; let per = 0;
  const re = /(?:>\s*(1st|2nd|3rd|4th|\d(?:st|nd|rd|th)? ?OT|OT\d?)\s+(?:Quarter|Overtime)\s*<)|<tr[^>]*>([\s\S]*?)<\/tr>/g;
  for (const m of html.matchAll(re)) {
    if (m[1]) { const q = m[1].toLowerCase(); per = /ot/.test(q) ? 4 + (+(q.match(/\d/) || [1])[0]) : +q[0]; continue }
    const cells = [...m[2].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(c => dec(c[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim());
    const logo = (m[2].match(/teams\/([A-Z]{2,4})\//) || [])[1];
    if (cells.length < 2 || !/^\d{1,2}:\d\d/.test(cells[0])) continue;
    const text = cells.find(c => / [a-z]/.test(c) && c.length > 8) || ''; const sc = cells.find(c => /^\d+-\d+$/.test(c));
    rows.push({ per, clock: cells[0], text, team: logo || null, score: sc || null });
  }
  return rows;
}
