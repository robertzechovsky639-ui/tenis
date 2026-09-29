#!/usr/bin/env python3
"""Sjednotí Sackmann (všechny úrovně) + TennisMyLife doplnění do jedné tabulky zápasů."""
import os, glob, re, unicodedata, json
import sys
import numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, 'raw'); OUT = os.path.join(ROOT, 'data'); os.makedirs(OUT, exist_ok=True)
START_YEAR = int(os.environ.get('START_YEAR', 2000))
STAT = ['ace', 'df', 'svpt', '1stIn', '1stWon', '2ndWon', 'SvGms', 'bpSaved', 'bpFaced']

def norm_name(s):
    s = unicodedata.normalize('NFKD', str(s)).encode('ascii', 'ignore').decode().lower()
    s = re.sub(r"[\-\.'`’]", ' ', s)
    return re.sub(r'\s+', ' ', s).strip()

def level_map(g, lvl, kind):
    l = str(lvl).strip()
    if g == 'M':
        if l == 'G': return 'G', 6
        if l in ('M', '1000'): return 'M', 5
        if l == 'F': return 'F', 5
        if l in ('A', '250', '500', 'O'): return 'A', 4
        if l == 'D': return 'D', 4
        if l == 'C': return 'CH', 3
        if l == '15': return 'ITF', 0
        if l in ('25', 'S'): return 'ITF', 1
        return ('ITF', 1) if kind == 'fut' else ('A', 4)
    else:
        if l == 'G': return 'G', 6
        if l in ('PM', '1000', 'T1'): return 'M', 5
        if l == 'F': return 'F', 5
        if l in ('P', '500', 'I', '250', 'T2', 'T3', 'T4', 'T5', 'O'): return 'A', 4
        if l == 'D': return 'D', 4
        if l in ('C', 'CC', 'W', '125'): return 'CH', 3
        m = re.match(r'(\d+)', l)
        if m:
            p = int(m.group(1))
            return 'ITF', (0 if p <= 20 else 1 if p <= 40 else 2)
        return 'A', 4

ROUND_RANK = {'Q1': 0, 'Q2': 1, 'Q3': 2, 'Q4': 3, 'ER': 4, 'R128': 5, 'R64': 6, 'R32': 7, 'RR': 8, 'R16': 9,
              'QF': 10, 'SF': 11, 'BR': 12, 'F': 13}
OFF = {'Q1': -2, 'Q2': -1, 'Q3': 0, 'Q4': 0, 'ER': 0, 'R128': 0, 'R64': 1, 'R32': 1, 'RR': 2, 'R16': 3, 'QF': 4, 'SF': 5, 'BR': 5, 'F': 6}
OFF_G = {'Q1': -6, 'Q2': -5, 'Q3': -4, 'Q4': -4, 'R128': 1, 'R64': 3, 'R32': 5, 'R16': 7, 'QF': 9, 'SF': 11, 'F': 13, 'RR': 3, 'BR': 11}

def load_csv(path):
    try: return pd.read_csv(path, low_memory=False, encoding='utf-8')
    except UnicodeDecodeError: return pd.read_csv(path, low_memory=False, encoding='latin-1')

def std_frame(df, g, kind, source):
    df = df.copy()
    df['gender'] = g; df['source'] = source; df['kind'] = kind
    lm = [level_map(g, l, kind) for l in df['tourney_level']]
    df['lvl'] = [a for a, b in lm]; df['lvl_code'] = [b for a, b in lm]
    df['is_qual'] = df['round'].astype(str).str.startswith('Q').astype(int)
    return df

def load_sackmann():
    frames = []
    S = os.path.join(RAW, 'sackmann')
    specs = [('M', 'atp/atp_matches_[0-9]*.csv', 'main'), ('M', 'atp/atp_matches_qual_chall_*.csv', 'qc'),
             ('M', 'atp/atp_matches_futures_*.csv', 'fut'), ('W', 'wta/wta_matches_[0-9]*.csv', 'main'),
             ('W', 'wta/wta_matches_qual_itf_*.csv', 'qc')]
    for g, pat, kind in specs:
        for f in sorted(glob.glob(os.path.join(S, pat))):
            y = int(re.findall(r'(\d{4})\.csv$', f)[0])
            if y < START_YEAR: continue
            d = load_csv(f)
            frames.append(std_frame(d, g, kind, 'sackmann'))
    df = pd.concat(frames, ignore_index=True)
    pref = df['gender'].map({'M': 'a', 'W': 'w'})
    df['winner_id'] = pref + df['winner_id'].astype(str); df['loser_id'] = pref + df['loser_id'].astype(str)
    return df

def load_players():
    S = os.path.join(RAW, 'sackmann'); out = {}
    for g, f, p in [('M', 'atp/atp_players.csv', 'a'), ('W', 'wta/wta_players.csv', 'w')]:
        d = load_csv(os.path.join(S, f))
        for r in d.itertuples(index=False):
            out[p + str(r.player_id)] = dict(first=r.name_first if isinstance(r.name_first, str) else '',
                                           last=r.name_last if isinstance(r.name_last, str) else '',
                                           hand=r.hand if isinstance(r.hand, str) else '',
                                           dob=int(r.dob) if pd.notna(r.dob) else None,
                                           ioc=r.ioc if isinstance(r.ioc, str) else '',
                                           ht=float(r.height) if pd.notna(r.height) else None, gender=g)
    return out

def build_name_index(players, sack, g):
    """norm name -> list of ids (only ids seen in matches since START_YEAR)."""
    idx = {}
    sub = sack[sack.gender == g]
    seen = {}
    for c in ('winner', 'loser'):
        for i, n, a, dt in zip(sub[c + '_id'], sub[c + '_name'], sub[c + '_age'], sub['tourney_date']):
            if i not in seen or dt > seen[i][2]: seen[i] = (n, a, dt)
    for i, (n, a, dt) in seen.items():
        idx.setdefault(norm_name(n), []).append(i)
    return idx, seen

def map_tml(tml, g, sack, players):
    idx, seen = build_name_index(players, sack, g)
    newmap, stats = {}, {'exact': 0, 'ambig': 0, 'new': 0, 'id': 0}
    pref = 'a' if g == 'M' else 'w'
    def resolve(tid, name, ioc, age, tdate):
        key = (tid, name)
        if key in newmap: return newmap[key]
        cands = idx.get(norm_name(name), [])
        if g == 'W' and (pref + str(tid)) in seen and norm_name(seen[pref + str(tid)][0]) == norm_name(name):
            newmap[key] = pref + str(tid); stats['id'] += 1; return newmap[key]
        if len(cands) > 1:
            c2 = [c for c in cands if players.get(c, {}).get('ioc') == ioc] or cands
            if len(c2) > 1 and pd.notna(age):
                by = int(str(tdate)[:4]) - float(age)
                c3 = [c for c in c2 if players.get(c, {}).get('dob') and abs(int(str(players[c]['dob'])[:4]) - by) <= 1.5]
                c2 = c3 or c2
            if len(c2) > 1: stats['ambig'] += 1
            c2.sort(key=lambda c: -seen[c][2]); r = c2[0]
        elif len(cands) == 1: r = cands[0]; stats['exact'] += 1
        else: r = pref + 'T' + str(tid); stats['new'] += 1
        newmap[key] = r; return r
    for c in ('winner', 'loser'):
        tml[c + '_id'] = [resolve(i, n, o, a, d) for i, n, o, a, d in zip(tml[c + '_id'], tml[c + '_name'], tml[c + '_ioc'], tml[c + '_age'], tml['tourney_date'])]
    return tml, stats

def load_tml(sack, players):
    T = os.path.join(RAW, 'tml'); frames = []; report = {}
    def rd(f):
        p = os.path.join(T, f)
        if not os.path.exists(p) or os.path.getsize(p) < 200: return None
        d = load_csv(p)
        return d if len(d) else None
    y = max(int(re.findall(r'(\d{4})', f)[0]) for f in os.listdir(T) if re.match(r'\d{4}', f))
    groups = [
        ('M', [f'{y}.csv', 'ongoing_tourneys.csv'], 'main', lambda s: (s.gender == 'M') & (s.kind == 'main')),
        ('M', [f'{y}_challenger.csv', 'challenger_ongoing_tourneys.csv'], 'qc', lambda s: (s.gender == 'M') & (s.lvl == 'CH') & (s.is_qual == 0)),
        ('M', [f'{y}_atp_quali.csv'], 'qc', lambda s: (s.gender == 'M') & (s.kind == 'qc') & (s.lvl != 'CH')),
        ('W', [f'{y}_wta.csv', 'wta_ongoing_tourneys.csv'], 'main', lambda s: (s.gender == 'W') & (s.kind == 'main')),
    ]
    for g, files, kind, selfn in groups:
        ds = [d for d in (rd(f) for f in files) if d is not None]
        if not ds: continue
        d = pd.concat(ds, ignore_index=True)
        cutoff = int(sack[selfn(sack)]['tourney_date'].max())
        d = d[d.tourney_date > cutoff].copy()
        d = d.drop_duplicates(subset=['tourney_id', 'winner_name', 'loser_name', 'round'])
        if not len(d): continue
        d = std_frame(d, g, kind, 'tml')
        d, st = map_tml(d, g, sack, players)
        report['+'.join(files)] = dict(cutoff=cutoff, rows=len(d), max=int(d.tourney_date.max()), **st)
        frames.append(d)
    return (pd.concat(frames, ignore_index=True) if frames else None), report

def load_flashscore(base):
    """Doplní dokončené zápasy z uložených dnů Flashscore feedu (všechny úrovně), které v datech ještě nejsou."""
    import fs
    F = os.path.join(RAW, 'flashscore')
    if not os.path.isdir(F): return None, {}
    # párování jmen -> id (dle posledního výskytu); kanonická jména z Sackmann/TML
    M = fs.Matcher(); canon = {}; last = {}
    for c in ('winner', 'loser'):
        for i, n, g, d in zip(base[c + '_id'], base[c + '_name'], base['gender'], base['tourney_date']):
            if d >= last.get(i, (0, ''))[0]: last[i] = (d, n, g)
    for i, (d, n, g) in last.items():
        M.add(i, g, n, d); canon[i] = n
    pairs = {}
    td = pd.to_datetime(base['tourney_date'].astype(int).astype(str), format='%Y%m%d')
    days = ((td - pd.Timestamp('1970-01-01')).dt.days).to_numpy()
    recent = days > days.max() - 60
    for w, l, d in zip(base['winner_id'][recent], base['loser_id'][recent], days[recent]):
        pairs.setdefault((w, l) if w < l else (l, w), []).append(d)
    rows = []; st = dict(events=0, added=0, dup=0, unknown_players=0)
    seen = set()
    for f in sorted(glob.glob(os.path.join(F, '*.json'))):
        for e in json.load(open(f)):
            if e['st'] != 3 or e['det'] not in (3, 8) or e['win'] not in (1, 2) or e['id'] in seen: continue
            seen.add(e['id']); st['events'] += 1
            W, L = (e['h'], e['a']) if e['win'] == 1 else (e['a'], e['h'])
            g = e['g']; pref = 'a' if g == 'M' else 'w'
            ids = []; nm = []
            for P in (W, L):
                pid = M.match(g, P['slug'], P['name'])
                if pid is None:
                    pid = pref + 'F' + (P['slug'] or fs.norm_key(P['name']).replace(' ', '-')); st['unknown_players'] += 1
                    canon[pid] = ' '.join(w.capitalize() for w in (P['slug'] or P['name']).split('-'))
                ids.append(pid); nm.append(canon[pid])
            day = int(e['ts'] // 86400 + (1 if (e['ts'] % 86400) > 22 * 3600 else 0))
            key = tuple(sorted(ids))
            if any(abs(day - d) <= 10 for d in pairs.get(key, [])): st['dup'] += 1; continue
            pairs.setdefault(key, []).append(day)
            date = pd.Timestamp('1970-01-01') + pd.Timedelta(days=day)
            sets = e['sets'] if e['win'] == 1 else [[b, a] for a, b in e['sets']]
            score = ' '.join(f'{a}-{b}' for a, b in sets) + (' RET' if e['det'] == 8 else '')
            rows.append(dict(tourney_id='FS-' + e['tname'] + '-' + date.strftime('%G%V'), tourney_name=e['tname'], surface=e['surface'],
                             draw_size=None, tourney_level=e['lvl'], tourney_date=int(date.strftime('%Y%m%d')), match_num=0,
                             winner_id=ids[0], winner_name=nm[0], winner_ioc='', loser_id=ids[1], loser_name=nm[1], loser_ioc='',
                             score=score or '6-0', best_of=5 if (e['code'] == 6 and g == 'M' and not e['q']) else 3,
                             round='Q1' if e['q'] else 'R32', gender=g, source='flashscore', kind='fs', lvl=e['lvl'], lvl_code=e['code'], is_qual=e['q']))
            st['added'] += 1
    return (pd.DataFrame(rows) if rows else None), st

def finalize(df):
    df = df[df['tourney_date'].notna()].copy()
    df['tourney_date'] = df['tourney_date'].astype(int)
    df['score'] = df['score'].astype(str)
    bad = df['score'].str.contains(r'W/O|w/o|Walkover|DEF|Def\.|unfinished|nan|Played and', regex=True) | (df['score'].str.strip() == '')
    df = df[~bad].copy()
    df['ret'] = df['score'].str.contains('RET|Ret', regex=True).astype(int)
    df['surface'] = df['surface'].fillna('Hard').replace({'': 'Hard'})
    df.loc[~df['surface'].isin(['Hard', 'Clay', 'Grass', 'Carpet']), 'surface'] = 'Hard'
    df['round'] = df['round'].astype(str)
    df['rr'] = df['round'].map(ROUND_RANK).fillna(8).astype(int)
    td = pd.to_datetime(df['tourney_date'].astype(str), format='%Y%m%d')
    off = np.where(df['lvl'] == 'G', df['round'].map(OFF_G).fillna(3), df['round'].map(OFF).fillna(2))
    off = np.where(df['source'] == 'flashscore', 0, off)
    df['date'] = (td + pd.to_timedelta(off, unit='D'))
    df['date'] = df['date'].clip(upper=pd.Timestamp.today().normalize())  # odhad dne nesmí být v budoucnu
    df['day'] = (df['date'] - pd.Timestamp('1970-01-01')).dt.days.astype(int)
    df['best_of'] = pd.to_numeric(df['best_of'], errors='coerce').fillna(3).astype(int)
    df['match_num'] = pd.to_numeric(df['match_num'], errors='coerce').fillna(0)
    for c in ['winner_rank', 'loser_rank', 'winner_rank_points', 'loser_rank_points', 'winner_ht', 'loser_ht', 'winner_age', 'loser_age', 'minutes'] + \
             ['w_' + s for s in STAT] + ['l_' + s for s in STAT]:
        df[c] = pd.to_numeric(df[c], errors='coerce')
    df['lvl_group'] = np.where(df['lvl_code'] >= 4, 'tour', np.where(df['lvl_code'] == 3, 'chall', 'itf'))
    df = df.sort_values(['tourney_date', 'tourney_id', 'rr', 'match_num'], kind='mergesort').reset_index(drop=True)
    keep = ['tourney_id', 'tourney_name', 'surface', 'tourney_level', 'lvl', 'lvl_code', 'lvl_group', 'is_qual', 'tourney_date', 'date', 'day',
            'round', 'rr', 'best_of', 'gender', 'source', 'score', 'ret', 'minutes',
            'winner_id', 'winner_name', 'winner_hand', 'winner_ht', 'winner_ioc', 'winner_age', 'winner_rank', 'winner_rank_points',
            'loser_id', 'loser_name', 'loser_hand', 'loser_ht', 'loser_ioc', 'loser_age', 'loser_rank', 'loser_rank_points'] + \
           ['w_' + s for s in STAT] + ['l_' + s for s in STAT]
    df = df[keep]
    for c in ['tourney_id', 'tourney_name', 'tourney_level', 'winner_hand', 'loser_hand', 'winner_ioc', 'loser_ioc', 'winner_name', 'loser_name']:
        df[c] = df[c].astype(str)
    return df

if __name__ == '__main__':
    sack = load_sackmann()
    players = load_players()
    tml, rep = load_tml(sack, players)
    print(json.dumps(rep, indent=1))
    df = pd.concat([sack, tml], ignore_index=True) if tml is not None else sack
    fsd, fst = load_flashscore(df)
    print('flashscore', fst); rep['flashscore'] = fst
    if fsd is not None: df = pd.concat([df, fsd], ignore_index=True)
    df = finalize(df)
    df.to_parquet(os.path.join(OUT, 'matches.parquet'))
    pd.to_pickle(players, os.path.join(OUT, 'players.pkl'))
    cov = {}
    for (g, grp, src), s in df.groupby(['gender', 'lvl_group', 'source']):
        cov[f'{g}|{grp}|{src}'] = dict(n=int(len(s)), first=str(s['tourney_date'].min()), last=str(s['tourney_date'].max()))
    cov['_tml_mapping'] = rep
    json.dump(cov, open(os.path.join(OUT, 'coverage.json'), 'w'), indent=1)
    print(json.dumps(cov, indent=1)); print('total', len(df))
