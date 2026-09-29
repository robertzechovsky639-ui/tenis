#!/usr/bin/env python3
"""Trénink: ranking-only baseline, Elo-only, logistická regrese, LightGBM (+ ensemble).
Časové dělení: train < 2024-01-01, validace 2024 (early stopping, váhy ensemblu), test >= 2025-01-01.
Nasazený model = model trénovaný na train+valid (< 2025), takže metriky na testu jsou mimo vzorek."""
import os, sys, json, pickle
import numpy as np, pandas as pd
import lightgbm as lgb
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import log_loss, brier_score_loss, accuracy_score
sys.path.insert(0, os.path.dirname(__file__))
from engine import FEATS, DIFF, CTX
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = os.path.join(ROOT, 'data'); OUTW = os.path.join(ROOT, 'web', 'data'); os.makedirs(OUTW, exist_ok=True)

X = np.load(os.path.join(D, 'X.npy')); meta = pd.read_parquet(os.path.join(D, 'meta.parquet'))
y = meta['y'].to_numpy()
tr = (meta.tdate < 20240101).to_numpy(); va = ((meta.tdate >= 20240101) & (meta.tdate < 20250101)).to_numpy(); te = (meta.tdate >= 20250101).to_numpy()
trva = tr | va
di = [FEATS.index(f) for f in DIFF]
SWAP = {'eloA': 'eloB', 'eloB': 'eloA', 'ageA': 'ageB', 'ageB': 'ageA', 'lrankA': 'lrankB', 'lrankB': 'lrankA'}

def swap(Xm):
    Z = Xm.copy(); Z[:, di] = -Z[:, di]
    for a, b in SWAP.items(): Z[:, FEATS.index(a)] = Xm[:, FEATS.index(b)]
    return Z

def fit_lr(Xm, yv, cols, C=1.0):
    idx = [FEATS.index(c) for c in cols]
    Z = Xm[:, idx].astype(np.float64); sc = np.sqrt((Z ** 2).mean(0)) + 1e-9   # jen škálování -> antisymetrie
    m = LogisticRegression(C=C, fit_intercept=False, max_iter=3000); m.fit(Z / sc, yv)
    return dict(cols=cols, idx=idx, scale=sc, coef=m.coef_[0])

def pred_lr(m, Xm):
    z = (Xm[:, m['idx']].astype(np.float64) / m['scale']) @ m['coef']
    return 1 / (1 + np.exp(-z))

PARAMS = dict(objective='binary', learning_rate=0.06, num_leaves=31, min_data_in_leaf=400, feature_fraction=0.8,
              bagging_fraction=0.8, bagging_freq=1, lambda_l2=5.0, verbose=-1, seed=7, num_threads=8)

def pred_gbm(b, Xm): return 0.5 * (b.predict(Xm) + 1 - b.predict(swap(Xm)))

def metrics(p, yv):
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return dict(n=int(len(yv)), acc=round(float(accuracy_score(yv, p > 0.5)), 4), logloss=round(float(log_loss(yv, p, labels=[0, 1])), 4),
                brier=round(float(brier_score_loss(yv, p)), 4))

BASE = ['d_lrank', 'd_rmiss']; ELO = ['d_elo', 'd_selo']
lr_v = fit_lr(X[tr], y[tr], DIFF)
dtr = lgb.Dataset(X[tr], y[tr], feature_name=FEATS, free_raw_data=False); dva = lgb.Dataset(X[va], y[va], reference=dtr)
b_v = lgb.train(PARAMS, dtr, 1500, valid_sets=[dva], callbacks=[lgb.early_stopping(60, verbose=False)])
best_it = b_v.best_iteration; print('best_iteration', best_it, flush=True)
pv_lr, pv_gb = pred_lr(lr_v, X[va]), pred_gbm(b_v, X[va])
ws = np.linspace(0, 1, 21)
w_best = float(min(ws, key=lambda w: log_loss(y[va], np.clip(w * pv_gb + (1 - w) * pv_lr, 1e-6, 1 - 1e-6))))
print('w_gbm', w_best, 'valid gbm', metrics(pv_gb, y[va]), 'lr', metrics(pv_lr, y[va]), flush=True)
base = fit_lr(X[trva], y[trva], BASE); elo = fit_lr(X[trva], y[trva], ELO); lr = fit_lr(X[trva], y[trva], DIFF)
b = lgb.train(PARAMS, lgb.Dataset(X[trva], y[trva], feature_name=FEATS), max(50, int(best_it * 1.05)))
P = {'rank_baseline': pred_lr(base, X[te]), 'elo_only': pred_lr(elo, X[te]), 'logreg': pred_lr(lr, X[te]), 'lightgbm': pred_gbm(b, X[te])}
P['ensemble'] = w_best * P['lightgbm'] + (1 - w_best) * P['logreg']
mt = meta[te].reset_index(drop=True); yt = y[te]
res = {'overall': {k: metrics(v, yt) for k, v in P.items()}}
for grp in ['tour', 'chall', 'itf']:
    m = (mt.group == grp).to_numpy(); res[grp] = {k: metrics(v[m], yt[m]) for k, v in P.items()}
for g in ['M', 'W']:
    for grp in ['tour', 'chall', 'itf']:
        m = ((mt.group == grp) & (mt.gender == g)).to_numpy()
        if m.sum(): res[f'{g}_{grp}'] = {k: metrics(v[m], yt[m]) for k, v in P.items()}
m = (mt.is_qual == 1).to_numpy(); res['qual'] = {k: metrics(v[m], yt[m]) for k, v in P.items()}
pe = P['ensemble']; bins = np.clip((pe * 10).astype(int), 0, 9)
calib = [dict(bin=f'{i*10}-{i*10+10} %', n=int((bins == i).sum()), pred=round(float(pe[bins == i].mean()), 3) if (bins == i).any() else None,
              obs=round(float(yt[bins == i].mean()), 3) if (bins == i).any() else None) for i in range(10)]
imp = sorted(zip(FEATS, b.feature_importance('gain')), key=lambda x: -x[1]); tot = sum(v for _, v in imp)
out = dict(split=dict(train='2005-01-01 – 2023-12-31', valid='2024', test='2025-01-01 – ' + str(int(meta.tdate.max())),
                      n_train=int(tr.sum()), n_valid=int(va.sum()), n_test=int(te.sum())),
           metrics=res, calibration=calib, ensemble_w_gbm=w_best, gbm_trees=int(b.num_trees()),
           importance=[(f, round(float(v) / tot, 4)) for f, v in imp],
           lr_coef={c: round(float(w), 4) for c, w in zip(lr['cols'], lr['coef'])})
json.dump(out, open(os.path.join(D, 'metrics.json'), 'w'), indent=1, ensure_ascii=False)
print(json.dumps(res['overall'], indent=0)); print({g: res[g]['ensemble'] for g in ['tour', 'chall', 'itf']})
print({g: res[g]['rank_baseline'] for g in ['tour', 'chall', 'itf']})
print(out['importance'][:15])

def r(x, d=6): return float(f'{x:.{d}g}')
trees = []
for t in b.dump_model()['tree_info']:
    feat, thr, left, right, leaf = [], [], [], [], []
    def walk(nd):
        if 'leaf_value' in nd:
            leaf.append(r(nd['leaf_value'])); return -len(leaf)
        i = len(feat); feat.append(nd['split_feature']); thr.append(r(nd['threshold'], 8)); left.append(0); right.append(0)
        assert nd['decision_type'] == '<='
        left[i] = walk(nd['left_child']); right[i] = walk(nd['right_child']); return i
    walk(t['tree_structure']); trees.append([feat, thr, left, right, leaf])
model = dict(feats=FEATS, diff=DIFF, swap=SWAP, w_gbm=w_best,
             lr=dict(cols=lr['cols'], scale=[r(s) for s in lr['scale']], coef=[r(c) for c in lr['coef']]),
             base=dict(cols=base['cols'], scale=[r(s) for s in base['scale']], coef=[r(c) for c in base['coef']]),
             gbm=dict(trees=trees))
json.dump(model, open(os.path.join(OUTW, 'model.json'), 'w'), separators=(',', ':'))
b.save_model(os.path.join(D, 'gbm.txt'))
pickle.dump(dict(lr=lr, base=base, w=w_best), open(os.path.join(D, 'lr.pkl'), 'wb'))
print('model.json KB', os.path.getsize(os.path.join(OUTW, 'model.json')) // 1024)
