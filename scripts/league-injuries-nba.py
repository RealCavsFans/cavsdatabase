"""League-wide games missed to injury from the official NBA injury report (Nov 20 audit).

The injury box ranks the Cavs' games missed against every team. That rank came from ESPN's daily injury lists, while the
Cavs' own count comes from the official NBA report (pdata/injury-history.json), so the two could disagree. This reads the
official report for every team instead: for each final regular-season game, the last report filed before that game's tip,
and counts a player as having missed the game if he was listed Out for an injury or illness and didn't play (ESPN's box
score of the game says who played). G League assignments, two-way stints, suspensions, personal reasons and "not with
team" aren't injuries and don't count, the same rule the Cavs' own count uses.

Writes pdata/league-injuries-nba.json: {season, source, updated, games: {espnId: {d, tip, t: [ab, ab], out: {ab: [[name, reason]]}, report}},
teams: {ab: {gp, missed, players: {name: games}}}}. Team abbreviations are ESPN's (GS NO NY SA UTAH WSH), like
pdata/league-salaries.json. Games already saved are not read again. Needs pdfplumber. Exits 0 on any problem.
  python3 scripts/league-injuries-nba.py      (league-injuries-nba.yml, early each morning)
"""
import datetime as dt, importlib.util, json, os, re, sys, time, urllib.request
from zoneinfo import ZoneInfo

ROOT = os.path.join(os.path.dirname(__file__), '..')
spec = importlib.util.spec_from_file_location('ir', os.path.join(os.path.dirname(__file__), 'injury-report.py'))
ir = importlib.util.module_from_spec(spec); spec.loader.exec_module(ir)
ET = ZoneInfo('America/New_York')
OUT = os.path.join(ROOT, 'pdata', 'league-injuries-nba.json')
def _season():   # Nov 21: same rule as scripts/season.mjs (turns over Aug 1, Eastern); add a row to _DATES with each new schedule
    _DATES = {'2025-26': '2025-10-21', '2026-27': '2026-10-20'}
    d = dt.datetime.now(ET).date(); y = d.year if d.month >= 8 else d.year - 1; se = f'{y}-{str(y + 1)[2:]}'
    return se, _DATES.get(se, f'{y}-10-01')
SEASON, START = _season()
ESPN = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/'
TO_ESPN = {'GSW': 'GS', 'NOP': 'NO', 'NYK': 'NY', 'SAS': 'SA', 'UTA': 'UTAH', 'WAS': 'WSH'}
NOTINJ = re.compile(r'G League|two-way|assignment|suspen|personal|not with team', re.I)
MAX_NEW = int(os.environ.get('MAX_NEW', '400'))   # games read per run (the first run backfills the season)


def log(*a): print('league-injuries-nba:', *a, flush=True)


def getj(u):
    for i in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(u, headers={'User-Agent': 'Mozilla/5.0 (cavsdatabase.com)'}), timeout=30) as r:
                return json.load(r)
        except Exception as e:
            log('retry', u, repr(e)[:80]); time.sleep(2 + i * 3)
    return None


def nk(s):   # name key: accents, punctuation and suffixes dropped
    import unicodedata
    s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode().lower()
    return ''.join(w for w in re.sub(r'[^a-z\s]', '', s).split() if w not in ('jr', 'sr', 'ii', 'iii', 'iv'))


REPORTS = {}   # stamp -> parsed rows (a report covers every game that day, so one PDF serves several tips)


def report_before(tip):
    t = tip - dt.timedelta(minutes=1)
    t = t.replace(minute=t.minute - t.minute % 15, second=0, microsecond=0)
    for _ in range(24):
        stamp = t.strftime('%Y-%m-%d_%I_%M%p')
        if stamp in REPORTS: return stamp, REPORTS[stamp]
        b = ir.fetch(ir.BASE.format(stamp))
        if b:
            title, rows = ir.parse(b); REPORTS[stamp] = (title, rows); time.sleep(1)
            return stamp, REPORTS[stamp]
        t -= dt.timedelta(minutes=15)
    return None, (None, None)


def main():
    J = {'season': SEASON, 'source': 'Official NBA injury report', 'games': {}}
    try: J.update(json.load(open(OUT)))
    except Exception: pass
    today = dt.datetime.now(ET).date(); new = 0
    d = dt.date.fromisoformat(START)
    while d < today and new < MAX_NEW:
        sb = getj(f'{ESPN}scoreboard?dates={d:%Y%m%d}&seasontype=2')
        for e in (sb or {}).get('events', []):
            c = (e.get('competitions') or [{}])[0]
            if not ((c.get('status') or {}).get('type') or {}).get('completed') or e['id'] in J['games']: continue
            if new >= MAX_NEW: break
            tip = dt.datetime.fromisoformat(e['date'].replace('Z', '+00:00')).astimezone(ET)
            abs_ = [x['team']['abbreviation'] for x in c.get('competitors', [])]
            stamp, (title, rows) = report_before(tip)
            if not rows: log('no report before', e['id'], tip); continue
            want = tip.strftime('%m/%d/%Y')
            summ = getj(f'{ESPN}summary?event={e["id"]}') or {}
            played = {}
            for tb in (summ.get('boxscore') or {}).get('players', []):
                ab = (tb.get('team') or {}).get('abbreviation'); st = (tb.get('statistics') or [{}])[0]
                played[ab] = {nk(a['athlete']['displayName']) for a in st.get('athletes', []) if a.get('athlete') and not a.get('didNotPlay')}
            if not played: log('no box for', e['id']); continue
            out, filed = {}, True
            for ab in abs_:
                site = ir.ALIAS.get(ab, ab); full = ir.key(ir.TEAMS.get(site, site))
                mine = [r for r in rows if r['date'] == want and r['team'] and ir.key(r['team']) == full]
                if any(r['player'] is None for r in mine): filed = False
                out[ab] = [[ir.name(r['player']), ir.reason(r['reason'])] for r in mine
                           if r['player'] and re.match(r'^Out$', r['status'] or '', re.I) and not NOTINJ.search(r['reason'] or '')
                           and nk(ir.name(r['player'])) not in played.get(ab, set())]
            if not filed: log('a team had not filed by', stamp, e['id']); continue
            J['games'][e['id']] = {'d': str(tip.date()), 'tip': tip.isoformat(timespec='minutes'), 't': abs_, 'out': out, 'report': stamp}
            new += 1
        d += dt.timedelta(days=1)
    T = {}
    for g in J['games'].values():
        for ab in g['t']:
            x = T.setdefault(ab, {'gp': 0, 'missed': 0, 'players': {}}); x['gp'] += 1
            for nm, _ in g['out'].get(ab, []): x['missed'] += 1; x['players'][nm] = x['players'].get(nm, 0) + 1
    J['teams'] = dict(sorted(T.items())); J['updated'] = dt.datetime.now(ET).isoformat(timespec='minutes')
    J['games'] = dict(sorted(J['games'].items(), key=lambda kv: (kv[1]['d'], kv[0])))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(J, open(OUT, 'w'), separators=(',', ':'))
    log(f'{new} new games, {len(J["games"])} saved; CLE', T.get('CLE'))


if __name__ == '__main__':
    try: main()
    except Exception as e: log('failed:', repr(e)); sys.exit(0)
