#!/usr/bin/env python3
"""Test živého skóre Challenger/WTA 125 (365scores) v prohlížeči (390x844). Použití: test_live.py URL [outdir] [sekund_sledování]
- ověří, že 365scores jde stáhnout z origin stránky (CORS), spočítá pokrytí Challenger/ITF/WTA 125,
- testy parseru (dokončený zápas s tiebreakem a skrečí, živý zápas, čtyřhra), párování podle příjmení, prohozené pořadí,
- sleduje živé zápasy a hlásí změny skóre v řádcích (bez překreslení seznamu)."""
import sys, os, time, json
from playwright.sync_api import sync_playwright
url = sys.argv[1].split('#')[0]; out = sys.argv[2] if len(sys.argv) > 2 else '/tmp/tenis-live'
watch = int(sys.argv[3]) if len(sys.argv) > 3 else 150
os.makedirs(out, exist_ok=True)
errs = []; fsreq = []; fails = []
def check(name, ok, info=''):
    print(('OK  ' if ok else 'FAIL'), name, info)
    if not ok: fails.append(name)
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True, locale='cs-CZ', timezone_id='Europe/Prague')
    pg = ctx.new_page()
    pg.on('console', lambda m: errs.append(f'{m.type}: {m.text}') if m.type == 'error' else None)
    pg.on('pageerror', lambda e: errs.append(f'pageerror: {e}'))
    pg.on('response', lambda r: fsreq.append((time.time(), r.url.split('?')[0].split('/')[-2] + ('/' + r.url.split('/')[2]), r.status, r.headers.get('access-control-allow-origin'))) if ('365scores.com' in r.url or 'sofascore.com' in r.url) else None)
    pg.on('requestfailed', lambda r: fsreq.append((time.time(), r.url.split('/feed/')[-1], 'FAILED ' + str(r.failure), None)) if ('365scores.com' in r.url or 'sofascore.com' in r.url) else None)
    pg.goto(url, wait_until='domcontentloaded', timeout=90000)
    pg.wait_for_function("document.querySelector('#status').textContent.includes('aktualizováno')", timeout=120000)
    pg.wait_for_selector('.dtabs', timeout=30000); time.sleep(3)
    print('origin:', pg.evaluate('location.origin'), '| status:', pg.inner_text('#status'))
    print('požadavky 365scores/Sofascore:', [x[1:] for x in fsreq[:8]])
    check('365scores z prohlížeče (CORS)', any(s == 200 and 'allscores' in u for _, u, s, _a in fsreq))
    # ---- parser ----
    pt = pg.evaluate(r"""(() => {
      const j = { competitions: [{ id: 1, name: 'Columbus', countryId: 301 }, { id: 2, name: 'Jingshan', countryId: 302 }, { id: 3, name: 'Columbus', countryId: 423 }],
        games: [
          { id: 11, competitionId: 1, stageName: 'Qualifications', startTime: '2026-09-28T17:32:55+02:00', statusGroup: 4, statusText: 'Ended',
            homeCompetitor: { name: 'Ilija Palavestra', nameForURL: 'ilija-palavestra', isWinner: false }, awayCompetitor: { name: 'Daniil Ostapenkov', nameForURL: 'daniil-ostapenkov', isWinner: true },
            stages: [{ shortName: 'S1', homeCompetitorScore: 6, awayCompetitorScore: 7, homeCompetitorExtraScore: 4, awayCompetitorExtraScore: 7 }, { shortName: 'S2', homeCompetitorScore: 1, awayCompetitorScore: 6 }, { shortName: 'S3', homeCompetitorScore: -1, awayCompetitorScore: -1 }, { shortName: 'Sets', homeCompetitorScore: 0, awayCompetitorScore: 2 }] },
          { id: 12, competitionId: 2, stageName: 'Round of 32', startTime: '2026-09-29T05:00:00+02:00', statusGroup: 3, statusText: '2nd Set',
            homeCompetitor: { name: 'Kristina Mladenovic', nameForURL: 'kristina-mladenovic' }, awayCompetitor: { name: 'Sara Costoulas', nameForURL: 'sara-costoulas', inPossession: true },
            stages: [{ shortName: 'Game', name: 'Game', homeCompetitorScore: 30, awayCompetitorScore: 40, isLive: true }, { shortName: 'S1', homeCompetitorScore: 6, awayCompetitorScore: 3 }, { shortName: 'S2', homeCompetitorScore: 2, awayCompetitorScore: 4 }, { shortName: 'S3', homeCompetitorScore: -1, awayCompetitorScore: -1 }] },
          { id: 13, competitionId: 1, stageName: 'Round of 32', startTime: '2026-09-29T18:00:00+02:00', statusGroup: 4, statusText: 'Player 2 Retired',
            homeCompetitor: { name: 'A B' }, awayCompetitor: { name: 'C D' }, stages: [{ shortName: 'S1', homeCompetitorScore: 3, awayCompetitorScore: 1 }] },
          { id: 14, competitionId: 3, startTime: '2026-09-29T18:00:00+02:00', statusGroup: 3, homeCompetitor: { name: 'Rybakov A./Smith K.' }, awayCompetitor: { name: 'Colby R./Zamora N.' }, stages: [] },
          { id: 15, competitionId: 1, startTime: '2026-09-29T18:00:00+02:00', statusGroup: 4, statusText: 'Cancelled', homeCompetitor: { name: 'E F' }, awayCompetitor: { name: 'G H' }, stages: [] }] };
      const ev = ev365(j); const f = ev.find(e => e.id === 'x11'), l = ev.find(e => e.id === 'x12'), r = ev.find(e => e.id === 'x13');
      return { n: ev.length, fin: f && { st: f.st, win: f.win, sets: f.sets, code: f.code, g: f.g, q: f.q, hn: f.h.name },
               live: l && { st: l.st, sets: l.sets, g: l.g, code: l.code, live: l.live, pts: l.pts, srv: l.srv }, ret: r && { st: r.st, det: r.det, win: r.win } };
    })()""")
    print('parser:', json.dumps(pt, ensure_ascii=False))
    check('parser: jen dvouhry, bez zrušených', pt['n'] == 3, pt['n'])
    check('parser: dokončený zápas + tiebreak', pt['fin'] == {'st': 3, 'win': 2, 'sets': [[6, 7, 4, 7], [1, 6]], 'code': 3, 'g': 'M', 'q': 1, 'hn': 'Palavestra I.'}, pt['fin'])
    check('parser: živý zápas WTA 125 (sety, body v gemu, podání)', pt['live'] == {'st': 2, 'sets': [[6, 3], [2, 4]], 'g': 'W', 'code': 3, 'live': '2. set', 'pts': ['30', '40'], 'srv': 2}, pt['live'])
    check('parser: skreč', pt['ret'] == {'st': 3, 'det': 8, 'win': 1}, pt['ret'])
    rc = pg.evaluate(r"""(() => { const l = { st: 2, sets: [[6, 3], [2, 4]], pts: ['30', 'A'], srv: 2 }; return [scoreCells(l, 0), scoreCells(l, 1)]; })()""")
    check('render: tečka podání + body v gemu', 'sv on' in rc[1] and 'sv on' not in rc[0] and '>A</span>' in rc[1])
    mg = pg.evaluate(r"""(() => { const ex = { st: 1, det: 0, win: 0, sets: [], ts: 1, src: 'snapshot', h: {}, a: {} };
      const e = { st: 2, det: 3, win: 0, sets: [[6, 3], [2, 4]], ts: 5, pts: ['30', 'A'], srv: 2, live: '2. set', src: '365scores', h: {}, a: {} };
      const c1 = mergeInto(ex, e, true); const r1 = JSON.stringify({ st: ex.st, sets: ex.sets, pts: ex.pts, srv: ex.srv, src: ex.src });
      mergeInto(ex, { ...e, st: 3, win: 1, pts: null, srv: 0, live: '' }, false);
      const back = mergeInto(ex, { ...e, src: 'ESPN' }, false);
      return { c1, r1, st: ex.st, back }; })()""")
    print('merge:', mg)
    check('merge: prohozené pořadí hráčů', mg['r1'] == '{"st":2,"sets":[[3,6],[4,2]],"pts":["A","30"],"srv":1,"src":"365scores"}', mg['r1'])
    check('merge: konec se nevrací na živě', mg['st'] == 3 and mg['back'] is False)
    # párování podle příjmení na skutečném zápase ze snímku (Challenger dnes/zítra)
    at = pg.evaluate(r"""(() => { const x = S.all.find(e => e.code === 3 && e.st === 1 && e.src === 'snapshot' && !(e.srcs || {})['365scores']); if (!x) return null;
      const P = p => { const t = String(p.name).replace(/\./g, '').split(/\s+/); return { name: p.name, full: t.slice(1).join(' ') + ' ' + t[0], slug: '', c: '' }; };
      const e = { id: 'xTEST', ts: x.ts + 600, st: 2, det: 3, win: 0, sets: [[1, 0]], h: P(x.a), a: P(x.h), g: x.g, code: 3, q: x.q, src: '365scores', live: '1. set' };
      const r = attachEvent(e); const ok = !!r && r.ex === x && x.st === 2 && JSON.stringify(x.sets) === '[[0,1]]';
      Object.assign(x, { st: 1, sets: [], live: '', src: 'snapshot' }); delete S.byId.xTEST; return { ok, id: x.id, names: [x.h.name, x.a.name] }; })()""")
    print('párování podle příjmení:', at)
    if at: check('attach: párování podle příjmení + prohozené pořadí', at['ok'])
    # ---- pokrytí ----
    cov = pg.evaluate(r"""(() => { const t = todayDay(); const today = S.all.filter(e => dayOff(e.ts) === 0);
      const low = today.filter(e => e.code <= 3);
      const c = x => ({ total: x.length, m365: x.filter(e => (e.srcs || {})['365scores']).length, sofa: x.filter(e => (e.srcs || {}).Sofascore).length,
        live: x.filter(e => e.st === 2 && !e.stale).length, fin: x.filter(e => e.st === 3).length, stale: x.filter(e => e.stale).length,
        unk: x.filter(e => { const r = resolveEv(e); return r.hu || r.au; }).length });
      return { ch: c(low.filter(e => e.code === 3)), itf: c(low.filter(e => e.code < 3)), tour: c(today.filter(e => e.code >= 4)),
               src: S.live.srcCount, l365: S.l365, sofa: S.live.sofa }; })()""")
    print('pokrytí dnes:', json.dumps(cov, ensure_ascii=False))
    check('Challenger/WTA 125 zápasy spárované s 365scores', cov['ch']['m365'] > 0, f"{cov['ch']['m365']}/{cov['ch']['total']}")
    pg.screenshot(path=f'{out}/1_zapasy.png')
    # ---- sledování živých ----
    pg.select_option('#f-st', 'live'); time.sleep(1.5)
    rows = pg.evaluate("""[...document.querySelectorAll('#v-zapasy .mr.islive')].map(el => { const e = S.byId[el.dataset.ev]; return { id: el.dataset.ev, code: e.code, src: Object.keys(e.srcs || {}).join('+'), t: el.querySelector('.mrow').innerText.replace(/\\s+/g, ' ') }; })""")
    lowlive = [r for r in rows if r['code'] <= 3]
    print(f'živé řádky: {len(rows)} (Challenger/ITF/125: {len(lowlive)})')
    for r in rows[:12]: print('  ', r)
    pg.screenshot(path=f'{out}/2_zive.png', full_page=False)
    if lowlive:
        pg.select_option('#f-tour', 'ch' if any(r['code'] == 3 for r in lowlive) else ('itfm' if pg.evaluate(f"S.byId['{lowlive[0]['id']}'].g") == 'M' else 'itfw')); time.sleep(1.2)
        pg.screenshot(path=f'{out}/3_zive_challenger_itf.png')
    first = {r['id']: r['t'] for r in rows}
    marker = pg.evaluate("(() => { const v = document.querySelector('#v-zapasy'); v._mark = 1; const f = v.querySelector('.tg'); if (f) f._mark = 1; return !!f; })()")
    t0w = time.time(); t_end = t0w + (watch if rows else 25); changes = {}; polls0 = pg.evaluate('S.l365.polls')
    while time.time() < t_end:
        time.sleep(10)
        cur = pg.evaluate("""[...document.querySelectorAll('#v-zapasy .mr')].map(el => [el.dataset.ev, el.querySelector('.mrow').innerText.replace(/\\s+/g, ' ')])""")
        for i, t in cur:
            if i in first and first[i] != t and changes.get(i, [first[i]])[-1] != t: changes.setdefault(i, [first[i]]).append(t)
        if len(changes) >= 3 and time.time() > t_end - watch + 60: break
    polls = pg.evaluate('S.l365.polls') - polls0
    kept = pg.evaluate("(() => { const f = document.querySelector('#v-zapasy .tg'); return !!(f && f._mark); })()")
    print(f'365scores dotazů během sledování: {polls}, stav:', pg.evaluate('JSON.stringify(S.l365)'))
    print('změny skóre v řádcích:')
    for i, ts in changes.items(): print('  ', i, pg.evaluate(f"S.byId['{i}'].code"), pg.evaluate(f"Object.keys(S.byId['{i}'].srcs||{{}}).join('+')"), ' -> '.join(ts))
    el = time.time() - t0w
    check('průběžné dotazy na 365scores (~20 s)', polls >= max(1, int(el / 20) - 1), f'{polls} dotazů za {el:.0f} s')
    if lowlive: check('živé Challenger/ITF skóre se změnilo v řádku', any(pg.evaluate(f"S.byId['{i}'].code") <= 3 for i in changes), f'{len(changes)} změn')
    if marker: print('řádky záplatovány na místě (bez překreslení seznamu):', kept)
    pg.screenshot(path=f'{out}/4_zive_po.png')
    # detail živého (nebo dokončeného) Challenger/ITF zápasu
    tgt = lowlive[0]['id'] if lowlive else pg.evaluate("(S.all.find(e => e.code <= 3 && e.st === 3 && dayOff(e.ts) === 0 && (e.srcs || {})['365scores']) || S.all.find(e => e.code <= 3 && e.st === 3 && (e.srcs || {})['365scores']) || {}).id || null")
    if tgt:
        pg.evaluate(f"openEvent('{tgt}')"); pg.wait_for_selector('#detail:not([hidden]) .dpl', timeout=30000); time.sleep(1.5)
        print('detail:', pg.inner_text('#detail .dhead').replace('\n', ' ')[:220])
        pg.screenshot(path=f'{out}/5_detail.png')
        if lowlive:
            s0 = pg.inner_text('#d-score'); time.sleep(45); s1 = pg.inner_text('#d-score')
            print('detail skóre po 45 s:', s0.replace('\n', ' '), '->', s1.replace('\n', ' ')); pg.screenshot(path=f'{out}/6_detail_po.png')
    print('konzole chyby:', errs[:8])
    check('bez JS chyb', not [e for e in errs if 'pageerror' in e])
    b.close()
print('VÝSLEDEK:', 'OK' if not fails else 'SELHALO: ' + ', '.join(fails))
