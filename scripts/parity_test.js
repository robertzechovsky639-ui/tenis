// Ověří, že web/model.js počítá stejné příznaky a pravděpodobnosti jako Python (export.py).
const fs = require('fs'), path = require('path');
const W = path.join(__dirname, '..', 'web');
const TM = require(path.join(W, 'model.js'));
const meta = JSON.parse(fs.readFileSync(path.join(W, 'data/meta.json')));
const model = new TM.Model(JSON.parse(fs.readFileSync(path.join(W, 'data/model.json'))));
const idx = JSON.parse(fs.readFileSync(path.join(W, 'data/players.json')));
const par = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data/parity.json')));
const shards = {};
const st = i => { const k = i % meta.nsh; shards[k] = shards[k] || JSON.parse(fs.readFileSync(path.join(W, `data/st/${k}.json`))); return shards[k][i]; };
let maxdx = 0, maxdp = 0;
for (const t of par) {
  const A = TM.decode(st(t.ia), idx.g[t.ia], meta.day_end), B = TM.decode(st(t.ib), idx.g[t.ib], meta.day_end);
  const ctx = { day: t.today, dayA: TM.refDay(A, t.today, meta.gap_start), dayB: TM.refDay(B, t.today, meta.gap_start),
    surface: TM.SURF[t.surface], lvl_code: t.code, is_qual: t.q, best_of: t.bo };
  const x = TM.feats(A, B, ctx, A.h2h[t.ib] || [0, 0]);
  x.forEach((v, i) => { maxdx = Math.max(maxdx, Math.abs(v - t.x[i])); });
  const p = model.predict(x).p; maxdp = Math.max(maxdp, Math.abs(p - t.p));
}
console.log(`parity: ${par.length} zápasů, max |Δx| = ${maxdx.toExponential(2)}, max |Δp| = ${maxdp.toExponential(2)}`);
if (maxdp > 1e-4) { console.error('PARITY FAIL'); process.exit(1); }
