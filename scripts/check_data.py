#!/usr/bin/env python3
"""Kontrola po denní aktualizaci: rozpis na dnes/zítra musí obsahovat zápasy (i Challenger/ITF) s predikcemi."""
import json, os, sys, datetime, collections
W = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'web', 'data')
up = json.load(open(os.path.join(W, 'upcoming.json')))['matches']; meta = json.load(open(os.path.join(W, 'meta.json')))
today = datetime.date.today()
def dday(ts): return (datetime.datetime.fromtimestamp(ts).date() - today).days
c = collections.Counter()
for m in up:
    d = dday(m['ts'])
    if d in (0, 1): c[('dnes' if d == 0 else 'zítra', m['lvl'], 'p' if 'p' in m else '-')] += 1
tot = sum(v for (d, l, p), v in c.items()); lv = collections.Counter(l for (d, l, p) in c.elements())
pred = sum(v for (d, l, p), v in c.items() if p == 'p')
print('data do', meta['date_end'], '| aktualizace', meta.get('updated'), '| změny', json.dumps(meta.get('update'), ensure_ascii=False))
print('dnes+zítra zápasů:', tot, 's predikcí:', pred, '| podle úrovně:', dict(lv))
print('s kurzy:', sum(1 for m in up if m.get('odds')))
if tot == 0 or pred == 0: sys.exit('CHYBA: prázdný rozpis nebo žádné predikce (zdroj zablokovaný?)')
if lv.get('CH', 0) + lv.get('ITF', 0) == 0: print('VAROVÁNÍ: žádné Challenger/ITF zápasy na dnes/zítra')
