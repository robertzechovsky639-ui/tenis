#!/usr/bin/env python3
"""Kompaktní textový stav pro denní inkrementální aktualizace (commitovaný do gitu).
state/players/NN.jsonl  – jeden hráč na řádek [id, stav] (Elo, Elo z gemů, povrchy, žebříček, forma/ring, historie ~160 dní, podání/příjem…)
state/h2h/NN.tsv        – vzájemné bilance  a<TAB>b<TAB>výhry_a<TAB>výhry_b
state/meta.json         – den dat, začátek mezery, pokrytí, nedávno započtené páry (deduplikace), zpracovaná ID Flashscore
state/tml_keys.txt      – už zpracované řádky TennisMyLife
state/tournaments.json  – turnaj -> [povrch, úroveň]
Řádkový text + seřazení => git ukládá denní změny jako malé delty."""
import os, json, zlib, math
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SD = os.path.join(ROOT, 'state')
NP, NH = 16, 8

def _sh(pid, n): return zlib.crc32(pid.encode()) % n

def _r(x):
    if isinstance(x, float):
        if math.isnan(x): return None
        return round(x, 6)
    if isinstance(x, (list, tuple)): return [_r(v) for v in x]
    if hasattr(x, 'item'): return _r(x.item())   # numpy skaláry
    return x

def save(P, H, meta, tml_keys, tours, d=SD):
    os.makedirs(os.path.join(d, 'players'), exist_ok=True); os.makedirs(os.path.join(d, 'h2h'), exist_ok=True)
    buf = [[] for _ in range(NP)]
    for pid in sorted(P):
        p = P[pid]; q = {k: _r(v) for k, v in sorted(p.items())}
        buf[_sh(pid, NP)].append(json.dumps([pid, q], separators=(',', ':'), ensure_ascii=False, allow_nan=False))
    for k in range(NP):
        with open(os.path.join(d, 'players', f'{k:02d}.jsonl'), 'w') as f: f.write('\n'.join(buf[k]) + '\n')
    hb = [[] for _ in range(NH)]
    for (a, b) in sorted(H):
        w, l = H[(a, b)]; hb[_sh(a, NH)].append(f'{a}\t{b}\t{int(w)}\t{int(l)}')
    for k in range(NH):
        with open(os.path.join(d, 'h2h', f'{k:02d}.tsv'), 'w') as f: f.write('\n'.join(hb[k]) + '\n')
    json.dump(meta, open(os.path.join(d, 'meta.json'), 'w'), indent=0, sort_keys=True, ensure_ascii=False)
    with open(os.path.join(d, 'tml_keys.txt'), 'w') as f: f.write('\n'.join(sorted(tml_keys)) + '\n')
    json.dump(tours, open(os.path.join(d, 'tournaments.json'), 'w'), indent=0, sort_keys=True, ensure_ascii=False)

def load(d=SD):
    P = {}
    for k in range(NP):
        for line in open(os.path.join(d, 'players', f'{k:02d}.jsonl')):
            if not line.strip(): continue
            pid, p = json.loads(line)
            p['ring'] = [tuple(x) for x in p.get('ring', [])]; p['fh'] = [tuple(x) for x in p.get('fh', [])]
            P[pid] = p
    H = {}
    for k in range(NH):
        for line in open(os.path.join(d, 'h2h', f'{k:02d}.tsv')):
            t = line.rstrip('\n').split('\t')
            if len(t) == 4: H[(t[0], t[1])] = [int(t[2]), int(t[3])]
    meta = json.load(open(os.path.join(d, 'meta.json')))
    tml_keys = set(x.strip() for x in open(os.path.join(d, 'tml_keys.txt')) if x.strip())
    tours = json.load(open(os.path.join(d, 'tournaments.json')))
    return P, H, meta, tml_keys, tours
