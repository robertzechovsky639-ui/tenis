import numpy as np, pandas as pd, re, math, sys, time, itertools
df = pd.read_parquet('data/matches.parquet', columns=['winner_id','loser_id','surface','lvl_code','is_qual','ret','score','tourney_date'])
W = df.winner_id.to_numpy(); L = df.loser_id.to_numpy(); S = df.surface.map({'Hard':0,'Clay':1,'Grass':2,'Carpet':3}).fillna(0).astype(int).to_numpy()
LV = df.lvl_code.to_numpy(); Q = df.is_qual.to_numpy(); R = df.ret.to_numpy(); TD = df.tourney_date.to_numpy()
rx = re.compile(r'(\d+)-(\d+)')
G = []
for s in df.score.fillna(''):
    a = b = 0
    for x, y in rx.findall(s): a += int(x); b += int(y)
    G.append((a, b))
G = np.array(G)
LVL_MULT = {6: 1.1, 5: 1.0, 4: 1.0, 3: 0.95, 2: 0.9, 1: 0.85, 0: 0.8}
ev = (TD >= 20220101) & (TD < 20260101) & (R == 0)
def run(K0=250, off=5, ex=0.4, gdiv=1600, gk=3.0, fk=60, surfw=0.5):
    e = {}; se = {}; n = {}; sn = {}; ge = {}; fe = {}
    pe = np.zeros(len(W)); pg = np.zeros(len(W)); pf = np.zeros(len(W)); pb = np.zeros(len(W))
    for i in range(len(W)):
        w, l, s = W[i], L[i], S[i]
        ew_, el_ = e.get(w, 1500.), e.get(l, 1500.)
        sw_, sl_ = se.get((w, s), 1500.), se.get((l, s), 1500.)
        gw, gl = ge.get(w, 1500.), ge.get(l, 1500.)
        fw, fl = fe.get(w, 1500.), fe.get(l, 1500.)
        pe[i] = 1/(1+10**((el_-ew_)/400)); pb[i] = 1/(1+10**(((1-surfw)*(el_-ew_)+surfw*(sl_-sw_))/400))
        pg[i] = 1/(1+10**((gl-gw)/400)); pf[i] = 1/(1+10**((fl-fw)/400))
        m = LVL_MULT.get(int(LV[i]), 1.0) * (0.95 if Q[i] else 1.0) * (0.5 if R[i] else 1.0)
        nw, nl = n.get(w, 0), n.get(l, 0); snw, snl = sn.get((w, s), 0), sn.get((l, s), 0)
        kw = K0/((nw+off)**ex)*m; kl = K0/((nl+off)**ex)*m
        e[w] = ew_ + kw*(1-pe[i]); e[l] = el_ - kl*(1-pe[i])
        pes = 1/(1+10**((sl_-sw_)/400))
        se[(w, s)] = sw_ + K0/((snw+off)**ex)*m*(1-pes); se[(l, s)] = sl_ - K0/((snl+off)**ex)*m*(1-pes)
        n[w] = nw+1; n[l] = nl+1; sn[(w, s)] = snw+1; sn[(l, s)] = snl+1
        a, b = G[i]
        if a + b > 0 and not R[i]:
            Eg = 1/(1+10**((gl-gw)/gdiv)); Sg = a/(a+b)
            ge[w] = gw + gk*kw*(Sg-Eg); ge[l] = gl - gk*kl*(Sg-Eg)
        else:
            ge[w] = gw + kw*(1-pg[i])*0.5; ge[l] = gl - kl*(1-pg[i])*0.5
        fe[w] = fw + fk*m*(1-pf[i]); fe[l] = fl - fk*m*(1-pf[i])
    def ll(p):
        p = np.clip(p[ev], 1e-6, 1-1e-6)
        # fit scale for fairness: logistic calibration a*logit
        z = np.log(p/(1-p)); best = min(((np.mean(np.log1p(np.exp(-a*z)))), a) for a in np.linspace(0.3, 2.0, 35))
        return round(best[0], 4), round(best[1], 2), round(float((p > 0.5).mean()), 4)
    return dict(elo=ll(pe), blend=ll(pb), gelo=ll(pg), felo=ll(pf))
cfgs = [dict()] + [dict(gdiv=gd, gk=gk) for gd, gk in [(1600, 2.0), (1600, 5.0), (1000, 3.0), (2400, 3.0)]] + [dict(fk=f) for f in (30, 100)] + [dict(K0=300), dict(ex=0.35), dict(off=10), dict(surfw=0.3)]
for c in cfgs:
    t = time.time(); print(c, run(**c), round(time.time()-t), flush=True)
