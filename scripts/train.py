#!/usr/bin/env python3
"""Trénink v2 s poctivým časovým holdoutem.
Holdout (test) = zápasy od 2026-01-01 (nikdy nepoužity k tréninku, ladění ani kalibraci).
- PŮVODNÍ recept (v1): příznaky v1, train < 2024, validace 2024, refit < 2025 -> skóre na holdoutu.
- NOVÝ recept (v2): příznaky v2 (Elo z gemů, časově vážená forma, nejistota, neaktivita, dominance),
  train < 2025-07, validace 2025-07..12 (early stopping, výběr hyperparametrů, kalibrace, váha ensemblu), refit < 2026.
Nasazený model = NOVÝ recept, pokud je na holdoutu lepší v log loss i Brier; jinak se nasadí v1 recept."""
import os, sys, json, pickle, time
import numpy as np, pandas as pd
import lightgbm as lgb
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import log_loss, brier_score_loss, accuracy_score
sys.path.insert(0, os.path.dirname(__file__))
from engine import FEATS, DIFF, CTX
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = os.path.join(ROOT, 'data'); OUTW = os.path.join(ROOT, 'web', 'data'); os.makedirs(OUTW, exist_ok=True)
T0 = time.time()
X = np.load(os.path.join(D, 'X.npy')); meta = pd.read_parquet(os.path.join(D, 'meta.parquet'))
y = meta['y'].to_numpy(); td = meta.tdate.to_numpy()
HOLD = 20260101
te = td >= HOLD
DIFF_V1 = DIFF[:27]; FE_V1 = DIFF_V1 + CTX
SWAP = {'eloA': 'eloB', 'eloB': 'eloA', 'ageA': 'ageB', 'ageB': 'ageA', 'lrankA': 'lrankB', 'lrankB': 'lrankA'}

def cols_idx(cols): return [FEATS.index(c) for c in cols]
def swap(Xm, cols):
    Z = Xm.copy()
    for j, c in enumerate(cols):
        if c in DIFF: Z[:, j] = -Xm[:, j]
        elif c in SWAP: Z[:, j] = Xm[:, cols.index(SWAP[c])]
    return Z
def fit_lr(Xm, yv, cols, C=1.0):
    idx = cols_idx(cols)
    Z = Xm[:, idx].astype(np.float64); sc = np.sqrt((Z ** 2).mean(0)) + 1e-9
    m = LogisticRegression(C=C, fit_intercept=False, max_iter=3000); m.fit(Z / sc, yv)
    return dict(cols=cols, idx=idx, scale=sc, coef=m.coef_[0])
def pred_lr(m, Xm):
    z = (Xm[:, m['idx']].astype(np.float64) / m['scale']) @ m['coef']
    return 1 / (1 + np.exp(-z))
def pred_gbm(b, Xs, cols): return 0.5 * (b.predict(Xs) + 1 - b.predict(swap(Xs, cols)))
def metrics(p, yv):
    p = np.clip(p, 1e-6, 1 - 1e-6)
    return dict(n=int(len(yv)), acc=round(float(accuracy_score(yv, p > 0.5)), 4), logloss=round(float(log_loss(yv, p, labels=[0, 1])), 4),
                brier=round(float(brier_score_loss(yv, p)), 4))
def ll(p, yv): return float(log_loss(yv, np.clip(p, 1e-6, 1 - 1e-6), labels=[0, 1]))
logit = lambda p: np.log(np.clip(p, 1e-6, 1 - 1e-6) / (1 - np.clip(p, 1e-6, 1 - 1e-6)))

P_V1 = dict(objective='binary', learning_rate=0.06, num_leaves=31, min_data_in_leaf=400, feature_fraction=0.8,
            bagging_fraction=0.8, bagging_freq=1, lambda_l2=5.0, verbose=-1, seed=7, num_threads=8)
GRID = [P_V1,
        {**P_V1, 'learning_rate': 0.04, 'num_leaves': 63, 'min_data_in_leaf': 300},
        {**P_V1, 'learning_rate': 0.04, 'num_leaves': 127, 'min_data_in_leaf': 600, 'feature_fraction': 0.7},
        {**P_V1, 'learning_rate': 0.05, 'num_leaves': 31, 'min_data_in_leaf': 1000, 'lambda_l2': 10.0, 'feature_fraction': 0.7}]

def recipe(cols, tr, va, refit, grid, name):
    idx = cols_idx(cols); Xc = X[:, idx]
    dtr = lgb.Dataset(Xc[tr], y[tr], feature_name=cols, free_raw_data=False, params={'feature_pre_filter': False}); dva = lgb.Dataset(Xc[va], y[va], reference=dtr)
    best = None; tried = []
    for k, prm in enumerate(grid):
        b = lgb.train(prm, dtr, 3000, valid_sets=[dva], callbacks=[lgb.early_stopping(80, verbose=False)])
        pv = pred_gbm(b, Xc[va], cols); v = ll(pv, y[va])
        tried.append(dict(k=k, lr=prm['learning_rate'], leaves=prm['num_leaves'], min_leaf=prm['min_data_in_leaf'], it=b.best_iteration, valid_ll=round(v, 5)))
        print(name, tried[-1], round(time.time() - T0), 's', flush=True)
        if best is None or v < best[0]: best = (v, prm, b.best_iteration, pv)
    v, prm, it, pv = best
    # kalibrace: jediný škálovací faktor logitu (zachová antisymetrii), odhad na validaci
    a_grid = np.linspace(0.8, 1.25, 46); a = float(min(a_grid, key=lambda a: ll(1 / (1 + np.exp(-a * logit(pv))), y[va])))
    if ll(1 / (1 + np.exp(-a * logit(pv))), y[va]) > v - 0.0003: a = 1.0
    lr_v = fit_lr(X[tr], y[tr], [c for c in cols if c in DIFF]); pvl = pred_lr(lr_v, X[va])
    pvc = 1 / (1 + np.exp(-a * logit(pv)))
    w = float(min(np.linspace(0, 1, 21), key=lambda w: ll(w * pvc + (1 - w) * pvl, y[va])))
    b = lgb.train(prm, lgb.Dataset(Xc[refit], y[refit], feature_name=cols), max(50, int(it * 1.05)))
    lr = fit_lr(X[refit], y[refit], [c for c in cols if c in DIFF])
    pt = 1 / (1 + np.exp(-a * logit(pred_gbm(b, Xc[te], cols))))
    pe = w * pt + (1 - w) * pred_lr(lr, X[te])
    print(name, 'cal a', a, 'w_gbm', w, 'trees', b.num_trees(), 'HOLDOUT', metrics(pe, y[te]), flush=True)
    return dict(b=b, lr=lr, a=a, w=w, prm=prm, it=it, cols=cols, grid=tried, p_gbm=pt, p=pe, p_lr=pred_lr(lr, X[te]))

tr1 = td < 20240101; va1 = (td >= 20240101) & (td < 20250101); rf1 = td < 20250101
tr2 = td < 20250701; va2 = (td >= 20250701) & (td < HOLD); rf2 = td < HOLD
old = recipe(FE_V1, tr1, va1, rf1, [P_V1], 'V1 (původní)')
abl = recipe(FE_V1, tr2, va2, rf2, [P_V1], 'V1 příznaky + nová data')
new = recipe(FEATS, tr2, va2, rf2, GRID, 'V2 (nový)')
yt = y[te]
dep_path = os.path.join(ROOT, 'scripts', 'exp', 'gbm_v1_deployed.txt')
if os.path.exists(dep_path):   # přesně ten model, který byl dosud nasazen (w_gbm = 1.0 -> čistý symetrizovaný LightGBM)
    bd = lgb.Booster(model_file=dep_path); Xd = X[te][:, cols_idx(FE_V1)]
    old['p_deployed'] = pred_gbm(bd, Xd, FE_V1); print('nasazený v1 na holdoutu', metrics(old['p_deployed'], y[te]), flush=True)
po = old.get('p_deployed', old['p'])
gate = metrics(new['p'], yt)['logloss'] < metrics(po, yt)['logloss'] and metrics(new['p'], yt)['brier'] <= metrics(po, yt)['brier']
print('GATE (nový lepší na holdoutu):', gate, flush=True)
if not gate:
    raise SystemExit('Nový model NENÍ lepší na holdoutu – nenasazuji (ponechte předchozí model.json).')
SH = new
BASE = ['d_lrank', 'd_rmiss']; ELO = ['d_elo', 'd_selo']
base = fit_lr(X[rf2], y[rf2], BASE); elo = fit_lr(X[rf2], y[rf2], ELO); gel = fit_lr(X[rf2], y[rf2], ['d_gelo', 'd_gselo'])
P = {'rank_baseline': pred_lr(base, X[te]), 'elo_only': pred_lr(elo, X[te]), 'gelo_only': pred_lr(gel, X[te]), 'logreg': SH['p_lr'],
     'lightgbm': SH['p_gbm'], 'ensemble': SH['p'], 'old_model': old.get('p_deployed', old['p']), 'v1_recipe': old['p'], 'v1_newdata': abl['p']}
mt = meta[te].reset_index(drop=True)
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
imp = sorted(zip(SH['cols'], SH['b'].feature_importance('gain')), key=lambda x: -x[1]); tot = sum(v for _, v in imp)
out = dict(version=2, split=dict(train='2005-01-01 – 2025-06-30', valid='2025-07-01 – 2025-12-31', refit='2005-01-01 – 2025-12-31',
                      test='2026-01-01 – ' + str(int(td.max())), n_train=int(tr2.sum()), n_valid=int(va2.sum()), n_test=int(te.sum())),
           old_split=dict(train='2005–2023', valid='2024', refit='2005–2024'),
           metrics=res, calibration=calib, ensemble_w_gbm=SH['w'], cal_a=SH['a'], gbm_trees=int(SH['b'].num_trees()),
           params={k: SH['prm'][k] for k in ('learning_rate', 'num_leaves', 'min_data_in_leaf', 'feature_fraction', 'lambda_l2')},
           grid=SH['grid'], importance=[(f, round(float(v) / tot, 4)) for f, v in imp],
           lr_coef={c: round(float(w), 4) for c, w in zip(SH['lr']['cols'], SH['lr']['coef'])})
json.dump(out, open(os.path.join(D, 'metrics.json'), 'w'), indent=1, ensure_ascii=False)
print(json.dumps(res['overall'], indent=0)); print(out['importance'][:15])

def r(x, d=6): return float(f'{x:.{d}g}')
trees = []
for t in SH['b'].dump_model()['tree_info']:
    feat, thr, left, right, leaf = [], [], [], [], []
    def walk(nd):
        if 'leaf_value' in nd:
            leaf.append(r(nd['leaf_value'])); return -len(leaf)
        i = len(feat); feat.append(nd['split_feature']); thr.append(r(nd['threshold'], 8)); left.append(0); right.append(0)
        assert nd['decision_type'] == '<='
        left[i] = walk(nd['left_child']); right[i] = walk(nd['right_child']); return i
    walk(t['tree_structure']); trees.append([feat, thr, left, right, leaf])
lr = SH['lr']
model = dict(feats=FEATS, diff=DIFF, swap=SWAP, w_gbm=SH['w'], cal=SH['a'],
             lr=dict(cols=lr['cols'], scale=[r(s) for s in lr['scale']], coef=[r(c) for c in lr['coef']]),
             base=dict(cols=base['cols'], scale=[r(s) for s in base['scale']], coef=[r(c) for c in base['coef']]),
             gbm=dict(trees=trees))
json.dump(model, open(os.path.join(OUTW, 'model.json'), 'w'), separators=(',', ':'))
SH['b'].save_model(os.path.join(D, 'gbm.txt'))
pickle.dump(dict(lr=lr, base=base, w=SH['w'], a=SH['a']), open(os.path.join(D, 'lr.pkl'), 'wb'))
print('model.json KB', os.path.getsize(os.path.join(OUTW, 'model.json')) // 1024, 'total s', round(time.time() - T0))
