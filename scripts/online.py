"""Průběžné doladění předzápasového modelu z každého dohraného zápasu.

Stromy LightGBM se nemění (ty přepočítá nedělní refit). Tady se po každém novém
výsledku posune jen malá logistická korekce na stejných rozdílových příznacích:
  logit(p) = logit(p_stromů) + w · (x / scale)
w začíná na nule, takže bez nových zápasů je predikce stejná jako nasazený model.
Váhy žijí ve state/online.json (denní job je commituje). Nedělní refit změní
train_end_day a tím se korekce vynuluje — nové stromy už ty zápasy viděly.
"""
import json, os, math
ETA = 0.008
DECAY = 0.9997
CLIP = 0.25
ZCAP = 0.35
SEEN_MAX = 4000

def logit(p):
    p = min(1 - 1e-6, max(1e-6, float(p)))
    return math.log(p / (1 - p))

def sig(z):
    if z > 20: return 1 - 1e-9
    if z < -20: return 1e-9
    return 1 / (1 + math.exp(-z))

def empty(base, cols, scale):
    return dict(base=str(base), cols=list(cols), scale=[float(s) for s in scale], w=[0.0] * len(cols), n=0, seen=[])

def load(path, base, cols, scale):
    st = None
    if path and os.path.exists(path):
        try: st = json.load(open(path))
        except Exception: st = None
    if not st or str(st.get('base')) != str(base) or list(st.get('cols') or []) != list(cols):
        return empty(base, cols, scale)
    st['w'] = [float(v) for v in st.get('w') or []]
    if len(st['w']) != len(cols): return empty(base, cols, scale)
    st['scale'] = [float(s) for s in st.get('scale') or scale]
    st['seen'] = [str(s) for s in st.get('seen') or []]
    st['n'] = int(st.get('n') or 0)
    return st

def save(path, st):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    json.dump(st, open(path, 'w'), ensure_ascii=False, separators=(',', ':'))

def z_of(st, x, idx):
    z = 0.0
    for c, s, w in zip(st['cols'], st['scale'], st['w']):
        if not w: continue
        z += w * (float(x[idx[c]]) / s)
    if z > ZCAP: return ZCAP
    if z < -ZCAP: return -ZCAP
    return z

def adjust(p, st, x, feats):
    if not st or not any(st['w']): return float(p)
    idx = {c: i for i, c in enumerate(feats)}
    return sig(logit(p) + z_of(st, x, idx))

def step(st, x, y, p_base, feats, mk):
    """Jeden krok. Nic, pokud ten zápas už ve frontě je. Vrací True, když se váhy hýbly."""
    mk = str(mk)
    if mk in st['seen']: return False
    idx = {c: i for i, c in enumerate(feats)}
    p = sig(logit(p_base) + z_of(st, x, idx))
    err = p - float(y)
    for i, c in enumerate(st['cols']):
        xs = float(x[idx[c]]) / st['scale'][i]
        v = DECAY * st['w'][i] - ETA * err * xs
        if v > CLIP: v = CLIP
        elif v < -CLIP: v = -CLIP
        st['w'][i] = v
    st['seen'].append(mk)
    if len(st['seen']) > SEEN_MAX: st['seen'] = st['seen'][-SEEN_MAX:]
    st['n'] = int(st.get('n') or 0) + 1
    return True
