#!/usr/bin/env python3
"""Z plné přestavby (data/state.pkl + matches.parquet + raw/flashscore) vytvoří kompaktní stav state/ pro denní aktualizace."""
import os, sys
import pandas as pd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import export, state_io
ROOT = state_io.ROOT; D = os.path.join(ROOT, 'data')
KEEP_FROM = export.dnum('2020-01-01')   # hráči bez zápasu od 2020 se do stavu nedávají (při návratu = nový hráč)

def tml_key(r): return f"{r['tourney_id']}|{r['winner_name']}|{r['loser_name']}|{r['round']}"

if __name__ == '__main__':
    P, H, day_end, gap_start, cov, tours, tmlrep = export.full_inputs()
    P = {k: p for k, p in P.items() if p['last'] and p['last'] >= KEEP_FROM}
    H = {k: v for k, v in H.items() if k[0] in P and k[1] in P}
    df = pd.read_parquet(os.path.join(D, 'matches.parquet'), columns=['tourney_id', 'winner_name', 'loser_name', 'round', 'winner_id', 'loser_id', 'day', 'source'])
    rec = df[df.day >= day_end - 45]
    seen = sorted({(min(a, b), max(a, b), int(d)) for a, b, d in zip(rec.winner_id, rec.loser_id, rec.day)})
    tml = df[df.source == 'tml']
    tml_keys = {f'{a}|{b}|{c}|{d}' for a, b, c, d in zip(tml.tourney_id, tml.winner_name, tml.loser_name, tml['round'])}
    # fs_ids neseedujeme všemi st=3 z raw — full build nemusí všechny započítat
    # (TML má přednost / W/O). daily.py je doplní; jinak by se nezapočtené navždy přeskočily.
    fs_ids = {}
    cutoffs = {k: v['cutoff'] for k, v in tmlrep.items() if isinstance(v, dict) and 'cutoff' in v}
    meta = dict(day_end=day_end, gap_start=gap_start, coverage=cov, tml=tmlrep, tml_cutoffs=cutoffs,
                seen=[list(x) for x in seen], fs_ids=fs_ids, full_build=pd.Timestamp.now().strftime('%Y-%m-%d %H:%M'), updates=[])
    state_io.save(P, H, meta, tml_keys, tours)
    print('state: players', len(P), 'h2h', len(H), 'seen', len(seen), 'tml_keys', len(tml_keys), 'fs_ids', len(fs_ids), 'cutoffs', cutoffs)
