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
          live: st === 2 ? (m ? m[1] + '. set' : 'Živě') : '', src: 'ESPN' });
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
        sets: [1, 2, 3, 4, 5].map(k => [e.homeScore?.['period' + k], e.awayScore?.['period' + k]]).filter(x => x[0] != null && x[1] != null), live: ty === 'inprogress' ? 'Živě' : '', h: P(e.homeTeam), a: P(e.awayTeam), g, lvl: code >= 4 ? 'A' : code === 3 ? 'CH' : 'ITF', code, q, surface, tname: (un.name || tn).replace(/, Qualifying.*$/i, ''), src: 'Sofascore' });
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
      hi: m.hi ?? null, ai: m.ai ?? null, oddsV: m.odds ? { avg: [m.odds[0], m.odds[1]], max: [m.odds[2], m.odds[3]], n: m.odds[4], snap: true } : null, src: 'snapshot' }));
  } catch (e) { return []; }
}

/* ---------- slučování událostí z více zdrojů ---------- */
const RANK = { ESPN: 3, Sofascore: 2, snapshot: 1 };
const nowS = () => Date.now() / 1000;
const dayOff = ts => Math.floor((ts - new Date(ts * 1000).getTimezoneOffset() * 60) / 86400) - todayDay();
function flipSets(s) { return (s || []).map(x => x.length > 2 ? [x[1], x[0], x[3], x[2]] : [x[1], x[0]]); }
function mergeInto(ex, e, sw) {
  // sw = zdroj má hráče v opačném pořadí
  let changed = false;
  const sets = sw ? flipSets(e.sets) : e.sets, win = sw ? (e.win === 1 ? 2 : e.win === 2 ? 1 : 0) : e.win;
  const H = sw ? e.a : e.h, A = sw ? e.h : e.a;
  if (RANK[e.src] >= RANK[ex.src] || (ex.src === 'snapshot' && e.st > ex.st)) {
    if (ex.st !== e.st || JSON.stringify(ex.sets) !== JSON.stringify(sets) || ex.win !== win) changed = true;
    Object.assign(ex, { st: e.st, det: e.det, win, sets, ts: e.ts, live: e.live || '', stale: false });
    if (e.round) ex.round = e.round;
    if (RANK[e.src] > RANK[ex.src]) { ex.src2 = ex.src; ex.src = e.src; }
  }
  for (const [x, y] of [[ex.h, H], [ex.a, A]]) { if (y.eid && !x.eid) x.eid = y.eid; if (y.pid && !x.pid) x.pid = y.pid; if (y.c && !x.c) x.c = y.c; }
  if (e.fsid && !ex.fsid) { ex.fsid = e.fsid; ex.country = ex.country || e.country; }
  if (e.oddsV && !ex.oddsV) { const o = e.oddsV; ex.oddsV = sw ? { ...o, avg: [o.avg[1], o.avg[0]], max: [o.max[1], o.max[0]] } : o; }
  return changed;
}
function addEvent(e) {
  const r = resolveEv(e); const pk = Math.min(r.hi, r.ai) + ':' + Math.max(r.hi, r.ai);
  const arr = S.pair[pk] || (S.pair[pk] = []);
  const ex = arr.find(x => Math.abs(x.ts - e.ts) < 30 * 3600) || S.byId[e.id];
  if (ex) { const sw = resolveEv(ex).hi !== r.hi; return { ex, changed: mergeInto(ex, e, sw) }; }
  e.sets = e.sets || []; arr.push(e); S.byId[e.id] = e; S.all.push(e);
  for (const [p, i] of [[e.h, r.hi], [e.a, r.ai]]) if (p.eid) S.eid[i] = p.eid;
  return { ex: e, changed: true, isNew: true };
}
function markStale() {
  const t = nowS();
  for (const e of S.all) if (e.src === 'snapshot' && ((e.st === 1 && e.ts < t - 1200) || e.st === 2)) e.stale = true;
}
async function loadLive() {
  const [es, so, sn] = await Promise.all([loadESPN().catch(e => ({ ok: false, ev: [] })), loadSofa().catch(e => ({ ok: false, ev: [] })), loadSnapshot()]);
  S.live.espn = es.ok; S.live.sofa = so.ok; S.live.ok = es.ok || so.ok; S.live.last = Date.now();
  // výsledky -> Elo (duplicitní zápasy z více zdrojů i zápasy obsažené v buildu se odfiltrují)
  applyLive([...so.ev, ...es.ev]);
  S.all = []; S.byId = {}; S.pair = {};
  for (const e of [...es.ev, ...so.ev, ...sn]) { const d = dayOff(e.ts); if (d < -2 || d > 2) continue; addEvent(e); }
  markStale();
  for (const e of S.all) if (e.st === 3) S.finSeen.add(e.id);
  S.live.srcCount = {}; for (const e of S.all) S.live.srcCount[e.src] = (S.live.srcCount[e.src] || 0) + 1;
}
/* živé obnovování skóre (ESPN) každých 45 s, když je stránka viditelná */
const REFRESH_MS = 45000;
async function refreshLive(force) {
  if (!S.all || S.refreshing || (document.hidden && !force)) return;
  S.refreshing = true;
  try {
    const res = await Promise.allSettled(['atp', 'wta'].map(t => getJSON(ESPN(t), 12000).then(j => espnEvents(j, t))));
    const evs = res.filter(r => r.status === 'fulfilled').flatMap(r => r.value);
    if (!res.some(r => r.status === 'fulfilled')) { S.live.err = 'ESPN nedostupné'; updateStatus(); return; }
    S.live.err = null; S.live.espn = true; let changed = false; const newFin = [];
    for (const e of evs) { const d = dayOff(e.ts); if (d < -2 || d > 2) continue; const r = addEvent(e); if (r.changed) changed = true;
      if (r.ex.st === 3 && !S.finSeen.has(r.ex.id)) { S.finSeen.add(r.ex.id); newFin.push(e); } }
    if (newFin.length) { applyLive(newFin); S.predCache = {}; }
    S.live.last = Date.now(); S.live.polls = (S.live.polls || 0) + 1; updateStatus();
    if (changed || newFin.length) onLiveChange(newFin.length);
  } finally { S.refreshing = false; }
}

/* ---------- živé kurzy: Flashscore odds (global.ds.lsapp.eu, CORS *, bez klíče) ---------- */
const ODDS_URL = id => `https://global.ds.lsapp.eu/odds/pq_graphql?_hash=oce&eventId=${encodeURIComponent(id)}&projectId=2&geoIpCode=CZ&geoIpSubdivisionCode=CZ10`;
const ODDS_TTL = 5 * 60 * 1000, VALUE_TH = 0.10, VALUE_EV = 0.03;
function parseOdds(j, e) {
  const f = j?.data?.findOddsByEventId; if (!f) return null;
  const names = {}; for (const b of (f.settings?.bookmakers || [])) if (b.bookmaker) names[b.bookmaker.id] = b.bookmaker.name;
  const books = [];
  for (const o of (f.odds || [])) {
    if (o.bettingType !== 'HOME_AWAY' || o.bettingScope !== 'FULL_TIME') continue;
    const it = (o.odds || []).filter(x => x.value && x.active !== false); if (it.length < 2) continue;
    let h = it.find(x => x.eventParticipantId && x.eventParticipantId === e.h.pid), a = it.find(x => x.eventParticipantId && x.eventParticipantId === e.a.pid);
    if (!h || !a) { if (e.h.pid || e.a.pid) continue; [h, a] = it; }
    const vh = parseFloat(h.value), va = parseFloat(a.value); if (!(vh > 1 && va > 1)) continue;
    books.push({ name: names[o.bookmakerId] || ('#' + o.bookmakerId), h: vh, a: va, oh: parseFloat(h.opening) || null, oa: parseFloat(a.opening) || null });
  }
  if (!books.length) return { books, n: 0, t: Date.now() };
  const avg = [0, 1].map(k => books.reduce((s, b) => s + (k ? b.a : b.h), 0) / books.length);
  const max = [Math.max(...books.map(b => b.h)), Math.max(...books.map(b => b.a))];
  const ob = books.filter(b => b.oh && b.oa);
  const openAvg = ob.length ? [ob.reduce((s, b) => s + b.oh, 0) / ob.length, ob.reduce((s, b) => s + b.oa, 0) / ob.length] : null;
  return { books, avg, max, openAvg, n: books.length, t: Date.now(), live: true };
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
  if (!e.fsid) return Promise.resolve(e.oddsV);
  const c = S.odds[e.fsid]; if (c && Date.now() - c.t < ttl) return c.p;
  const p = new Promise((res) => { const job = () => { oddsRun++;
      getJSON(ODDS_URL(e.fsid), 12000).then(j => { const o = parseOdds(j, e);
          if (o && o.n) { e.oddsV = diffOdds(o, e.oddsV); S.live.oddsOk = (S.live.oddsOk || 0) + 1; } else if (o) { e.oddsNone = true; } res(e.oddsV); })
        .catch(err => { S.live.oddsErr = (S.live.oddsErr || 0) + 1; delete S.odds[e.fsid]; res(e.oddsV); })
        .finally(() => { oddsRun--; const n = oddsQ.shift(); if (n) n(); }); };
    if (oddsRun < 3) job(); else prio ? oddsQ.unshift(job) : oddsQ.push(job); });
  S.odds[e.fsid] = { t: Date.now(), p }; return p;
}
function implied(o) { if (!o || !o.avg) return null; const ih = 1 / o.avg[0], ia = 1 / o.avg[1]; return { p: ih / (ih + ia), margin: ih + ia - 1 }; }
function valueOf(e) {
  if (e.st !== 1 || e._p == null || !e.oddsV || !e.oddsV.avg) return null;
  const o = e.oddsV, im = implied(o); const d = e._p - im.p;
  // kurz < 1.05 = zápas nejspíš už běží / kurz je zastaralý → value nehodnotíme
  if (Math.min(o.avg[0], o.avg[1]) < 1.05) return { im: im.p, margin: im.margin, edge: d, side: 0, stale: true };
  const evH = e._p * o.max[0] - 1, evA = (1 - e._p) * o.max[1] - 1;
  return { im: im.p, margin: im.margin, edge: d, evH, evA, side: d >= VALUE_TH && evH >= VALUE_EV ? 1 : -d >= VALUE_TH && evA >= VALUE_EV ? 2 : 0 };
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

/* ---------- živé výsledky -> Elo ---------- */
function applyLive(evs) {
  const fin = evs.filter(e => e.st === 3 && (e.det === 3 || e.det === 8) && (e.win === 1 || e.win === 2)).sort((a, b) => a.ts - b.ts);
  const seen = new Set(); const ro = S.ro;
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
    const r = resolveEv(e); try { e._p = predict(r.hi, r.ai, e.surface, e.code, e.q).p; e._pg = S.predGen; } catch (err) { }
  }
}

/* ---------- řádek zápasu ---------- */
function scoreCells(e, side) {
  const cur = e.st === 2 ? e.sets.length - 1 : -1;
  return e.sets.map((s, k) => { const me = s[side], ot = s[1 - side]; const won = e.st === 3 || k < cur ? me > ot : false;
    const tb = s.length > 2 && Math.min(me, ot) >= 6 ? `<sup>${s[2 + side]}</sup>` : '';
    return `<span class="g ${won ? 'w' : ''} ${k === cur ? 'cur' : ''}">${me}${tb}</span>`; }).join('');
}
function statusCell(e) {
  if (e.st === 2 && !e.stale) return `<span class="lv"><i class="play">▶</i>${esc(e.live || 'Živě')}</span>`;
  if (e.st === 3) return `<span class="fin">${e.det === 8 ? 'Skreč' : 'Konec'}</span>`;
  if (e.stale) return `<span class="tm">${hm(e.ts)}</span><span class="stl" title="Pro tuto úroveň nejsou živá data">bez živých dat</span>`;
  return `<span class="tm">${hm(e.ts)}</span>`;
}
/* šipka u kurzu: poslední změna od minulého načtení (výrazná), jinak změna od otevření (slabší). Zelená ▲ = kurz roste, červená ▼ = klesá */
function arrowOf(o, k) {
  const ld = o.lastDir ? o.lastDir[k] : 0;
  if (ld) return `<i class="ar ${ld > 0 ? 'up' : 'dn'} last" title="od posledního načtení">${ld > 0 ? '▲' : '▼'}</i>`;
  const od = o.openAvg ? sgn(o.avg[k], o.openAvg[k]) : 0;
  return od ? `<i class="ar ${od > 0 ? 'up' : 'dn'}" title="od otevření">${od > 0 ? '▲' : '▼'}</i>` : '<i class="ar"></i>';
}
function oddsHtml(e) {
  if (e.st === 3) return '';
  const o = e.oddsV;
  if (!o || !o.avg) {
    if (e.st !== 1 || !e.fsid) return '';
    // rezervované místo (žádný posun layoutu, až kurzy dorazí)
    return `<div class="odds ph"><span class="od" data-k="1"><span class="v">${e.oddsNone ? '—' : '···'}</span><i class="ar"></i></span><span class="ol">${e.oddsNone ? 'bez kurzů' : 'kurzy…'}</span><span class="od" data-k="2"><span class="v">${e.oddsNone ? '—' : '···'}</span><i class="ar"></i></span></div>`;
  }
  const v = valueOf(e);
  const c = k => `<span class="od ${v && v.side === k ? 'val' : ''}" data-k="${k}"><span class="v">${o.avg[k - 1].toFixed(2)}</span>${arrowOf(o, k - 1)}${v && v.side === k ? '<em>VALUE</em>' : ''}</span>`;
  return `<div class="odds">${c(1)}<span class="ol">kurz ⌀ ${o.n}× ${o.live ? '<i class="dot"></i>' : ''}</span>${c(2)}</div>`;
}
function probHtml(e) {
  if (e.st === 3 || e._p == null) return '';
  const p = e._p;
  return `<div class="pb"><span class="pa ${p >= 0.5 ? 'fv' : ''}">${pct(p)}</span><div class="bar"><i style="width:${(p * 100).toFixed(1)}%"></i></div><span class="pc ${p < 0.5 ? 'fv' : ''}">${pct(1 - p)}</span></div>`;
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
  const { dayEv, base } = matchSel();
  await probsFor(base.filter(e => e.st !== 3));
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
  h += `<p class="note">Zdroje: ${Object.entries(sc).map(([k, n]) => `${k === 'snapshot' ? 'snímek z buildu ' + esc(S.live.snapshot || '') : k} (${n})`).join(', ') || '—'}. Živé skóre ATP/WTA z ESPN se obnovuje každých 45 s. Challenger/ITF jen ze snímku buildu. Procenta = odhad modelu před zápasem.</p>
   <p class="note gam">18+ Kurzy slouží jen pro srovnání s modelem. Sázení je riskantní a může vést k závislosti – hrajte zodpovědně, jen s penězi, které si můžete dovolit prohrát.</p>`;
  v.innerHTML = h;
  if (keep) window.scrollTo(0, y);
  observeOdds(v);
}
/* živé kurzy: viditelné řádky (IntersectionObserver) se obnovují každých ~60 s, otevřený detail každých ~20 s */
const ODDS_VIS_TTL = 60000, ODDS_OPEN_TTL = 20000;
let oddsObs = null;
function observeOdds(root) {
  if (!('IntersectionObserver' in window)) return;
  if (!oddsObs) oddsObs = new IntersectionObserver(ents => { for (const en of ents) { const id = en.target.dataset.ev;
      if (!en.isIntersecting) { S.visible.delete(id); continue; }
      S.visible.add(id); const e = S.byId[id]; if (!e || e.st !== 1 || !e.fsid) continue;
      if (e.oddsV && e.oddsV.live && Date.now() - e.oddsV.t < ODDS_VIS_TTL) continue;
      fetchOdds(e, false, ODDS_VIS_TTL).then(() => updateRowOdds(e)); } }, { rootMargin: '150px' });
  for (const el of root.querySelectorAll('.mr[data-fs]')) oddsObs.observe(el);
}
function oddsTick() {
  if (document.hidden || !S.all) return;
  if (S.detail) { const e = S.byId[S.detail.id]; if (e && e.fsid && e.st !== 3) fetchOdds(e, true, ODDS_OPEN_TTL).then(() => { updateRowOdds(e); refreshDetailOdds(e); }); }
  for (const id of [...S.visible]) { const e = S.byId[id]; if (!e || e.st !== 1 || !e.fsid) continue;
    if (!document.querySelector(`.mr[data-ev="${CSS.escape(id)}"]`)) { S.visible.delete(id); continue; }
    if (!e.oddsV || !e.oddsV.live || Date.now() - e.oddsV.t >= ODDS_VIS_TTL) fetchOdds(e, false, ODDS_VIS_TTL).then(() => updateRowOdds(e)); }
}
/* plynulá změna čísla (bez skoku) */
function tweenNum(el, to) {
  const from = parseFloat(el.textContent); if (!(from > 0) || Math.abs(from - to) < 0.005) { el.textContent = to.toFixed(2); return; }
  const t0 = performance.now(), D = 600;
  const step = t => { const k = Math.min(1, (t - t0) / D), ez = 1 - Math.pow(1 - k, 3); el.textContent = (from + (to - from) * ez).toFixed(2); if (k < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
function flash(el, dir) { if (!dir || !el) return; el.classList.remove('fl-up', 'fl-dn'); void el.offsetWidth; el.classList.add(dir > 0 ? 'fl-up' : 'fl-dn'); }
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
      const tmp = document.createElement('i'); tmp.innerHTML = arrowOf(o, k - 1); pill.querySelector('.ar').replaceWith(tmp.firstElementChild);
      const isVal = !!(v && v.side === k); pill.classList.toggle('val', isVal);
      const em = pill.querySelector('em'); if (isVal && !em) pill.insertAdjacentHTML('beforeend', '<em>VALUE</em>'); if (!isVal && em) em.remove();
      if (o.chg) flash(pill, o.chg[k - 1]);
    }
    const ol = box.querySelector('.ol'); if (ol) ol.innerHTML = `kurz ⌀ ${o.n}× ${o.live ? '<i class="dot"></i>' : ''}`;
  }
}
function refreshDetailOdds(e) {
  if (!S.detail || S.byId[S.detail.id] !== e) return;
  if (S.detail.tab === 'kurzy') { const r = resolveEv(e); const body = $('#d-body'); const y = $('#detail').scrollTop;
    body.innerHTML = oddsTab(e, dispName(r.hi, e.h), dispName(r.ai, e.a)); $('#detail').scrollTop = y; }
  else if (S.detail.tab === 'prehled') { const y = $('#detail').scrollTop; showDTab('prehled'); $('#detail').scrollTop = y; }
}
/* živá změna skóre: pokud se nezměnilo pořadí/sada zápasů, jen se „záplatují“ změněné řádky */
function onLiveChange(newFin) {
  const v = (location.hash || '#zapasy').slice(1);
  if (v === 'zapasy' && !document.querySelector('select:focus')) {
    const ids = [...document.querySelectorAll('#v-zapasy .mr')].map(x => x.dataset.ev);
    const want = matchListIds();
    if (ids.length && ids.join('|') === want.join('|')) {
      for (const el of document.querySelectorAll('#v-zapasy .mr')) { const e = S.byId[el.dataset.ev]; if (!e) continue;
        const h = mrowHtml(e); const mr = el.querySelector('.mrow'); if (mr._h !== h && mr.innerHTML !== h) { mr.innerHTML = h; mr._h = h; el.classList.add('upd'); setTimeout(() => el.classList.remove('upd'), 1200); }
        el.classList.toggle('islive', e.st === 2 && !e.stale);
        if (e.st === 3) { el.querySelector('.pb')?.remove(); el.querySelector('.odds')?.remove(); } }
    } else renderMatches(true);
  }
  if (v === 'oblibene') renderFav();
  if (S.detail) { const e = S.byId[S.detail.id]; if (e) { $('#d-score').innerHTML = scoreBlock(e); if (newFin && S.detail.tab === 'stat') showDTab('stat'); } }
  if (newFin && v === 'hraci' && S.profI != null && $('#hp .prof')) showProfile(S.profI, $('#hp'), true);
}
function updateStatus() {
  const st = $('#status'); if (!st || !S.meta) return;
  const L = S.live; const t = L.last ? new Date(L.last).toLocaleTimeString('cs-CZ') : '—';
  st.innerHTML = `${L.espn && !L.err ? '<i class="dot"></i>Živě' : '<i class="dot off"></i>Offline'} · aktualizováno ${t} · data do ${fmtDate(S.meta.day_end)}`;
}

/* ---------- detail zápasu ---------- */
function scoreBlock(e) {
  const hs = e.sets.filter((s, k) => (e.st === 3 || k < e.sets.length - 1) && s[0] > s[1]).length, as = e.sets.filter((s, k) => (e.st === 3 || k < e.sets.length - 1) && s[1] > s[0]).length;
  const big = e.st === 1 ? `<div class="big t">${hm(e.ts)}</div>` : `<div class="big">${hs}<span>:</span>${as}</div>`;
  const sets = e.sets.map(s => `${s[0]}–${s[1]}${s.length > 2 && Math.min(s[0], s[1]) >= 6 ? `<sup>${Math.min(s[2], s[3])}</sup>` : ''}`).join('  ');
  const stt = e.st === 2 && !e.stale ? `<span class="lv"><i class="play">▶</i>${esc(e.live || 'Živě')}</span>` : e.st === 3 ? (e.det === 8 ? 'Skreč' : 'Konec') : e.stale ? 'bez živých dat' : new Date(e.ts * 1000).toLocaleDateString('cs-CZ', { weekday: 'long', day: 'numeric', month: 'numeric' });
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
  if (e.fsid && e.st !== 3) fetchOdds(e, true).then(() => { if (S.detail && S.detail.id === id && S.detail.tab === 'prehled') showDTab('prehled'); updateRowOdds(e); });
}
function closeDetail(fromPop) { if (!S.detail) return; S.detail = null; $('#detail').hidden = true; document.body.classList.remove('noscroll'); if (!fromPop) history.back(); }
async function showDTab(k) {
  const e = S.byId[S.detail.id]; S.detail.tab = k; const r = resolveEv(e); const body = $('#d-body');
  for (const b of document.querySelectorAll('[data-dtab]')) b.classList.toggle('on', b.dataset.dtab === k);
  const na = dispName(r.hi, e.h), nb = dispName(r.ai, e.a);
  if (k === 'prehled') {
    const v = valueOf(e);
    let h = '';
    if (e.st !== 3 && e._p != null) h += `<div class="card"><h3>Predikce modelu</h3><div class="big2"><div><b class="a">${pct(e._p)}</b><small>${esc(na)}</small></div><div><b class="b">${pct(1 - e._p)}</b><small>${esc(nb)}</small></div></div><div class="bar lg"><i style="width:${(e._p * 100).toFixed(1)}%"></i></div>
      ${e.oddsV && e.oddsV.avg ? `<div class="kv2"><span>Průměrný kurz</span><b>${e.oddsV.avg[0].toFixed(2)} / ${e.oddsV.avg[1].toFixed(2)}</b><span>Trh (bez marže)</span><b>${v ? pct(v.im) + ' / ' + pct(1 - v.im) : '—'}</b></div>${v && v.side ? `<div class="valbox">VALUE: ${esc(v.side === 1 ? na : nb)} – model o ${(Math.abs(v.edge) * 100).toFixed(1)} p. b. výš než trh</div>` : ''}` : e.fsid && e.st === 1 ? '<p class="note">Načítám kurzy…</p>' : ''}
      <div class="row"><button class="btn sec" data-dtab="predikce">Podrobná predikce ›</button><button class="btn ai" data-ask="${esc(e.id)}">✦ Zeptat se AI</button></div></div>`;
    if (e.st === 3) h += `<div class="card"><h3>Výsledek</h3><p><b>${esc(e.win === 1 ? na : nb)}</b> vyhrál${e.g === 'W' ? 'a' : ''} ${e.sets.map(s => e.win === 1 ? `${s[0]}–${s[1]}` : `${s[1]}–${s[0]}`).join(', ')}${e.det === 8 ? ' (skreč)' : ''}.</p></div>`;
    if (e.sets.length) h += `<div class="card"><h3>Sety</h3><table class="st"><tr><th></th>${e.sets.map((s, k) => `<th>${k + 1}.</th>`).join('')}</tr>${[0, 1].map(sd => `<tr><td>${esc(sd ? nb : na)}</td>${e.sets.map(s => `<td class="${s[sd] > s[1 - sd] ? 'w' : ''}">${s[sd]}${s.length > 2 && Math.min(s[0], s[1]) >= 6 ? `<sup>${s[2 + sd]}</sup>` : ''}</td>`).join('')}</tr>`).join('')}</table></div>`;
    h += `<div class="card"><h3>Zápas</h3><div class="kv2"><span>Turnaj</span><b>${esc(e.tname)}${e.country ? ', ' + esc(e.country) : ''}</b><span>Kategorie</span><b>${esc(catLabel(e))}${e.q ? ' – kvalifikace' : ''}</b>
      <span>Povrch</span><b>${SURF_CS[e.surface]}</b><span>Začátek</span><b>${new Date(e.ts * 1000).toLocaleString('cs-CZ', { weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })}</b>
      <span>Zdroj dat</span><b>${esc(e.src === 'snapshot' ? 'snímek z buildu (Flashscore) ' + (S.live.snapshot || '') : e.src)}${e.src2 ? ' + ' + esc(e.src2 === 'snapshot' ? 'snímek (kurzy)' : e.src2) : ''}</b></div>
      <div class="row"><button class="btn sec" data-prof="${r.hi}">Profil ${esc(na)}</button><button class="btn sec" data-prof="${r.ai}">Profil ${esc(nb)}</button></div></div>`;
    if (e.st === 3 || e._p == null) h += `<button class="btn ai" data-ask="${esc(e.id)}">✦ Zeptat se AI na tento zápas</button>`;
    body.innerHTML = h;
  } else if (k === 'predikce') {
    body.innerHTML = (e.st === 3 ? '<div class="warn">Zápas už skončil. Model níže počítá s aktuálními daty, která mohou tento výsledek už obsahovat – nejde o předzápasový tip.</div>' : e.st === 2 ? '<div class="note">Předzápasová predikce (průběžné skóre model nezohledňuje).</div>' : '') + resultHtml(r.hi, r.ai, e.surface, e.code, e.q);
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
  if (!o || !o.avg) return `<div class="card"><h3>Kurzy</h3><p>${e.st === 3 ? 'Zápas skončil – kurzy už nejsou nabízeny.' : 'Sázkové kanceláře zatím na tento zápas kurzy nevypsaly.'}</p></div>${gam}`;
  const im = implied(o), p = e._p; const v = valueOf(e);
  const rows = (o.books || []).map(b => `<tr><td>${esc(b.name)}</td>${oddsCell(b.h, b.oh, b.lh, b.ch, b.h === o.max[0])}${oddsCell(b.a, b.oa, b.la, b.ca, b.a === o.max[1])}</tr>`).join('');
  const ev = (pp, odd) => ((pp * odd - 1) * 100).toFixed(1);
  return `<div class="card"><h3>Kurzy na vítěze (${o.live ? '<i class="dot"></i>živě, ' + new Date(o.t).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' }) : 'snímek z buildu ' + esc(S.live.snapshot || '')})</h3>
    <table class="ot"><tr><th>Sázková kancelář</th><th>${esc(na)}</th><th>${esc(nb)}</th></tr>${rows || `<tr><td colspan="3" class="note">Jednotlivé kanceláře jsou jen v živých datech.</td></tr>`}
    <tr class="sum"><td>Průměr (${o.n})</td>${oddsCell(o.avg[0], o.openAvg && o.openAvg[0], o.lastDir && o.lastDir[0], o.chg && o.chg[0])}${oddsCell(o.avg[1], o.openAvg && o.openAvg[1], o.lastDir && o.lastDir[1], o.chg && o.chg[1])}</tr><tr class="sum"><td>Nejlepší</td><td>${o.max[0].toFixed(2)}</td><td>${o.max[1].toFixed(2)}</td></tr></table>
    <p class="note"><i class="ar up">▲</i> kurz roste, <i class="ar dn">▼</i> klesá. 1. šipka = proti otevíracímu kurzu, 2. šipka v kroužku = proti naposledy načtené hodnotě. Obnovuje se automaticky každých ~20 s, dokud je detail otevřený. Zdroj: veřejné kurzové srovnání Flashscore (bez klíče), kanceláře pro CZ.</p></div>
    <div class="card"><h3>Model vs. trh</h3><table><tr><th></th><th>${esc(na)}</th><th>${esc(nb)}</th></tr>
    <tr><td>Implikovaná pravděpodobnost (bez marže)</td><td>${pct(im.p)}</td><td>${pct(1 - im.p)}</td></tr>
    ${p != null ? `<tr><td>Model</td><td><b>${pct(p)}</b></td><td><b>${pct(1 - p)}</b></td></tr><tr><td>Rozdíl model − trh</td><td class="${v && v.side === 1 ? 'best' : ''}">${((p - im.p) * 100).toFixed(1)} p. b.</td><td class="${v && v.side === 2 ? 'best' : ''}">${((im.p - p) * 100).toFixed(1)} p. b.</td></tr>
    <tr><td>Očekávaná návratnost při nejlepším kurzu</td><td>${ev(p, o.max[0])} %</td><td>${ev(1 - p, o.max[1])} %</td></tr>` : ''}</table>
    <div class="kv2"><span>Marže sázkových kanceláří</span><b>${(im.margin * 100).toFixed(1)} %</b><span>Práh pro „value“</span><b>model ≥ trh + ${VALUE_TH * 100} p. b. a návratnost ≥ ${VALUE_EV * 100} %</b></div>
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
function resultHtml(i, j, surface, code, q) {
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
  return `${warn}<div class="card"><div class="note">${esc(LVL_CS[code])} · ${SURF_CS[surface]}${q ? ' · kvalifikace' : ''} · na ${r.ctx.best_of} sety</div>
   <div class="big"><div><div class="p a">${pct(r.p)}</div><div class="nm">${esc(na)}</div></div><div><div class="p b">${pct(1 - r.p)}</div><div class="nm">${esc(nb)}</div></div></div>
   <div class="bar lg"><i style="width:${(r.p * 100).toFixed(1)}%"></i></div>
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
    <div class="ph sm"><h2>VALUE · model vs. kurzy</h2></div>${val.length ? groupsHtml(val.slice(0, 10)) : '<div class="empty">Žádný zápas nepřekračuje práh ' + VALUE_TH * 100 + ' p. b. (kurzy ze snímku; živé se načítají při zobrazení zápasu).</div>'}
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
function renderModel() {
  const m = S.meta, mt = m.metrics; const v = $('#v-model');
  const tbl = (k, title) => { const r = mt.metrics[k]; if (!r) return ''; const ks = ['rank_baseline', 'elo_only', 'gelo_only', 'logreg', 'old_model', 'v1_newdata', 'ensemble'].filter(x => r[x]);
    const best = { acc: Math.max(...ks.map(x => r[x].acc)), logloss: Math.min(...ks.map(x => r[x].logloss)), brier: Math.min(...ks.map(x => r[x].brier)) };
    return `<h3>${title} <small class="note">(n = ${r.lightgbm.n.toLocaleString('cs-CZ')})</small></h3><table><tr><th>Model</th><th>Přesnost</th><th>Log loss</th><th>Brier</th></tr>${ks.map(x => `<tr><td>${MODEL_CS[x]}</td><td class="${r[x].acc === best.acc ? 'best' : ''}">${(r[x].acc * 100).toFixed(1)} %</td><td class="${r[x].logloss === best.logloss ? 'best' : ''}">${r[x].logloss.toFixed(3)}</td><td class="${r[x].brier === best.brier ? 'best' : ''}">${r[x].brier.toFixed(3)}</td></tr>`).join('')}</table>`; };
  const SRC = { sackmann: 'Sackmann (archiv)', tml: 'TennisMyLife', flashscore: 'Flashscore (build)' };
  const cov = Object.entries(m.coverage).map(([k, by]) => { const [g, grp] = k.split('_');
    return `<tr><td>${g === 'M' ? 'Muži' : 'Ženy'} – ${GRP_CS[grp]}</td><td>${Object.entries(by).map(([s, [a, b, n]]) => `${SRC[s] || s}: ${a.slice(0, 4)}–${b.slice(6, 8)}.${b.slice(4, 6)}.${b.slice(0, 4)} (${n.toLocaleString('cs-CZ')})`).join('<br>')}</td></tr>`; }).join('');
  const L = S.live;
  v.innerHTML = `<div class="ph"><h1>MODEL</h1></div><div class="card"><h2>O modelu</h2>
   <p>Model předpovídá pravděpodobnost výhry ve dvouhře pro <b>všechny úrovně</b>: Grand Slamy, ATP/WTA, Challengery, WTA 125, ITF/Futures i kvalifikace. Příznaky pro každý zápas se počítají jen z předchozích zápasů: Elo celkové a podle povrchu (K-faktor podle úrovně turnaje), žebříček a body, forma, H2H, věk, výška, ruka, únava, úspěšnost na povrchu, klouzavé statistiky podání/příjmu a úroveň turnaje. Pořadí hráčů je náhodné; predikce je symetrizovaná.</p><p><b>Verze 2</b> přidává Elo počítané z podílu vyhraných gemů (zohlední, jak přesvědčivě hráč vyhrál/prohrál), totéž podle povrchu, časově váženou formu (poločas ~1 měsíc), formu za 60 dní, nejistotu ratingu ve stylu Glicko (málo zápasů / dlouhá pauza), neaktivitu a součet bodů na podání+příjmu. Hyperparametry a kalibrace laděny jen na validaci (2. pol. 2025).</p>
   <div class="kv"><div>Poslední datum v datech buildu</div><div><b>${fmtDate(m.day_end)}</b></div><div>Build</div><div>${esc(m.built)}${m.mode === 'daily-incremental' ? ' <small class="note">(automatická denní aktualizace GitHub Actions, ~05:17 a ~17:17)</small>' : ''}</div>${m.update ? `<div>Poslední aktualizace</div><div>+${m.update.applied} zápasů${m.update.new_players ? `, ${m.update.new_players} nových hráčů` : ''}</div>` : ''}${m.full_build ? `<div>Plná přestavba a trénink</div><div>${esc(m.full_build)}</div>` : ''}
   <div>Trénink</div><div>${esc(mt.split.train)} (${mt.split.n_train.toLocaleString('cs-CZ')})</div><div>Validace</div><div>${esc(mt.split.valid)} (${mt.split.n_valid.toLocaleString('cs-CZ')})</div>
   <div>Refit (nasazený model)</div><div>${esc(mt.split.refit || '—')}</div><div>Holdout (mimo vzorek)</div><div>${esc(mt.split.test)} (${mt.split.n_test.toLocaleString('cs-CZ')})</div><div>Stromů LightGBM</div><div>${mt.gbm_trees}</div></div></div>
   <div class="card"><h2>Úspěšnost na holdoutu 2026</h2><p class="note">Všechny modely hodnoceny na stejných zápasech od 1. 1. 2026, které žádný z nich neviděl. Původní v1 = dosud nasazený model (trénink do 2024).</p>${tbl('overall', 'Celkem')}${tbl('tour', 'Hlavní okruh ATP/WTA')}${tbl('chall', 'Challenger / WTA 125')}${tbl('itf', 'ITF / Futures')}${tbl('qual', 'Kvalifikace')}
   <p class="note">Přesnost = podíl správně tipnutých vítězů. Log loss a Brier: nižší = lépe kalibrované pravděpodobnosti. Baseline = logistický model jen z pozic v žebříčku.</p>
   <details><summary>Podle pohlaví</summary>${['M_tour', 'W_tour', 'M_chall', 'W_chall', 'M_itf', 'W_itf'].map(k => tbl(k, (k[0] === 'M' ? 'Muži – ' : 'Ženy – ') + GRP_CS[k.slice(2)])).join('')}</details>
   <details><summary>Kalibrace</summary><table><tr><th>Předpověď</th><th>n</th><th>Průměr předp.</th><th>Skutečnost</th></tr>${mt.calibration.map(c => `<tr><td>${c.bin}</td><td>${c.n}</td><td>${c.pred ?? '—'}</td><td>${c.obs ?? '—'}</td></tr>`).join('')}</table></details>
   <details><summary>Nejdůležitější příznaky (LightGBM)</summary><table>${mt.importance.slice(0, 15).map(([f, g]) => `<tr><td>${esc(FEAT_CS[f] || f)}</td><td>${(g * 100).toFixed(1)} %</td></tr>`).join('')}</table></details></div>
   <div class="card"><h2>Data</h2><table><tr><th>Kategorie</th><th style="text-align:left">Zdroj: rozsah (počet zápasů)</th></tr>${cov}</table>
   <p class="note">Sackmannovy repozitáře tennis_atp/tennis_wta jsou od léta 2026 offline; použit veřejný archiv (snapshot do ${fmtDate(m.gap_start)}). ATP/WTA okruh a Challengery jsou doplněny z TennisMyLife až do buildu. ITF, WTA 125 a kvalifikace Challengerů mají mezeru mezi snapshotem a posledními 7 dny před buildem (u těchto hráčů je neutralizována únava).</p></div>
   <div class="card"><h2>Živá data a aktualizace</h2>
   <p><b>Při otevření</b> aplikace v prohlížeči (bez klíčů) stáhne rozpis a výsledky (±2 dny, výsledky ~7 dní zpět) a z nových výsledků <b>přepočítá Elo</b>, formu, únavu a H2H. <b>Živé skóre</b> ATP/WTA se obnovuje každých 45 s, dokud je stránka otevřená a viditelná. Predikce se počítají přímo v telefonu.</p>
   <div class="kv"><div>ESPN – živé skóre ATP/WTA (+ část WTA 125)</div><div>${L.espn ? '✅ funguje' : '⚠️ nedostupné'}${L.polls ? ` · ${L.polls}× obnoveno` : ''}</div>
   <div>Sofascore (všechny úrovně)</div><div>${L.sofa ? '✅ funguje' : '⚠️ z této sítě blokováno'}</div>
   <div>Snímek z buildu (Flashscore, Challenger/ITF + kurzy)</div><div>${esc(L.snapshot || '—')}</div>
   <div>Živé kurzy (Flashscore odds, CORS)</div><div>${L.oddsOk ? `✅ načteno ${L.oddsOk}×` : L.oddsErr ? '⚠️ nedostupné – použit snímek' : 'načítají se u zobrazených zápasů'}</div>
   <div>Dokončené zápasy z živých zdrojů</div><div>${L.finished}</div><div>Už obsaženo v buildu / duplicity</div><div>${L.dup}</div>
   <div>Nově započteno do Elo</div><div>${L.applied}</div><div>Neznámí hráči v živých datech</div><div>${L.unknown}</div></div>
   <p class="note">Flashscore rozpis pokrývá všechny úrovně, ale prohlížeč ho z cizího webu nepustí (CORS) – Challenger/ITF proto jen ze snímku buildu (bez živého skóre). Kurzy Flashscore CORS povolují, ale potřebují ID zápasu ze snímku; zápasy ESPN se se snímkem párují podle dvojice hráčů. Bez nového buildu se neaktualizuje žebříček, statistiky podání/příjmu a samotný model.</p></div>
   <div class="card"><h2>Kurzy a zodpovědné hraní</h2><p>„Value“ se zvýrazní, když pravděpodobnost modelu převýší implikovanou pravděpodobnost trhu (průměrný kurz, marže odečtena) aspoň o ${VALUE_TH * 100} procentních bodů a očekávaná návratnost při nejlepším kurzu je aspoň ${VALUE_EV * 100} %. Model se od trhu liší v průměru o ~8 p. b. (korelace 0,90), proto je práh přísnější. Na testu 2025–26 má model přesnost ~70 %; trh bývá přesnější, protože vidí informace, které model nemá.</p>
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
document.addEventListener('visibilitychange', () => { if (!document.hidden && S.live.last && Date.now() - S.live.last > REFRESH_MS - 5000) refreshLive(); });

async function init() {
  loadFav(); route();
  const st = $('#status');
  try {
    const [meta, idx, model] = await Promise.all(['data/meta.json', 'data/players.json', 'data/model.json'].map(u => fetch(u).then(r => { if (!r.ok) throw new Error(u); return r.json(); })));
    S.meta = meta; S.idx = idx; S.N = idx.id.length; S.model = new TM.Model(model); S.extraKey = {};
    S.idMap = new Map(idx.id.map((x, i) => [String(x), i]));
    S.E = idx.e.slice(); S.SE = idx.se.map(x => x.slice()); S.GE = (idx.ge || idx.e).slice(); S.GSE = (idx.gse || idx.se).map(x => x.slice()); S.K = idx.k.slice(); S.SK = idx.sk.map(x => x.slice());
    S.norm = idx.n.map(n => toks(n).join(' '));
    S.ro = idx.ro.map(s => s ? s.split(';').map(t => { const [o, d] = t.split(','); return [+o, meta.day_end - (+d)]; }) : []);
    S.matcher = new Matcher(); for (let i = 0; i < S.N; i++) S.matcher.add(i, idx.g[i], idx.n[i], -idx.l[i]);
    try { S.tours = await getJSON('data/tournaments.json'); } catch (e) { S.tours = {}; }
    st.textContent = `Data do ${fmtDate(meta.day_end)} · načítám živý rozpis…`;
    cleanCache();
    await loadLive();
    updateStatus();
    route();
    setInterval(() => refreshLive(), REFRESH_MS);
    setInterval(oddsTick, 20000);
  } catch (e) { st.textContent = 'Chyba načítání: ' + e.message; console.error(e); }
}
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => { }));
init();
