#!/usr/bin/env python3
"""Headless test na mobilní velikosti (390x844, UI ve stylu TNNS). Použití: test_mobile.py URL [outdir]"""
import sys, os, time, json
from playwright.sync_api import sync_playwright
url = sys.argv[1].split('#')[0]; out = sys.argv[2] if len(sys.argv) > 2 else '/tmp/tenis-shots'
os.makedirs(out, exist_ok=True)
errs = []; odds_req = []
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True, locale='cs-CZ', timezone_id='Europe/Prague')
    pg = ctx.new_page()
    pg.on('console', lambda m: errs.append(f'{m.type}: {m.text}') if m.type in ('error',) else None)
    pg.on('pageerror', lambda e: errs.append(f'pageerror: {e}'))
    pg.on('response', lambda r: odds_req.append(r.status) if 'lsapp.eu/odds' in r.url else None)
    t0 = time.time(); pg.goto(url, wait_until='domcontentloaded', timeout=90000)
    pg.wait_for_function("document.querySelector('#status').textContent.includes('aktualizováno')", timeout=120000)
    pg.wait_for_selector('.dtabs', timeout=30000); time.sleep(4)
    print('status:', pg.inner_text('#status'), f'({time.time()-t0:.1f}s)')
    def cnt():
        return pg.evaluate("""({rows: document.querySelectorAll('#v-zapasy .mr').length, groups: document.querySelectorAll('#v-zapasy .tg').length,
          live: document.querySelectorAll('#v-zapasy .mr.islive').length, probs: document.querySelectorAll('#v-zapasy .pb').length,
          odds: document.querySelectorAll('#v-zapasy .odds').length, value: document.querySelectorAll('#v-zapasy .od.val').length,
          liveOdds: document.querySelectorAll('#v-zapasy .odds .dot').length, flags: document.querySelectorAll('#v-zapasy img.fl').length})""")
    print('Dnes:', cnt())
    print('hlavičky:', pg.evaluate("[...document.querySelectorAll('.th')].slice(0,4).map(e=>e.innerText.replace(/\\n/g,' | ')).join(' || ')"))
    pg.screenshot(path=f'{out}/1_zapasy.png')
    # včera
    pg.click('[data-day="-1"]'); time.sleep(1.5); print('Včera:', cnt()); pg.screenshot(path=f'{out}/2_vcera.png')
    pg.click('[data-day="1"]'); time.sleep(3); print('Zítra:', cnt()); pg.screenshot(path=f'{out}/3_zitra.png')
    pg.select_option('#f-tour', 'ch'); time.sleep(1.5); print('Zítra Challenger:', cnt())
    pg.select_option('#f-tour', 'all'); pg.select_option('#f-st', 'value'); time.sleep(1.5); print('Zítra value:', cnt())
    pg.select_option('#f-st', 'all'); time.sleep(1)
    # detail zápasu s kurzy (první s data-fs)
    sel = '#v-zapasy .mr[data-fs]' if pg.locator('#v-zapasy .mr[data-fs]').count() else '#v-zapasy .mr'
    pg.locator(sel).first.click(); pg.wait_for_selector('#detail:not([hidden]) .dpl', timeout=30000); time.sleep(2)
    print('detail:', pg.inner_text('#detail .dhead').replace('\n', ' ')[:200])
    pg.screenshot(path=f'{out}/4_detail.png')
    for tab in ('predikce', 'kurzy', 'h2h', 'stat'):
        pg.click(f'[data-dtab={tab}]'); time.sleep(2.5 if tab == 'kurzy' else 0.8)
        txt = pg.inner_text('#d-body'); print(f'tab {tab}:', txt.replace('\n', ' ')[:260])
        pg.screenshot(path=f'{out}/5_{tab}.png', full_page=False)
        if tab == 'stat':
            print('forma: karty', pg.inner_text('#d-body .fsec .fcards').replace('\n', ' ') if pg.locator('#d-body .fsec .fcards').count() else '-', '| grafy:', pg.locator('#d-body .fchart svg').count(), '| čáry:', pg.locator('#d-body .fchart .fl').count(), '| body:', pg.locator('#d-body .fchart circle').count())
            if pg.locator('#d-body .fchart circle').count():
                fc = pg.locator('#d-body .fchart').first; fc.scroll_into_view_if_needed(); fc.locator('.fl0 circle').nth(6).click(); time.sleep(0.4)
                print('info bodu:', pg.inner_text('#d-body .fchart .pinfo'))
                print('osa X (detail):', pg.evaluate("[...document.querySelectorAll('#d-body .fchart .ax text')].slice(-4).map(t=>t.textContent).join(' | ')"), '| bodů na čáru:', pg.locator('#d-body .fchart .fl0 circle').count())
                pg.evaluate("(()=>{const e=document.querySelector('#d-body .fsec'); const sc=document.querySelector('#d-body'); e.scrollIntoView(); let p=e.parentElement; while(p && p.scrollHeight<=p.clientHeight) p=p.parentElement; if(p) p.scrollTop-=40; else window.scrollBy(0,-40);})()"); time.sleep(0.3); pg.screenshot(path=f'{out}/5_stat_graf.png')
                fc.scroll_into_view_if_needed(); pg.locator('#d-body [data-fsel="1"]').click(); time.sleep(0.3)
                print('přepínač: viditelné čáry', pg.evaluate("[...document.querySelectorAll('#d-body .fchart .fl')].filter(g=>getComputedStyle(g).display!=='none').length"))
                pg.screenshot(path=f'{out}/5b_stat_graf_jeden.png'); pg.locator('#d-body [data-fsel="all"]').click()
                if pg.locator('#d-body .fcards.adj').count():
                    pg.locator('#d-body .fcards.adj').scroll_into_view_if_needed(); time.sleep(0.2); print('kurzy dle formy:', pg.inner_text('#d-body .fcards.adj').replace('\n', ' ')); pg.screenshot(path=f'{out}/5c_kurzy_forma.png')
            print('sw po formě:', pg.evaluate('document.documentElement.scrollWidth'))
    # oblíbený hráč
    pg.locator('#detail .dp .star').first.click(); time.sleep(0.3)
    pg.click('#detail .back'); time.sleep(0.5)
    pg.click('.tabs a[data-v=oblibene]'); time.sleep(2); print('oblíbené:', pg.inner_text('#v-oblibene').replace('\n', ' ')[:200]); pg.screenshot(path=f'{out}/6_oblibene.png')
    pg.click('.tabs a[data-v=predikce]'); pg.wait_for_selector('#pa', timeout=60000); time.sleep(1)
    for s, q in (('#pa', 'Machac'), ('#pb', 'Lehecka')):
        pg.fill(s, q); pg.wait_for_selector(f'{s} ~ ul li', timeout=10000); pg.locator(f'{s} ~ ul li').first.click()
    pg.select_option('#ps', 'Clay'); pg.click('#pgo'); pg.wait_for_selector('#pres .big', timeout=30000); time.sleep(2)
    print('manual:', pg.inner_text('#pres .big').replace('\n', ' '))
    pg.screenshot(path=f'{out}/7_predikce.png', full_page=True)
    pg.click('.tabs a[data-v=hraci]'); pg.wait_for_selector('#hs'); time.sleep(0.5); pg.screenshot(path=f'{out}/8_hraci.png')
    pg.fill('#hs', 'Siniakova'); pg.wait_for_selector('#hs ~ ul li'); pg.locator('#hs ~ ul li').first.click()
    pg.wait_for_selector('#hp h2', timeout=30000); time.sleep(0.8); pg.screenshot(path=f'{out}/9_hrac.png')
    if pg.locator('#hp .fsec').count():
        pg.locator('#hp .fsec').first.scroll_into_view_if_needed(); time.sleep(0.3); pg.screenshot(path=f'{out}/9_hrac_graf.png')
    print('osa X (profil):', pg.evaluate("[...document.querySelectorAll('#hp .fchart .ax text')].slice(-4).map(t=>t.textContent).join(' | ')"), '| bodů:', pg.locator('#hp .fchart circle').count())
    print('forma v profilu:', pg.locator('#hp .fchart svg').count(), '| čar', pg.locator('#hp .fchart .fl').count(), '|', pg.inner_text('#hp .fcards').replace('\n', ' ') if pg.locator('#hp .fcards').count() else '-')
    print('profil:', pg.inner_text('#hp h2'))
    pg.click('.tabs a[data-v=model]'); time.sleep(1); pg.screenshot(path=f'{out}/10_model.png', full_page=True)
    print('model page chars:', len(pg.inner_text('#v-model')))
    # živé obnovení
    pg.click('.tabs a[data-v=zapasy]'); time.sleep(0.5)
    before = pg.evaluate('S.live.polls||0'); pg.evaluate('refreshLive(true)'); time.sleep(5)
    print('refresh polls:', before, '->', pg.evaluate('S.live.polls||0'), '| status:', pg.inner_text('#status'))
    print('live odds loaded:', pg.evaluate('S.live.oddsOk||0'), 'errors:', pg.evaluate('S.live.oddsErr||0'), '| odds HTTP:', {s: odds_req.count(s) for s in set(odds_req)})
    # plynulost kurzů: simulovaná změna kurzu -> inkrementální update bez posunu layoutu
    time.sleep(3)
    sim = pg.evaluate('''(() => { const el = [...document.querySelectorAll('#v-zapasy .mr')].find(x => { const e = S.byId[x.dataset.ev]; return e && e.oddsV && e.oddsV.avg; });
      if (!el) return 'žádný řádek s kurzy'; const e = S.byId[el.dataset.ev]; const h0 = el.offsetHeight, y0 = el.getBoundingClientRect().top;
      const o = JSON.parse(JSON.stringify(e.oddsV)); o.avg = [o.avg[0] + 0.07, o.avg[1] - 0.05]; o.live = true; o.t = Date.now();
      e.oddsV = diffOdds(o, e.oddsV); updateRowOdds(e);
      const p1 = el.querySelector('.od[data-k="1"]'), p2 = el.querySelector('.od[data-k="2"]');
      return {h0, h1: el.offsetHeight, dy: el.getBoundingClientRect().top - y0, flash1: p1.className, arrow1: p1.querySelector('.ar').className, arrow2: p2.querySelector('.ar').className, sameNode: !!el.isConnected}; })()''')
    time.sleep(1); print('simulace změny kurzu:', sim)
    print('šipky v seznamu (up/dn):', pg.evaluate("[document.querySelectorAll('#v-zapasy .od .ar.up').length, document.querySelectorAll('#v-zapasy .od .ar.dn').length]"))
    pg.screenshot(path=f'{out}/11_kurzy_zmena.png')
    w = pg.evaluate('document.documentElement.scrollWidth'); print('scrollWidth:', w, '(viewport 390)')
    b.close()
print('console errors:', errs[:10])
