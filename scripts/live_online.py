"""Doladění živé predikce (Predikce teď) po gemu, brejku, setu a po dohrání.

Základ zůstává Markovův bodový model. Korekce je malý logistický člen
  logit(p) = logit(p_Markov) + w · f(stav)
f je 0 na 0:0, takže bez rozehraného skóre je p přesně předzápasové / Markovovo.
Krok se dělá z výsledku jednotky, která právě skončila (gem, set), a po dohrání
ještě jednou z viděných stavů proti vítězi zápasu. Kurzy se nepoužívají.
Váhy se drží ve state/live_online.json a přes nedělní refit stromů zůstávají
(základ je Markov, ne train_end_day). Mažou se jen když se změní seznam příznaků.
"""
import json, os, math
BASE = 'markov'
COLS = ['ds', 'd1', 'd2', 'dg', 'srv', 'bo5', 'late']
SCALE = [1, 1, 1, 1, 1, 1, 1]
ETA_GAME, ETA_SET, ETA_MATCH = 0.0015, 0.003, 0.004
DECAY, CLIP, ZCAP, SEEN_MAX = 0.9998, 0.08, 0.22, 5000

def logit(p):
    p = min(1 - 1e-6, max(1e-6, float(p)))
    return math.log(p / (1 - p))

def sig(z):
    if z > 20: return 1 - 1e-9
    if z < -20: return 1e-9
    return 1 / (1 + math.exp(-z))

def empty():
    return dict(base=BASE, cols=list(COLS), scale=list(SCALE), w=[0.0] * len(COLS), n=0, seen=[])

def load(path):
    st = None
    if path and os.path.exists(path):
        try: st = json.load(open(path))
        except Exception: st = None
    if not st or st.get('base') != BASE or list(st.get('cols') or []) != COLS:
        return empty()
    st['w'] = [float(v) for v in st['w']]
    if len(st['w']) != len(COLS): return empty()
    st['seen'] = [str(s) for s in st.get('seen') or []]
    st['n'] = int(st.get('n') or 0)
    st['scale'] = list(SCALE)
    return st

def save(path, st):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    json.dump(st, open(path, 'w'), ensure_ascii=False, separators=(',', ':'))

def feats(sa, sb, ga, gb, srv, bo5):
    """0 na 0:0 (i když je známé podání). srv +1 když podává A."""
    if sa == 0 and sb == 0 and ga == 0 and gb == 0:
        return [0.0] * len(COLS)
    ds = float(sa - sb)
    return [ds, float((sa == 1) - (sb == 1)), float((sa == 2) - (sb == 2)), float(ga - gb), float(srv), ds * float(bo5), float((ga >= 5) - (gb >= 5))]

def z_of(st, x):
    z = 0.0
    for w, v, s in zip(st['w'], x, st['scale']):
        if w: z += w * (v / s)
    return max(-ZCAP, min(ZCAP, z))

def adjust(p, st, x):
    if not st or not any(st['w']): return float(p)
    z = z_of(st, x)
    if not z: return float(p)
    return sig(logit(p) + z)

def step(st, x, y, p_base, mk, eta):
    mk = str(mk)
    if mk in st['seen']: return False
    if not any(x):
        st['seen'].append(mk)
        if len(st['seen']) > SEEN_MAX: st['seen'] = st['seen'][-SEEN_MAX:]
        return False
    p = sig(logit(p_base) + z_of(st, x))
    err = p - float(y)
    for i, v in enumerate(x):
        xs = v / st['scale'][i]
        nw = DECAY * st['w'][i] - eta * err * xs
        st['w'][i] = max(-CLIP, min(CLIP, nw))
    st['seen'].append(mk)
    if len(st['seen']) > SEEN_MAX: st['seen'] = st['seen'][-SEEN_MAX:]
    st['n'] = int(st.get('n') or 0) + 1
    return True

def _hold(p):
    q = 1 - p
    d = (p * p) / (p * p + q * q)
    return p ** 4 * (1 + 4 * q + 10 * q * q) + 20 * (p ** 3) * (q ** 3) * d

def markov_sets(p0, bo, sa, sb):
    """P(A vyhraje zápas) ze stavu setů, gemy 0:0, podání neznámé. Stejná pravidla jako v prohlížeči."""
    s0 = 0.64 if bo == 5 else 0.60
    need = (bo + 1) // 2
    def m0(g):
        pA = min(0.84, max(0.50, s0 + g)); pB = min(0.84, max(0.50, s0 - g))
        return 0.5 * (_pm(0, 0, True, pA, pB, need) + _pm(0, 0, False, pA, pB, need))
    lo, hi = -0.34, 0.34
    for _ in range(24):
        mid = (lo + hi) / 2
        if m0(mid) < p0: lo = mid
        else: hi = mid
    g = (lo + hi) / 2
    pA = min(0.84, max(0.50, s0 + g)); pB = min(0.84, max(0.50, s0 - g))
    base = m0(g)
    m = 0.5 * (_pm(sa, sb, True, pA, pB, need) + _pm(sa, sb, False, pA, pB, need))
    if abs(base - p0) > 0.012:
        return sig(logit(p0) + logit(m) - logit(base))
    return float(m)

def _pm(sa, sb, a_serves, pA, pB, need, memo=None):
    if memo is None: memo = {}
    if sa >= need: return 1.0
    if sb >= need: return 0.0
    k = (sa, sb, a_serves)
    if k in memo: return memo[k]
    pg = _hold(pA) if a_serves else (1 - _hold(pB))
    # jeden gem a pak soupeř podává; na 6:6 zjednodušíme na tiebreak ≈ podávající
    def win_set(a_s):
        return a_s  # placeholder replaced below
    # rekurze po gemech do konce setu je schovaná v pset
    ps = _pset(0, 0, a_serves, pA, pB, {})
    v = ps * _pm(sa + 1, sb, not a_serves, pA, pB, need, memo) + (1 - ps) * _pm(sa, sb + 1, not a_serves, pA, pB, need, memo)
    memo[k] = v
    return v

def _pset(ga, gb, a_serves, pA, pB, memo):
    if (ga >= 6 and ga - gb >= 2) or (ga == 7 and gb == 6): return 1.0
    if (gb >= 6 and gb - ga >= 2) or (gb == 7 and ga == 6): return 0.0
    k = (ga, gb, a_serves)
    if k in memo: return memo[k]
    if ga == 6 and gb == 6:
        v = _hold(pA) if a_serves else (1 - _hold(pB))  # TB zkráceně jako jeden gem
    else:
        pg = _hold(pA) if a_serves else (1 - _hold(pB))
        v = pg * _pset(ga + 1, gb, not a_serves, pA, pB, memo) + (1 - pg) * _pset(ga, gb + 1, not a_serves, pA, pB, memo)
    memo[k] = v
    return v

def parse_sets(score):
    if not score or not isinstance(score, str): return None
    u = score.upper()
    if 'RET' in u or 'W/O' in u or 'WALKOVER' in u or 'DEF' in u: return None
    out = []
    for part in score.replace('RET', '').split():
        core = part.split('(')[0]
        if '-' not in core: continue
        a, b = core.split('-')[:2]
        if a.isdigit() and b.isdigit():
            ia, ib = int(a), int(b)
            if (ia >= 6 and ia - ib >= 2) or (ib >= 6 and ib - ia >= 2) or (ia == 7 and ib == 6) or (ib == 7 and ia == 6):
                out.append((ia, ib))
    return out or None

def from_sets(st, wid, lid, score, day, bo, p_winner):
    """Ze známého konečného skóre setů (bez vymyšlené cesty gemů). P(A) je předzápasová šance hráče s menším id."""
    sets = parse_sets(score)
    if not sets: return 0
    a, b = (str(wid), str(lid)) if str(wid) < str(lid) else (str(lid), str(wid))
    a_is_w = str(wid) == a
    pA = float(p_winner) if a_is_w else 1 - float(p_winner)
    pA = min(0.98, max(0.02, pA))
    bo = 5 if int(bo) == 5 else 3
    mk = f'{int(day)}|{a}|{b}'
    sa = sb = 0
    n = 0
    yM = 1.0 if a_is_w else 0.0
    for wg, lg in sets:
        set_to_w = wg > lg
        yS = 1.0 if set_to_w == a_is_w else 0.0
        x = feats(sa, sb, 0, 0, 0, 1 if bo == 5 else 0)
        try:
            pm = markov_sets(pA, bo, sa, sb)
        except Exception:
            pm = pA
        if step(st, x, yS, pm, f'{mk}|S|{sa}|{sb}', ETA_SET): n += 1
        if step(st, x, yM, pm, f'{mk}|M|{sa}|{sb}|0|0', ETA_MATCH): n += 1
        if yS == 1: sa += 1
        else: sb += 1
    return n
