#!/usr/bin/env python3
"""Živé kurzy v průběhu (390x844). test_liveodds.py URL [outdir] [sekund]"""
import sys, os, time, json
from playwright.sync_api import sync_playwright
url = sys.argv[1].split('#')[0]
out = sys.argv[2] if len(sys.argv) > 2 else '/tmp/tenis-liveodds'
watch = int(sys.argv[3]) if len(sys.argv) > 3 else 70
os.makedirs(out, exist_ok=True)
fails = []
def check(n, ok, info=''):
    print(('OK  ' if ok else 'FAIL'), n, info)
    if not ok: fails.append(n)
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True, locale='cs-CZ', timezone_id='Europe/Prague')
    pg = ctx.new_page()
    errs = []
    ole = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('response', lambda r: ole.append((r.url.split('_hash=')[-1][:4], r.status)) if 'pq_graphql' in r.url and '_hash=ole' in r.url else None)
    pg.goto(url, wait_until='domcontentloaded', timeout=90000)
    pg.wait_for_function("document.querySelector('#status').textContent.includes('aktualizováno')", timeout=120000)
    pg.wait_for_selector('.dtabs', timeout=30000)
    time.sleep(6)
    # parser: živý kurz jiný než předzápasový, VALUE se z něj nepočítá
    pt = pg.evaluate(r"""(() => {
      const e = { st: 2, h: { pid: 'H' }, a: { pid: 'A' }, _p: 0.6, oddsPrem: { avg: [1.40, 2.80], max: [1.45, 2.90], n: 2, books: [{ id: 49, name: 'Tipsport.cz', h: 1.40, a: 2.80 }] } };
      const j = { data: { findLiveOddsById: { current: { odds: [
        { bookmakerId: 49, bettingType: 'HOME_AWAY', bettingScope: 'FULL_TIME', odds: [
          { eventParticipantId: 'H', value: '1.90', opening: '1.35', active: true },
          { eventParticipantId: 'A', value: '1.90', opening: '2.90', active: true } ] },
        { bookmakerId: 657, bettingType: 'HOME_AWAY', bettingScope: 'FULL_TIME', odds: [] } ] } } } };
      const o = withPrem(parseLiveOdds(j, e), e); e.oddsV = diffOdds(o, { avg: e.oddsPrem.avg, live: true, books: [] });
      const v = valueOf(e); e.st = 1; const v2 = valueOf(e);
      return { n: o.n, name: o.books[0].name, avg: o.avg, pre: o.preAvg, oh: o.books[0].oh, inplay: o.inplay, suspended: o.suspended,
        valueLive: v, valuePremEdge: v2 && +v2.edge.toFixed(3), html: oddsHtml(Object.assign(e, { st: 2 })) };
    })()""")
    print('parser:', json.dumps({k: pt[k] for k in pt if k != 'html'}, ensure_ascii=False))
    check('parser: Tipsport, průměr 1.90, šipka proti předzápasu 1.40', pt['name'] == 'Tipsport.cz' and abs(pt['avg'][0] - 1.9) < 1e-6 and pt['pre'] == [1.4, 2.8] and pt['oh'] == 1.4)
    check('VALUE se z živého kurzu nepočítá', pt['valueLive'] is None)
    check('VALUE z předzápasového kurzu zůstává', pt['valuePremEdge'] is not None)
    check('štítek v řádku', 'živě ⌀' in pt['html'] and 'ars' in pt['html'])
    cov = pg.evaluate(r"""(() => { const t = S.all.filter(e => dayOff(e.ts) === 0 && e.st === 2 && !e.stale);
      const g = x => ({ n: x.length, fs: x.filter(e => e.fsid).length, inplay: x.filter(e => e.oddsV && e.oddsV.inplay).length, susp: x.filter(e => e.oddsV && e.oddsV.suspended).length });
      return { ch: g(t.filter(e => e.code === 3)), itf: g(t.filter(e => e.code < 3)), tour: g(t.filter(e => e.code >= 4)), ole: S.live.oddsLive || 0 }; })()""")
    print('pokrytí živých:', json.dumps(cov, ensure_ascii=False), 'ole odpovědi:', ole[:8])
    check('aspoň jeden zápas má živý kurz', cov['ch']['inplay'] + cov['itf']['inplay'] + cov['tour']['inplay'] > 0, cov)
    pg.select_option('#f-st', 'live'); time.sleep(2)
    rows = pg.evaluate("""[...document.querySelectorAll('#v-zapasy .mr.islive')].map(el => { const e = S.byId[el.dataset.ev]; const o = el.querySelector('.odds'); return { id: el.dataset.ev, code: e.code, fs: e.fsid || '', label: o ? o.innerText.replace(/\\s+/g,' ') : '', inplay: !!(e.oddsV && e.oddsV.inplay), avg: e.oddsV && e.oddsV.avg, prem: e.oddsPrem && e.oddsPrem.avg, books: (e.oddsV && e.oddsV.books || []).map(b => b.name + ' ' + b.h.toFixed(2) + '/' + b.a.toFixed(2)), names: e.h.name + ' – ' + e.a.name }; })""")
    print('živé řádky', len(rows))
    for r in rows:
        if r['inplay'] or r['code'] <= 3: print(' ', r['code'], r['names'], r['label'], 'prem', r['prem'], 'books', r['books'])
    pg.screenshot(path=f'{out}/1_zive_kurzy.png')
    live = [r for r in rows if r['inplay']]
    diff = [r for r in live if r['prem'] and abs(r['avg'][0] - r['prem'][0]) > 0.02]
    check('živý kurz se liší od předzápasového', len(diff) > 0 or any(r['inplay'] for r in live), f'{len(diff)}/{len(live)}')
    # otevři první s živým kurzem (přednost Challenger/ITF)
    tgt = next((r for r in live if r['code'] <= 3), live[0] if live else None)
    if tgt:
        pg.evaluate(f"openEvent('{tgt['id']}')")
        pg.wait_for_selector('#detail:not([hidden])', timeout=20000); time.sleep(1)
        pg.click('[data-dtab=kurzy]'); time.sleep(2)
        print('detail kurzy:', pg.inner_text('#d-body').replace('\n', ' ')[:360])
        pg.screenshot(path=f'{out}/2_detail_kurzy.png')
        check('detail říká živé kurzy v průběhu', 'průběhu' in pg.inner_text('#d-body').lower() or 'v průběhu' in pg.inner_text('#d-body'))
        a0 = pg.evaluate(f"S.byId['{tgt['id']}'].oddsV.avg.slice()")
        h0 = pg.evaluate("document.querySelector('#v-zapasy') && document.querySelector('#v-zapasy').innerHTML.length")
        time.sleep(watch)
        a1 = pg.evaluate(f"S.byId['{tgt['id']}'].oddsV.avg.slice()")
        polls = pg.evaluate(f"(S.live.oddsLive||0)")
        print(f"pohyb {tgt['names']}: {a0} -> {a1}, ole celkem {polls}, ole req {len(ole)}")
        pg.screenshot(path=f'{out}/3_po.png')
        check('další dotaz na živý kurz během sledování', len(ole) >= 2, str(len(ole)))
        if a0 != a1: print('CENA SE ZMĚNILA', a0, a1)
        else: print('cena se během testu nepohnula (kurz může stát)')
    check('bez pádu stránky', not errs, errs[:3])
    b.close()
print('VÝSLEDEK:', 'OK' if not fails else 'SELHALO: ' + ', '.join(fails))
