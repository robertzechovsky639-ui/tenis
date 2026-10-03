/* Tenis Predikce – klientská aplikace ve stylu TNNS (bez API klíčů). */
'use strict';
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const FEED = d => `https://global.flashscore.ninja/2/x/feed/f_2_${d}_2_en_1`;
const FSIGN = 'SW9D1eZo';
const SURF_CS = { Hard: 'Tvrdý', Clay: 'Antuka', Grass: 'Tráva', Carpet: 'Koberec' };
const SURF_IDX = ['Hard', 'Clay', 'Grass', 'Carpet'];
const LVL_CS = { 6: 'Grand Slam', 5: 'Masters / WTA 1000', 4: 'ATP/WTA 250–500', 3: 'Challenger / WTA 125', 2: 'ITF W50–W100', 1: 'ITF M25 / W25–W35', 0: 'ITF M15 / W15' };
const GRP_CS = { tour: 'Hlavní okruh (ATP/WTA)', chall: 'Challenger / WTA 125', itf: 'ITF / Futures' };
const FEAT_CS = { d_elo: 'Celkové Elo', d_selo: 'Elo na povrchu', d_lrank: 'Pozice v žebříčku', d_lpts: 'Body do žebříčku', d_rmiss: 'Chybějící ranking',
  d_form10: 'Forma (posl. 10 zápasů)', d_form25: 'Forma (posl. 25 zápasů)', d_fexp10: 'Výsledky nad očekávání (posl. 10)', d_lexp: 'Zkušenosti (počet zápasů)',
  d_lsexp: 'Zkušenosti na povrchu', d_h2h: 'Vzájemné zápasy (H2H)', d_age: 'Věk', d_ht: 'Výška', d_htmiss: 'Chybějící výška', d_lefty: 'Levák',
  d_m7: 'Zápasy za 7 dní (únava)', d_m14: 'Zápasy za 14 dní (únava)', d_min14: 'Minuty na kurtu za 14 dní', d_rest: 'Dny od posl. zápasu',
  d_surfwr: 'Úspěšnost na povrchu', d_spw: 'Body vyhrané na podání', d_rpw: 'Body vyhrané na příjmu', d_ace: 'Esa', d_df: 'Dvojchyby',
  d_bps: 'Odvrácené brejkboly', d_lstat: 'Zápasy se statistikami', d_avglvl: 'Úroveň posledních turnajů',
  d_gelo: 'Elo z gemů (přesvědčivost výher)', d_gselo: 'Elo z gemů na povrchu', d_fexpt: 'Aktuální forma nad očekávání (časově vážená)', d_form60: 'Forma za 60 dní',
  d_inact: 'Neaktivita (dny bez zápasu)', d_rd: 'Nejistota ratingu', d_dom: 'Podání + příjem (dominance)' };
const MODEL_CS = { rank_baseline: 'Jen žebříček (baseline)', elo_only: 'Jen Elo', gelo_only: 'Jen Elo z gemů', logreg: 'Logistická regrese', lightgbm: 'LightGBM (v2)', ensemble: 'Nový model v2 (nasazený)', old_model: 'Původní model v1', v1_newdata: 'v1 + novější data' };

const S = { idx: null, N: 0, meta: null, model: null, shards: {}, shardP: {}, states: {}, E: [], SE: [], K: [], SK: [], L: [], extra: [],
  l365: { ok: false, last: 0, fulls: 0, polls: 0, upd: 0, fin: 0, unmatched: 0, err: null },
  liveRing: {}, liveSurf: {}, liveH2H: {}, events: {}, live: { ok: false, days: {}, applied: 0, finished: 0, dup: 0, unknown: 0, err: null, snapshot: false },
  filt: { day: 0, tour: 'all', st: 'all', favOnly: false }, pred: { a: null, b: null }, all: null, byId: {}, pair: {}, odds: {}, eid: {}, finSeen: new Set(), predGen: 0, detail: null, fav: new Map(), visible: new Set(), profI: null, pc: {} };
const todayDay = () => { const d = new Date(); return Math.floor((d.getTime() / 1000 - d.getTimezoneOffset() * 60) / 86400); };
const dayToDate = d => new Date(d * 86400000);
const fmtDate = d => dayToDate(d).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric', timeZone: 'UTC' });
const isoDay = off => { const d = new Date(); d.setDate(d.getDate() + off); return d.toLocaleDateString('sv-SE'); };
const pct = p => Math.round(p * 100) + ' %';

/* ---------- párování jmen (stejné jako scripts/fs.py Matcher) ---------- */
const toks = s => String(s || '').normalize('NFKD').replace(/[^\x00-\x7f]/g, '').toLowerCase().split(/[^a-z]+/).filter(Boolean);
const fold = t => t.replace(/oe/g, 'o').replace(/ue/g, 'u').replace(/ae/g, 'a');
class Matcher {
  constructor() { this.k1 = new Map(); this.k2 = new Map(); }
  put(m, k, id, rec) { const c = m.get(k); if (!c || rec > c[1]) m.set(k, [id, rec]); }
  add(id, g, name, rec) {
    const t = toks(name); if (!t.length) return;
    for (const key of new Set([t.slice().sort().join(' '), t.map(fold).sort().join(' ')])) this.put(this.k1, g + '|' + key, id, rec);
    for (let k = 1; k < t.length; k++) { const sur = t.slice(k).join(''); for (const s2 of new Set([sur, fold(sur)])) this.put(this.k2, `${g}|${s2}|${t[0][0]}`, id, rec); }
    if (t.length >= 2) this.put(this.k2, `${g}|${t.slice(0, -1).join('')}|${t[t.length - 1][0]}`, id, rec - 0.5);
  }
  match(g, slug, disp) {
    const t = toks(slug);
    if (t.length) for (const key of [t.slice().sort().join(' '), t.map(fold).sort().join(' ')]) { const r = this.k1.get(g + '|' + key); if (r) return r[0]; }
    const m = /^(.*?)\s+([A-Za-z])[\w\-]*\./.exec(disp || '');
    if (m) { const sur = toks(m[1]).join(''), ini = m[2].toLowerCase(); for (const s2 of [sur, fold(sur)]) { const r = this.k2.get(`${g}|${s2}|${ini}`); if (r) return r[0]; } }
    return null;
  }
}

/* ---------- Flashscore feed (stejně jako scripts/fs.py) ---------- */
const SLAMS = ['australian open', 'french open', 'roland garros', 'wimbledon', 'us open'];
const M1000 = ['indian wells', 'miami', 'monte carlo', 'madrid', 'rome', 'montreal', 'toronto', 'cincinnati', 'shanghai', 'paris', 'doha', 'dubai', 'beijing', 'wuhan'];
function classify(h) {
  const m = /^(.*?) - (SINGLES|DOUBLES|MIXED DOUBLES|TEAMS.*?): (.*)$/.exec(h); if (!m || m[2] !== 'SINGLES') return null;
  const cat = m[1].trim(), rest = m[3];
  const sm = /,\s*([a-z]+)(?:\s*\(indoor\))?\s*$/.exec(rest);
  const surface = ({ hard: 'Hard', clay: 'Clay', grass: 'Grass', carpet: 'Carpet' })[sm ? sm[1] : 'hard'] || 'Hard';
  let tname = rest.replace(/,\s*[a-z]+(\s*\(indoor\))?\s*$/, ''); const q = tname.includes(' - Qualification') ? 1 : 0; tname = tname.replace(' - Qualification', '');
  const tl = tname.toLowerCase(); let g, lvl, code;
  if (cat === 'ATP' || cat === 'WTA') {
    g = cat === 'ATP' ? 'M' : 'W';
    if (SLAMS.some(s => tl.includes(s))) [lvl, code] = ['G', 6];
    else if (tl.includes('finals')) [lvl, code] = ['F', 5];
    else if (M1000.some(s => tl.includes(s)) && !(g === 'M' && ['doha', 'dubai', 'beijing', 'wuhan'].some(s => tl.includes(s))) && !(g === 'W' && ['monte carlo', 'shanghai', 'paris'].some(s => tl.includes(s)))) [lvl, code] = ['M', 5];
    else [lvl, code] = ['A', 4];
  } else if (cat === 'CHALLENGER MEN' || cat === 'CHALLENGER WOMEN') { g = cat === 'CHALLENGER MEN' ? 'M' : 'W'; [lvl, code] = ['CH', 3]; }
  else if (cat === 'ITF MEN' || cat === 'ITF WOMEN') { g = cat === 'ITF WOMEN' ? 'W' : 'M'; const pm = /^[MW](\d+)/.exec(tname); const p = pm ? +pm[1] : 25; [lvl, code] = ['ITF', p <= 20 ? 0 : p <= 40 ? 1 : 2]; }
  else if (cat === 'DAVIS CUP' || cat === 'BILLIE JEAN KING CUP') { g = cat === 'DAVIS CUP' ? 'M' : 'W'; [lvl, code] = ['D', 4]; }
  else return null;
  return { g, lvl, code, q, surface, tname, cat };
}
function parseFeed(text) {
  const out = []; let hdr = null;
  for (const rec of text.split('~')) {
    const f = {};
    for (const kv of rec.split('¬')) { const i = kv.indexOf('÷'); if (i > 0) f[kv.slice(0, i)] = kv.slice(i + 1); }
    if ('ZA' in f) { hdr = classify(f.ZA); continue; }
    if (!('AA' in f) || !hdr) continue;
    const sets = [];
    for (const [a, b] of [['BA', 'BB'], ['BC', 'BD'], ['BE', 'BF'], ['BG', 'BH'], ['BI', 'BJ']]) if (f[a] !== undefined && f[b] !== undefined && f[a] !== '' && f[b] !== '') sets.push([+f[a], +f[b]]);
    out.push({ id: f.AA, ts: +(f.AD || 0), st: +(f.AB || 0), det: +(f.AC || 0), win: /^\d+$/.test(f.AS || '') ? +f.AS : 0,
      h: { slug: f.WU || '', name: f.AE || '', c: f.FU || '' }, a: { slug: f.WV || '', name: f.AF || '', c: f.FV || '' }, sets, ...hdr });
  }
  return out;
}
async function getJSON(url, ms = 15000) {
  const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), ms);
  try { const r = await fetch(url, { signal: ctl.signal, cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status); return await r.json(); }
  finally { clearTimeout(tm); }
}
const cacheGet = k => { try { const c = localStorage.getItem(k); return c ? JSON.parse(c) : null; } catch (e) { return null; } };
const cacheSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } };
const ymd = off => isoDay(off).replace(/-/g, '');
function cleanCache() {
  const keep = new Set(); for (let d = -8; d <= 0; d++) { keep.add(ymd(d)); }
  for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k && /^(espn|sofa):/.test(k) && !keep.has(k.split(':').pop())) localStorage.removeItem(k); }
}
function tourInfo(g, name, city) {
  for (const n of [city, name]) { const k = toks(String(n || '').replace(/\(.*?\)/g, '')).join(' '); if (k && S.tours[g + '|' + k]) return S.tours[g + '|' + k]; }
  return null;
}
/* ---------- vlajky (obrázky flagcdn.com – emoji vlajky Windows nezobrazí) ---------- */
const IOC2 = Object.fromEntries(('ARG AR AUS AU AUT AT BEL BE BIH BA BLR BY BOL BO BRA BR BUL BG CAN CA CHI CL CHN CN COL CO CRO HR CYP CY CZE CZ DEN DK DOM DO ECU EC EGY EG ESP ES EST EE FIN FI FRA FR GBR GB GEO GE GER DE GRE GR HKG HK HUN HU INA ID IND IN IRL IE ISR IL ITA IT JPN JP KAZ KZ KOR KR LAT LV LTU LT LUX LU MAR MA MDA MD MEX MX MKD MK MNE ME NED NL NOR NO NZL NZ PAR PY PER PE PHI PH POL PL POR PT PUR PR ROU RO RSA ZA RUS RU SRB RS SLO SI SUI CH SVK SK SWE SE THA TH TPE TW TUN TN TUR TR UKR UA URU UY USA US UZB UZ VEN VE VIE VN ZIM ZW ARM AM AZE AZ BAR BB BRN BH CRC CR CUB CU ESA SV GUA GT HON HN IRI IR JAM JM JOR JO KSA SA KUW KW LBN LB MAS MY MLT MT MON MC NGR NG PAK PK QAT QA SGP SG SRI LK SYR SY TOG TG UAE AE UGA UG KEN KE RWA RW ALG DZ CIV CI SEN SN GHA GH BEN BJ CMR CM ZAM ZM NAM NA BOT BW MAD MG LIE LI AND AD SMR SM ISL IS ALB AL KGZ KG TJK TJ TKM TM MGL MN NEP NP BAN BD CAM KH FIJ FJ PNG PG ARU AW BER BM BAH BS TTO TT HAI HT PAN PA NCA NI BDI BI MRI MU LBA LY IRQ IQ OMA OM MAC MO KOS XK').match(/[A-Z]{3} [A-Z]{2}/g).map(x => x.split(' ')));
const CN2 = { 'usa': 'US', 'united states': 'US', 'united kingdom': 'GB', 'great britain': 'GB', 'england': 'GB', 'czech republic': 'CZ', 'russia': 'RU', 'south korea': 'KR', 'korea': 'KR',
  'korea, republic of': 'KR', 'taiwan': 'TW', 'chinese taipei': 'TW', 'turkey': 'TR', 'ivory coast': 'CI', "cote d'ivoire": 'CI', 'macedonia': 'MK', 'north macedonia': 'MK', 'hong kong': 'HK', 'kosovo': 'XK', 'bosnia': 'BA', 'bosnia and herzegovina': 'BA', 'moldova': 'MD', 'iran': 'IR', 'vietnam': 'VN' };
(() => { try { const dn = new Intl.DisplayNames(['en'], { type: 'region' }); const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (const x of A) for (const y of A) { const n = dn.of(x + y); if (n && n !== x + y && !CN2[n.toLowerCase()]) CN2[n.toLowerCase()] = x + y; } } catch (e) { } })();
function iso2(c) { c = String(c || '').trim(); if (!c) return null; if (/^[A-Z]{3}$/.test(c)) return IOC2[c] || null; return CN2[c.toLowerCase()] || null; }
function flagImg(c) { const i = iso2(c); return i ? `<img class="fl" src="https://flagcdn.com/w40/${i.toLowerCase()}.png" alt="${esc(i)}" loading="lazy" onerror="this.style.visibility='hidden'">` : '<span class="fl"></span>'; }

/* ---------- ESPN (CORS *, bez klíče): ATP/WTA okruh + část WTA 125 – rozpis, živé skóre, výsledky ---------- */
const ESPN = t => `https://site.web.api.espn.com/apis/site/v2/sports/tennis/${t}/scoreboard`;
function espnEvents(j, tour) {
  const out = [];
  for (const ev of (j.events || [])) {
    const city = String(ev.venue?.displayName || '').split(',')[0];
    for (const gr of (ev.groupings || [])) {
      const gs = gr.grouping?.slug || '';
      if (!/singles/.test(gs)) continue;
      const g = /^womens/.test(gs) ? 'W' : /^mens/.test(gs) ? 'M' : (tour === 'atp' ? 'M' : 'W');
      const ti = tourInfo(g, ev.name, city);
      for (const c of (gr.competitions || [])) {
        const cs = (c.competitors || []).slice().sort((a, b) => a.order - b.order); if (cs.length !== 2 || !cs[0].athlete || !cs[1].athlete || cs.some(x => /^(TBD|TBA|Qualifier|Bye)?$/i.test((x.athlete.displayName || '').trim()))) continue;
        const stt = c.status?.type || {}; const nm = String(stt.name || '');
        if (/WALKOVER|CANCEL|POSTPON|FORFEIT/i.test(nm)) continue;
        const st = stt.state === 'pre' ? 1 : stt.state === 'in' ? 2 : stt.state === 'post' ? 3 : 0; if (!st) continue;
        const q = /qualif/i.test(c.round?.displayName || '') ? 1 : 0;
        const code = ev.major ? 6 : (ti ? ti[1] : 4);
        const win = cs[0].winner ? 1 : cs[1].winner ? 2 : 0;
        const la = cs[0].linescores || [], lb = cs[1].linescores || []; const sets = [];
        for (let k = 0; k < Math.max(la.length, lb.length); k++) { const x = la[k] || {}, y = lb[k] || {}; if (x.value == null && y.value == null) continue;
          const s = [+(x.value ?? 0), +(y.value ?? 0)]; if (x.tiebreak != null || y.tiebreak != null) s.push(+(x.tiebreak ?? 0), +(y.tiebreak ?? 0)); sets.push(s); }
        const P = x => ({ slug: (x.athlete.fullName || x.athlete.displayName || '').replace(/\s+/g, ' '), name: x.athlete.displayName || '', c: x.athlete.flag?.alt || '', eid: x.athlete.id || x.id });
        const sd = String(stt.shortDetail || stt.detail || ''); const m = /(\d)(st|nd|rd|th) Set/i.exec(sd);
        out.push({ id: 'e' + c.id, ts: Math.floor(Date.parse(c.date || c.startDate) / 1000), st, det: /RETIR/i.test(nm) ? 8 : 3, win, sets, h: P(cs[0]), a: P(cs[1]), g,
          lvl: code === 6 ? 'G' : code >= 4 ? 'A' : 'CH', code, q, surface: ti ? ti[0] : 'Hard', tname: city || ev.name, round: c.round?.displayName || '',
          live: st === 2 ? (m ? m[1] + '. set' : sets.length ? sets.length + '. set' : 'Živě') : '', src: 'ESPN' });
      }
    }
  }
  return out;
}
async function loadESPN() {
  const jobs = [];
  for (const t of ['atp', 'wta']) {
    jobs.push(getJSON(ESPN(t)).then(j => espnEvents(j, t)));
    for (const d of [-7, -4, -2, -1, 1]) {
      const key = `espn:${t}:${ymd(d)}`; const c = d < -1 ? cacheGet(key) : null;
      jobs.push(c ? Promise.resolve(c) : getJSON(ESPN(t) + '?dates=' + ymd(d)).then(j => { const ev = espnEvents(j, t); if (d < -1) cacheSet(key, ev.filter(e => e.st === 3)); return ev; }));
    }
  }
  const res = await Promise.allSettled(jobs);
  const ok = res[0].status === 'fulfilled' || res[6].status === 'fulfilled';
  return { ok, ev: res.filter(r => r.status === 'fulfilled').flatMap(r => r.value) };
}
/* Sofascore (bez klíče, CORS *): všechny úrovně. Z některých sítí blokuje (403) – pak se tiše přeskočí. */
function sofaEvents(j) {
  const out = [];
  for (const e of (j.events || [])) {
    try {
      const cat = String(e.tournament?.category?.name || '').toLowerCase(); const un = e.tournament?.uniqueTournament || {};
      if ((e.homeTeam?.subTeams || []).length || /\//.test(e.homeTeam?.name || '') || /double|mixed/i.test(e.tournament?.name || '')) continue;
      let g, code; const tn = String(e.tournament?.name || ''); const tl = tn.toLowerCase();
      if (/^itf/.test(cat)) { g = /women/.test(cat) ? 'W' : 'M'; const pm = /\b[MW](\d+)/.exec(tn); const p = pm ? +pm[1] : 25; code = p <= 20 ? 0 : p <= 40 ? 1 : 2; }
      else if (/challenger/.test(cat)) { g = /women/.test(cat) ? 'W' : 'M'; code = 3; }
      else if (/125/.test(cat) || /wta 125/.test(tl)) { g = 'W'; code = 3; }
      else if (cat === 'atp' || cat === 'wta') { g = cat === 'atp' ? 'M' : 'W';
        const ti = tourInfo(g, un.name || tn, (un.name || tn).split(',')[0]);
        code = SLAMS.some(x => tl.includes(x)) ? 6 : ti ? ti[1] : 4; }
      else continue;
      const gt = String(e.groundType || un.groundType || '').toLowerCase();
      const surface = /clay/.test(gt) ? 'Clay' : /grass/.test(gt) ? 'Grass' : /carpet/.test(gt) ? 'Carpet' : 'Hard';
      const ty = e.status?.type; const desc = String(e.status?.description || '');
      if (/walkover|cancel|postpon|abandon/i.test(desc) || ty === 'canceled' || ty === 'postponed') continue;
      const st = ty === 'notstarted' ? 1 : ty === 'inprogress' ? 2 : ty === 'finished' ? 3 : 0; if (!st) continue;
      const q = /qualif/i.test(tn + ' ' + (e.roundInfo?.name || '')) ? 1 : 0;
      const P = x => ({ slug: x.slug || '', name: x.name || '', c: x.country?.name || '' });
      out.push({ id: 's' + e.id, ts: e.startTimestamp, st, det: /retir/i.test(desc) ? 8 : 3, win: e.winnerCode === 1 || e.winnerCode === 2 ? e.winnerCode : 0,
        sets: [1, 2, 3, 4, 5].map(k => { const x = [e.homeScore?.['period' + k], e.awayScore?.['period' + k]], ta = e.homeScore?.['period' + k + 'TieBreak'], tb = e.awayScore?.['period' + k + 'TieBreak'];
          return x[0] != null && x[1] != null && (ta != null || tb != null) ? [x[0], x[1], +(ta ?? 0), +(tb ?? 0)] : x; }).filter(x => x[0] != null && x[1] != null),
        pts: ty === 'inprogress' && e.homeScore?.point != null && e.awayScore?.point != null ? [String(e.homeScore.point), String(e.awayScore.point)] : null,
        live: ty === 'inprogress' ? ([1, 2, 3, 4, 5].filter(k => e.homeScore?.['period' + k] != null).length || '') + (e.homeScore?.period1 != null ? '. set' : 'Živě') : '', h: P(e.homeTeam), a: P(e.awayTeam), g, lvl: code >= 4 ? 'A' : code === 3 ? 'CH' : 'ITF', code, q, surface, tname: (un.name || tn).replace(/, Qualifying.*$/i, ''), src: 'Sofascore' });
    } catch (err) { }
  }
  return out;
}
async function loadSofa() {
  const url = d => `https://api.sofascore.com/api/v1/sport/tennis/scheduled-events/${isoDay(d)}`;
  let first;
  try { first = sofaEvents(await getJSON(url(0), 10000)); } catch (e) { return { ok: false, ev: [], err: String(e) }; }
  const jobs = [Promise.resolve(first), getJSON(url(1)).then(sofaEvents)];
  for (let d = -7; d <= -1; d++) { const key = `sofa:${ymd(d)}`; const c = cacheGet(key);
    jobs.push(c ? Promise.resolve(c) : getJSON(url(d)).then(j => { const ev = sofaEvents(j).filter(e => e.st === 3); if (d < -1) cacheSet(key, ev); return ev; })); }
  const res = await Promise.allSettled(jobs);
  return { ok: true, ev: res.filter(r => r.status === 'fulfilled').flatMap(r => r.value) };
}
async function loadSnapshot() {
  try { const up = await getJSON('data/upcoming.json'); S.live.snapshot = up.built;
    return up.matches.map(m => ({ id: 'f' + m.id, fsid: m.id, ts: m.ts, st: m.st, det: m.det, win: m.win || 0, sets: m.sets || [],
      h: { name: m.h, slug: m.hs || '', c: m.hc || '', pid: m.hp }, a: { name: m.a, slug: m.as || '', c: m.ac || '', pid: m.ap },
      g: m.g, lvl: m.lvl, code: m.code, q: m.q, surface: m.s, tname: m.t.replace(/\s*\(.*?\)\s*$/, ''), country: (/\((.*?)\)/.exec(m.t) || [])[1] || '',
      hi: m.hi ?? null, ai: m.ai ?? null, oddsV: m.odds ? { avg: [m.odds[0], m.odds[1]], max: [m.odds[2], m.odds[3]], n: m.odds[4], snap: true } : null,
      oddsPrem: m.odds ? { avg: [m.odds[0], m.odds[1]], max: [m.odds[2], m.odds[3]], n: m.odds[4], snap: true } : null, src: 'snapshot', stSrc: m.st === 3 ? 'snapshot' : undefined }));
  } catch (e) { return []; }
}

/* 365scores (webws.365scores.com, CORS *, bez klíče): ATP/WTA + Challenger + WTA 125 – rozpis, živé skóre (sety, tiebreaky), výsledky. ITF nepokrývá. */
const S365 = 'https://webws.365scores.com/web/games/';
const P365 = () => { let tz = 'Europe/Prague'; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || tz; } catch (e) { } return `appTypeId=5&langId=1&timezoneName=${encodeURIComponent(tz)}&userCountryId=1&sports=3`; };
const C365 = { 301: ['M', 3], 302: ['W', 3], 88: ['M', 4], 87: ['W', 4] };   // kategorie: Challenger, WTA 125K, ATP, WTA (čtyřhry mají jiná ID)
const dmy = off => { const d = new Date(); d.setDate(d.getDate() + off); return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`; };
function ev365(j) {
  const out = []; const comps = new Map((j.competitions || []).map(c => [c.id, c]));
  for (const g of (j.games || [])) {
    try {
      const c = comps.get(g.competitionId); const cat = c && C365[c.countryId]; if (!cat) continue;
      const H = g.homeCompetitor, A = g.awayCompetitor; if (!H || !A || /\//.test(H.name + A.name) || /^(TBD|TBA|Bye)?$/i.test(H.name) || /^(TBD|TBA|Bye)?$/i.test(A.name)) continue;
      const txt = String(g.statusText || '');
      if (/cancel|postpon|walk ?over|w\.o\.|abandon|suspend|delay/i.test(txt)) continue;
      const st = g.statusGroup === 2 ? 1 : g.statusGroup === 3 ? 2 : g.statusGroup === 4 ? 3 : 0; if (!st) continue;
      const sets = [];
      for (const x of (g.stages || [])) { if (!/^S\d$/.test(x.shortName || '')) continue; const a = x.homeCompetitorScore, b = x.awayCompetitorScore; if (!(a >= 0 && b >= 0)) continue;
        const v = [a, b]; if (x.homeCompetitorExtraScore >= 0 || x.awayCompetitorExtraScore >= 0) v.push(Math.max(0, x.homeCompetitorExtraScore ?? 0), Math.max(0, x.awayCompetitorExtraScore ?? 0)); sets.push(v); }
      const ret = /retir/i.test(txt);
      let win = H.isWinner ? 1 : A.isWinner ? 2 : g.winner === 1 || g.winner === 2 ? g.winner : 0;
      if (st === 3 && !win) { const m = /player (\d) retired/i.exec(txt); if (m) win = 3 - +m[1];
        else { const tot = (g.stages || []).find(x => x.shortName === 'Sets'); if (tot && tot.homeCompetitorScore !== tot.awayCompetitorScore) win = tot.homeCompetitorScore > tot.awayCompetitorScore ? 1 : 2; } }
      if (st === 3 && !win) continue;
      // body v aktuálním gemu (stage „Game“) a podání (inPossession u soutěžícího)
      let pts = null, srv = 0;
      if (st === 2) { const gp = (g.stages || []).find(x => /^(G|Game|Pts|Points)$/i.test(x.shortName || '') || /game|point/i.test(x.name || ''));
        if (gp && gp.homeCompetitorScore >= 0 && gp.awayCompetitorScore >= 0) pts = [gp.homeCompetitorScore, gp.awayCompetitorScore].map(v => v === 50 ? 'A' : String(v));
        if (H.inPossession) srv = 1; else if (A.inPossession) srv = 2; }
      const [gg, lc] = cat; const ti = lc === 4 ? tourInfo(gg, c.name, c.name) : null;
      const P = x => { const t = String(x.name || '').trim().split(/\s+/); return { slug: x.nameForURL || x.name || '', name: t.length > 1 ? `${t[t.length - 1]} ${t[0][0]}.` : (x.name || ''), full: x.name || '', c: '' }; };
      out.push({ id: 'x' + g.id, ts: Math.floor(Date.parse(g.startTime) / 1000), st, det: ret ? 8 : 3, win, sets, pts, srv, h: P(H), a: P(A), g: gg,
        lvl: lc === 3 ? 'CH' : 'A', code: lc === 3 ? 3 : (ti ? ti[1] : 4), q: /qualif/i.test(g.stageName || '') ? 1 : 0, surface: ti ? ti[0] : 'Hard', tname: c.name || '',
        live: st === 2 ? (sets.length ? sets.length + '. set' : 'Živě') : '', src: '365scores' });
    } catch (err) { }
  }
  return out;
}
async function load365() {
  const all = (a, b) => getJSON(`${S365}allscores/?${P365()}&startDate=${dmy(a)}&endDate=${dmy(b)}&showOdds=false&onlyMajorGames=false&withTop=true`, 15000).then(ev365);
  const res = await Promise.allSettled([all(0, 0), all(-1, -1), all(1, 1)]);
  const ok = res[0].status === 'fulfilled'; S.l365.ok = ok; if (ok) { S.l365.last = Date.now(); S.l365.fulls++; } else S.l365.err = String(res[0].reason);
  return { ok, ev: res.filter(r => r.status === 'fulfilled').flatMap(r => r.value) };
}

/* ---------- slučování událostí z více zdrojů ---------- */
const RANK = { ESPN: 3, '365scores': 2.2, Sofascore: 2, snapshot: 1 };
const nowS = () => Date.now() / 1000;
const dayOff = ts => Math.floor((ts - new Date(ts * 1000).getTimezoneOffset() * 60) / 86400) - todayDay();
function flipSets(s) { return (s || []).map(x => x.length > 2 ? [x[1], x[0], x[3], x[2]] : [x[1], x[0]]); }
function mergeInto(ex, e, sw) {
  // sw = zdroj má hráče v opačném pořadí
  let changed = false;
  const sets = sw ? flipSets(e.sets) : e.sets, win = sw ? (e.win === 1 ? 2 : e.win === 2 ? 1 : 0) : e.win;
  const H = sw ? e.a : e.h, A = sw ? e.h : e.a;
  const pts = e.pts ? (sw ? [e.pts[1], e.pts[0]] : e.pts) : null, srv = e.srv ? (sw ? 3 - e.srv : e.srv) : 0;
  // vyšší zdroj má přednost; nižší zdroj smí posunout stav dopředu (např. ohlásí začátek/konec dřív než ESPN);
  // stav zpět (živě -> plán, konec -> živě) smí vrátit jen ten zdroj, který ho nastavil (jiný zdroj se jen zpožďuje)
  const fwd = e.st > ex.st, back = e.st < ex.st && ex.stSrc && ex.stSrc !== e.src;
  if (!back && (RANK[e.src] >= RANK[ex.src] || fwd)) {
    if (e.st === 2 && ex.st === 2 && (!e.live || e.live === 'Živě') && /set/.test(ex.live || '')) e = { ...e, live: ex.live };   // obecné „Živě“ nepřepíše „2. set“
    if (ex.st !== e.st || JSON.stringify(ex.sets) !== JSON.stringify(sets) || ex.win !== win || JSON.stringify(ex.pts || null) !== JSON.stringify(pts) || (ex.srv || 0) !== srv || (ex.live || '') !== (e.live || '')) changed = true;
    if (e.st !== ex.st || !ex.stSrc) ex.stSrc = e.src;
    // body v gemu/podání posílá jen 365scores (a Sofascore): zdroj bez nich je nemaže, dokud se nezmění gemy
    let p2 = pts, s2 = srv;
    if (!pts && ex.pts && e.st === 2 && ex.ptsSrc && ex.ptsSrc !== e.src && JSON.stringify(ex.sets) === JSON.stringify(sets)) { p2 = ex.pts; s2 = ex.srv; }
    else ex.ptsSrc = pts ? e.src : null;
    if (JSON.stringify(ex.pts || null) === JSON.stringify(p2) && (ex.srv || 0) === s2 && changed && ex.st === e.st && JSON.stringify(ex.sets) === JSON.stringify(sets) && ex.win === win && (ex.live || '') === (e.live || '')) changed = false;
    Object.assign(ex, { st: e.st, det: e.det, win, sets, ts: ex.src === 'snapshot' || RANK[e.src] >= RANK[ex.src] ? e.ts : ex.ts, live: e.live || '', pts: p2, srv: s2, stale: false });
    if (e.round) ex.round = e.round;
    if (RANK[e.src] > RANK[ex.src]) { ex.src2 = ex.src; ex.src = e.src; }
  } else if (!back && pts && e.st === 2 && ex.st === 2 && JSON.stringify(ex.sets) === JSON.stringify(sets)) {
    if (JSON.stringify(ex.pts || null) !== JSON.stringify(pts) || (ex.srv || 0) !== srv) { ex.pts = pts; ex.srv = srv; ex.ptsSrc = e.src; changed = true; }
  }
  ex.srcs = ex.srcs || {}; ex.srcs[e.src] = 1;
  for (const [x, y] of [[ex.h, H], [ex.a, A]]) { if (y.eid && !x.eid) x.eid = y.eid; if (y.pid && !x.pid) x.pid = y.pid; if (y.c && !x.c) x.c = y.c; }
  if (e.fsid && !ex.fsid) { ex.fsid = e.fsid; ex.country = ex.country || e.country; }
  if (e.oddsV && !ex.oddsV) { const o = e.oddsV; ex.oddsV = sw ? { ...o, avg: [o.avg[1], o.avg[0]], max: [o.max[1], o.max[0]] } : o; }
  return changed;
}
function addEvent(e) {
  const r = resolveEv(e); const pk = Math.min(r.hi, r.ai) + ':' + Math.max(r.hi, r.ai);
  const arr = S.pair[pk] || (S.pair[pk] = []);
  const ex = arr.find(x => Math.abs(x.ts - e.ts) < 30 * 3600) || S.byId[e.id];
  if (ex) { const sw = resolveEv(ex).hi !== r.hi; const changed = mergeInto(ex, e, sw); if (!S.byId[e.id]) S.byId[e.id] = ex;   // alias: ID z jiného zdroje -> stejná událost
    return { ex, changed }; }
  e.sets = e.sets || []; e.srcs = { [e.src]: 1 }; arr.push(e); S.byId[e.id] = e; S.all.push(e);
  for (const [p, i] of [[e.h, r.hi], [e.a, r.ai]]) if (p.eid) S.eid[i] = p.eid;
  return { ex: e, changed: true, isNew: true };
}
/* Připojení události z doplňkového živého zdroje (365scores, Sofascore live): nejdřív přes ID/páry hráčů, pak podle příjmení;
   neznámý zápas se přidá jen tehdy, když oba hráče známe (jinak by vznikaly duplicity s jinak zapsanými jmény). */
const surT = p => new Set(toks((p.full || '') + ' ' + (p.name || '') + ' ' + String(p.slug || '').replace(/-/g, ' ')).map(fold).filter(t => t.length >= 3));
function attachEvent(e) {
  if (S.byId[e.id]) { const ex = S.byId[e.id]; if (ex === e) return null; const sw = ex._sw365 && ex._sw365[e.id]; return { ex, changed: mergeInto(ex, e, !!sw) }; }
  const hi = S.matcher.match(e.g, e.h.slug, e.h.name), ai = S.matcher.match(e.g, e.a.slug, e.a.name);
  let ex = null, sw = false;
  if (hi !== null && ai !== null) { const pk = Math.min(hi, ai) + ':' + Math.max(hi, ai); ex = (S.pair[pk] || []).find(x => Math.abs(x.ts - e.ts) < 30 * 3600) || null; if (ex) sw = resolveEv(ex).hi !== hi; }
  if (!ex) {
    const eh = surT(e.h), ea = surT(e.a), ov = (A, B) => [...A].some(t => B.has(t));
    const c = (S.all || []).filter(x => x.g === e.g && Math.abs(x.ts - e.ts) < 30 * 3600 && (x.code >= 4) === (e.code >= 4) && !(x.srcs && x.srcs[e.src] && x._id365 && x._id365 !== e.id)).map(x => {
      const xh = surT(x.h), xa = surT(x.a); return ov(eh, xh) && ov(ea, xa) ? [x, false] : ov(eh, xa) && ov(ea, xh) ? [x, true] : null; }).filter(Boolean);
    if (c.length === 1) [ex, sw] = c[0];
  }
  if (ex) { S.byId[e.id] = ex; ex._id365 = e.id; (ex._sw365 = ex._sw365 || {})[e.id] = sw; return { ex, changed: mergeInto(ex, e, sw) }; }
  if (hi !== null && ai !== null) return addEvent(e);
  return null;
}
function markStale() {
  const t = nowS();
  for (const e of S.all) if (e.src === 'snapshot' && ((e.st === 1 && e.ts < t - 1200) || e.st === 2)) e.stale = true;
}
function recountSrc() {
  S.live.srcCount = {}; for (const e of S.all || []) S.live.srcCount[e.src] = (S.live.srcCount[e.src] || 0) + 1;
}
function sealList() {
  markStale();
  for (const e of S.all || []) if (e.st === 3) S.finSeen.add(e.id);
  recountSrc();
}
/* snímek z buildu hned, ať první obrazovka nečeká na ESPN/365/Sofascore */
async function showSnapshotFirst() {
  const sn = await loadSnapshot();
  S.all = []; S.byId = {}; S.pair = {};
  for (const e of sn) { const d = dayOff(e.ts); if (d < -2 || d > 2) continue; addEvent(e); }
  sealList();
}
/* živé feedy doplní skóre, jak který dorazí (bez smazání seznamu) */
async function fillLive() {
  S.refreshing = true; S.lowBusy = true;
  const take = async (label, loader, attach) => {
    let res;
    try { res = await loader; }
    catch (e) { if (label === 'espn') S.live.err = String(e && e.message || e); S.liveReady = true; updateStatus(); return; }
    if (label === 'espn') { S.live.espn = !!res.ok; S.live.last = Date.now(); if (res.ok) S.live.err = null; }
    if (label === 'sofa') S.live.sofa = !!res.ok;
    S.live.ok = !!(S.live.espn || S.live.sofa || S.l365.ok);
    const evs = res.ev || [];
    const before = S.live.applied;
    let nFin = 0;
    if (!attach) {
      const fin = evs.filter(e => e.st === 3);
      if (fin.length) applyLive(fin);
      for (const e of evs) { const d = dayOff(e.ts); if (d < -2 || d > 2) continue; addEvent(e); }
      nFin = fin.length;
    } else {
      const finEx = [];
      for (const e of evs) { const d = dayOff(e.ts); if (d < -2 || d > 2) continue; const r = attachEvent(e); if (!r) { S.l365.unmatched++; continue; } if (r.ex.st === 3) finEx.push(r.ex); }
      if (finEx.length) applyLive(finEx);
      nFin = finEx.length;
    }
    sealList();
    if (label !== 'sofa') S.liveReady = true;   // samotné Sofascore (často ticho) ještě není „offline“
    updateStatus();
    onLiveChange(nFin);
    if (S.live.applied !== before) {
      const v = (location.hash || '#zapasy').slice(1);
      if (v === 'zapasy') renderMatches(true); else if (v === 'oblibene') renderFav();
    }
  };
  try {
    await Promise.allSettled([
      take('espn', loadESPN().catch(e => ({ ok: false, ev: [] })), false),
      take('sofa', loadSofa().catch(e => ({ ok: false, ev: [] })), false),
      take('365', load365().catch(e => ({ ok: false, ev: [] })), true),
    ]);
  } finally { S.refreshing = false; S.lowBusy = false; S.liveReady = true; updateStatus(); }
}
/* seznam zápasů nebo otevřený detail, a stránka je vidět */
function scoreVisible(force) {
  if (document.hidden && !force) return false;
  if (force) return true;
  if (S.detail) return true;
  const v = (location.hash || '#zapasy').slice(1);
  return v === 'zapasy' || v === 'oblibene';
}
/* živé obnovování skóre (ESPN) asi každých 15 s, jen když je seznam nebo detail vidět */
const REFRESH_MS = 15000;
async function refreshLive(force) {
  if (!S.all || S.refreshing || !scoreVisible(force)) return;
  S.refreshing = true;
  try {
    const res = await Promise.allSettled(['atp', 'wta'].map(t => getJSON(ESPN(t), 12000).then(j => espnEvents(j, t))));
    const evs = res.filter(r => r.status === 'fulfilled').flatMap(r => r.value);
    if (!res.some(r => r.status === 'fulfilled')) { S.live.err = 'ESPN nedostupné'; updateStatus(); return; }
    S.live.err = null; S.live.espn = true;
    ingest(evs, false);
    S.live.last = Date.now(); S.live.polls = (S.live.polls || 0) + 1; updateStatus();
  } finally { S.refreshing = false; }
}
/* nové/změněné události -> sloučit, dokončené hned do Elo, záplata UI na místě */
function ingest(evs, attach) {
  let changed = false, n = 0; const newFin = [];
  for (const e of evs) { const d = dayOff(e.ts); if (d < -2 || d > 2) continue;
    const r = attach ? attachEvent(e) : addEvent(e); if (!r) continue; if (r.changed) { changed = true; n++; }
    if (r.ex.st === 3 && !S.finSeen.has(r.ex.id)) { S.finSeen.add(r.ex.id); newFin.push(attach ? r.ex : e); }
    try { learnLive(r.ex); } catch (err) { /* živé doladění nesmí shodit skóre */ } }
  if (newFin.length) applyLive(newFin).then(() => { S.predCache = {}; onLiveChange(newFin.length); });
  else if (changed) onLiveChange(0);
  return { changed, n, fin: newFin.length };
}
/* 365scores (body a gemy, Challenger/WTA 125 i ATP/WTA) asi každých 8 s.
   Jen když je stránka viditelná a otevřený seznam zápasů / oblíbení / detail. Skrytá záložka se neptá. */
const LOW_MS = 8000;
async function lowTick(force) {
  if (!S.all || S.lowBusy || !scoreVisible(force)) return;
  S.lowBusy = true;
  try {
    const ev = await getJSON(`${S365}current/?${P365()}`, 8000).then(ev365);
    const r = ingest(ev, true);
    S.l365.ok = true; S.l365.err = null; S.l365.last = Date.now(); S.l365.polls++; S.l365.upd += r.n; S.l365.fin += r.fin;
    updateStatus();
  } catch (e) { S.l365.err = String(e && e.message || e); updateStatus(); }
  finally { S.lowBusy = false; }
}
/* Sofascore (ITF, jen když úvodní dotaz prošel) zůstává na 20 s — ne každý tik 365scores. */
const SOFA_MS = 20000;
async function sofaTick(force) {
  if (!S.live.sofa || !S.all || S.sofaBusy || !scoreVisible(force)) return;
  S.sofaBusy = true;
  try {
    const ev = await getJSON('https://api.sofascore.com/api/v1/sport/tennis/events/live', 10000).then(sofaEvents);
    const r = ingest(ev, true);
    S.live.sofaPolls = (S.live.sofaPolls || 0) + 1; S.live.sofaUpd = (S.live.sofaUpd || 0) + r.n; S.live.sofaAt = Date.now();
  } catch (e) { /* síť Sofascore často mlčí; necháváme poslední skóre */ }
  finally { S.sofaBusy = false; }
}

/* ---------- kurzy: Flashscore (global.ds.lsapp.eu, CORS *, bez klíče, bez hlavičky) ----------
   oce = předzápasové srovnání (/odds/pq_graphql). ole = kurzy v průběhu a je uložený na /pq_graphql
   (na /odds/pq_graphql vrací „Query not stored“ a zápas by zůstal u snímku z buildu). VALUE jen z předzápasových. */
const ODDS_URL = (id, live) => `https://global.ds.lsapp.eu/${live ? '' : 'odds/'}pq_graphql?_hash=${live ? 'ole' : 'oce'}&eventId=${encodeURIComponent(id)}&projectId=2&geoIpCode=CZ&geoIpSubdivisionCode=CZ10`;
const BOOKS = { 49: 'Tipsport.cz', 46: 'iFortuna.cz', 45: 'Chance.cz', 657: 'Betano.cz' };
const ODDS_TTL = 5 * 60 * 1000, ODDS_LIVE_TTL = 20000, VALUE_TH = 0.15, VALUE_EV = 0.05, VALUE_N = 3;
function bookName(id) { return BOOKS[id] || ('sázkovka ' + id); }
/* řádky HOME_AWAY / FULL_TIME jedné odpovědi (oce i ole mají stejný tvar položek) */
function oddsRows(list, e, names) {
  const books = [];
  for (const o of (list || [])) {
    if (o.bettingType !== 'HOME_AWAY' || o.bettingScope !== 'FULL_TIME') continue;
    const it = (o.odds || []).filter(x => x.value && x.active !== false); if (it.length < 2) continue;
    let h = it.find(x => x.eventParticipantId && x.eventParticipantId === e.h.pid), a = it.find(x => x.eventParticipantId && x.eventParticipantId === e.a.pid);
    if (!h || !a) { if (e.h.pid || e.a.pid) continue; [h, a] = it; }
    const vh = parseFloat(h.value), va = parseFloat(a.value); if (!(vh > 1 && va > 1)) continue;
    books.push({ id: o.bookmakerId, name: (names && names[o.bookmakerId]) || bookName(o.bookmakerId), h: vh, a: va, oh: parseFloat(h.opening) || null, oa: parseFloat(a.opening) || null });
  }
  return books;
}
function packOdds(books, extra) {
  if (!books.length) return { books, n: 0, t: Date.now(), ...extra };
  const avg = [0, 1].map(k => books.reduce((s, b) => s + (k ? b.a : b.h), 0) / books.length);
  const max = [Math.max(...books.map(b => b.h)), Math.max(...books.map(b => b.a))];
  const ob = books.filter(b => b.oh && b.oa);
  const openAvg = ob.length ? [ob.reduce((s, b) => s + b.oh, 0) / ob.length, ob.reduce((s, b) => s + b.oa, 0) / ob.length] : null;
  return { books, avg, max, openAvg, n: books.length, t: Date.now(), live: true, ...extra };
}
function parseOdds(j, e) {
  const f = j?.data?.findOddsByEventId; if (!f) return null;
  const names = {}; for (const b of (f.settings?.bookmakers || [])) if (b.bookmaker) names[b.bookmaker.id] = b.bookmaker.name;
  return packOdds(oddsRows(f.odds, e, names), {});
}
function parseLiveOdds(j, e) {
  const f = j?.data?.findLiveOddsById?.current; if (!f) return null;
  const books = oddsRows(f.odds, e, null);
  // nabídka bez aktivních cen = pozastaveno (kurz neschováváme za předzápasový)
  return packOdds(books, { inplay: true, suspended: !books.length });
}
/* šipka „od otevření“ u živého kurzu míří na předzápasový kurz, pokud ho máme */
function withPrem(o, e) {
  const p = e.oddsPrem; if (!o || !o.inplay || !p || !p.avg) return o;
  o.preAvg = p.avg; o.openAvg = p.avg.slice();   // šipka průměru proti předzápasovému kurzu, ne proti otevíracímu
  for (const b of o.books) { const q = (p.books || []).find(x => (x.id && x.id === b.id) || x.name === b.name); if (q) { b.oh = q.h; b.oa = q.a; } }
  return o;
}
/* předzápasový kurz jednou (oce), ať je živý kurz s čím porovnat, i když zápas už běží při otevření stránky */
function ensurePrem(e) {
  if (!e.fsid || (e.oddsPrem && e.oddsPrem.avg)) return Promise.resolve(e.oddsPrem);
  if (e._premP) return e._premP;
  e._premP = getJSON(ODDS_URL(e.fsid, false), 12000).then(j => { const o = parseOdds(j, e);
    if (o && o.n) e.oddsPrem = { avg: o.avg.slice(), max: o.max.slice(), n: o.n, books: o.books.map(b => ({ ...b })), snap: false };
    if (e.oddsV && e.oddsV.inplay) withPrem(e.oddsV, e); return e.oddsPrem; }).catch(() => null);
  return e._premP;
}
const sgn = (a, b) => (a == null || b == null || Math.abs(a - b) < 0.005) ? 0 : (a > b ? 1 : -1);
/* porovnání s naposledy viděnými kurzy: směr poslední změny se drží, dokud nepřijde další změna */
function diffOdds(o, prev) {
  o.lastDir = prev && prev.lastDir ? prev.lastDir.slice() : [0, 0]; o.chg = [0, 0];
  if (prev && prev.avg && prev.live) for (const k of [0, 1]) { const d = sgn(o.avg[k], prev.avg[k]); if (d) { o.lastDir[k] = d; o.chg[k] = d; } }
  const pb = {}; for (const b of (prev && prev.books) || []) pb[b.name] = b;
  for (const b of o.books) { const q = pb[b.name]; b.lh = q ? (sgn(b.h, q.h) || q.lh || 0) : 0; b.la = q ? (sgn(b.a, q.a) || q.la || 0) : 0; b.ch = q ? sgn(b.h, q.h) : 0; b.ca = q ? sgn(b.a, q.a) : 0; }
  return o;
}
const oddsQ = []; let oddsRun = 0;
function fetchOdds(e, prio, ttl = ODDS_TTL) {
  if (!e.fsid || e.st === 3) return Promise.resolve(e.oddsV);
  const inplay = e.st === 2; if (inplay) ttl = Math.min(ttl || ODDS_LIVE_TTL, ODDS_LIVE_TTL);
  const key = e.fsid + (inplay ? '#L' : '');
  const c = S.odds[key]; if (c && Date.now() - c.t < ttl) return c.p;
  const p = new Promise((res) => { const job = () => { oddsRun++;
      getJSON(ODDS_URL(e.fsid, inplay), 12000).then(j => { const o = inplay ? parseLiveOdds(j, e) : parseOdds(j, e);
          if (o && o.n) {
            if (!inplay) e.oddsPrem = { avg: o.avg.slice(), max: o.max.slice(), n: o.n, books: o.books.map(b => ({ ...b })), snap: false };
            else if (!e.oddsPrem && e.oddsV && e.oddsV.avg && !e.oddsV.inplay) e.oddsPrem = e.oddsV;
            e.oddsV = diffOdds(withPrem(o, e), e.oddsV); e.oddsNone = false; S.live.oddsOk = (S.live.oddsOk || 0) + 1; if (inplay) S.live.oddsLive = (S.live.oddsLive || 0) + 1;
            if (inplay && !e.oddsPrem) ensurePrem(e);
          } else if (o && inplay && o.suspended) { e.oddsV = o; if (!e.oddsPrem) ensurePrem(e); }
          else if (o && !inplay) { e.oddsNone = true; }
          res(e.oddsV); })
        .catch(err => { S.live.oddsErr = (S.live.oddsErr || 0) + 1; delete S.odds[key]; res(e.oddsV); })
        .finally(() => { oddsRun--; const n = oddsQ.shift(); if (n) n(); }); };
    if (oddsRun < (inplay ? 4 : 3)) job(); else prio ? oddsQ.unshift(job) : oddsQ.push(job); });
  S.odds[key] = { t: Date.now(), p }; return p;
}
function implied(o) { if (!o || !o.avg) return null; const ih = 1 / o.avg[0], ia = 1 / o.avg[1]; return { p: ih / (ih + ia), margin: ih + ia - 1 }; }
/* VALUE jen z předzápasového kurzu (snímek nebo oce) a jen dokud zápas nezačal – živý kurz se do ní nepočítá */
function valueOf(e) {
  const o = e.oddsPrem && e.oddsPrem.avg ? e.oddsPrem : e.oddsV;
  if (e.st !== 1 || e._p == null || !o || !o.avg || o.inplay) return null;
  const im = implied(o); const d = e._p - im.p;
  // kurz < 1.05 = zápas nejspíš už běží / kurz je zastaralý → value nehodnotíme
  if (Math.min(o.avg[0], o.avg[1]) < 1.05) return { im: im.p, margin: im.margin, edge: d, side: 0, stale: true };
  const evH = e._p * o.max[0] - 1, evA = (1 - e._p) * o.max[1] - 1;
  // jasná převaha: aspoň 15 p. b., návratnost při nejlepším kurzu ≥ 5 % a průměr aspoň ze 3 kanceláří
  const books = o.n || (o.books && o.books.length) || 0;
  const ok = books >= VALUE_N;
  return { im: im.p, margin: im.margin, edge: d, evH, evA, side: ok && d >= VALUE_TH && evH >= VALUE_EV ? 1 : ok && -d >= VALUE_TH && evA >= VALUE_EV ? 2 : 0 };
}
/* ---------- hráči a stavy ---------- */
function pName(i) { return i < S.N ? S.idx.n[i] : S.extra[i - S.N].name; }
function pG(i) { return i < S.N ? S.idx.g[i] : S.extra[i - S.N].g; }
function pC(i) { return i < S.N ? S.idx.c[i] : S.extra[i - S.N].c; }
function addExtra(g, slug, name, c) {
  const key = g + '|' + (slug || name); if (S.extraKey[key] !== undefined) return S.extraKey[key];
  const i = S.N + S.extra.length; S.extra.push({ g, name: slug ? slug.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ') : name, c: c || '', slug });
  S.E[i] = 1500; S.SE[i] = [1500, 1500, 1500, 1500]; S.GE[i] = 1500; S.GSE[i] = [1500, 1500, 1500, 1500]; S.K[i] = 0; S.SK[i] = [0, 0, 0, 0]; S.extraKey[key] = i; return i;
}
async function loadShard(k) {
  if (S.shards[k]) return S.shards[k];
  if (!S.shardP[k]) S.shardP[k] = fetch(`data/st/${k}.json`).then(r => r.json()).then(j => (S.shards[k] = j));
  return S.shardP[k];
}
async function ensure(ids) { await Promise.all([...new Set(ids.filter(i => i !== null && i < S.N).map(i => i % S.meta.nsh))].map(loadShard)); }
function state(i) {
  if (S.states[i]) return S.states[i];
  let p;
  if (i < S.N) { const sh = S.shards[i % S.meta.nsh]; if (!sh) return null; p = TM.decode(sh[i], S.idx.g[i], S.meta.day_end); }
  else p = TM.newPlayer(pG(i));
  // živé aktualizace (výsledky z posledních dní, které nejsou v datech buildu)
  p.elo = S.E[i]; p.se = S.SE[i].slice(); p.n = S.K[i]; p.sn = S.SK[i].slice(); p.gelo = S.GE[i]; p.gse = S.GSE[i].slice();
  for (const r of (S.liveRing[i] || [])) { p.ring.push(r); if (p.ring.length > TM.RING) (p.fx = p.fx || []).push(p.ring.shift()); p.last = r[0]; }
  for (const [s, w] of (S.liveSurf[i] || [])) { if (w) p.sw[s]++; else p.sl[s]++; }
  p.live = (S.liveRing[i] || []).length;
  S.states[i] = p; return p;
}
function h2h(i, j) {
  let w = 0, l = 0; const A = state(i);
  if (A && A.h2h && A.h2h[j]) [w, l] = A.h2h[j];
  const lv = S.liveH2H[i + ':' + j]; if (lv) { w += lv[0]; l += lv[1]; }
  return [w, l];
}
function predict(i, j, surface, code, q, bo) {
  const A = state(i), B = state(j); const today = todayDay();
  const s = TM.SURF[surface] ?? 0;
  if (bo == null) bo = (code === 6 && pG(i) === 'M' && !q) ? 5 : 3;
  const ctx = { day: today, dayA: TM.refDay(A, today, S.meta.gap_start), dayB: TM.refDay(B, today, S.meta.gap_start), surface: s, lvl_code: code, is_qual: q ? 1 : 0, best_of: bo };
  const hh = h2h(i, j);
  const x = TM.feats(A, B, ctx, hh);
  const r = S.model.predict(x);
  // baseline jen z žebříčku
  const bm = S.model.m.base; let z = 0; bm.cols.forEach((c, k) => { z += x[S.model.F.indexOf(c)] / bm.scale[k] * bm.coef[k]; }); r.base = 1 / (1 + Math.exp(-z));
  r.x = x; r.A = A; r.B = B; r.h2h = hh; r.ctx = ctx; r.contrib = S.model.lrContrib(x);
  return r;
}


/* Doladění modelu z dohraných zápasů. Váhy z buildu (state/online.json) plus zápasy,
   které tenhle prohlížeč viděl dřív než poslední build. Stejný krok jako scripts/online.py. */
function saveOnline() {
  try { localStorage.setItem('tp:online', JSON.stringify({ base: S.online.base, w: S.online.w, n: S.online.n, seen: S.online.seen, cols: S.online.cols, scale: S.online.scale })); } catch (e) { /* úložiště plné – doladění platí aspoň do zavření */ }
}
function attachOnline(shipped) {
  if (!shipped || !shipped.w || !S.model) return;
  let local = null;
  try { local = JSON.parse(localStorage.getItem('tp:online') || 'null'); } catch (e) { local = null; }
  const same = local && local.base === shipped.base && local.cols && local.cols.length === shipped.cols.length;
  let use = shipped;
  if (same) {
    const ss = new Set(shipped.seen || []), ls = new Set(local.seen || []);
    const localInShip = [...ls].every(id => ss.has(id));
    const shipInLocal = [...ss].every(id => ls.has(id));
    if (!localInShip && shipInLocal) use = local; // telefon je napřed
  }
  S.online = { base: use.base, cols: shipped.cols, scale: shipped.scale, w: (use.w || []).slice(), n: use.n || 0, seen: (use.seen || []).slice() };
  S.model.m.online = S.online;
}
/* Kurzy a zprávy. Zvlášť od kroku z dohraného zápasu, ať se ten krok (0,008) nespustí podruhé. */
function attachMkt() {
  const cols = (S.online && S.online.cols) || [];
  let local = null;
  try { local = JSON.parse(localStorage.getItem('tp:mkt') || 'null'); } catch (e) { local = null; }
  S.mkt = (typeof MK !== 'undefined' ? MK.fresh() : { v: 1, w: [], seen: [], ph: {}, n: 0 });
  S.newsArts = [];
  if (local && local.v === 1 && local.ph) {
    S.mkt.ph = local.ph;
    if (local.w && cols.length && local.w.length === cols.length) { S.mkt.w = local.w.slice(); S.mkt.seen = (local.seen || []).slice(); S.mkt.n = local.n || 0; }
  }
}
function saveMkt() {
  try { const m = S.mkt; if (!m) return; localStorage.setItem('tp:mkt', JSON.stringify({ v: 1, w: m.w, seen: m.seen, ph: m.ph, n: m.n })); } catch (e) {}
}
function marketOn(e) { return !!(e && e.st === 1 && e.code >= 3 && e.det !== 8 && e.det !== 5 && e._p > 0 && e._p < 1); }
function pidOf(i) { if (i == null || i < 0) return null; if (i < S.N && S.idx && S.idx.id[i]) return 'p' + S.idx.id[i]; return 'x' + i; }
function preAvg(e) {
  const o = e.oddsV && e.oddsV.avg && !e.oddsV.inplay ? e.oddsV : (e.oddsPrem && e.oddsPrem.avg && !e.oddsPrem.inplay ? e.oddsPrem : null);
  return o ? o.avg : null;
}
function newsOn(e, side) {
  if (typeof MK === 'undefined') return 0;
  const r = resolveEv(e), i = side ? r.ai : r.hi;
  const names = [side ? (e.a && e.a.name) : (e.h && e.h.name), i != null ? pName(i) : ''];
  let best = 0; const now = Date.now();
  for (const n of names) { const ph = MK.phrase(n); if (!ph) continue; const s = MK.shockFromArticles(S.newsArts || [], ph, now); if (s < best) best = s; }
  return best;
}
function syncMarket(e) {
  if (!e || e._p == null) return;
  if (!S.mkt || typeof MK === 'undefined' || !marketOn(e)) { e._d = 0; e._ps = e._p; return; }
  const r = resolveEv(e);
  const rec = { id: e.id, hi: pidOf(r.hi), ai: pidOf(r.ai), p: e._p, pMkt: MK.implied(preAvg(e)), newsH: newsOn(e, 0), newsA: newsOn(e, 1), x: e._x, cols: S.online && S.online.cols, scale: S.online && S.online.scale, F: S.model && S.model.F };
  const bucket = (rec.pMkt == null ? 'x' : Math.round(rec.pMkt * 100)) + ':' + Math.round(((rec.newsH || 0) - (rec.newsA || 0)) * 100);
  if (e._mb === bucket && e._ps != null) {
    const d = MK.displayDelta(S.mkt, rec); e._d = d.d; e._ps = MK.show(e._p, d.d); return;
  }
  const n0 = S.mkt.n || 0;
  const view = MK.sync(S.mkt, rec);
  if (!view) { e._d = 0; e._ps = e._p; return; }
  const after = MK.displayDelta(S.mkt, rec);
  e._d = after.d; e._ps = MK.show(e._p, after.d); e._mb = bucket;
  if (view.stepped || (S.mkt.n || 0) !== n0 || rec.pMkt != null) saveMkt();
}
function shownP(e) { return e && e._ps != null ? e._ps : e._p; }
const LAB_SHIFT = 'Posouvá se podle kurzu a podle odhlášky nebo zranění a ten posun jde do dalšího zápasu.';
const LAB_MODEL = 'Učí se jen z dohraných zápasů, kurz ji nehýbe.';
const TITLE_MODEL = 'Predikce modelu';
const TITLE_SHIFT = 'Šance po kurzu';
function matchLab(e) { return e && e.st === 1 && e.code >= 3 ? LAB_SHIFT : LAB_MODEL; }
function pctPair(na, nb, p, title, lab) {
  if (p == null || !(p > 0) || !(p < 1)) return '';
  return `<h3>${title}</h3><div class="big2"><div><b class="a">${pct(p)}</b><small>${esc(na)}</small></div><div><b class="b">${pct(1 - p)}</b><small>${esc(nb)}</small></div></div><div class="bar lg"><i style="width:${(p * 100).toFixed(1)}%"></i></div><p class="plab">${lab}</p>`;
}
/* Přehled: jen čistý model, bez kurzu. Záložka Predikce přidá i šanci po kurzu. */
function rawOnlyHtml(e, na, nb) {
  return pctPair(na, nb, e._p, TITLE_MODEL, LAB_MODEL) + setPredHtml(e, na, nb);
}
function bothPrematchHtml(e, na, nb) {
  return pctPair(na, nb, e._p, TITLE_MODEL, LAB_MODEL) + pctPair(na, nb, shownP(e), TITLE_SHIFT, matchLab(e)) + setPredHtml(e, na, nb);
}
/* ---------- živé výsledky -> Elo ---------- */
async function applyLive(evs) {
  const fin = evs.filter(e => e.st === 3 && (e.det === 3 || e.det === 8) && (e.win === 1 || e.win === 2)).sort((a, b) => a.ts - b.ts);
  const seen = new Set(); const ro = S.ro;
  const ids = [];
  for (const e of fin) {
    const Wp = e.win === 1 ? e.h : e.a, Lp = e.win === 1 ? e.a : e.h;
    const wi = S.matcher.match(e.g, Wp.slug, Wp.name), li = S.matcher.match(e.g, Lp.slug, Lp.name);
    if (wi !== null) ids.push(wi); if (li !== null) ids.push(li);
  }
  try { if (ids.length) await ensure(ids); } catch (e) { /* shard nejde – Elo se započte i bez doladění */ }
  for (const e of fin) {
    if (seen.has(e.id)) continue; seen.add(e.id); S.live.finished++;
    const day = Math.floor(e.ts / 86400) + ((e.ts % 86400) > 22 * 3600 ? 1 : 0);
    if (day < S.meta.day_end - 10) continue;
    const Wp = e.win === 1 ? e.h : e.a, Lp = e.win === 1 ? e.a : e.h;
    let wi = S.matcher.match(e.g, Wp.slug, Wp.name), li = S.matcher.match(e.g, Lp.slug, Lp.name);
    if (wi === null) { wi = addExtra(e.g, Wp.slug, Wp.name, Wp.c); S.live.unknown++; }
    if (li === null) { li = addExtra(e.g, Lp.slug, Lp.name, Lp.c); S.live.unknown++; }
    const dup = (ro[wi] || []).some(([o, d]) => o === li && Math.abs(d - day) <= (d > S.meta.day_end ? 2 : 10));
    if (dup) { S.live.dup++; continue; }
    const s = TM.SURF[e.surface] ?? 0, ret = e.det === 8 ? 1 : 0;
    if (!ret && wi < S.N && li < S.N && S.idx.id[wi] && S.idx.id[li] && S.online) {
      delete S.states[wi]; delete S.states[li];
      const Ws = state(wi), Ls = state(li);
      if (Ws && Ls) {
        const mk = day + '|' + S.idx.id[wi] + '|' + S.idx.id[li];
        const aIsW = TM.crc32(mk) % 2 === 0;
        const A = aIsW ? Ws : Ls, B = aIsW ? Ls : Ws, ai = aIsW ? wi : li, bi = aIsW ? li : wi;
        const bo = (e.code === 6 && e.g === 'M' && !e.q) ? 5 : 3;
        const ctx = { day, dayA: TM.refDay(A, day, S.meta.gap_start), dayB: TM.refDay(B, day, S.meta.gap_start), surface: s, lvl_code: e.code, is_qual: e.q ? 1 : 0, best_of: bo };
        const hh = h2h(ai, bi);
        try {
          const x = TM.feats(A, B, ctx, hh);
          const p0 = S.model.base(x);
          if (TM.onlineStep(S.online, x, aIsW ? 1 : 0, p0, S.model.F, mk)) { S.onlineN = (S.onlineN || 0) + 1; saveOnline(); S.predGen++; }
        } catch (err) { /* příznaky nejdou spočítat – Elo se stejně posune */ }
      }
    }
    const W = { elo: S.E[wi], se: S.SE[wi], n: S.K[wi], sn: S.SK[wi], gelo: S.GE[wi], gse: S.GSE[wi] }, L = { elo: S.E[li], se: S.SE[li], n: S.K[li], sn: S.SK[li], gelo: S.GE[li], gse: S.GSE[li] };
    // gemy vítěze/poraženého ze setů (pro Elo z gemů); bez setů -> null
    const ws = e.win === 1 ? 0 : 1; const games = (e.sets || []).length ? e.sets.reduce((a, x) => [a[0] + (+x[ws] || 0), a[1] + (+x[1 - ws] || 0)], [0, 0]) : null;
    const st = TM.eloStep(W, L, s, e.code, e.q, ret, games);
    S.GE[wi] = st.W.gelo; S.GE[li] = st.L.gelo; S.GSE[wi] = S.GSE[wi].slice(); S.GSE[li] = S.GSE[li].slice(); S.GSE[wi][s] = st.W.gse; S.GSE[li][s] = st.L.gse;
    S.E[wi] = st.W.elo; S.E[li] = st.L.elo; S.SE[wi] = S.SE[wi].slice(); S.SE[li] = S.SE[li].slice(); S.SE[wi][s] = st.W.se; S.SE[li][s] = st.L.se;
    S.K[wi]++; S.K[li]++; S.SK[wi] = S.SK[wi].slice(); S.SK[li] = S.SK[li].slice(); S.SK[wi][s]++; S.SK[li][s]++;
    const mins = (e.code === 6 && e.g === 'M' && !e.q) ? 150 : 100;
    (S.liveRing[wi] = S.liveRing[wi] || []).push([day, 1, st.ew, mins, e.code, li]);
    (S.liveRing[li] = S.liveRing[li] || []).push([day, 0, 1 - st.ew, mins, e.code, wi]);
    (S.liveSurf[wi] = S.liveSurf[wi] || []).push([s, 1]); (S.liveSurf[li] = S.liveSurf[li] || []).push([s, 0]);
    const k1 = wi + ':' + li, k2 = li + ':' + wi; (S.liveH2H[k1] = S.liveH2H[k1] || [0, 0])[0]++; (S.liveH2H[k2] = S.liveH2H[k2] || [0, 0])[1]++;
    (ro[wi] = ro[wi] || []).push([li, day]); (ro[li] = ro[li] || []).push([wi, day]);
    S.live.applied++;
  }
  S.states = {}; S.predGen++;
}
/* ================= UI (styl „TNNS“, česky) ================= */
function resolveEv(e) {
  if (e._r) return e._r;
  const ok = x => x !== null && x !== undefined && x >= 0 && x < S.N;
  let hi = ok(e.hi) ? e.hi : S.matcher.match(e.g, e.h.slug, e.h.name), ai = ok(e.ai) ? e.ai : S.matcher.match(e.g, e.a.slug, e.a.name);
  const hu = hi === null, au = ai === null;
  if (hu) hi = addExtra(e.g, e.h.slug, e.h.name, e.h.c); if (au) ai = addExtra(e.g, e.a.slug, e.a.name, e.a.c);
  return (e._r = { hi, ai, hu, au });
}
const shortName = n => { const t = String(n || '').trim().split(/\s+/); return t.length < 2 ? (t[0] || '') : `${t[0][0]}. ${t.slice(1).join(' ')}`; };
function dispName(i, p) { if (i < S.N) return shortName(S.idx.n[i]); if (p && /\s[A-Z][\w-]*\.$/.test(p.name || '')) return p.name; return shortName(p ? p.name : pName(i)); }
function initials(i) { const t = pName(i).split(/\s+/); return ((t[0] || '')[0] || '') + ((t[t.length - 1] || '')[0] || ''); }
function avatar(i, eid, cls = '') { const ini = esc(initials(i).toUpperCase()); const id = eid || S.eid[i];
  return `<div class="av ${cls}"><span>${ini}</span>${id ? `<img src="https://a.espncdn.com/i/headshots/tennis/players/full/${esc(id)}.png" alt="" loading="lazy" onerror="this.remove()">` : ''}</div>`; }
function catLabel(e) { const W = e.g === 'W';
  if (e.code === 6) return 'Grand Slam'; if (e.code === 5) return W ? 'WTA 1000' : 'ATP Masters 1000'; if (e.code === 4) return W ? 'WTA 250/500' : 'ATP 250/500';
  if (e.code === 3) return W ? 'WTA 125' : 'Challenger'; const m = /^[MW]\d+/.exec(e.tname); return 'ITF ' + (m ? m[0] : (W ? 'ženy' : 'muži')); }
function badge(e) { const W = e.g === 'W'; return e.code >= 4 ? (W ? ['WTA', 'wta'] : ['ATP', 'atp']) : e.code === 3 ? (W ? ['125', 'wta'] : ['CH', 'ch']) : ['ITF', 'itf']; }
function tourGrp(e) { return e.code >= 4 ? (e.g === 'M' ? 'atp' : 'wta') : e.code === 3 ? 'ch' : (e.g === 'M' ? 'itfm' : 'itfw'); }
const TOURS = [['all', 'Všechny okruhy'], ['atp', 'ATP'], ['wta', 'WTA'], ['ch', 'Challenger / WTA 125'], ['itfm', 'ITF muži'], ['itfw', 'ITF ženy']];
const FILTS = [['all', 'Vše'], ['live', 'Živě'], ['pre', 'Nadcházející'], ['fin', 'Dokončené'], ['value', 'Value (kurz vs. model)']];
const hm = ts => new Date(ts * 1000).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
const dayLabel = (d, long) => d === -1 ? 'Včera' : d === 0 ? 'Dnes' : d === 1 ? 'Zítra' : new Date(Date.now() + d * 864e5).toLocaleDateString('cs-CZ', long ? { weekday: 'short', day: 'numeric', month: 'numeric' } : { weekday: 'long' });
const dateSub = d => new Date(Date.now() + d * 864e5).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric' });

/* ---------- oblíbení (localStorage) ---------- */
function favKey(i) { return i < S.N ? 'p' + S.idx.id[i] : 'x' + pG(i) + ':' + pName(i); }
function loadFav() { S.fav = new Map(); for (const f of (cacheGet('tp:fav') || [])) S.fav.set(f.k, f); }
function saveFav() { cacheSet('tp:fav', [...S.fav.values()]); }
function isFav(i) { return S.fav.has(favKey(i)); }
function toggleFav(i) { const k = favKey(i); if (S.fav.has(k)) S.fav.delete(k); else S.fav.set(k, { k, n: pName(i), g: pG(i) }); saveFav();
  for (const b of document.querySelectorAll(`[data-fav="${i}"]`)) { b.classList.toggle('on', isFav(i)); b.textContent = isFav(i) ? '★' : '☆'; } }
function favIdx(f) { if (f.k[0] === 'p') { const i = S.idMap.get(f.k.slice(1)); return i ?? null; } const key = Object.keys(S.extraKey).find(k => S.extra[S.extraKey[k] - S.N]?.name === f.n); return key ? S.extraKey[key] : addExtra(f.g, '', f.n, ''); }
const starBtn = i => `<button class="star ${isFav(i) ? 'on' : ''}" data-fav="${i}" aria-label="Oblíbený">${isFav(i) ? '★' : '☆'}</button>`;

/* ---------- predikce pro události ---------- */
async function probsFor(list) {
  const ids = []; for (const e of list) { const r = resolveEv(e); ids.push(r.hi, r.ai); }
  await ensure(ids);
  for (const e of list) {
    if (e.st === 3) continue;
    if (e._p != null && (e.st === 2 || e._pg === S.predGen)) continue;
    const r = resolveEv(e); try { const pr = predict(r.hi, r.ai, e.surface, e.code, e.q); e._p = pr.p; e._x = pr.x; e._pg = S.predGen; } catch (err) { }
    try { syncMarket(e); } catch (err) { e._ps = e._p; }
  }
}

/* ---------- řádek zápasu ---------- */
function scoreCells(e, side) {
  const cur = e.st === 2 ? e.sets.length - 1 : -1;
  const lv = e.st === 2 && !e.stale;
  // živě: tečka podání + body v gemu (pevná šířka – řádek neposkakuje)
  const pre = lv && e.srv ? `<span class="sv ${e.srv === side + 1 ? 'on' : ''}"></span>` : '';
  const post = lv && e.pts ? `<span class="g pt">${esc(e.pts[side])}</span>` : '';
  return pre + e.sets.map((s, k) => { const me = s[side], ot = s[1 - side]; const won = e.st === 3 || k < cur ? me > ot : false;
    const tb = s.length > 2 && Math.min(me, ot) >= 6 ? `<sup>${s[2 + side]}</sup>` : '';
    return `<span class="g ${won ? 'w' : ''} ${k === cur ? 'cur' : ''}">${me}${tb}</span>`; }).join('') + post;
}
const finLabel = e => e.det === 8 ? 'Skreč' : e.det === 5 ? 'Zrušeno' : e.det !== 3 && !e.sets.length ? 'Bez boje' : 'Konec';
function statusCell(e) {
  if (e.st === 2 && !e.stale) return `<span class="lv"><i class="play">▶</i>${esc(e.live || 'Živě')}</span>`;
  if (e.st === 3) return `<span class="fin">${finLabel(e)}</span>`;
  if (e.stale) return `<span class="tm">${hm(e.ts)}</span><span class="stl" title="Pro tuto úroveň nejsou živá data">bez živých dat</span>`;
  return `<span class="tm">${hm(e.ts)}</span>`;
}
/* šipka u kurzu: poslední změna od minulého načtení (výrazná), jinak změna od otevření (slabší). Zelená ▲ = kurz roste, červená ▼ = klesá */
function arrowOf(o, k) {
  const ld = o.lastDir ? o.lastDir[k] : 0;
  const ref = o.inplay && o.preAvg ? o.preAvg : o.openAvg;
  const od = ref ? sgn(o.avg[k], ref[k]) : 0;
  const up = d => d > 0 ? '▲' : '▼';
  const faint = od ? `<i class="ar ${od > 0 ? 'up' : 'dn'}" title="${o.inplay ? 'proti předzápasovému kurzu' : 'od otevření'}">${up(od)}</i>` : '<i class="ar"></i>';
  const bold = ld ? `<i class="ar ${ld > 0 ? 'up' : 'dn'} last" title="od posledního načtení">${up(ld)}</i>` : '<i class="ar"></i>';
  if (o.inplay) return `<span class="ars">${faint}${bold}</span>`;
  return ld ? bold : faint;
}
function oddsLabel(o) { return o && o.inplay ? `živě ⌀ ${o.n}× <i class="dot"></i>` : `kurz ⌀ ${o.n}× ${o && o.live ? '<i class="dot"></i>' : ''}`; }
function oddsHtml(e) {
  if (e.st === 3) return '';
  const o = e.oddsV;
  if (!o || !o.avg) {
    if (!e.fsid || (e.st !== 1 && e.st !== 2)) return '';
    const lab = e.st === 2 ? (o && o.suspended ? 'živě pozastaveno' : 'živě…') : (e.oddsNone ? 'bez kurzů' : 'kurzy…');
    const dash = (e.st === 2 && o && o.suspended) || e.oddsNone;
    return `<div class="odds ph"><span class="od" data-k="1"><span class="v">${dash ? '—' : '···'}</span><i class="ar"></i></span><span class="ol">${lab}</span><span class="od" data-k="2"><span class="v">${dash ? '—' : '···'}</span><i class="ar"></i></span></div>`;
  }
  const v = valueOf(e);
  const c = k => `<span class="od ${v && v.side === k ? 'val' : ''}" data-k="${k}"><span class="v">${o.avg[k - 1].toFixed(2)}</span>${arrowOf(o, k - 1)}${v && v.side === k ? '<em>VALUE</em>' : ''}</span>`;
  return `<div class="odds${o.inplay ? ' inplay' : ''}">${c(1)}<span class="ol">${oddsLabel(o)}</span>${c(2)}</div>`;
}
/* ---------- predikce v průběhu (bodový model v prohlížeči) ----------
   Průhledný Markovův model gem/set/zápas (bod na podání). Není to nově natrénovaný model
   a nemá vlastní přesnost. Předzápasová pravděpodobnost modelu (_p) je výchozí bod:
   mezera síly g se volí tak, aby z 0:0 (průměr obou podání) vyšlo právě _p.
   Když to svorka bodu na podání nedovolí, „teď“ se posune jen o změnu log-šance
   proti stavu 0:0, takže na 0:0 zůstane přesně _p.
   Bod na podání: pA = clamp(s0+g, 0.50, 0.84), pB = clamp(s0−g, 0.50, 0.84),
   s0 = 0.64 muži / 0.57 ženy (typická tour hodnota, konstanta, ne odhad z dat).
   Gem: standardní vzorec z aktuálních bodů (0/15/30/40/A). Set: na 6, rozdíl 2, TB na 6:6
   (na 7, rozdíl 2; 1. bod podává ten, kdo by podával další gem, pak po dvou).
   Zápas: na 2 sety, u mužského Grand Slamu na 3 (stejné pravidlo jako predict()).
   Podání neznámé → průměr obou možností. Body v gemu chybí → gem 0:0, sety a gemy platí.
   LIVEPRED_START */
function clamp01s(x, a, b) { return Math.min(b, Math.max(a, x)); }
function logit(p) { const x = Math.min(1 - 1e-6, Math.max(1e-6, p)); return Math.log(x / (1 - x)); }
function expit(z) { if (z > 20) return 1 - 1e-9; if (z < -20) return 1e-9; return 1 / (1 + Math.exp(-z)); }
function holdP(p) {
  const q = 1 - p, d = (p * p) / (p * p + q * q);
  return Math.pow(p, 4) * (1 + 4 * q + 10 * q * q) + 20 * Math.pow(p, 3) * Math.pow(q, 3) * d;
}
/* P(A vyhraje gem) z bodů a,b (0..3 = 0/15/30/40, 4 = výhoda). p = P(A vyhraje bod). */
function pGameAB(a, b, p) {
  const q = 1 - p, d = (p * p) / (p * p + q * q);
  const m = new Map();
  const rec = (x, y) => {
    if (x >= 4 && x - y >= 2) return 1;
    if (y >= 4 && y - x >= 2) return 0;
    if (x >= 3 && y >= 3) {
      if (x === y) return d;
      if (x === y + 1) return p + q * d;
      if (y === x + 1) return p * d;
    }
    const k = x + ',' + y; const h = m.get(k); if (h != null) return h;
    const v = p * rec(x + 1, y) + q * rec(x, y + 1);
    m.set(k, v); return v;
  };
  return rec(a, b);
}
/* kdo podává i-tý bod tiebreaku (0 = první), když A podával první */
function tbServeA(i, aFirst) {
  if (i <= 0) return aFirst;
  const pair = Math.floor((i - 1) / 2);
  return (pair % 2 === 1) ? aFirst : !aFirst;
}
function pTie(a, b, aServes, pA, pB, tm) {
  if (a >= 7 && a - b >= 2) return 1;
  if (b >= 7 && b - a >= 2) return 0;
  if (a + b > 48) return a === b ? (aServes ? pA : (1 - pB)) : (a > b ? 1 : 0);
  const k = a + ',' + b + (aServes ? 'A' : 'B');
  const hit = tm.get(k); if (hit != null) return hit;
  const p = aServes ? pA : (1 - pB);
  const n = a + b;
  const aFirst = tbServeA(n, true) === aServes;
  const nextA = tbServeA(n + 1, aFirst);
  const v = p * pTie(a + 1, b, nextA, pA, pB, tm) + (1 - p) * pTie(a, b + 1, nextA, pA, pB, tm);
  tm.set(k, v); return v;
}
function pMatch(sa, sb, ga, gb, aToServe, need, pA, pB, mm, tm) {
  if (sa >= need) return 1;
  if (sb >= need) return 0;
  if ((ga >= 6 && ga - gb >= 2) || (ga === 7 && gb === 6)) return pMatch(sa + 1, sb, 0, 0, aToServe, need, pA, pB, mm, tm);
  if ((gb >= 6 && gb - ga >= 2) || (gb === 7 && ga === 6)) return pMatch(sa, sb + 1, 0, 0, aToServe, need, pA, pB, mm, tm);
  const k = sa + ',' + sb + ',' + ga + ',' + gb + (aToServe ? 'A' : 'B');
  const hit = mm.get(k); if (hit != null) return hit;
  let v;
  if (ga === 6 && gb === 6) {
    const pS = pTie(0, 0, aToServe, pA, pB, tm);
    v = pS * pMatch(sa + 1, sb, 0, 0, !aToServe, need, pA, pB, mm, tm) + (1 - pS) * pMatch(sa, sb + 1, 0, 0, !aToServe, need, pA, pB, mm, tm);
  } else {
    const pG = aToServe ? holdP(pA) : (1 - holdP(pB));
    v = pG * pMatch(sa, sb, ga + 1, gb, !aToServe, need, pA, pB, mm, tm) + (1 - pG) * pMatch(sa, sb, ga, gb + 1, !aToServe, need, pA, pB, mm, tm);
  }
  mm.set(k, v); return v;
}
function pFromState(sa, sb, ga, gb, aPts, bPts, tbA, tbB, inTB, aServes, need, pA, pB) {
  const mm = new Map(), tm = new Map();
  if (inTB) {
    const n = tbA + tbB;
    const aFirst = tbServeA(n, true) === aServes;
    const pS = pTie(tbA, tbB, aServes, pA, pB, tm);
    return pS * pMatch(sa + 1, sb, 0, 0, !aFirst, need, pA, pB, mm, tm) + (1 - pS) * pMatch(sa, sb + 1, 0, 0, !aFirst, need, pA, pB, mm, tm);
  }
  const pPt = aServes ? pA : (1 - pB);
  const pG = pGameAB(aPts, bPts, pPt);
  return pG * pMatch(sa, sb, ga + 1, gb, !aServes, need, pA, pB, mm, tm) + (1 - pG) * pMatch(sa, sb, ga, gb + 1, !aServes, need, pA, pB, mm, tm);
}
function matchBestOf(e) { return (e.code === 6 && e.g === 'M' && !e.q) ? 5 : 3; }
/* P(A vyhraje set) ze stavu gemů. aToServe = kdo podává další gem. */
function pSetGames(ga, gb, aToServe, pA, pB, memo, tm) {
  if ((ga >= 6 && ga - gb >= 2) || (ga === 7 && gb === 6)) return 1;
  if ((gb >= 6 && gb - ga >= 2) || (gb === 7 && ga === 6)) return 0;
  const k = ga + ',' + gb + (aToServe ? 'A' : 'B');
  const hit = memo.get(k); if (hit != null) return hit;
  let v;
  if (ga === 6 && gb === 6) v = pTie(0, 0, aToServe, pA, pB, tm);
  else {
    const pG = aToServe ? holdP(pA) : (1 - holdP(pB));
    v = pG * pSetGames(ga + 1, gb, !aToServe, pA, pB, memo, tm) + (1 - pG) * pSetGames(ga, gb + 1, !aToServe, pA, pB, memo, tm);
  }
  memo.set(k, v); return v;
}
/* P(A vyhraje právě tenhle set) z gemů, bodů a podání. Stejná pravidla jako zápasový model. */
function pThisSet(ga, gb, aPts, bPts, tbA, tbB, inTB, aServes, pA, pB) {
  const tm = new Map();
  if (inTB) return pTie(tbA, tbB, aServes, pA, pB, tm);
  const pPt = aServes ? pA : (1 - pB);
  const pG = pGameAB(aPts, bPts, pPt);
  const memo = new Map();
  return pG * pSetGames(ga + 1, gb, !aServes, pA, pB, memo, tm) + (1 - pG) * pSetGames(ga, gb + 1, !aServes, pA, pB, memo, tm);
}
function fitServe(p0, bo, s0) {
  const need = (bo + 1) / 2;
  const m0 = g => {
    const pA = clamp01s(s0 + g, 0.5, 0.84), pB = clamp01s(s0 - g, 0.5, 0.84);
    return (pFromState(0, 0, 0, 0, 0, 0, 0, 0, false, true, need, pA, pB) + pFromState(0, 0, 0, 0, 0, 0, 0, 0, false, false, need, pA, pB)) / 2;
  };
  let lo = -0.34, hi = 0.34;
  for (let i = 0; i < 32; i++) { const mid = (lo + hi) / 2; if (m0(mid) < p0) lo = mid; else hi = mid; }
  const g = (lo + hi) / 2;
  const pA = clamp01s(s0 + g, 0.5, 0.84), pB = clamp01s(s0 - g, 0.5, 0.84);
  return { g, pA, pB, m0: m0(g), s0, bo, p: p0 };
}
function gamePointTok(x) {
  if (x == null || x === '') return null;
  const t = String(x).trim().toUpperCase();
  if (t === 'A' || t === 'AD' || t === '50') return 4;
  if (t === '0' || t === '0.0') return 0;
  if (t === '15' || t === '15.0') return 1;
  if (t === '30' || t === '30.0') return 2;
  if (t === '40' || t === '40.0') return 3;
  return null;
}
function setWinner(s) {
  const a = +s[0], b = +s[1];
  if (!(a >= 0) || !(b >= 0)) return 0;
  if (a >= 6 && a - b >= 2) return 1;
  if (b >= 6 && b - a >= 2) return 2;
  if (a === 7 && b === 6) return 1;
  if (b === 7 && a === 6) return 2;
  if (s.length > 2 && a === 6 && b === 6) {
    const ta = +s[2], tb = +s[3];
    if (ta >= 7 && ta - tb >= 2) return 1;
    if (tb >= 7 && tb - ta >= 2) return 2;
  }
  return 0;
}
/* null = živé skóre nemáme. Jinak stav pro model. aServes null = podání neznáme. */
function readLive(e) {
  if (!e || e.st !== 2 || e.stale) return null;
  const sets = (e.sets || []).filter(s => s && +s[0] >= 0 && +s[1] >= 0);
  const hasPts = e.pts && (e.pts[0] != null || e.pts[1] != null);
  if (!sets.length && !hasPts) return null;
  let sa = 0, sb = 0;
  const rows = sets.slice();
  const cur = rows.length ? rows.pop() : [0, 0];
  for (const s of rows) { const w = setWinner(s); if (w === 1) sa++; else if (w === 2) sb++; else if (+s[0] > +s[1]) sa++; else if (+s[1] > +s[0]) sb++; }
  const wcur = setWinner(cur);
  let ga = 0, gb = 0, aPts = 0, bPts = 0, tbA = 0, tbB = 0, inTB = false, pointsKnown = false, between = false;
  if (wcur) { if (wcur === 1) sa++; else sb++; between = true; pointsKnown = false; }
  else {
    ga = +cur[0]; gb = +cur[1];
    inTB = ga === 6 && gb === 6;
    if (inTB && cur.length > 2 && (+cur[2] > 0 || +cur[3] > 0 || cur[2] === 0 || cur[3] === 0)) {
      tbA = Math.max(0, +cur[2] || 0); tbB = Math.max(0, +cur[3] || 0); pointsKnown = true;
    } else if (inTB) {
      const ia = gamePointTok(e.pts && e.pts[0]), ib = gamePointTok(e.pts && e.pts[1]);
      const na = e.pts ? parseInt(e.pts[0], 10) : NaN, nb = e.pts ? parseInt(e.pts[1], 10) : NaN;
      if (e.pts && ia == null && ib == null && na >= 0 && nb >= 0 && na <= 30 && nb <= 30) { tbA = na; tbB = nb; pointsKnown = true; }
      else pointsKnown = false;
    } else {
      const ia = gamePointTok(e.pts && e.pts[0]), ib = gamePointTok(e.pts && e.pts[1]);
      if (ia != null && ib != null) { aPts = ia; bPts = ib; pointsKnown = true; }
      else pointsKnown = false;
    }
  }
  const aServes = e.srv === 1 ? true : e.srv === 2 ? false : null;
  return { sa, sb, ga, gb, aPts, bPts, tbA, tbB, inTB, between, pointsKnown, aServes };
}
function liveProb(e) {
  if (!e || e._p == null || !(e._p > 0) || !(e._p < 1)) return null;
  const st = readLive(e);
  if (!st) return { ok: false };
  const fit = serveFit(e);
  const need = (fit.bo + 1) / 2;
  const once = aServes => pFromState(st.sa, st.sb, st.ga, st.gb, st.aPts, st.bPts, st.tbA, st.tbB, st.inTB, aServes, need, fit.pA, fit.pB);
  const m = st.aServes == null ? (once(true) + once(false)) / 2 : once(st.aServes);
  const anchored = Math.abs(fit.m0 - e._p) > 0.012;
  const pm = anchored ? expit(logit(e._p) + logit(m) - logit(fit.m0)) : m;
  if (liveMlOn(e)) {
    const ml = liveMlProb(e, st);
    if (ml != null) return { ok: true, p: ml, serverKnown: st.aServes != null, pointsKnown: st.pointsKnown, between: st.between, anchored, ml: true };
  }
  return { ok: true, p: pm, serverKnown: st.aServes != null, pointsKnown: st.pointsKnown, between: st.between, anchored };
}
function liveMlOn(e) {
  const L = S.liveOn;
  return !!(e && e.code >= 3 && L && L.base === 'liveml1' && L.w && L.score && L.w.length === (L.score.length + L.core.length * L.diffs.length + L.core.length * L.ctx.length));
}
function saveLive() {
  try { localStorage.setItem('tp:liveon', JSON.stringify({ base: S.liveOn.base, w: S.liveOn.w, w0: S.liveOn.w0, n: S.liveOn.n, seen: S.liveOn.seen, gw: S.liveOn.gw, gw0: S.liveOn.gw0, gn: S.liveOn.gn, gseen: S.liveOn.gseen, sw: S.liveOn.sw, sw0: S.liveOn.sw0, sn: S.liveOn.sn, sseen: S.liveOn.sseen, nw: S.liveOn.nw, nw0: S.liveOn.nw0, nn: S.liveOn.nn, nseen: S.liveOn.nseen, score: S.liveOn.score, core: S.liveOn.core, diffs: S.liveOn.diffs, ctx: S.liveOn.ctx, scale: S.liveOn.scale })); } catch (e) {}
}
function attachLive(shipped) {
  const ok = shipped && shipped.base === 'liveml1' && shipped.w && shipped.score && shipped.w.length === (shipped.score.length + shipped.core.length * shipped.diffs.length + shipped.core.length * shipped.ctx.length);
  if (!ok) { S.liveOn = null; return; }
  let local = null;
  try { local = JSON.parse(localStorage.getItem('tp:liveon') || 'null'); } catch (e) { local = null; }
  let use = shipped;
  if (local && local.base === 'liveml1' && local.w && local.w.length === shipped.w.length) {
    const ss = new Set(shipped.seen || []), ls = new Set(local.seen || []);
    const localInShip = [...ls].every(id => ss.has(id));
    const shipInLocal = [...ss].every(id => ls.has(id));
    if (!localInShip && shipInLocal) use = local;
  }
  const z = () => shipped.w.map(() => 0);
  const gwShip = shipped.gw && shipped.gw.length === shipped.w.length ? shipped.gw : z();
  let gw = gwShip.slice(), gw0 = (shipped.gw0 && shipped.gw0.length === shipped.w.length ? shipped.gw0 : gwShip).slice();
  let gseen = (shipped.gseen || []).slice(), gn = shipped.gn || 0;
  if (local && local.base === 'liveml1' && local.gw && local.gw.length === shipped.w.length) {
    const ss = new Set(shipped.gseen || []), ls = new Set(local.gseen || []);
    const localInShip = [...ls].every(id => ss.has(id));
    const shipInLocal = [...ss].every(id => ls.has(id));
    if (!localInShip && shipInLocal) { gw = local.gw.slice(); gseen = (local.gseen || []).slice(); gn = local.gn || 0; }
  }
  const nSet = shipped.w.length + 1 + shipped.ctx.length + 1 + shipped.ctx.length + shipped.diffs.length;
  const swShip = shipped.sw && shipped.sw.length === nSet ? shipped.sw : Array(nSet).fill(0);
  let sw = swShip.slice(), sw0 = (shipped.sw0 && shipped.sw0.length === nSet ? shipped.sw0 : swShip).slice();
  let sseen = (shipped.sseen || []).slice(), sn = shipped.sn || 0;
  if (local && local.base === 'liveml1' && local.sw && local.sw.length === nSet) {
    const ss = new Set(shipped.sseen || []), ls = new Set(local.sseen || []);
    const localInShip = [...ls].every(id => ss.has(id));
    const shipInLocal = [...ss].every(id => ls.has(id));
    if (!localInShip && shipInLocal) { sw = local.sw.slice(); sseen = (local.sseen || []).slice(); sn = local.sn || 0; }
  }
  const nNext = (shipped.nscore ? shipped.nscore.length : 9) * 2 + 1 + shipped.diffs.length;
  const nwShip = shipped.nw && shipped.nw.length === nNext ? shipped.nw : Array(nNext).fill(0);
  let nw = nwShip.slice(), nw0 = (shipped.nw0 && shipped.nw0.length === nNext ? shipped.nw0 : nwShip).slice();
  let nseen = (shipped.nseen || []).slice(), nn = shipped.nn || 0;
  if (local && local.base === 'liveml1' && local.nw && local.nw.length === nNext) {
    const ss = new Set(shipped.nseen || []), ls = new Set(local.nseen || []);
    const localInShip = [...ls].every(id => ss.has(id));
    const shipInLocal = [...ss].every(id => ls.has(id));
    if (!localInShip && shipInLocal) { nw = local.nw.slice(); nseen = (local.nseen || []).slice(); nn = local.nn || 0; }
  }
  S.liveOn = { base: 'liveml1', score: shipped.score, core: shipped.core, diffs: shipped.diffs, ctx: shipped.ctx, scale: shipped.scale.slice(), w: use.w.slice(), w0: (shipped.w0 || shipped.w).slice(), n: use.n || 0, seen: (use.seen || []).slice(), gw, gw0, gn, gseen, sw, sw0, sn, sseen, nw, nw0, nn, nseen, nscore: (shipped.nscore || ['ds', 'dg', 'dp', 'dtb', 'srv', 'hold', 'brk', 'bp', 'late']).slice(), pull: 0.04, bound: 0.22, eta: shipped.eta || { G: 0.0012, S: 0.0025, M: 0.0035 } };
}
function ensureX(e) {
  if (!e || e._x || e._p == null) return;
  const r = resolveEv(e);
  if (!r || r.hi == null || r.ai == null) return;
  try { const pr = predict(r.hi, r.ai, e.surface, e.code, e.q); e._p = pr.p; e._x = pr.x; } catch (err) {}
}
function liveDiffs(e, aIsH) {
  const names = S.liveOn.diffs, F = S.model.F, x = e._x;
  const d = names.map(n => { const i = F.indexOf(n); return i < 0 ? 0 : (x[i] || 0); });
  if (!aIsH) for (let i = 0; i < d.length; i++) d[i] = -d[i];
  return d;
}
function liveCtx(e) {
  const surf = e.surface || '';
  return { bo5: matchBestOf(e) === 5 ? 1 : 0, woman: e.g === 'W' ? 1 : 0, clay: surf === 'Clay' ? 1 : 0, grass: surf === 'Grass' ? 1 : 0, qual: e.q ? 1 : 0, lvl: (e.code || 0) / 6 };
}
function liveScoreMap(sa, sb, ga, gb, pa, pb, ta, tb, inTb, srv, hold, brk, blankStart) {
  const z = {};
  const start = blankStart !== false && !inTb && sa === 0 && sb === 0 && ga === 0 && gb === 0 && pa === 0 && pb === 0 && ta === 0 && tb === 0;
  for (const k of S.liveOn.score) z[k] = 0;
  if (start) return z;
  z.ds = sa - sb; z.d1 = (sa === 1) - (sb === 1); z.d2 = (sa === 2) - (sb === 2);
  z.dg = inTb ? 0 : ga - gb; z.late = inTb ? 0 : (ga >= 5) - (gb >= 5);
  z.dp = inTb ? 0 : (pa - pb) / 4; z.dtb = inTb ? (ta - tb) / 7 : 0;
  z.srv = srv; z.hold = hold; z.brk = brk; z.bp = 0;
  if (!inTb && srv) {
    const aGp = pa >= 3 && pa > pb, bGp = pb >= 3 && pb > pa;
    if (srv < 0 && aGp) z.bp = 1; else if (srv > 0 && bGp) z.bp = -1;
  }
  if (!inTb) {
    for (let k = 1; k <= 6; k++) z['g' + k] = (ga === k) - (gb === k);
    for (let k = 1; k <= 4; k++) z['p' + k] = (pa === k) - (pb === k);
  }
  return z;
}
function livePhi(sa, sb, ga, gb, pa, pb, ta, tb, inTb, srv, hold, brk, diffs, ctx, blankStart) {
  const L = S.liveOn;
  const sm = liveScoreMap(sa, sb, ga, gb, pa, pb, ta, tb, inTb, srv, hold, brk, blankStart);
  const sd = diffs.map((d, i) => Math.abs(d) / (L.scale[i] || 1));
  const out = L.score.map(k => sm[k] || 0);
  for (const c of L.core) {
    const v = sm[c] || 0;
    for (const a of sd) out.push(v * a);
    for (const k of L.ctx) out.push(v * (ctx[k] || 0));
  }
  return out;
}
function liveDotW(w, x, cap) {
  let z = 0;
  for (let i = 0; i < x.length; i++) if (x[i] && w[i]) z += w[i] * x[i];
  return z > cap ? cap : z < -cap ? -cap : z;
}
function liveDot(x) { return liveDotW(S.liveOn.w, x, 1.15); }
const GAME_ZCAP = 3.2;
function liveAdjust(p, x) {
  const z = liveDot(x);
  if (!z) return p;
  return expit(logit(p) + z);
}
function liveIds(e) {
  if (!e || !e.ts) return null;
  const r = resolveEv(e);
  if (!r || r.hi == null || r.ai == null || r.hi >= S.N || r.ai >= S.N) return null;
  const ih = S.idx.id[r.hi], ia = S.idx.id[r.ai];
  if (!ih || !ia) return null;
  const day = Math.floor(e.ts / 86400) + ((e.ts % 86400) > 22 * 3600 ? 1 : 0);
  const aIsH = String(ih) < String(ia);
  return { aIsH, mk: day + '|' + (aIsH ? ih : ia) + '|' + (aIsH ? ia : ih), bo5: matchBestOf(e) === 5 ? 1 : 0 };
}
function liveMlProb(e, st) {
  ensureX(e);
  const id = liveIds(e);
  if (!id || !e._x || !S.model) return null;
  const hb = e._hb || { hold: 0, brk: 0 };
  const srvH = st.aServes == null ? 0 : (st.aServes ? 1 : -1);
  const sa = id.aIsH ? st.sa : st.sb, sb = id.aIsH ? st.sb : st.sa;
  const ga = id.aIsH ? st.ga : st.gb, gb = id.aIsH ? st.gb : st.ga;
  const pa = id.aIsH ? st.aPts : st.bPts, pb = id.aIsH ? st.bPts : st.aPts;
  const ta = id.aIsH ? st.tbA : st.tbB, tb = id.aIsH ? st.tbB : st.tbA;
  const srv = srvH === 0 ? 0 : (id.aIsH ? srvH : -srvH);
  const hold = id.aIsH ? hb.hold : -hb.hold, brk = id.aIsH ? hb.brk : -hb.brk;
  const x = livePhi(sa, sb, ga, gb, pa, pb, ta, tb, st.inTB, srv, hold, brk, liveDiffs(e, id.aIsH), liveCtx(e));
  const pA = id.aIsH ? e._p : 1 - e._p;
  const p = liveAdjust(pA, x);
  return id.aIsH ? p : 1 - p;
}
function liveGamePhi(e, id, sa, sb, ga, gb, pa, pb, ta, tb, inTb, srv, hold, brk) {
  return livePhi(sa, sb, ga, gb, pa, pb, ta, tb, inTb, srv, hold, brk, liveDiffs(e, id.aIsH), liveCtx(e), false);
}
function liveGameProb(e, st) {
  ensureX(e);
  const id = liveIds(e);
  const L = S.liveOn;
  if (!id || !e._x || !L || !L.gw || L.gw.length !== L.w.length) return null;
  const hb = e._hb || { hold: 0, brk: 0 };
  const srvH = st.aServes == null ? 0 : (st.aServes ? 1 : -1);
  const sa = id.aIsH ? st.sa : st.sb, sb = id.aIsH ? st.sb : st.sa;
  const ga = id.aIsH ? st.ga : st.gb, gb = id.aIsH ? st.gb : st.ga;
  const pa = id.aIsH ? st.aPts : st.bPts, pb = id.aIsH ? st.bPts : st.aPts;
  const ta = id.aIsH ? st.tbA : st.tbB, tb = id.aIsH ? st.tbB : st.tbA;
  const srv = srvH === 0 ? 0 : (id.aIsH ? srvH : -srvH);
  const hold = id.aIsH ? hb.hold : -hb.hold, brk = id.aIsH ? hb.brk : -hb.brk;
  const x = liveGamePhi(e, id, sa, sb, ga, gb, pa, pb, ta, tb, st.inTB, srv, hold, brk);
  const pA = id.aIsH ? e._p : 1 - e._p;
  const z = liveDotW(L.gw, x, GAME_ZCAP);
  const p = z ? expit(logit(pA) + z) : pA;
  return id.aIsH ? p : 1 - p;
}
function liveStep(x, y, p0, mk, eta) {
  const st = S.liveOn;
  if (!st || !x) return false;
  if ((st.seen || []).indexOf(mk) >= 0) return false;
  st.seen = st.seen || [];
  if (!x.some(v => v)) { st.seen.push(mk); if (st.seen.length > 6000) st.seen = st.seen.slice(-6000); return false; }
  const p = expit(logit(p0) + liveDot(x));
  const err = p - y;
  const pull = st.pull || 0.04, bound = st.bound || 0.22;
  for (let i = 0; i < x.length; i++) {
    if (!x[i]) continue;
    let nw = (st.w[i] || 0) - eta * err * x[i] - eta * pull * ((st.w[i] || 0) - (st.w0[i] || 0));
    const lo = (st.w0[i] || 0) - bound, hi = (st.w0[i] || 0) + bound;
    if (nw > hi) nw = hi; else if (nw < lo) nw = lo;
    if (nw > 1.5) nw = 1.5; else if (nw < -1.5) nw = -1.5;
    st.w[i] = nw;
  }
  st.seen.push(mk);
  if (st.seen.length > 6000) st.seen = st.seen.slice(-6000);
  st.n = (st.n || 0) + 1;
  return true;
}
const SET_ZCAP = 2.2;
function setLen(L) {
  return L.w.length + 1 + L.ctx.length + 1 + L.ctx.length + L.diffs.length;
}
function setModelOn(e) {
  const L = S.liveOn;
  return !!(liveMlOn(e) && L.sw && L.ctx && L.diffs && L.sw.length === setLen(L));
}
function nextLen(L) {
  const names = L.nscore || ['ds', 'dg', 'dp', 'dtb', 'srv', 'hold', 'brk', 'bp', 'late'];
  return names.length * 2 + 1 + L.diffs.length;
}
function nextModelOn(e) {
  const L = S.liveOn;
  return !!(liveMlOn(e) && L.nw && L.diffs && L.nw.length === nextLen(L) && L.nw.some(v => v));
}
function liveNextPhi(e, id, sa, sb, ga, gb, pa, pb, ta, tb, inTb, srv, hold, brk, pA) {
  const L = S.liveOn;
  const names = L.nscore || ['ds', 'dg', 'dp', 'dtb', 'srv', 'hold', 'brk', 'bp', 'late'];
  const sm = liveScoreMap(sa, sb, ga, gb, pa, pb, ta, tb, inTb, srv, hold, brk, false);
  const pc = Math.min(0.98, Math.max(0.02, pA));
  const lp = logit(pc);
  const sc = names.map(k => sm[k] || 0);
  const diffs = liveDiffs(e, id.aIsH);
  const out = sc.slice();
  for (const v of sc) out.push(v * lp);
  out.push(lp);
  for (let i = 0; i < diffs.length; i++) out.push(diffs[i] / (L.scale[i] || 1));
  return out;
}
function firstSetStart(sa, sb, ga, gb, pa, pb, ta, tb, inTb) {
  return !inTb && sa === 0 && sb === 0 && ga === 0 && gb === 0 && pa === 0 && pb === 0 && ta === 0 && tb === 0;
}
function livePreTail(e, id, pA) {
  const L = S.liveOn, ctx = liveCtx(e), lp = logit(pA), diffs = liveDiffs(e, id.aIsH);
  const out = [lp];
  for (const k of L.ctx) out.push(lp * (ctx[k] || 0));
  for (let i = 0; i < diffs.length; i++) out.push(diffs[i] / (L.scale[i] || 1));
  return out;
}
function liveSetPhi(e, id, sa, sb, ga, gb, pa, pb, ta, tb, inTb, srv, hold, brk) {
  const x = liveGamePhi(e, id, sa, sb, ga, gb, pa, pb, ta, tb, inTb, srv, hold, brk);
  const ctx = liveCtx(e);
  const pA = id.aIsH ? e._p : 1 - e._p;
  x.push(1);
  for (const k of S.liveOn.ctx) x.push(ctx[k] || 0);
  for (const v of livePreTail(e, id, pA)) x.push(v);
  return x;
}
function liveSetPreOnly(e, id, pA) {
  const L = S.liveOn;
  const x = Array(L.w.length + 1 + L.ctx.length).fill(0);
  for (const v of livePreTail(e, id, pA)) x.push(v);
  return x;
}
function liveSetP(e, sa, sb, ga, gb, pa, pb, ta, tb, inTb, srvH, holdH, brkH) {
  ensureX(e);
  const id = liveIds(e);
  const L = S.liveOn;
  if (!id || !e._x || !setModelOn(e)) return null;
  const saA = id.aIsH ? sa : sb, sbA = id.aIsH ? sb : sa;
  const gaA = id.aIsH ? ga : gb, gbA = id.aIsH ? gb : ga;
  const paA = id.aIsH ? pa : pb, pbA = id.aIsH ? pb : pa;
  const taA = id.aIsH ? ta : tb, tbA = id.aIsH ? tb : ta;
  const srv = srvH === 0 ? 0 : (id.aIsH ? srvH : -srvH);
  const hold = id.aIsH ? holdH : -holdH, brk = id.aIsH ? brkH : -brkH;
  const x = liveSetPhi(e, id, saA, sbA, gaA, gbA, paA, pbA, taA, tbA, inTb, srv, hold, brk);
  const pA = id.aIsH ? e._p : 1 - e._p;
  const z = liveDotW(L.sw, x, SET_ZCAP);
  const p = z ? expit(logit(pA) + z) : pA;
  return id.aIsH ? p : 1 - p;
}
function liveGameStep(x, y, p0, mk) {
  const st = S.liveOn;
  if (!st || !st.gw || !x) return false;
  st.gseen = st.gseen || [];
  if (st.gseen.indexOf(mk) >= 0) return false;
  if (!x.some(v => v)) { st.gseen.push(mk); if (st.gseen.length > 6000) st.gseen = st.gseen.slice(-6000); return false; }
  const eta = (st.eta && st.eta.G) || 0.0012;
  const p = expit(logit(p0) + liveDotW(st.gw, x, GAME_ZCAP));
  const err = p - y;
  const pull = st.pull || 0.04, bound = st.bound || 0.22;
  for (let i = 0; i < x.length; i++) {
    if (!x[i]) continue;
    const w0 = st.gw0[i] || 0;
    let nw = (st.gw[i] || 0) - eta * err * x[i] - eta * pull * ((st.gw[i] || 0) - w0);
    const lo = w0 - bound, hi = w0 + bound;
    if (nw > hi) nw = hi; else if (nw < lo) nw = lo;
    if (nw > 1.5) nw = 1.5; else if (nw < -1.5) nw = -1.5;
    st.gw[i] = nw;
  }
  st.gseen.push(mk);
  if (st.gseen.length > 6000) st.gseen = st.gseen.slice(-6000);
  st.gn = (st.gn || 0) + 1;
  return true;
}
function liveNextP(e, st) {
  ensureX(e);
  const id = liveIds(e);
  const L = S.liveOn;
  if (!id || !e._x || !nextModelOn(e) || !st) return null;
  const hb = e._hb || { hold: 0, brk: 0 };
  const srvH = st.aServes == null ? 0 : (st.aServes ? 1 : -1);
  const sa = id.aIsH ? st.sa : st.sb, sb = id.aIsH ? st.sb : st.sa;
  const ga = id.aIsH ? st.ga : st.gb, gb = id.aIsH ? st.gb : st.ga;
  const pa = id.aIsH ? st.aPts : st.bPts, pb = id.aIsH ? st.bPts : st.aPts;
  const ta = id.aIsH ? st.tbA : st.tbB, tb = id.aIsH ? st.tbB : st.tbA;
  const srv = srvH === 0 ? 0 : (id.aIsH ? srvH : -srvH);
  const hold = id.aIsH ? hb.hold : -hb.hold, brk = id.aIsH ? hb.brk : -hb.brk;
  const blank = !!(st.between);
  const pA = id.aIsH ? e._p : 1 - e._p;
  const x = liveNextPhi(e, id, sa, sb, blank ? 0 : ga, blank ? 0 : gb, blank ? 0 : pa, blank ? 0 : pb, blank ? 0 : ta, blank ? 0 : tb, blank ? false : st.inTB, srv, hold, brk, pA);
  const pc = Math.min(0.98, Math.max(0.02, pA));
  const p = expit(logit(pc) + liveDotW(L.nw, x, SET_ZCAP));
  return id.aIsH ? p : 1 - p;
}
function liveNextStep(x, y, p0, mk) {
  const st = S.liveOn;
  if (!st || !st.nw || !x) return false;
  st.nseen = st.nseen || [];
  if (st.nseen.indexOf(mk) >= 0) return false;
  if (!x.some(v => v)) { st.nseen.push(mk); if (st.nseen.length > 6000) st.nseen = st.nseen.slice(-6000); return false; }
  const eta = (st.eta && st.eta.S) || 0.0025;
  const pc = Math.min(0.98, Math.max(0.02, p0));
  const p = expit(logit(pc) + liveDotW(st.nw, x, SET_ZCAP));
  const err = p - y;
  const pull = st.pull || 0.04, bound = st.bound || 0.22;
  for (let i = 0; i < x.length; i++) {
    if (!x[i]) continue;
    const w0 = st.nw0[i] || 0;
    let nw = (st.nw[i] || 0) - eta * err * x[i] - eta * pull * ((st.nw[i] || 0) - w0);
    const lo = w0 - bound, hi = w0 + bound;
    if (nw > hi) nw = hi; else if (nw < lo) nw = lo;
    if (nw > 1.5) nw = 1.5; else if (nw < -1.5) nw = -1.5;
    st.nw[i] = nw;
  }
  st.nseen.push(mk);
  if (st.nseen.length > 6000) st.nseen = st.nseen.slice(-6000);
  st.nn = (st.nn || 0) + 1;
  return true;
}
function liveSetStep(x, y, p0, mk) {
  const st = S.liveOn;
  if (!st || !st.sw || !x) return false;
  st.sseen = st.sseen || [];
  if (st.sseen.indexOf(mk) >= 0) return false;
  if (!x.some(v => v)) { st.sseen.push(mk); if (st.sseen.length > 6000) st.sseen = st.sseen.slice(-6000); return false; }
  const eta = (st.eta && st.eta.S) || 0.0025;
  const p = expit(logit(p0) + liveDotW(st.sw, x, SET_ZCAP));
  const err = p - y;
  const pull = st.pull || 0.04, bound = st.bound || 0.22;
  for (let i = 0; i < x.length; i++) {
    if (!x[i]) continue;
    const w0 = st.sw0[i] || 0;
    let nw = (st.sw[i] || 0) - eta * err * x[i] - eta * pull * ((st.sw[i] || 0) - w0);
    const lo = w0 - bound, hi = w0 + bound;
    if (nw > hi) nw = hi; else if (nw < lo) nw = lo;
    if (nw > 1.5) nw = 1.5; else if (nw < -1.5) nw = -1.5;
    st.sw[i] = nw;
  }
  st.sseen.push(mk);
  if (st.sseen.length > 6000) st.sseen = st.sseen.slice(-6000);
  st.sn = (st.sn || 0) + 1;
  return true;
}
function hbOf(winH, srvH) {
  if (srvH == null || !winH) return { hold: 0, brk: 0 };
  if ((winH === 1) === !!srvH) return { hold: winH === 1 ? 1 : -1, brk: 0 };
  return { hold: 0, brk: winH === 1 ? 1 : -1 };
}
/* ATP, WTA, Challenger: naučený model. Krok jen z gemu, brejku, setu nebo konce zápasu. */
function learnLive(e) {
  if (!liveMlOn(e) || e.det === 8) { if (e && e.det === 8) e._trk = null; return; }
  if (e.st === 3) { closeLive(e); return; }
  if (e.st !== 2 || e.stale || e._p == null) return;
  ensureX(e);
  const st = readLive(e);
  if (!st || !e._x) return;
  const sig = st.sa + ':' + st.sb + ':' + st.ga + ':' + st.gb;
  const tr = e._trk;
  if (!tr) {
    e._trk = { sig, st, gameSrv: (st.aPts === 0 && st.bPts === 0 && !st.inTB) ? st.aServes : null, hb: e._hb || { hold: 0, brk: 0 }, trail: [], setGames: [], prevNext: [] };
    return;
  }
  if (tr.sig === sig) {
    if (tr.gameSrv == null && st.aPts === 0 && st.bPts === 0 && !st.inTB) tr.gameSrv = st.aServes;
    return;
  }
  const prev = tr.st;
  const setsDelta = (st.sa + st.sb) - (prev.sa + prev.sb);
  const sameSets = st.sa === prev.sa && st.sb === prev.sb;
  const gamesDelta = (st.ga + st.gb) - (prev.ga + prev.gb);
  const fresh = st.ga === 0 && st.gb === 0;
  const gameUp = sameSets && gamesDelta === 1;
  const setUp = setsDelta === 1 && fresh;
  const done = (ga, gb) => (ga >= 6 && ga - gb >= 2) || (gb >= 6 && gb - ga >= 2) || (ga === 7 && gb === 6) || (gb === 7 && ga === 6);
  const id = liveIds(e);
  let hb = tr.hb || { hold: 0, brk: 0 };
  if ((setUp || gameUp) && id) {
    let stepped = false;
    let winH = 0, takeGame = gameUp;
    if (setUp) {
      winH = st.sa > prev.sa ? 1 : 2;
      const aWins = winH === 1;
      takeGame = !done(prev.ga, prev.gb) && done(aWins ? prev.ga + 1 : prev.ga, aWins ? prev.gb : prev.gb + 1);
    } else winH = st.ga > prev.ga ? 1 : 2;
    if (takeGame && winH) {
      const yG = (winH === 1) === id.aIsH ? 1 : 0;
      const srvH = tr.gameSrv;
      const sa = id.aIsH ? prev.sa : prev.sb, sb = id.aIsH ? prev.sb : prev.sa;
      const ga = id.aIsH ? prev.ga : prev.gb, gb = id.aIsH ? prev.gb : prev.ga;
      const srv = srvH == null ? 0 : (id.aIsH ? (srvH ? 1 : -1) : (srvH ? -1 : 1));
      const hold = id.aIsH ? hb.hold : -hb.hold, brk = id.aIsH ? hb.brk : -hb.brk;
      const x = livePhi(sa, sb, ga, gb, 0, 0, 0, 0, false, srv, hold, brk, liveDiffs(e, id.aIsH), liveCtx(e));
      const pA = id.aIsH ? e._p : 1 - e._p;
      if (liveStep(x, yG, pA, id.mk + '|G|' + sa + '|' + sb + '|' + ga + '|' + gb, (S.liveOn.eta && S.liveOn.eta.G) || 0.0012)) stepped = true;
      const xg = liveGamePhi(e, id, sa, sb, ga, gb, 0, 0, 0, 0, false, srv, hold, brk);
      if (liveGameStep(xg, yG, pA, id.mk + '|g|' + sa + '|' + sb + '|' + ga + '|' + gb)) stepped = true;
      e._lastGem = { w: winH };
      tr.trail.push({ x, p: pA, mk: id.mk + '|M|' + sa + '|' + sb + '|' + ga + '|' + gb });
      tr.setGames = tr.setGames || [];
      tr.setGames.push({
        xSet: liveSetPhi(e, id, sa, sb, ga, gb, 0, 0, 0, 0, false, srv, hold, brk),
        xNext: liveNextPhi(e, id, sa, sb, ga, gb, 0, 0, 0, 0, false, srv, hold, brk, pA),
        p: pA,
        mkSet: id.mk + '|sg|' + sa + '|' + sb + '|' + ga + '|' + gb,
        mkNext: id.mk + '|n|' + sa + '|' + sb + '|' + ga + '|' + gb,
        start: ga === 0 && gb === 0
      });
      hb = hbOf(winH, srvH);
      e._hb = hb;
    }
    if (setUp) {
      const wH = st.sa > prev.sa ? 1 : 2;
      const yS = (wH === 1) === id.aIsH ? 1 : 0;
      const sa = id.aIsH ? prev.sa : prev.sb, sb = id.aIsH ? prev.sb : prev.sa;
      const xs = livePhi(sa, sb, 0, 0, 0, 0, 0, 0, false, 0, 0, 0, liveDiffs(e, id.aIsH), liveCtx(e));
      const pA = id.aIsH ? e._p : 1 - e._p;
      if (liveStep(xs, yS, pA, id.mk + '|S|' + sa + '|' + sb, (S.liveOn.eta && S.liveOn.eta.S) || 0.0025)) stepped = true;
      const xset = liveSetPhi(e, id, sa, sb, 0, 0, 0, 0, 0, 0, false, 0, 0, 0);
      if (liveSetStep(xset, yS, pA, id.mk + '|s|' + sa + '|' + sb)) stepped = true;
      for (const g of (tr.setGames || [])) {
        if (!g.start && liveSetStep(g.xSet, yS, g.p, g.mkSet)) stepped = true;
      }
      for (const g of (tr.prevNext || [])) {
        if (liveNextStep(g.xNext, yS, g.p, g.mkNext)) stepped = true;
      }
      tr.prevNext = tr.setGames || [];
      tr.setGames = [];
    }
    if (stepped) { saveLive(); S.predGen++; }
  }
  const atBoundary = st.aPts === 0 && st.bPts === 0 && !st.inTB;
  e._trk = { sig, st, gameSrv: atBoundary ? st.aServes : null, hb, trail: tr.trail, setGames: tr.setGames || [], prevNext: tr.prevNext || [] };
}
function closeLive(e) {
  if (!e || e._liveClosed || e.det === 8 || (e.win !== 1 && e.win !== 2) || !liveMlOn(e)) return;
  const id = liveIds(e), tr = e._trk;
  if (!id || !tr || !tr.trail) { e._liveClosed = true; e._trk = null; return; }
  if (e._p == null) return;
  e._liveClosed = true;
  const y = (e.win === 1) === id.aIsH ? 1 : 0;
  const eta = (S.liveOn.eta && S.liveOn.eta.M) || 0.0035;
  let moved = false;
  for (const row of tr.trail) if (liveStep(row.x, y, row.p, row.mk, eta)) moved = true;
  if (moved) { saveLive(); S.predGen++; }
  e._trk = null;
}
function serveFit(e) {
  const bo = matchBestOf(e), s0 = e.g === 'W' ? 0.57 : 0.64;
  let fit = e._lfit;
  if (!fit || fit.p !== e._p || fit.bo !== bo || fit.s0 !== s0) { fit = fitServe(e._p, bo, s0); e._lfit = fit; }
  if (fit.pSet0 == null) fit.pSet0 = (pThisSet(0, 0, 0, 0, 0, 0, false, true, fit.pA, fit.pB) + pThisSet(0, 0, 0, 0, 0, 0, false, false, fit.pA, fit.pB)) / 2;
  return fit;
}
/* set i (1 = první) se ještě může hrát, když z dosavadních výher sa:sb jde oba udržet pod need */
function setReachable(i, sa, sb, need) {
  const t = (i - 1) - (sa + sb);
  if (t < 0) return false;
  const maxA = need - sa - 1, maxB = need - sb - 1;
  if (maxA < 0 || maxB < 0) return false;
  return Math.max(0, t - maxB) <= Math.min(t, maxA);
}
function setGuaranteed(i, sa, sb, need) {
  const t = (i - 1) - (sa + sb);
  return t >= 0 && sa + t < need && sb + t < need;
}
/* LIVEPRED_END */

function setRowPct(n, na, nb, p, tag) {
  return `<div class="setrow"><span class="n">${n}. set${tag ? `<small>${tag}</small>` : ''}</span><span><b class="a">${pct(p)}</b><small class="nm">${esc(na)}</small></span><span class="r"><b class="b">${pct(1 - p)}</b><small class="nm">${esc(nb)}</small></span></div>`;
}
function setPredHtml(e, na, nb) {
  if (e._p == null || !(e._p > 0) || !(e._p < 1) || e.st === 3) return '';
  const fit = serveFit(e);
  const verb = e.g === 'W' ? 'vyhrála' : 'vyhrál';
  const live = e.st === 2 && !e.stale ? readLive(e) : null;
  if (!live) {
    const tag = e.st === 2 ? 'bez skóre' : 'z 0:0';
    let base = null;
    if (setModelOn(e) && e.st !== 2) base = liveSetP(e, 0, 0, 0, 0, 0, 0, 0, 0, false, 0, 0, 0);
    if (base == null) base = fit.pSet0;
    const d = marketOn(e) && e._d ? e._d : 0;
    const p = (typeof MK !== 'undefined' && d) ? MK.show(base, MK.SET_SCALE * d) : base;
    const note = e.st === 2 ? '' : (setModelOn(e)
      ? '<p class="note">Šance na 1. set je vlastní číslo, ne šance na zápas. Před zápasem se zápas i set posunou podle kurzů a podle zpráv o odhlášení nebo zranění, jakmile přijdou. Naučený posun jde do dalších zápasů. Bez kurzu zůstává model.</p>'
      : '<p class="note">1. set z 0:0, stejný bodový model jako zápas. Není to zvlášť trénovaný model setů.</p>');
    return `<div class="setpreds"><div class="predlab">Kdo bere set</div>${setRowPct(1, na, nb, p, tag)}${note}</div>`;
  }
  const need = (fit.bo + 1) / 2;
  const sets = (e.sets || []).filter(s => s && +s[0] >= 0 && +s[1] >= 0);
  const done = [];
  for (let i = 0; i < sets.length; i++) {
    const w = setWinner(sets[i]);
    const last = i === sets.length - 1;
    if (w && (!last || live.between)) done.push(w);
    else if (!last) { if (+sets[i][0] > +sets[i][1]) done.push(1); else if (+sets[i][1] > +sets[i][0]) done.push(2); }
  }
  const lines = done.map((w, i) => `<div class="setrow"><span class="n">${i + 1}. set</span><span class="win">${verb} ${esc(w === 1 ? na : nb)}</span></div>`);
  const curN = done.length + 1;
  const pNow = (st, aServes) => pThisSet(st.ga, st.gb, st.aPts, st.bPts, st.tbA, st.tbB, st.inTB, aServes, fit.pA, fit.pB);
  for (let i = curN; i <= fit.bo; i++) {
    if (!setReachable(i, live.sa, live.sb, need)) continue;
    const sure = setGuaranteed(i, live.sa, live.sb, need);
    if (i === curN) {
      let p;
      const hb = e._hb || { hold: 0, brk: 0 };
      const srvH = live.aServes == null ? 0 : (live.aServes ? 1 : -1);
      if (setModelOn(e)) {
        p = live.between ? liveSetP(e, live.sa, live.sb, 0, 0, 0, 0, 0, 0, false, srvH, 0, 0)
          : liveSetP(e, live.sa, live.sb, live.ga, live.gb, live.aPts, live.bPts, live.tbA, live.tbB, live.inTB, srvH, hb.hold, hb.brk);
      }
      if (p == null) {
        if (live.between) p = live.aServes == null ? fit.pSet0 : pThisSet(0, 0, 0, 0, 0, 0, false, live.aServes, fit.pA, fit.pB);
        else p = live.aServes == null ? (pNow(live, true) + pNow(live, false)) / 2 : pNow(live, live.aServes);
      }
      lines.push(setRowPct(i, na, nb, p, live.between ? 'z 0:0' : 'teď'));
    } else if (i === curN + 1 && nextModelOn(e)) {
      const p = liveNextP(e, live);
      lines.push(setRowPct(i, na, nb, p == null ? fit.pSet0 : p, sure ? 'podle skóre' : 'když bude'));
    } else if (setModelOn(e)) {
      const p = liveSetP(e, 0, 0, 0, 0, 0, 0, 0, 0, false, 0, 0, 0);
      lines.push(setRowPct(i, na, nb, p == null ? fit.pSet0 : p, sure ? 'z 0:0' : 'když bude'));
    } else lines.push(setRowPct(i, na, nb, fit.pSet0, sure ? 'z 0:0' : 'když bude'));
  }
  const note = setModelOn(e) ? 'Šance na hraný set i na další set se učí z gemů, bodů, brejků a síly soupeře. Po dohraném setu se přenese do dalšího zápasu.' : 'Teď hraný set ze skóre, další z 0:0. Stejný bodový model, ne samostatný model setů.';
  return `<div class="setpreds"><div class="predlab">Kdo bere set</div>${lines.join('')}<p class="note">${note}</p></div>`;
}
function gamePredHtml(e, na, nb) {
  if (!liveMlOn(e) || e.st !== 2 || e.stale || e._p == null) return '';
  const st = readLive(e);
  if (!st) return '';
  const p = liveGameProb(e, st);
  if (p == null) return '';
  const lab = st.inTB ? 'Tiebreak teď' : 'Gem teď';
  const row = `<div class="setrow"><span class="n">${lab}</span><span><b class="a">${pct(p)}</b><small class="nm">${esc(na)}</small></span><span class="r"><b class="b">${pct(1 - p)}</b><small class="nm">${esc(nb)}</small></span></div>`;
  let w = e._lastGem && e._lastGem.w;
  if (!w && st.between) {
    const sets = (e.sets || []).filter(s => s && +s[0] >= 0 && +s[1] >= 0);
    for (let i = sets.length - 1; i >= 0; i--) { const sw = setWinner(sets[i]); if (sw) { w = sw; break; } }
  }
  const verb = e.g === 'W' ? 'vyhrála' : 'vyhrál';
  const last = w ? `<div class="setrow"><span class="n">Minulý gem</span><span class="win">${verb} ${esc(w === 1 ? na : nb)}</span></div>` : '';
  const bits = [];
  if (st.aServes == null) bits.push('Podání neznáme, bereme obě možnosti.');
  if (!st.pointsKnown && !st.between) bits.push('Body v gemu nemáme, bereme gemy a podání.');
  return `<div class="setpreds"><div class="predlab">${lab}</div>${row}${last}<p class="note">Stejné vstupy jako živá predikce zápasu (skóre, podání, brejk nebo udržení, předzápasová síla). Po každém dohraném gemu se posune.${bits.length ? ' ' + bits.join(' ') : ''}</p></div>`;
}


function predInner(e, na, nb) {
  const pre = `<div class="predlab pre">${TITLE_MODEL}</div><div class="big2"><div><b class="a">${pct(e._p)}</b><small>${esc(na)}</small></div><div><b class="b">${pct(1 - e._p)}</b><small>${esc(nb)}</small></div></div><div class="bar lg"><i style="width:${(e._p * 100).toFixed(1)}%"></i></div><p class="plab">${LAB_MODEL}</p>`;
  if (e.st !== 2) return rawOnlyHtml(e, na, nb);
  const L = liveProb(e);
  if (!L || !L.ok) return pre + setPredHtml(e, na, nb) + '<p class="note">Živé skóre teď nemáme, platí jen předzápasová predikce.</p>';
  const bits = [];
  if (!L.serverKnown) bits.push('Podání neznáme, obě možnosti bereme stejně.');
  if (!L.pointsKnown) bits.push(L.between ? 'Set skončil, další ještě nemá skóre — bereme jen sety.' : 'Body v gemu nemáme, bereme jen sety a gemy.');
  return `<div class="predlab now">Predikce teď</div><div class="big2"><div><b class="a">${pct(L.p)}</b><small>${esc(na)}</small></div><div><b class="b">${pct(1 - L.p)}</b><small>${esc(nb)}</small></div></div><div class="bar lg"><i style="width:${(L.p * 100).toFixed(1)}%"></i></div>${pre}<p class="note">${L.ml ? 'Z předzápasové šance, síly hráčů a skóre (sety, gemy, body, podání, brejk nebo udržení). Na 0:0 zůstává předzápasová. Po gemu, brejku, setu a po dohrání se posune.' : 'Z předzápasové šance a skóre. Bodový výpočet, na 0:0 je předzápasová.'} ${bits.join(' ')}</p>${gamePredHtml(e, na, nb)}${setPredHtml(e, na, nb)}`;
}
function predNote(e) {
  if (e.st !== 2 || e._p == null) return '';
  const L = liveProb(e);
  if (!L || !L.ok) return '<div class="note" id="d-prednote">Živé skóre teď nemáme, platí jen předzápasová predikce. Podrobný rozpis níže je předzápasový.</div>';
  const extra = [!L.serverKnown ? 'Podání neznáme, obě možnosti bereme stejně.' : '', !L.pointsKnown ? 'Body v gemu nemáme, bereme jen sety a gemy.' : ''].filter(Boolean).join(' ');
  return `<div class="note" id="d-prednote"><b>Predikce teď ${pct(L.p)} : ${pct(1 - L.p)}</b> · Před zápasem ${pct(e._p)} : ${pct(1 - e._p)}. ${L.ml ? 'U ATP, WTA a Challengeru vychází z předzápasové šance a skóre a posune se po gemu, brejku, setu a po dohrání. U stejných zápasů je pod tím i odhad, kdo vezme hraný gem, a ten se po každém gemu posune stejně. Na 0:0 je předzápasová.' : 'Bodový výpočet ze skóre. Na 0:0 je předzápasová.'} ${extra}Podrobný rozpis níže je pořád předzápasový.</div>`;
}
function paintLivePred(e) {
  if (!S.detail || S.byId[S.detail.id] !== e || e._p == null || e.st === 3) return;
  const r = resolveEv(e), na = dispName(r.hi, e.h), nb = dispName(r.ai, e.a);
  const box = document.getElementById('d-predblock');
  if (box) box.innerHTML = (S.detail.tab === 'predikce' && e.st === 1) ? bothPrematchHtml(e, na, nb) : predInner(e, na, nb);
  const note = document.getElementById('d-prednote');
  if (note) note.outerHTML = predNote(e);
}

function probHtml(e) {
  if (e.st === 3 || e._p == null) return '';
  const p = e._p;
  return `<div class="predlab">${TITLE_MODEL}</div><div class="pb"><span class="pa ${p >= 0.5 ? 'fv' : ''}">${pct(p)}</span><div class="bar"><i style="width:${(p * 100).toFixed(1)}%"></i></div><span class="pc ${p < 0.5 ? 'fv' : ''}">${pct(1 - p)}</span></div><p class="plab">${LAB_MODEL}</p>`;
}
function mrowHtml(e) {
  const r = resolveEv(e);
  const pl = (i, p, side) => `<div class="pl ${e.win === side + 1 ? 'win' : ''} ${e.st === 3 && e.win && e.win !== side + 1 ? 'lose' : ''}">${flagImg(p.c || pC(i))}<span class="nm">${esc(dispName(i, p))}${(side ? r.au : r.hu) ? '<small class="unk">?</small>' : ''}${isFav(i) ? '<small class="fs">★</small>' : ''}</span><span class="sc">${scoreCells(e, side)}</span></div>`;
  return `<div class="pls">${pl(r.hi, e.h, 0)}${pl(r.ai, e.a, 1)}</div><div class="stc">${statusCell(e)}</div>`;
}
function rowHtml(e) {
  const r = resolveEv(e); const fav = isFav(r.hi) || isFav(r.ai);
  return `<div class="mr ${e.st === 2 && !e.stale ? 'islive' : ''} ${fav ? 'isfav' : ''}" data-ev="${esc(e.id)}"${e.fsid ? ` data-fs="${esc(e.fsid)}"` : ''}>
    <div class="mrow">${mrowHtml(e)}</div>${probHtml(e)}${oddsHtml(e)}</div>`;
}
function groupOrder(list) {
  const groups = new Map();
  for (const e of list) { const k = e.tname + '|' + e.g + '|' + e.q + '|' + e.code; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); }
  const so = e => (e.st === 2 && !e.stale ? 0 : e.st === 1 ? 1 : 2);
  const arr = [...groups.values()].map(g => g.sort((a, b) => so(a) - so(b) || (so(a) === 2 ? b.ts - a.ts : a.ts - b.ts)));
  arr.sort((a, b) => (b.some(e => e.st === 2 && !e.stale) - a.some(e => e.st === 2 && !e.stale)) || (b[0].code - a[0].code) || a[0].tname.localeCompare(b[0].tname) || a[0].q - b[0].q);
  return arr;
}
function groupsHtml(list) {
  return groupOrder(list).map(g => { const e = g[0]; const [bt, bc] = badge(e);
    return `<section class="tg"><div class="th"><div><div class="tn">${esc(e.tname.toUpperCase())}${e.country ? ` <small>${esc(e.country)}</small>` : ''}</div>
      <div class="ts">${esc(catLabel(e))} · ${SURF_CS[e.surface] || e.surface} · ${e.g === 'M' ? 'Muži' : 'Ženy'}${e.q ? ' · Kvalifikace' : ''}</div></div><span class="tb ${bc}">${bt}</span></div>
      ${g.map(rowHtml).join('')}</section>`; }).join('');
}
function passFilt(e, f) {
  if (f === 'live') return e.st === 2 && !e.stale; if (f === 'pre') return e.st === 1; if (f === 'fin') return e.st === 3;
  if (f === 'value') { const v = valueOf(e); return !!(v && v.side); } return true;
}

/* ---------- ZÁPASY ---------- */
function matchSel() {
  const F = S.filt;
  const dayEv = (S.all || []).filter(e => dayOff(e.ts) === F.day || (F.day === 0 && e.st === 2 && !e.stale && dayOff(e.ts) === -1));
  const base = dayEv.filter(e => F.tour === 'all' || tourGrp(e) === F.tour).filter(e => !F.favOnly || isFav(resolveEv(e).hi) || isFav(resolveEv(e).ai));
  return { dayEv, base };
}
function matchListIds() {   // pořadí řádků, jak by je vykreslil renderMatches (pro rozhodnutí záplata vs. překreslení)
  const { base } = matchSel(); const list = base.filter(e => passFilt(e, S.filt.st));
  return groupOrder(list).flat().map(e => e.id);
}
async function renderMatches(keep) {
  const v = $('#v-zapasy'); const F = S.filt; const y = keep ? window.scrollY : 0;
  const seq = (S.rendN = (S.rendN || 0) + 1);
  const { dayEv, base } = matchSel();
  await probsFor(base.filter(e => e.st !== 3));
  if (seq !== S.rendN || !v) return;
  const list = base.filter(e => passFilt(e, F.st));
  const nLive = dayEv.filter(e => e.st === 2 && !e.stale).length;
  const tabs = [-2, -1, 0, 1, 2].map(d => `<button class="dtab ${F.day === d ? 'on' : ''}" data-day="${d}"><b>${esc(dayLabel(d))}</b><small>${dateSub(d)}</small></button>`).join('');
  let h = `<div class="ph"><h1>ZÁPASY</h1>${nLive ? `<span class="livec"><i class="dot"></i>${nLive} živě</span>` : ''}</div>
   <div class="dtabs">${tabs}</div>
   <div class="ctl"><label class="sel"><span>OKRUHY</span><select id="f-tour">${TOURS.map(([k, t]) => `<option value="${k}" ${F.tour === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
   <label class="sel"><span>FILTR</span><select id="f-st">${FILTS.map(([k, t]) => `<option value="${k}" ${F.st === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
   <button class="favt ${F.favOnly ? 'on' : ''}" id="f-fav" aria-label="Jen oblíbení">${F.favOnly ? '★' : '☆'}</button></div>`;
  if (!S.all) h += '<div class="empty">Načítám zápasy…</div>';
  else if (!list.length) h += `<div class="empty">Žádné zápasy pro tento výběr.${F.favOnly ? '<br><small>Přidejte si hráče do oblíbených hvězdičkou v detailu zápasu.</small>' : ''}</div>`;
  else h += groupsHtml(list);
  const sc = S.live.srcCount || {};
  h += `<p class="note">Zdroje: ${Object.entries(sc).map(([k, n]) => `${k === 'snapshot' ? 'snímek z buildu ' + esc(S.live.snapshot || '') : k} (${n})`).join(', ') || '—'}. Živé skóre: ATP/WTA z ESPN (~15 s), body a gemy z 365scores (~8 s)${S.live.sofa ? ', ITF ze Sofascore (~20 s)' : ', ITF jen ze snímku buildu (Sofascore z této sítě neodpovídá)'}. Kurzy (Tipsport, iFortuna, Chance, Betano) se u nadcházejícího zápasu ATP, WTA, Challengeru a grandslamu berou každých 20 s a posouvají šanci na zápas i na 1. set. Zprávy o odhlášení a zranění jdou z ESPN. VALUE zůstává z čistého modelu a předzápasového kurzu. ITF se podle kurzů neposouvá. U živého zápasu je v detailu i „Predikce teď“ ze skóre.</p>
   <p class="note gam">18+ Kurzy slouží jen pro srovnání s modelem. Sázení je riskantní a může vést k závislosti – hrajte zodpovědně, jen s penězi, které si můžete dovolit prohrát.</p>`;
  v.innerHTML = h;
  if (keep) window.scrollTo(0, y);
  observeOdds(v);
}
/* kurzy: nadcházející ATP/WTA/Challenger/slam a živé zápasy každých 20 s, ostatní viditelné řádky ~60 s */
const ODDS_VIS_TTL = 60000, ODDS_OPEN_TTL = 20000;
let oddsObs = null;
function oddsEvery(e) { if (!e) return ODDS_VIS_TTL; if (e.st === 2) return ODDS_LIVE_TTL; if (e.st === 1 && e.code >= 3) return ODDS_OPEN_TTL; return ODDS_VIS_TTL; }
function onOdds(e) { if (!e) return; try { syncMarket(e); } catch (err) {} updateRowOdds(e); updateRowProb(e); if (S.detail && S.detail.id === e.id) { refreshDetailOdds(e); paintLivePred(e); } }
function observeOdds(root) {
  if (!('IntersectionObserver' in window)) return;
  if (!oddsObs) oddsObs = new IntersectionObserver(ents => { for (const en of ents) { const id = en.target.dataset.ev;
      if (!en.isIntersecting) { S.visible.delete(id); continue; }
      S.visible.add(id); const e = S.byId[id]; if (!e || e.st === 3 || !e.fsid) continue;
      const ttl = oddsEvery(e);
      if (e.st === 2 ? (e.oddsV && e.oddsV.inplay && Date.now() - e.oddsV.t < ttl) : (e.oddsV && e.oddsV.live && Date.now() - e.oddsV.t < ttl)) continue;
      fetchOdds(e, false, ttl).then(() => onOdds(e)); } }, { rootMargin: '150px' });
  for (const el of root.querySelectorAll('.mr[data-fs]')) oddsObs.observe(el);
}
function oddsTick() {
  if (document.hidden || !S.all) return;
  const want = e => { if (!e || !e.fsid || e.st === 3) return 0; const ttl = oddsEvery(e); if (e.st === 2) return !(e.oddsV && e.oddsV.inplay) || Date.now() - e.oddsV.t >= ttl; return !e.oddsV || !e.oddsV.live || Date.now() - e.oddsV.t >= ttl; };
  if (S.detail) { const e = S.byId[S.detail.id]; if (want(e) || (e && e.fsid && e.st === 1 && S.detail.tab === 'kurzy')) fetchOdds(e, true, oddsEvery(e)).then(() => onOdds(e)); }
  const v = (location.hash || '#zapasy').slice(1);
  if (v !== 'zapasy' && v !== 'oblibene' && !S.detail) return;
  for (const id of [...S.visible]) { const e = S.byId[id]; if (!want(e)) continue;
    if (!document.querySelector(`.mr[data-ev="${CSS.escape(id)}"]`)) { S.visible.delete(id); continue; }
    fetchOdds(e, false, oddsEvery(e)).then(() => onOdds(e)); }
}
/* plynulá změna čísla (bez skoku) */
function tweenNum(el, to) {
  const from = parseFloat(el.textContent); if (!(from > 0) || Math.abs(from - to) < 0.005) { el.textContent = to.toFixed(2); return; }
  const t0 = performance.now(), D = 600;
  const step = t => { const k = Math.min(1, (t - t0) / D), ez = 1 - Math.pow(1 - k, 3); el.textContent = (from + (to - from) * ez).toFixed(2); if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
function flash(el, dir) { if (!dir || !el) return; el.classList.remove('fl-up', 'fl-dn'); void el.offsetWidth; el.classList.add(dir > 0 ? 'fl-up' : 'fl-dn'); }
function updateRowProb(e) {
  if (!e) return;
  const p = e._p;
  for (const el of document.querySelectorAll(`.mr[data-ev="${CSS.escape(e.id)}"]`)) {
    const pb = el.querySelector('.pb');
    if (!pb || p == null) continue;
    const pa = pb.querySelector('.pa'), pc = pb.querySelector('.pc'), bar = pb.querySelector('.bar i');
    if (pa) { pa.textContent = pct(p); pa.classList.toggle('fv', p >= 0.5); }
    if (pc) { pc.textContent = pct(1 - p); pc.classList.toggle('fv', p < 0.5); }
    if (bar) bar.style.width = (p * 100).toFixed(1) + '%';
  }
}
function updateRowOdds(e) {
  const o = e.oddsV;
  for (const el of document.querySelectorAll(`.mr[data-ev="${CSS.escape(e.id)}"]`)) {
    const box = el.querySelector('.odds'); const nh = oddsHtml(e);
    if (!box) { if (nh) el.insertAdjacentHTML('beforeend', nh); continue; }
    if (!nh) { box.remove(); continue; }
    if (box.classList.contains('ph') || !o || !o.avg) { const tmp = document.createElement('div'); tmp.innerHTML = nh; const nb = tmp.firstElementChild; nb.classList.add('fade-in'); box.replaceWith(nb); continue; }
    // inkrementální aktualizace: jen čísla, šipky a třídy
    const v = valueOf(e);
    for (const k of [1, 2]) {
      const pill = box.querySelector(`.od[data-k="${k}"]`); if (!pill) continue;
      tweenNum(pill.querySelector('.v'), o.avg[k - 1]);
      const tmp = document.createElement('span'); tmp.innerHTML = arrowOf(o, k - 1); const cur = pill.querySelector('.ars') || pill.querySelector('.ar'); if (cur) cur.replaceWith(tmp.firstElementChild);
      const isVal = !!(v && v.side === k); pill.classList.toggle('val', isVal);
      const em = pill.querySelector('em'); if (isVal && !em) pill.insertAdjacentHTML('beforeend', '<em>VALUE</em>'); if (!isVal && em) em.remove();
      if (o.chg) flash(pill, o.chg[k - 1]);
    }
    const ol = box.querySelector('.ol'); if (ol) ol.innerHTML = oddsLabel(o);
  }
  // filtr VALUE drží řádek i potom, co čerstvý předzápasový kurz spadne pod práh
  if (S.filt.st === 'value' && !S.detail && (location.hash || '#zapasy').slice(1) === 'zapasy') {
    const listed = !!document.querySelector(`#v-zapasy .mr[data-ev="${CSS.escape(e.id)}"]`);
    if (listed !== passFilt(e, 'value') && !S.refilt) { S.refilt = true; renderMatches(true).finally(() => { S.refilt = false; }); }
  }
}
function refreshDetailOdds(e) {
  if (!S.detail || S.byId[S.detail.id] !== e) return;
  if (S.detail.tab === 'kurzy') { const r = resolveEv(e); const body = $('#d-body'); const y = $('#detail').scrollTop;
    body.innerHTML = oddsTab(e, dispName(r.hi, e.h), dispName(r.ai, e.a)); $('#detail').scrollTop = y; }
  else if (S.detail.tab === 'prehled') { const y = $('#detail').scrollTop; showDTab('prehled'); $('#detail').scrollTop = y; }
}
/* živá změna skóre: pokud se nezměnilo pořadí/sada zápasů, jen se „záplatují“ změněné řádky */
/* jen skóre a stav řádku — jména a fotky se nepřekreslují, ať bod v gemu neblikne celou stránkou */
function patchMatchRow(el, e) {
  const sc = el.querySelectorAll('.pls .sc');
  if (sc.length !== 2) return false;
  for (let side = 0; side < 2; side++) {
    const h = scoreCells(e, side);
    if (sc[side]._h !== h) { sc[side].innerHTML = h; sc[side]._h = h; }
  }
  const stc = el.querySelector('.stc'), st = statusCell(e);
  if (stc && stc._h !== st) { stc.innerHTML = st; stc._h = st; }
  el.classList.toggle('islive', e.st === 2 && !e.stale);
  el.querySelectorAll('.pls .pl').forEach((pl, side) => {
    pl.classList.toggle('win', e.win === side + 1);
    pl.classList.toggle('lose', !!(e.st === 3 && e.win && e.win !== side + 1));
  });
  if (e.st === 3) { el.querySelector('.pb')?.remove(); el.querySelector('.odds')?.remove(); }
  return true;
}
function patchDetailScore(e) {
  const sc = $('#d-score'); if (!sc) return;
  const h = scoreBlock(e);
  if (sc._h !== h) { sc.innerHTML = h; sc._h = h; }
  const table = document.querySelector('#d-body table.st');
  if (!table || S.detail.tab !== 'prehled') return;
  const r = resolveEv(e), na = dispName(r.hi, e.h), nb = dispName(r.ai, e.a);
  const html = `<tr><th></th>${e.sets.map((s, k) => `<th>${k + 1}.</th>`).join('')}</tr>` + [0, 1].map(sd => `<tr><td>${esc(sd ? nb : na)}</td>${e.sets.map(s => `<td class="${s[sd] > s[1 - sd] ? 'w' : ''}">${s[sd]}${s.length > 2 && Math.min(s[0], s[1]) >= 6 ? `<sup>${s[2 + sd]}</sup>` : ''}</td>`).join('')}</tr>`).join('');
  if (table._h !== html) { table.innerHTML = html; table._h = html; }
}
function onLiveChange(newFin) {
  const v = (location.hash || '#zapasy').slice(1);
  if (v === 'zapasy' && !document.querySelector('select:focus')) {
    const ids = [...document.querySelectorAll('#v-zapasy .mr')].map(x => x.dataset.ev);
    const want = matchListIds();
    // stejná sada řádků (i když by se změnilo řazení) -> jen skóre na místě, bez překreslení seznamu
    if (ids.length && ids.length === want.length && ids.slice().sort().join('|') === want.slice().sort().join('|')) {
      for (const el of document.querySelectorAll('#v-zapasy .mr')) { const e = S.byId[el.dataset.ev]; if (!e) continue;
        if (!patchMatchRow(el, e)) { const h = mrowHtml(e); const mr = el.querySelector('.mrow'); if (mr && mr._h !== h) { mr.innerHTML = h; mr._h = h; } } }
      const nLive = matchSel().dayEv.filter(e => e.st === 2 && !e.stale).length, ph = $('#v-zapasy .ph'), lc = ph && ph.querySelector('.livec');
      if (ph) { if (nLive && lc) lc.innerHTML = `<i class="dot"></i>${nLive} živě`; else if (nLive) ph.insertAdjacentHTML('beforeend', `<span class="livec"><i class="dot"></i>${nLive} živě</span>`); else if (lc) lc.remove(); }
    } else renderMatches(true);
  }
  if (v === 'oblibene') {
    const have = [...document.querySelectorAll('#v-oblibene .mr')].map(x => x.dataset.ev).sort().join('|');
    const fav = [...S.fav.values()].map(f => favIdx(f)).filter(x => x !== null);
    const want = (S.all || []).filter(e => { const r = resolveEv(e); return fav.includes(r.hi) || fav.includes(r.ai); }).map(e => e.id).sort().join('|');
    if (have && have === want) { for (const el of document.querySelectorAll('#v-oblibene .mr')) { const e = S.byId[el.dataset.ev]; if (e) patchMatchRow(el, e); } }
    else renderFav();
  }
  if (S.detail) { const e = S.byId[S.detail.id]; if (e) {
    const becameFin = e.st === 3 && e._seenSt !== 3;
    e._seenSt = e.st;
    patchDetailScore(e);
    if (becameFin && S.detail.tab !== 'kurzy' && S.detail.tab !== 'h2h') showDTab(S.detail.tab);
    else if (e.st !== 3) paintLivePred(e);
  } }
  if (newFin && v === 'hraci' && S.profI != null && $('#hp .prof')) showProfile(S.profI, $('#hp'), true);
  for (const id of new Set([...S.visible, ...(S.detail ? [S.detail.id] : [])])) { const e = S.byId[id];
    if (e && e.st === 2 && e.fsid && !(e.oddsV && e.oddsV.inplay)) fetchOdds(e, true, ODDS_LIVE_TTL).then(() => { updateRowOdds(e); if (S.detail && S.detail.id === id) refreshDetailOdds(e); }); }
}
function updateStatus() {
  const st = $('#status'); if (!st || !S.meta) return;
  if (!S.liveReady) { st.innerHTML = `<i class="dot off"></i>Snímek zápasů · doplňuji živé skóre… · data do ${fmtDate(S.meta.day_end)}`; return; }
  const L = S.live; const t = L.last ? new Date(L.last).toLocaleTimeString('cs-CZ') : '—';
  const X = S.l365, last = Math.max(L.last || 0, X.last || 0), ok = (L.espn && !L.err) || (X.ok && !X.err);
  st.innerHTML = `${ok ? '<i class="dot"></i>Živě' : '<i class="dot off"></i>Offline'} · aktualizováno ${last ? new Date(last).toLocaleTimeString('cs-CZ') : t} · data do ${fmtDate(S.meta.day_end)}`;
}

/* ---------- detail zápasu ---------- */
function scoreBlock(e) {
  const hs = e.sets.filter((s, k) => (e.st === 3 || k < e.sets.length - 1) && s[0] > s[1]).length, as = e.sets.filter((s, k) => (e.st === 3 || k < e.sets.length - 1) && s[1] > s[0]).length;
  const big = e.st === 1 ? `<div class="big t">${hm(e.ts)}</div>` : `<div class="big">${hs}<span>:</span>${as}</div>`;
  const sets = e.sets.map(s => `${s[0]}–${s[1]}${s.length > 2 && Math.min(s[0], s[1]) >= 6 ? `<sup>${Math.min(s[2], s[3])}</sup>` : ''}`).join('  ');
  const stt = e.st === 2 && !e.stale ? `<span class="lv"><i class="play">▶</i>${esc(e.live || 'Živě')}${e.pts ? ` · gem ${e.srv === 1 ? '<i class="svd">●</i>' : ''}${esc(e.pts[0])}:${esc(e.pts[1])}${e.srv === 2 ? '<i class="svd">●</i>' : ''}` : ''}</span>` : e.st === 3 ? finLabel(e) : e.stale ? 'bez živých dat' : new Date(e.ts * 1000).toLocaleDateString('cs-CZ', { weekday: 'long', day: 'numeric', month: 'numeric' });
  return `${big}<div class="sets">${sets}</div><div class="dst">${stt}</div>`;
}
const DTABS = [['prehled', 'Přehled'], ['predikce', 'Predikce'], ['kurzy', 'Kurzy'], ['h2h', 'H2H'], ['stat', 'Statistiky']];
async function openEvent(id, tab) {
  const e = S.byId[id]; if (!e) return;
  const r = resolveEv(e); await ensure([r.hi, r.ai]); await probsFor([e]);
  const [bt, bc] = badge(e);
  const pside = (i, p) => `<div class="dp">${avatar(i, p.eid, 'lg')}<div class="dn" data-prof="${i}">${flagImg(p.c || pC(i))} ${esc(dispName(i, p))}</div><div class="dr">${i < S.N && S.idx.r[i] ? '#' + S.idx.r[i] : 'bez rankingu'}</div>${starBtn(i)}</div>`;
  $('#detail').innerHTML = `<div class="dhead"><div class="dtop"><button class="back" aria-label="Zpět">‹</button><div class="dtt"><b>${esc(e.tname.toUpperCase())}</b><small>${esc(catLabel(e))} · ${SURF_CS[e.surface]} · ${e.g === 'M' ? 'Muži' : 'Ženy'}${e.q ? ' · Kval.' : ''}${e.round ? ' · ' + esc(e.round) : ''}</small></div><span class="tb ${bc}">${bt}</span></div>
    <div class="dpl">${pside(r.hi, e.h)}<div class="dsc" id="d-score">${scoreBlock(e)}</div>${pside(r.ai, e.a)}</div>
    <div class="dtabs2">${DTABS.map(([k, t]) => `<button data-dtab="${k}">${t}</button>`).join('')}</div></div><div class="dbody" id="d-body"></div>`;
  $('#detail').hidden = false; document.body.classList.add('noscroll');
  if (!S.detail) history.pushState({ detail: 1 }, '');
  S.detail = { id }; $('#detail').scrollTop = 0;
  showDTab(tab || 'prehled');
  if (e.fsid && e.st !== 3) fetchOdds(e, true).then(() => { if (!(S.detail && S.detail.id === id)) return; try { syncMarket(e); } catch (err) {} if (S.detail.tab === 'prehled' || S.detail.tab === 'predikce') showDTab(S.detail.tab); updateRowOdds(e); updateRowProb(e); });
}
function closeDetail(fromPop) { if (!S.detail) return; S.detail = null; $('#detail').hidden = true; document.body.classList.remove('noscroll'); if (!fromPop) history.back(); }
async function showDTab(k) {
  const e = S.byId[S.detail.id]; S.detail.tab = k; const r = resolveEv(e); const body = $('#d-body');
  for (const b of document.querySelectorAll('[data-dtab]')) b.classList.toggle('on', b.dataset.dtab === k);
  const na = dispName(r.hi, e.h), nb = dispName(r.ai, e.a);
  if (k === 'prehled') {
    const v = valueOf(e);
    let h = '';
    if (e.st !== 3 && e._p != null) h += `<div class="card"><div id="d-predblock">${predInner(e, na, nb)}</div>
      ${e.oddsV && e.oddsV.avg ? `<div class="kv2"><span>${e.oddsV.inplay ? 'Živý kurz (průměr)' : 'Průměrný kurz'}</span><b>${e.oddsV.avg[0].toFixed(2)} / ${e.oddsV.avg[1].toFixed(2)}</b><span>${e.st === 1 ? 'Trh (bez marže)' : 'Před zápasem'}</span><b>${e.st === 1 && v ? pct(v.im) + ' / ' + pct(1 - v.im) : e.oddsPrem && e.oddsPrem.avg ? e.oddsPrem.avg[0].toFixed(2) + ' / ' + e.oddsPrem.avg[1].toFixed(2) : '—'}</b></div>${v && v.side ? `<div class="valbox">VALUE: ${esc(v.side === 1 ? na : nb)} – model o ${(Math.abs(v.edge) * 100).toFixed(1)} p. b. výš než předzápasový trh</div>` : ''}` : e.fsid && e.st !== 3 ? '<p class="note">Načítám kurzy…</p>' : ''}
      <div class="row"><button class="btn sec" data-dtab="predikce">Podrobná predikce ›</button><button class="btn ai" data-ask="${esc(e.id)}">✦ Zeptat se AI</button></div></div>`;
    if (e.st === 3) h += `<div class="card"><h3>Výsledek</h3><p><b>${esc(e.win === 1 ? na : nb)}</b> vyhrál${e.g === 'W' ? 'a' : ''} ${e.sets.map(s => e.win === 1 ? `${s[0]}–${s[1]}` : `${s[1]}–${s[0]}`).join(', ')}${e.det === 8 ? ' (skreč)' : ''}.</p></div>`;
    if (e.sets.length) h += `<div class="card"><h3>Sety</h3><table class="st"><tr><th></th>${e.sets.map((s, k) => `<th>${k + 1}.</th>`).join('')}</tr>${[0, 1].map(sd => `<tr><td>${esc(sd ? nb : na)}</td>${e.sets.map(s => `<td class="${s[sd] > s[1 - sd] ? 'w' : ''}">${s[sd]}${s.length > 2 && Math.min(s[0], s[1]) >= 6 ? `<sup>${s[2 + sd]}</sup>` : ''}</td>`).join('')}</tr>`).join('')}</table></div>`;
    h += `<div class="card"><h3>Zápas</h3><div class="kv2"><span>Turnaj</span><b>${esc(e.tname)}${e.country ? ', ' + esc(e.country) : ''}</b><span>Kategorie</span><b>${esc(catLabel(e))}${e.q ? ' – kvalifikace' : ''}</b>
      <span>Povrch</span><b>${SURF_CS[e.surface]}</b><span>Začátek</span><b>${new Date(e.ts * 1000).toLocaleString('cs-CZ', { weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })}</b>
      <span>Zdroj dat</span><b>${esc(e.src === 'snapshot' ? 'snímek z buildu (Flashscore) ' + (S.live.snapshot || '') : e.src)}${Object.keys(e.srcs || {}).filter(k => k !== e.src).map(k => ' + ' + esc(k === 'snapshot' ? 'snímek (kurzy)' : k)).join('')}</b></div>
      <div class="row"><button class="btn sec" data-prof="${r.hi}">Profil ${esc(na)}</button><button class="btn sec" data-prof="${r.ai}">Profil ${esc(nb)}</button></div></div>`;
    if (e.st === 3 || e._p == null) h += `<button class="btn ai" data-ask="${esc(e.id)}">✦ Zeptat se AI na tento zápas</button>`;
    body.innerHTML = h;
  } else if (k === 'predikce') {
    body.innerHTML = (e.st === 3 ? '<div class="warn">Zápas už skončil. Model níže počítá s aktuálními daty, která mohou tento výsledek už obsahovat – nejde o předzápasový tip.</div>' : (e.st === 1 ? `<div class="card" id="d-predblock">${bothPrematchHtml(e, na, nb)}</div>` : predNote(e))) + resultHtml(r.hi, r.ai, e.surface, e.code, e.q, e.st === 1);
  } else if (k === 'kurzy') {
    body.innerHTML = '<div class="empty">Načítám kurzy…</div>';
    if (e.fsid) await fetchOdds(e, true);
    if (S.detail?.tab !== 'kurzy' || S.byId[S.detail.id] !== e) return;
    body.innerHTML = oddsTab(e, na, nb);
  } else if (k === 'h2h') body.innerHTML = h2hTab(r.hi, r.ai, na, nb);
  else if (k === 'stat') body.innerHTML = formSection(r.hi, r.ai, na, nb, e._p) + statTab(r.hi, r.ai, na, nb, e.surface, e._p);
}
function oddsCell(v, open, last, chg, best) {
  const od = open ? sgn(v, open) : 0;
  return `<td class="oc ${best ? 'best' : ''} ${chg ? (chg > 0 ? 'fl-up' : 'fl-dn') : ''}"><span class="ov">${v.toFixed(2)}</span><span class="arw">${od ? `<i class="ar ${od > 0 ? 'up' : 'dn'}">${od > 0 ? '▲' : '▼'}</i>` : '<i class="ar"></i>'}${last ? `<i class="ar ${last > 0 ? 'up' : 'dn'} last">${last > 0 ? '▲' : '▼'}</i>` : '<i class="ar"></i>'}</span></td>`;
}
function oddsTab(e, na, nb) {
  const gam = '<p class="note gam">18+ Kurzy jsou orientační a mohou se kdykoli změnit. Model se může mýlit – „value“ není jistá výhra. Sázení je riskantní a může vést k závislosti; hrajte zodpovědně, stanovte si limit a při potížích vyhledejte odbornou pomoc.</p>';
  const o = e.oddsV;
  if (!e.fsid && !o) return `<div class="card"><h3>Kurzy</h3><p>Pro tento zápas nejsou kurzy k dispozici – zápas nemá ID ve Flashscore (zdroj kurzů). Kurzy fungují pro zápasy ze snímku buildu a zápasy ESPN, které se s ním podařilo spárovat.</p></div>${gam}`;
  if (!o || !o.avg) return `<div class="card"><h3>${o && o.inplay ? 'Živé kurzy' : 'Kurzy'}</h3><p>${e.st === 3 ? 'Zápas skončil – kurzy už nejsou nabízeny.' : o && o.suspended ? 'Sázkové kanceláře živý kurz dočasně pozastavily.' : 'Sázkové kanceláře zatím na tento zápas kurzy nevypsaly.'}</p></div>${gam}`;
  const prem = o.inplay && e.oddsPrem && e.oddsPrem.avg ? e.oddsPrem : null;
  const mkt = prem || o; const im = implied(mkt), p = e.st === 1 ? e._p : null; const v = valueOf(e);
  const rows = (o.books || []).map(b => `<tr><td>${esc(b.name)}</td>${oddsCell(b.h, b.oh, b.lh, b.ch, b.h === o.max[0])}${oddsCell(b.a, b.oa, b.la, b.ca, b.a === o.max[1])}</tr>`).join('');
  const ev = (pp, odd) => ((pp * odd - 1) * 100).toFixed(1);
  return `<div class="card"><h3>${o.inplay ? 'Živé kurzy v průběhu' : 'Kurzy na vítěze'} (${o.live ? '<i class="dot"></i>' + (o.inplay ? 'v průběhu, ' : 'živě, ') + new Date(o.t).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' }) : 'snímek z buildu ' + esc(S.live.snapshot || '')})</h3>
    <table class="ot"><tr><th>Sázková kancelář</th><th>${esc(na)}</th><th>${esc(nb)}</th></tr>${rows || `<tr><td colspan="3" class="note">Jednotlivé kanceláře jsou jen v živých datech.</td></tr>`}
    <tr class="sum"><td>Průměr (${o.n})</td>${oddsCell(o.avg[0], o.openAvg && o.openAvg[0], o.lastDir && o.lastDir[0], o.chg && o.chg[0])}${oddsCell(o.avg[1], o.openAvg && o.openAvg[1], o.lastDir && o.lastDir[1], o.chg && o.chg[1])}</tr><tr class="sum"><td>Nejlepší</td><td>${o.max[0].toFixed(2)}</td><td>${o.max[1].toFixed(2)}</td></tr></table>
    <p class="note"><i class="ar up">▲</i> kurz roste, <i class="ar dn">▼</i> klesá. ${o.inplay ? '1. šipka = proti předzápasovému kurzu, 2. (v kroužku) = proti minulému načtení živého kurzu. Obnovuje se každých 20 s, dokud je zápas živý a stránka viditelná.' : '1. šipka = proti otevíracímu kurzu, 2. šipka v kroužku = proti naposledy načtené hodnotě. Obnovuje se automaticky každých ~20 s, dokud je detail otevřený.'} Zdroj: veřejné kurzové srovnání Flashscore (bez klíče), kanceláře pro CZ${o.inplay ? ' – jen ty, které vypsaly kurz v průběhu' : ''}.</p></div>
    <div class="card"><h3>${prem ? 'Model vs. předzápasový trh' : 'Model vs. trh'}</h3>${prem ? `<p class="note">VALUE se počítá jen z předzápasového kurzu (⌀ ${prem.avg[0].toFixed(2)} / ${prem.avg[1].toFixed(2)}), ne z pohybujícího se živého kurzu.</p>` : ''}<table><tr><th></th><th>${esc(na)}</th><th>${esc(nb)}</th></tr>
    <tr><td>Implikovaná pravděpodobnost (bez marže)</td><td>${pct(im.p)}</td><td>${pct(1 - im.p)}</td></tr>
    ${p != null ? `<tr><td>Model</td><td><b>${pct(p)}</b></td><td><b>${pct(1 - p)}</b></td></tr><tr><td>Rozdíl model − trh</td><td class="${v && v.side === 1 ? 'best' : ''}">${((p - im.p) * 100).toFixed(1)} p. b.</td><td class="${v && v.side === 2 ? 'best' : ''}">${((im.p - p) * 100).toFixed(1)} p. b.</td></tr>
    <tr><td>Očekávaná návratnost při nejlepším kurzu</td><td>${ev(p, mkt.max[0])} %</td><td>${ev(1 - p, mkt.max[1])} %</td></tr>` : ''}</table>
    <div class="kv2"><span>Marže sázkových kanceláří</span><b>${(im.margin * 100).toFixed(1)} %</b><span>Práh pro „value“</span><b>model ≥ trh + ${VALUE_TH * 100} p. b., návratnost ≥ ${VALUE_EV * 100} % a aspoň ${VALUE_N} kanceláře</b></div>
    ${v && v.side ? `<div class="valbox">VALUE: ${esc(v.side === 1 ? na : nb)} (model ${pct(v.side === 1 ? p : 1 - p)} vs. trh ${pct(v.side === 1 ? im.p : 1 - im.p)})</div>` : e.st === 1 && p != null ? '<p class="note">Model se od trhu neliší o víc než práh – žádná „value“.</p>' : ''}
    <p class="note">Trh bývá přesnější než samotný model (model nevidí zranění, motivaci ani aktuální formu mimo data). Velký rozdíl často znamená chybějící informaci v modelu, ne chybu trhu.</p></div>${gam}`;
}
function meetings(i, j) {
  const out = []; const A = state(i), B = state(j);
  for (const x of (A?.ring || [])) if (x[5] === j) out.push([x[0], x[1], x[4]]);
  for (const x of (B?.ring || [])) if (x[5] === i && !out.some(y => y[0] === x[0])) out.push([x[0], 1 - x[1], x[4]]);
  return out.sort((a, b) => b[0] - a[0]);
}
function h2hTab(i, j, na, nb) {
  const [w, l] = h2h(i, j); const ms = meetings(i, j); const tot = w + l;
  return `<div class="card"><h3>Vzájemné zápasy</h3><div class="h2hb"><div><b class="a">${w}</b><small>${esc(na)}</small></div><div class="vs">výhry</div><div><b class="b">${l}</b><small>${esc(nb)}</small></div></div>
    ${tot ? `<div class="bar lg"><i style="width:${(w / tot * 100).toFixed(1)}%"></i></div>` : '<p class="note">Hráči spolu v databázi (od 2000, dvouhra) nehráli.</p>'}
    ${ms.length ? `<h3>Poslední vzájemné zápasy</h3><table>${ms.map(m => `<tr><td>${fmtDate(m[0])}</td><td>${esc(LVL_CS[m[2]] || '')}</td><td><b>${esc(m[1] ? na : nb)}</b></td></tr>`).join('')}</table>` : ''}
    <p class="note">Počty H2H obsahují zápasy od roku 2000 (páry s ≥2 zápasy nebo zápasem v posl. 3 letech) + živě započtené výsledky. Seznam jen z posledních ${TM.RING} zápasů každého hráče.</p></div>`;
}
/* ---------- graf výkonu vs. očekávání (posl. 2 měsíce) ---------- */
function perfData(i) {
  const p = state(i); const t = todayDay(); const from = t - 61; if (!p) return [];
  let cum = 0; const out = [];
  for (const x of formHist(p)) if (x[0] >= from) { cum += x[1] - x[2]; out.push({ d: x[0], w: x[1], ew: x[2], lvl: x[4], opp: x[5], cum }); }
  return out;
}
/* ---------- hodnocení formy (výkon vs. očekávání v %) ----------
   F(t) = Σ w·(výhra − očekávání Elo) / (Σ w + FORM_K), w = exp(−stáří/FORM_TAU); jen zápasy do dne t.
   = o kolik procentních bodů hráč vyhrává častěji/méně často, než podle Elo před zápasem čekal; bez nových zápasů se hodnota pomalu vrací k 0. */
const FORM_TAU = 30, FORM_K = 2, FORM_COL = ['#4d8dff', '#a26bff'];
function formHist(p) { return p.fx && p.fx.length ? p.fx.concat(p.ring) : p.ring; }
function formAt(i, day) {
  const p = state(i); if (!p) return null; let sw = 0, sr = 0, n = 0;
  for (const x of formHist(p)) { if (x[0] > day) continue; const w = Math.exp(-(day - x[0]) / FORM_TAU); sw += w; sr += w * (x[1] - x[2]); if (day - x[0] <= 30) n++; }
  return sw ? { f: sr / (sw + FORM_K), n } : { f: 0, n: 0 };
}
const FORM_SPAN = 60, FORM_STEP = 3, FORM_NP = FORM_SPAN / FORM_STEP + 1;
function formSeries(i) { const t = todayDay(); const out = []; for (let k = FORM_NP - 1; k >= 0; k--) { const d = t - FORM_STEP * k; const v = formAt(i, d); out.push({ d, f: v ? v.f : null, n: v ? v.n : 0 }); } return out; }
const fpct = (v, dig = 1) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v * 100).toFixed(dig).replace('.', ',') + ' %';
function formCards(ids, names) {
  return `<div class="fcards">${ids.map((i, k) => { const s = formAt(i, todayDay()); const v = s ? s.f : 0;
    return `<div class="fcard"><b class="${v >= 0 ? 'pos' : 'neg'}">${fpct(v)}</b><small style="color:${FORM_COL[k]}">${esc(names[k])}</small><div class="fbar"><i class="${v >= 0 ? 'pos' : 'neg'}" style="width:${Math.min(100, Math.abs(v) / 0.6 * 100).toFixed(1)}%"></i></div><em>${s && s.n ? s.n + ' záp. za 30 dní' : 'za 30 dní bez zápasu'}</em></div>`; }).join('')}</div>`;
}
function formChart(ids, names) {
  const uid = 'fc' + ids.join('_') + '_' + (S.pcSeq = (S.pcSeq || 0) + 1); const ser = ids.map(formSeries);
  S.pc[uid] = { ids, names, ser };
  const W = 340, H = 190, pl = 34, pr = 10, pt = 8, pb = 24; const all = ser.flat().map(x => Math.abs(x.f || 0));
  const mx = Math.max(0.6, Math.ceil(Math.max(...all) / 0.2) * 0.2); const d0 = ser[0][0].d, d1 = ser[0][FORM_NP - 1].d;
  const X = d => pl + (d - d0) / (d1 - d0) * (W - pl - pr), Y = v => pt + (1 - (v + mx) / (2 * mx)) * (H - pt - pb);
  const lab = dd => new Date(dd * 864e5).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', timeZone: 'UTC' });
  const yt = []; for (let v = mx; v >= -mx - 1e-9; v -= 0.2) yt.push(Math.round(v * 100) / 100);
  const grid = yt.map(v => `<line x1="${pl}" x2="${W - pr}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" class="${Math.abs(v) < 1e-9 ? 'zl' : 'gl'}"/><text x="${pl - 5}" y="${(Y(v) + 3.3).toFixed(1)}" text-anchor="end">${Math.round(v * 100)}%</text>`).join('');
  const xg = [0, 1, 2, 3].map(k => { const d = d0 + k * (d1 - d0) / 3; return `<line x1="${X(d).toFixed(1)}" x2="${X(d).toFixed(1)}" y1="${pt}" y2="${H - pb}" class="gl"/><text x="${X(d).toFixed(1)}" y="${H - 7}" text-anchor="${k === 3 ? 'end' : k === 0 ? 'start' : 'middle'}">${lab(Math.round(d))}</text>`; }).join('');
  const lines = ser.map((s, k) => { const pts = s.map(x => [X(x.d), Y(x.f || 0)]);
    return `<g class="fl fl${k}" style="--c:${FORM_COL[k]}"><path d="${pts.map((p, q) => (q ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ')}" class="ln"/>${pts.map((p, q) => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${q === FORM_NP - 1 ? 6.5 : 3}" class="${q === FORM_NP - 1 ? 'lastp' : ''}" data-pc="${uid}" data-k="${q}"/>`).join('')}</g>`; }).join('');
  const zy = Y(0);
  const seg = ids.length > 1 ? `<div class="fseg" data-fseg="${uid}"><button class="on" data-fsel="all">VŠE</button>${names.map((n, k) => `<button data-fsel="${k}">${esc(n.split(' ').slice(-1)[0].slice(0, 9).toUpperCase())}</button>`).join('')}</div>` : '';
  return `<div class="fchart" id="${uid}"><div class="fch"><b>Forma v čase</b><span>%</span></div><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Forma v čase">
    <defs><linearGradient id="gp${uid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2fe089" stop-opacity=".26"/><stop offset="1" stop-color="#2fe089" stop-opacity=".04"/></linearGradient>
    <linearGradient id="gn${uid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff4d5e" stop-opacity=".04"/><stop offset="1" stop-color="#ff4d5e" stop-opacity=".28"/></linearGradient></defs>
    <rect x="${pl}" y="${pt}" width="${W - pl - pr}" height="${(zy - pt).toFixed(1)}" fill="url(#gp${uid})" rx="3"/><rect x="${pl}" y="${zy.toFixed(1)}" width="${W - pl - pr}" height="${(H - pb - zy).toFixed(1)}" fill="url(#gn${uid})" rx="3"/>
    <g class="ax">${grid}${xg}</g>${lines}</svg>
    <div class="ffoot"><div class="fleg">${names.map((n, k) => `<span><i style="background:${FORM_COL[k]}"></i>${esc(n.split(' ').slice(-1)[0])}</span>`).join('')}</div>${seg}</div>
    <div class="pinfo" id="pi-${uid}">Klepněte na bod v grafu. Posledních 60 dní, bod každé 3 dny, poslední = dnes.</div></div>`;
}
function perfInfo(uid, k) {
  const c = S.pc[uid]; if (!c) return; const el = document.getElementById('pi-' + uid); if (!el) return;
  for (const m of document.querySelectorAll(`[data-pc="${uid}"]`)) m.classList.toggle('sel', +m.dataset.k === k);
  el.innerHTML = `<b>${k === FORM_NP - 1 ? 'Dnes' : fmtDate(c.ser[0][k].d)}</b> · ` + c.ids.map((i, q) => { const x = c.ser[q][k]; return `<span style="color:${FORM_COL[q]}">${esc(c.names[q].split(' ').slice(-1)[0])}</span> <b class="${x.f >= 0 ? 'pos' : 'neg'}">${fpct(x.f || 0)}</b> <small>(${x.n} záp./30 dní)</small>`; }).join(' · ');
}
function formAdj(p, i, j) {
  if (p == null) return null; const fa = formAt(i, todayDay()), fb = formAt(j, todayDay()); if (!fa || !fb) return null;
  const lg = Math.log(p / (1 - p)) + FORM_BETA * (fa.f - fb.f); const q = 1 / (1 + Math.exp(-lg)); return { q, d: q - p };
}
const FORM_BETA = 1;
function formSection(i, j, na, nb, p, inner) {
  const two = j != null; const ids = two ? [i, j] : [i], names = two ? [na, nb] : [na]; const fa = two ? formAdj(p, i, j) : null;
  return `<div class="${inner ? 'fsec in' : 'card fsec'}"><h2 class="fh">HODNOCENÍ FORMY ${two ? 'HRÁČŮ' : 'HRÁČE'}</h2><p class="note">Porovnává skutečné výsledky s očekáváním podle Elo před každým zápasem – ukazuje, jestli ${two ? 'hráč' : 'hráč(ka)'} v posledních týdnech překonává očekávání, nebo za nimi zaostává, a jak se to vyvíjelo.</p>
    ${formCards(ids, names)}${formChart(ids, names)}
    ${fa ? `<h3 class="fh2">Kurzy upravené podle formy</h3><p class="note">Hypotetický scénář: kdyby oba hráči pokračovali v současném trendu formy, jak by se změnila šance favorita. <b>Není to predikce</b> ani doporučení k sázce – model formu už částečně zohledňuje.</p>
    <div class="fcards adj">${[[fa.q, fa.d, na], [1 - fa.q, -fa.d, nb]].map(([v, d, n]) => `<div class="fcard"><em class="${d >= 0 ? 'pos' : 'neg'}">${fpct(d)}</em><b>${(v * 100).toFixed(1).replace('.', ',')} %</b><small>${esc(n)}</small></div>`).join('')}</div>
    <p class="note">Model: ${esc(na)} ${(p * 100).toFixed(1).replace('.', ',')} % → upraveno ${(fa.q * 100).toFixed(1).replace('.', ',')} % (logit + ${FORM_BETA} × rozdíl forem).</p>` : ''}
    <p class="note">Forma = vážený průměr (výhra − očekávaná pravděpodobnost výhry podle Elo) ze všech zápasů za posledních ~5 měsíců, starší zápasy váží méně (poločas ~3 týdny), smrštěno k 0 při malém počtu zápasů. +10 % = vyhrává zhruba o 10 procentních bodů častěji, než se čekalo. Bez nových zápasů se hodnota pomalu vrací k 0. Graf pokrývá celých posledních 60 dní (bod každé 3 dny). Nové výsledky z ESPN se přidávají živě.</p></div>`;
}
function statTab(i, j, na, nb, surface, p) {
  const A = state(i), B = state(j), t = todayDay(); const s = TM.SURF[surface];
  const wr = (p, k) => { const n = p.sw[k] + p.sl[k]; return n ? p.sw[k] / n : null; };
  const f10 = p => { const r = p.ring.slice(-10); return r.length ? r.reduce((a, x) => a + x[1], 0) / r.length : null; };
  const rows = [
    ['Elo celkové', A.elo, B.elo, x => Math.round(x)], [`Elo – ${SURF_CS[surface]}`, A.se[s], B.se[s], x => Math.round(x)], ['Elo z gemů', A.gelo, B.gelo, x => Math.round(x)],
    ['Žebříček', A.rank, B.rank, x => '#' + x, true], ['Forma (posl. 10)', f10(A), f10(B), x => pct(x)],
    [`Úspěšnost – ${SURF_CS[surface]}`, wr(A, s), wr(B, s), x => pct(x)],
    ['Body vyhrané na podání', A.ns ? A.spw : null, B.ns ? B.spw : null, x => (x * 100).toFixed(1) + ' %'], ['Body vyhrané na příjmu', A.ns ? A.rpw : null, B.ns ? B.rpw : null, x => (x * 100).toFixed(1) + ' %'],
    ['Esa (na bod podání)', A.ns ? A.ace : null, B.ns ? B.ace : null, x => (x * 100).toFixed(1) + ' %'], ['Dvojchyby', A.ns ? A.df : null, B.ns ? B.df : null, x => (x * 100).toFixed(1) + ' %', true],
    ['Odvrácené brejkboly', A.ns ? A.bps : null, B.ns ? B.bps : null, x => (x * 100).toFixed(1) + ' %'],
    ['Zápasů v databázi', A.n, B.n, x => x], ['Věk', A.dob != null ? (t - A.dob) / 365.25 : null, B.dob != null ? (t - B.dob) / 365.25 : null, x => x.toFixed(1), null],
    ['Výška', A.ht, B.ht, x => x + ' cm', null]];
  const bar = (a, b, low) => { if (a == null || b == null || low === null) return ''; let x = a, y = b; if (low) { x = 1 / a; y = 1 / b; } const tot = Math.abs(x) + Math.abs(y) || 1;
    return `<div class="sbar"><i class="l ${x >= y ? 'hi' : ''}" style="width:${(x / tot * 50).toFixed(1)}%"></i><i class="r ${y > x ? 'hi' : ''}" style="width:${(y / tot * 50).toFixed(1)}%"></i></div>`; };
  return `<div class="card"><div class="shd"><b class="a">${esc(na)}</b><b class="b">${esc(nb)}</b></div>${rows.map(([lab, a, b, f, low]) => `<div class="srow"><div class="sv"><span>${a == null ? '—' : f(a)}</span><em>${lab}</em><span>${b == null ? '—' : f(b)}</span></div>${bar(a, b, low)}</div>`).join('')}
    <div class="srow"><div class="sv"><span>${A.hand === 'L' ? 'levák' : A.hand === 'R' ? 'pravák' : '—'}</span><em>Ruka</em><span>${B.hand === 'L' ? 'levák' : B.hand === 'R' ? 'pravák' : '—'}</span></div></div>
    <h3>Forma</h3><div class="note">${esc(na)}</div>${formHtml(A)}<div class="note" style="margin-top:6px">${esc(nb)}</div>${formHtml(B)}
    <p class="note">Statistiky podání/příjmu jsou klouzavé průměry z posledních zápasů se statistikami (hlavně ATP/WTA/Challenger). U ITF často chybí.</p></div>`;
}
/* ---------- výsledek predikce ---------- */
function factorsHtml(r, na, nb) {
  const c = r.contrib.filter(x => Math.abs(x[1]) > 0.02).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 6);
  if (!c.length) return '<p class="note">Hráči jsou si podle modelu velmi vyrovnaní.</p>';
  const mx = Math.max(...c.map(x => Math.abs(x[1])));
  return c.map(([f, v]) => `<div class="f"><span>${esc(FEAT_CS[f] || f)}</span><span class="dir" style="color:${v > 0 ? 'var(--a)' : 'var(--b)'}">${'▮'.repeat(Math.max(1, Math.round(Math.abs(v) / mx * 5)))} ${esc(v > 0 ? na : nb)}</span></div>`).join('');
}
function formHtml(p) { return p.ring.slice(-10).map(x => `<span class="wl ${x[1] ? 'W' : 'L'}">${x[1] ? 'V' : 'P'}</span>`).join('') || '<span class="note">—</span>'; }
function resultHtml(i, j, surface, code, q, noBig) {
  const r = predict(i, j, surface, code, q); const na = pName(i), nb = pName(j); const A = r.A, B = r.B, t = todayDay();
  const f = TM.fatigue, fa = f(A.ring, t), fb = f(B.ring, t);
  const age = p => p.dob != null ? ((t - p.dob) / 365.25).toFixed(1) : '—';
  const wr = p => { const w = p.ring.slice(-10).reduce((a, x) => a + x[1], 0); return p.ring.length ? `${w}/${Math.min(10, p.ring.length)}` : '—'; };
  const s = TM.SURF[surface];
  const rows = [['Elo celkové', Math.round(A.elo), Math.round(B.elo)], [`Elo – ${SURF_CS[surface]}`, Math.round(A.se[s]), Math.round(B.se[s])],
    ['Žebříček', A.rank || '—', B.rank || '—'], ['Forma (výhry z posl. 10)', wr(A), wr(B)], ['Zápasů celkem (od 2000)', A.n, B.n],
    ['Věk', age(A), age(B)], ['Dní od posl. zápasu', A.last != null ? t - A.last : '—', B.last != null ? t - B.last : '—'], ['Zápasy za 14 dní', fa[1], fb[1]]];
  let warn = '';
  if (A.isNew || B.isNew) warn += `<div class="warn">${esc(A.isNew ? na : nb)} nemá v databázi historii (nový hráč nebo nespárované jméno) – odhad je velmi nejistý.</div>`;
  if (pG(i) !== pG(j)) warn += `<div class="warn">Pozor: porovnáváte muže a ženu – model na to není stavěný.</div>`;
  const big = noBig ? '' : `<h3>${TITLE_MODEL}</h3>
   <div class="big"><div><div class="p a">${pct(r.p)}</div><div class="nm">${esc(na)}</div></div><div><div class="p b">${pct(1 - r.p)}</div><div class="nm">${esc(nb)}</div></div></div>
   <div class="bar lg"><i style="width:${(r.p * 100).toFixed(1)}%"></i></div>
   <p class="plab">${LAB_MODEL}</p>`;
  return `${warn}<div class="card"><div class="note">${esc(LVL_CS[code])} · ${SURF_CS[surface]}${q ? ' · kvalifikace' : ''} · na ${r.ctx.best_of} sety</div>
   ${big}
   <h3>Hlavní faktory</h3>${factorsHtml(r, na, nb)}
   <p class="note">Faktory = příspěvky v logistické regresi (vysvětlitelná část modelu); výsledná pravděpodobnost je z LightGBM.</p></div>
   <div class="card"><h3>Srovnání</h3><table><tr><th></th><th>${esc(na.split(' ').slice(-1)[0])}</th><th>${esc(nb.split(' ').slice(-1)[0])}</th></tr>
   ${rows.map(x => `<tr><td>${x[0]}</td><td>${x[1]}</td><td>${x[2]}</td></tr>`).join('')}
   <tr><td>Vzájemné zápasy</td><td colspan="2" style="text-align:center">${r.h2h[0]} : ${r.h2h[1]}</td></tr></table>
   <div style="margin-top:8px"><div class="note">Forma ${esc(na)}:</div>${formHtml(A)}<div class="note" style="margin-top:4px">Forma ${esc(nb)}:</div>${formHtml(B)}</div></div>
   <div class="card"><h3>Jednotlivé modely</h3><table><tr><th>Model</th><th>${esc(na.split(' ').slice(-1)[0])}</th></tr>
   <tr><td>LightGBM (nasazený)</td><td>${pct(r.gbm)}</td></tr><tr><td>Logistická regrese</td><td>${pct(r.lr)}</td></tr>
   <tr><td>Jen Elo</td><td>${pct(r.elo)}</td></tr><tr><td>Jen žebříček (baseline)</td><td>${pct(r.base)}</td></tr></table>
   <p class="note">Predikce je statistický odhad, nikoli záruka výsledku. Nesázejte na jejím základě víc, než si můžete dovolit prohrát.</p></div>`;
}

/* ---------- autocomplete ---------- */
function searchPlayers(q, g) {
  const t = toks(q); if (!t.length) return [];
  const out = [];
  for (let i = 0; i < S.N && out.length < 40; i++) {
    if (g && S.idx.g[i] !== g) continue;
    const nm = S.norm[i]; if (t.every(x => nm.includes(x))) out.push(i);
  }
  for (let k = 0; k < S.extra.length; k++) { const i = S.N + k; if ((!g || S.extra[k].g === g) && t.every(x => toks(S.extra[k].name).join(' ').includes(x))) out.push(i); }
  return out.sort((a, b) => (S.E[b] - S.E[a])).slice(0, 12);
}
function grpOf(i) { const lv = i < S.N ? S.idx.lv[i] : 1; return lv >= 4 ? 'okruh' : lv === 3 ? 'challenger' : 'ITF'; }
function acItem(i) { const r = i < S.N ? S.idx.r[i] : 0; return `<li data-i="${i}"><span>${esc(pName(i))} <small>${esc(pC(i))}</small></span><small>${pG(i) === 'M' ? '♂' : '♀'} Elo ${Math.round(S.E[i])}${r ? ' · #' + r : ''} · ${grpOf(i)}</small></li>`; }
function autocomplete(input, onPick, gFn) {
  const wrap = input.parentElement; let ul = wrap.querySelector('ul');
  if (!ul) { ul = document.createElement('ul'); ul.hidden = true; wrap.appendChild(ul); }
  input.addEventListener('input', () => { const res = searchPlayers(input.value, gFn ? gFn() : null); ul.innerHTML = res.map(acItem).join(''); ul.hidden = !res.length; });
  ul.addEventListener('click', ev => { const li = ev.target.closest('li'); if (!li) return; const i = +li.dataset.i; input.value = pName(i); ul.hidden = true; onPick(i); });
  input.addEventListener('blur', () => setTimeout(() => { ul.hidden = true; }, 200));
}

/* ---------- PREDIKCE (vlastní dvojice) ---------- */
function renderPredict() {
  const v = $('#v-predikce');
  v.innerHTML = `<div class="ph"><h1>PREDIKCE</h1></div><div class="card"><h3>Vlastní dvojice</h3>
   <label>Hráč / hráčka A</label><div class="ac"><input id="pa" placeholder="Začněte psát jméno…" autocomplete="off"></div>
   <label>Hráč / hráčka B</label><div class="ac"><input id="pb" placeholder="Začněte psát jméno…" autocomplete="off"></div>
   <div class="row"><div><label>Povrch</label><select id="ps">${SURF_IDX.map(s => `<option value="${s}">${SURF_CS[s]}</option>`).join('')}</select></div>
   <div><label>Úroveň turnaje</label><select id="pl">${[6, 5, 4, 3, 2, 1, 0].map(c => `<option value="${c}" ${c === 4 ? 'selected' : ''}>${LVL_CS[c]}</option>`).join('')}</select></div></div>
   <label class="chk"><input type="checkbox" id="pq"> Kvalifikace</label>
   <button class="btn" id="pgo">Spočítat pravděpodobnost</button></div><div id="pres"></div>
   <div id="ptop"></div>`;
  const a = $('#pa'), b = $('#pb');
  if (S.pred.a !== null) a.value = pName(S.pred.a); if (S.pred.b !== null) b.value = pName(S.pred.b);
  autocomplete(a, i => { S.pred.a = i; }, () => S.pred.b !== null ? pG(S.pred.b) : null);
  autocomplete(b, i => { S.pred.b = i; }, () => S.pred.a !== null ? pG(S.pred.a) : null);
  $('#pgo').onclick = async () => {
    if (S.pred.a === null || S.pred.b === null) { $('#pres').innerHTML = '<div class="warn">Vyberte oba hráče ze seznamu.</div>'; return; }
    if (S.pred.a === S.pred.b) { $('#pres').innerHTML = '<div class="warn">Vyberte dva různé hráče.</div>'; return; }
    $('#pres').innerHTML = '<div class="empty">Počítám…</div>';
    await ensure([S.pred.a, S.pred.b]);
    $('#pres').innerHTML = resultHtml(S.pred.a, S.pred.b, $('#ps').value, +$('#pl').value, $('#pq').checked);
  };
  renderPredTop();
}
async function renderPredTop() {
  // nejjistější tipy a „value“ zápasy na dnes/zítra
  const up = (S.all || []).filter(e => e.st === 1 && !e.stale && dayOff(e.ts) >= 0 && dayOff(e.ts) <= 1);
  await probsFor(up); const el = $('#ptop'); if (!el) return;
  const val = up.filter(e => { const v = valueOf(e); return v && v.side; }).sort((a, b) => Math.abs(valueOf(b).edge) - Math.abs(valueOf(a).edge));
  const conf = up.filter(e => e._p != null).sort((a, b) => Math.abs(b._p - 0.5) - Math.abs(a._p - 0.5)).slice(0, 8);
  el.innerHTML = `<div class="ph sm"><h2>NEJJISTĚJŠÍ TIPY · dnes a zítra</h2></div>${conf.length ? groupsHtml(conf) : '<div class="empty">—</div>'}
    <div class="ph sm"><h2>VALUE · model vs. kurzy</h2></div>${val.length ? groupsHtml(val.slice(0, 10)) : '<div class="empty">Žádný zápas nepřekračuje práh ' + VALUE_TH * 100 + ' p. b. při aspoň ' + VALUE_N + ' kancelářích (jen předzápasové kurzy).</div>'}
    <p class="note gam">18+ Predikce i „value“ jsou statistické odhady, ne jistota. Sázení je riskantní a může vést k závislosti – hrajte zodpovědně.</p>`;
  observeOdds(el);
}

/* ---------- HRÁČI ---------- */
function renderPlayers() {
  const v = $('#v-hraci');
  v.innerHTML = `<div class="ph"><h1>HRÁČI</h1></div><div class="card"><div class="ac"><input id="hs" placeholder="Hledat hráče (všechny úrovně)…" autocomplete="off"></div>
   <p class="note">${S.N.toLocaleString('cs-CZ')} hráčů a hráček aktivních od 2024 (ATP, WTA, Challenger, WTA 125, ITF).</p></div><div id="hp"></div><div id="htop"></div>`;
  autocomplete($('#hs'), i => showProfile(i, $('#hp')));
  const top = g => { const ids = []; for (let i = 0; i < S.N; i++) if (S.idx.g[i] === g && S.idx.l[i] < 60) ids.push(i); return ids.sort((a, b) => S.E[b] - S.E[a]).slice(0, 15); };
  const li = (i, k) => `<div class="prow" data-prof="${i}"><span class="rk">${k + 1}</span>${avatar(i)}${flagImg(pC(i))}<span class="nm">${esc(pName(i))}</span><span class="el">${Math.round(S.E[i])}</span>${starBtn(i)}</div>`;
  $('#htop').innerHTML = `<div class="ph sm"><h2>ŽEBŘÍČEK ELO · MUŽI</h2></div><div class="card flat">${top('M').map(li).join('')}</div>
    <div class="ph sm"><h2>ŽEBŘÍČEK ELO · ŽENY</h2></div><div class="card flat">${top('W').map(li).join('')}</div><p class="note">Elo modelu (všechny úrovně, s živými výsledky), jen hráči aktivní v posledních 60 dnech dat.</p>`;
}
async function showProfile(i, el, keep) {
  S.profI = i; await ensure([i]); const p = state(i); const t = todayDay();
  const oppName = o => (o >= 0 ? pName(o) : '?');
  const recent = p.ring.slice().reverse().slice(0, 12).map(x => `<tr><td>${fmtDate(x[0])}</td><td style="text-align:left">${esc(oppName(x[5]))}</td><td>${esc(LVL_CS[x[4]]?.split(' ')[0] || '')}</td><td><span class="wl ${x[1] ? 'W' : 'L'}">${x[1] ? 'V' : 'P'}</span></td></tr>`).join('');
  const hh = Object.entries(p.h2h || {}).map(([o, [w, l]]) => [+o, w, l]);
  for (const [k, v] of Object.entries(S.liveH2H)) { const [a, b] = k.split(':').map(Number); if (a === i) { const f = hh.find(x => x[0] === b); if (f) { f[1] += v[0]; f[2] += v[1]; } else hh.push([b, v[0], v[1]]); } }
  hh.sort((a, b) => (b[1] + b[2]) - (a[1] + a[2]));
  const sr = SURF_IDX.map((s, k) => `<tr><td>${SURF_CS[s]}</td><td>${Math.round(p.se[k])}</td><td>${p.sw[k]}–${p.sl[k]}</td></tr>`).join('');
  const evs = (S.all || []).filter(e => { const r = resolveEv(e); return r.hi === i || r.ai === i; });
  await probsFor(evs.filter(e => e.st !== 3));
  el.innerHTML = `<div class="card prof"><div class="phd">${avatar(i, null, 'lg')}<div><h2>${esc(pName(i))}</h2><div class="note">${flagImg(pC(i))} ${esc(pC(i))} · ${pG(i) === 'M' ? 'muži' : 'ženy'}</div></div>${starBtn(i)}</div>
   ${p.isNew ? '<div class="warn">Hráč nemá v databázi historii (nový nebo nespárovaný).</div>' : ''}
   <div class="tiles"><div><b>${Math.round(p.elo)}</b><small>Elo</small></div><div><b>${p.rank ? '#' + p.rank : '—'}</b><small>Žebříček</small></div><div><b>${p.dob != null ? Math.floor((t - p.dob) / 365.25) : '—'}</b><small>Věk</small></div><div><b>${p.n}</b><small>Zápasů</small></div></div>
   <div class="kv"><div>Body</div><div>${p.pts || '—'}</div><div>Ruka / výška</div><div>${p.hand === 'L' ? 'levák' : p.hand === 'R' ? 'pravák' : '—'} / ${p.ht ? p.ht + ' cm' : '—'}</div>
   <div>Poslední zápas</div><div>${p.last != null ? fmtDate(p.last) : '—'}${p.live ? ` <small class="note">(+${p.live} živě)</small>` : ''}</div>
   <div>Podání / příjem</div><div>${p.ns ? (p.spw * 100).toFixed(1) + ' % / ' + (p.rpw * 100).toFixed(1) + ' %' : '—'}</div>
   <div>Esa / dvojchyby</div><div>${p.ns ? (p.ace * 100).toFixed(1) + ' % / ' + (p.df * 100).toFixed(1) + ' %' : '—'}</div></div>
   ${formSection(i, null, pName(i), null, null, true)}
   <h3>Forma (posl. 10)</h3>${formHtml(p)}
   <h3>Povrchy</h3><table><tr><th>Povrch</th><th>Elo</th><th>V–P</th></tr>${sr}</table>
   <button class="btn" data-cmp="${i}">Porovnat v predikci</button></div>
   ${evs.length ? `<div class="ph sm"><h2>ZÁPASY (±2 dny)</h2></div>${groupsHtml(evs)}` : ''}
   <div class="card"><h3>Poslední zápasy</h3><table><tr><th>Datum</th><th style="text-align:left">Soupeř</th><th>Úroveň</th><th></th></tr>${recent || '<tr><td colspan=4>—</td></tr>'}</table></div>
   <div class="card"><h3>Vzájemné zápasy (H2H)</h3>${hh.length ? `<table><tr><th>Soupeř</th><th>V</th><th>P</th></tr>${hh.slice(0, 15).map(([o, w, l]) => `<tr><td>${esc(pName(o))}</td><td>${w}</td><td>${l}</td></tr>`).join('')}</table>` : '<p class="note">—</p>'}</div>`;
  if (!keep) el.scrollIntoView({ block: 'start' });
}

/* ---------- OBLÍBENÉ ---------- */
async function renderFav() {
  const v = $('#v-oblibene'); const fav = [...S.fav.values()].map(f => [f, favIdx(f)]).filter(x => x[1] !== null);
  if (!fav.length) { v.innerHTML = `<div class="ph"><h1>OBLÍBENÉ</h1></div><div class="empty big">☆<br>Zatím nemáte oblíbené hráče.<br><small>Klepněte na hvězdičku v detailu zápasu, v profilu hráče nebo v žebříčku v záložce Hráči. Ukládá se jen v tomto zařízení.</small></div>`; return; }
  const ids = fav.map(x => x[1]); await ensure(ids);
  const evs = (S.all || []).filter(e => { const r = resolveEv(e); return ids.includes(r.hi) || ids.includes(r.ai); });
  await probsFor(evs.filter(e => e.st !== 3));
  const next = i => evs.filter(e => { const r = resolveEv(e); return (r.hi === i || r.ai === i) && e.st !== 3; }).sort((a, b) => a.ts - b.ts)[0];
  v.innerHTML = `<div class="ph"><h1>OBLÍBENÉ</h1></div><div class="card flat">${ids.map(i => { const s = state(i); const n = next(i);
      return `<div class="prow" data-prof="${i}">${avatar(i)}${flagImg(pC(i))}<span class="nm">${esc(pName(i))}<small>${n ? (n.st === 2 && !n.stale ? '▶ hraje teď' : 'další: ' + dayLabel(dayOff(n.ts), true) + ' ' + hm(n.ts)) : 'Elo ' + Math.round(s ? s.elo : S.E[i])}</small></span>${s ? `<span class="fm">${s.ring.slice(-5).map(x => `<i class="${x[1] ? 'W' : 'L'}"></i>`).join('')}</span>` : ''}${starBtn(i)}</div>`; }).join('')}</div>
   <div class="ph sm"><h2>ZÁPASY OBLÍBENÝCH (±2 dny)</h2></div>${evs.length ? groupsHtml(evs) : '<div class="empty">Žádné zápasy v rozpisu.</div>'}`;
  observeOdds(v);
}

/* ---------- MODEL ---------- */
function retrainCard(m) {
  const mi = m.model_info, H = (m.retrain || []).slice().reverse();
  const f = (x, k) => k === 'acc' ? (x[k] * 100).toFixed(2).replace('.', ',') + ' %' : x[k].toFixed(4).replace('.', ',');
  const cell = (e, k) => { const better = k === 'acc' ? e.new[k] > e.old[k] : e.new[k] < e.old[k]; return `<td>${f(e.old, k)} → <b class="${better ? 'pos' : e.new[k] === e.old[k] ? '' : 'neg'}">${f(e.new, k)}</b></td>`; };
  return `<div class="card"><h2>Týdenní přetrénování</h2>
   <p class="note">Každou neděli ~03:17 (GitHub Actions) se model v2 se stejnými příznaky a hyperparametry přetrénuje na posledních 15 letech dat. Novější zápasy mají při tréninku vyšší váhu (poločas 6 let). Kandidát se trénuje jen do začátku holdoutu (posledních 12 týdnů) a porovná se se současným modelem na stejných zápasech. Nasadí se jen když má nižší log loss, ne horší Brier a přesnost nejvýš o 0,3 p. b. horší, a když projde test shody prohlížeč = Python; pak se ještě dotrénuje na všech datech.</p>
   ${mi ? `<div class="kv"><div>Nasazený model</div><div><b>${esc(mi.version)}</b>, natrénován ${esc(mi.trained_at)}</div><div>Data tréninku</div><div>${esc(mi.train_start)} – ${esc(mi.train_end)} (${(mi.n_train || 0).toLocaleString('cs-CZ')})</div><div>Stromů / kalibrace</div><div>${mi.trees} / a = ${mi.cal}</div></div>` : ''}
   ${H.length ? `<div class="tscroll"><table class="rt"><tr><th>Datum</th><th>Holdout</th><th>Přesnost</th><th>Log loss</th><th>Brier</th><th>Rozhodnutí</th></tr>${H.map(e => `<tr><td>${esc(e.date.slice(0, 10))}</td><td>${esc(e.holdout)}<br><small>n = ${e.n_holdout.toLocaleString('cs-CZ')}</small></td>${cell(e, 'acc')}${cell(e, 'logloss')}${cell(e, 'brier')}<td>${e.deployed ? '<b class="pos">nasazeno</b>' : '<b class="neg">ponecháno</b>'}<br><small>${esc(e.decision)}</small></td></tr>`).join('')}</table></div><p class="note">Vlevo současný model, vpravo kandidát (${esc(H[0].compared || '')}).</p>` : '<p class="note">Zatím žádné týdenní přetrénování.</p>'}</div>`;
}
const SURF_HIT = { Hard: 'Tvrdý', Clay: 'Antuka', Grass: 'Tráva', Carpet: 'Koberec' };
const GRP_HIT = { tour: 'ATP/WTA', chall: 'Challenger / WTA 125', itf: 'ITF' };
function pct1(h, n) { return n ? (h / n * 100).toFixed(1).replace('.', ',') + ' %' : '—'; }
function hitsCard() {
  const H = S.hits;
  if (H == null) return `<div class="card" id="hits"><h2>Jak model trefuje</h2><p class="note">Načítám výsledky…</p></div>`;
  if (!H) return '';
  const d = s => { const [y, m, da] = s.split('-'); return `${+da}. ${+m}. ${y}`; };
  const row = r => `<div class="hit"><div><b>${esc(r.name)}</b><small>${esc(SURF_HIT[r.surface] || r.surface)}${r.group ? ' · ' + esc(GRP_HIT[r.group] || r.group) : ''}</small></div><div class="hn"><b>${pct1(r.hits, r.n)}</b><small>${r.n.toLocaleString('cs-CZ')} zápasů</small></div></div>`;
  const surf = (H.by_surface || []).map(r => `<div class="hs"><b>${pct1(r.hits, r.n)}</b><small>${esc(SURF_HIT[r.surface] || r.surface)} · ${r.n.toLocaleString('cs-CZ')}</small></div>`).join('');
  return `<div class="card" id="hits"><h2>Jak model trefuje</h2>
   <p class="note">Skutečné dohrané zápasy ${esc(d(H.period_from))} – ${esc(d(H.period_to))} (${H.n.toLocaleString('cs-CZ')}), které tenhle model při hodnocení neviděl (trénink do 31. 12. 2025). Nasazený model byl 29. 9. dotrénován i na nich, proto je tabulka poctivější odhad než číslo po dotrénování. Zásah = favorit modelu (nad 50 %) zápas vyhrál. Skreče nejsou zahrnuté.</p>
   <div class="hsum"><div class="hs big"><b>${pct1(H.hits, H.n)}</b><small>celkem · ${H.n.toLocaleString('cs-CZ')}</small></div>${surf}</div>
   <h3>Podle turnaje</h3>
   <p class="note">Jen turnaje s aspoň ${H.min_n} zápasy v tomhle okně, včetně kvalifikace. Seřazeno podle počtu zápasů.</p>
   <div class="hits">${(H.tournaments || []).map(row).join('')}</div>
   ${H.other && H.other.n ? `<p class="note">Dalších ${H.other.tournaments} turnajů má méně než ${H.min_n} zápasů (${H.other.n.toLocaleString('cs-CZ')} zápasů dohromady, úspěšnost ${pct1(H.other.hits, H.other.n)}). Malý počet zápasů úspěšnost rozhází, proto nejsou v seznamu.</p>` : ''}
   </div>`;
}
function renderModel() {
  if (S.hits == null && !S.hitsP) S.hitsP = getJSON('data/hits.json').then(h => { S.hits = h; if ((location.hash || '').slice(1) === 'model') renderModel(); }).catch(() => { S.hits = false; });
  const m = S.meta, mt = m.metrics; const v = $('#v-model');
  const tbl = (k, title) => { const r = mt.metrics[k]; if (!r) return ''; const ks = ['rank_baseline', 'elo_only', 'gelo_only', 'logreg', 'old_model', 'v1_newdata', 'ensemble'].filter(x => r[x]);
    const best = { acc: Math.max(...ks.map(x => r[x].acc)), logloss: Math.min(...ks.map(x => r[x].logloss)), brier: Math.min(...ks.map(x => r[x].brier)) };
    return `<h3>${title} <small class="note">(n = ${r.lightgbm.n.toLocaleString('cs-CZ')})</small></h3><table><tr><th>Model</th><th>Přesnost</th><th>Log loss</th><th>Brier</th></tr>${ks.map(x => `<tr><td>${MODEL_CS[x]}</td><td class="${r[x].acc === best.acc ? 'best' : ''}">${(r[x].acc * 100).toFixed(1)} %</td><td class="${r[x].logloss === best.logloss ? 'best' : ''}">${r[x].logloss.toFixed(3)}</td><td class="${r[x].brier === best.brier ? 'best' : ''}">${r[x].brier.toFixed(3)}</td></tr>`).join('')}</table>`; };
  const SRC = { sackmann: 'Sackmann (archiv)', tml: 'TennisMyLife', flashscore: 'Flashscore (build)' };
  const cov = Object.entries(m.coverage).map(([k, by]) => { const [g, grp] = k.split('_');
    return `<tr><td>${g === 'M' ? 'Muži' : 'Ženy'} – ${GRP_CS[grp]}</td><td>${Object.entries(by).map(([s, [a, b, n]]) => `${SRC[s] || s}: ${a.slice(0, 4)}–${b.slice(6, 8)}.${b.slice(4, 6)}.${b.slice(0, 4)} (${n.toLocaleString('cs-CZ')})`).join('<br>')}</td></tr>`; }).join('');
  const L = S.live;
  v.innerHTML = `<div class="ph"><h1>MODEL</h1></div><div class="card"><h2>O modelu</h2>
   <p>Model předpovídá pravděpodobnost výhry ve dvouhře pro <b>všechny úrovně</b>: Grand Slamy, ATP/WTA, Challengery, WTA 125, ITF/Futures i kvalifikace. Příznaky pro každý zápas se počítají jen z předchozích zápasů: Elo celkové a podle povrchu (K-faktor podle úrovně turnaje), žebříček a body, forma, H2H, věk, výška, ruka, únava, úspěšnost na povrchu, klouzavé statistiky podání/příjmu a úroveň turnaje. Pořadí hráčů je náhodné; predikce je symetrizovaná.</p><p><b>Verze 2</b> přidává Elo počítané z podílu vyhraných gemů (zohlední, jak přesvědčivě hráč vyhrál/prohrál), totéž podle povrchu, časově váženou formu (poločas ~1 měsíc), formu za 60 dní, nejistotu ratingu ve stylu Glicko (málo zápasů / dlouhá pauza), neaktivitu a součet bodů na podání+příjmu. Hyperparametry a kalibrace laděny jen na validaci (2. pol. 2025).</p><p>Předzápasová pravděpodobnost se po každém dohraném zápase o kousek posune — jeden online krok, ne nový strom. Starší výsledky zůstávají v nedělním modelu. Dnešní běh už započítal +19. U ATP, WTA, Challengeru a grandslamu se před zápasem zobrazená šance na zápas a na 1. set navíc posouvá podle aktuálních kurzů (jen část rozdílu proti trhu bez marže) a podle zpráv ESPN o odhlášení nebo zranění. Ten posun se zapíše do vlastních vah a u dalších zápasů těch hráčů zůstane. Stromy ani krok z dohraného zápasu se tím nemění. Když kurz není, zůstává model. ITF se tak neposouvá. Živá predikce u ATP, WTA a Challengeru vychází z předzápasové šance a skóre (sety, gemy, body, podání, brejk nebo udržení) a posune se po gemu, brejku, setu a po dohrání. Odhad, kdo vezme hraný gem, používá stejné vstupy a po každém dohraném gemu stejný krok. Šance na set je vlastní číslo, ne kopie šance na zápas. Před zápasem vychází z naučených vah setu a po dohraném setu se přenese do dalšího zápasu. Během setu se šance na ten set i na další set posouvají podle gemů, bodů, brejků a síly soupeře.</p>
   <div class="kv"><div>Poslední datum v datech buildu</div><div><b>${fmtDate(m.day_end)}</b></div><div>Build</div><div>${esc(m.built)}${m.mode === 'daily-incremental' ? ' <small class="note">(automatická denní aktualizace GitHub Actions, ~05:17 a ~17:17)</small>' : ''}</div>${m.update ? `<div>Poslední aktualizace</div><div>+${m.update.applied} zápasů${m.update.new_players ? `, ${m.update.new_players} nových hráčů` : ''}</div>` : ''}${m.full_build ? `<div>Plná přestavba a trénink</div><div>${esc(m.full_build)}</div>` : ''}
   <div>Trénink</div><div>${esc(mt.split.train)} (${mt.split.n_train.toLocaleString('cs-CZ')})</div><div>Validace</div><div>${esc(mt.split.valid)} (${mt.split.n_valid.toLocaleString('cs-CZ')})</div>
   <div>Refit (nasazený model)</div><div>${esc(mt.split.refit || '—')}</div><div>Holdout (mimo vzorek)</div><div>${esc(mt.split.test)} (${mt.split.n_test.toLocaleString('cs-CZ')})</div><div>Stromů LightGBM</div><div>${mt.gbm_trees}</div></div></div>
   <div class="card"><h2>Úspěšnost na holdoutu 2026</h2><p class="note">Všechny modely hodnoceny na stejných zápasech od 1. 1. 2026, které žádný z nich neviděl. Původní v1 = dosud nasazený model (trénink do 2024).</p>${tbl('overall', 'Celkem')}${tbl('tour', 'Hlavní okruh ATP/WTA')}${tbl('chall', 'Challenger / WTA 125')}${tbl('itf', 'ITF / Futures')}${tbl('qual', 'Kvalifikace')}
   <p class="note">Přesnost = podíl správně tipnutých vítězů. Log loss a Brier: nižší = lépe kalibrované pravděpodobnosti. Baseline = logistický model jen z pozic v žebříčku.</p>
   <details><summary>Podle pohlaví</summary>${['M_tour', 'W_tour', 'M_chall', 'W_chall', 'M_itf', 'W_itf'].map(k => tbl(k, (k[0] === 'M' ? 'Muži – ' : 'Ženy – ') + GRP_CS[k.slice(2)])).join('')}</details>
   <details><summary>Kalibrace</summary><table><tr><th>Předpověď</th><th>n</th><th>Průměr předp.</th><th>Skutečnost</th></tr>${mt.calibration.map(c => `<tr><td>${c.bin}</td><td>${c.n}</td><td>${c.pred ?? '—'}</td><td>${c.obs ?? '—'}</td></tr>`).join('')}</table></details>
   <details><summary>Nejdůležitější příznaky (LightGBM)</summary><table>${mt.importance.slice(0, 15).map(([f, g]) => `<tr><td>${esc(FEAT_CS[f] || f)}</td><td>${(g * 100).toFixed(1)} %</td></tr>`).join('')}</table></details></div>
   ${retrainCard(m)}
   ${hitsCard()}
   <div class="card"><h2>Data</h2><table><tr><th>Kategorie</th><th style="text-align:left">Zdroj: rozsah (počet zápasů)</th></tr>${cov}</table>
   <p class="note">Sackmannovy repozitáře tennis_atp/tennis_wta jsou od léta 2026 offline; použit veřejný archiv (snapshot do ${fmtDate(m.gap_start)}). ATP/WTA okruh a Challengery jsou doplněny z TennisMyLife až do buildu. ITF, WTA 125 a kvalifikace Challengerů mají mezeru mezi snapshotem a posledními 7 dny před buildem (u těchto hráčů je neutralizována únava).</p></div>
   <div class="card"><h2>Živá data a aktualizace</h2>
   <p><b>Při otevření</b> aplikace v prohlížeči (bez klíčů) stáhne rozpis a výsledky (±2 dny, výsledky ~7 dní zpět) a z nových výsledků <b>přepočítá Elo</b>, formu, únavu a H2H. <b>Živé skóre</b> se nejdřív ukáže ze snímku buildu, potom se doplní z feedů. ATP/WTA (ESPN) se obnovuje asi každých 15 s, body a gemy (365scores) asi každých 8 s, ITF (Sofascore, pokud z dané sítě odpovídá) každých 20 s — jen dokud je vidět seznam zápasů nebo detail. Dokončený zápas se hned započte do Elo a jedním krokem doladí předzápasový model (váhy logistické korekce, stromy se nemění). Velké přetrénování stromů zůstává v neděli. Stejný krok dělá i denní aktualizace ~05:17 a ~17:17, takže doladění platí i pro ostatní. Predikce se počítají přímo v telefonu.</p>
   <div class="kv"><div>ESPN – živé skóre ATP/WTA (+ část WTA 125)</div><div>${L.espn ? '✅ funguje' : '⚠️ nedostupné'}${L.polls ? ` · ${L.polls}× obnoveno` : ''}</div>
   <div>365scores – živé skóre Challenger/WTA 125</div><div>${S.l365.ok && !S.l365.err ? '✅ funguje' : S.l365.err ? '⚠️ nedostupné' : '…'}${S.l365.polls ? ` · ${S.l365.polls}× obnoveno, ${S.l365.upd} změn skóre` : ''}</div>
   <div>Sofascore (všechny úrovně)</div><div>${L.sofa ? '✅ funguje' : '⚠️ z této sítě blokováno'}</div>
   <div>Snímek z buildu (Flashscore, Challenger/ITF + kurzy)</div><div>${esc(L.snapshot || '—')}</div>
   <div>Kurzy Flashscore (předzápas oce + v průběhu ole, CORS)</div><div>${L.oddsOk ? `✅ načteno ${L.oddsOk}×${L.oddsLive ? `, z toho ${L.oddsLive}× v průběhu` : ''}` : L.oddsErr ? '⚠️ nedostupné – použit snímek' : 'načítají se u zobrazených zápasů'}</div>
   <div>Dokončené zápasy z živých zdrojů</div><div>${L.finished}</div><div>Už obsaženo v buildu / duplicity</div><div>${L.dup}</div>
   <div>Nově započteno do Elo</div><div>${L.applied}</div><div>Doladění modelu z výsledků od nedělního přepočtu</div><div>${(S.online && S.online.n) || 0}</div><div>Neznámí hráči v živých datech</div><div>${L.unknown}</div></div>
   <p class="note">Flashscore feed pokrývá všechny úrovně, ale vyžaduje hlavičku x-fsign a CORS preflight povoluje jen vlastním doménám Flashscore – z prohlížeče proto nejde. Živé Challenger/WTA 125 bere aplikace z 365scores (CORS *), ITF ze Sofascore (funguje z běžných sítí, z datacenter ne); jinak ITF jen ze snímku buildu. Kurzy Flashscore CORS povolují, ale potřebují ID zápasu ze snímku; zápasy ESPN se se snímkem párují podle dvojice hráčů. Bez nového buildu se neaktualizuje žebříček a statistiky podání/příjmu. Předzápasový model se z dohraného zápasu doladí hned (a znovu v denním buildu); stromy LightGBM se přepočítají až v neděli.</p></div>
   <div class="card"><h2>Kurzy a zodpovědné hraní</h2><p>„Value“ se zvýrazní jen před začátkem zápasu a jen z předzápasových kurzů (živý kurz v průběhu se nepočítá). Model musí být nad trhem (průměrný kurz bez marže) aspoň o ${VALUE_TH * 100} procentních bodů, očekávaná návratnost při nejlepším kurzu aspoň ${VALUE_EV * 100} % a průměr musí být aspoň ze ${VALUE_N} kanceláří. Práh je přísný schválně: model se od trhu liší v průměru o ~8 p. b. Na testu 2025–26 má přesnost ~70 %; trh bývá přesnější, protože vidí informace, které model nemá.</p>
   <p class="note gam">18+ Aplikace není sázková kancelář ani sázkové poradenství. Sázení je riskantní a může vést k závislosti. Sázejte jen částky, které si můžete dovolit prohrát, stanovte si limity a při potížích vyhledejte odbornou pomoc.</p></div>
   <div class="card"><p class="note">Zdroje: Jeff Sackmann – tennis_atp / tennis_wta (CC BY-NC-SA 4.0, archiv Aneeshers/tennis-sackmann-archive), TennisMyLife (stats.tennismylife.org), veřejný feed a kurzové srovnání Flashscore, ESPN (živé skóre, fotky hráčů), vlajky flagcdn.com. Aplikace je nekomerční. Predikce jsou odhady, ne záruky.</p></div>`;
}

/* ---------- router a události ---------- */
const VIEWS = ['zapasy', 'oblibene', 'predikce', 'hraci', 'model', 'chat'];
function route() {
  let v = (location.hash || '#zapasy').slice(1); if (!VIEWS.includes(v)) v = 'zapasy';
  for (const s of document.querySelectorAll('.view')) s.hidden = s.id !== 'v-' + v;
  for (const a of document.querySelectorAll('.tabs a')) a.classList.toggle('on', a.dataset.v === v);
  if (!S.meta) return;
  if (v === 'zapasy') renderMatches(); else if (v === 'oblibene') renderFav(); else if (v === 'predikce') renderPredict(); else if (v === 'hraci') { if (!$('#hs')) renderPlayers(); } else if (v === 'model') renderModel(); else if (v === 'chat' && typeof renderChat === 'function') renderChat();
}
function goProfile(i) { if (S.detail) closeDetail(); setTimeout(() => { location.hash = '#hraci'; if (!$('#hs')) renderPlayers(); $('#hs').value = pName(i); showProfile(i, $('#hp')); }, S.detail ? 50 : 0); }
document.addEventListener('click', async ev => {
  const t = ev.target;
  if (t.closest('.close') || t.id === 'modal') { $('#modal').hidden = true; return; }
  if (t.closest('#detail .back')) { closeDetail(); return; }
  const pcm = t.closest('[data-pc]'); if (pcm) { ev.stopPropagation(); perfInfo(pcm.dataset.pc, +pcm.dataset.k); return; }
  const fsb = t.closest('[data-fsel]'); if (fsb) { ev.stopPropagation(); const sg = fsb.parentElement; const fc = document.getElementById(sg.dataset.fseg); for (const b of sg.children) b.classList.toggle('on', b === fsb); if (fc) { fc.classList.toggle('only0', fsb.dataset.fsel === '0'); fc.classList.toggle('only1', fsb.dataset.fsel === '1'); } return; }
  const fv = t.closest('[data-fav]'); if (fv) { ev.stopPropagation(); toggleFav(+fv.dataset.fav); if ((location.hash || '').includes('oblibene') && !S.detail) renderFav(); return; }
  const dt = t.closest('[data-dtab]'); if (dt) { showDTab(dt.dataset.dtab); return; }
  const ch = t.closest('[data-day]'); if (ch) { S.filt.day = +ch.dataset.day; renderMatches(); return; }
  if (t.closest('#f-fav')) { S.filt.favOnly = !S.filt.favOnly; renderMatches(); return; }
  const pr = t.closest('[data-prof]'); if (pr) { goProfile(+pr.dataset.prof); return; }
  const m = t.closest('.mr[data-ev]'); if (m) { openEvent(m.dataset.ev); return; }
  const cm = t.closest('[data-cmp]'); if (cm) { const i = +cm.dataset.cmp; if (S.pred.a === null || S.pred.a === i) S.pred.a = i; else S.pred.b = i; location.hash = '#predikce'; return; }
});
document.addEventListener('change', ev => {
  if (ev.target.id === 'f-tour') { S.filt.tour = ev.target.value; renderMatches(); }
  if (ev.target.id === 'f-st') { S.filt.st = ev.target.value; renderMatches(); }
});
window.addEventListener('hashchange', route);
window.addEventListener('popstate', () => { if (S.detail) closeDetail(true); });
document.addEventListener('visibilitychange', () => { if (document.hidden) return;
  if (!S.live.last || Date.now() - S.live.last > REFRESH_MS - 4000) refreshLive();
  if (Date.now() - (S.l365.last || 0) > LOW_MS - 2000) lowTick();
  if (S.live.sofa && Date.now() - (S.live.sofaAt || 0) > SOFA_MS - 3000) sofaTick(); });

async function init() {
  loadFav(); route();
  const st = $('#status');
  try {
    const [meta, idx, model] = await Promise.all(['data/meta.json', 'data/players.json', 'data/model.json'].map(u => fetch(u).then(r => { if (!r.ok) throw new Error(u); return r.json(); })));
    S.meta = meta; S.idx = idx; S.N = idx.id.length; S.model = new TM.Model(model); S.extraKey = {};
    try { attachOnline(await getJSON('data/online.json')); } catch (e) { S.online = null; }
    attachMkt();
    try { attachLive(await getJSON('data/live_online.json')); } catch (e) { attachLive(null); }
    S.idMap = new Map(idx.id.map((x, i) => [String(x), i]));
    S.E = idx.e.slice(); S.SE = idx.se.map(x => x.slice()); S.GE = (idx.ge || idx.e).slice(); S.GSE = (idx.gse || idx.se).map(x => x.slice()); S.K = idx.k.slice(); S.SK = idx.sk.map(x => x.slice());
    S.norm = idx.n.map(n => toks(n).join(' '));
    S.ro = idx.ro.map(s => s ? s.split(';').map(t => { const [o, d] = t.split(','); return [+o, meta.day_end - (+d)]; }) : []);
    S.matcher = new Matcher(); for (let i = 0; i < S.N; i++) S.matcher.add(i, idx.g[i], idx.n[i], -idx.l[i]);
    try { S.tours = await getJSON('data/tournaments.json'); } catch (e) { S.tours = {}; }
    st.textContent = `Data do ${fmtDate(meta.day_end)} · snímek zápasů…`;
    cleanCache();
    await showSnapshotFirst();
    updateStatus();
    route();
    fillLive();
    setInterval(() => refreshLive(), REFRESH_MS);
    setInterval(oddsTick, 20000);
    const NEWS = t => `https://site.api.espn.com/apis/site/v2/sports/tennis/${t}/news?limit=25`;
    async function pollNews() {
      if (!S.mkt || typeof MK === 'undefined') return;
      const arts = [];
      for (const t of ['atp', 'wta']) { try { const j = await getJSON(NEWS(t), 12000); if (j && j.articles) arts.push(...j.articles); } catch (e) { S.mkt.newsErr = (S.mkt.newsErr || 0) + 1; } }
      if (!arts.length) return;
      S.newsArts = arts;
      for (const e of (S.all || [])) { if (!marketOn(e)) continue; e._mb = null; try { syncMarket(e); } catch (err) {} }
      for (const e of (S.all || [])) if (marketOn(e)) updateRowProb(e);
      if (S.detail) { const e = S.byId[S.detail.id]; if (e && e.st === 1) paintLivePred(e); }
    }
    pollNews();
    setInterval(pollNews, 180000);
    setInterval(() => lowTick(), LOW_MS);
    setInterval(() => sofaTick(), SOFA_MS);
  } catch (e) { st.textContent = 'Chyba načítání: ' + e.message; console.error(e); }
}
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => { }));
init();
