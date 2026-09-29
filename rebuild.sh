#!/usr/bin/env bash
# Kompletní přestavba: stažení dat -> sjednocení -> Elo/příznaky -> trénink -> export -> test parity -> dist
# Volitelně:  ./rebuild.sh --deploy   (anonymní ShipStatic deploy, bez API klíče; vytvoří NOVOU URL platnou ~3 dny)
set -euo pipefail
cd "$(dirname "$0")"
PY=.venv/bin/python
if [ ! -x "$PY" ]; then python3 -m venv .venv && .venv/bin/pip install -q scikit-learn lightgbm pandas pyarrow playwright; fi
$PY scripts/fetch_data.py          # Sackmann archiv + TennisMyLife + Flashscore (posl. 7 dní + rozpis)
$PY scripts/data.py                # sjednocená tabulka všech úrovní -> data/matches.parquet
$PY scripts/run_engine.py          # Elo, forma, H2H, únava, podání/příjem -> příznaky + stav hráčů
$PY -W ignore scripts/train.py     # v1 vs v2 na holdoutu 2026; v2 se nasadí jen když je lepší -> web/data/model.json
$PY scripts/export.py              # web/data/players.json, st/*.json, meta.json, upcoming.json, tournaments.json
node scripts/parity_test.js        # JS == Python
bash scripts/make_dist.sh
if [ "${1:-}" = "--deploy" ]; then
  npx -y @shipstatic/ship dist --json | tee deploy-last.json
fi
