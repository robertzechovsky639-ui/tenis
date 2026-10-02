/* Ověření předzápasového posunu. Když tohle selže, model se nenasazuje. */
const assert = require('assert');
const MK = require('../web/mkt.js');
const fs = require('fs');

const modelJs = fs.readFileSync('web/model.js', 'utf8');
assert(modelJs.includes('const ON_ETA = 0.008, ON_DECAY = 0.9997'), 'krok z výsledku se nesmí změnit');
const onlinePy = fs.readFileSync('scripts/online.py', 'utf8');
assert(onlinePy.includes('ETA = 0.008') && onlinePy.includes('DECAY = 0.9997'), 'python krok se nesmí změnit');
const app = fs.readFileSync('web/app.js', 'utf8');
assert(!/syncMarket[\s\S]{0,400}onlineStep/.test(app), 'posun z kurzů nesmí volat krok z výsledku');
assert(app.includes('function liveIds'), 'liveIds musí zůstat');

function near(a, b, e) { assert(Math.abs(a - b) < e, a + ' !~ ' + b); }

/* Sakkari z živého snímku 2. 10. 2026: model 75,7 %, trh 68,9 %. */
const p = 0.7567, avg = [1.387, 3.07];
const mkt = MK.implied(avg);
near(mkt, 0.6888, 0.002);
const n = MK.oddsNudge(p, mkt);
assert(n < -0.08 && n > -0.20, 'nudge ' + n);
const shown = MK.show(p, n);
assert(shown < p - 0.015 && shown > mkt + 0.02, 'shown ' + shown + ' model ' + p + ' mkt ' + mkt);
const setBase = 0.63;
const setShown = MK.show(setBase, MK.SET_SCALE * n);
assert(Math.abs(setShown - shown) > 0.04, 'set se nesmí slít se zápasem');
const setIfEqual = MK.show(p, MK.SET_SCALE * n);
assert(Math.abs(setIfEqual - shown) > 0.008, 'i při stejné bázi zůstane set jinde');
assert(MK.implied([1.04, 12]) == null, 'kurz pod 1,05 se nepoužije');
assert(MK.implied(null) == null);
assert(MK.show(p, 0) === p);

/* Zprávy: odhlášení ano, rekapitulace ne, cizí příjmení ne. */
const now = Date.parse('2026-10-02T21:55:00Z');
const nav = { headline: 'Emma Navarro out for rest of year to focus on health issues', description: '', published: '2026-10-01T05:16:03Z' };
assert(MK.shockArticle(nav, 'navarro', now) <= -0.50);
const recap = { headline: 'Novak Djokovic rallies, improves to 31-0 at China Open', description: 'Novak Djokovic rallied to beat Bu Yunchaokete.', published: '2026-10-02T17:18:15Z' };
assert(MK.shockArticle(recap, 'djokovic', now) === 0);
const title = { headline: "Elena Rybakina's unexpected US Open title", description: 'From a questionable injury status to world No. 1.', published: '2026-10-02T12:00:00Z' };
assert(MK.shockArticle(title, 'rybakina', now) === 0);
const both = { headline: 'Jessica Pegula withdraws, Coco Gauff advances in Beijing', description: '', published: '2026-10-02T12:00:00Z' };
assert(MK.shockArticle(both, 'pegula', now) <= -0.50);
assert(MK.shockArticle(both, 'gauff', now) === 0, 'postup soupeře není jeho zranění');
const old = { headline: 'Jessica Pegula withdraws from WTA tournament in Singapore', description: '', published: '2026-09-18T23:36:10Z' };
assert(MK.shockArticle(old, 'pegula', now) === 0);
assert(MK.phrase('Harrison C.') === 'harrison');
assert(MK.shockArticle({ headline: 'Christian Harrison and Neal Skupski win the title', published: '2026-10-02T12:00:00Z' }, 'harris', now) === 0);

/* Učení: další zápas hráčky se pohne, stejný kurz podruhé už ne, set není kopie. */
const cols = ['d_elo', 'd_form10'], scale = [195, 0.2], F = ['d_elo', 'd_form10'];
const x = [80, 0.1];
const st = MK.fresh();
const rec = { id: 'm1', hi: 'sakkari', ai: 'hunter', p, pMkt: mkt, x, cols, scale, F };
const a = MK.sync(st, rec);
assert(a.stepped === true);
const w1 = st.w.slice(), n1 = st.n;
const b = MK.sync(st, rec);
assert(b.stepped === false, 'stejná hladina kurzu se nesmí učit podruhé');
assert(st.n === n1);
assert(st.w.every((v, i) => v === w1[i]));
/* vlastní zápas se znovu nepřičte ke své paměti */
const again = MK.displayDelta(st, rec);
near(again.pers, 0, 1e-9);
assert(Math.abs(again.d - a.live) < 0.03, 'aktuální zápas nemá dvojí posun');
/* další zápas bez kurzu */
const nxt = MK.displayDelta(st, { id: 'm2', hi: 'sakkari', ai: 'other', p, pMkt: null, x, cols, scale, F });
assert(nxt.pers < -0.06, 'další zápas Sakkari se musí pohnout, pers ' + nxt.pers);
const p2 = MK.show(p, nxt.d);
assert(p2 < p - 0.012, 'pravděpodobnost dalšího zápasu klesla');
const set2 = MK.show(setBase, MK.SET_SCALE * nxt.d);
assert(set2 < setBase - 0.005, 'set dalšího zápasu se pohne');
assert(Math.abs(set2 - p2) > 0.03, 'set dalšího zápasu není kopie zápasu');
/* pohyb kurzu je nový krok, ne přičtení starého */
const moved = MK.sync(st, Object.assign({}, rec, { pMkt: 0.60 }));
assert(moved.stepped === true);
const held = MK.val ? null : MK.playerDelta(st, 'sakkari', 'hunter', 'other-match');
assert(held < 0 && held > -0.5);
/* skreč / ITF se nezapíše */
const st2 = MK.fresh();
assert(MK.sync(st2, Object.assign({}, rec, { skip: true })) == null);
assert(st2.n === 0 && Object.keys(st2.ph).length === 0);
/* zpráva ohne aktuální zápas i bez toho, aby se sčítala s rekapitulací */
const news = MK.displayDelta(MK.fresh(), { id: 'm3', hi: 'navarro', ai: 'x', p: 0.6, pMkt: null, newsH: -0.5, newsA: 0 });
assert(news.d <= -0.28 && news.d >= -0.55);
assert(MK.show(0.6, news.d) < 0.55);

console.log('mkt ok',
  'sakkari model', (p * 100).toFixed(1),
  'trh', (mkt * 100).toFixed(1),
  'zobrazeno', (shown * 100).toFixed(1),
  'set', (setShown * 100).toFixed(1),
  'další zápas', (p2 * 100).toFixed(1),
  'jeho set', (set2 * 100).toFixed(1));
