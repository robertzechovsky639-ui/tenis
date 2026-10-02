/* Předzápasový posun podle kurzů a zpráv. Stromy ani krok z dohraného zápasu (0,008 / 0,9997) se nemění.
   Trh se do čísla namíchá jen zčásti. Set dostane menší podíl stejného posunu, takže nezůstane kopií zápasu.
   Váhy jsou zvlášť: hráč si nese poslední posun do dalšího zápasu, příznaky se hýbnou jedním krokem na změnu kurzu. */
(function (root) {
  const ALPHA = 0.35, MEM = 0.85, SET_SCALE = 0.62, CAP = 0.55, ZCAP = 0.20, ETA = 0.02, WCLIP = 0.08, MAX_STEPS = 4;
  const logit = p => { const q = Math.min(1 - 1e-6, Math.max(1e-6, p)); return Math.log(q / (1 - q)); };
  const sig = z => z > 20 ? 1 - 1e-9 : z < -20 ? 1e-9 : 1 / (1 + Math.exp(-z));
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  function show(p, d) {
    if (p == null || !(p > 0) || !(p < 1) || !d) return p;
    return sig(logit(p) + d);
  }
  /* Průměrný kurz bez marže. Pod 1,05 nebereme — to už není použitelný předzápasový kurz. */
  function implied(avg) {
    if (!avg || !(avg[0] > 1.05) || !(avg[1] > 1.05)) return null;
    const ih = 1 / avg[0], ia = 1 / avg[1];
    const p = ih / (ih + ia);
    return p > 0.02 && p < 0.98 ? p : null;
  }
  function oddsNudge(p, pMkt) {
    if (pMkt == null || !(p > 0) || !(p < 1)) return 0;
    return clamp(ALPHA * (logit(pMkt) - logit(p)), -CAP, CAP);
  }
  function phrase(name) {
    const s = String(name || '').replace(/\s+[A-Z]\.\s*$/, '').trim().toLowerCase();
    return s.length >= 4 ? s : '';
  }
  const BAD = [
    [/withdraws|withdrawal|pulled out|pulls out|ruled out|scratched|scratches/, 0.50],
    [/out for the (rest|year|season)|out for rest of|will not play|won't play|will miss|misses the/, 0.50],
    [/retires hurt|retired hurt|retires injured|retired with|retirement due/, 0.42],
    [/injur|medical timeout|health issue|unwell|illness/, 0.28],
    [/doping|suspended for|banned for/, 0.55]
  ];
  function badMag(text) {
    let m = 0;
    for (const [re, mag] of BAD) if (re.test(text) && -mag < m) m = -mag;
    return m;
  }
  /* Jméno musí být podmět zprávy (těsně před slovesem), ať se šok nepřenese na soupeře ve stejné větě. */
  function shockText(text, ph) {
    if (!text || !ph) return 0;
    const t = text.toLowerCase(), p = ph.toLowerCase();
    let i = 0, best = 0;
    while ((i = t.indexOf(p, i)) !== -1) {
      const preOk = i === 0 || /[^a-z]/.test(t[i - 1]);
      const postOk = i + p.length >= t.length || /[^a-z]/.test(t[i + p.length]);
      if (preOk && postOk) {
        const after = t.slice(i + p.length, i + p.length + 48);
        const gap = after.split(',')[0];
        const mag = badMag(gap);
        if (mag < best) best = mag;
      }
      i += p.length;
    }
    return best;
  }
  const RESULT = /\b(beats?|defeats?|wins?|won|rallies|rallied|advances|reaches|captures|claims|highlights|victory|champion|title)\b/;
  function shockArticle(a, ph, now) {
    if (!a || !ph) return 0;
    const pub = Date.parse(a.published || '');
    if (!pub || now - pub > 96 * 3600 * 1000 || pub > now + 3600 * 1000) return 0;
    const head = String(a.headline || ''), desc = String(a.description || '');
    const hs = shockText(head, ph);
    if (hs) return hs;
    if (RESULT.test(head.toLowerCase())) return 0;
    return shockText(desc, ph);
  }
  function shockFromArticles(articles, ph, now) {
    let best = 0;
    for (const a of articles || []) {
      const s = shockArticle(a, ph, now);
      if (s < best) best = s;
    }
    return best;
  }
  function fresh() { return { v: 1, w: [], seen: [], ph: {}, n: 0 }; }
  function zOf(st, x, cols, scale, F) {
    if (!st || !x || !cols || !st.w) return 0;
    let z = 0;
    for (let i = 0; i < cols.length; i++) {
      const w = st.w[i]; if (!w) continue;
      const fi = F.indexOf(cols[i]); if (fi < 0) continue;
      z += w * ((x[fi] || 0) / (scale[i] || 1));
    }
    return clamp(z, -ZCAP, ZCAP);
  }
  function stepsFor(st, id) {
    const p = 'o|' + id + '|';
    let n = 0;
    for (const s of st.seen || []) if (s.indexOf(p) === 0) n++;
    return n;
  }
  function featStep(st, x, y, p0, cols, scale, F, mk, id) {
    if (!x || !cols || !F) return false;
    st.seen = st.seen || []; st.w = st.w || [];
    if (st.seen.indexOf(mk) >= 0) return false;
    if (stepsFor(st, id) >= MAX_STEPS) return false;
    while (st.w.length < cols.length) st.w.push(0);
    const z = zOf(st, x, cols, scale, F);
    const p = sig(logit(p0) + z);
    const err = p - y;
    for (let i = 0; i < cols.length; i++) {
      const fi = F.indexOf(cols[i]); if (fi < 0) continue;
      const xs = (x[fi] || 0) / (scale[i] || 1);
      if (!xs) continue;
      st.w[i] = clamp((st.w[i] || 0) - ETA * err * xs, -WCLIP, WCLIP);
    }
    st.seen.push(mk);
    if (st.seen.length > 4000) st.seen = st.seen.slice(-4000);
    st.n = (st.n || 0) + 1;
    return true;
  }
  function pushPlayer(st, pid, from, signed) {
    if (!pid) return;
    const arr = st.ph[pid] || [];
    const i = arr.findIndex(x => x.from === from);
    const rec = { from: from, d: signed };
    if (i >= 0) arr[i] = rec; else arr.push(rec);
    while (arr.length > 4) arr.shift();
    st.ph[pid] = arr;
  }
  function val(st, pid, exclude) {
    const arr = (st.ph && st.ph[pid]) || [];
    for (let i = arr.length - 1; i >= 0; i--) if (arr[i].from !== exclude) return arr[i].d;
    return 0;
  }
  /* Oba hráči nesou stejný zápas. Když mají oba záznam, bere se průměr, ať se posun nesečte dvakrát. */
  function playerDelta(st, hi, ai, exclude) {
    const h = val(st, hi, exclude), a = val(st, ai, exclude);
    if (h && a) return clamp((h - a) / 2, -0.40, 0.40);
    return clamp(h - a, -0.40, 0.40);
  }
  function displayDelta(st, rec) {
    const oddsN = oddsNudge(rec.p, rec.pMkt);
    const newsN = clamp((rec.newsH || 0) - (rec.newsA || 0), -CAP, CAP);
    const live = clamp(oddsN + newsN, -CAP, CAP);
    const pers = st ? playerDelta(st, rec.hi, rec.ai, rec.id) : 0;
    const z = st && rec.x ? zOf(st, rec.x, rec.cols, rec.scale, rec.F) : 0;
    return { oddsN, newsN, live, pers, z, d: clamp(live + pers + z, -CAP, CAP) };
  }
  /* Jeden zápis na hladinu kurzu. Stejný klíč už váhy příznaků neposune. Skreč a ITF sem nepatří. */
  function sync(st, rec) {
    if (!st || !rec || rec.skip) return null;
    if (!(rec.p > 0) || !(rec.p < 1)) return null;
    const view = displayDelta(st, rec);
    if (rec.pMkt != null && rec.hi && rec.ai) {
      const bucket = String(Math.round(rec.pMkt * 100));
      const mk = 'o|' + rec.id + '|' + bucket;
      const y = show(rec.p, view.oddsN);
      view.stepped = featStep(st, rec.x, y, rec.p, rec.cols, rec.scale, rec.F, mk, rec.id);
      pushPlayer(st, rec.hi, rec.id, MEM * view.oddsN);
      pushPlayer(st, rec.ai, rec.id, MEM * -view.oddsN);
    } else view.stepped = false;
    view.shown = show(rec.p, view.d);
    return view;
  }
  const api = { ALPHA, MEM, SET_SCALE, CAP, ZCAP, ETA, logit, sig, clamp, show, implied, oddsNudge, phrase, shockFromArticles, shockArticle, fresh, zOf, playerDelta, displayDelta, sync };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MK = api;
})(typeof self !== 'undefined' ? self : this);
