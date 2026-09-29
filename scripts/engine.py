#!/usr/bin/env python3
"""Sekvenční engine: Elo (celkové + povrchové, K dle úrovně), forma, H2H, únava, podání/příjem.
Příznaky pro každý zápas se počítají VÝHRADNĚ ze stavu před zápasem.
Funkce feats() je 1:1 přepsána do web/model.js (ověřeno testem parity)."""
import math, os, json, random, re
_GRX = re.compile(r'(\d+)-(\d+)')
import numpy as np, pandas as pd

SURF = {'Hard': 0, 'Clay': 1, 'Grass': 2, 'Carpet': 3}
LVL_MULT = {6: 1.1, 5: 1.0, 4: 1.0, 3: 0.95, 2: 0.9, 1: 0.85, 0: 0.8}
PRIOR = {'M': dict(spw=0.62, rpw=0.38, ace=0.07, df=0.04, bps=0.60), 'W': dict(spw=0.56, rpw=0.44, ace=0.03, df=0.05, bps=0.55)}
RANK_FILL = 2500.0
RING = 25
FH_DAYS = 160   # delší historie jen pro graf formy (60 dní + zahřátí); do příznaků modelu nevstupuje
G_DIV = 1200.0; G_K = 5.0

DIFF = ['d_elo', 'd_selo', 'd_lrank', 'd_lpts', 'd_rmiss', 'd_form10', 'd_form25', 'd_fexp10', 'd_lexp', 'd_lsexp',
        'd_h2h', 'd_age', 'd_ht', 'd_htmiss', 'd_lefty', 'd_m7', 'd_m14', 'd_min14', 'd_rest', 'd_surfwr',
        'd_spw', 'd_rpw', 'd_ace', 'd_df', 'd_bps', 'd_lstat', 'd_avglvl',
        # v2: Elo z podílu gemů (margin of victory), časově vážená forma, nejistota (Glicko-like), neaktivita, dominance podání+příjem
        'd_gelo', 'd_gselo', 'd_fexpt', 'd_form60', 'd_inact', 'd_rd', 'd_dom']
CTX = ['lvl_code', 'is_qual', 'best_of', 'surface', 'gender', 'm_elo', 'm_lrank', 'eloA', 'eloB', 'ageA', 'ageB', 'lrankA', 'lrankB', 'h2h_n']
FEATS = DIFF + CTX

def new_player(g):
    p = PRIOR[g]
    return dict(g=g, elo=1500.0, n=0, se=[1500.0] * 4, sn=[0] * 4, rank=None, pts=None, rday=None,
                ring=[], fh=[], sw=[0] * 4, sl=[0] * 4, spw=p['spw'], rpw=p['rpw'], ace=p['ace'], df=p['df'], bps=p['bps'],
                ns=0, hand='', ht=None, dob=None, ioc='', name='', last=None, gelo=1500.0, gse=[1500.0] * 4)

def _form(ring, k):
    r = ring[-k:]
    w = sum(x[1] for x in r)
    return (w + 1.0) / (len(r) + 2.0)

def _fexp(ring, k):
    r = ring[-k:]
    if not r: return 0.0
    return sum(x[1] - x[2] for x in r) / (len(r) + 3.0)

def _fatigue(ring, day):
    m7 = m14 = 0; mins = 0.0
    for x in ring:
        d, mi = x[0], x[3]
        if day - d <= 14:
            m14 += 1; mins += mi
            if day - d <= 7: m7 += 1
    last = ring[-1][0] if ring else None
    rest = 30.0 if last is None else float(min(30, max(0, day - last)))
    return m7, m14, mins / 100.0, rest

def _avglvl(ring, k=10):
    r = ring[-k:]
    if not r: return 1.0
    return sum(x[4] for x in r) / len(r)

def _surfwr(p, s):
    tw = sum(p['sw']); tl = sum(p['sl'])
    ov = (tw + 2.0) / (tw + tl + 4.0)
    return (p['sw'][s] + 4.0 * ov) / (p['sw'][s] + p['sl'][s] + 4.0)

def _age(p, day, row_age):
    if row_age is not None and not (isinstance(row_age, float) and math.isnan(row_age)): return float(row_age)
    if p['dob'] is not None: return (day - p['dob']) / 365.25
    return None

def _fexpt(ring, day):
    s = 0.0; ws = 0.0
    for x in ring:
        w = math.exp(-max(0, day - x[0]) / 45.0); s += w * (x[1] - x[2]); ws += w
    return s / (ws + 2.0)

def _form60(ring, day):
    w = 0; n = 0
    for x in ring:
        if day - x[0] <= 60: n += 1; w += x[1]
    return (w + 1.0) / (n + 2.0)

def _inact(ring, day):
    if not ring: return math.log1p(730.0)
    return math.log1p(float(min(730, max(0, day - ring[-1][0]))))

def _rd(p, day):
    base = max(40.0, 350.0 / math.sqrt(1.0 + p['n'] / 5.0))
    t = (max(0, day - p['ring'][-1][0]) / 7.0) if p['ring'] else 52.0
    return min(350.0, math.sqrt(base * base + 900.0 * t))

def _lrank(r):
    return math.log(r if r and r > 0 else RANK_FILL)

def feats(A, B, ctx, h2h):
    """A, B: stavy hráčů (dict). ctx: day, dayA, dayB (referenční dny pro únavu), surface, lvl_code, is_qual,
    best_of, rankA/B, ptsA/B, ageA/B (volitelně z řádku zápasu). h2h: (výhry A, výhry B)."""
    s = ctx['surface']; day = ctx['day']
    rA = ctx.get('rankA') or A['rank']; rB = ctx.get('rankB') or B['rank']
    pA = ctx.get('ptsA') or A['pts'] or 0.0; pB = ctx.get('ptsB') or B['pts'] or 0.0
    lrA, lrB = _lrank(rA), _lrank(rB)
    aA = _age(A, day, ctx.get('ageA')); aB = _age(B, day, ctx.get('ageB'))
    if aA is None: aA = 24.0
    if aB is None: aB = 24.0
    dA = ctx.get('dayA', day); dB = ctx.get('dayB', day)
    fA = _fatigue(A['ring'], dA); fB = _fatigue(B['ring'], dB)
    hA = A['ht'] or 0.0; hB = B['ht'] or 0.0
    hmA = 1.0 if not A['ht'] else 0.0; hmB = 1.0 if not B['ht'] else 0.0
    ht_d = (hA - hB) if (hmA == 0 and hmB == 0) else 0.0
    w1, w2 = h2h
    d = [A['elo'] - B['elo'], A['se'][s] - B['se'][s], lrB - lrA,
         math.log1p(pA) - math.log1p(pB), (1.0 if not rA else 0.0) - (1.0 if not rB else 0.0),
         _form(A['ring'], 10) - _form(B['ring'], 10), _form(A['ring'], 25) - _form(B['ring'], 25),
         _fexp(A['ring'], 10) - _fexp(B['ring'], 10), math.log1p(A['n']) - math.log1p(B['n']),
         math.log1p(A['sn'][s]) - math.log1p(B['sn'][s]),
         float(w1 - w2), aA - aB, ht_d, hmA - hmB,
         (1.0 if A['hand'] == 'L' else 0.0) - (1.0 if B['hand'] == 'L' else 0.0),
         fA[0] - fB[0], fA[1] - fB[1], fA[2] - fB[2], fA[3] - fB[3],
         _surfwr(A, s) - _surfwr(B, s),
         A['spw'] - B['spw'], A['rpw'] - B['rpw'], A['ace'] - B['ace'], A['df'] - B['df'], A['bps'] - B['bps'],
         math.log1p(A['ns']) - math.log1p(B['ns']), _avglvl(A['ring']) - _avglvl(B['ring']),
         A['gelo'] - B['gelo'], A['gse'][s] - B['gse'][s], _fexpt(A['ring'], dA) - _fexpt(B['ring'], dB),
         _form60(A['ring'], dA) - _form60(B['ring'], dB), _inact(A['ring'], dA) - _inact(B['ring'], dB), _rd(A, dA) - _rd(B, dB),
         (A['spw'] + A['rpw']) - (B['spw'] + B['rpw'])]
    c = [ctx['lvl_code'], ctx['is_qual'], ctx['best_of'], s, 1.0 if A['g'] == 'W' else 0.0,
         (A['elo'] + B['elo']) / 2.0, (lrA + lrB) / 2.0, A['elo'], B['elo'], aA, aB, lrA, lrB, float(w1 + w2)]
    return d + c

def k_factor(n, lvl, q, ret):
    k = 250.0 / ((n + 5) ** 0.4) * LVL_MULT.get(lvl, 1.0)
    if q: k *= 0.95
    if ret: k *= 0.5
    return k

def _ew(p, key, val, n):
    a = max(0.08, 1.0 / (n + 3.0))
    p[key] = p[key] * (1 - a) + val * a

def gelo_update(W, L, s, kW, kL, ksW, ksL, games, ret):
    """Elo z podílu vyhraných gemů (margin of victory). Bez skóre / skreč -> poloviční klasický krok."""
    for key, idx, kw, kl in (('gelo', None, kW, kL), ('gse', s, ksW, ksL)):
        wv = W[key] if idx is None else W[key][idx]; lv = L[key] if idx is None else L[key][idx]
        if games and games[0] + games[1] > 0 and not ret:
            e = 1.0 / (1.0 + 10 ** ((lv - wv) / G_DIV)); sg = games[0] / (games[0] + games[1])
            dw = G_K * kw * (sg - e); dl = G_K * kl * (sg - e)
        else:
            e = 1.0 / (1.0 + 10 ** ((lv - wv) / 400.0)); dw = 0.5 * kw * (1 - e); dl = 0.5 * kl * (1 - e)
        if idx is None: W[key] = wv + dw; L[key] = lv - dl
        else: W[key][idx] = wv + dw; L[key][idx] = lv - dl

def games_of(score):
    a = b = 0
    for x, y in _GRX.findall(score if isinstance(score, str) else ''): a += int(x); b += int(y)
    return (a, b)

def update(W, L, m):
    s = m['surface']; lvl = m['lvl_code']; q = m['is_qual']; ret = m['ret']; day = m['day']
    ew = 1.0 / (1.0 + 10 ** ((L['elo'] - W['elo']) / 400.0))
    ews = 1.0 / (1.0 + 10 ** ((L['se'][s] - W['se'][s]) / 400.0))
    kW = k_factor(W['n'], lvl, q, ret); kL = k_factor(L['n'], lvl, q, ret)
    ksW = k_factor(W['sn'][s], lvl, q, ret); ksL = k_factor(L['sn'][s], lvl, q, ret)
    W['elo'] += kW * (1 - ew); L['elo'] -= kL * (1 - ew)
    W['se'][s] += ksW * (1 - ews); L['se'][s] -= ksL * (1 - ews)
    W['n'] += 1; L['n'] += 1; W['sn'][s] += 1; L['sn'][s] += 1
    W['sw'][s] += 1; L['sl'][s] += 1
    gelo_update(W, L, s, kW, kL, ksW, ksL, m.get('games'), ret)
    mins = m['minutes'] if m['minutes'] == m['minutes'] and m['minutes'] else (100.0 if m['best_of'] == 3 else 150.0)
    W['ring'].append((day, 1, ew, mins, lvl, m.get('lid'))); L['ring'].append((day, 0, 1 - ew, mins, lvl, m.get('wid')))
    if len(W['ring']) > RING: del W['ring'][0]
    if len(L['ring']) > RING: del L['ring'][0]
    for P_, w_, e_, o_ in ((W, 1, ew, m.get('lid')), (L, 0, 1 - ew, m.get('wid'))):
        fh = P_.setdefault('fh', []); fh.append((day, w_, e_, lvl, o_))
        while fh and fh[0][0] < day - FH_DAYS: del fh[0]
    W['last'] = day; L['last'] = day
    update_stats(W, L, m.get('stats'))

def update_stats(W, L, st):
    """Podání/příjem (EW průměr) ze statistik zápasu; volá se i samostatně při doplnění statistik k už započtenému zápasu."""
    if st is not None:
        (wsv, w1w, w2w, wa, wd, wbs, wbf, lsv, l1w, l2w, la, ld, lbs, lbf) = st
        if wsv and lsv and wsv > 10 and lsv > 10:
            wspw = (w1w + w2w) / wsv; lspw = (l1w + l2w) / lsv
            for P, spw, rpw, a, dfv, bs, bf in ((W, wspw, 1 - lspw, wa / wsv, wd / wsv, wbs, wbf), (L, lspw, 1 - wspw, la / lsv, ld / lsv, lbs, lbf)):
                n = P['ns']
                _ew(P, 'spw', spw, n); _ew(P, 'rpw', rpw, n); _ew(P, 'ace', a, n); _ew(P, 'df', dfv, n)
                if bf and bf > 0: _ew(P, 'bps', bs / bf, n)
                P['ns'] += 1

def _num(x):
    return None if x is None or (isinstance(x, float) and math.isnan(x)) else float(x)

def run(df, players_meta, train_from=20050101, seed=42):
    rng = random.Random(seed)
    P = {}; H = {}
    cols = {c: df[c].to_numpy() for c in df.columns}
    n = len(df)
    X = []; meta = []
    stat_cols = ['w_svpt', 'w_1stWon', 'w_2ndWon', 'w_ace', 'w_df', 'w_bpSaved', 'w_bpFaced',
                 'l_svpt', 'l_1stWon', 'l_2ndWon', 'l_ace', 'l_df', 'l_bpSaved', 'l_bpFaced']
    SC = [cols[c] for c in stat_cols]
    def get(pid, g, name, hand, ht, ioc, age, day):
        p = P.get(pid)
        if p is None:
            p = new_player(g); P[pid] = p
            pm = players_meta.get(pid)
            if pm:
                p['hand'] = pm['hand'] or ''; p['ht'] = pm['ht']; p['ioc'] = pm['ioc'] or ''
                if pm['dob']:
                    try: p['dob'] = (pd.Timestamp(str(pm['dob'])) - pd.Timestamp('1970-01-01')).days
                    except Exception: pass
        p['name'] = name
        if hand in ('R', 'L'): p['hand'] = hand
        if ht == ht and ht and ht > 140: p['ht'] = float(ht)
        if ioc and ioc != 'nan': p['ioc'] = ioc
        if p['dob'] is None and age == age and age: p['dob'] = int(day - age * 365.25)
        return p
    for i in range(n):
        g = cols['gender'][i]; day = int(cols['day'][i]); td = int(cols['tourney_date'][i])
        W = get(cols['winner_id'][i], g, cols['winner_name'][i], cols['winner_hand'][i], cols['winner_ht'][i], cols['winner_ioc'][i], cols['winner_age'][i], day)
        L = get(cols['loser_id'][i], g, cols['loser_name'][i], cols['loser_hand'][i], cols['loser_ht'][i], cols['loser_ioc'][i], cols['loser_age'][i], day)
        wid, lid = cols['winner_id'][i], cols['loser_id'][i]
        s = SURF.get(cols['surface'][i], 0)
        lvl = int(cols['lvl_code'][i]); q = int(cols['is_qual'][i]); ret = int(cols['ret'][i])
        wr, lr = _num(cols['winner_rank'][i]), _num(cols['loser_rank'][i])
        wp, lp = _num(cols['winner_rank_points'][i]), _num(cols['loser_rank_points'][i])
        key = (wid, lid) if wid < lid else (lid, wid)
        hh = H.get(key, [0, 0])
        if td >= train_from and ret == 0:
            a_is_w = rng.random() < 0.5
            A, B = (W, L) if a_is_w else (L, W)
            ctx = dict(day=day, surface=s, lvl_code=lvl, is_qual=q, best_of=int(cols['best_of'][i]),
                       rankA=wr if a_is_w else lr, rankB=lr if a_is_w else wr,
                       ptsA=wp if a_is_w else lp, ptsB=lp if a_is_w else wp,
                       ageA=_num(cols['winner_age'][i] if a_is_w else cols['loser_age'][i]),
                       ageB=_num(cols['loser_age'][i] if a_is_w else cols['winner_age'][i]))
            aid = wid if a_is_w else lid
            hA = hh[0] if aid == key[0] else hh[1]; hB = hh[1] if aid == key[0] else hh[0]
            X.append(feats(A, B, ctx, (hA, hB)))
            meta.append((td, day, 1 if a_is_w else 0, cols['lvl_group'][i], g, lvl, q))
        # stav po zápase
        if wr: W['rank'] = wr; W['rday'] = day
        if lr: L['rank'] = lr; L['rday'] = day
        if wp is not None: W['pts'] = wp
        if lp is not None: L['pts'] = lp
        stv = tuple(c[i] for c in SC)
        stats = stv if all(v == v for v in stv) else None
        update(W, L, dict(surface=s, lvl_code=lvl, is_qual=q, ret=ret, day=day, minutes=cols['minutes'][i],
                          best_of=int(cols['best_of'][i]), stats=stats, wid=wid, lid=lid, games=games_of(cols['score'][i])))
        if wid == key[0]: hh[0] += 1
        else: hh[1] += 1
        H[key] = hh
        if i % 200000 == 0: print('..', i, td, flush=True)
    X = np.asarray(X, dtype=np.float32)
    meta = pd.DataFrame(meta, columns=['tdate', 'day', 'y', 'group', 'gender', 'lvl_code', 'is_qual'])
    return X, meta, P, H
