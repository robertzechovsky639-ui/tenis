# TENIS · živě a predikce (CZ, PWA)

**Trvalá adresa:** https://robertzechovsky639-ui.github.io/tenis/  (na iPhonu: Safari → Sdílet → Přidat na plochu)

Predikce tenisových dvouher všech úrovní (Grand Slam, ATP/WTA, Challenger, WTA 125, ITF, kvalifikace), živé výsledky a kurzy,
graf formy, AI chat. Vše zdarma a bez API klíčů. Model: LightGBM v2 (holdout 2026: 70,23 % přesnost), inference v prohlížeči.

## Automatická denní aktualizace (GitHub Actions, `.github/workflows/daily.yml`)
Dvakrát denně (~05:17 a ~17:17 pražského letního času; v zimě o hodinu dřív) + ručně (Actions → Run workflow):
1. `scripts/daily.py` načte kompaktní stav `state/`, stáhne Flashscore (výsledky 7 dní zpět + rozpis, všechny úrovně)
   a TennisMyLife CSV (ATP, Challenger, ATP kvalifikace, WTA – žebříček + statistiky), nové zápasy započte funkcí `engine.update`
   (Elo, Elo z gemů, povrchy, forma, historie, H2H), **bez přetrénování** modelu.
2. Export `web/data` (hráči, predikce na dnes/zítra, snímek kurzů), kontrola `check_data.py` + parita JS == Python.
3. Commit změněného `state/` a nasazení `dist/` na GitHub Pages.

`state/` = textové shardy (řádek na hráče / H2H pár), takže git ukládá jen malé denní delty.

## Plná přestavba (lokálně, ne v CI)
    ./rebuild.sh                           # stáhne celý archiv (~1 GB), přepočítá, přetrénuje, exportuje, dist/
    .venv/bin/python scripts/init_state.py # z plné přestavby vytvoří nový state/ pro denní aktualizace
    .venv/bin/python scripts/test_mobile.py <URL>   # headless test 390x844
    .venv/bin/python scripts/test_chat.py <URL>     # test AI chatu

## Zdroje dat (bez klíčů)
- Archiv Jeff Sackmann tennis_atp/tennis_wta – mirror github.com/Aneeshers/tennis-sackmann-archive (CC BY-NC-SA 4.0) – jen plná přestavba
- TennisMyLife CSV (stats.tennismylife.org) – denně
- Flashscore veřejný feed – denně (build) + živě v prohlížeči
- Živě v prohlížeči: ESPN scoreboard (ATP/WTA), kurzy Flashscore; AI chat: ch.at, LLM7.io, OVHcloud, Pollinations (volitelně WebLLM v zařízení)
