#!/usr/bin/env python3
"""Headless test AI chatu (390x844): detail -> Zeptat se AI -> odpověď online služby; obecná otázka; viditelná chyba při výpadku všech služeb."""
import sys, os, time
from playwright.sync_api import sync_playwright
url = sys.argv[1].split('#')[0]; out = sys.argv[2] if len(sys.argv) > 2 else '/tmp/chat-shots'; os.makedirs(out, exist_ok=True)
errs = []; ai_req = []
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True, locale='cs-CZ', timezone_id='Europe/Prague')
    pg = ctx.new_page(); pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('response', lambda r: ai_req.append((r.url.split('/')[2], r.status)) if any(h in r.url for h in ('llm7', 'ch.at', 'ovh.net', 'pollinations')) else None)
    pg.goto(url, wait_until='domcontentloaded'); pg.wait_for_function("document.querySelector('#status').textContent.includes('aktualizováno')", timeout=120000); time.sleep(2)
    pg.click('[data-day="1"]'); time.sleep(2)
    pg.locator('#v-zapasy .mr[data-fs]').first.click(); pg.wait_for_selector('#detail:not([hidden]) [data-ask]', timeout=30000); time.sleep(1.5)
    pg.screenshot(path=f'{out}/1_detail_ai_btn.png')
    pg.locator('#detail [data-ask]').first.click(); pg.wait_for_selector('#v-chat:not([hidden]) .cctx', timeout=10000); time.sleep(0.5)
    print('kontext:', pg.inner_text('#v-chat .cctx')); print('chipy:', pg.evaluate("[...document.querySelectorAll('.chip2')].map(x=>x.textContent).join(' | ')"))
    t0 = time.time(); pg.locator('.chip2').first.click()
    pg.wait_for_function("!document.querySelector('#c-wait') && document.querySelectorAll('#c-log .cmsg.bot, #c-log .cmsg.err').length >= 1 && (document.querySelector('#c-log .cmsg:last-child').classList.contains('bot') || document.querySelector('#c-log .cmsg:last-child').classList.contains('err'))", timeout=240000)
    last = pg.locator('#c-log .cmsg').last; print(f'odpověď 1 ({time.time()-t0:.1f}s, třída {last.get_attribute("class")}):', last.inner_text()[:700].replace('\n', ' '))
    pg.screenshot(path=f'{out}/2_chat_zapas.png', full_page=True)
    pg.click('#c-clear'); time.sleep(0.3); time.sleep(7)
    t0 = time.time(); pg.fill('#c-in', 'Nejjistější tipy dnes'); pg.click('#c-send')
    pg.wait_for_function("!document.querySelector('#c-wait')", timeout=240000); time.sleep(0.3)
    last = pg.locator('#c-log .cmsg').last; print(f'odpověď 2 ({time.time()-t0:.1f}s, {last.get_attribute("class")}):', last.inner_text()[:700].replace('\n', ' '))
    pg.screenshot(path=f'{out}/3_chat_obecny.png', full_page=True)
    # simulace výpadku všech služeb -> viditelná chyba
    pg.evaluate("for (const k in CH_PROV) CH_PROV[k].url = 'https://127.0.0.1:9/x'; CH.st = {};")
    pg.fill('#c-in', 'Test výpadku'); pg.click('#c-send'); pg.wait_for_function("!document.querySelector('#c-wait')", timeout=240000); time.sleep(0.3)
    print('chyba viditelná:', pg.locator('#c-log .cmsg.err').count() > 0, '|', pg.locator('#c-log .cmsg').last.inner_text()[:250].replace('\n', ' '))
    pg.screenshot(path=f'{out}/4_chat_chyba.png')
    print('gambling note:', pg.locator('#v-chat .gam').count(), '| scrollWidth', pg.evaluate('document.documentElement.scrollWidth'))
    b.close()
print('AI requests:', ai_req[:12]); print('page errors:', errs[:5])
