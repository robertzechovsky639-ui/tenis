#!/usr/bin/env python3
"""Veřejný (bezklíčový) feed Flashscore: rozpis a výsledky tenisu všech úrovní (ATP/WTA, Challenger,
WTA 125, ITF, kvalifikace) za posledních 7 dní až +2 dny. Stejný parser je v web/app.js (živě v prohlížeči)."""
import re, json, os, time, datetime, urllib.request, unicodedata
FEED = 'https://global.flashscore.ninja/2/x/feed/f_2_{d}_2_en_1'
HDR = {'x-fsign': 'SW9D1eZo', 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://www.flashscore.com/'}
SLAMS = ['australian open', 'french open', 'roland garros', 'wimbledon', 'us open']
M1000 = ['indian wells', 'miami', 'monte carlo', 'madrid', 'rome', 'montreal', 'toronto', 'cincinnati', 'shanghai', 'paris',
         'doha', 'dubai', 'beijing', 'wuhan']
SURF = {'hard': 'Hard', 'clay': 'Clay', 'grass': 'Grass', 'carpet': 'Carpet'}

def classify(h):
    """Z hlavičky turnaje odvodí pohlaví, úroveň, kvalifikaci, povrch. None = přeskočit (čtyřhra, exhibice, junioři...)."""
    m = re.match(r'^(.*?) - (SINGLES|DOUBLES|MIXED DOUBLES|TEAMS.*?): (.*)$', h)
    if not m:
        return None
    cat, kind, rest = m.group(1).strip(), m.group(2), m.group(3)
    if kind != 'SINGLES': return None
    sm = re.search(r',\s*([a-z]+)(?:\s*\(indoor\))?\s*$', rest)
    surface = SURF.get(sm.group(1), 'Hard') if sm else 'Hard'
    tname = re.sub(r',\s*[a-z]+(\s*\(indoor\))?\s*$', '', rest)
    q = 1 if ' - Qualification' in tname else 0
    tname = tname.replace(' - Qualification', '')
    tl = tname.lower()
    if cat in ('ATP', 'WTA'):
        g = 'M' if cat == 'ATP' else 'W'
        if any(s in tl for s in SLAMS): lvl, code = 'G', 6
        elif 'finals' in tl: lvl, code = 'F', 5
        elif any(s in tl for s in M1000) and not (g == 'M' and any(s in tl for s in ['doha', 'dubai', 'beijing', 'wuhan'])) and \
                not (g == 'W' and any(s in tl for s in ['monte carlo', 'shanghai', 'paris'])): lvl, code = 'M', 5
        else: lvl, code = 'A', 4
    elif cat in ('CHALLENGER MEN', 'CHALLENGER WOMEN'):
        g = 'M' if cat.endswith('MEN') and not cat.endswith('WOMEN') else 'W'; lvl, code = 'CH', 3
    elif cat in ('ITF MEN', 'ITF WOMEN'):
        g = 'W' if cat == 'ITF WOMEN' else 'M'
        pm = re.match(r'^[MW](\d+)', tname)
        p = int(pm.group(1)) if pm else 25
        lvl, code = 'ITF', (0 if p <= 20 else 1 if p <= 40 else 2)
    elif cat in ('DAVIS CUP', 'BILLIE JEAN KING CUP'):
        g = 'M' if cat == 'DAVIS CUP' else 'W'; lvl, code = 'D', 4
    else:
        return None
    return dict(g=g, lvl=lvl, code=code, q=q, surface=surface, tname=tname, cat=cat)

def parse(text):
    out = []; hdr = None
    for rec in text.split('~'):
        f = {}
        for kv in rec.split('¬'):
            if '÷' in kv:
                k, v = kv.split('÷', 1); f[k] = v
        if 'ZA' in f:
            hdr = classify(f['ZA']); continue
        if 'AA' not in f or hdr is None: continue
        sets = []
        for a, b in (('BA', 'BB'), ('BC', 'BD'), ('BE', 'BF'), ('BG', 'BH'), ('BI', 'BJ')):
            if a in f and b in f and f[a] != '' and f[b] != '':
                try: sets.append([int(f[a]), int(f[b])])
                except ValueError: pass
        out.append(dict(id=f['AA'], ts=int(f.get('AD', 0) or 0), st=int(f.get('AB', 0) or 0), det=int(f.get('AC', 0) or 0),
                        win=int(f['AS']) if f.get('AS', '').isdigit() else 0,
                        h=dict(slug=f.get('WU', ''), name=f.get('AE', ''), c=f.get('FU', ''), pid=f.get('JA', '')),
                        a=dict(slug=f.get('WV', ''), name=f.get('AF', ''), c=f.get('FV', ''), pid=f.get('JB', '')), sets=sets, **hdr))
    return out

def fetch_day(d):
    req = urllib.request.Request(FEED.format(d=d), headers=HDR)
    with urllib.request.urlopen(req, timeout=40) as r:
        return r.read().decode('utf-8', 'ignore')

def norm_key(s):
    s = unicodedata.normalize('NFKD', str(s)).encode('ascii', 'ignore').decode().lower()
    toks = re.split(r"[^a-z]+", s)
    return ' '.join(sorted(t for t in toks if t))

def fetch_range(dst, days=range(-7, 3)):
    os.makedirs(dst, exist_ok=True)
    today = datetime.date.today()
    got = {}
    for d in days:
        try:
            ev = parse(fetch_day(d))
        except Exception as e:
            print('flashscore fail', d, e); continue
        date = (today + datetime.timedelta(days=d)).isoformat()
        json.dump(ev, open(os.path.join(dst, f'{date}.json'), 'w'))
        got[date] = len(ev); time.sleep(0.4)
    print('flashscore', got)
    return got

if __name__ == '__main__':
    import sys
    ev = parse(fetch_day(int(sys.argv[1]) if len(sys.argv) > 1 else 0))
    import collections
    print(len(ev), collections.Counter((e['g'], e['lvl'], e['q'], e['st']) for e in ev))
    print(ev[0])

def _toks(s):
    s = unicodedata.normalize('NFKD', str(s)).encode('ascii', 'ignore').decode().lower()
    return [t for t in re.split(r'[^a-z]+', s) if t]

def _fold(t):
    return t.replace('oe', 'o').replace('ue', 'u').replace('ae', 'a')

class Matcher:
    """Párování jmen z Flashscore (slug 'prijmeni-jmeno' + zobrazení 'Prijmeni J.') na naše hráče.
    Stejný algoritmus je ve web/app.js."""
    def __init__(self):
        self.k1 = {}; self.k2 = {}
    def add(self, pid, g, name, rec):
        t = _toks(name)
        if not t: return
        for key in {' '.join(sorted(t)), ' '.join(sorted(_fold(x) for x in t))}:
            self._put(self.k1, (g, key), pid, rec)
        for k in range(1, len(t)):
            sur = ''.join(t[k:])
            for s2 in {sur, _fold(sur)}:
                self._put(self.k2, (g, s2, t[0][0]), pid, rec)
        # i varianta "příjmení první" (asijská jména)
        if len(t) >= 2:
            self._put(self.k2, (g, ''.join(t[:-1]), t[-1][0]), pid, rec - 0.5)
    @staticmethod
    def _put(d, k, pid, rec):
        cur = d.get(k)
        if cur is None or rec > cur[1]: d[k] = (pid, rec)
    def match(self, g, slug, disp):
        t = _toks(slug)
        if t:
            for key in (' '.join(sorted(t)), ' '.join(sorted(_fold(x) for x in t))):
                r = self.k1.get((g, key))
                if r: return r[0]
        m = re.match(r'^(.*?)\s+([A-Za-z])[\w\-]*\.', disp or '')
        if m:
            sur = ''.join(_toks(m.group(1))); ini = m.group(2).lower()
            for s2 in (sur, _fold(sur)):
                r = self.k2.get((g, s2, ini))
                if r: return r[0]
        return None


ODDS = 'https://global.ds.lsapp.eu/odds/pq_graphql?_hash=oce&eventId={id}&projectId=2&geoIpCode=CZ&geoIpSubdivisionCode=CZ10'

def fetch_odds(eid, hpid, apid):
    """Kurzy vítěz zápasu (HOME_AWAY, FULL_TIME) od všech sázkovek -> (průměr domácí, průměr hosté, max d., max h., počet)."""
    req = urllib.request.Request(ODDS.format(id=eid), headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=20) as r:
        d = json.loads(r.read().decode('utf-8'))
    o = ((d.get('data') or {}).get('findOddsByEventId') or {}).get('odds') or []
    hs, as_ = [], []
    for b in o:
        if b.get('bettingType') != 'HOME_AWAY' or b.get('bettingScope') != 'FULL_TIME': continue
        m = {x.get('eventParticipantId'): x.get('value') for x in b.get('odds', []) if x.get('active', True)}
        try:
            h, a = float(m.get(hpid)), float(m.get(apid))
        except (TypeError, ValueError):
            continue
        if h > 1 and a > 1: hs.append(h); as_.append(a)
    if not hs: return None
    return [round(sum(hs) / len(hs), 3), round(sum(as_) / len(as_), 3), max(hs), max(as_), len(hs)]
