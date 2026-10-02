#!/usr/bin/env python3
"""Natrénuje hlavu „kdo vyhraje set“ na stejných vstupech jako živý model zápasu.

Nepřepisuje zápasové ani gemové váhy. Test je Wimbledon a US Open 2023–24.
"""
import os, sys, json, time
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import live_ml
from train_live_ml import walk_slam_feats, load_points, irls, mets, sig, logit

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
T0 = time.time()
def log(*a): print(f'[{time.time()-T0:6.0f}s]', *a, flush=True)

def design(rows, scales, per=24, seed=1):
    xs, ys, offs, ws = [], [], [], []
    rng = np.random.default_rng(seed)
    for r in rows:
        idx = [i for i, s in enumerate(r['states']) if len(s) > 13 and s[13] is not None]
        if not idx: continue
        if per and len(idx) > per:
            must = [i for i in idx if r['states'][i][2] == 0 and r['states'][i][3] == 0 and r['states'][i][4] == 0 and r['states'][i][5] == 0 and not r['states'][i][8]]
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
            start = s[2] == 0 and s[3] == 0 and s[4] == 0 and s[5] == 0 and not s[8]
            xs.append(live_ml.phi_set(s[0], s[1], s[2], s[3], s[4], s[5], s[6], s[7], bool(s[8]), s[9], s[10], s[11], r['diff'], ctx, scales))
            ys.append(s[13]); offs.append(off); ws.append(ww * (8.0 if start else 1.0))
    return np.asarray(xs, np.float64), np.asarray(ys, np.float64), np.asarray(offs, np.float64), np.asarray(ws, np.float64)

def predict(rows, b, scales):
    ps, ys, base = [], [], []
    cap = live_ml.SET_ZCAP
    for r in rows:
        ctx = live_ml.ctx_of(r['bo'], r['gender'], r['surface'], r['qual'], r['lvl'])
        off = logit(min(0.98, max(0.02, r['p0'])))
        for s in r['states']:
            if len(s) <= 13 or s[13] is None: continue
            x = live_ml.phi_set(s[0], s[1], s[2], s[3], s[4], s[5], s[6], s[7], bool(s[8]), s[9], s[10], s[11], r['diff'], ctx, scales)
            z = float(np.dot(b, x))
            z = max(-cap, min(cap, z))
            ps.append(sig(off + z)); ys.append(s[13]); base.append(sig(off))
    return np.asarray(ps), np.asarray(ys), np.asarray(base)

def main():
    lookup = walk_slam_feats()
    train, val, test = load_points(lookup)
    path = os.path.join(ROOT, 'state', 'live_online.json')
    st0 = live_ml.load(path)
    sc = np.asarray(st0['scale'], np.float64)
    log('design', 'set weights', live_ml.n_set_weights())
    Xtr, ytr, otr, wtr = design(train, sc, per=24, seed=7)
    log('train', Xtr.shape, 'pos', round(float(ytr.mean()), 3))
    Xv, yv, ov, wv = design(val, sc, per=None, seed=8)
    log('val', Xv.shape)
    best = None
    for l2 in (20.0, 80.0, 200.0):
        b = irls(Xtr, ytr, otr, wtr, l2=l2, iters=8)
        pv = sig(ov + np.clip(Xv @ b, -live_ml.SET_ZCAP, live_ml.SET_ZCAP))
        m = mets(pv, yv)
        log('val', l2, m, 'p0', mets(sig(ov), yv))
        if best is None or m['logloss'] < best[0]:
            best = (m['logloss'], l2)
    l2 = best[1]
    log('chosen', l2)
    Xall, yall, oall, wall = design(train + val, sc, per=24, seed=9)
    b = irls(Xall, yall, oall, wall, l2=l2, iters=10)
    p, y, base = predict(test, b, sc)
    mm, mb = mets(p, y), mets(base, y)
    # 0-0 first set: must not be identical to p0 if the bias learned anything
    n00 = diff = 0
    for r in test:
        ctx = live_ml.ctx_of(r['bo'], r['gender'], r['surface'], r['qual'], r['lvl'])
        x = live_ml.phi_set(0, 0, 0, 0, 0, 0, 0, 0, False, 0, 0, 0, r['diff'], ctx, sc)
        z = max(-live_ml.SET_ZCAP, min(live_ml.SET_ZCAP, float(np.dot(b, x))))
        pr = sig(logit(min(0.98, max(0.02, r['p0']))) + z)
        diff = max(diff, abs(pr - r['p0']))
        n00 += 1
    log('TEST', mm, 'p0', mb, '0-0 max|p-p0|', diff, 'n', n00)
    rep = dict(set=mm, p0_baseline=mb, l2=l2, zero_max_abs=diff, w_abs_max=float(np.max(np.abs(b))),
               test='2023-2024 Wimbledon and US Open, set winner, not used for fitting')
    json.dump(rep, open(os.path.join(ROOT, 'data', 'set_ml_report.json'), 'w'), indent=1)
    if mm['logloss'] < mb['logloss']:
        st = live_ml.load(path)
        st['sw'] = [float(v) for v in b]
        st['sw0'] = [float(v) for v in b]
        live_ml.save(path, st)
        chk = live_ml.load(path)
        log('saved', len(chk['sw']), 'match', chk['w'] == st['w'], 'game', chk['gw'] == st['gw'])
    else:
        log('NOT SAVED')
    log(json.dumps(rep))

if __name__ == '__main__':
    main()
