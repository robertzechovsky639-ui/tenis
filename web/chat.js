/* AI chat – zdarma a bez API klíče. Online: rotace bezplatných služeb (LLM7.io, ch.at, OVHcloud, Pollinations) s fallbackem.
   Volitelně: WebLLM přímo v zařízení (WebGPU). Odpovědi jen z dat aplikace (kontext se skládá z aktuálního stavu). */
'use strict';
const CH_PROV = {
  llm7: { name: 'LLM7.io', url: 'https://api.llm7.io/v1/chat/completions', gap: 6500, cool: 60000 },
  chat: { name: 'ch.at', url: 'https://ch.at/v1/chat/completions', gap: 3000, cool: 30000 },
  ovh: { name: 'OVHcloud', url: 'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions', gap: 31000, cool: 60000 },
  poll: { name: 'Pollinations.ai', url: 'https://text.pollinations.ai/openai', gap: 16000, cool: 30000 },
};
// minimax-m2.7 (LLM7) vypouští úvahy bez <think> a je pomalý → jen jako poslední záloha
const CH_ROUTES = [['chat', 'gpt-4o-mini'], ['llm7', 'codestral-latest'], ['ovh', 'Meta-Llama-3_3-70B-Instruct'], ['poll', 'openai'], ['ovh', 'Mistral-Small-3.2-24B-Instruct-2506'], ['llm7', 'minimax-m2.7']];
const CH_LOCAL = [
  { id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', name: 'Qwen2.5 1.5B (doporučeno)', size: '0,87 GB' },
  { id: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC', name: 'Qwen2.5 0.5B (nejmenší, slabá čeština)', size: '0,28 GB' },
  { id: 'gemma3-1b-it-q4f16_1-MLC', name: 'Gemma 3 1B', size: '0,56 GB' },
  { id: 'Qwen2.5-3B-Instruct-q4f16_1-MLC', name: 'Qwen2.5 3B (lepší telefony)', size: '1,74 GB' },
];
const WEBLLM_URL = 'https://esm.run/@mlc-ai/web-llm@0.2.85';
const CH = {
  msgs: (() => { try { return JSON.parse(localStorage.getItem('tp:chat') || '[]').slice(-30); } catch (e) { return []; } })(),
  set: Object.assign({ mode: 'auto', local: CH_LOCAL[0].id }, (() => { try { return JSON.parse(localStorage.getItem('tp:chatset') || '{}'); } catch (e) { return {}; } })()),
  st: {}, rr: 0, busy: false, ctxId: null, lastProv: '',
  save() { try { localStorage.setItem('tp:chat', JSON.stringify(this.msgs.slice(-30))); localStorage.setItem('tp:chatset', JSON.stringify(this.set)); } catch (e) { } },
};
const Local = {
  lib: null, engine: null, id: null, loading: null, prog: '',
  async gpu() { if (!('gpu' in navigator)) return { ok: false, why: 'Prohlížeč nepodporuje WebGPU (na iPhonu je potřeba Safari 26+). Použijte režim Online.' };
    try { const a = await navigator.gpu.requestAdapter(); return a ? { ok: true, f16: a.features.has('shader-f16') } : { ok: false, why: 'Nenašel se grafický adaptér pro WebGPU.' }; } catch (e) { return { ok: false, why: 'WebGPU selhalo: ' + e.message }; } },
  load(id, onP) {
    if (this.engine && this.id === id) return Promise.resolve();
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const g = await this.gpu(); if (!g.ok) throw new Error(g.why);
      if (!this.lib) this.lib = await import(WEBLLM_URL);
      if (this.engine) { try { await this.engine.unload(); } catch (e) { } this.engine = null; }
      const rid = g.f16 ? id : id.replace('q4f16_1', 'q4f32_1');
      this.engine = await this.lib.CreateMLCEngine(rid, { initProgressCallback: p => { this.prog = `${Math.round((p.progress || 0) * 100)} % · ${/fetch|download|param/i.test(p.text || '') ? 'stahuji model' : 'připravuji'}`; onP && onP(this.prog); } });
      this.id = id;
    })().finally(() => { this.loading = null; });
    return this.loading;
  },
  async chat(messages) { const r = await this.engine.chat.completions.create({ messages, temperature: 0.3, max_tokens: 450 }); return r?.choices?.[0]?.message?.content || ''; },
};

/* ---------- kontext z dat aplikace ---------- */
const f2 = x => (x == null ? '—' : Number(x).toFixed(2));
const pc0 = x => (x == null ? '—' : Math.round(x * 100) + ' %');
function evLine(e) {
  const r = resolveEv(e); const na = pName(r.hi), nb = pName(r.ai);
  let s = `${e.tname} (${catLabel(e)}${e.q ? ', kval.' : ''}, ${SURF_CS[e.surface]}, ${e.g === 'M' ? 'muži' : 'ženy'}) | ${na} vs ${nb}`;
  if (e.st === 1) s += ` | ${e.stale ? 'bez živých dat, plán' : 'začátek'} ${dayLabel(dayOff(e.ts), true)} ${hm(e.ts)}`;
  if (e.st === 2 && !e.stale) s += ` | ŽIVĚ ${e.sets.map(x => x[0] + ':' + x[1]).join(' ')}`;
  if (e.st === 3) s += ` | výsledek: vyhrál(a) ${e.win === 1 ? na : nb} ${e.sets.map(x => x[0] + ':' + x[1]).join(' ')}${e.det === 8 ? ' (skreč)' : ''}`;
  if (e.st !== 3 && e._p != null) s += ` | model: ${na} ${pc0(e._p)}, ${nb} ${pc0(1 - e._p)}`;
  const o = e.oddsV; if (e.st !== 3 && o && o.avg) { const im = implied(o); const v = valueOf(e);
    s += ` | kurzy ⌀ ${f2(o.avg[0])}/${f2(o.avg[1])} (${o.n} kanceláří), trh bez marže ${pc0(im.p)}/${pc0(1 - im.p)}${v && v.side ? `, model nad trhem u ${v.side === 1 ? na : nb} o ${Math.round(Math.abs(v.edge) * 100)} p. b.` : ''}`; }
  return s;
}
function playerCtx(i, surface) {
  const p = state(i); if (!p) return `${pName(i)}: bez dat.`;
  const t = todayDay(); const s = TM.SURF[surface || 'Hard'];
  const f10 = p.ring.slice(-10).map(x => x[1] ? 'V' : 'P').join('');
  const pd = perfData(i); const pw = pd.filter(x => x.w).length, pe = pd.reduce((a, x) => a + x.ew, 0), pcum = pd.length ? pd[pd.length - 1].cum : 0;
  const fat = TM.fatigue(p.ring, t);
  return `${pName(i)} (${pG(i) === 'M' ? 'muž' : 'žena'}, ${pC(i) || '?'}${p.dob != null ? ', ' + Math.floor((t - p.dob) / 365.25) + ' let' : ''}${p.hand ? ', ' + (p.hand === 'L' ? 'levák' : 'pravák') : ''}): žebříček ${p.rank ? '#' + p.rank : 'neznámý'}, Elo ${Math.round(p.elo)}, Elo ${SURF_CS[surface || 'Hard']} ${Math.round(p.se[s])}, Elo z gemů ${Math.round(p.gelo)}; zápasů v databázi ${p.n}${p.isNew ? ' (NOVÝ/NESPÁROVANÝ HRÁČ – odhad nejistý)' : ''}; forma posl. 10 (nejstarší→nejnovější) ${f10 || '—'}; výkon vs. očekávání za 2 měsíce: ${pd.length ? `${pw}–${pd.length - pw}, očekáváno ${pe.toFixed(1)} výher, rozdíl ${pcum >= 0 ? '+' : ''}${pcum.toFixed(1)}` : 'žádné zápasy'}; hodnocení formy (vážený výkon vs. očekávání) dnes ${fpct(formAt(i, todayDay())?.f || 0)}, před 4 týdny ${fpct(formAt(i, todayDay() - 28)?.f || 0)}; zápasy za 14 dní ${fat[1]}; poslední zápas ${p.last != null ? fmtDate(p.last) : '—'}${p.ns ? `; podání ${(p.spw * 100).toFixed(1)} % bodů, příjem ${(p.rpw * 100).toFixed(1)} %, esa ${(p.ace * 100).toFixed(1)} %, dvojchyby ${(p.df * 100).toFixed(1)} %` : ''}; bilance na povrchu ${p.sw[s]}–${p.sl[s]}.`;
}
function matchCtx(e) {
  const r = resolveEv(e); const na = pName(r.hi), nb = pName(r.ai);
  let s = `VYBRANÝ ZÁPAS: ${evLine(e)}\n`;
  try {
    const pr = predict(r.hi, r.ai, e.surface, e.code, e.q);
    const fac = pr.contrib.filter(x => Math.abs(x[1]) > 0.02).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 6).map(([f, v]) => `${FEAT_CS[f] || f} → ve prospěch ${v > 0 ? na : nb}`).join('; ');
    s += `Predikce modelu (LightGBM v2): ${na} ${pc0(pr.p)}; jen Elo ${pc0(pr.elo)}; jen žebříček ${pc0(pr.base)}; na ${pr.ctx.best_of} sety. Hlavní faktory: ${fac || 'vyrovnané'}.\n`;
    s += `H2H: ${na} ${pr.h2h[0]} : ${pr.h2h[1]} ${nb}. ${meetings(r.hi, r.ai).slice(0, 5).map(m => `${fmtDate(m[0])} vyhrál(a) ${m[1] ? na : nb}`).join('; ')}\n`;
  } catch (err) { }
  const o = e.oddsV; if (o && o.books && o.books.length) s += `Kurzy po kancelářích: ${o.books.map(b => `${b.name} ${f2(b.h)}/${f2(b.a)}${b.oh ? ` (otevírací ${f2(b.oh)}/${f2(b.oa)})` : ''}`).join('; ')}. Marže ${o.avg ? (implied(o).margin * 100).toFixed(1) + ' %' : '—'}.\n`;
  s += 'HRÁČ A: ' + playerCtx(r.hi, e.surface) + '\nHRÁČ B: ' + playerCtx(r.ai, e.surface) + '\n';
  return s;
}
async function buildCtx(question, compact) {
  const t = todayDay(); const lines = [];
  lines.push(`Dnes je ${new Date().toLocaleString('cs-CZ', { weekday: 'long', day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })} (Praha). Data výsledků do ${fmtDate(S.meta.day_end)}, živé skóre ATP/WTA z ESPN, Challenger/ITF jen ze snímku buildu ${S.live.snapshot || ''}.`);
  const mt = S.meta.metrics?.metrics?.overall?.ensemble; if (mt) lines.push(`Model: přesnost ${(mt.acc * 100).toFixed(1)} % na holdoutu 2026 (log loss ${mt.logloss}). Pravděpodobnosti jsou odhady, ne jistota.`);
  const evs = (S.all || []).filter(e => dayOff(e.ts) >= -1 && dayOff(e.ts) <= 1);
  await probsFor(evs.filter(e => e.st !== 3));
  if (CH.ctxId && S.byId[CH.ctxId]) { const e = S.byId[CH.ctxId]; const r = resolveEv(e); await ensure([r.hi, r.ai]); lines.push(matchCtx(e)); }
  // hráči zmínění v otázce
  const words = toks(question).filter(w => w.length >= 4); const seen = new Set();
  for (const w of words) { if (seen.size >= 2) break; let best = -1;
    for (let i = 0; i < S.N; i++) { const tk = S.norm[i].split(' '); if (tk.includes(w) && (best < 0 || S.E[i] > S.E[best])) best = i; }
    if (best >= 0 && !seen.has(best)) { seen.add(best); await ensure([best]); lines.push('ZMÍNĚNÝ HRÁČ: ' + playerCtx(best, 'Hard'));
      const pe = evs.filter(e => { const r = resolveEv(e); return r.hi === best || r.ai === best; }); for (const e of pe.slice(0, 3)) lines.push('  zápas: ' + evLine(e)); } }
  const up = evs.filter(e => e.st !== 3).sort((a, b) => (b.code - a.code) || (Math.abs((b._p ?? .5) - .5) - Math.abs((a._p ?? .5) - .5)));
  const lim = compact ? 12 : 45;
  lines.push(`ZÁPASY DNES/ZÍTRA/ŽIVĚ (${up.length}, zobrazeno ${Math.min(lim, up.length)}, řazeno podle úrovně):`);
  for (const e of up.slice(0, lim)) lines.push('- ' + evLine(e));
  const conf = up.filter(e => e.st === 1 && e._p != null && !e.stale).sort((a, b) => Math.abs(b._p - .5) - Math.abs(a._p - .5)).slice(0, compact ? 5 : 10);
  lines.push('NEJJISTĚJŠÍ TIPY MODELU (nezačaté):'); for (const e of conf) lines.push('- ' + evLine(e));
  const fin = evs.filter(e => e.st === 3 && e.code >= 3).sort((a, b) => b.ts - a.ts).slice(0, compact ? 5 : 15);
  lines.push('POSLEDNÍ VÝSLEDKY (včera/dnes, okruh a Challenger):'); for (const e of fin) lines.push('- ' + evLine(e));
  if (S.fav && S.fav.size) lines.push('Oblíbení hráči uživatele: ' + [...S.fav.values()].map(f => f.n).join(', '));
  let ctx = lines.join('\n'); const max = compact ? 3500 : 14000; if (ctx.length > max) ctx = ctx.slice(0, max) + '\n…(zkráceno)';
  return ctx;
}
const SYS = `Jsi tenisový asistent v české aplikaci „TENIS · živě a predikce“. Odpovídej VŽDY česky, stručně a věcně (nejvýš ~170 slov, klidně odrážky).
Používej POUZE data z bloku DATA APLIKACE. Nevymýšlej výsledky, zranění, novinky ani čísla, která v datech nejsou. Když odpověď v datech není, napiš jasně „To v datech aplikace nemám.“ a případně co v datech je.
Procenta jsou odhady statistického modelu, ne jistota. Nedávej sázkové rady ani doporučení, na co vsadit, a nepiš výši sázek. Rozdíl model vs. kurzy smíš popsat, ale dodej, že to není doporučení k sázce. Při vysvětlování „proč“ vycházej z hlavních faktorů, Elo, formy, H2H a výkonu vs. očekávání.`;

async function callProv([prov, model], messages) {
  const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), model.startsWith('minimax') ? 45000 : 30000);
  try {
    const body = { model, messages, temperature: 0.3 }; if (prov === 'poll') body.private = true; body.max_tokens = 900;
    let res; try { res = await fetch(CH_PROV[prov].url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal, referrerPolicy: 'no-referrer', credentials: 'omit' }); }
    catch (e) { throw Object.assign(new Error(e.name === 'AbortError' ? 'neodpověděla včas' : 'síťová chyba / CORS'), { kind: 'net' }); }
    if (res.status === 429 || res.status === 402) throw Object.assign(new Error('limit vyčerpán (' + res.status + ')'), { kind: 'rate' });
    if (!res.ok) throw Object.assign(new Error('chyba serveru ' + res.status), { kind: 'server' });
    const raw = await res.text(); let txt; try { txt = JSON.parse(raw)?.choices?.[0]?.message?.content; } catch (e) { txt = raw; }
    txt = String(txt || '').replace(/<think>[\s\S]*?<\/think>/g, '').replace(/^[\s\S]*<\/think>/, '').trim();
    if (!txt) throw Object.assign(new Error('prázdná odpověď'), { kind: 'empty' });
    return txt;
  } finally { clearTimeout(to); }
}
async function askAI(question, onStatus) {
  const useLocal = CH.set.mode === 'local' || (CH.set.mode === 'auto' && Local.engine);
  const ctx = await buildCtx(question, useLocal);
  const hist = CH.msgs.filter(m => m.role === 'user' || m.role === 'assistant').slice(-6).map(m => ({ role: m.role, content: m.text.slice(0, 1200) }));
  const messages = [{ role: 'system', content: SYS + '\n\nDATA APLIKACE:\n' + ctx }, ...hist, { role: 'user', content: question }];
  if (useLocal) {
    if (!Local.engine) throw new Error('Model v zařízení není spuštěný – v nastavení chatu zvolte model a klepněte na „Stáhnout a spustit“, nebo přepněte na Online.');
    onStatus && onStatus('Přemýšlí model v zařízení…'); const out = await Local.chat(messages); CH.lastProv = 'v zařízení (' + (CH_LOCAL.find(m => m.id === Local.id) || {}).name + ')'; return out;
  }
  const errs = []; const n = CH_ROUTES.length; const start = CH.rr % n; const now = Date.now();
  const order = []; for (let k = 0; k < n; k++) order.push(CH_ROUTES[(start + k) % n]);
  order.sort((a, b) => ((CH.st[a[0]]?.cool || 0) > now) - ((CH.st[b[0]]?.cool || 0) > now));
  for (const opt of order) {
    const st = CH.st[opt[0]] = CH.st[opt[0]] || {};
    if ((st.cool || 0) > Date.now()) { errs.push(`${CH_PROV[opt[0]].name}: pauza po limitu`); continue; }
    onStatus && onStatus(`Ptám se ${CH_PROV[opt[0]].name}…`);
    try { const out = await callProv(opt, messages); CH.rr = (CH_ROUTES.indexOf(opt) + 1) % n; CH.lastProv = `${CH_PROV[opt[0]].name} · ${opt[1]}`; return out; }
    catch (e) { errs.push(`${CH_PROV[opt[0]].name} (${opt[1]}): ${e.message}`); if (e.kind === 'rate') st.cool = Date.now() + CH_PROV[opt[0]].cool; else st.cool = Date.now() + 20000; }
  }
  if (CH.set.mode === 'auto' && Local.engine) { onStatus && onStatus('Online služby selhaly, zkouším model v zařízení…'); CH.lastProv = 'v zařízení'; return Local.chat(await (async () => [{ role: 'system', content: SYS + '\n\nDATA APLIKACE:\n' + await buildCtx(question, true) }, { role: 'user', content: question }])()); }
  throw Object.assign(new Error('Všechny bezplatné AI služby jsou teď nedostupné.'), { details: errs });
}

/* ---------- UI ---------- */
function mdLite(t) {
  let h = esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|\n)#{1,4}\s*(.+)/g, '$1<b>$2</b>');
  h = h.replace(/(^|\n)\s*[-*•]\s+(.+)/g, '$1<li>$2</li>').replace(/(<li>[\s\S]*?<\/li>)(?!\s*<li>)/g, '<ul>$1</ul>');
  return h.replace(/<\/li>\n/g, '</li>').replace(/\n/g, '<br>');
}
function chips() {
  const e = CH.ctxId && S.byId[CH.ctxId];
  if (e) { const r = resolveEv(e); const nb = pName(r.ai).split(' ').slice(-1)[0], na = pName(r.hi).split(' ').slice(-1)[0];
    return ['Kdo vyhraje a proč?', 'Jak se liší model a kurzy?', `Jakou formu má ${na} a ${nb}?`, 'Jaká je vzájemná bilance?', 'Kdo hraje nad očekávání za 2 měsíce?']; }
  return ['Nejjistější tipy dnes', 'Které zápasy se hrají živě?', 'Kde se model nejvíc liší od kurzů?', 'Jak dopadli Češi?', 'Jak přesný je model?'];
}
function renderChat() {
  const v = $('#v-chat'); const e = CH.ctxId && S.byId[CH.ctxId];
  const ctxBar = e ? (() => { const r = resolveEv(e); return `<div class="cctx">Kontext: <b>${esc(dispName(r.hi, e.h))} vs ${esc(dispName(r.ai, e.a))}</b> <button class="cx" id="c-clear" aria-label="Zrušit kontext zápasu">✕</button></div>`; })()
    : '<div class="cctx">Kontext: dnešní a zítřejší zápasy, predikce, kurzy, Elo, forma</div>';
  v.innerHTML = `<div class="ph"><h1>AI CHAT</h1><button class="cset" id="c-set" aria-label="Nastavení AI">⚙︎</button></div>
    <div id="c-panel" class="card cpanel" hidden></div>${ctxBar}
    <div id="c-log" class="clog">${CH.msgs.length ? CH.msgs.map(msgHtml).join('') : `<div class="cmsg bot"><div class="bub">Ahoj! Ptejte se na zápasy, predikce, formu hráčů nebo kurzy. Odpovídám jen z dat aplikace – co v nich není, nevím.</div></div>`}</div>
    <div class="cchips">${chips().map(c => `<button class="chip2" data-q="${esc(c)}">${esc(c)}</button>`).join('')}</div>
    <form id="c-form" class="cform"><input id="c-in" placeholder="Zeptejte se…" autocomplete="off" maxlength="500"><button class="csend" id="c-send" aria-label="Odeslat">➤</button></form>
    <p class="note gam">18+ AI nedává sázkové rady. Odpovědi vycházejí z modelu a dat aplikace a mohou být chybné. Sázení je riskantní – hrajte zodpovědně.</p>
    <p class="note">AI zdarma a bez klíče: ${CH.set.mode === 'local' ? 'model v zařízení (WebLLM)' : 'střídá LLM7.io, ch.at, OVHcloud a Pollinations'}${CH.set.mode === 'auto' ? ' (Automaticky: použije i model v zařízení, pokud je spuštěný)' : ''}. Otázka a výřez dat aplikace se posílají vybrané službě.</p>`;
  scrollLog();
}
function msgHtml(m) {
  if (m.role === 'user') return `<div class="cmsg me"><div class="bub">${esc(m.text)}</div></div>`;
  if (m.role === 'error') return `<div class="cmsg err"><div class="bub"><b>⚠️ ${esc(m.text)}</b>${m.details ? `<small>${m.details.map(esc).join('<br>')}</small>` : ''}<small>Zkuste to za chvíli znovu, nebo v ⚙︎ zapněte AI v zařízení.</small></div></div>`;
  return `<div class="cmsg bot"><div class="bub">${mdLite(m.text)}${m.prov ? `<small class="prov">${esc(m.prov)}</small>` : ''}</div></div>`;
}
function scrollLog() { const l = $('#c-log'); if (l) l.scrollTop = l.scrollHeight; window.scrollTo(0, document.body.scrollHeight); }
async function sendChat(q) {
  q = String(q || '').trim(); if (!q || CH.busy) return;
  CH.busy = true; CH.msgs.push({ role: 'user', text: q }); CH.save();
  const log = $('#c-log'); if (log) { if (CH.msgs.length === 1) log.innerHTML = ''; log.insertAdjacentHTML('beforeend', msgHtml({ role: 'user', text: q }) + '<div class="cmsg bot" id="c-wait"><div class="bub typing"><i></i><i></i><i></i><small id="c-st">Připravuji data…</small></div></div>'); scrollLog(); }
  const btn = $('#c-send'); if (btn) btn.disabled = true;
  try {
    const out = await askAI(q, s => { const el = $('#c-st'); if (el) el.textContent = s; });
    CH.msgs.push({ role: 'assistant', text: out, prov: CH.lastProv });
  } catch (e) { CH.msgs.push({ role: 'error', text: e.message, details: e.details }); }
  CH.busy = false; CH.save();
  $('#c-wait')?.remove(); const last = CH.msgs[CH.msgs.length - 1]; const l2 = $('#c-log'); if (l2) { l2.insertAdjacentHTML('beforeend', msgHtml(last)); scrollLog(); }
  if (btn) btn.disabled = false;
}
function renderChatPanel() {
  const p = $('#c-panel'); const s = CH.set;
  p.innerHTML = `<h3>Režim AI</h3>${[['auto', 'Automaticky', 'online služby; když je spuštěný model v zařízení, použije ho'], ['online', 'Online (zdarma)', 'LLM7.io, ch.at, OVHcloud, Pollinations – bez klíče'], ['local', 'V zařízení (WebLLM)', 'běží v telefonu přes WebGPU, bez internetu po stažení']].map(([k, t, d]) => `<label class="cmode"><input type="radio" name="cmode" value="${k}" ${s.mode === k ? 'checked' : ''}><span><b>${t}</b><small>${d}</small></span></label>`).join('')}
    <h3>Model v zařízení</h3><select id="c-model">${CH_LOCAL.map(m => `<option value="${m.id}" ${s.local === m.id ? 'selected' : ''}>${esc(m.name)} · ${m.size}</option>`).join('')}</select>
    <button class="btn sec" id="c-load">${Local.engine ? 'Spuštěno: ' + esc((CH_LOCAL.find(m => m.id === Local.id) || {}).name || '') : 'Stáhnout a spustit'}</button><div class="note" id="c-lp">${Local.loading ? esc(Local.prog) : 'Stahuje se jednou (uloží se v prohlížeči). Vyžaduje WebGPU (iPhone: Safari 26+).'}</div>
    <button class="btn sec" id="c-reset">Smazat konverzaci</button>`;
}
document.addEventListener('click', ev => {
  const t = ev.target;
  if (t.closest('#c-set')) { const p = $('#c-panel'); p.hidden = !p.hidden; if (!p.hidden) renderChatPanel(); return; }
  if (t.closest('#c-clear')) { CH.ctxId = null; renderChat(); return; }
  const q = t.closest('[data-q]'); if (q) { sendChat(q.dataset.q); return; }
  if (t.closest('#c-reset')) { CH.msgs = []; CH.save(); renderChat(); return; }
  if (t.closest('#c-load')) { CH.set.local = $('#c-model').value; CH.save(); const lp = $('#c-lp');
    Local.load(CH.set.local, pr => { if (lp) lp.textContent = pr; }).then(() => { renderChatPanel(); }).catch(e => { if (lp) lp.textContent = '⚠️ ' + e.message; }); return; }
  const ask = t.closest('[data-ask]'); if (ask) { CH.ctxId = ask.dataset.ask; if (S.detail) closeDetail(); setTimeout(() => { location.hash = '#chat'; }, 60); return; }
});
document.addEventListener('change', ev => { if (ev.target.name === 'cmode') { CH.set.mode = ev.target.value; CH.save(); } if (ev.target.id === 'c-model') { CH.set.local = ev.target.value; CH.save(); } });
document.addEventListener('submit', ev => { if (ev.target.id === 'c-form') { ev.preventDefault(); const i = $('#c-in'); const q = i.value; i.value = ''; sendChat(q); } });
