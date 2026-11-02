"""Official NBA injury report for the next Cavs game (Nov 1).

The league posts its injury report as a PDF every 15 minutes at
https://ak-static.cms.nba.com/referee/injury/Injury-Report_YYYY-MM-DD_HH_MMAM.pdf (Eastern time). That static file
host is reachable from GitHub's servers (unlike stats.nba.com). This finds the newest report, reads the rows for the
Cavs' next game (both teams) and writes pdata/injury-report.json, only when the rows or filing status change.

When it runs (injury-report.yml fires every 30 minutes; this decides, so most runs exit at once):
  game day: hourly from 10 a.m. ET to tip, plus every run in the last 95 minutes before tip
  day before: once at about 5:30 p.m. ET, after the 5 p.m. filing deadline
FORCE=1 skips the timing check. Needs pdfplumber. Exits 0 on any problem (the page then keeps its fallback list).
"""
import datetime as dt, io, json, os, re, sys, urllib.request
from zoneinfo import ZoneInfo

ET = ZoneInfo('America/New_York')
ROOT = os.path.join(os.path.dirname(__file__), '..')
OUT = os.path.join(ROOT, 'pdata', 'injury-report.json')
BASE = 'https://ak-static.cms.nba.com/referee/injury/Injury-Report_{}.pdf'
TEAMS = {'ATL': 'Atlanta Hawks', 'BOS': 'Boston Celtics', 'BKN': 'Brooklyn Nets', 'CHA': 'Charlotte Hornets', 'CHI': 'Chicago Bulls',
         'CLE': 'Cleveland Cavaliers', 'DAL': 'Dallas Mavericks', 'DEN': 'Denver Nuggets', 'DET': 'Detroit Pistons', 'GSW': 'Golden State Warriors',
         'HOU': 'Houston Rockets', 'IND': 'Indiana Pacers', 'LAC': 'LA Clippers', 'LAL': 'Los Angeles Lakers', 'MEM': 'Memphis Grizzlies',
         'MIA': 'Miami Heat', 'MIL': 'Milwaukee Bucks', 'MIN': 'Minnesota Timberwolves', 'NOP': 'New Orleans Pelicans', 'NYK': 'New York Knicks',
         'OKC': 'Oklahoma City Thunder', 'ORL': 'Orlando Magic', 'PHI': 'Philadelphia 76ers', 'PHX': 'Phoenix Suns', 'POR': 'Portland Trail Blazers',
         'SAC': 'Sacramento Kings', 'SAS': 'San Antonio Spurs', 'TOR': 'Toronto Raptors', 'UTA': 'Utah Jazz', 'WAS': 'Washington Wizards'}
ALIAS = {'GS': 'GSW', 'NO': 'NOP', 'NY': 'NYK', 'SA': 'SAS', 'WSH': 'WAS', 'UTAH': 'UTA', 'PHO': 'PHX', 'BRK': 'BKN'}
key = lambda s: re.sub(r'[^a-z0-9]', '', s.lower())
NAME2AB = {key(v): k for k, v in TEAMS.items()}
NAME2AB[key('Los Angeles Clippers')] = 'LAC'


def log(*a): print('injury-report:', *a, flush=True)


def schedule():
    html = open(os.path.join(ROOT, 'index.html'), encoding='utf8').read()
    m = re.search(r'const SCHEDULE=\[([\s\S]*?)\];\n', html)
    out = []
    for d, o, ha, t in re.findall(r"\['(\d{4}-\d\d-\d\d)','(\w+)','([HA])','(\d{1,2}:\d\d)'", m.group(1) if m else ''):
        h, mi = map(int, t.split(':'))
        tip = dt.datetime.fromisoformat(d).replace(hour=h + 12 if h < 12 else h, minute=mi, tzinfo=ET)   # schedule times are p.m.
        out.append((d, ALIAS.get(o, o), ha, tip))
    return out


def fetch(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (cavsdatabase.com injury report)'})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.read() if r.status == 200 else None
    except Exception:
        return None


def newest(now):
    t = now.replace(minute=now.minute - now.minute % 15, second=0, microsecond=0)
    for _ in range(24):   # look back up to six hours
        stamp = t.strftime('%Y-%m-%d_%I_%M%p')
        b = fetch(BASE.format(stamp))
        if b: return stamp, BASE.format(stamp), b
        t -= dt.timedelta(minutes=15)
    return None, None, None


def parse(pdf_bytes):
    """Rows as dicts: date, matchup, team, player (None for 'not yet submitted'), status, reason."""
    import pdfplumber
    pdf = pdfplumber.open(io.BytesIO(pdf_bytes))
    title, cols = '', None
    rows = []
    for page in pdf.pages:
        words = page.extract_words(x_tolerance=1.5)
        lines = []
        for w in sorted(words, key=lambda w: (w['top'], w['x0'])):
            if lines and abs(lines[-1][0] - w['top']) < 2.5: lines[-1][1].append(w)
            else: lines.append([w['top'], [w]])
        for top, ws in lines:
            txt = ' '.join(w['text'] for w in ws)
            if txt.startswith('Injury Report:'): title = txt.split(':', 1)[1].strip(); continue
            if re.match(r'Page \d+ of \d+', txt): continue
            if 'Matchup' in txt and 'Reason' in txt:
                xs = {w['text']: w['x0'] for w in ws}
                cols = [xs['Game'] - 2, ([w['x0'] for w in ws if w['text'] == 'Game'] + [0])[1] - 2, xs['Matchup'] - 2, xs['Team'] - 2,
                        xs['Player'] - 2, xs['Current'] - 2, xs['Reason'] - 2]
                continue
            if not cols: continue
            cell = [''] * 7
            for w in ws:
                i = max([k for k, x in enumerate(cols) if w['x0'] >= x] or [0])
                cell[i] = (cell[i] + ' ' + w['text']).strip()
            rows.append({'top': top, 'page': page.page_number, 'cell': cell})
    # anchor rows: a player, or a team that hasn't filed; every other line's text belongs to the nearest anchor on its page
    anchors = [r for r in rows if r['cell'][4] or r['cell'][6] == 'NOT YET SUBMITTED']
    for r in anchors: r['parts'] = [[r['cell'][k]] if r['cell'][k] else [] for k in range(7)]
    for r in rows:
        if r in anchors: continue
        same = [a for a in anchors if a['page'] == r['page']]
        if not same: continue
        a = min(same, key=lambda a: (abs(a['top'] - r['top']), a['top'] < r['top']))   # tie goes to the following row
        for k in range(7):
            if r['cell'][k]: a['parts'][k].append((r['top'], r['cell'][k]))
    out, cur = [], {}
    for a in anchors:
        a = dict(a)
        vals = []
        for k in range(7):
            own = a['cell'][k]
            extra = [p for p in a['parts'][k] if isinstance(p, tuple)]
            seq = sorted(extra + ([(a['top'], own)] if own else []))
            vals.append(' '.join(s for _, s in seq).strip())
        for k, f in ((0, 'date'), (1, 'time'), (2, 'matchup'), (3, 'team')):
            if vals[k]: cur[f] = vals[k]
        out.append({'date': cur.get('date'), 'matchup': cur.get('matchup'), 'team': cur.get('team'),
                    'player': vals[4] or None, 'status': vals[5], 'reason': vals[6]})
    return title, out


def name(s):
    parts = [p.strip() for p in s.split(',') if p.strip()]
    if len(parts) >= 2:
        first = parts[-1]; last = ' '.join(parts[:-1])
        last = re.sub(r'\s*\b(Jr\.|Sr\.|II|III|IV)\s*$', lambda m: ' ' + m.group(1), last).replace('  ', ' ')
        m = re.match(r'(.*?)\s+(Jr\.|Sr\.|II|III|IV)$', last)
        return f'{first} {m.group(1)} {m.group(2)}' if m else f'{first} {last}'
    return s


def reason(raw):
    if raw.startswith('G League'):
        return 'G League assignment' if 'Assignment' in raw else 'G League (two-way)' if 'Two-Way' in raw else 'G League'
    s = re.sub(r'^Injury/Illness\s*-\s*', '', raw.strip())
    s = re.sub(r'\s*/\s+', ' / ', s)            # "Right Knee/ Injury Recovery" is a wrapped "Right Knee / Injury Recovery"
    s = re.sub(r'\s+-\s+', ', ', s)
    return s[:1].upper() + s[1:].lower() if s else ''


def main():
    now = dt.datetime.now(ET)
    games = [g for g in schedule() if g[3] > now - dt.timedelta(hours=1)]
    if not games: log('no upcoming game'); return
    d, opp, ha, tip = games[0]
    today, tomorrow = now.date(), now.date() + dt.timedelta(days=1)
    gday = tip.date()
    due = (gday == today and now.hour >= 10 and now < tip and (now.minute < 30 or (tip - now) <= dt.timedelta(minutes=95))) \
        or (gday == tomorrow and now.hour == 17 and now.minute >= 30)
    if os.environ.get('CHECK'): print('due=' + ('1' if due or os.environ.get('FORCE') else '0')); return
    if not due and not os.environ.get('FORCE'):
        log(f'not due (next game {d} {opp}, tip {tip:%H:%M})'); return
    stamp, url, b = newest(now)
    if not b: log('no report found in the last six hours'); return
    title, rows = parse(b)
    want = gday.strftime('%m/%d/%Y')
    teams = {}
    for ab in ('CLE', opp):
        full = key(TEAMS.get(ab, ab))
        mine = [r for r in rows if r['date'] == want and r['team'] and key(r['team']) == full]
        if not mine: teams[ab] = {'filed': None, 'rows': []}; continue   # this report doesn't list the game yet
        if any(r['player'] is None for r in mine): teams[ab] = {'filed': False, 'rows': []}; continue
        teams[ab] = {'filed': True, 'rows': [[name(r['player']), r['status'], reason(r['reason'])] for r in mine]}
    log(title, json.dumps(teams)[:400])
    if not any(t['filed'] is not None for t in teams.values()): log('game not on this report yet'); return
    old = {}
    try: old = json.load(open(OUT))
    except Exception: pass
    if old.get('game', {}).get('date') == d and old.get('teams') == teams:
        log('no change since', old.get('report')); return
    # a team that has filed before but shows 'not yet submitted' in a newer report (rare) keeps its last list
    if old.get('game', {}).get('date') == d:
        for ab, t in teams.items():
            if t['filed'] is not True and (old.get('teams', {}).get(ab) or {}).get('filed'): teams[ab] = old['teams'][ab]
        if old.get('teams') == teams: log('no change since', old.get('report')); return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump({'source': 'Official NBA injury report', 'report': title, 'url': url, 'saved': now.isoformat(timespec='minutes'),
               'game': {'date': d, 'opp': opp, 'home': ha == 'H', 'tip': tip.isoformat(timespec='minutes')}, 'teams': teams},
              open(OUT, 'w'), separators=(',', ':'))
    log('wrote', OUT)


if __name__ == '__main__':
    try: main()
    except Exception as e: log('failed:', repr(e)); sys.exit(0)
