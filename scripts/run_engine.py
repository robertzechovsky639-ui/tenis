#!/usr/bin/env python3
import os, sys, pickle, time
import numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(__file__))
import engine
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = os.path.join(ROOT, 'data')
t = time.time()
df = pd.read_parquet(os.path.join(D, 'matches.parquet'))
players = pd.read_pickle(os.path.join(D, 'players.pkl'))
X, meta, P, H = engine.run(df, players)
np.save(os.path.join(D, 'X.npy'), X); meta.to_parquet(os.path.join(D, 'meta.parquet'))
with open(os.path.join(D, 'state.pkl'), 'wb') as f: pickle.dump((P, H), f, protocol=4)
print('rows', X.shape, 'players', len(P), 'h2h', len(H), 'sec', round(time.time() - t))
