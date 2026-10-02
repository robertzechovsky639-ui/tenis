#!/usr/bin/env python3
"""Export stavu hráčů (index + shardy), meta dat a build-time snapshotu zápasů pro web."""
import os, sys, json, pickle, glob, math, datetime, time, re
import numpy as np, pandas as pd, lightgbm as lgb
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import engine, fs, online
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = os.path.join(ROOT, 'data'); W = os.path.join(ROOT, 'web', 'data')
NSH = 16
EPOCH = pd.Timestamp('1970-01-01')

def dnum(s): return (pd.Timestamp(s) - EPOCH).days

def r2(x, n=1): return None if x is None else round(float(x), n)

def encode(P, H, act_ids, day_end):
    pos = {pid: i for i, pid in enumerate(act_ids)}
    h2h = {i: [] for i in range(len(act_ids))}
    recent = day_end - 3 * 365
    for (a, b), (wa, wb) in H.items():
        ia, ib = pos.get(a), pos.get(b)
        if ia is None or ib is None: continue
        if wa + wb >= 2 or any(x[5] == b and x[0] >= recent for x in P[a]['ring']):
            h2h[ia].append(f'{ib}:{wa}:{wb}'); h2h[ib].append(f'{ia}:{wb}:{wa}')
    idx = dict(id=[], n=[], c=[], g=[], e=[], se=[], k=[], sk=[], r=[], l=[], lv=[], ro=[], ge=[], gse=[])
    shards = [dict() for _ in range(NSH)]
    for i, pid in enumerate(act_ids):
        p = P[pid]
        idx['id'].append(pid); idx['n'].append(p['name']); idx['c'].append(p['ioc'] if isinstance(p['ioc'], str) and p['ioc'] != 'nan' else ''); idx['g'].append(p['g'])
        idx['e'].append(r2(p['elo'])); idx['se'].append([r2(x) for x in p['se']]); idx['k'].append(p['n']); idx['sk'].append(p['sn'])
        idx['ge'].append(r2(p['gelo'])); idx['gse'].append([r2(x) for x in p['gse']])
        idx['r'].append(int(p['rank']) if p['rank'] else 0); idx['l'].append(day_end - p['last'])
        idx['lv'].append(p['ring'][-1][4] if p['ring'] else 1)
        idx['ro'].append(';'.join(f"{pos[x[5]]},{day_end - x[0]}" for x in p['ring'] if x[0] >= day_end - 21 and x[5] in pos))
        ring = ';'.join(f"{day_end - x[0]},{x[1]},{round(x[2] * 100)},{int(round(x[3]))},{x[4]},{pos.get(x[5], -1)}" for x in p['ring'])
        fh = p.get('fh') or []; fx = fh[:max(0, len(fh) - len(p['ring']))]   # starší zápasy mimo ring (jen pro graf formy)
        fxs = ';'.join(f"{day_end - x[0]},{x[1]},{round(x[2] * 100)},{x[3]},{pos.get(x[4], -1)}" for x in fx if x[0] >= day_end - 150)
        st = [r2(p['elo']), p['n'], [r2(x) for x in p['se']], p['sn'], int(p['rank']) if p['rank'] else 0, int(p['pts'] or 0),
              p['sw'], p['sl'], round(p['spw'], 4), round(p['rpw'], 4), round(p['ace'], 4), round(p['df'], 4), round(p['bps'], 4), p['ns'],
              p['hand'] or '', int(p['ht']) if p['ht'] else 0, p['dob'] if p['dob'] is not None else None, ring, ';'.join(h2h[i]),
              r2(p['gelo']), [r2(x) for x in p['gse']], fxs]
        shards[i % NSH][str(i)] = st
    return idx, shards

def decode(st, g, name, day_end):
    """Inverzní funkce k encode -> stav pro engine.feats (stejně jako web/model.js)."""
    ring = []
    if st[17]:
        for t in st[17].split(';'):
            a = t.split(','); ring.append((day_end - int(a[0]), int(a[1]), int(a[2]) / 100.0, float(a[3]), int(a[4]), int(a[5])))
    h2h = {}
    if st[18]:
        for t in st[18].split(';'):
            o, w, l = t.split(':'); h2h[int(o)] = (int(w), int(l))
    return dict(g=g, name=name, elo=st[0], n=st[1], se=list(st[2]), sn=list(st[3]), rank=st[4] or None, pts=st[5] or None,
                sw=list(st[6]), sl=list(st[7]), spw=st[8], rpw=st[9], ace=st[10], df=st[11], bps=st[12], ns=st[13],
                hand=st[14], ht=st[15] or None, dob=st[16], ioc='', ring=ring, last=ring[-1][0] if ring else None, h2h=h2h,
                gelo=st[19], gse=list(st[20]))

def ref_day(p, today, gap_start):
    """Neutralizace únavy u hráčů, jejichž úroveň nemá data v mezeře (ITF/WTA125 po snapshotu Sackmanna)."""
    if not p['ring']: return today
    last = p['ring'][-1]
    if last[0] <= gap_start + 7 and (last[4] <= 2 or (p['g'] == 'W' and last[4] == 3)):
        return last[0] + 7
    return today

class Predictor:
    def __init__(self):
        m = json.load(open(os.path.join(W, 'model.json')))
        self.m = m; self.b = lgb.Booster(model_file=os.path.join(D, 'gbm.txt'))
        self.di = [m['feats'].index(f) for f in m['diff']]
        info_p = os.path.join(D, 'model_info.json')
        base = '0'
        if os.path.exists(info_p):
            base = str(json.load(open(info_p)).get('train_end_day') or json.load(open(info_p)).get('train_end') or '0')
        self.online = online.load(os.path.join(ROOT, 'state', 'online.json'), base, m['lr']['cols'], m['lr']['scale'])
    def swap(self, x):
        z = list(x); F = self.m['feats']
        for i in self.di: z[i] = -z[i]
        for a, b in self.m['swap'].items(): z[F.index(a)] = x[F.index(b)]
        return z
    def lr(self, x, part='lr'):
        L = self.m[part]; F = self.m['feats']
        z = sum(x[F.index(c)] / s * w for c, s, w in zip(L['cols'], L['scale'], L['coef']))
        return 1 / (1 + math.exp(-z))
    def frozen(self, x):
        pg = self.b.predict(np.array([x, self.swap(x)], dtype=np.float64))
        pgb = 0.5 * (pg[0] + 1 - pg[1]); plr = self.lr(x)
        a = self.m.get('cal', 1.0)
        if a != 1.0:
            q = min(max(pgb, 1e-6), 1 - 1e-6); pgb = 1 / (1 + math.exp(-a * math.log(q / (1 - q))))
        return self.m['w_gbm'] * pgb + (1 - self.m['w_gbm']) * plr, pgb, plr
    def predict(self, x):
        p, pgb, plr = self.frozen(x)
        return online.adjust(p, self.online, x, self.m['feats']), pgb, plr

def full_inputs():
    """Vstupy exportu z plné přestavby (state.pkl + matches.parquet)."""
    P, H = pickle.load(open(os.path.join(D, 'state.pkl'), 'rb'))
    df = pd.read_parquet(os.path.join(D, 'matches.parquet'), columns=['tourney_date', 'day', 'gender', 'lvl_group', 'source', 'is_qual'])
    day_end = int(df['day'].max())
    gap_start = int(df[df.source == 'sackmann']['day'].max())
    cov = {}
    for (g, grp), s in df.groupby(['gender', 'lvl_group']):
        cov[f'{g}_{grp}'] = {src: [str(x['tourney_date'].min()), str(x['tourney_date'].max()), int(len(x))] for src, x in s.groupby('source')}
    # mapa turnaj (město) -> povrch, úroveň – pro živé zdroje bez těchto údajů (ESPN)
    tm = pd.read_parquet(os.path.join(D, 'matches.parquet'), columns=['tourney_name', 'surface', 'lvl_code', 'gender', 'tourney_date', 'is_qual'])
    tm = tm[(tm.tourney_date >= 20230101) & (tm.is_qual == 0)].sort_values('tourney_date')
    tours = {}
    for n, sf, c, g in zip(tm.tourney_name, tm.surface, tm.lvl_code, tm.gender):
        k = ' '.join(fs._toks(re.sub(r'\(.*?\)', '', str(n))))
        if k: tours[g + '|' + k] = [sf, int(c)]
    tmlrep = json.load(open(os.path.join(D, 'coverage.json'))).get('_tml_mapping', {})
    return P, H, day_end, gap_start, cov, tours, tmlrep

def main():
    export_all(*full_inputs())

def export_all(P, H, day_end, gap_start, cov, tours, tmlrep, extra_meta=None):
    act_from = dnum('2024-01-01')
    act_ids = sorted([pid for pid, p in P.items() if p['last'] and p['last'] >= act_from], key=lambda k: -P[k]['elo'])
    idx, shards = encode(P, H, act_ids, day_end)
    for f in glob.glob(os.path.join(W, 'st', '*.json')): os.remove(f)
    os.makedirs(os.path.join(W, 'st'), exist_ok=True)
    json.dump(idx, open(os.path.join(W, 'players.json'), 'w'), separators=(',', ':'), ensure_ascii=False, allow_nan=False)
    for k, s in enumerate(shards):
        json.dump(s, open(os.path.join(W, 'st', f'{k}.json'), 'w'), separators=(',', ':'), ensure_ascii=False, allow_nan=False)
    json.dump(tours, open(os.path.join(W, 'tournaments.json'), 'w'), separators=(',', ':'))
    metrics = json.load(open(os.path.join(D, 'metrics.json')))
    meta = dict(built=time.strftime('%Y-%m-%d %H:%M'), day_end=day_end, date_end=str((EPOCH + pd.Timedelta(days=day_end)).date()),
                gap_start=gap_start, gap_start_date=str((EPOCH + pd.Timedelta(days=gap_start)).date()), nsh=NSH,
                n_players=len(act_ids), coverage=cov, metrics=metrics, tml=tmlrep, **(extra_meta or {}))
    for k, f in (('model_info', 'model_info.json'), ('retrain', 'retrain_history.json')):   # týdenní přetrénování -> záložka Model
        fp = os.path.join(D, f)
        if os.path.exists(fp): meta[k] = json.load(open(fp)) if k == 'model_info' else json.load(open(fp))[-12:]
    on_p = os.path.join(ROOT, 'state', 'online.json')
    if os.path.exists(on_p):
        on = json.load(open(on_p))
    else:
        mm = json.load(open(os.path.join(W, 'model.json')))
        info_p = os.path.join(D, 'model_info.json')
        base = str(json.load(open(info_p)).get('train_end_day')) if os.path.exists(info_p) else '0'
        on = online.empty(base, mm['lr']['cols'], mm['lr']['scale'])
    json.dump(on, open(os.path.join(W, 'online.json'), 'w'), ensure_ascii=False, separators=(',', ':'))
    meta['online_n'] = int(on.get('n') or 0)
    meta['online_base'] = on.get('base')
    json.dump(meta, open(os.path.join(W, 'meta.json'), 'w'), ensure_ascii=False, indent=0)
    sizes = [os.path.getsize(os.path.join(W, 'st', f'{k}.json')) for k in range(NSH)]
    print('players', len(act_ids), 'index KB', os.path.getsize(os.path.join(W, 'players.json')) // 1024, 'shards KB total', sum(sizes) // 1024)
    # --- build-time snapshot (fallback, když živý feed v prohlížeči selže) + test parity ---
    pred = Predictor(); pos = {pid: i for i, pid in enumerate(act_ids)}
    M = fs.Matcher()
    for i, pid in enumerate(act_ids): M.add(i, P[pid]['g'], P[pid]['name'], -idx['l'][i])
    today = dnum(datetime.date.today().isoformat())
    up = []; parity = []
    files = sorted(glob.glob(os.path.join(ROOT, 'raw', 'flashscore', '*.json')))
    seen = set()
    for f in files:
        date = os.path.basename(f)[:10]
        dd = (pd.Timestamp(date) - pd.Timestamp(datetime.date.today().isoformat())).days
        if dd < -2 or dd > 2: continue
        for e in json.load(open(f)):
            if e['id'] in seen or e['st'] not in (1, 2, 3): continue
            seen.add(e['id'])
            ia = M.match(e['g'], e['h']['slug'], e['h']['name'])
            ib = M.match(e['g'], e['a']['slug'], e['a']['name'])
            item = dict(id=e['id'], ts=e['ts'], st=e['st'], det=e['det'], win=e['win'], sets=e['sets'], t=e['tname'], lvl=e['lvl'], code=e['code'], q=e['q'], s=e['surface'], g=e['g'],
                        h=e['h']['name'], a=e['a']['name'], hs=e['h']['slug'], hc=e['h']['c'], ac=e['a']['c'], hp=e['h'].get('pid', ''), ap=e['a'].get('pid', ''),
                        hi=ia, ai=ib, **{'as': e['a']['slug']})
            if e['st'] == 1 and ia is not None and ib is not None:
                A = decode(shards[ia % NSH][str(ia)], e['g'], '', day_end); B = decode(shards[ib % NSH][str(ib)], e['g'], '', day_end)
                s_ = engine.SURF[e['surface']]
                ctx = dict(day=today, dayA=ref_day(A, today, gap_start), dayB=ref_day(B, today, gap_start), surface=s_,
                           lvl_code=e['code'], is_qual=e['q'], best_of=5 if (e['code'] == 6 and e['g'] == 'M' and not e['q']) else 3)
                x = engine.feats(A, B, ctx, A['h2h'].get(ib, (0, 0)))
                p, pg, pl = pred.predict(x); item['p'] = round(p, 4)
                if len(parity) < 40: parity.append(dict(ia=ia, ib=ib, today=today, surface=e['surface'], code=e['code'], q=e['q'],
                                                        bo=ctx['best_of'], x=[float(v) for v in x], p=p))
            up.append(item)
    # build-time snímek kurzů (Flashscore odds, bez klíče) pro dnešní/zítřejší nezačaté zápasy
    from concurrent.futures import ThreadPoolExecutor
    todo = [u for u in up if u['st'] == 1 and u['hp'] and u['ap']]
    def job(u):
        try: u['odds'] = fs.fetch_odds(u['id'], u['hp'], u['ap'])
        except Exception: u['odds'] = None
    if os.environ.get('NO_ODDS') != '1':
        with ThreadPoolExecutor(4) as ex: list(ex.map(job, todo))
    print('odds snapshot:', sum(1 for u in todo if u.get('odds')), '/', len(todo))
    json.dump(dict(built=meta['built'], matches=up), open(os.path.join(W, 'upcoming.json'), 'w'), separators=(',', ':'), ensure_ascii=False, allow_nan=False)
    json.dump(parity, open(os.path.join(D, 'parity.json'), 'w'))
    print('events', len(up), 'with prediction', sum('p' in u for u in up))

if __name__ == '__main__':
    main()
