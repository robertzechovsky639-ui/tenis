/* Tenisový model v prohlížeči: 1:1 přepis scripts/engine.py (feats, update) + inference LR/LightGBM. */
(function (root) {
  'use strict';
  const SURF = { Hard: 0, Clay: 1, Grass: 2, Carpet: 3 };
  const LVL_MULT = { 6: 1.1, 5: 1.0, 4: 1.0, 3: 0.95, 2: 0.9, 1: 0.85, 0: 0.8 };
  const RANK_FILL = 2500.0, RING = 25, G_DIV = 1200.0, G_K = 5.0;

  function decode(st, g, dayEnd) {
    const ring = [];
    if (st[17]) for (const t of st[17].split(';')) {
      const a = t.split(',');
      ring.push([dayEnd - (+a[0]), +a[1], (+a[2]) / 100, +a[3], +a[4], +a[5]]);
    }
    const h2h = {};
    if (st[18]) for (const t of st[18].split(';')) { const [o, w, l] = t.split(':'); h2h[o] = [+w, +l]; }
    return { g, elo: st[0], n: st[1], se: st[2].slice(), sn: st[3].slice(), rank: st[4] || null, pts: st[5] || null,
      sw: st[6].slice(), sl: st[7].slice(), spw: st[8], rpw: st[9], ace: st[10], df: st[11], bps: st[12], ns: st[13],
      hand: st[14], ht: st[15] || null, dob: st[16], ring, last: ring.length ? ring[ring.length - 1][0] : null, h2h,
      gelo: st[19] ?? st[0], gse: (st[20] || st[2]).slice(), fx: (st[21] || '').split(';').filter(Boolean).map(t => { const a = t.split(','); return [dayEnd - (+a[0]), +a[1], (+a[2]) / 100, 0, +a[3], +a[4]]; }) };
  }
  function newPlayer(g) {
    const pr = g === 'W' ? { spw: 0.56, rpw: 0.44, ace: 0.03, df: 0.05, bps: 0.55 } : { spw: 0.62, rpw: 0.38, ace: 0.07, df: 0.04, bps: 0.60 };
    return { g, elo: 1500, n: 0, se: [1500, 1500, 1500, 1500], sn: [0, 0, 0, 0], rank: null, pts: null, sw: [0, 0, 0, 0], sl: [0, 0, 0, 0],
      spw: pr.spw, rpw: pr.rpw, ace: pr.ace, df: pr.df, bps: pr.bps, ns: 0, hand: '', ht: null, dob: null, ring: [], last: null, h2h: {}, isNew: true, gelo: 1500, gse: [1500, 1500, 1500, 1500] };
  }
  const form = (ring, k) => { const r = ring.slice(-k); let w = 0; for (const x of r) w += x[1]; return (w + 1) / (r.length + 2); };
  const fexp = (ring, k) => { const r = ring.slice(-k); if (!r.length) return 0; let s = 0; for (const x of r) s += x[1] - x[2]; return s / (r.length + 3); };
  function fatigue(ring, day) {
    let m7 = 0, m14 = 0, mins = 0;
    for (const x of ring) { if (day - x[0] <= 14) { m14++; mins += x[3]; if (day - x[0] <= 7) m7++; } }
    const last = ring.length ? ring[ring.length - 1][0] : null;
    const rest = last === null ? 30 : Math.min(30, Math.max(0, day - last));
    return [m7, m14, mins / 100, rest];
  }
  const avglvl = (ring) => { const r = ring.slice(-10); if (!r.length) return 1.0; let s = 0; for (const x of r) s += x[4]; return s / r.length; };
  function surfwr(p, s) {
    const tw = p.sw.reduce((a, b) => a + b, 0), tl = p.sl.reduce((a, b) => a + b, 0);
    const ov = (tw + 2) / (tw + tl + 4);
    return (p.sw[s] + 4 * ov) / (p.sw[s] + p.sl[s] + 4);
  }
  const fexpt = (ring, day) => { let s = 0, ws = 0; for (const x of ring) { const w = Math.exp(-Math.max(0, day - x[0]) / 45); s += w * (x[1] - x[2]); ws += w; } return s / (ws + 2); };
  const form60 = (ring, day) => { let w = 0, n = 0; for (const x of ring) if (day - x[0] <= 60) { n++; w += x[1]; } return (w + 1) / (n + 2); };
  const inact = (ring, day) => ring.length ? Math.log1p(Math.min(730, Math.max(0, day - ring[ring.length - 1][0]))) : Math.log1p(730);
  function rd(p, day) { const base = Math.max(40, 350 / Math.sqrt(1 + p.n / 5)); const t = p.ring.length ? Math.max(0, day - p.ring[p.ring.length - 1][0]) / 7 : 52; return Math.min(350, Math.sqrt(base * base + 900 * t)); }
  const age = (p, day) => (p.dob !== null && p.dob !== undefined) ? (day - p.dob) / 365.25 : null;
  const lrank = (r) => Math.log(r && r > 0 ? r : RANK_FILL);

  function feats(A, B, ctx, h2h) {
    const s = ctx.surface, day = ctx.day;
    const rA = ctx.rankA || A.rank, rB = ctx.rankB || B.rank;
    const pA = ctx.ptsA || A.pts || 0, pB = ctx.ptsB || B.pts || 0;
    const lrA = lrank(rA), lrB = lrank(rB);
    let aA = age(A, day), aB = age(B, day);
    if (aA === null) aA = 24; if (aB === null) aB = 24;
    const dA = ctx.dayA ?? day, dB = ctx.dayB ?? day;
    const fA = fatigue(A.ring, dA), fB = fatigue(B.ring, dB);
    const hA = A.ht || 0, hB = B.ht || 0, hmA = A.ht ? 0 : 1, hmB = B.ht ? 0 : 1;
    const htd = (hmA === 0 && hmB === 0) ? hA - hB : 0;
    const [w1, w2] = h2h;
    const d = [A.elo - B.elo, A.se[s] - B.se[s], lrB - lrA, Math.log1p(pA) - Math.log1p(pB), (rA ? 0 : 1) - (rB ? 0 : 1),
      form(A.ring, 10) - form(B.ring, 10), form(A.ring, 25) - form(B.ring, 25), fexp(A.ring, 10) - fexp(B.ring, 10),
      Math.log1p(A.n) - Math.log1p(B.n), Math.log1p(A.sn[s]) - Math.log1p(B.sn[s]), w1 - w2, aA - aB, htd, hmA - hmB,
      (A.hand === 'L' ? 1 : 0) - (B.hand === 'L' ? 1 : 0), fA[0] - fB[0], fA[1] - fB[1], fA[2] - fB[2], fA[3] - fB[3],
      surfwr(A, s) - surfwr(B, s), A.spw - B.spw, A.rpw - B.rpw, A.ace - B.ace, A.df - B.df, A.bps - B.bps,
      Math.log1p(A.ns) - Math.log1p(B.ns), avglvl(A.ring) - avglvl(B.ring),
      A.gelo - B.gelo, A.gse[s] - B.gse[s], fexpt(A.ring, dA) - fexpt(B.ring, dB), form60(A.ring, dA) - form60(B.ring, dB),
      inact(A.ring, dA) - inact(B.ring, dB), rd(A, dA) - rd(B, dB), (A.spw + A.rpw) - (B.spw + B.rpw)];
    const c = [ctx.lvl_code, ctx.is_qual, ctx.best_of, s, A.g === 'W' ? 1 : 0, (A.elo + B.elo) / 2, (lrA + lrB) / 2,
      A.elo, B.elo, aA, aB, lrA, lrB, w1 + w2];
    return d.concat(c);
  }
  function kf(n, lvl, q, ret) { let k = 250 / Math.pow(n + 5, 0.4) * (LVL_MULT[lvl] ?? 1); if (q) k *= 0.95; if (ret) k *= 0.5; return k; }
  /* Elo krok (stejný jako engine.update bez statistik podání) — vrací nové hodnoty, nemutuje */
  /* Elo z podílu gemů (engine.gelo_update): games = [gemy vítěze, gemy poraženého] nebo null */
  function gStep(wv, lv, kw, kl, games, ret) {
    if (games && games[0] + games[1] > 0 && !ret) { const e = 1 / (1 + Math.pow(10, (lv - wv) / G_DIV)), sg = games[0] / (games[0] + games[1]); return [wv + G_K * kw * (sg - e), lv - G_K * kl * (sg - e)]; }
    const e = 1 / (1 + Math.pow(10, (lv - wv) / 400)); return [wv + 0.5 * kw * (1 - e), lv - 0.5 * kl * (1 - e)];
  }
  function eloStep(W, L, s, lvl, q, ret, games) {
    const ew = 1 / (1 + Math.pow(10, (L.elo - W.elo) / 400));
    const ews = 1 / (1 + Math.pow(10, (L.se[s] - W.se[s]) / 400));
    const kW = kf(W.n, lvl, q, ret), kL = kf(L.n, lvl, q, ret), ksW = kf(W.sn[s], lvl, q, ret), ksL = kf(L.sn[s], lvl, q, ret);
    const g = gStep(W.gelo ?? W.elo, L.gelo ?? L.elo, kW, kL, games, ret);
    const gs = gStep(W.gse ? W.gse[s] : W.se[s], L.gse ? L.gse[s] : L.se[s], ksW, ksL, games, ret);
    return { ew, W: { elo: W.elo + kW * (1 - ew), se: W.se[s] + ksW * (1 - ews), gelo: g[0], gse: gs[0] }, L: { elo: L.elo - kL * (1 - ew), se: L.se[s] - ksL * (1 - ews), gelo: g[1], gse: gs[1] } };
  }
  function refDay(p, today, gapStart) {
    if (!p.ring.length) return today;
    const last = p.ring[p.ring.length - 1];
    if (last[0] <= gapStart + 7 && (last[4] <= 2 || (p.g === 'W' && last[4] === 3))) return last[0] + 7;
    return today;
  }
  class Model {
    constructor(m) {
      this.m = m; this.F = m.feats; this.di = m.diff.map(f => m.feats.indexOf(f));
      this.sw = Object.entries(m.swap).map(([a, b]) => [m.feats.indexOf(a), m.feats.indexOf(b)]);
      this.lrIdx = m.lr.cols.map(c => m.feats.indexOf(c));
    }
    swap(x) { const z = x.slice(); for (const i of this.di) z[i] = -z[i]; for (const [a, b] of this.sw) z[a] = x[b]; return z; }
    raw(x) {
      let s = 0;
      for (const [feat, thr, left, right, leaf] of this.m.gbm.trees) {
        let i = 0;
        while (true) { const nx = x[feat[i]] <= thr[i] ? left[i] : right[i]; if (nx < 0) { s += leaf[-nx - 1]; break; } i = nx; }
      }
      return s;
    }
    gbm(x) { const sg = v => 1 / (1 + Math.exp(-v)); const p = 0.5 * (sg(this.raw(x)) + 1 - sg(this.raw(this.swap(x)))); const a = this.m.cal ?? 1; if (a === 1) return p; const q = Math.min(Math.max(p, 1e-6), 1 - 1e-6); return sg(a * Math.log(q / (1 - q))); }
    lrContrib(x) { const L = this.m.lr; return L.cols.map((c, j) => [c, x[this.lrIdx[j]] / L.scale[j] * L.coef[j]]); }
    lr(x) { const z = this.lrContrib(x).reduce((a, b) => a + b[1], 0); return 1 / (1 + Math.exp(-z)); }
    elo(x) { return 1 / (1 + Math.pow(10, -(0.5 * x[0] + 0.5 * x[1]) / 400)); }
    base(x) { const g = this.gbm(x), l = this.lr(x), w = this.m.w_gbm; return w * g + (1 - w) * l; }
    predict(x) {
      const g = this.gbm(x), l = this.lr(x), w = this.m.w_gbm;
      const p0 = w * g + (1 - w) * l;
      const on = this.m.online;
      const p = on && on.w ? adjustOnline(p0, x, this.F, on) : p0;
      return { p, gbm: g, lr: l, elo: this.elo(x), p0 };
    }
  }
  /* Průběžná korekce: logit(p) = logit(p_stromů) + w·(x/scale). w=0 => stejné p. */
  const ON_ETA = 0.002, ON_DECAY = 0.999, ON_CLIP = 0.15, ON_ZCAP = 0.35, ON_SEEN = 4000;
  function crc32(str) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < str.length; i++) {
      c ^= str.charCodeAt(i);
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
    }
    return (~c) >>> 0;
  }
  function logitP(p) { const q = Math.min(1 - 1e-6, Math.max(1e-6, p)); return Math.log(q / (1 - q)); }
  function sigP(z) { if (z > 20) return 1 - 1e-9; if (z < -20) return 1e-9; return 1 / (1 + Math.exp(-z)); }
  function zOnline(x, F, on) {
    let z = 0;
    for (let i = 0; i < on.cols.length; i++) {
      const w = on.w[i]; if (!w) continue;
      z += w * (x[F.indexOf(on.cols[i])] / on.scale[i]);
    }
    return z > ON_ZCAP ? ON_ZCAP : z < -ON_ZCAP ? -ON_ZCAP : z;
  }
  function adjustOnline(p, x, F, on) {
    if (!on || !on.w || !on.w.some(v => v)) return p;
    return sigP(logitP(p) + zOnline(x, F, on));
  }
  /* Jeden krok z dohraného zápasu. x jsou příznaky PŘED zápasem, y je 0/1 pro stranu A. */
  function onlineStep(on, x, y, p0, F, mk) {
    mk = String(mk);
    if (!on || !on.w || (on.seen || []).indexOf(mk) >= 0) return false;
    const p = sigP(logitP(p0) + zOnline(x, F, on));
    const err = p - y;
    for (let i = 0; i < on.cols.length; i++) {
      const xs = x[F.indexOf(on.cols[i])] / on.scale[i];
      let v = ON_DECAY * on.w[i] - ON_ETA * err * xs;
      if (v > ON_CLIP) v = ON_CLIP; else if (v < -ON_CLIP) v = -ON_CLIP;
      on.w[i] = v;
    }
    on.seen = on.seen || []; on.seen.push(mk);
    if (on.seen.length > ON_SEEN) on.seen = on.seen.slice(-ON_SEEN);
    on.n = (on.n || 0) + 1;
    return true;
  }
  const api = { SURF, RING, decode, newPlayer, feats, kf, eloStep, refDay, Model, fatigue, form, crc32, onlineStep, adjustOnline };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.TM = api;
})(typeof self !== 'undefined' ? self : this);
