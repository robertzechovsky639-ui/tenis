#!/usr/bin/env python3
"""Natřenuje živý model na grandslamových bodech 2011–2022 a porovná ho s Markovem
na Wimbledonu a US Open 2023–24. Nasazení řeší volající; tenhle skript jen uloží váhy a čísla.
Bodová historie mimo ty soubory se nevymýšlí.
"""
import os, sys, json, math, glob, time, unicodedata
import numpy as np, pandas as pd, lightgbm as lgb
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import engine, live_ml
from exp_live import Markov, fit_serve, markov_p, norm, PT, to_int, mets, sig, logit

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
T0 = time.time()
def log(*a): print(f'[{time.time()-T0:6.0f}s]', *a, flush=True)
SLAM = {'Australian Open': 'ausopen', 'Roland Garros': 'frenchopen', 'Wimbledon': 'wimbledon', 'US Open': 'usopen', 'Us Open': 'usopen'}
NAME = {'ausopen': 'Australian Open', 'frenchopen': 'Roland Garros', 'wimbledon': 'Wimbledon', 'usopen': 'US Open'}

def p0_batch(booster, F, di, swap_pairs, cal):
    """Symetrizované a kalibrované p jako export.Predictor.frozen. F je (n, 48) v orientaci A."""
    n = len(F)
    sw = F.copy()
    for i in di: sw[:, i] *= -1
    for a, b in swap_pairs: sw[:, a], sw[:, b] = F[:, b], F[:, a]
    both = np.vstack([F, sw])
    pg = booster.predict(both)
    pgb = 0.5 * (pg[:n] + 1 - pg[n:])
    if cal != 1:
        q = np.clip(pgb, 1e-6, 1 - 1e-6)
        pgb = 1 / (1 + np.exp(-cal * np.log(q / (1 - q))))
    return pgb

def walk_slam_feats():
    cols = ['day','tourney_date','tourney_name','gender','winner_id','loser_id','winner_name','loser_name',
            'winner_hand','loser_hand','winner_ht','loser_ht','winner_ioc','loser_ioc','winner_age','loser_age',
            'winner_rank','loser_rank','winner_rank_points','loser_rank_points','surface','lvl_code','is_qual','ret',
            'minutes','best_of','score','w_svpt','w_1stWon','w_2ndWon','w_ace','w_df','w_bpSaved','w_bpFaced',
            'l_svpt','l_1stWon','l_2ndWon','l_ace','l_df','l_bpSaved','l_bpFaced']
    df = pd.read_parquet(os.path.join(ROOT, 'data', 'matches.parquet'), columns=cols)
    df = df.sort_values(['day', 'tourney_date'], kind='mergesort')
    m = json.load(open(os.path.join(ROOT, 'web', 'data', 'model.json')))
    Fidx = {f: i for i, f in enumerate(m['feats'])}
    di = [Fidx[f] for f in m['diff']]
    swap_pairs = [(Fidx[a], Fidx[b]) for a, b in m['swap'].items()]
    booster = lgb.Booster(model_file=os.path.join(ROOT, 'data', 'gbm.txt'))
    cal = float(m.get('cal') or 1)
    P = {}; H = {}
    SC = ['w_svpt','w_1stWon','w_2ndWon','w_ace','w_df','w_bpSaved','w_bpFaced','l_svpt','l_1stWon','l_2ndWon','l_ace','l_df','l_bpSaved','l_bpFaced']
    rec = []
    xs = []
    for i, r in enumerate(df.itertuples(index=False)):
        g = r.gender
        def getp(pid, name, hand, ht, ioc, age):
            p = P.get(pid)
            if p is None:
                p = engine.new_player(g); P[pid] = p
            if name and name == name: p['name'] = name
            if hand in ('R', 'L'): p['hand'] = hand
            if ht == ht and ht and ht > 140: p['ht'] = float(ht)
            if ioc and ioc == ioc and ioc != 'nan': p['ioc'] = ioc
            if p['dob'] is None and age == age and age: p['dob'] = int(r.day - float(age) * 365.25)
            return p
        W = getp(r.winner_id, r.winner_name, r.winner_hand, r.winner_ht, r.winner_ioc, r.winner_age)
        L = getp(r.loser_id, r.loser_name, r.loser_hand, r.loser_ht, r.loser_ioc, r.loser_age)
        s = engine.SURF.get(r.surface, 0)
        day = int(r.day); td = int(r.tourney_date)
        key = (r.winner_id, r.loser_id) if r.winner_id < r.loser_id else (r.loser_id, r.winner_id)
        hh = H.get(key, [0, 0])
        slam = SLAM.get(r.tourney_name)
        if slam and int(r.ret) == 0 and td >= 20110101 and td < 20250101:
            bo = int(r.best_of) if r.best_of == r.best_of else 3
            wr, lr = engine._num(r.winner_rank), engine._num(r.loser_rank)
            wp, lp = engine._num(r.winner_rank_points), engine._num(r.loser_rank_points)
            ctx = dict(day=day, surface=s, lvl_code=int(r.lvl_code), is_qual=int(r.is_qual), best_of=bo,
                       rankA=wr, rankB=lr, ptsA=wp, ptsB=lp, ageA=engine._num(r.winner_age), ageB=engine._num(r.loser_age))
            aid = r.winner_id
            hA = hh[0] if aid == key[0] else hh[1]; hB = hh[1] if aid == key[0] else hh[0]
            x = engine.feats(W, L, ctx, (hA, hB))
            xs.append(x)
            rec.append(dict(year=int(str(td)[:4]), slam=slam, names=frozenset((norm(r.winner_name), norm(r.loser_name))),
                            wname=norm(r.winner_name), gender=g, bo=bo, surface=r.surface, qual=int(r.is_qual),
                            lvl=int(r.lvl_code), wid=r.winner_id, lid=r.loser_id))
        stv = (getattr(r, c) for c in SC)
        stv = tuple(stv)
        stats = stv if all(v == v and v is not None for v in stv) else None
        if engine._num(r.winner_rank): W['rank'] = engine._num(r.winner_rank)
        if engine._num(r.loser_rank): L['rank'] = engine._num(r.loser_rank)
        engine.update(W, L, dict(surface=s, lvl_code=int(r.lvl_code), is_qual=int(r.is_qual), ret=int(r.ret), day=day,
                                 minutes=r.minutes, best_of=int(r.best_of) if r.best_of == r.best_of else 3,
                                 stats=stats, wid=r.winner_id, lid=r.loser_id, games=engine.games_of(r.score)))
        hh[0 if r.winner_id == key[0] else 1] += 1
        H[key] = hh
        if i and i % 400000 == 0: log('walk', i)
    X = np.asarray(xs, np.float64)
    p = p0_batch(booster, X, di, swap_pairs, cal)
    lookup = {}
    for i, row in enumerate(rec):
        row['p_w'] = float(p[i])
        row['diff_w'] = X[i, :len(engine.DIFF)].astype(np.float64)
        lookup.setdefault((row['year'], row['slam'], row['names']), []).append(row)
    log('slam feature rows', len(rec))
    return lookup

def load_points(lookup):
    files = sorted(glob.glob(os.path.join(ROOT, 'raw', 'sackmann', 'slam_pointbypoint', '*-points.csv')))
    files = [f for f in files if all(s not in f for s in ('double', 'mixed', 'qual'))]
    train, val, test = [], [], []
    joined = miss = 0
    usecols = ['match_id','P1GamesWon','P2GamesWon','SetWinner','GameWinner','PointNumber','PointWinner','PointServer','P1Score','P2Score']
    for f in files:
        base = os.path.basename(f).replace('-points.csv', '')
        year = int(base[:4]); slam = base.split('-', 1)[1]
        if slam not in NAME: continue
        mf = f.replace('-points.csv', '-matches.csv')
        if not os.path.exists(mf): continue
        meta = pd.read_csv(mf)
        name1 = dict(zip(meta.match_id, meta.player1))
        name2 = dict(zip(meta.match_id, meta.player2))
        pts = pd.read_csv(f, usecols=lambda c: c in usecols, dtype=str)
        for mid, g in pts.groupby('match_id', sort=False):
            p1, p2 = name1.get(mid), name2.get(mid)
            if not isinstance(p1, str): continue
            hits = lookup.get((year, slam, frozenset((norm(p1), norm(p2)))))
            if not hits:
                miss += 1; continue
            hit = hits[0]
            p1_is_w = norm(p1) == hit['wname']
            diff = hit['diff_w'] if p1_is_w else -hit['diff_w']
            p0 = hit['p_w'] if p1_is_w else 1 - hit['p_w']
            y1 = 1 if p1_is_w else 0
            bo = hit['bo'] if hit['bo'] in (3, 5) else (5 if hit['gender'] == 'M' else 3)
            s0 = 0.64 if hit['gender'] == 'M' else 0.57
            sa = sb = ga = gb = pa = pb = ta = tb = 0
            in_tb = False; hold = brk = 0
            states = []
            open_g = []
            open_s = []
            for rec in g.itertuples(index=False):
                pw = to_int(rec.PointWinner, 0)
                if str(rec.PointNumber) in ('0X', '0Y') or pw == 0: continue
                srv_raw = to_int(rec.PointServer, 0)
                srv = 1 if srv_raw == 1 else (-1 if srv_raw == 2 else 0)
                states.append((sa, sb, ga, gb, pa, pb, ta, tb, 1 if in_tb else 0, srv, hold, brk, None, None))
                open_g.append(len(states) - 1)
                open_s.append(len(states) - 1)
                sw = to_int(rec.SetWinner, 0); gw = to_int(rec.GameWinner, 0)
                if sw or gw:
                    winner = sw or gw
                    if winner in (1, 2):
                        yg = 1 if winner == 1 else 0
                        for j in open_g:
                            t = states[j]
                            states[j] = t[:12] + (yg, t[13])
                        open_g = []
                        if sw:
                            ys = yg
                            for j in open_s:
                                t = states[j]
                                states[j] = t[:13] + (ys,)
                            open_s = []
                    server = srv_raw
                    if server and winner:
                        if server == winner:
                            hold, brk = (1, 0) if winner == 1 else (-1, 0)
                        else:
                            hold, brk = (0, 1) if winner == 1 else (0, -1)
                if sw:
                    if sw == 1: sa += 1
                    elif sw == 2: sb += 1
                    ga = gb = pa = pb = ta = tb = 0; in_tb = False
                elif gw:
                    ga = to_int(rec.P1GamesWon); gb = to_int(rec.P2GamesWon)
                    pa = pb = ta = tb = 0
                    in_tb = ga == 6 and gb == 6
                else:
                    ga = to_int(rec.P1GamesWon); gb = to_int(rec.P2GamesWon)
                    s1 = str(rec.P1Score).upper(); s2 = str(rec.P2Score).upper()
                    if ga == 6 and gb == 6:
                        in_tb = True; ta = to_int(s1); tb = to_int(s2); pa = pb = 0
                    else:
                        in_tb = False; ta = tb = 0
                        pa = PT.get(s1, 0); pb = PT.get(s2, 0)
            if len(states) < 8: continue
            joined += 1
            row = dict(p0=float(p0), bo=bo, s0=s0, y=y1, year=year, slam=slam, gender=hit['gender'],
                       surface=hit['surface'], qual=hit['qual'], lvl=hit['lvl'], diff=diff, states=states)
            if year >= 2023 and slam in ('wimbledon', 'usopen'): test.append(row)
            elif year == 2022: val.append(row)
            elif year < 2022: train.append(row)
    log('joined', joined, 'miss', miss, 'train', len(train), 'val', len(val), 'test', len(test))
    return train, val, test

def design(rows, scales, per=None, seed=1):
    xs, ys, offs, ws = [], [], [], []
    rng = np.random.default_rng(seed)
    for r in rows:
        idx = list(range(len(r['states'])))
        if per and len(idx) > per:
            # nech hranice gemů (body 0:0) a náhodný zbytek
            must = [i for i, s in enumerate(r['states']) if s[4] == 0 and s[5] == 0 and not s[8]]
            rest = [i for i in idx if i not in must]
            take = set(must)
            need = per - len(take)
            if need > 0 and rest:
                take.update(rng.choice(rest, size=min(need, len(rest)), replace=False).tolist())
            idx = sorted(take)
        ww = 1.0 / max(1, len(idx))
        ctx = live_ml.ctx_of(r['bo'], r['gender'], r['surface'], r['qual'], r['lvl'])
        off = logit(min(0.98, max(0.02, r['p0'])))
        for i in idx:
            s = r['states'][i]
            xs.append(live_ml.phi(s[0], s[1], s[2], s[3], s[4], s[5], s[6], s[7], bool(s[8]), s[9], s[10], s[11], r['diff'], ctx, scales))
            ys.append(r['y']); offs.append(off); ws.append(ww)
    return np.asarray(xs, np.float64), np.asarray(ys, np.float64), np.asarray(offs, np.float64), np.asarray(ws, np.float64)

def irls(X, y, offset, w, l2, iters=12):
    n, p = X.shape
    b = np.zeros(p)
    w = w / w.mean()
    for it in range(iters):
        ph = sig(offset + X @ b)
        var = np.maximum(ph * (1 - ph), 1e-5)
        W = w * var
        grad = X.T @ (w * (y - ph)) - l2 * b
        H = np.eye(p) * l2
        step = 80000
        for i in range(0, n, step):
            Xi = X[i:i+step]; Wi = W[i:i+step]
            H += (Xi * Wi[:, None]).T @ Xi
        delta = np.linalg.solve(H, grad)
        # zkrácený krok, ať se logit nerozjede
        step_s = 1.0
        for _ in range(6):
            trial = b + step_s * delta
            if np.max(np.abs(X @ trial)) < 8: break
            step_s *= 0.5
        b = b + step_s * delta
        log(f'  irls l2={l2} it={it} |d|={np.abs(delta).max():.3g} step={step_s}')
        if np.abs(delta).max() < 1e-4: break
    return b

def predict_rows(rows, b, scales):
    ps, ys = [], []
    for r in rows:
        ctx = live_ml.ctx_of(r['bo'], r['gender'], r['surface'], r['qual'], r['lvl'])
        off = logit(min(0.98, max(0.02, r['p0'])))
        for s in r['states']:
            x = live_ml.phi(s[0], s[1], s[2], s[3], s[4], s[5], s[6], s[7], bool(s[8]), s[9], s[10], s[11], r['diff'], ctx, scales)
            z = float(np.dot(b, x))
            z = max(-live_ml.ZCAP, min(live_ml.ZCAP, z))
            ps.append(sig(off + z)); ys.append(r['y'])
    return np.asarray(ps), np.asarray(ys)

def markov_rows(rows):
    out = np.empty(sum(len(r['states']) for r in rows))
    cur = 0
    for i, r in enumerate(rows):
        p0 = min(0.98, max(0.02, r['p0']))
        mk, base = fit_serve(p0, r['bo'], r['s0'])
        for s in r['states']:
            known = True if s[9] > 0 else False if s[9] < 0 else None
            out[cur] = markov_p(mk, base, p0, s, known); cur += 1
        if i and i % 80 == 0: log('markov', i, '/', len(rows))
    return out

def scales_of(rows):
    D = np.stack([r['diff'] for r in rows])
    sc = D.std(0)
    sc = np.where(sc < 1e-6, 1.0, sc)
    return sc

def main():
    lookup = walk_slam_feats()
    train, val, test = load_points(lookup)
    sc = scales_of(train + val)
    log('scales', np.round(sc, 3).tolist()[:8])
    log('design train')
    Xtr, ytr, otr, wtr = design(train, sc, per=36, seed=1)
    log('train matrix', Xtr.shape)
    best = None
    if val:
        log('design val')
        Xv, yv, ov, wv = design(val, sc, per=None, seed=2)
        for l2 in (8.0, 30.0, 80.0):
            b = irls(Xtr, ytr, otr, wtr, l2=l2, iters=8)
            pv = sig(ov + np.clip(Xv @ b, -live_ml.ZCAP, live_ml.ZCAP))
            m = mets(pv, yv)
            log('val', l2, m)
            if best is None or m['logloss'] < best[0]: best = (m['logloss'], l2)
    l2 = best[1] if best else 30.0
    log('chosen l2', l2, 'refit 2011-2022')
    Xall, yall, oall, wall = design(train + val, sc, per=36, seed=3)
    b = irls(Xall, yall, oall, wall, l2=l2, iters=10)
    log('test predict')
    pml, y = predict_rows(test, b, sc)
    # 0-0
    n00 = diff00 = 0
    cur = 0
    for r in test:
        for s in r['states']:
            if s[0] == s[1] == s[2] == s[3] == s[4] == s[5] == 0 and not s[8]:
                n00 += 1
                diff00 = max(diff00, abs(pml[cur] - min(0.98, max(0.02, r['p0']))))
            cur += 1
    log('0-0', n00, 'max|p-p0|', diff00)
    log('ML', mets(pml, y))
    log('markov test')
    pmk = markov_rows(test)
    log('MARKOV', mets(pmk, y))
    st = live_ml.empty(sc.tolist())
    st['w'] = [float(v) for v in b]
    st['w0'] = [float(v) for v in b]
    path = os.path.join(ROOT, 'state', 'live_online.json')
    live_ml.save(path, st)
    rep = dict(ml=mets(pml, y), markov=mets(pmk, y), l2=l2, n_train=len(train), n_val=len(val), n_test_matches=len(test),
               n_test_states=int(len(y)), zero_max_abs=diff00, zero_n=n00,
               test='2023-2024 Wimbledon and US Open point files, not used for fitting',
               train='slam point files 2011-2021, L2 chosen on 2022, refit 2011-2022',
               p0='deployed GBM pre-match probability, same value given to both models',
               note='No point history exists for Challenger or for 2025-26. Those levels use this model and then only live updates.')
    json.dump(rep, open(os.path.join(ROOT, 'data', 'live_ml_report.json'), 'w'), indent=1)
    log(json.dumps(rep))

if __name__ == '__main__':
    main()
