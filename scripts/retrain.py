#!/usr/bin/env python3
"""Týdenní přetrénování modelu v2 (GitHub Actions, bez ladění hyperparametrů) s bezpečnostní bránou.
Časové řezy (dny, D = poslední den v datech):
  holdout   = (D − 84, D]            posledních 12 týdnů – NIKDY k tréninku kandidáta ani kalibraci
  validace  = (D − 168, D − 84]      12 týdnů před holdoutem – early stopping + kalibrace + váha ensemblu
  okno      = posledních TRAIN_YEARS let
Kandidát = stejné příznaky/hyperparametry v2, trénink do začátku holdoutu. Současný model se hodnotí na stejném holdoutu:
  – pokud jeho trénink skončil před holdoutem, přímo (poctivé);
  – jinak jeho „dvojče“ = stejný recept natrénovaný jen na data před jeho vlastním holdoutem (model_info.twin_end), které holdout také nevidělo.
Brána: kandidát lepší v log loss, Brier ne horší a přesnost nejvýš o 0,3 p. b. horší -> refit na všech datech -> nasazení.
Výsledek se zapisuje do data/retrain_history.json (zobrazuje záložka Model).
  python scripts/retrain.py            # přetrénování + brána
  python scripts/retrain.py --revert   # vrátí předchozí model (např. když selže test parity JS == Python)"""
import os, sys, json, time, shutil, argparse, math
import numpy as np, pandas as pd, lightgbm as lgb
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import log_loss, brier_score_loss, accuracy_score
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from engine import FEATS, DIFF
import trainset
ROOT = trainset.ROOT; D = os.path.join(ROOT, 'data'); WD = os.path.join(ROOT, 'web', 'data'); PREV = os.path.join(D, 'prev')
FILES = [os.path.join(D, 'gbm.txt'), os.path.join(WD, 'model.json'), os.path.join(D, 'model_info.json')]
HIST = os.path.join(D, 'retrain_history.json')
HOLD_DAYS, VAL_DAYS, TRAIN_YEARS = 84, 84, 15
SWAP = {'eloA': 'eloB', 'eloB': 'eloA', 'ageA': 'ageB', 'ageB': 'ageA', 'lrankA': 'lrankB', 'lrankB': 'lrankA'}
PARAMS = dict(objective='binary', learning_rate=0.04, num_leaves=127, min_data_in_leaf=600, feature_fraction=0.7, bagging_fraction=0.8,
              bagging_freq=1, lambda_l2=5.0, verbose=-1, seed=7, deterministic=True, force_row_wise=True, num_threads=int(os.environ.get('RETRAIN_THREADS', os.cpu_count() or 4)))
T0 = time.time()
def log(*a): print(f'[{time.time() - T0:6.0f} s]', *a, flush=True)
def dstr(d): return str((pd.Timestamp('1970-01-01') + pd.Timedelta(days=int(d))).date())
def clip(p): return np.clip(p, 1e-6, 1 - 1e-6)
def logit(p): p = clip(p); return np.log(p / (1 - p))
def sig(z): return 1 / (1 + np.exp(-z))
def mets(p, y): p = clip(p); return dict(n=int(len(y)), acc=round(float(accuracy_score(y, p > 0.5)), 4), logloss=round(float(log_loss(y, p, labels=[0, 1])), 4), brier=round(float(brier_score_loss(y, p)), 4))
def ll(p, y): return float(log_loss(y, clip(p), labels=[0, 1]))
def swapm(X):
    Z = X.copy()
    for j, c in enumerate(FEATS):
        if c in DIFF: Z[:, j] = -X[:, j]
        elif c in SWAP: Z[:, j] = X[:, FEATS.index(SWAP[c])]
    return Z
def p_gbm(b, X): return 0.5 * (b.predict(X) + 1 - b.predict(swapm(X)))
def fit_lr(X, y, cols):
    idx = [FEATS.index(c) for c in cols]; Z = X[:, idx].astype(np.float64); sc = np.sqrt((Z ** 2).mean(0)) + 1e-9
    m = LogisticRegression(C=1.0, fit_intercept=False, max_iter=3000); m.fit(Z / sc, y)
    return dict(cols=cols, scale=sc.tolist(), coef=m.coef_[0].tolist())
def p_lr(L, X):
    idx = [FEATS.index(c) for c in L['cols']]
    return sig((X[:, idx].astype(np.float64) / np.asarray(L['scale'])) @ np.asarray(L['coef']))
def ens(b, L, a, w, X):
    pg = p_gbm(b, X); pg = sig(a * logit(pg)) if a != 1.0 else pg
    return w * pg + (1 - w) * (p_lr(L, X) if w < 1 else 0)
def train(X, y, it): return lgb.train(PARAMS, lgb.Dataset(X, y, feature_name=FEATS, params={'feature_pre_filter': False}), it)

def recipe(X, y, day, start, end, val_days=VAL_DAYS):
    """Kalibrace na validaci (end − val_days, end], pak trénink na [start, end]. Vrací model + parametry."""
    vs = end - val_days
    tr = (day >= start) & (day <= vs); va = (day > vs) & (day <= end)
    dtr = lgb.Dataset(X[tr], y[tr], feature_name=FEATS, free_raw_data=False, params={'feature_pre_filter': False})
    b = lgb.train(PARAMS, dtr, 1500, valid_sets=[lgb.Dataset(X[va], y[va], reference=dtr)], callbacks=[lgb.early_stopping(80, verbose=False)])
    it = int(min(900, max(150, b.best_iteration))); pv = p_gbm(b, X[va]); v0 = ll(pv, y[va])
    grid = np.linspace(0.8, 1.25, 46); a = float(min(grid, key=lambda a: ll(sig(a * logit(pv)), y[va])))
    if ll(sig(a * logit(pv)), y[va]) > v0 - 0.0003: a = 1.0
    Lv = fit_lr(X[tr], y[tr], DIFF); pl = p_lr(Lv, X[va]); pc = sig(a * logit(pv))
    w = float(min(np.linspace(0, 1, 21), key=lambda w: ll(w * pc + (1 - w) * pl, y[va])))
    log(f'  validace {dstr(vs + 1)}..{dstr(end)} n={int(va.sum())}: iterace {b.best_iteration} -> {it}, kalibrace a={a:.3f}, w_gbm={w:.2f}')
    full = (day >= start) & (day <= end)
    bf = train(X[full], y[full], max(50, int(it * 1.05))); Lf = fit_lr(X[full], y[full], DIFF)
    return dict(b=bf, lr=Lf, a=a, w=w, it=it, trees=bf.num_trees(), start=int(start), end=int(end), n_train=int(full.sum()))

def r6(x, d=6): return float(f'{x:.{d}g}')
def write_model(R, X, y, day, start, end, holdout_start):
    base = fit_lr(X[(day >= start) & (day <= end)], y[(day >= start) & (day <= end)], ['d_lrank', 'd_rmiss'])
    trees = []
    for t in R['b'].dump_model()['tree_info']:
        feat, thr, left, right, leaf = [], [], [], [], []
        def walk(nd):
            if 'leaf_value' in nd: leaf.append(r6(nd['leaf_value'])); return -len(leaf)
            i = len(feat); feat.append(nd['split_feature']); thr.append(r6(nd['threshold'], 8)); left.append(0); right.append(0)
            assert nd['decision_type'] == '<='
            left[i] = walk(nd['left_child']); right[i] = walk(nd['right_child']); return i
        walk(t['tree_structure']); trees.append([feat, thr, left, right, leaf])
    L = R['lr']
    model = dict(feats=FEATS, diff=DIFF, swap=SWAP, w_gbm=R['w'], cal=R['a'],
                 lr=dict(cols=L['cols'], scale=[r6(s) for s in L['scale']], coef=[r6(c) for c in L['coef']]),
                 base=dict(cols=base['cols'], scale=[r6(s) for s in base['scale']], coef=[r6(c) for c in base['coef']]), gbm=dict(trees=trees))
    json.dump(model, open(os.path.join(WD, 'model.json'), 'w'), separators=(',', ':'))
    R['b'].save_model(os.path.join(D, 'gbm.txt'))
    info = dict(version='v2-weekly', trained_at=time.strftime('%Y-%m-%d %H:%M %Z'), train_start=dstr(start), train_end=dstr(end), train_end_day=int(end),
                twin_end_day=int(holdout_start - 1), n_train=R['n_train'], iterations=R['it'], trees=R['trees'], cal=R['a'], w_gbm=R['w'],
                params={k: PARAMS[k] for k in ('learning_rate', 'num_leaves', 'min_data_in_leaf', 'feature_fraction', 'lambda_l2')}, train_years=TRAIN_YEARS)
    json.dump(info, open(os.path.join(D, 'model_info.json'), 'w'), indent=1, ensure_ascii=False)

def current_model():
    m = json.load(open(os.path.join(WD, 'model.json'))); info = json.load(open(os.path.join(D, 'model_info.json')))
    b = lgb.Booster(model_file=os.path.join(D, 'gbm.txt'))
    return b, dict(cols=m['lr']['cols'], scale=m['lr']['scale'], coef=m['lr']['coef']), float(m.get('cal', 1.0)), float(m['w_gbm']), info

def history_add(e):
    h = json.load(open(HIST)) if os.path.exists(HIST) else []
    h.append(e); json.dump(h[-60:], open(HIST, 'w'), indent=1, ensure_ascii=False)

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--revert', action='store_true'); a = ap.parse_args()
    if a.revert:
        for f in FILES:
            src = os.path.join(PREV, os.path.basename(f))
            if os.path.exists(src): shutil.copy2(src, f)
        h = json.load(open(HIST)); h[-1]['decision'] = 'zamítnuto – test parity JS == Python selhal, ponechán předchozí model'; h[-1]['deployed'] = False
        json.dump(h, open(HIST, 'w'), indent=1, ensure_ascii=False); print('vráceno na předchozí model'); return
    d = trainset.load_all(); d = d[d['tdate'] >= 20050101]
    X = d[FEATS].to_numpy(np.float32); y = d['y'].to_numpy(); day = d['day'].to_numpy()
    Dmax = int(day.max()); hs = Dmax - HOLD_DAYS + 1; start = hs - int(TRAIN_YEARS * 365.25)
    ho = day >= hs; yh = y[ho]
    log(f'data: {len(d)} řádků, {dstr(day.min())}..{dstr(Dmax)} | holdout {dstr(hs)}..{dstr(Dmax)} n={int(ho.sum())} | okno od {dstr(start)} | vláken {PARAMS["num_threads"]}')
    log('kandidát (trénink do začátku holdoutu)…')
    C = recipe(X, y, day, start, hs - 1); pc = ens(C['b'], C['lr'], C['a'], C['w'], X[ho]); mc = mets(pc, yh)
    log('  kandidát na holdoutu', mc, 'stromů', C['trees'])
    b0, L0, a0, w0, info = current_model()
    if info['train_end_day'] < hs:
        po = ens(b0, L0, a0, w0, X[ho]); how = f'současný model přímo (trénink do {info["train_end"]})'
    else:
        te = int(info['twin_end_day']); log(f'současný model viděl část holdoutu -> dvojče (stejný recept, data do {dstr(te)})…')
        T = recipe(X, y, day, te + 1 - int(info.get('train_years', TRAIN_YEARS) * 365.25), te); po = ens(T['b'], T['lr'], T['a'], T['w'], X[ho])
        how = f'dvojče současného modelu (data do {dstr(te)})'
    mo = mets(po, yh); log('  současný na holdoutu', mo, '|', how)
    by = {}
    grp = d['group'].to_numpy()[ho]
    for g in ('tour', 'chall', 'itf'):
        m = grp == g
        if m.sum() >= 50: by[g] = dict(n=int(m.sum()), old=mets(po[m], yh[m]), new=mets(pc[m], yh[m]))
    gate = mc['logloss'] < mo['logloss'] and mc['brier'] <= mo['brier'] and mc['acc'] >= mo['acc'] - 0.003
    e = dict(date=time.strftime('%Y-%m-%d %H:%M %Z'), holdout=f'{dstr(hs)} – {dstr(Dmax)}', n_holdout=int(ho.sum()), old=mo, new=mc, compared=how, by_group=by,
             candidate=dict(train=f'{dstr(start)} – {dstr(hs - 1)}', n_train=C['n_train'], iterations=C['it'], cal=C['a'], w_gbm=C['w']))
    if gate:
        os.makedirs(PREV, exist_ok=True)
        for f in FILES:
            if os.path.exists(f): shutil.copy2(f, os.path.join(PREV, os.path.basename(f)))
        log('BRÁNA: kandidát je lepší -> refit na všech datech do', dstr(Dmax))
        startF = Dmax + 1 - int(TRAIN_YEARS * 365.25)
        # refit: stejný počet iterací, kalibrace a váha jako kandidát (odhadnuté poctivě před holdoutem), jen víc dat
        full = (day >= startF) & (day <= Dmax); bF = train(X[full], y[full], max(50, int(C['it'] * 1.05)))
        F = dict(b=bF, lr=fit_lr(X[full], y[full], DIFF), a=C['a'], w=C['w'], it=C['it'], trees=bF.num_trees(), n_train=int(full.sum()))
        write_model(F, X, y, day, startF, Dmax, hs)
        e.update(decision='nasazeno – kandidát lepší v log loss i Brier', deployed=True, final=dict(train=f'{dstr(startF)} – {dstr(Dmax)}', n_train=F['n_train'], trees=F['trees'], cal=F['a'], w_gbm=F['w']))
    else:
        e.update(decision='ponechán současný model – kandidát není lepší', deployed=False)
    e['runtime_s'] = round(time.time() - T0); history_add(e)
    log('ROZHODNUTÍ:', e['decision']); print(json.dumps(e, ensure_ascii=False, indent=1))
    if os.environ.get('GITHUB_OUTPUT'):
        with open(os.environ['GITHUB_OUTPUT'], 'a') as f: f.write(f"deployed={'true' if gate else 'false'}\n")

if __name__ == '__main__':
    main()
