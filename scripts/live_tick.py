#!/usr/bin/env python3
"""Živé učení ze skóre rozehraných zápasů, i když telefon nemá aplikaci otevřenou.

Stejný krok jako learnLive / closeLive ve web/app.js: po gemu (zápas + gem),
po setu (zápas + set + další set) a po dohrání (zápasová hlava, eta M).
ATP, WTA a Challenger. ITF se nešahá. Stromy ani předzápasový krok 0.008 se nemění.
Kurzor a klíče ve state/live_online.json brání druhé aplikaci téhož gemu.
"""
import argparse, datetime, json, os, re, subprocess, sys, time, urllib.request
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import engine, export, fs, live_ml, state_io

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PATH = os.path.join(ROOT, 'state', 'live_online.json')
TZ = ZoneInfo('Europe/Prague')
FEED = 'https://webws.365scores.com/web/games/current/?appTypeId=5&langId=1&timezoneName=Europe%2FPrague&userCountryId=1&sports=3'
C365 = {301: ('M', 3), 302: ('W', 3), 88: ('M', 4), 87: ('W', 4)}
HEADS = ('seen', 'gseen', 'sseen', 'nseen')
ELOG_MAX = 5000

def today_day():
    return (datetime.datetime.now(TZ).date() - datetime.date(1970, 1, 1)).days

def match_day(ts):
    ts = int(ts)
    return ts // 86400 + (1 if (ts % 86400) > 22 * 3600 else 0)

def set_winner(s):
    if not s or len(s) < 2: return 0
    a, b = int(s[0]), int(s[1])
    if a >= 6 and a - b >= 2: return 1
    if b >= 6 and b - a >= 2: return 2
    if a == 7 and b == 6: return 1
    if b == 7 and a == 6: return 2
    if len(s) > 2 and a == 6 and b == 6:
        ta, tb = int(s[2]), int(s[3])
        if ta >= 7 and ta - tb >= 2: return 1
        if tb >= 7 and tb - ta >= 2: return 2
    return 0

def set_done(ga, gb):
    return (ga >= 6 and ga - gb >= 2) or (gb >= 6 and gb - ga >= 2) or (ga == 7 and gb == 6) or (gb == 7 and ga == 6)

def point_tok(x):
    if x is None or x == '': return None
    if isinstance(x, (int, float)) and float(x) == 50: return 4
    t = str(x).strip().upper()
    if t.endswith('.0'): t = t[:-2]
    if t in ('A', 'AD', '50'): return 4
    if t in ('0', '15', '30', '40'): return {'0': 0, '15': 1, '30': 2, '40': 3}[t]
    return None

def hb_of(win_h, srv_h):
    if srv_h is None or not win_h: return {'hold': 0, 'brk': 0}
    if (win_h == 1) == bool(srv_h):
        return {'hold': 1 if win_h == 1 else -1, 'brk': 0}
    return {'hold': 0, 'brk': 1 if win_h == 1 else -1}

def read_live(sets, pts, srv):
    sets = [s for s in (sets or []) if s and len(s) >= 2 and s[0] is not None and s[1] is not None and int(s[0]) >= 0 and int(s[1]) >= 0]
    if not sets and not pts: return None
    rows = list(sets)
    cur = rows.pop() if rows else [0, 0]
    sa = sb = 0
    for s in rows:
        w = set_winner(s)
        if w == 1: sa += 1
        elif w == 2: sb += 1
        elif int(s[0]) > int(s[1]): sa += 1
        elif int(s[1]) > int(s[0]): sb += 1
    wcur = set_winner(cur)
    ga = gb = a_pts = b_pts = 0
    in_tb = False
    if wcur:
        if wcur == 1: sa += 1
        else: sb += 1
    else:
        ga, gb = int(cur[0]), int(cur[1])
        in_tb = ga == 6 and gb == 6
        if not in_tb and pts:
            ia, ib = point_tok(pts[0]), point_tok(pts[1])
            if ia is not None and ib is not None:
                a_pts, b_pts = ia, ib
    a_serves = True if srv == 1 else False if srv == 2 else None
    return dict(sa=sa, sb=sb, ga=ga, gb=gb, aPts=a_pts, bPts=b_pts, inTB=in_tb, aServes=a_serves)

def sig_of(stt):
    return f"{stt['sa']}:{stt['sb']}:{stt['ga']}:{stt['gb']}"

def tour_info(tours, g, name):
    k = ' '.join(fs._toks(re.sub(r'\(.*?\)', '', str(name or ''))))
    if k and tours.get(g + '|' + k): return tours[g + '|' + k]
    return None

def parse_365(data, tours):
    comps = {c.get('id'): c for c in (data.get('competitions') or [])}
    out = []
    for g in (data.get('games') or []):
        try:
            c = comps.get(g.get('competitionId')) or {}
            cat = C365.get(c.get('countryId'))
            if not cat: continue
            H, A = g.get('homeCompetitor') or {}, g.get('awayCompetitor') or {}
            hn, an = str(H.get('name') or ''), str(A.get('name') or '')
            if not hn or not an or '/' in hn + an: continue
            if re.match(r'^(TBD|TBA|Bye)?$', hn, re.I) or re.match(r'^(TBD|TBA|Bye)?$', an, re.I): continue
            txt = str(g.get('statusText') or '')
            if re.search(r'cancel|postpon|walk ?over|w\.o\.|abandon|suspend|delay', txt, re.I): continue
            sg = g.get('statusGroup')
            st = 2 if sg == 3 else 3 if sg == 4 else 0
            if not st: continue
            sets = []
            pts = None
            for x in (g.get('stages') or []):
                sn = str(x.get('shortName') or '')
                if re.match(r'^S\d$', sn):
                    a, b = x.get('homeCompetitorScore'), x.get('awayCompetitorScore')
                    if a is None or b is None or float(a) < 0 or float(b) < 0: continue
                    row = [int(a), int(b)]
                    ea, eb = x.get('homeCompetitorExtraScore'), x.get('awayCompetitorExtraScore')
                    if (ea is not None and float(ea) >= 0) or (eb is not None and float(eb) >= 0):
                        row += [max(0, int(ea or 0)), max(0, int(eb or 0))]
                    sets.append(row)
                elif st == 2 and (re.match(r'^(G|Game|Pts|Points)$', sn, re.I) or re.search(r'game|point', str(x.get('name') or ''), re.I)):
                    if x.get('homeCompetitorScore') is not None and x.get('awayCompetitorScore') is not None:
                        def fmt(v):
                            if float(v) == 50: return 'A'
                            return str(int(v)) if float(v) == int(float(v)) else str(v)
                        pts = [fmt(x['homeCompetitorScore']), fmt(x['awayCompetitorScore'])]
            ret = bool(re.search(r'retir', txt, re.I))
            win = 1 if H.get('isWinner') else 2 if A.get('isWinner') else int(g.get('winner') or 0)
            if win not in (1, 2): win = 0
            if st == 3 and not win:
                m = re.search(r'player (\d) retired', txt, re.I)
                if m: win = 3 - int(m.group(1))
                else:
                    tot = next((x for x in (g.get('stages') or []) if x.get('shortName') == 'Sets'), None)
                    if tot and tot.get('homeCompetitorScore') != tot.get('awayCompetitorScore'):
                        win = 1 if float(tot['homeCompetitorScore']) > float(tot['awayCompetitorScore']) else 2
            if st == 3 and not win: continue
            srv = 1 if H.get('inPossession') else 2 if A.get('inPossession') else 0
            gg, lc = cat
            ti = tour_info(tours, gg, c.get('name') or '') if lc == 4 else None
            code = 3 if lc == 3 else (int(ti[1]) if ti else 4)
            surface = ti[0] if ti else 'Hard'
            ts = g.get('startTime')
            if not ts: continue
            tsv = int(datetime.datetime.fromisoformat(str(ts).replace('Z', '+00:00')).timestamp())
            def disp(nm, url):
                parts = str(nm).strip().split()
                name = f"{parts[-1]} {parts[0][0]}." if len(parts) > 1 else nm
                return {'slug': url or nm, 'name': name, 'full': nm}
            out.append(dict(
                id=str(g.get('id')), ts=tsv, st=st, det=8 if ret else 3, win=win, sets=sets, pts=pts, srv=srv,
                h=disp(hn, H.get('nameForURL')), a=disp(an, A.get('nameForURL')),
                g=gg, code=code, q=1 if re.search(r'qualif', str(g.get('stageName') or ''), re.I) else 0,
                surface=surface, tname=c.get('name') or ''))
        except Exception:
            continue
    return out

def make_x(st, kind, base, sa, sb, ga, gb, srv, hold, brk, p):
    diffs, ctx, sc = base['diffs'], base['ctx'], st['scale']
    if kind in ('G', 'M'):
        return live_ml.phi(sa, sb, ga, gb, 0, 0, 0, 0, False, srv, hold, brk, diffs, ctx, sc, True)
    if kind == 'S':
        return live_ml.phi(sa, sb, 0, 0, 0, 0, 0, 0, False, 0, 0, 0, diffs, ctx, sc, True)
    if kind == 'g':
        return live_ml.phi_game(sa, sb, ga, gb, 0, 0, 0, 0, False, srv, hold, brk, diffs, ctx, sc)
    if kind == 's':
        return live_ml.phi_set(sa, sb, 0, 0, 0, 0, 0, 0, False, 0, 0, 0, diffs, ctx, sc, p)
    if kind == 'sg':
        return live_ml.phi_set(sa, sb, ga, gb, 0, 0, 0, 0, False, srv, hold, brk, diffs, ctx, sc, p)
    if kind == 'n':
        return live_ml.phi_next(sa, sb, ga, gb, 0, 0, 0, 0, False, srv, hold, brk, diffs, ctx, sc, p)
    raise ValueError(kind)

def step_kind(st, kind, x, y, p, mk):
    if kind in ('G', 'S', 'M'):
        return live_ml.step(st, x, y, p, mk, live_ml.ETA[kind])
    if kind == 'g':
        return live_ml.step_game(st, x, y, p, mk)
    if kind in ('s', 'sg'):
        return live_ml.step_set(st, x, y, p, mk)
    if kind == 'n':
        return live_ml.step_next(st, x, y, p, mk)
    return False

def seen_name(kind):
    return {'G': 'seen', 'M': 'seen', 'S': 'seen', 'g': 'gseen', 's': 'sseen', 'sg': 'sseen', 'n': 'nseen'}[kind]

class Learner:
    def __init__(self, st):
        self.st = st
        st.setdefault('tracks', {})
        st.setdefault('elog', [])
        st.setdefault('bases', {})
        self.steps = 0
        self.skipped = 0

    def log(self, kind, mk, y, p, sa, sb, ga, gb, srv, hold, brk, base):
        if self.st.get('_replaying'): return
        ev = dict(k=kind, id=mk, y=float(y), p=float(p), sa=int(sa), sb=int(sb), ga=int(ga), gb=int(gb),
                  srv=float(srv), hold=float(hold), brk=float(brk), base=base, t=time.time())
        el = self.st['elog']
        if any(e.get('id') == mk for e in el[-80:]): return
        el.append(ev)
        if len(el) > ELOG_MAX: self.st['elog'] = el[-ELOG_MAX:]

    def attempt(self, kind, y, p, sa, sb, ga, gb, srv, hold, brk, base_mk, seen_key):
        sk = seen_name(kind)
        if seen_key in (self.st.get(sk) or []): return False
        base = (self.st.get('bases') or {}).get(base_mk)
        if not base: return False
        x = make_x(self.st, kind, base, sa, sb, ga, gb, srv, hold, brk, p)
        ok = step_kind(self.st, kind, x, y, p, seen_key)
        self.log(kind, seen_key, y, p, sa, sb, ga, gb, srv, hold, brk, base_mk)
        if ok: self.steps += 1
        return ok

    def side(self, tr, sa, sb, ga, gb, srv_h, hb):
        """Domácí skóre -> pohled hráče A (menší id). srv_h True/False/None."""
        a = tr['aIsH']
        if srv_h is None: srv = 0
        else:
            s = 1 if srv_h else -1
            srv = s if a else -s
        hold = hb['hold'] if a else -hb['hold']
        brk = hb['brk'] if a else -hb['brk']
        if a: return sa, sb, ga, gb, srv, hold, brk
        return sb, sa, gb, ga, srv, hold, brk

    def on_game(self, tr, prev, win_h, take):
        if not (take and win_h): return
        base = tr['mk']
        p = tr['pA']
        y = 1.0 if ((win_h == 1) == tr['aIsH']) else 0.0
        hb = tr.get('hb') or {'hold': 0, 'brk': 0}
        sa, sb, ga, gb, srv, hold, brk = self.side(tr, prev['sa'], prev['sb'], prev['ga'], prev['gb'], tr.get('gameSrv'), hb)
        self.attempt('G', y, p, sa, sb, ga, gb, srv, hold, brk, base, f"{base}|G|{sa}|{sb}|{ga}|{gb}")
        self.attempt('g', y, p, sa, sb, ga, gb, srv, hold, brk, base, f"{base}|g|{sa}|{sb}|{ga}|{gb}")
        tr['trail'].append(dict(sa=sa, sb=sb, ga=ga, gb=gb, srv=srv, hold=hold, brk=brk, p=p))
        tr['setGames'].append(dict(sa=sa, sb=sb, ga=ga, gb=gb, srv=srv, hold=hold, brk=brk, p=p, start=ga == 0 and gb == 0))
        tr['hb'] = hb_of(win_h, tr.get('gameSrv'))

    def on_set(self, tr, prev, win_h):
        base = tr['mk']
        p = tr['pA']
        y = 1.0 if ((win_h == 1) == tr['aIsH']) else 0.0
        sa, sb, ga, gb, srv, hold, brk = self.side(tr, prev['sa'], prev['sb'], 0, 0, None, {'hold': 0, 'brk': 0})
        self.attempt('S', y, p, sa, sb, 0, 0, 0, 0, 0, base, f"{base}|S|{sa}|{sb}")
        self.attempt('s', y, p, sa, sb, 0, 0, 0, 0, 0, base, f"{base}|s|{sa}|{sb}")
        for g in tr.get('setGames') or []:
            if g.get('start'): continue
            self.attempt('sg', y, g['p'], g['sa'], g['sb'], g['ga'], g['gb'], g['srv'], g['hold'], g['brk'], base,
                         f"{base}|sg|{g['sa']}|{g['sb']}|{g['ga']}|{g['gb']}")
        for g in tr.get('prevNext') or []:
            self.attempt('n', y, g['p'], g['sa'], g['sb'], g['ga'], g['gb'], g['srv'], g['hold'], g['brk'], base,
                         f"{base}|n|{g['sa']}|{g['sb']}|{g['ga']}|{g['gb']}")
        tr['prevNext'] = tr.get('setGames') or []
        tr['setGames'] = []

    def apply_delta(self, tr, stt):
        sig = sig_of(stt)
        if tr['sig'] == sig:
            if tr.get('gameSrv') is None and stt['aPts'] == 0 and stt['bPts'] == 0 and not stt['inTB']:
                tr['gameSrv'] = stt['aServes']
            tr['at'] = time.time()
            return
        prev = tr['live']
        sets_delta = (stt['sa'] + stt['sb']) - (prev['sa'] + prev['sb'])
        same = stt['sa'] == prev['sa'] and stt['sb'] == prev['sb']
        games_delta = (stt['ga'] + stt['gb']) - (prev['ga'] + prev['gb'])
        fresh = stt['ga'] == 0 and stt['gb'] == 0
        game_up = same and games_delta == 1
        set_up = sets_delta == 1 and fresh
        if game_up or set_up:
            win_h = 0
            take = game_up
            if set_up:
                win_h = 1 if stt['sa'] > prev['sa'] else 2
                a_wins = win_h == 1
                nga = prev['ga'] + (1 if a_wins else 0)
                ngb = prev['gb'] + (0 if a_wins else 1)
                take = (not set_done(prev['ga'], prev['gb'])) and set_done(nga, ngb)
            else:
                win_h = 1 if stt['ga'] > prev['ga'] else 2
            self.on_game(tr, prev, win_h, take)
            if set_up:
                self.on_set(tr, prev, 1 if stt['sa'] > prev['sa'] else 2)
        else:
            self.skipped += 1
        boundary = stt['aPts'] == 0 and stt['bPts'] == 0 and not stt['inTB']
        tr['sig'] = sig
        tr['live'] = {k: stt[k] for k in ('sa', 'sb', 'ga', 'gb', 'aPts', 'bPts', 'inTB', 'aServes')}
        tr['gameSrv'] = stt['aServes'] if boundary else None
        tr['at'] = time.time()

    def close(self, tr, win_h):
        if tr.get('closed'): return
        tr['closed'] = True
        if win_h not in (1, 2): return
        y = 1.0 if ((win_h == 1) == tr['aIsH']) else 0.0
        p = tr['pA']
        base = tr['mk']
        for g in tr.get('trail') or []:
            self.attempt('M', y, g['p'], g['sa'], g['sb'], g['ga'], g['gb'], g['srv'], g['hold'], g['brk'], base,
                         f"{base}|M|{g['sa']}|{g['sb']}|{g['ga']}|{g['gb']}")

    def observe(self, mk, a_is_h, pA, diffs, ctx, ev):
        if ev['code'] < 3: return
        base_mk = mk
        self.st['bases'][base_mk] = {'diffs': [float(v) for v in diffs], 'ctx': ctx}
        if ev['det'] == 8:
            self.st['tracks'].pop(mk, None)
            return
        tr = self.st['tracks'].get(mk)
        if ev['st'] == 3:
            if not tr or tr.get('closed'): return
            done_sets = [s for s in ev['sets'] if set_winner(s)]
            if done_sets and len(done_sets) == len(ev['sets']):
                sa = sb = 0
                for s in done_sets:
                    w = set_winner(s)
                    if w == 1: sa += 1
                    else: sb += 1
                self.apply_delta(tr, dict(sa=sa, sb=sb, ga=0, gb=0, aPts=0, bPts=0, inTB=False, aServes=None))
            self.close(tr, ev['win'])
            self.st['tracks'].pop(mk, None)
            return
        if ev['st'] != 2: return
        stt = read_live(ev['sets'], ev['pts'], ev['srv'])
        if not stt: return
        if tr is None:
            boundary = stt['aPts'] == 0 and stt['bPts'] == 0 and not stt['inTB']
            self.st['tracks'][mk] = dict(
                sig=sig_of(stt), live={k: stt[k] for k in ('sa', 'sb', 'ga', 'gb', 'aPts', 'bPts', 'inTB', 'aServes')},
                gameSrv=stt['aServes'] if boundary else None, hb={'hold': 0, 'brk': 0},
                trail=[], setGames=[], prevNext=[], mk=mk, aIsH=bool(a_is_h), pA=float(pA), at=time.time())
            return
        tr['pA'] = float(pA)
        tr['aIsH'] = bool(a_is_h)
        self.apply_delta(tr, stt)

    def prune(self, today):
        now = time.time()
        tracks = self.st.get('tracks') or {}
        for mk, tr in list(tracks.items()):
            if tr.get('closed') or now - float(tr.get('at') or now) > 36 * 3600:
                tracks.pop(mk, None)
        self.st['tracks'] = tracks
        el = []
        for e in self.st.get('elog') or []:
            try:
                day = int(str(e.get('base') or e.get('id') or '0').split('|', 1)[0])
            except ValueError:
                day = today
            if day >= today - 2: el.append(e)
        self.st['elog'] = el[-ELOG_MAX:]
        keep = set(tracks) | {e.get('base') for e in self.st['elog']}
        self.st['bases'] = {k: v for k, v in (self.st.get('bases') or {}).items() if k in keep}

def replay_elog(st, elog, bases):
    """Chybějící kroky z elog na st. Klíč, který už ve seen je, step přeskočí."""
    st['_replaying'] = True
    st['bases'] = dict(bases)
    L = Learner(st)
    n0 = L.steps
    for ev in elog:
        try:
            L.attempt(ev['k'], ev['y'], ev['p'], ev['sa'], ev['sb'], ev['ga'], ev['gb'], ev['srv'], ev['hold'], ev['brk'], ev['base'], ev['id'])
        except Exception:
            continue
    st.pop('_replaying', None)
    return L.steps - n0

def is_super(a, b):
    for k in HEADS:
        if not set(map(str, b.get(k) or [])) <= set(map(str, a.get(k) or [])):
            return False
    return True

def step_count(st):
    return int(st.get('n') or 0) + int(st.get('gn') or 0) + int(st.get('sn') or 0) + int(st.get('nn') or 0)

def merge_states(local, remote):
    """Váhy strany, která už obsahuje kroky druhé, a dohrání elogem toho, co v nich není."""
    if is_super(local, remote) and not is_super(remote, local):
        base = json.loads(json.dumps(local))
        other = remote
    elif is_super(remote, local):
        base = json.loads(json.dumps(remote))
        other = local
    else:
        src = local if step_count(local) >= step_count(remote) else remote
        base = json.loads(json.dumps(src))
        other = remote if src is local else local
    elog, seen = [], set()
    for src in (other, local, remote):
        for ev in src.get('elog') or []:
            i = str(ev.get('id'))
            if i in seen: continue
            seen.add(i)
            elog.append(ev)
    elog.sort(key=lambda e: float(e.get('t') or 0))
    bases = {}
    for src in (other, local, remote, base):
        for k, v in (src.get('bases') or {}).items():
            bases.setdefault(k, v)
    replay_elog(base, elog, bases)
    base['elog'] = elog[-ELOG_MAX:]
    base['bases'] = bases
    tracks = {}
    for src in (base, other, local, remote):
        for mk, tr in (src.get('tracks') or {}).items():
            cur = tracks.get(mk)
            if cur is None or float(tr.get('at') or 0) >= float(cur.get('at') or 0):
                tracks[mk] = tr
    base['tracks'] = tracks
    base.pop('_replaying', None)
    return base

def fetch_feed():
    req = urllib.request.Request(FEED, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=25) as r:
        return json.loads(r.read().decode())

class World:
    def __init__(self):
        t0 = time.time()
        P, H, meta, _tml, tours = state_io.load()
        self.P, self.H, self.meta, self.tours = P, H, meta, tours
        self.pred = export.Predictor()
        self.M = fs.Matcher()
        for pid, p in P.items():
            self.M.add(pid, p.get('g') or 'M', p.get('name') or '', p.get('last') or 0)
        self.today = today_day()
        self.gap = int(meta.get('gap_start') or 0)
        self.cache = {}
        print(f'stav {len(P)} hráčů za {time.time()-t0:.0f}s', flush=True)

    def bundle(self, ev):
        hid = self.M.match(ev['g'], ev['h']['slug'], ev['h']['name']) or self.M.match(ev['g'], ev['h']['full'], ev['h']['name'])
        aid = self.M.match(ev['g'], ev['a']['slug'], ev['a']['name']) or self.M.match(ev['g'], ev['a']['full'], ev['a']['name'])
        if not hid or not aid or hid == aid: return None
        day = match_day(ev['ts'])
        a_is_h = str(hid) < str(aid)
        a, b = (str(hid), str(aid)) if a_is_h else (str(aid), str(hid))
        mk = f'{day}|{a}|{b}'
        if mk in self.cache:
            pA, diffs, ctx = self.cache[mk]
            return mk, a_is_h, pA, diffs, ctx
        A, B = self.P.get(hid), self.P.get(aid)
        if not A or not B: return None
        bo = 5 if ev['code'] == 6 and ev['g'] == 'M' and not ev['q'] else 3
        ctx_f = dict(day=self.today, dayA=export.ref_day(A, self.today, self.gap), dayB=export.ref_day(B, self.today, self.gap),
                     surface=engine.SURF.get(ev['surface'], 0), lvl_code=int(ev['code']), is_qual=1 if ev['q'] else 0, best_of=bo)
        if str(hid) < str(aid):
            hh = self.H.get((str(hid), str(aid)), [0, 0]); h2h = (hh[0], hh[1])
        else:
            hh = self.H.get((str(aid), str(hid)), [0, 0]); h2h = (hh[1], hh[0])
        x = engine.feats(A, B, ctx_f, h2h)
        p_home = float(self.pred.predict(x)[0])
        diffs = [float(v) for v in x[:len(engine.DIFF)]]
        if not a_is_h:
            diffs = [-v for v in diffs]
            pA = 1.0 - p_home
        else:
            pA = p_home
        ctx = live_ml.ctx_of(bo, ev['g'], ev['surface'], ev['q'], ev['code'])
        self.cache[mk] = (pA, diffs, ctx)
        return mk, a_is_h, pA, diffs, ctx

def poll(world, learner):
    data = fetch_feed()
    evs = parse_365(data, world.tours)
    live_n = sum(1 for e in evs if e['st'] == 2 and e['code'] >= 3)
    used = 0
    for ev in evs:
        if ev['code'] < 3: continue
        b = world.bundle(ev)
        if not b:
            continue
        if ev['st'] == 3 and ev['id'] and learner.st['tracks'].get(b[0]) is None and not any(tr.get('mk') == b[0] for tr in learner.st['tracks'].values()):
            # dohraný zápas, který jsme živě nesledovali, nechá dennímu from_sets
            if b[0] not in learner.st['tracks']:
                continue
        used += 1
        learner.observe(*b, ev)
    learner.prune(world.today)
    return dict(feed=len(evs), live=live_n, used=used, steps=learner.steps,
                n=learner.st.get('n'), gn=learner.st.get('gn'), sn=learner.st.get('sn'), nn=learner.st.get('nn'),
                tracks=len(learner.st.get('tracks') or {}))

def commit_push(st):
    if os.environ.get('LIVE_COMMIT') != '1':
        return st
    if not subprocess.run(['git', 'config', 'user.email'], cwd=ROOT, capture_output=True, text=True).stdout.strip():
        subprocess.check_call(['git', 'config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com'], cwd=ROOT)
        subprocess.check_call(['git', 'config', 'user.name', 'github-actions[bot]'], cwd=ROOT)
    msg = f"Živé učení ze skóre {datetime.datetime.now(TZ).strftime('%Y-%m-%d %H:%M %Z')}"
    rel = 'state/live_online.json'
    for attempt in range(4):
        subprocess.check_call(['git', 'fetch', 'origin', 'main'], cwd=ROOT)
        # soubor na disku nesmí blokovat rebase; pravda je v paměti (st)
        subprocess.run(['git', 'checkout', '--', rel], cwd=ROOT, check=False)
        head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
        origin = subprocess.check_output(['git', 'rev-parse', 'origin/main'], cwd=ROOT, text=True).strip()
        if head != origin:
            r = subprocess.run(['git', 'rebase', 'origin/main'], cwd=ROOT)
            if r.returncode != 0:
                subprocess.run(['git', 'rebase', '--abort'], cwd=ROOT)
                porcelain = subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT, text=True)
                extra = [ln for ln in porcelain.splitlines() if rel not in ln and ln.strip()]
                if extra:
                    raise SystemExit('rebase selhal a pracovní strom má i jiné změny: ' + ' '.join(extra[:8]))
                subprocess.check_call(['git', 'reset', '--hard', 'origin/main'], cwd=ROOT)
        remote = json.loads(subprocess.check_output(['git', 'show', 'HEAD:' + rel], cwd=ROOT))
        merged = merge_states(st, remote)
        live_ml.save(PATH, merged)
        st = live_ml.load(PATH)
        subprocess.check_call(['git', 'add', rel], cwd=ROOT)
        if subprocess.run(['git', 'diff', '--cached', '--quiet'], cwd=ROOT).returncode == 0:
            print('commit: beze změn', flush=True)
            return st
        subprocess.check_call(['git', 'commit', '-q', '-m', msg], cwd=ROOT)
        r = subprocess.run(['git', 'push', 'origin', 'HEAD:main'], cwd=ROOT)
        if r.returncode == 0:
            print('commit: push hotov', flush=True)
            return st
        print(f'push odmítnut, pokus {attempt+1}', flush=True)
        subprocess.check_call(['git', 'reset', '--mixed', 'HEAD~1'], cwd=ROOT)
    raise SystemExit('push state/live_online.json se nepovedl')

def self_test():
    st = live_ml.load(PATH)
    # izolovaná kopie, na skutečný soubor se nezapisuje
    st = json.loads(json.dumps(st))
    st['tracks'], st['elog'], st['bases'] = {}, [], {}
    L = Learner(st)
    mk = '20700|a1|b1'
    diffs = [0.1] * len(engine.DIFF)
    ctx = live_ml.ctx_of(3, 'M', 'Hard', 0, 4)
    pA = 0.6
    def ev(sa, sb, ga, gb, stt=2, win=0, det=3, sets=None):
        return dict(code=4, det=det, st=stt, win=win, sets=sets if sets is not None else [[sa and 6 or ga, sb and 4 or gb]],
                    pts=['0', '0'], srv=1)
    # ručně stav, ne přes sets parser: observe používá read_live z sets.
    # Sada: 0:0 -> gem 1:0 -> gem 2:0 -> set 1:0 (6:0 nelze z jednoho gemu).
    # Použijeme apply přes observe s předpřipravenými sets tak, aby read_live dal žádaný stav.
    def feed(rows, pts=('0', '0'), srv=1, status=2, win=0, det=3):
        return dict(code=4, det=det, st=status, win=win, sets=rows, pts=list(pts), srv=srv)
    L.observe(mk, True, pA, diffs, ctx, feed([[0, 0]]))
    n0 = (st['n'], st['gn'], st['sn'], st['nn'], len(st['elog']))
    L.observe(mk, True, pA, diffs, ctx, feed([[1, 0]], pts=('15', '0'), srv=1))
    # první gem z 0:0 nehýbe zápasovou hlavou (příznaky jsou nulové), gemová hlava ano
    assert st['gn'] == n0[1] + 1 and st['n'] == n0[0], (st['gn'], st['n'], n0)
    mid = (st['n'], st['gn'], st['sn'], st['nn'])
    L.observe(mk, True, pA, diffs, ctx, feed([[1, 0]], pts=('30', '0'), srv=1))
    assert (st['n'], st['gn'], st['sn'], st['nn']) == mid
    # set: z 5:0 na mezi-set 1:0. To není +1 gem (skok), setUp ano jen když fresh a setsDelta 1.
    # Přímý přechod 1:0 gemů -> dokončený set 6:0 je setsDelta 1 a fresh, a jeden gem set dokončí.
    L.observe(mk, True, pA, diffs, ctx, feed([[5, 0]]))
    # z 1:0 na 5:0 je skok, neučí se
    assert st['gn'] == mid[1]
    L.observe(mk, True, pA, diffs, ctx, feed([[6, 0], [0, 0]]))
    assert st['sn'] >= mid[2] + 1, (st['sn'], mid)
    assert st['n'] >= mid[0]
    snap = (st['n'], st['gn'], st['sn'], st['nn'], len(st['seen']), len(st['gseen']), len(st['sseen']))
    L.observe(mk, True, pA, diffs, ctx, feed([[6, 0], [0, 0]]))
    assert (st['n'], st['gn'], st['sn'], st['nn'], len(st['seen']), len(st['gseen']), len(st['sseen'])) == snap
    # dohrání
    L.observe(mk, True, pA, diffs, ctx, feed([[6, 0], [6, 2]], status=3, win=1))
    assert st['n'] > snap[0] or st['sn'] > snap[2]
    again = (st['n'], st['gn'], st['sn'], st['nn'])
    L.observe(mk, True, pA, diffs, ctx, feed([[6, 0], [6, 2]], status=3, win=1))
    assert (st['n'], st['gn'], st['sn'], st['nn']) == again
    # skreč nic nezavře do M z nového tracku
    mk2 = '20700|a2|b2'
    L.observe(mk2, True, pA, diffs, ctx, feed([[1, 0]]))
    before = st['n']
    L.observe(mk2, True, pA, diffs, ctx, feed([[1, 0]], det=8, status=3, win=2))
    assert st['n'] == before and mk2 not in st['tracks']
    # ITF (code 2) se nesahá
    n_itf = st['n']
    L.observe('20700|i1|i2', True, pA, diffs, ctx, dict(code=2, det=3, st=2, win=0, sets=[[1, 0]], pts=['0', '0'], srv=1))
    assert st['n'] == n_itf and '20700|i1|i2' not in st['tracks']
    # merge: remote bez nových klíčů + elog = stejné váhy, podruhé beze změny
    remote = live_ml.load(PATH)
    remote = json.loads(json.dumps(remote))
    remote['tracks'], remote['elog'], remote['bases'] = {}, [], {}
    w_before = list(st['w'])
    merged = merge_states(st, remote)
    assert st['seen'][-1] in merged['seen'] or any(k.startswith('20700|a1|b1|M|') for k in merged['seen'])
    merged2 = merge_states(merged, remote)
    assert merged2['w'] == merged['w']
    assert merged2['sw'] == merged['sw']
    assert merged2['nw'] == merged['nw']
    assert merged2['gw'] == merged['gw']
    print('self-test ok', 'steps', L.steps, 'w moved', w_before != st['w'])

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--once', action='store_true')
    ap.add_argument('--minutes', type=float, default=0)
    ap.add_argument('--interval', type=float, default=60)
    ap.add_argument('--self-test', action='store_true')
    a = ap.parse_args()
    if a.self_test:
        self_test(); return
    world = World()
    st = live_ml.load(PATH)
    learner = Learner(st)
    end = time.time() + max(0, a.minutes) * 60
    last_commit = 0
    while True:
        t0 = time.time()
        try:
            info = poll(world, learner)
        except Exception as e:
            print('poll selhal', e, flush=True)
            info = None
        else:
            live_ml.save(PATH, learner.st)
            print('poll', json.dumps(info, ensure_ascii=False), flush=True)
        now = time.time()
        if os.environ.get('LIVE_COMMIT') == '1' and info and (info['steps'] or learner.st.get('tracks')) and now - last_commit > 120:
            learner.st = commit_push(learner.st)
            learner = Learner(learner.st)
            last_commit = time.time()
        if a.once or a.minutes <= 0 or time.time() >= end:
            break
        time.sleep(max(1, a.interval - (time.time() - t0)))
    live_ml.save(PATH, learner.st)
    if os.environ.get('LIVE_COMMIT') == '1':
        commit_push(learner.st)
    print('hotovo', json.dumps(dict(n=learner.st.get('n'), gn=learner.st.get('gn'), sn=learner.st.get('sn'), nn=learner.st.get('nn'),
                                     tracks=len(learner.st.get('tracks') or {}), steps=learner.steps), ensure_ascii=False), flush=True)

if __name__ == '__main__':
    main()
