"""Živý model výhry: logit(p) = logit(p0) + w · φ(skóre, síla).

φ je 0 na 0:0 (sety, gemy i body), takže výstup je přesně předzápasová šance.
Síla soupeře (Elo, žebříček, forma a ostatní rozdílové příznaky) vstupuje jako
|rozdíl| krát stav skóre — směr drží předzápasové p0 a znaménko skóre.
Trénink je na skutečných stavech grandslamů. Online krok po gemu, brejku, setu
a po dohrání používá jen to, co už je známé. Váhy se přes nedělní stromy mažou jen
když se změní základna liveml1.
"""
import json, os, math
import numpy as np
from engine import DIFF

BASE = 'liveml1'
SCORE = ['ds', 'd1', 'd2', 'g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'dg', 'late',
         'p1', 'p2', 'p3', 'p4', 'dp', 'dtb', 'srv', 'hold', 'brk', 'bp']
CORE = ['ds', 'dg', 'dp', 'dtb', 'srv', 'hold', 'brk', 'bp', 'late']
CTX = ['bo5', 'woman', 'clay', 'grass', 'qual', 'lvl']
ZCAP = 1.15
GAME_ZCAP = 3.2
PULL = 0.04
BOUND = 0.22
ETA = {'G': 0.0012, 'S': 0.0025, 'M': 0.0035}
SEEN_MAX = 6000

def logit(p):
    p = min(1 - 1e-6, max(1e-6, float(p)))
    return math.log(p / (1 - p))

def sig(z):
    if z > 20: return 1 - 1e-9
    if z < -20: return 1e-9
    return 1 / (1 + math.exp(-z))

def n_weights():
    return len(SCORE) + len(CORE) * len(DIFF) + len(CORE) * len(CTX)

def empty(scales=None):
    sc = list(scales) if scales is not None else [1.0] * len(DIFF)
    z = [0.0] * n_weights()
    return dict(base=BASE, score=list(SCORE), core=list(CORE), diffs=list(DIFF), ctx=list(CTX),
                scale=[float(s) if s else 1.0 for s in sc], w=z, w0=list(z), n=0, seen=[],
                gw=list(z), gw0=list(z), gn=0, gseen=[],
                eta=dict(ETA), pull=PULL, bound=BOUND)

def load(path):
    st = None
    if path and os.path.exists(path):
        try: st = json.load(open(path))
        except Exception: st = None
    if not st or st.get('base') != BASE or list(st.get('diffs') or []) != list(DIFF) or list(st.get('score') or []) != SCORE:
        return empty()
    w = [float(v) for v in st.get('w') or []]
    if len(w) != n_weights(): return empty()
    w0 = [float(v) for v in st.get('w0') or w]
    if len(w0) != n_weights(): w0 = list(w)
    sc = [float(v) if v else 1.0 for v in (st.get('scale') or [])]
    if len(sc) != len(DIFF): sc = [1.0] * len(DIFF)
    st['w'], st['w0'], st['scale'] = w, w0, sc
    st['seen'] = [str(s) for s in st.get('seen') or []]
    st['n'] = int(st.get('n') or 0)
    gw = [float(v) for v in (st.get('gw') or [])]
    if len(gw) != n_weights(): gw = [0.0] * n_weights()
    gw0 = [float(v) for v in (st.get('gw0') or gw)]
    if len(gw0) != n_weights(): gw0 = list(gw)
    st['gw'], st['gw0'] = gw, gw0
    st['gseen'] = [str(s) for s in st.get('gseen') or []]
    st['gn'] = int(st.get('gn') or 0)
    st['eta'] = dict(ETA)
    st['pull'] = PULL
    st['bound'] = BOUND
    return st

def save(path, st):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    out = {k: st[k] for k in ('base', 'score', 'core', 'diffs', 'ctx', 'scale', 'w', 'w0', 'n', 'seen', 'gw', 'gw0', 'gn', 'gseen') if k in st}
    out['eta'] = dict(ETA); out['pull'] = PULL; out['bound'] = BOUND
    json.dump(out, open(path, 'w'), ensure_ascii=False, separators=(',', ':'))

def _start(sa, sb, ga, gb, pa, pb, ta, tb, in_tb):
    return (not in_tb) and sa == 0 and sb == 0 and ga == 0 and gb == 0 and pa == 0 and pb == 0 and ta == 0 and tb == 0

def score_map(sa, sb, ga, gb, pa, pb, ta, tb, in_tb, srv, hold, brk, blank_start=True):
    """Liché příznaky skóre z pohledu hráče A. Zápasový model je na 0:0 nulový.
    Gemový model (blank_start False) nechá podání, i když body chybí."""
    if blank_start and _start(sa, sb, ga, gb, pa, pb, ta, tb, in_tb):
        return {k: 0.0 for k in SCORE}
    ds = float(sa - sb)
    dg = 0.0 if in_tb else float(ga - gb)
    dp = 0.0 if in_tb else float(pa - pb) / 4.0
    dtb = float(ta - tb) / 7.0 if in_tb else 0.0
    bp = 0.0
    if not in_tb and srv:
        a_gp = pa >= 3 and pa > pb
        b_gp = pb >= 3 and pb > pa
        if srv < 0 and a_gp: bp = 1.0
        elif srv > 0 and b_gp: bp = -1.0
    m = {
        'ds': ds, 'd1': float((sa == 1) - (sb == 1)), 'd2': float((sa == 2) - (sb == 2)),
        'dg': dg, 'late': 0.0 if in_tb else float((ga >= 5) - (gb >= 5)),
        'dp': dp, 'dtb': dtb, 'srv': float(srv), 'hold': float(hold), 'brk': float(brk), 'bp': bp,
    }
    if not in_tb:
        for k in range(1, 7):
            m[f'g{k}'] = float((ga == k) - (gb == k))
        for k in range(1, 5):
            m[f'p{k}'] = float((pa == k) - (pb == k))
    else:
        for k in range(1, 7): m[f'g{k}'] = 0.0
        for k in range(1, 5): m[f'p{k}'] = 0.0
    return m

def phi_parts(sm, diffs, ctx, scales):
    """Vrátí plochý vektor ve stejném pořadí jako váhy."""
    sd = [abs(float(d)) / (float(s) if s else 1.0) for d, s in zip(diffs, scales)]
    out = [float(sm[k]) for k in SCORE]
    for c in CORE:
        v = float(sm[c])
        out.extend(v * a for a in sd)
        out.extend(v * float(ctx[k]) for k in CTX)
    return out

def phi(sa, sb, ga, gb, pa, pb, ta, tb, in_tb, srv, hold, brk, diffs, ctx, scales, blank_start=True):
    return phi_parts(score_map(sa, sb, ga, gb, pa, pb, ta, tb, in_tb, srv, hold, brk, blank_start), diffs, ctx, scales)

def phi_game(sa, sb, ga, gb, pa, pb, ta, tb, in_tb, srv, hold, brk, diffs, ctx, scales):
    """Stejné vstupy jako zápas, ale podání zůstane i na 0:0 a bez bodů."""
    return phi(sa, sb, ga, gb, pa, pb, ta, tb, in_tb, srv, hold, brk, diffs, ctx, scales, blank_start=False)

def _dot_w(w, x, cap):
    z = 0.0
    for i, v in enumerate(x):
        if v and i < len(w) and w[i]: z += w[i] * v
    if z > cap: return cap
    if z < -cap: return -cap
    return z

def dot(st, x):
    return _dot_w(st['w'], x, ZCAP)

def adjust(p, st, x):
    if not st or not x: return float(p)
    z = dot(st, x)
    if not z: return float(p)
    return sig(logit(p) + z)

def adjust_game(p, st, x):
    if not st or not x or not st.get('gw'): return float(p)
    z = _dot_w(st['gw'], x, GAME_ZCAP)
    if not z: return float(p)
    return sig(logit(p) + z)

def _step_into(st, wkey, w0key, seenkey, nkey, x, y, p0, mk, eta, cap):
    """Stejný krok pro zápas i pro gem. Liší se jen váhy, strop a klíč."""
    mk = str(mk)
    seen = st.setdefault(seenkey, [])
    if mk in seen: return False
    if not any(x):
        seen.append(mk)
        if len(seen) > SEEN_MAX: st[seenkey] = seen[-SEEN_MAX:]
        return False
    w = st[wkey]
    w0 = st[w0key]
    p = sig(logit(p0) + _dot_w(w, x, cap))
    err = p - float(y)
    pull = float(st.get('pull') or PULL)
    bound = float(st.get('bound') or BOUND)
    for i, v in enumerate(x):
        if not v: continue
        nw = w[i] - eta * err * v - eta * pull * (w[i] - w0[i])
        lo = w0[i] - bound; hi = w0[i] + bound
        if nw > hi: nw = hi
        elif nw < lo: nw = lo
        if nw > 1.5: nw = 1.5
        elif nw < -1.5: nw = -1.5
        w[i] = nw
    seen.append(mk)
    if len(seen) > SEEN_MAX: st[seenkey] = seen[-SEEN_MAX:]
    st[nkey] = int(st.get(nkey) or 0) + 1
    return True

def step(st, x, y, p0, mk, eta):
    """Jeden krok zápasové hlavy. p0 je předzápasová šance strany, ke které patří x."""
    return _step_into(st, 'w', 'w0', 'seen', 'n', x, y, p0, mk, eta, ZCAP)

def step_game(st, x, y, p0, mk):
    """Stejný krok po dohraném gemu. y je výherce gemu, p0 předzápasová šance té strany."""
    return _step_into(st, 'gw', 'gw0', 'gseen', 'gn', x, y, p0, mk, ETA['G'], GAME_ZCAP)

def ctx_of(bo, gender, surface, qual, lvl):
    s = str(surface or '')
    return {
        'bo5': 1.0 if int(bo) == 5 else 0.0,
        'woman': 1.0 if gender == 'W' else 0.0,
        'clay': 1.0 if s == 'Clay' else 0.0,
        'grass': 1.0 if s == 'Grass' else 0.0,
        'qual': 1.0 if qual else 0.0,
        'lvl': float(lvl or 0) / 6.0,
    }

def parse_sets(score):
    if not score or not isinstance(score, str): return None
    u = score.upper()
    if 'RET' in u or 'W/O' in u or 'WALKOVER' in u or 'DEF' in u: return None
    out = []
    for part in score.split():
        core = part.split('(')[0]
        if '-' not in core: continue
        a, b = core.split('-')[:2]
        if a.isdigit() and b.isdigit():
            ia, ib = int(a), int(b)
            if (ia >= 6 and ia - ib >= 2) or (ib >= 6 and ib - ia >= 2) or (ia == 7 and ib == 6) or (ib == 7 and ia == 6):
                out.append((ia, ib))
    return out or None

def from_sets(st, wid, lid, score, day, bo, gender, surface, qual, lvl, p_winner, diffs_winner):
    """Jen skutečně dohrané sety. Cestu gemů ani bodů nevymýšlí. diffs_winner je 34 rozdílů vítěz minus poražený."""
    sets = parse_sets(score)
    if not sets or diffs_winner is None: return 0
    a, b = (str(wid), str(lid)) if str(wid) < str(lid) else (str(lid), str(wid))
    a_is_w = str(wid) == a
    # rozdíly z pohledu A (menší id)
    if a_is_w: diffs = [float(v) for v in diffs_winner]
    else: diffs = [-float(v) for v in diffs_winner]
    pA = float(p_winner) if a_is_w else 1 - float(p_winner)
    ctx = ctx_of(bo, gender, surface, qual, lvl)
    sc = st['scale']
    mk = f'{int(day)}|{a}|{b}'
    sa = sb = 0
    n = 0
    yM = 1.0 if a_is_w else 0.0
    for wg, lg in sets:
        yS = 1.0 if (wg > lg) == a_is_w else 0.0
        x = phi(sa, sb, 0, 0, 0, 0, 0, 0, False, 0, 0, 0, diffs, ctx, sc)
        if step(st, x, yS, pA, f'{mk}|S|{sa}|{sb}', ETA['S']): n += 1
        if step(st, x, yM, pA, f'{mk}|M|{sa}|{sb}|0|0', ETA['M']): n += 1
        if yS == 1: sa += 1
        else: sb += 1
    return n
