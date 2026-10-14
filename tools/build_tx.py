"""Turn data/tx-raw.txt (compact RealGM export) into data/transactions.json for the Transactions page."""
import json, re, pathlib
ROOT = pathlib.Path(__file__).resolve().parent.parent
TEAMS = {'Atlanta Hawks':'ATL','Boston Celtics':'BOS','Brooklyn Nets':'BKN','Charlotte Hornets':'CHA','Chicago Bulls':'CHI','Dallas Mavericks':'DAL','Denver Nuggets':'DEN','Detroit Pistons':'DET','Golden State Warriors':'GSW','Houston Rockets':'HOU','Indiana Pacers':'IND','Los Angeles Clippers':'LAC','Los Angeles Lakers':'LAL','Memphis Grizzlies':'MEM','Miami Heat':'MIA','Milwaukee Bucks':'MIL','Minnesota Timberwolves':'MIN','New Orleans Pelicans':'NOP','New York Knicks':'NYK','Oklahoma City Thunder':'OKC','Orlando Magic':'ORL','Philadelphia Sixers':'PHI','Phoenix Suns':'PHX','Portland Trail Blazers':'POR','Sacramento Kings':'SAC','San Antonio Spurs':'SAS','Toronto Raptors':'TOR','Utah Jazz':'UTA','Washington Wizards':'WAS'}
OWN = {'BRK':'BKN','UTH':'UTA','SAN':'SAS','GOS':'GSW','PHL':'PHI','PHO':'PHX','NOR':'NOP','CHA':'CHA'}
def asset(a):
    a = a.strip().rstrip('.')
    a = re.sub(r'^(a|an|and)\s+', '', a)
    if a in ('TPE', 'a TPE'): return 'Trade exception'
    if a == 'multiple TPEs': return 'Trade exceptions'
    if a == 'cash': return 'Cash'
    m = re.match(r'(conditional )?(LF )?(\d{4}) (1st|2nd) rd(?: \((\w+) own\))?$', a)
    if m:
        cond, lf, yr, rd, own = m.groups()
        s = f'{yr} {rd}'
        if own: s += ' (own)' if own == 'CLE' else f' ({OWN.get(own, own)})'
        if lf: s += ' (least favorable)'
        if cond: s += ', protected'
        return s
    m = re.match(r'Swap (\d{4}) (1st|2nd) rds$', a)
    if m: return f'{m.group(1)} {m.group(2)}-round swap'
    a = re.sub(r'^the draft rights to ', 'Rights to ', a, flags=re.I)
    a = re.sub(r' Jr$', ' Jr.', a)
    return a
def split_assets(s):
    s = s.strip().rstrip('.')
    s = s.replace(', Jr.', ' Jr.').replace(', Jr', ' Jr.')
    parts = re.split(r',\s*|\s+and\s+(?=(?:a |an |the |cash|multiple|[A-Z]))', s)
    return [asset(p) for p in parts if p.strip()]
def team_of(s):
    m = re.search(r'the ([A-Z][\w.]+(?: [A-Z][\w.]+)*?)(?= from| for|$)', s)
    return TEAMS.get(m.group(1), m.group(1)) if m else None
def sentences(t):
    t = t.replace('Jr.', 'Jr§')
    out = [x.replace('Jr§', 'Jr.') for x in re.split(r'(?<=\.)\s+(?=[A-Z])', t)]
    return out
def parse_trade(t):
    got, sent, partners = [], [], []
    for s in sentences(t):
        if '->' not in s: continue
        left, right = s.split('->', 1)
        right = right.strip()
        m = re.match(r'CLE from the (.+?) for:? (.+)$', right)
        if m:
            partners.append(TEAMS.get(m.group(1), m.group(1))); got += split_assets(left); sent += split_assets(m.group(2)); continue
        m = re.match(r'the (.+?) from CLE for:? (.+)$', right)
        if m:
            partners.append(TEAMS.get(m.group(1), m.group(1))); sent += split_assets(left); got += split_assets(m.group(2)); continue
        m = re.match(r'CLE for:? (.+)$', right)
        if m:
            got += split_assets(left); sent += split_assets(m.group(1)); continue
        m = re.match(r'the (.+?) for', right)
        if m: partners.append(TEAMS.get(m.group(1), m.group(1)))
    seen = []
    [seen.append(p) for p in partners if p not in seen]
    return got, sent, seen
rows = []
for line in (ROOT / 'data/tx-raw.txt').read_text().splitlines():
    if not line.strip(): continue
    ds, rest = line.split(' ', 1)
    d = f'20{ds[:2]}-{ds[2:4]}-{ds[4:]}'
    tag = None
    m = re.match(r'\[([^\]]+)\]\s*(.*)$', rest)
    if m: tag, rest = m.group(1), m.group(2)
    r = {'d': d}
    if '->' in rest:
        got, sent, partners = parse_trade(rest)
        r.update(k='trade', got=got, sent=sent, with_=partners)
        if tag == 'Trade Deadline': r['note'] = 'Trade deadline'
    elif (m := re.match(r'CLE selected (.+) in Round (\d) with Pick (\d+) in the (\d{4}) NBA Draft', rest)):
        rd, pk = int(m.group(2)), int(m.group(3)); overall = pk if rd == 1 else 30 + pk
        r.update(k='draft', p=m.group(1), t=f'Drafted {m.group(1)}, No. {overall} overall ({"1st" if rd==1 else "2nd"} round)')
    elif rest.endswith('~SM'): r.update(k='sign', p=rest[:-4], t=f'Signed {rest[:-4]} to a multi-year deal', big=1)
    elif rest.endswith('~S2W'): r.update(k='twoway', p=rest[:-5], t=f'Signed {rest[:-5]} to a two-way deal')
    elif rest.endswith('~E2W'): r.update(k='twoway', p=rest[:-5], t=f'Ended {rest[:-5]}’s two-way deal')
    elif rest.endswith('~S'): r.update(k='sign', p=rest[:-3], t=f'Signed {rest[:-3]}')
    elif rest.endswith('~W'): r.update(k='waive', p=rest[:-3], t=f'Waived {rest[:-3]}')
    elif rest.endswith('~FA'): r.update(k='fa', p=rest[:-4], t=f'{rest[:-4]} became a free agent')
    elif (m := re.match(r'(.+) signed a (veteran|rookie scale) extension with CLE', rest)): r.update(k='ext', p=m.group(1), t=f'Signed {m.group(1)} to a {m.group(2)} extension')
    elif (m := re.match(r'CLE exercised their Team Option to extend the contract of (.+?)\.?\.$', rest)): r.update(k='option', p=m.group(1), t=f'Picked up {m.group(1)}’s team option')
    elif (m := re.match(r'(.+) exercised a Player Option', rest)): r.update(k='option', p=m.group(1), t=f'{m.group(1)} picked up his player option')
    elif (m := re.match(r'CLE tendered a Qualifying Offer to make (.+) a Restricted FA', rest)): r.update(k='option', p=m.group(1), t=f'Extended a qualifying offer to {m.group(1)} (restricted free agent)')
    elif (m := re.match(r'CLE renounced their free-agent exception rights to (.+)\.', rest)): r.update(k='other', p=m.group(1), t=f'Renounced cap hold for {m.group(1)}')
    elif (m := re.match(r'CLE made a successful waiver claim for the contract of (.+)\.', rest)): r.update(k='sign', p=m.group(1), t=f'Claimed {m.group(1)} off waivers')
    elif (m := re.match(r'CLE terminated the 10 day contract for (.+)\.', rest)): r.update(k='waive', p=m.group(1), t=f'Ended {m.group(1)}’s 10-day contract')
    elif (m := re.match(r'CLE converted (.+) to a Two-Way contract', rest)): r.update(k='twoway', p=m.group(1), t=f'Converted {m.group(1)} to a two-way deal')
    elif (m := re.match(r'(.+) signed a multi-year offer sheet with CLE', rest)): r.update(k='sign', p=m.group(1), t=f'Signed {m.group(1)} to an offer sheet (restricted free agent)', big=1)
    elif (m := re.match(r'(.+) signed a multi-year contract with the (.+) as part of an eventual sign and trade', rest)): r.update(k='sign', p=m.group(1), t=f'{m.group(1)} signed with {TEAMS.get(m.group(2), m.group(2))} as part of a sign-and-trade to Cleveland')
    else: r.update(k='other', t=rest)
    if tag and 'Draft' in tag and r['k'] != 'draft': r['note'] = tag
    rows.append(r)
# drop "became a free agent" entries that only restate a waiver (they add nothing); keep July 1 free agency
rows = [r for r in rows if not (r['k']=='fa' and not r['d'].endswith('-07-01') and r['d'][5:7] not in ('07','08'))]
for r in rows:
    if 'with_' in r: r['w'] = r.pop('with_')
rows.sort(key=lambda r: r['d'], reverse=True)
(ROOT / 'data/transactions.json').write_text(json.dumps(rows, ensure_ascii=False, separators=(',', ':')))
from collections import Counter
print(len(rows), Counter(r['k'] for r in rows))
for r in rows:
    if r['k']=='trade': print(r['d'], r.get('w'), '| GOT', r['got'], '| SENT', r['sent'])
for r in rows:
    if r['k']=='other': print('OTHER', r)
