#!/usr/bin/env python3
"""Kompaktní trénovací sada (příznaky PŘED zápasem + výsledek) pro týdenní přetrénování v CI.
  init   – z plné přestavby (data/X.npy + meta.parquet) vytvoří trainset/trainset.parquet (zápasy od 2010)
  merge  – připojí nové řádky z denních aktualizací (state/train_new.csv) a soubor state/train_new.csv vyprázdní
Soubor trainset.parquet se v repozitáři neukládá – je jako asset GitHub Release „trainset“ (stahuje/nahrává workflow)."""
import os, sys, csv
import numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from engine import FEATS
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TS = os.path.join(ROOT, 'trainset', 'trainset.parquet'); NEW = os.path.join(ROOT, 'state', 'train_new.csv')
META = ['tdate', 'day', 'y', 'group']   # gender/lvl_code/is_qual jsou už mezi příznaky
HEAD = META + ['mk'] + FEATS
FROM = 20100101

def rnd(a): return np.float32(np.round(a.astype(np.float64), 5))   # 5 desetinných míst stačí, lépe se komprimuje

def load_new():
    if not os.path.exists(NEW) or os.path.getsize(NEW) == 0: return None
    d = pd.read_csv(NEW, dtype={'group': str, 'mk': str})
    return d if len(d) else None

def load_all():
    """Celá sada = trainset.parquet (+ ještě nesloučené denní řádky)."""
    b = pd.read_parquet(TS); n = load_new()
    if n is not None: b = pd.concat([b, n[b.columns]], ignore_index=True)
    return dedupe(b)

def dedupe(d):
    has = d['mk'].notna() & (d['mk'] != '')
    return pd.concat([d[~has], d[has].drop_duplicates('mk', keep='last')], ignore_index=True).sort_values(['day', 'tdate'], kind='mergesort').reset_index(drop=True)

def save(d):
    os.makedirs(os.path.dirname(TS), exist_ok=True)
    for c in FEATS: d[c] = rnd(d[c].to_numpy())
    for c in ('tdate', 'day', 'y'): d[c] = d[c].astype(np.int32)
    d.to_parquet(TS, compression='zstd', compression_level=12, index=False)
    print('trainset:', len(d), 'řádků,', round(os.path.getsize(TS) / 1e6, 1), 'MB, dny', int(d.day.min()), '–', int(d.day.max()))

def append_rows(rows):
    """Volá daily.py: rows = list dictů s klíči HEAD."""
    if not rows: return
    new = not os.path.exists(NEW) or os.path.getsize(NEW) == 0
    with open(NEW, 'a', newline='') as f:
        w = csv.writer(f)
        if new: w.writerow(HEAD)
        for r in rows: w.writerow([r[k] if k in META or k == 'mk' else f'{float(r[k]):.6g}' for k in HEAD])

if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else ''
    if cmd == 'init':
        X = np.load(os.path.join(ROOT, 'data', 'X.npy')); m = pd.read_parquet(os.path.join(ROOT, 'data', 'meta.parquet'))
        keep = (m.tdate >= FROM).to_numpy()
        d = pd.DataFrame(X[keep], columns=FEATS)
        mm = m[keep].reset_index(drop=True)
        for c in META: d.insert(META.index(c), c, mm[c].to_numpy())
        d.insert(len(META), 'mk', None); d['mk'] = d['mk'].astype('string')
        save(d)
    elif cmd == 'merge':
        b = pd.read_parquet(TS); n = load_new()
        if n is None: print('žádné nové řádky'); save(b)
        else:
            n['mk'] = n['mk'].astype('string'); save(dedupe(pd.concat([b, n[b.columns]], ignore_index=True))); print('připojeno', len(n))
        open(NEW, 'w').close()
    else: sys.exit(__doc__)
