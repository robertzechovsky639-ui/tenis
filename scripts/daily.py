#!/usr/bin/env python3
"""Denní inkrementální aktualizace BEZ přetrénování (GitHub Actions i lokálně).
1) načte kompaktní stav state/ (Elo, Elo z gemů, povrchy, žebříček, forma, historie, H2H)
2) stáhne Flashscore (7 dní zpět + rozpis na 2 dny, všechny úrovně) a TennisMyLife CSV (ATP, Challenger, kvalifikace ATP, WTA – se žebříčkem a statistikami)
3) nové dokončené zápasy započte stejnou funkcí engine.update jako plná přestavba (deduplikace: stejný pár ±10 dní);
   pozdě dorazivší řádky TML k už započteným zápasům jen doplní žebříček a statistiky podání
4) uloží stav a exportuje web/data (hráči, predikce dnes/zítra, kurzy) modelem v2 z web/data/model.json + data/gbm.txt
Použití:  python scripts/daily.py [--no-fetch]"""
import os, sys, json, glob, time, datetime, argparse
import numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import engine, export, state_io, fs, fetch_data, trainset, zlib, online
import data as dmod
ROOT = state_io.ROOT; RAW = os.path.join(ROOT, 'raw')
GROUPS = [  # (label, pohlaví, soubory(y), druh, klíč cutoffu z init)
    ('M_main', 'M', lambda y: [f'{y}.csv', 'ongoing_tourneys.csv'], 'main'),
    ('M_chall', 'M', lambda y: [f'{y}_challenger.csv', 'challenger_ongoing_tourneys.csv'], 'qc'),
    ('M_quali', 'M', lambda y: [f'{y}_atp_quali.csv'], 'qc'),
    ('W_main', 'W', lambda y: [f'{y}_wta.csv', 'wta_ongoing_tourneys.csv'], 'main')]

def tml_key(t, w, l, r): return f'{t}|{w}|{l}|{r}'

def name_index(P):
    idx = {}
    for pid, p in P.items():
        idx.setdefault((p['g'], dmod.norm_name(p.get('name', ''))), []).append(pid)
    return idx

def tml_rows(P, meta, tml_keys):
    T = os.path.join(RAW, 'tml'); y = datetime.date.today().year; frames = []; rep = {}
    cut = meta.setdefault('tml_cut', {})
    if not cut:   # převod z klíčů init (pořadí skupin stejné jako v data.py)
        for k, v in meta.get('tml_cutoffs', {}).items():
            lab = 'M_chall' if '_challenger' in k else 'M_quali' if '_atp_quali' in k else 'W_main' if '_wta' in k else 'M_main'
            cut[lab] = int(v)
    nidx = name_index(P)
    for lab, g, files, kind in GROUPS:
        ds = []
        for f in files(y):
            p = os.path.join(T, f)
            if os.path.exists(p) and os.path.getsize(p) > 200:
                d = dmod.load_csv(p)
                if len(d): ds.append(d)
        if not ds: continue
        d = pd.concat(ds, ignore_index=True)
        d = d[pd.to_numeric(d.tourney_date, errors='coerce') > cut.get(lab, 0)].copy()
        d = d.drop_duplicates(subset=['tourney_id', 'winner_name', 'loser_name', 'round'])
        keys = [tml_key(str(a), str(b), str(c), str(e)) for a, b, c, e in zip(d.tourney_id, d.winner_name, d.loser_name, d['round'])]
        d = d[[k not in tml_keys for k in keys]]
        if not len(d): continue
        # Walkovery / neplatné skóre finalize stejně vyhodí — klíč musíme uložit tady,
        # jinak se stejné řádky hlásí jako tml_rows při každém běhu a applied zůstane 0.
        sc = d['score'].astype(str)
        bad = sc.str.contains(r'W/O|w/o|Walkover|DEF|Def\.|unfinished|nan|Played and', regex=True, case=False) | (sc.str.strip() == '')
        if bad.any():
            for a, b, c, e in zip(d.loc[bad, 'tourney_id'], d.loc[bad, 'winner_name'], d.loc[bad, 'loser_name'], d.loc[bad, 'round']):
                tml_keys.add(tml_key(str(a), str(b), str(c), str(e)))
            d = d.loc[~bad].copy()
        if not len(d): continue
        d = dmod.std_frame(d, g, kind, 'tml'); pref = 'a' if g == 'M' else 'w'
        def res(tid, name):
            if g == 'W' and (pref + str(tid)) in P and dmod.norm_name(P[pref + str(tid)].get('name', '')) == dmod.norm_name(name): return pref + str(tid)
            c = nidx.get((g, dmod.norm_name(name)), [])
            if c: return max(c, key=lambda k: P[k].get('last') or 0)
            return pref + 'T' + str(tid)
        for c in ('winner', 'loser'):
            d[c + '_id'] = [res(i, n) for i, n in zip(d[c + '_id'], d[c + '_name'])]
        rep[lab] = int(len(d)); frames.append(d)
    return (pd.concat(frames, ignore_index=True) if frames else None), rep

def fs_rows(P, meta):
    F = os.path.join(RAW, 'flashscore'); fs_ids = meta.setdefault('fs_ids', {})
    M = fs.Matcher()
    for pid, p in P.items(): M.add(pid, p['g'], p.get('name', ''), p.get('last') or 0)
    rows = []; seen = set(); new_ids = []
    for f in sorted(glob.glob(os.path.join(F, '*.json'))):
        for e in json.load(open(f)):
            if e['st'] != 3 or e['id'] in fs_ids or e['id'] in seen: continue
            seen.add(e['id']); new_ids.append((e['id'], int(e['ts'] // 86400)))
            if e['det'] not in (3, 8) or e['win'] not in (1, 2): continue
            W, L = (e['h'], e['a']) if e['win'] == 1 else (e['a'], e['h'])
            g = e['g']; pref = 'a' if g == 'M' else 'w'; ids = []; nm = []
            for X in (W, L):
                pid = M.match(g, X['slug'], X['name'])
                if pid is None:
                    pid = pref + 'F' + (X['slug'] or fs.norm_key(X['name']).replace(' ', '-'))
                    name = P[pid]['name'] if pid in P else ' '.join(w.capitalize() for w in (X['slug'] or X['name']).split('-'))
                else: name = P[pid].get('name', '')
                ids.append(pid); nm.append(name)
            day = int(e['ts'] // 86400 + (1 if (e['ts'] % 86400) > 22 * 3600 else 0))
            date = pd.Timestamp('1970-01-01') + pd.Timedelta(days=day)
            sets = e['sets'] if e['win'] == 1 else [[b, a] for a, b in e['sets']]
            score = ' '.join(f'{a}-{b}' for a, b in sets) + (' RET' if e['det'] == 8 else '')
            rows.append(dict(tourney_id='FS-' + e['tname'] + '-' + date.strftime('%G%V'), tourney_name=e['tname'], surface=e['surface'],
                             draw_size=None, tourney_level=e['lvl'], tourney_date=int(date.strftime('%Y%m%d')), match_num=0,
                             winner_id=ids[0], winner_name=nm[0], winner_ioc='', loser_id=ids[1], loser_name=nm[1], loser_ioc='',
                             score=score or '6-0', best_of=5 if (e['code'] == 6 and g == 'M' and not e['q']) else 3,
                             round='Q1' if e['q'] else 'R32', gender=g, source='flashscore', kind='fs', lvl=e['lvl'], lvl_code=e['code'], is_qual=e['q'], _day=day))
    df = pd.DataFrame(rows) if rows else None
    if df is not None:
        for c in ['winner_hand', 'loser_hand', 'winner_ht', 'loser_ht', 'winner_age', 'loser_age', 'winner_rank', 'loser_rank',
                  'winner_rank_points', 'loser_rank_points', 'minutes'] + ['w_' + s for s in dmod.STAT] + ['l_' + s for s in dmod.STAT]:
            df[c] = np.nan
    return df, new_ids

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--no-fetch', action='store_true'); a = ap.parse_args()
    t0 = time.time()
    P, H, meta, tml_keys, tours = state_io.load()
    print('stav:', len(P), 'hráčů,', len(H), 'H2H, data do', export.EPOCH + pd.Timedelta(days=meta['day_end']))
    if not a.no_fetch:
        fs.fetch_range(os.path.join(RAW, 'flashscore'))
        fetch_data.fetch_tml(datetime.date.today().year)
    tml, trep = tml_rows(P, meta, tml_keys)
    fsd, new_ids = fs_rows(P, meta)
    parts = [x for x in (tml, fsd) if x is not None and len(x)]
    st = dict(tml_rows=trep, fs_new_events=len(new_ids), applied=0, enriched=0, dup_skipped=0, new_players=0, by_level={})
    if parts:
        df = dmod.finalize(pd.concat(parts, ignore_index=True))
        df['_src'] = (df['source'] == 'flashscore').astype(int)
        df = df.sort_values(['day', '_src', 'tourney_date', 'rr'], kind='mergesort').reset_index(drop=True)
    else: df = pd.DataFrame()
    seenmap = {}
    for x in meta.get('seen', []): seenmap.setdefault((x[0], x[1]), []).append(int(x[2]))
    SC = ['w_svpt', 'w_1stWon', 'w_2ndWon', 'w_ace', 'w_df', 'w_bpSaved', 'w_bpFaced', 'l_svpt', 'l_1stWon', 'l_2ndWon', 'l_ace', 'l_df', 'l_bpSaved', 'l_bpFaced']
    cov = meta.setdefault('coverage', {})
    def getp(pid, g, name, hand, ht, ioc, age, day):
        p = P.get(pid)
        if p is None: p = engine.new_player(g); P[pid] = p; st['new_players'] += 1
        if name and name != 'nan': p['name'] = name
        if hand in ('R', 'L'): p['hand'] = hand
        if ht == ht and ht and ht > 140: p['ht'] = float(ht)
        if ioc and ioc != 'nan': p['ioc'] = ioc
        if p.get('dob') is None and age == age and age: p['dob'] = int(day - age * 365.25)
        return p
    train_rows = []
    online_pred = None
    for r in df.to_dict('records'):
        wid, lid, day, g = r['winner_id'], r['loser_id'], int(r['day']), r['gender']
        key = (wid, lid) if wid < lid else (lid, wid)
        is_tml = r['source'] == 'tml'
        stv = tuple(r[c] for c in SC); stats = stv if all(v == v and v is not None for v in stv) else None
        wr, lr = engine._num(r['winner_rank']), engine._num(r['loser_rank']); wp, lp = engine._num(r['winner_rank_points']), engine._num(r['loser_rank_points'])
        dup = any(abs(day - d) <= 10 for d in seenmap.get(key, []))
        if is_tml: tml_keys.add(tml_key(r['tourney_id'], r['winner_name'], r['loser_name'], r['round']))
        if dup:
            if is_tml and wid in P and lid in P:   # doplnění žebříčku a statistik k už započtenému zápasu (např. dřív z Flashscore)
                W, L = P[wid], P[lid]
                if wr and day >= (W.get('rday') or 0): W['rank'] = wr; W['rday'] = day
                if lr and day >= (L.get('rday') or 0): L['rank'] = lr; L['rday'] = day
                if wp is not None: W['pts'] = wp
                if lp is not None: L['pts'] = lp
                engine.update_stats(W, L, stats); st['enriched'] += 1
            else: st['dup_skipped'] += 1
            continue
        W = getp(wid, g, r['winner_name'], r.get('winner_hand'), r.get('winner_ht'), r.get('winner_ioc'), r.get('winner_age'), day)
        L = getp(lid, g, r['loser_name'], r.get('loser_hand'), r.get('loser_ht'), r.get('loser_ioc'), r.get('loser_age'), day)
        if wr: W['rank'] = wr; W['rday'] = day
        if lr: L['rank'] = lr; L['rday'] = day
        if wp is not None: W['pts'] = wp
        if lp is not None: L['pts'] = lp
        # trénovací řádek: příznaky ze stavu PŘED zápasem (stejně jako engine.run), orientace A/B deterministicky z klíče zápasu
        if int(r['tourney_date']) >= 20050101 and int(r['ret']) == 0:
            mk = f'{day}|{wid}|{lid}'; a_is_w = zlib.crc32(mk.encode()) % 2 == 0
            A, B = (W, L) if a_is_w else (L, W); sv = engine.SURF.get(r['surface'], 0)
            hh0 = H.get(key, [0, 0]); aid = wid if a_is_w else lid
            hA = hh0[0] if aid == key[0] else hh0[1]; hB = hh0[1] if aid == key[0] else hh0[0]
            ctx = dict(day=day, surface=sv, lvl_code=int(r['lvl_code']), is_qual=int(r['is_qual']), best_of=int(r['best_of']),
                       rankA=wr if a_is_w else lr, rankB=lr if a_is_w else wr, ptsA=wp if a_is_w else lp, ptsB=lp if a_is_w else wp,
                       ageA=engine._num(r.get('winner_age') if a_is_w else r.get('loser_age')), ageB=engine._num(r.get('loser_age') if a_is_w else r.get('winner_age')))
            x = engine.feats(A, B, ctx, (hA, hB))
            yrow = 1 if a_is_w else 0
            train_rows.append(dict(tdate=int(r['tourney_date']), day=day, y=yrow, group=r['lvl_group'], mk=mk, **dict(zip(engine.FEATS, x))))
            # stejný zápas doladí předzápasový model (váhy, ne stromy) ještě před posunem Elo
            if online_pred is None:
                online_pred = export.Predictor()
            p0 = online_pred.frozen(x)[0]
            if online.step(online_pred.online, x, yrow, p0, engine.FEATS, mk):
                st['online_steps'] = st.get('online_steps', 0) + 1
        engine.update(W, L, dict(surface=engine.SURF.get(r['surface'], 0), lvl_code=int(r['lvl_code']), is_qual=int(r['is_qual']), ret=int(r['ret']), day=day,
                                 minutes=r['minutes'], best_of=int(r['best_of']), stats=stats, wid=wid, lid=lid, games=engine.games_of(r['score'])))
        hh = H.get(key, [0, 0]); hh[0 if wid == key[0] else 1] += 1; H[key] = hh
        seenmap.setdefault(key, []).append(day); st['applied'] += 1
        lk = f"{g}_{r['lvl_group']}"; st['by_level'][lk] = st['by_level'].get(lk, 0) + 1
        c = cov.setdefault(lk, {}).setdefault(r['source'], [str(r['tourney_date']), str(r['tourney_date']), 0])
        c[0] = min(c[0], str(r['tourney_date'])); c[1] = max(c[1], str(r['tourney_date'])); c[2] += 1
        if not int(r['is_qual']):
            k = ' '.join(fs._toks(__import__('re').sub(r'\(.*?\)', '', str(r['tourney_name']))))
            if k: tours[g + '|' + k] = [r['surface'], int(r['lvl_code'])]
        meta['day_end'] = max(meta['day_end'], day)
    for i, d in new_ids: meta['fs_ids'][i] = d
    today = export.dnum(datetime.date.today().isoformat())
    meta['fs_ids'] = {k: v for k, v in meta['fs_ids'].items() if v >= today - 20}
    meta['seen'] = sorted([a, b, d] for (a, b), ds in seenmap.items() for d in ds if d >= meta['day_end'] - 45)
    now = time.strftime('%Y-%m-%d %H:%M %Z')
    meta['updates'] = (meta.get('updates', []) + [dict(at=now, **{k: v for k, v in st.items()})])[-40:]
    trainset.append_rows(train_rows); st['train_rows'] = len(train_rows)
    if online_pred is not None:
        online.save(os.path.join(ROOT, 'state', 'online.json'), online_pred.online)
    else:
        # i den bez nových zápasů nechá soubor se správnou základnou modelu (po nedělním refitu se vynuluje)
        import json as _json
        mp = os.path.join(ROOT, 'web', 'data', 'model.json')
        ip = os.path.join(ROOT, 'data', 'model_info.json')
        if os.path.exists(mp) and os.path.exists(ip):
            mm = _json.load(open(mp)); inf = _json.load(open(ip))
            base = str(inf.get('train_end_day') or '0')
            cur = online.load(os.path.join(ROOT, 'state', 'online.json'), base, mm['lr']['cols'], mm['lr']['scale'])
            online.save(os.path.join(ROOT, 'state', 'online.json'), cur)
    state_io.save(P, H, meta, tml_keys, tours)
    print('aktualizace:', json.dumps(st, ensure_ascii=False))
    export.export_all(P, H, meta['day_end'], meta['gap_start'], meta['coverage'], tours, meta.get('tml', {}),
                      extra_meta=dict(updated=now, update=st, full_build=meta.get('full_build'), mode='daily-incremental'))
    print('hotovo za', round(time.time() - t0), 's')

if __name__ == '__main__':
    main()
