#!/usr/bin/env python3
"""Natrénuje hlavu „kdo vyhraje gem“ na stejných vstupech jako živý model zápasu.

Nepřepisuje zápasové váhy. Test je Wimbledon a US Open 2023–24, stejný řez jako u zápasu.
"""
import os, sys, json, time
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import live_ml
from train_live_ml import walk_slam_feats, load_points, irls, mets, sig, logit

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
T0 = time.time()
def log(*a): print(f'[{time.time()-T0:6.0f}s]', *a, flush=True)

def design(rows, scales, per=28, seed=1):
    xs, ys, offs, ws = [], [], [], []
    rng = np.random.default_rng(seed)
    for r in rows:
        idx = [i for i, s in enumerate(r['states']) if len(s) > 12 and s[12] is not None]
        if not idx: continue
        if per and len(idx) > per:
            must = [i for i in idx if r['states'][i][4] == 0 and r['states'][i][5] == 0 and not r['states'][i][8]]
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
            xs.append(live_ml.phi_game(s[0], s[1], s[2], s[3], s[4], s[5], s[6], s[7], bool(s[8]), s[9], s[10], s[11], r['diff'], ctx, scales))
            ys.append(s[12]); offs.append(off); ws.append(ww)
    return np.asarray(xs, np.float64), np.asarray(ys, np.float64), np.asarray(offs, np.float64), np.asarray(ws, np.float64)

def predict(rows, b, scales):
    ps, ys, base = [], [], []
    cap = live_ml.GAME_ZCAP
    for r in rows:
        ctx = live_ml.ctx_of(r['bo'], r['gender'], r['surface'], r['qual'], r['lvl'])
        off = logit(min(0.98, max(0.02, r['p0'])))
        for s in r['states']:
            if len(s) <= 12 or s[12] is None: continue
            x = live_ml.phi_game(s[0], s[1], s[2], s[3], s[4], s[5], s[6], s[7], bool(s[8]), s[9], s[10], s[11], r['diff'], ctx, scales)
            z = float(np.dot(b, x))
            z = max(-cap, min(cap, z))
            ps.append(sig(off + z)); ys.append(s[12]); base.append(sig(off))
    return np.asarray(ps), np.asarray(ys), np.asarray(base)

def main():
    lookup = walk_slam_feats()
    train, val, test = load_points(lookup)
    st = live_ml.load(os.path.join(ROOT, 'state', 'live_online.json'))
    sc = np.asarray(st['scale'], np.float64)
    log('design train', 'scale', len(sc))
    Xtr, ytr, otr, wtr = design(train, sc, per=28, seed=4)
    log('train', Xtr.shape, 'pos', round(float(ytr.mean()), 3))
    Xv, yv, ov, wv = design(val, sc, per=None, seed=5)
    log('val', Xv.shape)
    best = None
    for l2 in (20.0, 60.0, 150.0):
        b = irls(Xtr, ytr, otr, wtr, l2=l2, iters=8)
        pv = sig(ov + np.clip(Xv @ b, -live_ml.GAME_ZCAP, live_ml.GAME_ZCAP))
        m = mets(pv, yv)
        base = mets(sig(ov), yv)
        log('val', l2, 'model', m, 'p0', base)
        if best is None or m['logloss'] < best[0]:
            best = (m['logloss'], l2, b)
    l2 = best[1]
    log('chosen', l2)
    Xall, yall, oall, wall = design(train + val, sc, per=28, seed=6)
    b = irls(Xall, yall, oall, wall, l2=l2, iters=10)
    p, y, base = predict(test, b, sc)
    mm, mb = mets(p, y), mets(base, y)
    log('TEST model', mm)
    log('TEST p0-as-game', mb)
    rep = dict(game=mm, p0_baseline=mb, l2=l2, n_w=int(len(b)), w_abs_max=float(np.max(np.abs(b))),
               test='2023-2024 Wimbledon and US Open, game winner, not used for fitting')
    json.dump(rep, open(os.path.join(ROOT, 'data', 'game_ml_report.json'), 'w'), indent=1)
    # nasadit jen když je na drženém řezu lepší než předzápasová šance použitá jako odhad gemu
    if mm['logloss'] < mb['logloss']:
        st['gw'] = [float(v) for v in b]
        st['gw0'] = [float(v) for v in b]
        st['gn'] = int(st.get('gn') or 0)
        st['gseen'] = st.get('gseen') or []
        live_ml.save(os.path.join(ROOT, 'state', 'live_online.json'), st)
        # ověř, že zápasové váhy zůstaly
        chk = live_ml.load(os.path.join(ROOT, 'state', 'live_online.json'))
        log('saved gw', len(chk['gw']), 'match w unchanged', chk['w'] == st['w'])
    else:
        log('NOT SAVED, worse than p0 baseline')
    log(json.dumps(rep))

if __name__ == '__main__':
    main()
